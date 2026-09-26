// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  aiConnector,
  aiSavedKeys,
  signingConnectors,
  ssoProviders,
  oauthClients,
  allowedClients,
  activityLog,
  contracts,
  contractTypes,
  contractStatuses,
  mcpToolCalls,
  orgSettings,
  users,
  eq,
} from "@openlaw/db";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";

let h: TestHarness;
let cookies: Record<string, string>;
let adminId: string;
let client: Client;
let recordId: string;
let hiddenEntry: string;
const names = ["openlaw_audit_log_query", "openlaw_settings_get"];
const sections = {
  general: "/org/general",
  branding: "/org/branding",
  notifications: "/org/notifications",
  reminder_offsets: "/org/reminder-offsets",
  currencies: "/org/currencies",
  email: "/email-settings",
  ai_analysis: "/ai-connector",
  e_signature: "/signing-connectors/docusign",
  mcp: "/mcp-settings",
};
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  cookies = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  adminId = (await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!.id;
  await h.db
    .update(orgSettings)
    .set({ mcpEnabled: true, mcpLegalApiKeysEnabled: true, mcpToolsetCeiling: ["administration"] });
  const asked = await h.app.inject({
    method: "POST",
    url: "/api/v1/api-key-requests",
    cookies,
    payload: { clientName: "Audit Client", toolsets: ["administration"], scope: "read" },
  });
  expect(asked.statusCode, asked.body).toBe(201);
  const endpoint = new URL("/mcp", await h.app.listen({ port: 0, host: "127.0.0.1" }));
  client = new Client({ name: "Audit Client", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { "x-api-key": asked.json().key } },
    }),
  );
  const type = (await h.db.select().from(contractTypes).limit(1))[0]!;
  const status = (await h.db.select().from(contractStatuses).limit(1))[0]!;
  const [record, hidden] = await h.db
    .insert(contracts)
    .values([
      { title: "Reached record", contractTypeId: type.id, statusId: status.id, createdBy: adminId },
      {
        title: "Secret record",
        contractTypeId: type.id,
        statusId: status.id,
        createdBy: adminId,
        isConfidential: true,
      },
    ])
    .returning();
  recordId = record!.id;
  const entries = await h.db
    .insert(activityLog)
    .values([
      {
        actorId: adminId,
        entityType: "contract",
        entityId: recordId,
        action: "contract.relation_added",
        visibility: "working_team",
        createdAt: new Date("2026-01-02T12:00:00Z"),
        payload: { relatedNumber: hidden!.number, relatedTitle: hidden!.title },
      },
      {
        actorId: adminId,
        entityType: "contract",
        entityId: hidden!.id,
        action: "contract.created",
        visibility: "working_team",
        createdAt: new Date("2026-01-01T12:00:00Z"),
        payload: {},
      },
    ])
    .returning();
  hiddenEntry = entries[1]!.id;
});
afterAll(async () => {
  await client?.close();
  await h?.stop();
});
async function get(path: string) {
  const response = await h.app.inject({ url: `/api/v1${path}`, cookies });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result)).toBeUndefined();
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(64_000);
  return result.structuredContent as Record<string, unknown>;
}
it("lists and calls Administration only while the role and ceiling permit it", async () => {
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining(names),
  );
  try {
    await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, adminId));
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(names),
    );
    for (const name of names)
      expect(JSON.stringify(await client.callTool({ name, arguments: {} }))).toContain(
        "tool_outside_grant",
      );
    await h.db.update(users).set({ role: "administrator" }).where(eq(users.id, adminId));
    await h.db.update(orgSettings).set({ mcpToolsetCeiling: [] });
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(names),
    );
    for (const name of names)
      expect(JSON.stringify(await client.callTool({ name, arguments: {} }))).toContain(
        "tool_outside_grant",
      );
  } finally {
    await h.db.update(users).set({ role: "administrator" }).where(eq(users.id, adminId));
    await h.db.update(orgSettings).set({ mcpToolsetCeiling: ["administration"] });
  }
});
it("matches every audit filter and reach redaction without writing an audit event", async () => {
  const before = await h.db.select().from(activityLog);
  for (const filters of [
    {},
    { actorId: adminId },
    { action: "contract.relation_added" },
    { entityType: "contract" },
    { from: "2026-01-02T00:00:00Z" },
    { to: "2026-01-02T23:59:59Z" },
    { q: "relation" },
    { q: "%_" },
    { actorId: adminId, entityType: "contract", q: "relation", to: "2026-01-03T00:00:00Z" },
    { cursor: hiddenEntry },
    { cursor: "missing" },
  ]) {
    const page = await get(`/audit-log?${new URLSearchParams(filters as Record<string, string>)}`);
    const result = await call(names[0]!, { ...filters, limit: 50 });
    const entries = result.entries as Array<{ actor: { email: string } | null }>;
    expect({
      ...result,
      entries: entries.map((entry) => ({
        ...entry,
        actor: entry.actor
          ? Object.fromEntries(Object.entries(entry.actor).filter(([key]) => key !== "email"))
          : null,
      })),
    }).toEqual(page);
    for (const entry of entries) if (entry.actor) expect(entry.actor.email).toBe(TEST_ADMIN.email);
  }
  const result = await call(names[0]!, { action: "contract.relation_added" });
  expect(result.entries).toEqual([
    expect.objectContaining({
      entityId: recordId,
      entityRef: expect.objectContaining({ title: "Reached record" }),
      payload: {},
    }),
  ]);
  expect(await h.db.select().from(activityLog)).toEqual(before);
  expect((await h.db.select().from(mcpToolCalls)).length).toBeGreaterThan(0);
});
it("matches the Tool calls tab's date filters and cursor", async () => {
  const to = new Date().toISOString();
  const cases: Record<string, string>[] = [
    { to },
    { from: "2020-01-01T00:00:00Z", to },
    { cursor: "missing", to },
  ];
  for (const filters of cases) {
    const page = await get(
      `/audit-log/tool-calls?${new URLSearchParams(filters as Record<string, string>)}`,
    );
    expect(await call(names[0]!, { view: "tool_calls", ...filters, limit: 50 })).toEqual(page);
  }
});
it("pages under the byte budget and bounds oversized payloads without losing rows", async () => {
  const rows = await h.db
    .insert(activityLog)
    .values(
      Array.from({ length: 8 }, (_, index) => ({
        actorId: adminId,
        entityType: "system" as const,
        action: "large.payload",
        visibility: "admin_only" as const,
        payload: { detail: '"漢'.repeat(index === 0 ? 20_000 : 1400) },
      })),
    )
    .returning();
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const result = await call(names[0]!, {
      action: "large.payload",
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...(result.entries as Array<{ id: string }>).map((entry) => entry.id));
    cursor = result.nextCursor as string | null;
  } while (cursor);
  expect(ids.sort()).toEqual(rows.map((row) => row.id).sort());
});
it("lists the settings sections and returns the same redacted pane reads", async () => {
  expect((await call(names[1]!)).sections).toEqual([
    ...Object.keys(sections),
    "authentication",
    "advanced",
  ]);
  for (const [section, path] of Object.entries(sections)) {
    expect((await call(names[1]!, { section })).settings).toEqual(await get(path));
  }
  const methods = await get("/auth/methods");
  const domains = await get("/auth/allowed-domains");
  const providers = await get("/auth/sso-providers");
  expect((await call(names[1]!, { section: "authentication" })).settings).toEqual({
    policy: methods.policy,
    ...domains,
    ...providers,
  });
  const advanced = (await call(names[1]!, { section: "advanced" })).settings;
  expect(advanced).toEqual(
    Object.fromEntries(
      await Promise.all(
        ["instance", "uploads", "storage", "processing", "mcp"].map(async (section) => [
          section,
          await get(`/advanced-settings/${section}`),
        ]),
      ),
    ),
  );
});
it("never returns SMTP, AI, signing, Client or masked Advanced secrets", async () => {
  const values = {
    smtpPassword: "fixture-smtp-password",
    apiKey: "fixture-ai-key",
    privateKey: "fixture-signing-key",
    webhookSecret: "fixture-signing-secret",
    clientSecret: "fixture-sso-secret",
    oauthSecret: "fixture-oauth-secret",
    S3_ACCESS_KEY_ID: "fixture-access-id",
    S3_SECRET_ACCESS_KEY: "fixture-access-secret",
    AZURE_BLOB_ACCOUNT_KEY: "fixture-azure-secret",
  };
  h.smtpEnv = null;
  await h.db.update(orgSettings).set({
    smtpUrl: `smtp://sender:${values.smtpPassword}@smtp.example:587`,
    smtpFrom: "sender@example.com",
    advancedSettings: JSON.stringify({
      version: "secrets",
      values: {
        S3_ACCESS_KEY_ID: values.S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: values.S3_SECRET_ACCESS_KEY,
        AZURE_BLOB_ACCOUNT_KEY: values.AZURE_BLOB_ACCOUNT_KEY,
      },
    }),
  });
  const [key] = await h.db
    .insert(aiSavedKeys)
    .values({
      preset: "openai",
      protocol: "openai_chat_completions",
      baseUrl: "https://api.openai.com/v1",
      apiKey: values.apiKey,
    })
    .returning();
  await h.db.insert(aiConnector).values({
    preset: "openai",
    protocol: "openai_chat_completions",
    baseUrl: "https://api.openai.com/v1",
    model: "fixture",
    savedKeyId: key!.id,
  });
  await h.db.insert(signingConnectors).values({
    provider: "docusign",
    environment: "demo",
    integrationKey: "fixture-client-id",
    apiUserId: "fixture-user",
    privateKey: values.privateKey,
    webhookSecret: values.webhookSecret,
  });
  await h.db.insert(ssoProviders).values({
    providerId: "fixture",
    issuer: "https://idp.example",
    domain: "example.com",
    userId: adminId,
    oidcConfig: JSON.stringify({ clientId: "fixture", clientSecret: values.clientSecret }),
  });
  await h.db.insert(oauthClients).values({
    clientId: "fixture",
    clientSecret: values.oauthSecret,
    redirectUris: ["https://client.example/callback"],
  });
  await h.db.insert(allowedClients).values({
    name: "Fixture Client",
    kind: "registered",
    clientId: "fixture",
    secretGeneratedAt: new Date(),
  });
  const results = [];
  for (const section of [...Object.keys(sections), "authentication", "advanced"])
    results.push(await call(names[1]!, { section }));
  const serialized = JSON.stringify(results);
  for (const secret of Object.values(values)) expect(serialized).not.toContain(secret);
  for (const name of [
    "smtpUrl",
    "smtpPassword",
    "apiKey",
    "privateKey",
    "webhookSecret",
    "clientSecret",
    "client_secret",
    "oidcConfig",
  ])
    expect(serialized).not.toContain(`"${name}":`);
  expect(JSON.stringify((await call(names[1]!, { section: "email" })).settings)).not.toContain(
    '"password":',
  );
  const advanced = results.at(-1)!.settings as Record<
    string,
    { fields: Array<{ key: string; value: string; activeValue: string }> }
  >;
  for (const name of ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "AZURE_BLOB_ACCOUNT_KEY"])
    expect(advanced.storage!.fields.find((field) => field.key === name)).toMatchObject({
      value: "",
      activeValue: "",
    });
  for (const [section, path] of Object.entries(sections))
    expect((await call(names[1]!, { section })).settings).toEqual(await get(path));
});
