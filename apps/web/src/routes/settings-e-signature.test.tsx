// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Integrations · E-signature (#245) at the route seam:
 * the Administrator-only bounce, the rail entry, the write-only secret
 * round trip (blank keeps, paste rotates), the read-only webhook URL,
 * and the Test connection button answering both ways.
 *
 * The API behaviours themselves, the refusals, the audit entries, and
 * the stored secrets, are covered at the HTTP seam in apps/api. These
 * stubs only shape what this pane must react to.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  SIGNING_CONSENT_REQUIRED_PROBLEM_TYPE,
  SIGNING_CREDENTIALS_REFUSED_PROBLEM_TYPE,
} from "@openlaw/shared";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "devon@example.com",
  displayName: "Devon Calloway",
  role: "administrator",
  theme: "light",
};

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
  theme: "light",
};

const WEBHOOK_URL = "http://localhost:3000/api/v1/signing/docusign/webhook";

/** The connector as the API answers it. It never carries either secret. */
function connector(overrides: Record<string, unknown> = {}) {
  return {
    provider: "docusign",
    configured: true,
    updateMode: "webhook",
    webhookUrlOverride: null,
    environment: "demo",
    integrationKey: "the-integration-key",
    apiUserId: "the-user-id",
    hasPrivateKey: true,
    hasWebhookSecret: true,
    enabled: true,
    disabledAt: null,
    webhookUrl: WEBHOOK_URL,
    updatedAt: "2026-08-16T09:00:00.000Z",
    ...overrides,
  };
}

/** An install that has never been connected. */
function unconfigured() {
  return connector({
    configured: false,
    updateMode: "polling",
    environment: null,
    integrationKey: null,
    apiUserId: null,
    hasPrivateKey: false,
    hasWebhookSecret: false,
    updatedAt: null,
  });
}

interface ConnectorCalls {
  saves: unknown[];
  tests: number;
}

/** Answers the pane's endpoints statefully and captures its writes. */
function connectorApi(
  state: {
    connector?: ReturnType<typeof connector>;
    /** What POST …/test answers; a Response means the refusal path. */
    test?: Response | (() => Response);
  },
  calls: ConnectorCalls,
) {
  let stored = state.connector ?? connector();
  return (call: StubCall) => {
    const path = call.url.pathname;
    if (path === "/api/v1/signing-connectors/docusign") {
      if (call.method === "PUT") {
        calls.saves.push(call.body);
        const body = call.body as Record<string, string>;
        stored = connector({
          configured: true,
          updateMode: body.updateMode,
          webhookUrlOverride: body.webhookUrl ?? null,
          webhookUrl: body.webhookUrl || WEBHOOK_URL,
          environment: body.environment,
          integrationKey: body.integrationKey,
          apiUserId: body.apiUserId,
          hasPrivateKey: stored.hasPrivateKey || body.privateKey !== undefined,
          hasWebhookSecret: stored.hasWebhookSecret || body.webhookSecret !== undefined,
          // Saving credentials is not turning the connector back on.
          // The defaults would say enabled, and the header chip would
          // then read Connected on an install that is turned off.
          enabled: stored.enabled,
          disabledAt: stored.disabledAt,
        });
      }
      return json(200, { connector: stored });
    }
    if (path === "/api/v1/signing-connectors/docusign/test" && call.method === "POST") {
      calls.tests += 1;
      if (typeof state.test === "function") return state.test();
      return (
        state.test ??
        json(200, {
          connected: true,
          accountName: "Acme Inc",
          accountId: "acct-1",
          userEmail: "integration@acme.example",
        })
      );
    }
    return undefined;
  };
}

function newCalls(): ConnectorCalls {
  return { saves: [], tests: 0 };
}

/**
 * Opens the DocuSign card.
 *
 * Every Integrations card starts closed (DES-054 amendment), connector
 * or no connector, so every test about the form has to open it first.
 */
async function openDocusign(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "DocuSign", expanded: false }));
}

