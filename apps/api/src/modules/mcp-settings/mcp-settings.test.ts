// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import { LIVE_EVENT_CHANNEL, parseLiveEvent } from "@openlaw/shared";
import type { LightMyRequestResponse } from "fastify";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";
let harness: TestHarness;
let cookies: Record<string, string>;
let staffCookies: Record<string, string>;
beforeAll(async () => {
  harness = await startHarness();
  await harness.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  const staff = {
    email: "advanced-staff@example.com",
    displayName: "Staff",
    password: "only-for-this-test-password",
  };
  await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/invites",
    cookies,
    payload: { email: staff.email, displayName: staff.displayName, role: "legal_team_member" },
  });
  const token = tokenFrom(harness.mailer.messagesTo(staff.email)[0]!.text);
  await harness.app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    payload: { token, newPassword: staff.password },
  });
  staffCookies = await signInCookies(harness.app, staff.email, staff.password);
});
afterAll(async () => {
  await harness?.stop();
});

const url = "/api/v1/mcp-settings";
const auditFields = {
  enabled: "mcpEnabled",
  legalApiKeysEnabled: "mcpLegalApiKeysEnabled",
  businessApiKeysEnabled: "mcpBusinessApiKeysEnabled",
  toolsetCeiling: "mcpToolsetCeiling",
  readOnly: "mcpReadOnly",
  apiKeyLifetimeDays: "mcpApiKeyLifetimeDays",
} as const;
const toolsets = [
  "workspace",
  "contracts",
  "matters",
  "tasks",
  "requests",
  "comments",
  "documents",
  "auto-docs",
  "entities",
  "knowledge",
  "people",
];
function expectProblem(response: LightMyRequestResponse, status: number) {
  expect(response.statusCode).toBe(status);
  expect(response.headers["content-type"]).toContain("application/problem+json");
  expect(response.json()).toMatchObject({
    type: "about:blank",
    status,
    title: expect.any(String),
    detail: expect.any(String),
  });
}
async function auditEntries() {
  const response = await harness.app.inject({
    method: "GET",
    url: "/api/v1/audit-log",
    cookies,
    query: { action: "org_settings.updated" },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().entries;
}
it("reads the fresh-install policy and server address in one call", async () => {
  const response = await harness.app.inject({ method: "GET", url, cookies });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    authorizationServerAvailable: true,
    allowedClients: expect.any(Array),
    dynamicClientRegistrationEnabled: false,
    reachability: null,
    legalOAuthClientsEnabled: false,
    businessOAuthClientsEnabled: false,
    enabled: false,
    legalApiKeysEnabled: false,
    businessApiKeysEnabled: false,
    toolsetCeiling: toolsets,
    readOnly: false,
    apiKeyLifetimeDays: 90,
    serverAddress: `${harness.app.baseUrl.replace(/\/$/, "")}/mcp`,
  });
});
it("refuses anonymous callers and Legal Team Members for both reads and writes", async () => {
  for (const method of ["GET", "PATCH"] as const) {
    const payload = method === "PATCH" ? { enabled: true } : undefined;
    expectProblem(await harness.app.inject({ method, url, payload }), 401);
    expectProblem(await harness.app.inject({ method, url, payload, cookies: staffCookies }), 403);
  }
});
it("applies each policy change immediately and audits it at admin_only", async () => {
  const changes = {
    enabled: true,
    legalApiKeysEnabled: true,
    businessApiKeysEnabled: true,
    toolsetCeiling: ["contracts", "tasks"],
    readOnly: true,
    apiKeyLifetimeDays: 365,
  };
  for (const [field, value] of Object.entries(changes)) {
    const response = await harness.app.inject({
      method: "PATCH",
      url,
      cookies,
      payload: { [field]: value },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()[field]).toEqual(value);
    expect((await harness.app.inject({ method: "GET", url, cookies })).json()[field]).toEqual(
      value,
    );
    const rows = await auditEntries();
    expect(rows).toContainEqual(
      expect.objectContaining({
        visibility: "admin_only",
        payload: expect.objectContaining({
          field: auditFields[field as keyof typeof auditFields],
          old: expect.anything(),
          new: value,
        }),
      }),
    );
  }
  const response = await harness.app.inject({
    method: "PATCH",
    url,
    cookies,
    payload: { toolsetCeiling: [], apiKeyLifetimeDays: 1 },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ toolsetCeiling: [], apiKeyLifetimeDays: 1 });
});
it("names an invalid API key lifetime and writes neither policy nor audit", async () => {
  for (const apiKeyLifetimeDays of [0, 366, 1.5, "90"]) {
    const before = await auditEntries();
    const response = await harness.app.inject({
      method: "PATCH",
      url,
      cookies,
      payload: { enabled: false, apiKeyLifetimeDays },
    });
    expectProblem(response, 400);
    expect(response.json().errors).toContainEqual(
      expect.objectContaining({
        path: "apiKeyLifetimeDays",
        message: expect.stringMatching(/API key lifetime/),
      }),
    );
    expect((await harness.app.inject({ method: "GET", url, cookies })).json().enabled).toBe(true);
    expect(await auditEntries()).toEqual(before);
  }
});
it("refuses unknown, duplicate and always-on Toolsets and unknown settings", async () => {
  for (const payload of [
    { toolsetCeiling: ["unknown"] },
    { toolsetCeiling: ["contracts", "contracts"] },
    { toolsetCeiling: ["guide"] },
    { serverAddress: "https://other.test/mcp" },
    {},
  ]) {
    const response = await harness.app.inject({ method: "PATCH", url, cookies, payload });
    expectProblem(response, 400);
    expect(response.json().errors.length).toBeGreaterThan(0);
  }
});

it("refuses the Legal Team Member access to MCP audit rows", async () => {
  expectProblem(
    await harness.app.inject({
      method: "GET",
      url: "/api/v1/audit-log",
      cookies: staffCookies,
      query: { action: "org_settings.updated" },
    }),
    403,
  );
});

it("publishes one MCP event for access changes, none for other fields, no-ops or rollback", async () => {
  const listener = await harness.db.$client.connect();
  const events: unknown[] = [];
  listener.on("notification", (message) => {
    if (message.channel === LIVE_EVENT_CHANNEL && message.payload) {
      const event = parseLiveEvent(JSON.parse(message.payload));
      if (event?.kind === "mcp") events.push(event);
    }
  });
  await listener.query(`LISTEN ${LIVE_EVENT_CHANNEL}`);
  async function patch(payload: Record<string, unknown>, expectedCount: number, status = 200) {
    events.length = 0;
    const response = await harness.app.inject({ method: "PATCH", url, cookies, payload });
    expect(response.statusCode, response.body).toBe(status);
    // A notification from the next transaction marks delivery of the PATCH's notifications.
    const delivered = new Promise<void>((resolve) => {
      const receive = (message: { channel: string }) => {
        if (message.channel === "mcp_test_barrier") {
          listener.off("notification", receive);
          resolve();
        }
      };
      listener.on("notification", receive);
    });
    await harness.db.$client.query("NOTIFY mcp_test_barrier");
    await delivered;
    expect(events).toEqual(
      Array.from({ length: expectedCount }, () => ({
        kind: "mcp",
        change: "policy",
        credentialIds: [],
      })),
    );
  }
  try {
    await listener.query("LISTEN mcp_test_barrier");
    const current = (await harness.app.inject({ method: "GET", url, cookies })).json();
    for (const field of [
      "enabled",
      "readOnly",
      "legalApiKeysEnabled",
      "businessApiKeysEnabled",
      "legalOAuthClientsEnabled",
      "businessOAuthClientsEnabled",
    ]) {
      await patch({ [field]: !current[field] }, 1);
      await patch({ [field]: !current[field] }, 0);
    }
    await patch(
      {
        toolsetCeiling: ["team", "administration"],
        enabled: current.enabled,
        readOnly: current.readOnly,
      },
      1,
    );
    await patch({ toolsetCeiling: ["team", "administration"] }, 0);
    await patch({ apiKeyLifetimeDays: 42 }, 0);
    await patch({ dynamicClientRegistrationEnabled: !current.dynamicClientRegistrationEnabled }, 0);
    await harness.db.$client.query(
      `CREATE FUNCTION refuse_mcp_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$`,
    );
    await harness.db.$client.query(
      `CREATE CONSTRAINT TRIGGER refuse_mcp_commit AFTER UPDATE ON org_settings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refuse_mcp_commit()`,
    );
    await patch({ enabled: !current.enabled }, 0, 500);
    expect((await harness.app.inject({ method: "GET", url, cookies })).json().enabled).toBe(
      current.enabled,
    );
  } finally {
    await harness.db.$client.query("DROP TRIGGER IF EXISTS refuse_mcp_commit ON org_settings");
    await harness.db.$client.query("DROP FUNCTION IF EXISTS refuse_mcp_commit()");
    await listener.query("UNLISTEN *");
    listener.removeAllListeners("notification");
    listener.release();
  }
});
it("parses MCP changes and rejects malformed credential lists", () => {
  expect(parseLiveEvent({ kind: "mcp", change: "policy", organizationId: "ignored" })).toEqual({
    kind: "mcp",
    change: "policy",
  });
  expect(
    parseLiveEvent({ kind: "mcp", change: "revocation", credentialIds: ["key-1", "grant-1"] }),
  ).toEqual({ kind: "mcp", change: "revocation", credentialIds: ["key-1", "grant-1"] });
  for (const input of [
    {},
    { change: "unknown" },
    { change: "policy", credentialIds: null },
    { change: "policy", credentialIds: [""] },
    { change: "policy", credentialIds: [1] },
    { change: "policy", credentialIds: "key" },
  ])
    expect(parseLiveEvent({ kind: "mcp", ...input })).toBeNull();
});
