// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The SET-004 wizard's guard and its steps: an un-onboarded
 * Administrator is routed in from home, non-admins and completed
 * instances never see it, and each step saves on Continue through the
 * route its own Settings pane uses: the organization's identity through
 * the General pane's route (#697), the allowlist through the portal's,
 * the DocuSign connector through the Integrations pane's (#698), and
 * the AI connector through the AI analysis pane's (#699).
 */

import { describe, expect, it, vi } from "vitest";
import type { paths } from "@openlaw/api-client";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Ada Admin",
  role: "administrator",
};

const MEMBER = { ...ADMIN, id: "u2", email: "sam@example.com", role: "legal_team_member" };

/** A one-pixel PNG, small enough to ride a data: URI in a fixture. */
const LOGO_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const LOGO_FILE = new File(
  [Uint8Array.from(atob(LOGO_DATA_URI.split(",")[1]!), (c) => c.charCodeAt(0))],
  "logo.png",
  { type: "image/png" },
);

/** A PNG one byte past the API's ~256 KB cap on the encoded data: URI. */
const OVERSIZED_LOGO_FILE = new File([new Uint8Array(256 * 1024 + 1)], "huge.png", {
  type: "image/png",
});

/** Answers the General pane's route and records what the wizard sent.
 * The same handler shape `settings.test.tsx` uses for that pane. */
function captureGeneral(patches: unknown[]) {
  let general = {
    name: "",
    logo: null as string | null,
    defaultLocale: "en-US",
    defaultTimezone: "UTC",
  };
  return (call: StubCall) => {
    if (call.url.pathname !== "/api/v1/org/general") return undefined;
    if (call.method === "PATCH") {
      patches.push(call.body);
      general = { ...general, ...(call.body as Partial<typeof general>) };
    }
    return json(200, { general });
  };
}

/** Loader answers the wizard needs beyond stubApi's defaults. */
function wizardExtra(domains: string[] = []) {
  return (call: StubCall) => {
    if (call.url.pathname === "/api/v1/auth/allowed-domains" && call.method === "GET") {
      return json(200, { domains });
    }
    if (call.url.pathname === "/api/v1/onboarding/reviewed" && call.method === "POST") {
      return json(200, { completed: false, steps: {} });
    }
    return reviewReads(call);
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

/** Clicks from the welcome card to the email step; the organization,
 * authentication, and portal steps pass through unchanged, so none of
 * them sends a request. */
async function goToEmailStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Get started" }));
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("heading", { name: "Outbound email" })).toBeInTheDocument();
}

/** Clicks on to the E-signature step. Email and invites pass through
 * unchanged, so neither sends a request. */
async function goToESignatureStep(user: ReturnType<typeof userEvent.setup>) {
  await goToEmailStep(user);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("heading", { name: "E-signature" })).toBeInTheDocument();
}

/** Clicks on to AI analysis, leaving the signing connector alone. */
async function goToAiAnalysisStep(user: ReturnType<typeof userEvent.setup>) {
  await goToESignatureStep(user);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("heading", { name: "AI analysis" })).toBeInTheDocument();
}

/** Walks off the E-signature step and out of the wizard, so a signing
 * assertion can still end on home. The AI analysis step follows it and
 * is left untouched, which writes nothing. */
async function finishFromESignature(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await finishFromAiAnalysis(user);
}

/** What the wizard sent on a connector step, and whether it finished. */
interface SigningCalls {
  saves: unknown[];
  completed: number;
}

/** Answers the connector's save and the completion the last step ends
 * on, so a walk to the end never reaches an unstubbed route. */
function signingWizardExtra(calls: SigningCalls, save?: () => Response) {
  return (call: StubCall) => {
    const handled = emailWizardExtra()(call);
    if (handled) return handled;
    if (call.url.pathname === "/api/v1/signing-connectors/docusign" && call.method === "PUT") {
      calls.saves.push(call.body);
      if (save) return save();
      const body = call.body as Record<string, string>;
      return json(200, {
        connector: {
          provider: "docusign",
          configured: true,
          enabled: true,
          disabledAt: null,
          environment: body.environment,
          integrationKey: body.integrationKey,
          apiUserId: body.apiUserId,
          hasPrivateKey: true,
          hasWebhookSecret: true,
          webhookUrl: "http://localhost:3000/api/v1/signing/docusign/webhook",
          updatedAt: "2026-09-05T09:00:00.000Z",
        },
      });
    }
    if (call.url.pathname === "/api/v1/onboarding/complete" && call.method === "POST") {
      calls.completed += 1;
      return json(200, { completed: true, steps: {} });
    }
    // A finished wizard answers as finished, so the navigation home
    // lands on home instead of bouncing back into the flow.
    if (
      call.url.pathname === "/api/v1/onboarding" &&
      call.method === "GET" &&
      calls.completed > 0
    ) {
      return json(200, { completed: true, steps: {} });
    }
    return undefined;
  };
}