describe("the E-signature pane (#245)", () => {
  it("bounces a non-Administrator to their settings home", async () => {
    stubApi({ signedIn: MEMBER });
    renderAt("/settings/integrations/e-signature");

    expect(await screen.findByLabelText("Full name")).toBeVisible();
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).queryByText("Integrations")).not.toBeInTheDocument();
  });

  it("marks the Integrations rail entry current for an Administrator", async () => {
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, newCalls()) });
    renderAt("/settings/integrations/e-signature");

    const rail = await screen.findByRole("navigation", { name: "Settings sections" });
    expect(within(rail).getByRole("link", { name: "Integrations" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("forwards the bare section URL to the E-signature pane", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, newCalls()) });
    renderAt("/settings/integrations");

    await openDocusign(user);
    expect(await screen.findByLabelText("Integration key")).toHaveValue("the-integration-key");
  });

  it("keeps the card closed, and says it is connected on the header", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, newCalls()) });
    renderAt("/settings/integrations/e-signature");

    // The credentials are set and there is nothing to do, so the card
    // shows its name and its state and holds the rest back.
    expect(await screen.findByText("Connected")).toBeVisible();
    expect(screen.queryByLabelText("Integration key")).not.toBeInTheDocument();

    await openDocusign(user);
    expect(await screen.findByLabelText("Integration key")).toBeVisible();
  });

  it("says a stored connector is turned off when it is", async () => {
    stubApi({
      signedIn: ADMIN,
      extra: connectorApi(
        { connector: connector({ enabled: false, disabledAt: "2026-08-17T09:00:00.000Z" }) },
        newCalls(),
      ),
    });
    renderAt("/settings/integrations/e-signature");

    expect(await screen.findByText("Turned off")).toBeVisible();
  });

  it("starts closed when nothing is connected yet, and says so on the header", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: connectorApi({ connector: unconfigured() }, newCalls()) });
    renderAt("/settings/integrations/e-signature");

    // The card holds its form back either way: the pane is a list of
    // integrations and their states, and the chip carries the state.
    expect(await screen.findByText("Not connected")).toBeVisible();
    expect(screen.queryByLabelText("Integration key")).not.toBeInTheDocument();

    await openDocusign(user);
    expect(await screen.findByLabelText("Integration key")).toBeVisible();
  });

  it("shows the stored configuration with both secret fields blank", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, newCalls()) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    expect(await screen.findByLabelText("Integration key")).toHaveValue("the-integration-key");
    expect(screen.getByLabelText("User ID")).toHaveValue("the-user-id");
    expect(screen.getByLabelText("Environment")).toHaveValue("demo");
    // Write-only: the pane never received either secret, so it shows
    // neither, and it says what blank means.
    expect(screen.getByLabelText("RSA private key")).toHaveValue("");
    expect(screen.getByLabelText("Connect HMAC secret")).toHaveValue("");
    expect(
      screen.getAllByText("Leave blank to keep the current value. Paste a new one to rotate."),
    ).toHaveLength(2);
  });

  it("shows the webhook URL read-only, to paste into DocuSign Connect", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, newCalls()) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    const field = await screen.findByLabelText("Webhook URL");
    expect(field).toHaveValue(WEBHOOK_URL);
    expect(field).toHaveAttribute("readonly");
  });

  it("sends neither secret when both fields are left blank", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, calls) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    await user.selectOptions(await screen.findByLabelText("Environment"), "production");
    await user.click(screen.getByRole("button", { name: "Save connector" }));

    await waitFor(() =>
      expect(calls.saves).toEqual([
        {
          environment: "production",
          updateMode: "webhook",
          webhookUrl: null,
          integrationKey: "the-integration-key",
          apiUserId: "the-user-id",
        },
      ]),
    );
    expect(await screen.findByText("Saved")).toBeVisible();
  });

  it("sends a pasted secret and clears the field once it lands", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, calls) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    await user.type(await screen.findByLabelText("Connect HMAC secret"), "rotated-secret");
    await user.click(screen.getByRole("button", { name: "Save connector" }));

    await waitFor(() =>
      expect(calls.saves).toEqual([
        {
          environment: "demo",
          updateMode: "webhook",
          webhookUrl: null,
          integrationKey: "the-integration-key",
          apiUserId: "the-user-id",
          webhookSecret: "rotated-secret",
        },
      ]),
    );
    // The field goes back to blank, which is the only honest state: the
    // pane cannot read the stored value back.
    expect(screen.getByLabelText("Connect HMAC secret")).toHaveValue("");
  });

  it("defaults to polling and requires the Connect secret only after choosing webhook", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: connectorApi({ connector: unconfigured() }, newCalls()) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    expect(await screen.findByLabelText("RSA private key")).toBeRequired();
    expect(screen.getByLabelText("Signing updates")).toHaveValue("polling");
    expect(screen.queryByLabelText("Connect HMAC secret")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Public callback URL")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Signing updates"), "webhook");
    expect(screen.getByLabelText("Connect HMAC secret")).toBeRequired();
    expect(
      screen.getByText(
        "Required. OpenLaw checks it on every delivery, so nothing unsigned can change a record.",
      ),
    ).not.toBeVisible();
  });

  it("saves polling without a Connect secret and hides webhook setup", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: connectorApi({ connector: unconfigured() }, calls) });
    renderAt("/settings/integrations/e-signature");
    await openDocusign(user);
    await user.type(screen.getByLabelText("Integration key"), "key");
    await user.type(screen.getByLabelText("User ID"), "user");
    await user.type(screen.getByLabelText("RSA private key"), "fixture-key");
    await user.click(screen.getByRole("button", { name: "Save connector" }));
    await waitFor(() =>
      expect(calls.saves).toEqual([
        {
          environment: "demo",
          integrationKey: "key",
          apiUserId: "user",
          privateKey: "fixture-key",
          updateMode: "polling",
          webhookUrl: null,
        },
      ]),
    );
    expect(await screen.findByText("Saved")).toBeVisible();
    expect(screen.queryByLabelText("Webhook URL")).not.toBeInTheDocument();
  });

  it("saves a separate public callback and switches back without erasing credentials", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, calls) });
    renderAt("/settings/integrations/e-signature");
    await openDocusign(user);
    await user.type(
      screen.getByLabelText("Public callback URL"),
      "https://gateway.example/signing",
    );
    await user.click(screen.getByRole("button", { name: "Save connector" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Webhook URL")).toHaveValue("https://gateway.example/signing"),
    );
    await user.selectOptions(screen.getByLabelText("Signing updates"), "polling");
    await user.click(screen.getByRole("button", { name: "Save connector" }));
    await waitFor(() => expect(screen.queryByLabelText("Webhook URL")).not.toBeInTheDocument());
    expect(calls.saves.at(-1)).toEqual({
      environment: "demo",
      integrationKey: "the-integration-key",
      apiUserId: "the-user-id",
      updateMode: "polling",
      webhookUrl: "https://gateway.example/signing",
    });
    expect(screen.getByLabelText("RSA private key")).not.toBeRequired();
  });

  it("sends the stored callback, not a half-typed one, when Polling hides the box", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, calls) });
    renderAt("/settings/integrations/e-signature");
    await openDocusign(user);

    // A stored address to fall back to.
    await user.type(
      screen.getByLabelText("Public callback URL"),
      "https://gateway.example/signing",
    );
    await user.click(screen.getByRole("button", { name: "Save connector" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Webhook URL")).toHaveValue("https://gateway.example/signing"),
    );

    // The Administrator starts a second address, forgets the scheme, and
    // changes the mode instead of finishing it. Polling does not draw the
    // box, so the half-typed value has no way back on screen.
    await user.clear(screen.getByLabelText("Public callback URL"));
    await user.type(screen.getByLabelText("Public callback URL"), "gateway.example/signing");
    await user.selectOptions(screen.getByLabelText("Signing updates"), "polling");
    expect(screen.queryByLabelText("Public callback URL")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save connector" }));
    // The save carries the stored address, which the API accepts. Sending
    // the half-typed one would come back refused, naming a field the pane
    // is no longer showing.
    await waitFor(() => expect(screen.getByText("Saved")).toBeVisible());
    expect(calls.saves.at(-1)).toEqual({
      environment: "demo",
      integrationKey: "the-integration-key",
      apiUserId: "the-user-id",
      updateMode: "polling",
      webhookUrl: "https://gateway.example/signing",
    });
    // Not sent is not the same as thrown away. Webhook draws the box
    // again with the half-typed address in it, where the Administrator
    // can finish it and where a refusal would name a field they can see.
    await user.selectOptions(screen.getByLabelText("Signing updates"), "webhook");
    expect(screen.getByLabelText("Public callback URL")).toHaveValue("gateway.example/signing");
  });

  it("offers no connection test until something is configured", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: connectorApi({ connector: unconfigured() }, newCalls()) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    expect(await screen.findByRole("button", { name: "Test connection" })).toBeDisabled();
  });

  it("names the account a successful test reached", async () => {
    const user = userEvent.setup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, calls) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    await user.click(await screen.findByRole("button", { name: "Test connection" }));

    expect(await screen.findByText("Connected to Acme Inc.")).toBeVisible();
    expect(calls.tests).toBe(1);
  });

  it("reports a failed test in place, in the API's own words", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: ADMIN,
      extra: connectorApi(
        {
          test: () =>
            problem(
              502,
              "The connection test failed. DocuSign refused the connector's credentials.",
            ),
        },
        newCalls(),
      ),
    });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    await user.click(await screen.findByRole("button", { name: "Test connection" }));

    expect(
      await screen.findByText(
        "The connection test failed. DocuSign refused the connector's credentials.",
      ),
    ).toBeVisible();
  });

  it("drops a stale test result when the credentials are saved again", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, newCalls()) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    await user.click(await screen.findByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected to Acme Inc.")).toBeVisible();

    await user.type(screen.getByLabelText("Integration key"), "-2");
    await user.click(screen.getByRole("button", { name: "Save connector" }));

    await waitFor(() =>
      expect(screen.queryByText("Connected to Acme Inc.")).not.toBeInTheDocument(),
    );
  });

  it("reports a refused save in place", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: ADMIN,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/v1/signing-connectors/docusign" && call.method === "PUT") {
          return problem(400, "Paste the DocuSign Connect HMAC secret.");
        }
        return connectorApi({ connector: unconfigured() }, newCalls())(call);
      },
    });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    await user.type(await screen.findByLabelText("Integration key"), "a-key");
    await user.type(screen.getByLabelText("User ID"), "a-user");
    await user.type(screen.getByLabelText("RSA private key"), "-----BEGIN RSA PRIVATE KEY-----");
    await user.selectOptions(screen.getByLabelText("Signing updates"), "webhook");
    await user.type(screen.getByLabelText("Connect HMAC secret"), "a-secret");
    await user.click(screen.getByRole("button", { name: "Save connector" }));

    expect(await screen.findByText("Paste the DocuSign Connect HMAC secret.")).toBeVisible();
  });
});

