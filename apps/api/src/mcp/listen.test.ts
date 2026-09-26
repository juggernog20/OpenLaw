// SPDX-License-Identifier: AGPL-3.0-only
import type { LiveEvent, LiveRecordEntityType } from "@openlaw/shared";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  matters,
  matterTypes,
  matterStatuses,
  requests,
  entities,
  entityTypes,
  knowledgeItems,
  knowledgeTypes,
  contracts,
  contractTypes,
  contractStatuses,
  contractTeam,
  orgSettings,
  users,
  eq,
  apikeys,
  createDb,
  requestTypes,
  allowedClients,
  oauthGrants,
} from "@openlaw/db";
import { requestDepartment } from "../testing/request-department.js";
import { submitRequestFixture } from "../testing/request-form.js";
import { provisionUser } from "../auth/instance.js";
import { recordActivity } from "../lib/activity.js";
import { publishLiveEvent } from "../lib/live-events.js";
import { startHarness, signInCookies, TEST_ADMIN, type TestHarness } from "../testing/harness.js";
import { MAX_SUBSCRIBED_ADDRESSES } from "./change-feed.js";

let h: TestHarness;
let admin: Record<string, string>;
let business: Record<string, string>;
let adminId: string;
let endpoint: URL;
let contract: typeof contracts.$inferSelect;
let outside: typeof contracts.$inferSelect;
const streams: Stream[] = [];
const clients: Client[] = [];

class Stream {
  readonly messages: { method?: string; params?: { uri?: string }; result?: unknown }[] = [];
  ended = false;
  constructor(
    readonly controller: AbortController,
    response: Response,
  ) {
    void (async () => {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = block.split("\n").find((line) => line.startsWith("data: "));
            if (data) this.messages.push(JSON.parse(data.slice(6)));
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        this.ended = true;
        reader.releaseLock();
      }
    })();
  }
}
async function key(cookies = admin, toolsets = ["contracts", "requests", "tasks"]) {
  const asked = await h.app.inject({
    method: "POST",
    url: "/api/v1/api-key-requests",
    cookies,
    payload: { clientName: "Listen test", scope: "read", toolsets },
  });
  expect(asked.statusCode, asked.body).toBe(201);
  const id = asked.json().id as string;
  let secret = asked.json().key as string | undefined;
  if (!secret) {
    const approved = await h.app.inject({
      method: "POST",
      url: `/api/v1/api-key-requests/${id}/approve`,
      cookies: admin,
      payload: {},
    });
    expect(approved.statusCode, approved.body).toBe(200);
    secret = (await h.app.inject({ url: `/api/v1/api-key-requests/${id}`, cookies })).json().key;
  }
  return { id, secret: secret! };
}
async function listen(secret: string, addresses: string[] = [], flags = true) {
  const controller = new AbortController();
  const response = await fetch(endpoint, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-api-key": secret,
      "mcp-method": "subscriptions/listen",
      "mcp-protocol-version": "2026-07-28",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "subscriptions/listen",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
        notifications: {
          toolsListChanged: flags,
          promptsListChanged: flags,
          resourcesListChanged: flags,
          resourceSubscriptions: addresses,
        },
      },
    }),
  });
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const error = await response.text();
    controller.abort();
    throw new Error(error);
  }
  const stream = new Stream(controller, response);
  streams.push(stream);
  await expect
    .poll(() => stream.messages[0]?.method)
    .toBe("notifications/subscriptions/acknowledged");
  return stream;
}
async function activity(record: typeof contract, visibility: "legal_only" | "full_thread") {
  await recordActivity(h.db, {
    entityType: "contract",
    entityId: record.id,
    actorId: adminId,
    action: "contract.updated",
    visibility,
    payload: { number: record.number, title: record.title, changed: {} },
  });
}
const updates = (stream: Stream) =>
  stream.messages
    .filter((m) => m.method === "notifications/resources/updated")
    .map((m) => m.params?.uri);