describe("welcome wizard guard", () => {
  it("routes an un-onboarded Administrator from home into the wizard", async () => {
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      extra: wizardExtra(),
    });
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Welcome to OpenLaw" })).toBeInTheDocument();
  });

  it("keeps a completed instance on home", async () => {
    stubApi({ signedIn: ADMIN, onboarding: { completed: true } });
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
      onboarding: { completed: false, steps: { email: false } },
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
    // Organization step: nothing entered, so Continue sends nothing.
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    // Authentication step: keep built-in and continue (no API call needed).
    await user.click(screen.getByRole("button", { name: "Continue" }));

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

describe("welcome wizard organization step (#697)", () => {
  it("opens the wizard, ahead of authentication", async () => {
    stubApi({ signedIn: ADMIN, onboarding: { completed: false }, extra: wizardExtra() });
    renderAt("/welcome");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Get started" }));
    expect(await screen.findByRole("heading", { name: "Your organization" })).toBeInTheDocument();
    // Nine steps now, and this is the one after the splash.
    expect(screen.getByText("Step 2 of 9")).toBeInTheDocument();
    // The step's fields are one region, named by the step's heading.
    expect(screen.getByRole("region", { name: "Your organization" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Authentication" })).toBeInTheDocument();
  });

  it("saves the name, the logo, and the defaults in one PATCH on Continue", async () => {
    const patches: unknown[] = [];
    const general = captureGeneral(patches);
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      extra: (call) => wizardExtra()(call) ?? general(call),
    });
    renderAt("/welcome");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Get started" }));
    await user.type(await screen.findByLabelText("Organization name"), "Acme Legal");
    // The file input carries its own name; the Upload button drives it.
    await user.upload(screen.getByLabelText("Upload a logo"), LOGO_FILE);
    // The preview appearing is what tells an Administrator the file was
    // read, so it is what the test waits on too.
    expect(await screen.findByRole("img", { name: "Organization logo" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Authentication" })).toBeInTheDocument();
    // One request, carrying only what the Administrator changed.
    expect(patches).toEqual([{ name: "Acme Legal", logo: LOGO_DATA_URI }]);
  });

  it("puts what the wizard saved on the General pane", async () => {
    const general = captureGeneral([]);
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      extra: (call) => wizardExtra()(call) ?? general(call),
    });
    const { router } = renderAt("/welcome");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Get started" }));
    await user.type(await screen.findByLabelText("Organization name"), "Acme Legal");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Authentication" })).toBeInTheDocument();

    // Same row, same route: Settings → Organization → General holds it.
    await router.navigate("/settings/general");
    expect(await screen.findByDisplayValue("Acme Legal")).toBeInTheDocument();
  });

  it("skips without writing anything", async () => {
    const patches: unknown[] = [];
    const general = captureGeneral(patches);
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      extra: (call) => wizardExtra()(call) ?? general(call),
    });
    renderAt("/welcome");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Get started" }));
    await user.type(await screen.findByLabelText("Organization name"), "Acme Legal");
    await user.click(screen.getByRole("button", { name: "Set up later" }));

    expect(await screen.findByRole("heading", { name: "Authentication" })).toBeInTheDocument();
    expect(patches).toEqual([]);
  });

  it("surfaces a save failure's plain-language reason", async () => {
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      extra: (call) => {
        const fromLoader = wizardExtra()(call);
        if (fromLoader) return fromLoader;
        if (call.url.pathname === "/api/v1/org/general" && call.method === "PATCH") {
          return problem(400, "The organization name cannot be blank.");
        }
        return undefined;
      },
    });
    renderAt("/welcome");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Get started" }));
    await user.type(await screen.findByLabelText("Organization name"), "Acme Legal");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("The organization name cannot be blank.")).toBeInTheDocument();
    // Refused, so the wizard stays put rather than moving on.
    expect(screen.getByRole("heading", { name: "Your organization" })).toBeInTheDocument();
  });

  it("does not silently discard a cleared existing name", async () => {
    let patch: unknown;
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      orgGeneral: {
        name: "Acme Legal",
        logo: null,
        defaultLocale: "en-US",
        defaultTimezone: "UTC",
      },
      extra: (call) => {
        const fromLoader = wizardExtra()(call);
        if (fromLoader) return fromLoader;
        if (call.url.pathname === "/api/v1/org/general" && call.method === "PATCH") {
          patch = call.body;
          return problem(400, "The organization name cannot be blank.");
        }
        return undefined;
      },
    });
    renderAt("/welcome");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Get started" }));
    await user.clear(await screen.findByLabelText("Organization name"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(patch).toEqual({ name: "" });
    expect(await screen.findByText("The organization name cannot be blank.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your organization" })).toBeInTheDocument();
  });

  it("cannot advance while an accepted logo is still being read", async () => {
    const read = vi
      .spyOn(FileReader.prototype, "readAsDataURL")
      .mockImplementation(() => undefined);
    try {
      stubApi({ signedIn: ADMIN, onboarding: { completed: false }, extra: wizardExtra() });
      renderAt("/welcome");
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: "Get started" }));
      await user.upload(await screen.findByLabelText("Upload a logo"), LOGO_FILE);

      expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Set up later" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
    } finally {
      read.mockRestore();
    }
  });

  it("refuses a logo the API's cap would refuse", async () => {
    stubApi({ signedIn: ADMIN, onboarding: { completed: false }, extra: wizardExtra() });
    renderAt("/welcome");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Get started" }));
    await user.upload(await screen.findByLabelText("Upload a logo"), OVERSIZED_LOGO_FILE);

    expect(await screen.findByText(/under 256 KB/)).toBeInTheDocument();
  });
});

