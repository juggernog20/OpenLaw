// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The SET-004 wizard's guard and its portal step — the step that closes
 * the fresh-install gap (issue #34): an un-onboarded Administrator is
 * routed in from home, non-admins and completed instances never see it,
 * and saving the portal step writes the allowlist through the API.
 */

import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Ada Admin",
  role: "administrator",
};

const MEMBER = { ...ADMIN, id: "u2", email: "sam@example.com", role: "legal_team_member" };

/** Loader answers the wizard needs beyond stubApi's defaults. */
function wizardExtra(domains: string[] = []) {
  return (call: StubCall) => {
    if (call.url.pathname === "/api/v1/auth/allowed-domains" && call.method === "GET") {
      return json(200, { domains });
    }
    return undefined;
  };
}

/** wizardExtra plus the portal step's save, so tests can walk past it. */
function emailWizardExtra(handler?: (call: StubCall) => Response | undefined) {
  return (call: StubCall) => {
    const handled = handler?.(call) ?? wizardExtra()(call);
    if (handled) return handled;
    if (call.url.pathname === "/api/v1/auth/allowed-domains" && call.method === "PUT") {
      return json(200, call.body);
    }
    return undefined;
  };
}

/** Clicks from the welcome card to the email step (auth and portal pass through). */
async function goToEmailStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Get started" }));
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("heading", { name: "Outbound email" })).toBeInTheDocument();
}

describe("welcome wizard guard", () => {
  it("routes an un-onboarded Administrator from home into the wizard", async () => {
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false, emailConfigured: true },
      extra: wizardExtra(),
    });
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Welcome to OpenLaw" })).toBeInTheDocument();
  });

  it("keeps a completed instance on home", async () => {
    stubApi({ signedIn: ADMIN, onboarding: { completed: true, emailConfigured: true } });
    renderAt("/welcome");
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
  });

  it("bounces a non-Administrator to home", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/welcome");
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
  });
});

describe("welcome wizard portal step", () => {
  it("saves the domain allowlist through the API and reports email status", async () => {
    let putBody: unknown;
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false, emailConfigured: false },
      emailSettings: { source: "unset", fromAddress: null },
      extra: (call) => {
        const fromLoader = wizardExtra()(call);
        if (fromLoader) return fromLoader;
        if (call.url.pathname === "/api/v1/auth/allowed-domains" && call.method === "PUT") {
          putBody = call.body;
          return json(200, call.body);
        }
        return undefined;
      },
    });
    renderAt("/welcome");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Get started" }));
    // Authentication step: keep built-in and continue (no API call needed).
    await user.click(await screen.findByRole("button", { name: "Continue" }));

    // Portal step: add a domain and continue — the PUT must carry it.
    await user.type(screen.getByLabelText("Allowed email domains"), "acme.example");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("acme.example")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Email step reflects the unconfigured instance loudly.
    expect(await screen.findByText(/Outbound email is not set up/)).toBeInTheDocument();
    expect(putBody).toEqual({ domains: ["acme.example"] });
  });
});

describe("welcome wizard email step (#37)", () => {
  it("shows an env-pinned relay read-only, naming the variables to change", async () => {
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false, emailConfigured: true },
      emailSettings: { source: "env", fromAddress: "OpenLaw <openlaw@example.com>" },
      extra: emailWizardExtra(),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToEmailStep(user);

    expect(
      screen.getByText(/Outbound email is set by the deployment environment/),
    ).toBeInTheDocument();
    expect(screen.getByText(/SMTP_URL and SMTP_FROM/)).toBeInTheDocument();
    // Read-only: no form, no save, and nothing to test from here.
    expect(screen.queryByLabelText("SMTP relay URL")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send test email" })).not.toBeInTheDocument();
  });

  it("saves a relay from the setup form and moves to the app-configured state", async () => {
    let putBody: unknown;
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false, emailConfigured: false },
      emailSettings: { source: "unset", fromAddress: null },
      extra: emailWizardExtra((call) => {
        if (call.url.pathname === "/api/v1/email-settings" && call.method === "PUT") {
          putBody = call.body;
          return json(200, { source: "app", fromAddress: "Acme <legal@acme.example>" });
        }
        return undefined;
      }),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToEmailStep(user);

    await user.type(
      screen.getByLabelText("SMTP relay URL"),
      "smtp://mailer:pass@relay.acme.example:587",
    );
    await user.type(screen.getByLabelText("From address"), "Acme <legal@acme.example>");
    await user.click(screen.getByRole("button", { name: "Save relay" }));

    expect(await screen.findByText(/Relay saved/)).toBeInTheDocument();
    expect(putBody).toEqual({
      smtpUrl: "smtp://mailer:pass@relay.acme.example:587",
      smtpFrom: "Acme <legal@acme.example>",
    });
    expect(screen.getByText(/Outbound email is set in the app/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send test email" })).toBeInTheDocument();
  });

  it("surfaces a save failure's plain-language reason", async () => {
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false, emailConfigured: false },
      emailSettings: { source: "unset", fromAddress: null },
      extra: emailWizardExtra((call) => {
        if (call.url.pathname === "/api/v1/email-settings" && call.method === "PUT") {
          return problem(400, "The relay URL must start with smtp:// or smtps://.");
        }
        return undefined;
      }),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToEmailStep(user);

    await user.type(screen.getByLabelText("SMTP relay URL"), "http://relay.acme.example");
    await user.type(screen.getByLabelText("From address"), "Acme <legal@acme.example>");
    await user.click(screen.getByRole("button", { name: "Save relay" }));

    expect(
      await screen.findByText("The relay URL must start with smtp:// or smtps://."),
    ).toBeInTheDocument();
  });

  it("sends a test email from the app-configured state and reports the recipient", async () => {
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false, emailConfigured: true },
      emailSettings: { source: "app", fromAddress: "Acme <legal@acme.example>" },
      extra: emailWizardExtra((call) => {
        if (call.url.pathname === "/api/v1/email-settings/test" && call.method === "POST") {
          return json(200, { delivered: true, to: ADMIN.email });
        }
        return undefined;
      }),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToEmailStep(user);

    await user.click(screen.getByRole("button", { name: "Send test email" }));
    expect(await screen.findByText(/Test email sent to admin@example.com/)).toBeInTheDocument();
  });

  it("clears the app-saved relay back to unconfigured", async () => {
    let putBody: unknown;
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false, emailConfigured: true },
      emailSettings: { source: "app", fromAddress: "Acme <legal@acme.example>" },
      extra: emailWizardExtra((call) => {
        if (call.url.pathname === "/api/v1/email-settings" && call.method === "PUT") {
          putBody = call.body;
          return json(200, { source: "unset", fromAddress: null });
        }
        return undefined;
      }),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToEmailStep(user);

    await user.click(screen.getByRole("button", { name: "Clear relay" }));
    expect(await screen.findByText(/Relay cleared/)).toBeInTheDocument();
    expect(putBody).toEqual({ smtpUrl: null, smtpFrom: null });
    // Back on the setup form, warned that mail cannot be delivered.
    expect(screen.getByText(/Outbound email is not set up/)).toBeInTheDocument();
    expect(screen.getByLabelText("SMTP relay URL")).toBeInTheDocument();
  });
});
