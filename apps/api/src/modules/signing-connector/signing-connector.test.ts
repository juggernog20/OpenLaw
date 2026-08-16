// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The signing connector (CTR-013, TECH-013) at the HTTP seam:
 * Administrator-only, the two secrets write-only in both directions
 * (blank keeps, paste rotates, never read back), a first save refused
 * without the Connect HMAC secret, the webhook URL the pane shows, and
 * the connection test answering both ways.
 *
 * Everything is asserted through responses and by reading `activity_log`
 * directly, as the approvals suites do. Nothing here opens the resolver
 * or the provider — the shared contract suite is what holds those.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, asc, inArray, signingConnectors, type Db } from "@openlaw/db";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";
import { FAKE_VALID_INTEGRATION_KEY } from "../../lib/signing/fake.js";

let harness: TestHarness;
let adminCookies: Record<string, string>;
let staffCookies: Record<string, string>;

const STAFF = {
  email: "nadia@example.com",
  displayName: "Nadia Osei",
  password: "nadia-sets-her-own",
} as const;

/** A private key shaped like the one an Administrator pastes. It is a
 * fixture for a throwaway container and signs nothing real. */
const RSA_KEY = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEAopenlawfixturekeyneverusedanywhereexceptthissuite",
  "-----END RSA PRIVATE KEY-----",
].join("\n"); // NOSONAR — inert fixture, not a credential

const OTHER_RSA_KEY = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEArotatedopenlawfixturekeyneverusedanywhereelseatall",
  "-----END RSA PRIVATE KEY-----",
].join("\n"); // NOSONAR — inert fixture, not a credential

const HMAC_SECRET = "connect-hmac-fixture-secret"; // NOSONAR — inert fixture
const ROTATED_HMAC_SECRET = "connect-hmac-fixture-rotated"; // NOSONAR — inert fixture

const URL_BASE = "/api/v1/signing-connectors/docusign";

/** A complete first save, the fake's own accepted integration key. */
const CONNECTOR = {
  environment: "demo",
  integrationKey: FAKE_VALID_INTEGRATION_KEY,
  apiUserId: "99999999-8888-7777-6666-555555555555",
  privateKey: RSA_KEY,
  webhookSecret: HMAC_SECRET,
} as const;

/** The two connector actions, which is the whole namespace. */
const CONNECTOR_ACTIONS = ["signing_connector.configured", "signing_connector.updated"] as const;

/** The connector's own audit rows, oldest first. */
function connectorAuditRows(db: Db) {
  return db
    .select()
    .from(activityLog)
    .where(inArray(activityLog.action, [...CONNECTOR_ACTIONS]))
    .orderBy(asc(activityLog.createdAt));
}

/** Saves a connector as the Administrator and requires it to land. */
async function save(payload: Record<string, unknown>) {
  return harness.app.inject({
    method: "PUT",
    url: URL_BASE,
    cookies: adminCookies,
    payload,
  });
}

/** Clears the connector and its audit rows between the suites that
 * need a fresh install. The table is org configuration, not a record,
 * so a direct delete is the honest reset. */
async function clearConnector() {
  await harness.db.delete(signingConnectors);
  await harness.db.delete(activityLog).where(inArray(activityLog.action, [...CONNECTOR_ACTIONS]));
}

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);

  const invited = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/invites",
    cookies: adminCookies,
    payload: { email: STAFF.email, displayName: STAFF.displayName, role: "legal_team_member" },
  });
  expect(invited.statusCode, invited.body).toBe(201);
  const token = tokenFrom(harness.mailer.messagesTo(STAFF.email)[0]!.text);
  const reset = await harness.app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    payload: { newPassword: STAFF.password, token },
  });
  expect(reset.statusCode, reset.body).toBe(200);
  staffCookies = await signInCookies(harness.app, STAFF.email, STAFF.password);
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

