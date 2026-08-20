// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Integrations · E-signature (#245) at the route seam:
 * the Administrator-only bounce, the rail entry, the write-only secret
 * round trip (blank keeps, paste rotates), the read-only webhook URL,
 * and the Test connection button answering both ways.
 *
 * The API behaviours themselves — the refusals, the audit entries, the
 * stored secrets — are covered at the HTTP seam in apps/api. These
 * stubs only shape what this pane must react to.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "blair@example.com",
  displayName: "Blair Wentworth",
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

/** The connector as the API answers it — never carrying either secret. */
function connector(overrides: Record<string, unknown> = {}) {
  return {
    provider: "docusign",
    configured: true,
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
    // neither — and says what blank means.
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

  it("requires both secrets on an install with no connector", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: ADMIN, extra: connectorApi({ connector: unconfigured() }, newCalls()) });
    renderAt("/settings/integrations/e-signature");

    await openDocusign(user);
    expect(await screen.findByLabelText("RSA private key")).toBeRequired();
    expect(screen.getByLabelText("Connect HMAC secret")).toBeRequired();
    expect(
      screen.getByText(
        "Required. OpenLaw checks it on every delivery, so nothing unsigned can change a record.",
      ),
    ).toBeVisible();
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
    await user.type(screen.getByLabelText("Connect HMAC secret"), "a-secret");
    await user.click(screen.getByRole("button", { name: "Save connector" }));

    expect(await screen.findByText("Paste the DocuSign Connect HMAC secret.")).toBeVisible();
  });
});