/**
 * The consent step (#1236). DocuSign's side is out of reach here, so
 * the popup is a spy on `window.open`, and the callback page's answer is
 * posted on the same channel the real page uses.
 */
describe("the consent step (#1236)", () => {
  const CONSENT_PATH = "/settings/integrations/e-signature/docusign-consent";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Spies on the popup and hands back the URLs it was opened with. */
  function spyPopup() {
    const opened: URL[] = [];
    vi.spyOn(window, "open").mockImplementation((url) => {
      opened.push(new URL(String(url)));
      return null;
    });
    return opened;
  }

  /** Posts what the callback page would, for the popup's own `state`. */
  function answer(popup: URL, result: Record<string, unknown>) {
    const channel = new BroadcastChannel("openlaw:docusign-consent");
    channel.postMessage({ state: popup.searchParams.get("state"), ...result });
    channel.close();
  }

  it("shows the redirect URI to register, read-only, with a copy button", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, newCalls()) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    const field = await screen.findByLabelText("Consent redirect URI");
    expect(field).toHaveValue(new URL(CONSENT_PATH, window.location.origin).toString());
    expect(field).toHaveAttribute("readonly");
    expect(within(field.parentElement!).getByRole("button", { name: "Copy" })).toBeVisible();
  });

  it("opens DocuSign's consent URL for the environment and the typed integration key", async () => {
    const user = userEvent.setup();
    const opened = spyPopup();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, newCalls()) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    const key = await screen.findByLabelText("Integration key");
    await user.clear(key);
    await user.type(key, "typed-key");
    await user.click(screen.getByRole("button", { name: "Grant consent" }));

    await user.selectOptions(screen.getByLabelText("Environment"), "production");
    await user.click(screen.getByRole("button", { name: "Grant consent" }));

    expect(opened).toHaveLength(2);
    const [demo, production] = opened;
    expect(demo!.origin).toBe("https://account-d.docusign.com");
    expect(production!.origin).toBe("https://account.docusign.com");
    for (const url of opened) {
      expect(url.pathname).toBe("/oauth/auth");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("scope")).toBe("signature impersonation");
      expect(url.search).toContain("scope=signature%20impersonation");
      expect(url.searchParams.get("client_id")).toBe("typed-key");
      expect(url.searchParams.get("redirect_uri")).toBe(
        new URL(CONSENT_PATH, window.location.origin).toString(),
      );
      expect(url.searchParams.get("state")).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it("keeps Grant consent disabled until there is an integration key", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: connectorApi({ connector: unconfigured() }, newCalls()) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    const grant = await screen.findByRole("button", { name: "Grant consent" });
    expect(grant).toBeDisabled();
    await user.type(screen.getByLabelText("Integration key"), "a-key");
    expect(grant).toBeEnabled();
  });

  it("re-runs the connection test once DocuSign grants consent", async () => {
    const user = userEvent.setup();
    const opened = spyPopup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, calls) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    await user.click(await screen.findByRole("button", { name: "Grant consent" }));
    answer(opened[0]!, { outcome: "granted" });

    expect(await screen.findByText("Connected to Acme Inc.")).toBeVisible();
    expect(calls.tests).toBe(1);
  });

  it("ignores an answer for a consent this pane did not ask for", async () => {
    const user = userEvent.setup();
    spyPopup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, calls) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    await user.click(await screen.findByRole("button", { name: "Grant consent" }));
    answer(new URL("https://x.invalid/?state=somebody-else"), { outcome: "granted" });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.tests).toBe(0);
  });

  it("shows DocuSign's refusal rather than swallowing it", async () => {
    const user = userEvent.setup();
    const opened = spyPopup();
    const calls = newCalls();
    stubApi({ signedIn: ADMIN, extra: connectorApi({}, calls) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    await user.click(await screen.findByRole("button", { name: "Grant consent" }));
    answer(opened[0]!, {
      outcome: "refused",
      error: "access_denied",
      description: "The user did not consent.",
    });

    expect(
      await screen.findByText("DocuSign did not grant consent: The user did not consent."),
    ).toBeVisible();
    expect(calls.tests).toBe(0);
  });

  it("offers Grant consent in the message when DocuSign wants consent", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: ADMIN,
      extra: connectorApi(
        {
          test: () =>
            problem(
              502,
              "The connection test failed. The DocuSign user has not given consent to this integration.",
              SIGNING_CONSENT_REQUIRED_PROBLEM_TYPE,
            ),
        },
        newCalls(),
      ),
    });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    expect(await screen.findAllByRole("button", { name: "Grant consent" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Test connection" }));

    expect(await screen.findByText(/has not given consent/)).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Grant consent" })).toHaveLength(2);
  });

  it("offers Grant consent when DocuSign refuses the credentials, but not on an outage", async () => {
    const user = userEvent.setup();
    let answerWith = () =>
      problem(
        502,
        "The connection test failed. DocuSign refused the connector's credentials.",
        SIGNING_CREDENTIALS_REFUSED_PROBLEM_TYPE,
      );
    stubApi({
      signedIn: ADMIN,
      extra: connectorApi({ test: () => answerWith() }, newCalls()),
    });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    await user.click(await screen.findByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/refused the connector's credentials/)).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Grant consent" })).toHaveLength(2);

    answerWith = () =>
      problem(502, "The connection test failed. The provider could not be reached.");
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/could not be reached/)).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Grant consent" })).toHaveLength(1);
  });
});