describe("who may configure the connector (SET-002)", () => {
  it("refuses every operation to an anonymous caller", async () => {
    for (const request of [
      { method: "GET" as const, url: URL_BASE },
      { method: "PUT" as const, url: URL_BASE, payload: CONNECTOR },
      { method: "POST" as const, url: `${URL_BASE}/test` },
    ]) {
      const res = await harness.app.inject(request);
      expect(res.statusCode, `${request.method} anonymous`).toBe(401);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    }
  });

  it("refuses every operation to a Legal Team Member", async () => {
    for (const request of [
      { method: "GET" as const, url: URL_BASE },
      { method: "PUT" as const, url: URL_BASE, payload: CONNECTOR },
      { method: "POST" as const, url: `${URL_BASE}/test` },
    ]) {
      const res = await harness.app.inject({ ...request, cookies: staffCookies });
      expect(res.statusCode, `${request.method} member`).toBe(403);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    }
  });

  it("does not know an adapter that has no driver", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/api/v1/signing-connectors/adobe-sign",
      cookies: adminCookies,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("an install with no connector", () => {
  beforeAll(clearConnector);

  it("reads as unconfigured rather than as missing", async () => {
    const res = await harness.app.inject({ method: "GET", url: URL_BASE, cookies: adminCookies });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().connector).toMatchObject({
      provider: "docusign",
      configured: false,
      environment: null,
      integrationKey: null,
      apiUserId: null,
      hasPrivateKey: false,
      hasWebhookSecret: false,
      updatedAt: null,
    });
  });

  it("shows the webhook URL before anything is configured", async () => {
    const res = await harness.app.inject({ method: "GET", url: URL_BASE, cookies: adminCookies });
    expect(res.json().connector.webhookUrl).toBe(
      "http://localhost/api/v1/signing/docusign/webhook",
    );
  });

  it("refuses a connection test — there is nothing to test with", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: `${URL_BASE}/test`,
      cookies: adminCookies,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain("No e-signature connector is configured");
  });

  it("refuses a first save with no Connect HMAC secret", async () => {
    const res = await save({ ...CONNECTOR, webhookSecret: "" });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("Connect HMAC secret");
    const [row] = await harness.db.select().from(signingConnectors).limit(1);
    expect(row, "a refused save must leave nothing behind").toBeUndefined();
  });

  it("refuses a first save with no RSA private key", async () => {
    const res = await save({ ...CONNECTOR, privateKey: "   " });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().detail).toContain("RSA private key");
  });

  it("writes no audit entry for a refused save", async () => {
    await expect(connectorAuditRows(harness.db)).resolves.toEqual([]);
  });
});

describe("configuring and rotating the connector", () => {
  beforeAll(clearConnector);

  it("saves the connector and answers its state without the secrets", async () => {
    const res = await save(CONNECTOR);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().connector).toMatchObject({
      provider: "docusign",
      configured: true,
      environment: "demo",
      integrationKey: FAKE_VALID_INTEGRATION_KEY,
      apiUserId: CONNECTOR.apiUserId,
      hasPrivateKey: true,
      hasWebhookSecret: true,
    });
    expect(res.body).not.toContain(RSA_KEY);
    expect(res.body).not.toContain(HMAC_SECRET);
  });

  it("never reads either secret back", async () => {
    const res = await harness.app.inject({ method: "GET", url: URL_BASE, cookies: adminCookies });
    expect(res.body).not.toContain(RSA_KEY);
    expect(res.body).not.toContain(HMAC_SECRET);
    expect(res.body).not.toContain("privateKey");
    expect(res.body).not.toContain("webhookSecret");
  });

  it("keeps both stored secrets when the fields come back blank", async () => {
    const res = await save({
      environment: "production",
      integrationKey: FAKE_VALID_INTEGRATION_KEY,
      apiUserId: CONNECTOR.apiUserId,
      privateKey: "",
      webhookSecret: "",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().connector.environment).toBe("production");
    const [row] = await harness.db.select().from(signingConnectors).limit(1);
    expect(row?.privateKey).toBe(RSA_KEY);
    expect(row?.webhookSecret).toBe(HMAC_SECRET);
  });

  it("keeps both stored secrets when the fields are omitted entirely", async () => {
    const res = await save({
      environment: "demo",
      integrationKey: FAKE_VALID_INTEGRATION_KEY,
      apiUserId: CONNECTOR.apiUserId,
    });
    expect(res.statusCode, res.body).toBe(200);
    const [row] = await harness.db.select().from(signingConnectors).limit(1);
    expect(row?.privateKey).toBe(RSA_KEY);
    expect(row?.webhookSecret).toBe(HMAC_SECRET);
  });

  it("rotates a pasted secret and leaves the other one alone", async () => {
    const res = await save({
      environment: "demo",
      integrationKey: FAKE_VALID_INTEGRATION_KEY,
      apiUserId: CONNECTOR.apiUserId,
      privateKey: OTHER_RSA_KEY,
    });
    expect(res.statusCode, res.body).toBe(200);
    const [row] = await harness.db.select().from(signingConnectors).limit(1);
    expect(row?.privateKey).toBe(OTHER_RSA_KEY);
    expect(row?.webhookSecret).toBe(HMAC_SECRET);
  });

  it("rotates the Connect secret when that one is pasted", async () => {
    const res = await save({
      environment: "demo",
      integrationKey: FAKE_VALID_INTEGRATION_KEY,
      apiUserId: CONNECTOR.apiUserId,
      webhookSecret: ROTATED_HMAC_SECRET,
    });
    expect(res.statusCode, res.body).toBe(200);
    const [row] = await harness.db.select().from(signingConnectors).limit(1);
    expect(row?.webhookSecret).toBe(ROTATED_HMAC_SECRET);
    expect(row?.privateKey).toBe(OTHER_RSA_KEY);
  });

  it("keeps one connector row per adapter, however many saves land", async () => {
    const rows = await harness.db.select().from(signingConnectors);
    expect(rows).toHaveLength(1);
  });

  it("refuses an estate it does not have hosts for", async () => {
    const res = await save({ ...CONNECTOR, environment: "staging" });
    expect(res.statusCode).toBe(400);
  });
});