beforeAll(async () => {
  h = await startHarness({ eventHeartbeatMs: 100 });
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  adminId = (await h.db.select().from(users).where(eq(users.email, TEST_ADMIN.email)))[0]!.id;
  const person = await provisionUser(h.app.auth, {
    email: "listen@example.com",
    displayName: "Business",
    password: TEST_ADMIN.password,
  });
  await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, person.id));
  business = await signInCookies(h.app, "listen@example.com", TEST_ADMIN.password);
  await h.db
    .update(orgSettings)
    .set({ mcpEnabled: true, mcpLegalApiKeysEnabled: true, mcpBusinessApiKeysEnabled: true });
  const type = (await h.db.select().from(contractTypes).limit(1))[0]!;
  const status = (await h.db.select().from(contractStatuses).limit(1))[0]!;
  [contract, outside] = (await h.db
    .insert(contracts)
    .values(
      ["Reached", "Outside"].map((title) => ({
        title,
        contractTypeId: type.id,
        statusId: status.id,
        createdBy: adminId,
      })),
    )
    .returning()) as [typeof contract, typeof outside];
  await h.db.insert(contractTeam).values({ contractId: contract.id, userId: person.id });
  endpoint = new URL("/mcp", await h.app.listen({ port: 0, host: "127.0.0.1" }));
});
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.controller.abort();
  await Promise.all(clients.splice(0).map((c) => c.close()));
});
afterAll(async () => {
  await h?.stop();
});

it("sends the three list changes after a ceiling PATCH and re-lists the newly enabled Tools", async () => {
  const credential = await key();
  const policy = (await h.db.select().from(orgSettings))[0]!;
  await h.db
    .update(orgSettings)
    .set({ mcpToolsetCeiling: policy.mcpToolsetCeiling.filter((t) => t !== "contracts") });
  const client = new Client(
    { name: "Listen", version: "1" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { "x-api-key": credential.secret } },
    }),
  );
  expect((await client.listTools()).tools.some((t) => t.name === "openlaw_contract_get")).toBe(
    false,
  );
  const changes: string[] = [];
  for (const method of [
    "notifications/tools/list_changed",
    "notifications/prompts/list_changed",
    "notifications/resources/list_changed",
  ] as const)
    client.setNotificationHandler(method, () => {
      changes.push(method);
    });
  const subscription = await client.listen({
    toolsListChanged: true,
    promptsListChanged: true,
    resourcesListChanged: true,
  });
  expect(subscription.honoredFilter).toEqual({
    toolsListChanged: true,
    promptsListChanged: true,
    resourcesListChanged: true,
  });
  const patch = await h.app.inject({
    method: "PATCH",
    url: "/api/v1/mcp-settings",
    cookies: admin,
    payload: { toolsetCeiling: policy.mcpToolsetCeiling },
  });
  expect(patch.statusCode, patch.body).toBe(200);
  await expect
    .poll(() => changes.toSorted())
    .toEqual([
      "notifications/prompts/list_changed",
      "notifications/resources/list_changed",
      "notifications/tools/list_changed",
    ]);
  expect(
    (await client.listTools(undefined, { cacheMode: "refresh" })).tools.some(
      (t) => t.name === "openlaw_contract_get",
    ),
  ).toBe(true);
});
it("filters record updates by reach, grant and tier while accepting inert addresses", async () => {
  const credential = await key(business, ["contracts"]);
  const uri = `openlaw://contracts/${contract.number}`;
  const stream = await listen(credential.secret, [
    uri,
    `openlaw://contracts/${outside.number}`,
    "openlaw://inbox",
    "openlaw://tasks/mine",
    "openlaw://vocabulary",
    "openlaw://document-versions/00000000-0000-4000-8000-000000000000",
  ]);
  const denied = await listen((await key(admin, ["tasks"])).secret, [uri]);
  await activity(contract, "legal_only");
  await activity(outside, "full_thread");
  await h.db.transaction((tx) => publishLiveEvent(tx, { kind: "inbox", total: 1 }));
  await activity(contract, "full_thread");
  await expect.poll(() => updates(stream)).toEqual([uri]);
  expect(updates(denied)).toEqual([]);
});
it("ends the named key stream on revoke and leaves another key open", async () => {
  const credential = await key();
  const stream = await listen(credential.secret);
  const other = await listen((await key()).secret);
  const revoked = await h.app.inject({
    method: "POST",
    url: `/api/v1/api-key-requests/${credential.id}/revoke`,
    cookies: admin,
  });
  expect(revoked.statusCode, revoked.body).toBe(200);
  await expect.poll(() => stream.ended).toBe(true);
  expect(other.ended).toBe(false);
  // Events arrive in order, so the policy change proves the revocation reached `other` first.
  await h.db.transaction((tx) => publishLiveEvent(tx, { kind: "mcp", change: "policy" }));
  await expect
    .poll(() => other.messages.filter((m) => m.method?.endsWith("list_changed")).length)
    .toBe(3);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(other.messages.filter((m) => m.method?.endsWith("list_changed"))).toHaveLength(3);
});
it("stops record updates for a Toolset that leaves the ceiling while the stream stays open", async () => {
  const policy = (await h.db.select().from(orgSettings))[0]!;
  const uri = `openlaw://contracts/${contract.number}`;
  const stream = await listen((await key()).secret, [uri, "openlaw://inbox"]);
  try {
    const patch = await h.app.inject({
      method: "PATCH",
      url: "/api/v1/mcp-settings",
      cookies: admin,
      payload: { toolsetCeiling: policy.mcpToolsetCeiling.filter((t) => t !== "contracts") },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    await expect
      .poll(() => stream.messages.filter((m) => m.method?.endsWith("list_changed")).length)
      .toBe(3);
    await activity(contract, "legal_only");
    await h.db.transaction((tx) => publishLiveEvent(tx, { kind: "inbox", total: 1 }));
    await expect.poll(() => updates(stream)).toEqual(["openlaw://inbox"]);
    expect(stream.ended).toBe(false);
  } finally {
    await h.db.update(orgSettings).set({ mcpToolsetCeiling: policy.mcpToolsetCeiling });
  }
});
it("closes the stream on the heartbeat after the person's role changes", async () => {
  const [person] = await h.db.select().from(users).where(eq(users.email, "listen@example.com"));
  const stream = await listen((await key(business, ["contracts"])).secret);
  try {
    await h.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, person!.id));
    await expect.poll(() => stream.ended, { timeout: 1000 }).toBe(true);
  } finally {
    await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, person!.id));
  }
});
it("re-reads the credential on the heartbeat even without a live notification", async () => {
  const credential = await key();
  const stream = await listen(credential.secret);
  const verified = await h.app.auth.api.verifyApiKey({ body: { key: credential.secret } });
  const remote = createDb(h.databaseUrl);
  try {
    await remote.update(apikeys).set({ enabled: false }).where(eq(apikeys.id, verified.key!.id));
  } finally {
    await remote.$client.end();
  }
  await expect.poll(() => stream.ended, { timeout: 1000 }).toBe(true);
});
it("counts three addresses as one slot and the sixth stream closes the oldest", async () => {
  const credential = await key();
  const first = await listen(credential.secret, [
    `openlaw://contracts/${contract.number}`,
    "openlaw://inbox",
    "openlaw://tasks/mine",
  ]);
  const remaining = [];
  for (let i = 0; i < 4; i++) remaining.push(await listen(credential.secret));
  expect(first.ended).toBe(false);
  remaining.push(await listen(credential.secret));
  await expect.poll(() => first.ended).toBe(true);
  expect(remaining.every((s) => !s.ended)).toBe(true);
});