/** The page DocuSign's consent popup returns to (#1236). */
describe("the consent callback page (#1236)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Listens on the callback page's channel for one answer. */
  function listen() {
    const channel = new BroadcastChannel("openlaw:docusign-consent");
    const received: unknown[] = [];
    channel.onmessage = (event: MessageEvent<unknown>) => received.push(event.data);
    return { received, close: () => channel.close() };
  }

  it("reports a granted consent, drops the code, and closes the popup", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const channel = listen();
    stubApi({});
    const { router } = renderAt(
      "/settings/integrations/e-signature/docusign-consent?code=secret-code&state=s1",
    );

    try {
      expect(await screen.findByRole("heading", { name: "Consent granted" })).toBeVisible();
      await waitFor(() => expect(channel.received).toEqual([{ state: "s1", outcome: "granted" }]));
      expect(close).toHaveBeenCalled();
      await waitFor(() => expect(router.state.location.search).toBe(""));
      expect(JSON.stringify(channel.received)).not.toContain("secret-code");
    } finally {
      channel.close();
    }
  });

  it("shows DocuSign's error, reports it, and stays open", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const channel = listen();
    stubApi({});
    renderAt(
      "/settings/integrations/e-signature/docusign-consent?error=access_denied&error_description=The%20user%20did%20not%20consent.&state=s2",
    );

    try {
      expect(
        await screen.findByRole("heading", { name: "DocuSign did not grant consent" }),
      ).toBeVisible();
      expect(screen.getByRole("alert")).toHaveTextContent("The user did not consent.");
      await waitFor(() =>
        expect(channel.received).toEqual([
          {
            state: "s2",
            outcome: "refused",
            error: "access_denied",
            description: "The user did not consent.",
          },
        ]),
      );
      expect(close).not.toHaveBeenCalled();
    } finally {
      channel.close();
    }
  });
});