describe("what the audit log says (DD-017)", () => {
  beforeAll(clearConnector);

  it("records the first configuration without any credential in it", async () => {
    expect((await save(CONNECTOR)).statusCode).toBe(200);
    const rows = await connectorAuditRows(harness.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: "system",
      action: "signing_connector.configured",
      visibility: "admin_only",
    });
    expect(rows[0]!.payload).toEqual({
      provider: "docusign",
      environment: "demo",
      integrationKey: FAKE_VALID_INTEGRATION_KEY,
    });
    expect(JSON.stringify(rows[0]!.payload)).not.toContain(RSA_KEY);
    expect(JSON.stringify(rows[0]!.payload)).not.toContain(HMAC_SECRET);
  });

  it("records one entry per changed field, redacting each rotated secret", async () => {
    expect(
      (
        await save({
          environment: "production",
          integrationKey: "a-new-integration-key",
          apiUserId: CONNECTOR.apiUserId,
          privateKey: OTHER_RSA_KEY,
          webhookSecret: ROTATED_HMAC_SECRET,
        })
      ).statusCode,
    ).toBe(200);
    const rows = (await connectorAuditRows(harness.db)).filter(
      (row) => row.action === "signing_connector.updated",
    );
    expect(rows.map((row) => row.payload)).toEqual([
      { provider: "docusign", field: "environment", old: "demo", new: "production" },
      {
        provider: "docusign",
        field: "integrationKey",
        old: FAKE_VALID_INTEGRATION_KEY,
        new: "a-new-integration-key",
      },
      { provider: "docusign", field: "privateKey", old: "[secret]", new: "[secret]" },
      { provider: "docusign", field: "webhookSecret", old: "[secret]", new: "[secret]" },
    ]);
    const written = JSON.stringify(rows.map((row) => row.payload));
    expect(written).not.toContain(OTHER_RSA_KEY);
    expect(written).not.toContain(ROTATED_HMAC_SECRET);
  });

  it("attributes every entry to the Administrator who made it", async () => {
    const rows = await connectorAuditRows(harness.db);
    expect(rows.every((row) => row.actorId !== null)).toBe(true);
  });

  it("writes nothing when a save changes nothing", async () => {
    const before = (await connectorAuditRows(harness.db)).length;
    expect(
      (
        await save({
          environment: "production",
          integrationKey: "a-new-integration-key",
          apiUserId: CONNECTOR.apiUserId,
        })
      ).statusCode,
    ).toBe(200);
    expect(await connectorAuditRows(harness.db)).toHaveLength(before);
  });
});

describe("the connection test", () => {
  beforeAll(clearConnector);

  it("reports the account the stored credentials reach", async () => {
    expect((await save(CONNECTOR)).statusCode).toBe(200);
    const res = await harness.app.inject({
      method: "POST",
      url: `${URL_BASE}/test`,
      cookies: adminCookies,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ connected: true, accountName: "OpenLaw Fake Account" });
  });

  it("changes nothing — a test is a read", async () => {
    const before = await connectorAuditRows(harness.db);
    await harness.app.inject({
      method: "POST",
      url: `${URL_BASE}/test`,
      cookies: adminCookies,
    });
    expect(await connectorAuditRows(harness.db)).toHaveLength(before.length);
  });

  it("reports a credential the provider refuses, in place and in plain language", async () => {
    await clearConnector();
    expect(
      (await save({ ...CONNECTOR, integrationKey: "a-key-the-provider-never-issued" })).statusCode,
    ).toBe(200);
    const res = await harness.app.inject({
      method: "POST",
      url: `${URL_BASE}/test`,
      cookies: adminCookies,
    });
    expect(res.statusCode).toBe(502);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json().detail).toContain("The connection test failed.");
    expect(res.body).not.toContain(RSA_KEY);
    expect(res.body).not.toContain(HMAC_SECRET);
  });
});
