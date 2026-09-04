// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The SET-004 wizard's guard and its steps: an un-onboarded
 * Administrator is routed in from home, non-admins and completed
 * instances never see it, and each step saves on Continue through the
 * route its own Settings pane uses: the organization's identity through
 * the General pane's route (#697), the allowlist through the portal's,
 * the DocuSign connector through the Integrations pane's (#698).
 */

import { describe, expect, it, vi } from "vitest";
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

/** Clicks on to the last step. Email and invites pass through
 * unchanged, so neither sends a request. */
async function goToESignatureStep(user: ReturnType<typeof userEvent.setup>) {
  await goToEmailStep(user);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("heading", { name: "E-signature" })).toBeInTheDocument();
}

/** What the wizard sent on its last step, and whether it finished. */
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
    // Seven steps now, and this is the one after the splash.
    expect(screen.getByText("Step 2 of 7")).toBeInTheDocument();
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
    expect(screen.getByText("Step 7 of 7")).toBeInTheDocument();
    // The step's fields are one region, named by the step's heading.
    expect(screen.getByRole("region", { name: "E-signature" })).toBeInTheDocument();
    // Optional, and what an install without a connector does instead.
    expect(screen.getByText(/Optional/)).toBeInTheDocument();
    expect(screen.getByText(/manual hand-off stays the path/)).toBeInTheDocument();
    // And where it is finished after the first run.
    expect(
      screen.getByText(/Settings → Organization → Integrations → E-signature/),
    ).toBeInTheDocument();
    // The last step ends the wizard rather than offering another one.
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Finish" }));

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

    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    // Nothing changed, so nothing was rewritten.
    expect(calls.saves).toEqual([]);
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

    await user.clear(screen.getByLabelText("Integration key"));
    await user.type(screen.getByLabelText("Integration key"), "the-new-key");
    await user.click(screen.getByRole("button", { name: "Finish" }));

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
    await user.click(screen.getByRole("button", { name: "Finish" }));

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
    await user.click(screen.getByRole("button", { name: "Finish" }));

    expect(
      await screen.findByText(/Enter the integration key and the user ID/),
    ).toBeInTheDocument();
    expect(calls.saves).toEqual([]);
    expect(calls.completed).toBe(0);
  });
});