it("refuses a listen request that names more than the address cap before any lookup", async () => {
  const credential = await key();
  const addresses = Array.from(
    { length: MAX_SUBSCRIBED_ADDRESSES + 1 },
    (_, i) => `openlaw://contracts/${i + 1}`,
  );
  await expect(listen(credential.secret, addresses)).rejects.toThrow(
    '"code":-32603,"message":"Subscription limit reached"',
  );
  const atCap = await listen(credential.secret, addresses.slice(0, MAX_SUBSCRIBED_ADDRESSES));
  expect(atCap.ended).toBe(false);
  atCap.controller.abort();
  await expect.poll(() => atCap.ended).toBe(true);
});

it("delivers Inbox changes from Request submission only to subscribed Legal Users", async () => {
  const stream = await listen((await key()).secret, ["openlaw://inbox"]);
  const notSubscribed = await listen((await key()).secret);
  const type = (await h.db.select().from(requestTypes).limit(1))[0]!;
  const response = await submitRequestFixture(h, {
    method: "POST",
    url: "/api/v1/requests",
    cookies: business,
    payload: {
      requestTypeId: type.id,
      departmentId: await requestDepartment(h.db),
      title: "Listen Inbox",
      description: "Please review",
      urgency: "medium",
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  await expect.poll(() => updates(stream)).toEqual(["openlaw://inbox"]);
  expect(updates(notSubscribed)).toEqual([]);
});
it("closes streams whose group door closes and keeps the other group open", async () => {
  const stream = await listen((await key()).secret);
  const other = await listen((await key(business, ["contracts"])).secret);
  try {
    const response = await h.app.inject({
      method: "PATCH",
      url: "/api/v1/mcp-settings",
      cookies: admin,
      payload: { legalApiKeysEnabled: false },
    });
    expect(response.statusCode, response.body).toBe(200);
    await expect.poll(() => stream.ended).toBe(true);
    expect(other.ended).toBe(false);
  } finally {
    await h.db.update(orgSettings).set({ mcpLegalApiKeysEnabled: true });
  }
});
it("forwards policy changes published through another database connection", async () => {
  const stream = await listen((await key()).secret);
  const remote = createDb(h.databaseUrl);
  try {
    await remote.transaction((tx) => publishLiveEvent(tx, { kind: "mcp", change: "policy" }));
  } finally {
    await remote.$client.end();
  }
  await expect
    .poll(() => stream.messages.filter((m) => m.method?.endsWith("list_changed")).length)
    .toBe(3);
});
it("uses the SDK refusal when SPA streams fill the shared process cap and releases slots on disconnect", async () => {
  const credential = await key();
  const controller = new AbortController();
  const spa = await fetch(new URL("/api/events", endpoint), {
    signal: controller.signal,
    headers: {
      cookie: Object.entries(admin)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    },
  });
  expect(spa.status).toBe(200);
  const releases: (() => void)[] = [];
  try {
    for (let i = 0; i < 499; i++)
      releases.push(
        h.app.eventHub.subscribe({ userId: `other-${i}`, role: "legal_team_member" }, () => {}),
      );
    await expect(listen(credential.secret)).rejects.toThrow(
      '"code":-32603,"message":"Subscription limit reached"',
    );
    releases.pop()!();
    const stream = await listen(credential.secret);
    stream.controller.abort();
    await expect.poll(() => stream.ended).toBe(true);
    await expect
      .poll(() => {
        try {
          const release = h.app.eventHub.subscribe(
            { userId: "replacement", role: "legal_team_member" },
            () => {},
          );
          release();
          return true;
        } catch {
          return false;
        }
      })
      .toBe(true);
  } finally {
    controller.abort();
    await spa.body?.cancel().catch(() => {});
    releases.forEach((release) => release());
  }
});

async function oauth() {
  await h.db.update(orgSettings).set({ mcpLegalOAuthClientsEnabled: true });
  const [client] = await h.db
    .insert(allowedClients)
    .values({
      name: "Listen OAuth",
      kind: "published",
      metadataUrl: `https://client.example/${crypto.randomUUID()}`,
    })
    .returning();
  const [grant] = await h.db
    .insert(oauthGrants)
    .values({
      personId: adminId,
      allowedClientId: client!.id,
      toolsets: ["contracts"],
      scope: "read",
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  const { token } = await h.app.auth.api.signJWT({
    body: {
      payload: {
        sub: adminId,
        client_id: client!.metadataUrl,
        scope: "toolset:contracts",
        iss: "http://localhost/api/auth",
        aud: "http://localhost/mcp",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
    },
  });
  return { token, client: client!, grant: grant! };
}
it.each(["revoke", "toggle"])("closes an OAuth stream on %s", async (action) => {
  const credential = await oauth();
  const stream = await listen(credential.token);
  const other = await listen((await key()).secret);
  const response = await h.app.inject(
    action === "revoke"
      ? {
          method: "POST",
          url: `/api/v1/oauth-grants/${credential.grant.id}/revoke`,
          cookies: admin,
        }
      : {
          method: "PATCH",
          url: `/api/v1/mcp-settings/allowed-clients/${credential.client.id}`,
          cookies: admin,
          payload: { enabled: false },
        },
  );
  expect(response.statusCode, response.body).toBe(200);
  await expect.poll(() => stream.ended).toBe(true);
  expect(other.ended).toBe(false);
});

it("maps all five record templates to their exact subscribed addresses and honors list flags", async () => {
  const mt = (await h.db.select().from(matterTypes).limit(1))[0]!;
  const ms = (await h.db.select().from(matterStatuses).limit(1))[0]!;
  const [matter] = await h.db
    .insert(matters)
    .values({ title: "Listen work", matterTypeId: mt.id, statusId: ms.id, createdBy: adminId })
    .returning();
  const rt = (await h.db.select().from(requestTypes).limit(1))[0]!;
  const [request] = await h.db
    .insert(requests)
    .values({
      title: "Listen request",
      requestTypeId: rt.id,
      requesterId: adminId,
      urgency: "medium",
    })
    .returning();
  const et = (await h.db.select().from(entityTypes).limit(1))[0]!;
  const [entity] = await h.db
    .insert(entities)
    .values({ legalName: "Listen company", entityTypeId: et.id })
    .returning();
  const kt = (await h.db.select().from(knowledgeTypes).limit(1))[0]!;
  const [item] = await h.db
    .insert(knowledgeItems)
    .values({
      title: "Listen guidance",
      knowledgeTypeId: kt.id,
      createdBy: adminId,
      updatedBy: adminId,
    })
    .returning();
  const records: { kind: LiveRecordEntityType; id: string; uri: string }[] = [
    { kind: "contract", id: contract.id, uri: `openlaw://contracts/C-${contract.number}` },
    { kind: "matter", id: matter!.id, uri: `openlaw://matters/M-${matter!.number}` },
    { kind: "request", id: request!.id, uri: `openlaw://requests/R-${request!.number}` },
    { kind: "entity", id: entity!.id, uri: `openlaw://entities/${entity!.id}` },
    { kind: "knowledge_item", id: item!.id, uri: `openlaw://knowledge/${item!.id}` },
  ];
  const credential = await key(admin, [
    "contracts",
    "matters",
    "requests",
    "entities",
    "knowledge",
    "documents",
    "tasks",
  ]);
  const inert = [
    "openlaw://tasks/mine",
    "openlaw://vocabulary",
    "openlaw://document-versions/00000000-0000-4000-8000-000000000000",
    "openlaw://contracts/999999999999999",
    "openlaw://contracts/1?query=1",
    "openlaw://entities/invalid",
  ];
  const stream = await listen(credential.secret, [...records.map((r) => r.uri), ...inert], false);
  const quiet = await listen(credential.secret, inert, false);
  await h.db.transaction(async (tx) => {
    await publishLiveEvent(tx, { kind: "mcp", change: "policy" });
    for (const record of records)
      await publishLiveEvent(tx, {
        kind: "record",
        entityType: record.kind,
        entityId: record.id,
        entryId: crypto.randomUUID(),
        action: "updated",
        visibility: "legal_only",
      });
  });
  await expect.poll(() => updates(stream)).toEqual(records.map((r) => r.uri));
  expect(stream.messages.filter((m) => m.method?.endsWith("list_changed"))).toEqual([]);
  expect(updates(quiet)).toEqual([]);
});

it("publishes revoked credential ids on the shared channel", async () => {
  const credential = await key();
  const oauthCredential = await oauth();
  const verified = await h.app.auth.api.verifyApiKey({ body: { key: credential.secret } });
  const received: LiveEvent[] = [];
  const release = h.app.eventHub.subscribe(
    { userId: "revocation-observer", role: "administrator", mcp: true },
    (event) => received.push(event),
  );
  try {
    const keyResponse = await h.app.inject({
      method: "POST",
      url: `/api/v1/api-key-requests/${credential.id}/revoke`,
      cookies: admin,
    });
    expect(keyResponse.statusCode, keyResponse.body).toBe(200);
    const grantResponse = await h.app.inject({
      method: "POST",
      url: `/api/v1/oauth-grants/${oauthCredential.grant.id}/revoke`,
      cookies: admin,
    });
    expect(grantResponse.statusCode, grantResponse.body).toBe(200);
    await expect
      .poll(() => received)
      .toEqual([
        { kind: "mcp", change: "revocation", credentialIds: [verified.key!.id] },
        { kind: "mcp", change: "revocation", credentialIds: [oauthCredential.grant.id] },
      ]);
  } finally {
    release();
  }
});