describe("welcome wizard email step (#37)", () => {
  it("shows an env-pinned relay read-only, naming the variables to change", async () => {
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
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
      onboarding: { completed: false, steps: { email: false } },
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
      onboarding: { completed: false, steps: { email: false } },
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
      onboarding: { completed: false },
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
      onboarding: { completed: false },
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

describe("welcome wizard e-signature step (#698)", () => {
  it("comes after invites and says what an install without a connector does", async () => {
    const calls: SigningCalls = { saves: [], completed: 0 };
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      extra: signingWizardExtra(calls),
    });
    renderAt("/welcome");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Get started" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Invite your team" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "E-signature" })).toBeInTheDocument();
    expect(screen.getByText("Step 7 of 9")).toBeInTheDocument();
    // The step's fields are one region, named by the step's heading.
    expect(screen.getByRole("region", { name: "E-signature" })).toBeInTheDocument();
    // Optional, and what an install without a connector does instead.
    expect(screen.getByText(/Optional/)).toBeInTheDocument();
    expect(screen.getByText(/manual hand-off stays the path/)).toBeInTheDocument();
    // And where it is finished after the first run.
    expect(
      screen.getByText(/Settings → Organization → Integrations → E-signature/),
    ).toBeInTheDocument();
    // AI analysis follows, so this step offers another one.
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish" })).not.toBeInTheDocument();
  });

  it("saves the connector through the pane's own route and finishes", async () => {
    const calls: SigningCalls = { saves: [], completed: 0 };
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      extra: signingWizardExtra(calls),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToESignatureStep(user);

    await user.selectOptions(screen.getByLabelText("Environment"), "production");
    await user.type(screen.getByLabelText("Integration key"), "the-integration-key");
    await user.type(screen.getByLabelText("User ID"), "the-user-id");
    await user.type(screen.getByLabelText("RSA private key"), "-----BEGIN RSA PRIVATE KEY-----");
    await user.type(screen.getByLabelText("Connect HMAC secret"), "the-connect-secret");
    await finishFromESignature(user);

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(calls.saves).toEqual([
      {
        environment: "production",
        integrationKey: "the-integration-key",
        apiUserId: "the-user-id",
        privateKey: "-----BEGIN RSA PRIVATE KEY-----",
        webhookSecret: "the-connect-secret",
      },
    ]);
    expect(calls.completed).toBe(1);
  });

  it("renders a configured connector as configured, not as an empty form", async () => {
    const calls: SigningCalls = { saves: [], completed: 0 };
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      signingConnector: {
        environment: "production",
        integrationKey: "the-integration-key",
        apiUserId: "the-user-id",
      },
      extra: signingWizardExtra(calls),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToESignatureStep(user);

    expect(
      screen.getByText(
        /DocuSign is connected in the production environment, as integration key the-integration-key/,
      ),
    ).toBeInTheDocument();
    // No credential is asked for twice.
    expect(screen.queryByLabelText("RSA private key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Connect HMAC secret")).not.toBeInTheDocument();
    // The address to paste into DocuSign Connect is here to be read.
    expect(screen.getByLabelText("Webhook URL")).toHaveValue(
      "http://localhost:3000/api/v1/signing/docusign/webhook",
    );

    await finishFromESignature(user);
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    // Nothing changed, so nothing was rewritten.
    expect(calls.saves).toEqual([]);
  });

  it("does not call a configured connector connected while it is turned off", async () => {
    const calls: SigningCalls = { saves: [], completed: 0 };
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      signingConnector: {
        environment: "production",
        integrationKey: "the-integration-key",
        apiUserId: "the-user-id",
        enabled: false,
        disabledAt: "2026-09-05T09:00:00.000Z",
      },
      extra: signingWizardExtra(calls),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToESignatureStep(user);

    expect(
      screen.getByText(/DocuSign is configured in the production environment/),
    ).toHaveTextContent("sending from records is turned off");
    expect(screen.queryByText(/DocuSign is connected/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("RSA private key")).not.toBeInTheDocument();
  });

  it("rotates the estate without asking for either stored secret again", async () => {
    const calls: SigningCalls = { saves: [], completed: 0 };
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      signingConnector: {
        environment: "demo",
        integrationKey: "the-old-key",
        apiUserId: "the-user-id",
      },
      extra: signingWizardExtra(calls),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToESignatureStep(user);

    await user.click(screen.getByRole("button", { name: "Replace credentials" }));
    // Both secret boxes open blank, and blank keeps what is stored.
    expect(screen.getByLabelText("RSA private key")).toHaveValue("");
    expect(screen.getByLabelText("Connect HMAC secret")).toHaveValue("");
    expect(screen.getAllByText(/Leave blank to keep the current value/)).toHaveLength(2);

    // The way back, so opening the form is not a one-way door.
    await user.click(screen.getByRole("button", { name: "Keep current credentials" }));
    expect(screen.getByText(/DocuSign is connected/)).toBeInTheDocument();
    expect(screen.queryByLabelText("RSA private key")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Replace credentials" }));
    await user.clear(screen.getByLabelText("Integration key"));
    await user.type(screen.getByLabelText("Integration key"), "the-new-key");
    await finishFromESignature(user);

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    // Neither secret is on the wire: the route keeps both.
    expect(calls.saves).toEqual([
      { environment: "demo", integrationKey: "the-new-key", apiUserId: "the-user-id" },
    ]);
  });

  it("skips without touching the connector", async () => {
    const calls: SigningCalls = { saves: [], completed: 0 };
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      extra: signingWizardExtra(calls),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToESignatureStep(user);

    await user.type(screen.getByLabelText("Integration key"), "the-integration-key");
    await user.click(screen.getByRole("button", { name: "Set up later" }));
    // Deferring AI analysis leads to Review.
    expect(await screen.findByRole("heading", { name: "AI analysis" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set up later" }));
    expect(await screen.findByRole("heading", { name: "Review" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set up later" }));

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(calls.saves).toEqual([]);
    expect(calls.completed).toBe(1);
  });

  it("surfaces a save failure's plain-language reason and stays put", async () => {
    const calls: SigningCalls = { saves: [], completed: 0 };
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      extra: signingWizardExtra(calls, () =>
        problem(
          400,
          "Paste the DocuSign Connect HMAC secret. Without it this install would answer unsigned webhook deliveries.",
        ),
      ),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToESignatureStep(user);

    await user.type(screen.getByLabelText("Integration key"), "the-integration-key");
    await user.type(screen.getByLabelText("User ID"), "the-user-id");
    await user.type(screen.getByLabelText("RSA private key"), "-----BEGIN RSA PRIVATE KEY-----");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/Paste the DocuSign Connect HMAC secret/)).toBeInTheDocument();
    // Refused, so the wizard stays on the step and does not finish.
    expect(screen.getByRole("heading", { name: "E-signature" })).toBeInTheDocument();
    expect(calls.completed).toBe(0);
  });

  it("names the two fields the route would refuse in schema language", async () => {
    const calls: SigningCalls = { saves: [], completed: 0 };
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      extra: signingWizardExtra(calls),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToESignatureStep(user);

    // A pasted key with no integration key names what is missing rather
    // than sending a request the schema answers with "invalid".
    await user.type(screen.getByLabelText("RSA private key"), "-----BEGIN RSA PRIVATE KEY-----");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText(/Enter the integration key and the user ID/),
    ).toBeInTheDocument();
    expect(calls.saves).toEqual([]);
    expect(calls.completed).toBe(0);
  });
});

/** What the AI analysis step sent, and whether the wizard finished. */
interface AiCalls {
  saves: unknown[];
  completed: number;
}

/** Answers the AI connector's save and the completion the last step
 * ends on, so a walk to the end never reaches an unstubbed route. */
function aiWizardExtra(calls: AiCalls, save?: () => Response) {
  return (call: StubCall) => {
    const handled = emailWizardExtra()(call);
    if (handled) return handled;
    if (call.url.pathname === "/api/v1/ai-connector" && call.method === "PUT") {
      calls.saves.push(call.body);
      if (save) return save();
      const body = call.body as Record<string, string>;
      return json(200, {
        connector: {
          configured: true,
          enabled: true,
          preset: body.preset,
          protocol: body.protocol ?? "anthropic_messages",
          baseUrl: body.baseUrl ?? "https://api.anthropic.com/v1",
          hasApiKey: true,
          model: body.model,
          disabledAt: null,
          updatedAt: "2026-09-05T09:00:00.000Z",
        },
        presets: [],
      });
    }
    if (call.url.pathname === "/api/v1/onboarding/complete" && call.method === "POST") {
      calls.completed += 1;
      return json(200, { completed: true, steps: {} });
    }
    if (
      call.url.pathname === "/api/v1/onboarding" &&
      call.method === "GET" &&
      calls.completed > 0
    ) {
      return json(200, { completed: true, steps: {} });
    }
    return undefined;
  };
}

describe("welcome wizard AI analysis step (#699)", () => {
  it("comes after e-signature and says what an install without a connector does", async () => {
    const calls: AiCalls = { saves: [], completed: 0 };
    stubApi({ signedIn: ADMIN, onboarding: { completed: false }, extra: aiWizardExtra(calls) });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToESignatureStep(user);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "AI analysis" })).toBeInTheDocument();
    expect(screen.getByText("Step 8 of 9")).toBeInTheDocument();
    // The step's fields are one region, named by the step's heading.
    expect(screen.getByRole("region", { name: "AI analysis" })).toBeInTheDocument();
    // Optional, and what an install without a connector does instead.
    expect(screen.getByText(/Optional/)).toBeInTheDocument();
    expect(screen.getByText(/Contract analysis does not run/)).toHaveTextContent(
      "Every Field you would have got automatically stays manual",
    );
    // And where it is finished after the first run (SET-008).
    expect(screen.getByText(/Settings → Organization → AI analysis/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish" })).not.toBeInTheDocument();
  });

  it("saves the connector through the pane's own route and finishes", async () => {
    const calls: AiCalls = { saves: [], completed: 0 };
    stubApi({ signedIn: ADMIN, onboarding: { completed: false }, extra: aiWizardExtra(calls) });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToAiAnalysisStep(user);

    await user.selectOptions(screen.getByLabelText("Provider"), "openai");
    // Choosing a preset moves the model to that provider's default.
    expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-luna");
    await user.type(screen.getByLabelText("API key"), "the-api-key");
    await finishFromAiAnalysis(user);

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    // A hosted preset fixes its own protocol and host, so neither is
    // on the wire: the server owns both (TECH-012).
    expect(calls.saves).toEqual([
      { preset: "openai", model: "gpt-5.6-luna", apiKey: "the-api-key" },
    ]);
    expect(calls.completed).toBe(1);
  });

  it("sends the endpoint for a preset that has no shared host", async () => {
    const calls: AiCalls = { saves: [], completed: 0 };
    stubApi({ signedIn: ADMIN, onboarding: { completed: false }, extra: aiWizardExtra(calls) });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToAiAnalysisStep(user);

    await user.selectOptions(screen.getByLabelText("Provider"), "azure_openai");
    await user.type(
      screen.getByLabelText("Deployment endpoint"),
      "https://acme.openai.azure.example/v1",
    );
    await user.type(screen.getByLabelText("API key"), "the-api-key");
    await finishFromAiAnalysis(user);

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(calls.saves).toEqual([
      {
        preset: "azure_openai",
        model: "gpt-5.6-luna",
        baseUrl: "https://acme.openai.azure.example/v1",
        apiKey: "the-api-key",
      },
    ]);
  });

  it("names the protocol only for a custom endpoint", async () => {
    const calls: AiCalls = { saves: [], completed: 0 };
    stubApi({ signedIn: ADMIN, onboarding: { completed: false }, extra: aiWizardExtra(calls) });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToAiAnalysisStep(user);

    expect(screen.queryByLabelText("Protocol")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Provider"), "custom");
    await user.selectOptions(screen.getByLabelText("Protocol"), "gemini");
    await user.type(screen.getByLabelText("Base URL"), "https://ai.acme.example/v1");
    await user.type(screen.getByLabelText("Model"), "acme-large");
    await user.type(screen.getByLabelText("API key"), "the-api-key");
    await finishFromAiAnalysis(user);

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(calls.saves).toEqual([
      {
        preset: "custom",
        model: "acme-large",
        protocol: "gemini",
        baseUrl: "https://ai.acme.example/v1",
        apiKey: "the-api-key",
      },
    ]);
  });

  it("renders a configured connector as configured, not as an empty form", async () => {
    const calls: AiCalls = { saves: [], completed: 0 };
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      aiConnector: {
        preset: "anthropic",
        protocol: "anthropic_messages",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-sonnet-5",
      },
      extra: aiWizardExtra(calls),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToAiAnalysisStep(user);

    expect(
      screen.getByText(/Contract analysis runs through Anthropic, on model claude-sonnet-5/),
    ).toBeInTheDocument();
    // The key is write-only, so it is never asked for twice.
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();

    await finishFromAiAnalysis(user);
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    // Nothing changed, so nothing was rewritten.
    expect(calls.saves).toEqual([]);
    expect(calls.completed).toBe(1);
  });

  it("does not call a configured connector running while it is turned off", async () => {
    const calls: AiCalls = { saves: [], completed: 0 };
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      aiConnector: {
        preset: "anthropic",
        protocol: "anthropic_messages",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-sonnet-5",
        enabled: false,
        disabledAt: "2026-09-05T09:00:00.000Z",
      },
      extra: aiWizardExtra(calls),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToAiAnalysisStep(user);

    expect(screen.getByText(/Anthropic is configured on model claude-sonnet-5/)).toHaveTextContent(
      "Every Field stays manual until it is turned back on",
    );
    expect(screen.queryByText(/Contract analysis runs through/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });

  it("rotates the model without asking for the stored key again", async () => {
    const calls: AiCalls = { saves: [], completed: 0 };
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      aiConnector: {
        preset: "anthropic",
        protocol: "anthropic_messages",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-sonnet-5",
      },
      extra: aiWizardExtra(calls),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToAiAnalysisStep(user);

    await user.click(screen.getByRole("button", { name: "Replace credentials" }));
    // The key box opens blank, and blank keeps what is stored.
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.getByText(/Leave blank to keep the current key/)).toBeInTheDocument();

    // The way back, so opening the form is not a one-way door.
    await user.click(screen.getByRole("button", { name: "Keep current credentials" }));
    expect(screen.getByText(/Contract analysis runs through Anthropic/)).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Replace credentials" }));
    await user.clear(screen.getByLabelText("Model"));
    await user.type(screen.getByLabelText("Model"), "claude-opus-5");
    await finishFromAiAnalysis(user);

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    // The key is not on the wire: the route keeps the stored one.
    expect(calls.saves).toEqual([{ preset: "anthropic", model: "claude-opus-5" }]);
  });

  it("skips without touching the connector", async () => {
    const calls: AiCalls = { saves: [], completed: 0 };
    stubApi({ signedIn: ADMIN, onboarding: { completed: false }, extra: aiWizardExtra(calls) });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToAiAnalysisStep(user);

    await user.type(screen.getByLabelText("API key"), "the-api-key");
    await user.click(screen.getByRole("button", { name: "Set up later" }));
    expect(await screen.findByRole("heading", { name: "Review" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set up later" }));

    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(calls.saves).toEqual([]);
    expect(calls.completed).toBe(1);
  });

  it("surfaces a save failure's plain-language reason and stays put", async () => {
    const calls: AiCalls = { saves: [], completed: 0 };
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      extra: aiWizardExtra(calls, () => problem(400, "Paste the API key for this provider.")),
    });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToAiAnalysisStep(user);

    await user.clear(screen.getByLabelText("Model"));
    await user.type(screen.getByLabelText("Model"), "claude-opus-5");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/Paste the API key for this provider/)).toBeInTheDocument();
    // Refused, so the wizard stays on the step and does not finish.
    expect(screen.getByRole("heading", { name: "AI analysis" })).toBeInTheDocument();
    expect(calls.completed).toBe(0);
  });

  it("names the model the route would refuse in schema language", async () => {
    const calls: AiCalls = { saves: [], completed: 0 };
    stubApi({ signedIn: ADMIN, onboarding: { completed: false }, extra: aiWizardExtra(calls) });
    renderAt("/welcome");
    const user = userEvent.setup();
    await goToAiAnalysisStep(user);

    await user.type(screen.getByLabelText("API key"), "the-api-key");
    await user.clear(screen.getByLabelText("Model"));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/Enter the model to analyze with/)).toBeInTheDocument();
    expect(calls.saves).toEqual([]);
    expect(calls.completed).toBe(0);
  });
});

const REVIEW_ROWS = [
  ["Matter types", "/api/v1/matter-types", "matterTypes", "/settings/matters/types"],
  ["Matter statuses", "/api/v1/matter-statuses", "matterStatuses", "/settings/matters/statuses"],
  ["Contract types", "/api/v1/contract-types", "contractTypes", "/settings/contracts/types"],
  [
    "Contract statuses",
    "/api/v1/contract-statuses",
    "contractStatuses",
    "/settings/contracts/statuses",
  ],
  ["Entity types", "/api/v1/entity-types", "entityTypes", "/settings/entities/types"],
  ["Officer roles", "/api/v1/officer-roles", "officerRoles", "/settings/entities/officer-roles"],
  ["Knowledge types", "/api/v1/knowledge/types", "knowledgeTypes", "/settings/knowledge/types"],
  ["Request types", "/api/v1/request-types", "requestTypes", "/settings/intake/request-types"],
  ["Fields", "/api/v1/fields", "fields", "/settings/contracts/fields"],
] as const;

type ReviewPath = (typeof REVIEW_ROWS)[number][1];
type ReviewResponse<P extends ReviewPath> =
  paths[P]["get"]["responses"][200]["content"]["application/json"];
const TYPE_ROW = {
  id: "type-1",
  slug: "other",
  displayName: "Other",
  description: null,
  displayOrder: 1,
  isSystemDefault: true,
  archivedAt: null,
  inUseCount: 0,
} satisfies ReviewResponse<"/api/v1/matter-types">["matterTypes"][number];
const REVIEW_RESPONSES = {
  "/api/v1/matter-types": { matterTypes: [TYPE_ROW] },
  "/api/v1/matter-statuses": { matterStatuses: [{ ...TYPE_ROW, category: "open" }] },
  "/api/v1/contract-types": { contractTypes: [TYPE_ROW] },
  "/api/v1/contract-statuses": { contractStatuses: [{ ...TYPE_ROW, stage: "draft" }] },
  "/api/v1/entity-types": { entityTypes: [TYPE_ROW] },
  "/api/v1/officer-roles": { officerRoles: [TYPE_ROW] },
  "/api/v1/knowledge/types": { knowledgeTypes: [TYPE_ROW] },
  "/api/v1/request-types": {
    requestTypes: [{ ...TYPE_ROW, targetModule: null, targetTypeId: null, formFieldCount: 0 }],
  },
  "/api/v1/fields": {
    fields: [
      {
        ...TYPE_ROW,
        moduleScope: "contract",
        fieldType: "text",
        options: null,
        fieldTag: "business",
        aiPrompt: null,
      },
    ],
  },
} satisfies { [P in ReviewPath]: ReviewResponse<P> };

function reviewReads(call: StubCall) {
  if (call.method !== "GET") return undefined;
  const row = REVIEW_ROWS.find(([, path]) => path === call.url.pathname);
  if (row) {
    const response = REVIEW_RESPONSES[row[1]];
    const rows = Object.values(response)[0]!;
    // Different counts catch crossed wires; custom and archived rows count too.
    return json(200, {
      [row[2]]: Array.from({ length: REVIEW_ROWS.indexOf(row) }, (_, index) => ({
        ...rows[0],
        id: `row-${index}`,
        isSystemDefault: false,
        archivedAt: "2026-09-05T09:00:00.000Z",
      })),
    });
  }
  if (call.url.pathname === "/api/v1/org/reminder-offsets") {
    return json(200, {
      offsets: [7, 1, 0],
    } satisfies paths["/api/v1/org/reminder-offsets"]["get"]["responses"]["200"]["content"]["application/json"]);
  }
  return undefined;
}

async function goToReviewStep(user: ReturnType<typeof userEvent.setup>) {
  await goToAiAnalysisStep(user);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("heading", { name: "Review" })).toBeInTheDocument();
}

async function finishFromAiAnalysis(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(await screen.findByRole("button", { name: "Finish" }));
}

describe("welcome wizard Review step (#700)", () => {
  function setup(handler?: (call: StubCall) => Response | undefined) {
    const writes: string[] = [];
    const reads: StubCall[] = [];
    let completed = false;
    stubApi({
      signedIn: ADMIN,
      onboarding: { completed: false },
      extra: emailWizardExtra((call) => {
        if (call.method === "GET") reads.push(call);
        else if (call.url.pathname.startsWith("/api/v1/onboarding/"))
          writes.push(call.url.pathname);
        const handled = handler?.(call);
        if (handled) return handled;
        if (call.url.pathname === "/api/v1/onboarding/complete" && call.method === "POST") {
          completed = true;
          return json(200, { completed, steps: {} });
        }
        if (call.url.pathname === "/api/v1/onboarding" && completed)
          return json(200, { completed, steps: {} });
        return undefined;
      }),
    });
    renderAt("/welcome");
    return { writes, reads, user: userEvent.setup() };
  }

  it("is last after AI analysis, names its region, and links all ten current counts without editors", async () => {
    const { user, writes, reads } = setup();
    await goToReviewStep(user);
    expect(screen.getByText("Step 9 of 9")).toBeInTheDocument();
    const review = within(screen.getByRole("region", { name: "Review" }));
    expect(review.getAllByRole("link")).toHaveLength(10);
    for (const [index, [label, path, , address]] of REVIEW_ROWS.entries()) {
      const link = review.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", address);
      expect(
        within(link.closest("tr")!).getByRole("cell", { name: String(index) }),
      ).toBeInTheDocument();
      expect(
        reads.find((call) => call.url.pathname === path)?.url.searchParams.get("includeArchived"),
      ).toBe("true");
    }
    expect(review.getByRole("link", { name: "Reminder offsets" })).toHaveAttribute(
      "href",
      "/settings/reminders",
    );
    for (const text of ["7 days before", "1 day before", "On the day"])
      expect(review.getByText(text, { exact: false })).toBeInTheDocument();
    expect(review.getByText(/Settings → Organization → Notifications/)).toBeInTheDocument();
    expect(review.queryByRole("textbox")).not.toBeInTheDocument();
    expect(review.queryByRole("button")).not.toBeInTheDocument();
    expect(writes).toEqual([]);
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "AI analysis" })).toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it("marks reviewed before completing on Finish", async () => {
    const { user, writes } = setup();
    await goToReviewStep(user);
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(writes).toEqual(["/api/v1/onboarding/reviewed", "/api/v1/onboarding/complete"]);
  });

  it("completes without a review mark on Set up later", async () => {
    const { user, writes } = setup();
    await goToReviewStep(user);
    await user.click(screen.getByRole("button", { name: "Set up later" }));
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(writes).toEqual(["/api/v1/onboarding/complete"]);
  });

  it("stays on Review and does not complete if marking fails, then permits retry", async () => {
    let fail = true;
    const { user, writes } = setup((call) =>
      call.url.pathname === "/api/v1/onboarding/reviewed" && fail
        ? problem(503, "Review could not be saved. Try again.")
        : undefined,
    );
    await goToReviewStep(user);
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Review could not be saved. Try again.",
    );
    expect(screen.getByRole("region", { name: "Review" })).toBeInTheDocument();
    expect(writes).toEqual(["/api/v1/onboarding/reviewed"]);
    fail = false;
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
  });

  it("stays on Review if completion fails and retries both idempotent marks", async () => {
    let fail = true;
    const { user, writes } = setup((call) =>
      call.url.pathname === "/api/v1/onboarding/complete" && fail
        ? problem(503, "Unavailable")
        : undefined,
    );
    await goToReviewStep(user);
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Onboarding could not be marked finished",
    );
    expect(screen.getByRole("region", { name: "Review" })).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(writes).toEqual([
      "/api/v1/onboarding/reviewed",
      "/api/v1/onboarding/complete",
      "/api/v1/onboarding/reviewed",
      "/api/v1/onboarding/complete",
    ]);
  });

  it("refuses a failed list read instead of showing an invented zero", async () => {
    setup((call) =>
      call.url.pathname === "/api/v1/matter-types" ? problem(503, "Unavailable") : undefined,
    );
    expect(
      await screen.findByRole("heading", { name: "Something went wrong." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Get started" })).not.toBeInTheDocument();
  });
});
