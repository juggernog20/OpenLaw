// SPDX-License-Identifier: AGPL-3.0-only
import { createECDH, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { createServer, globalAgent } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import webPush from "web-push";
import {
  contracts,
  contractTeam,
  eq,
  inArray,
  notifications,
  orgSettings,
  requests,
  requestTypes,
  users,
  pushSubscriptions,
  sessions,
  sql,
} from "@openlaw/db";
import {
  startHarness,
  TEST_ADMIN,
  signInCookies,
  type TestHarness,
} from "../../testing/harness.js";
import { provisionUser } from "../../auth/instance.js";
import { createVapidResolver } from "../../lib/notifications/vapid.js";
import { handleNotificationPush } from "../../pipeline/notification-push.js";
import { startPipeline } from "../../pipeline/pg-boss.js";
import { runMorningRound } from "../../pipeline/morning-round.js";

let harness: TestHarness;
let userId: string;
let cookies: Record<string, string>;
let contractId: string;
let endpoint: string;
let status = 201;
const received: { body: unknown; headers: IncomingHttpHeaders }[] = [];
const browser = createECDH("prime256v1");
browser.generateKeys();
const auth = randomBytes(16);
const log = { info() {}, warn() {}, error() {} };

// Decrypt the actual aes128gcm wire message with the browser's keys.
function decrypt(body: Buffer): unknown {
  const salt = body.subarray(0, 16);
  const keyLength = body[20]!;
  const serverKey = body.subarray(21, 21 + keyLength);
  const ciphertext = body.subarray(21 + keyLength);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), browser.getPublicKey(), serverKey]);
  const ikm = hkdfSync("sha256", browser.computeSecret(serverKey), auth, info, 32);
  const key = hkdfSync(
    "sha256",
    Buffer.from(ikm),
    salt,
    Buffer.from("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = hkdfSync(
    "sha256",
    Buffer.from(ikm),
    salt,
    Buffer.from("Content-Encoding: nonce\0"),
    12,
  );
  const decipher = createDecipheriv("aes-128-gcm", Buffer.from(key), Buffer.from(nonce));
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  return JSON.parse(plaintext.subarray(0, -1).toString());
}
const certificates = mkdtempSync(join(tmpdir(), "openlaw-push-test-"));
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(certificates, "key.pem"),
    "-out",
    join(certificates, "cert.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
const cert = readFileSync(join(certificates, "cert.pem"));
const previousCa = globalAgent.options.ca;
const server = createServer(
  { key: readFileSync(join(certificates, "key.pem")), cert },
  async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push({ body: decrypt(Buffer.concat(chunks)), headers: req.headers });
    res.writeHead(status, status === 429 ? { "Retry-After": "120" } : {});
    res.end();
  },
);

beforeAll(async () => {
  harness = await startHarness({ runPipelineWorkers: false });
  await harness.app.resolveVapid();
  globalAgent.options.ca = cert;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No push endpoint");
  endpoint = `https://127.0.0.1:${address.port}`;
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  [userId] = await harness.db
    .select()
    .from(sessions)
    .then((rows) => [rows[0]!.userId, rows[0]!.id]);
  const options = await harness.app.inject({ url: "/api/v1/contracts/options", cookies });
  const typeId = options.json().contractTypes.find((t: { slug: string }) => t.slug === "nda").id;
  const created = await harness.app.inject({
    method: "POST",
    url: "/api/v1/contracts",
    cookies,
    payload: { title: "Private title", contractTypeId: typeId },
  });
  expect(created.statusCode, created.body).toBe(201);
  contractId = created.json().contract.id;
});
afterAll(async () => {
  await harness?.stop();
  globalAgent.options.ca = previousCa;
  rmSync(certificates, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
beforeEach(async () => {
  status = 201;
  received.length = 0;
  await harness.db.delete(pushSubscriptions);
});

async function subscribe(path = "one", expiresAt = new Date(Date.now() + 60_000)) {
  const [session] = await harness.db
    .insert(sessions)
    .values({ userId, token: randomBytes(20).toString("hex"), expiresAt })
    .returning();
  const [row] = await harness.db
    .insert(pushSubscriptions)
    .values({
      userId,
      sessionId: session!.id,
      endpoint: `${endpoint}/${path}`,
      p256dh: browser.getPublicKey().toString("base64url"),
      auth: auth.toString("base64url"),
      userAgent: "Test browser",
    })
    .returning();
  return row!;
}
async function notification(extra: Partial<typeof notifications.$inferInsert> = {}) {
  const [row] = await harness.db
    .insert(notifications)
    .values({
      userId,
      eventType: "contract.owner_assigned",
      entityType: "contract",
      entityId: contractId,
      payload: { contractTitle: "Private title" },
      pushOwed: true,
      ...extra,
    })
    .returning();
  return row!;
}
const deliver = (notificationId: string, retryCount = 0) =>
  handleNotificationPush(
    {
      db: harness.db,
      resolveVapid: createVapidResolver(harness.db, {}, "https://openlaw.example"),
      log,
    },
    { notificationId, retryCount, retryLimit: 2 },
  );
const read = (id: string) =>
  harness.db
    .select()
    .from(notifications)
    .where(eq(notifications.id, id))
    .then((rows) => rows[0]!);

it("generates one sealed pair on first run and returns only its public key in preferences", async () => {
  const [stored] = await harness.db.select().from(orgSettings);
  const raw = await harness.db.execute<{ private: string }>(
    sql`select vapid_private_key as private from org_settings`,
  );
  expect(raw.rows[0]!.private).toMatch(/^openlaw:v1:/);
  expect(raw.rows[0]!.private).not.toContain(stored!.vapidPrivateKey);
  const resolver = createVapidResolver(harness.db, {}, "https://openlaw.example");
  const pairs = await Promise.all([resolver(), resolver()]);
  expect(pairs[0]).toEqual(pairs[1]);
  expect(pairs[0].publicKey).toBe(stored!.vapidPublicKey);
  const response = await harness.app.inject({
    url: "/api/v1/me/notification-preferences",
    cookies,
  });
  expect(response.json().vapidPublicKey).toBe(stored!.vapidPublicKey);
  expect(response.body).not.toContain(stored!.vapidPrivateKey);
});
it("env keys win, partial env pins fail, and the subject follows SMTP or BASE_URL", async () => {
  const keys = webPush.generateVAPIDKeys();
  const resolve = createVapidResolver(
    harness.db,
    { ...keys, smtpFrom: "OpenLaw <mail@example.com>" },
    "https://openlaw.example",
  );
  expect(await resolve()).toEqual({ ...keys, subject: "mailto:mail@example.com" });
  expect(() =>
    createVapidResolver(harness.db, { publicKey: keys.publicKey }, "https://openlaw.example"),
  ).toThrow(/VAPID/);
  expect((await createVapidResolver(harness.db, {}, "https://openlaw.example")()).subject).toBe(
    "https://openlaw.example",
  );
});
it("sends only the id and staff bell once per live subscription and settles the row", async () => {
  await subscribe();
  await subscribe("two");
  await subscribe("expired", new Date(Date.now() - 1));
  const row = await notification();
  await deliver(row.id);
  expect(received).toHaveLength(2);
  for (const push of received) {
    expect(push.body).toEqual({ notificationId: row.id, surface: "staff" });
    expect(push.headers.ttl).toBe("86400");
    expect(push.headers.urgency).toBe("normal");
    expect(push.headers.authorization).toMatch(/^vapid /);
  }
  expect((await read(row.id)).pushedAt).not.toBeNull();
  await deliver(row.id);
  expect(received).toHaveLength(2);
});
it.each([404, 410])("prunes a %i endpoint and settles skipped when none accepted", async (code) => {
  const subscription = await subscribe();
  status = code;
  const row = await notification();
  await deliver(row.id);
  expect(
    await harness.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, subscription.id)),
  ).toEqual([]);
  expect((await read(row.id)).pushSkippedAt).not.toBeNull();
});
it("rethrows 429 with Retry-After and settles the last failure", async () => {
  await subscribe();
  status = 429;
  const row = await notification();
  await expect(deliver(row.id)).rejects.toMatchObject({ retryAfterSeconds: 120 });
  expect((await read(row.id)).pushSkippedAt).toBeNull();
  await deliver(row.id, 2);
  expect((await read(row.id)).pushSkippedAt).not.toBeNull();
});
it("settles skipped with no live session", async () => {
  const subscription = await subscribe();
  await harness.db.delete(sessions).where(eq(sessions.id, subscription.sessionId));
  const row = await notification();
  await deliver(row.id);
  expect(received).toHaveLength(0);
  expect((await read(row.id)).pushSkippedAt).not.toBeNull();
});
it("rechecks the wall even for an Administrator", async () => {
  await subscribe();
  await harness.db
    .update(contracts)
    .set({ isConfidential: true, managerId: null })
    .where(eq(contracts.id, contractId));
  await harness.db.delete(contractTeam).where(eq(contractTeam.contractId, contractId));
  const row = await notification();
  await deliver(row.id);
  expect(received).toHaveLength(0);
  expect((await read(row.id)).pushSkippedAt).not.toBeNull();
  await harness.db
    .update(contracts)
    .set({ isConfidential: false })
    .where(eq(contracts.id, contractId));
});
it("re-asks old push debt including reminders, but excludes recent and settled rows", async () => {
  const now = new Date();
  const old = new Date(now.getTime() - 16 * 60_000);
  const immediate = await notification({ createdAt: old });
  const reminder = await notification({
    createdAt: old,
    reminderDate: "2026-09-20",
    reminderOffsetDays: 0,
    eventType: "date.key_date_approaching",
  });
  const recent = await notification();
  const sent = await notification({ createdAt: old, pushedAt: now });
  const skipped = await notification({ createdAt: old, pushSkippedAt: now });
  const asked: string[] = [];
  await runMorningRound(
    {
      db: harness.db,
      log,
      notifier: harness.notifier,
      resolveMailer: harness.resolveMailer,
      baseUrl: "http://localhost",
    },
    {
      ...harness.pipeline,
      requestNotificationPush: async (id) => {
        asked.push(id);
      },
    },
    { now },
  );
  expect(asked).toEqual(expect.arrayContaining([immediate.id, reminder.id]));
  expect(asked).not.toEqual(expect.arrayContaining([recent.id]));
  expect(asked).not.toEqual(expect.arrayContaining([sent.id]));
  expect(asked).not.toEqual(expect.arrayContaining([skipped.id]));
});

it("uses the Portal bell for a staff Requester, and rechecks Request archival", async () => {
  await subscribe();
  const [type] = await harness.db.select().from(requestTypes).limit(1);
  const [request] = await harness.db
    .insert(requests)
    .values({
      requestTypeId: type!.id,
      requesterId: userId,
      title: "Staff request",
      urgency: "medium",
    })
    .returning();
  const row = await notification({
    entityType: "request",
    entityId: request!.id,
    eventType: "request.created",
  });
  await deliver(row.id);
  expect(received[0]!.body).toEqual({ notificationId: row.id, surface: "portal" });
  const bell = await harness.app.inject({ url: `/api/v1/portal/notifications/${row.id}`, cookies });
  expect(bell.statusCode).toBe(200);
  await harness.db
    .update(requests)
    .set({ archivedAt: new Date() })
    .where(eq(requests.id, request!.id));
  const hidden = await notification({
    entityType: "request",
    entityId: request!.id,
    eventType: "request.replied",
  });
  await deliver(hidden.id);
  expect(received).toHaveLength(1);
  expect((await read(hidden.id)).pushSkippedAt).not.toBeNull();
});
it("refuses an archived recipient and an unknown entity arm", async () => {
  await subscribe();
  await harness.db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, userId));
  const archived = await notification();
  await deliver(archived.id);
  await harness.db.update(users).set({ archivedAt: null }).where(eq(users.id, userId));
  const unknown = await notification({ entityType: "document" });
  await deliver(unknown.id);
  expect(received).toHaveLength(0);
  expect((await read(archived.id)).pushSkippedAt).not.toBeNull();
  expect((await read(unknown.id)).pushSkippedAt).not.toBeNull();
});
it("the worker defers a 429 on the same job, then delivers its retry", async () => {
  await subscribe();
  status = 429;
  const row = await notification();
  await Promise.all([
    harness.pipeline.requestNotificationPush(row.id),
    harness.pipeline.requestNotificationPush(row.id),
  ]);
  const worker = await startPipeline({
    connectionString: harness.databaseUrl,
    log,
    handlers: {
      db: harness.db,
      storage: harness.storage,
      docEngine: harness.docEngine,
      resolveSigningProvider: harness.resolveSigningProvider,
      resolveAiProvider: harness.resolveAiProvider,
      resolveMailer: harness.resolveMailer,
      resolveVapid: createVapidResolver(harness.db, {}, "https://openlaw.example"),
      baseUrl: "http://localhost",
      log,
    },
  });
  try {
    const jobs = async () =>
      (
        await harness.db.execute<{ id: string; state: string; retry_count: number; delay: number }>(
          sql`select id, state, retry_count, extract(epoch from start_after - now())::float as delay from pgboss.job where name = 'notification.push' and data->>'notificationId' = ${row.id}`,
        )
      ).rows;
    await expect.poll(async () => (await jobs())[0]?.state, { timeout: 15_000 }).toBe("retry");
    const [job] = await jobs();
    expect(job!.delay).toBeGreaterThan(110);
    await harness.pipeline.requestNotificationPush(row.id);
    expect(await jobs()).toHaveLength(1);
    status = 201;
    await harness.db.execute(
      sql`update pgboss.job set start_after = now() where id = ${job!.id}::uuid`,
    );
    await expect
      .poll(async () => (await read(row.id)).pushedAt, { timeout: 15_000 })
      .not.toBeNull();
    expect((await jobs())[0]!.id).toBe(job!.id);
    expect((await jobs())[0]!.retry_count).toBe(1);
    expect(received).toHaveLength(2);
  } finally {
    await worker.stop();
  }
});
it("preserves an unreadable stored key, while a complete env pin still works", async () => {
  const raw = await harness.db.execute<{ private: string; public: string }>(
    sql`select vapid_private_key as private, vapid_public_key as public from org_settings`,
  );
  const original = raw.rows[0]!;
  try {
    await harness.db.execute(
      sql`update org_settings set vapid_private_key = 'openlaw:v1:unreadable'`,
    );
    await expect(harness.app.resolveVapid()).rejects.toThrow(/unreadable/);
    // The public key is stored in the clear, so the pane recovery happens
    // in still answers (TECH-022), and a push owed meanwhile settles skipped
    // with the reason on the log rather than looping.
    const preferences = await harness.app.inject({
      url: "/api/v1/me/notification-preferences",
      cookies,
    });
    expect(preferences.statusCode, preferences.body).toBe(200);
    expect(preferences.json().vapidPublicKey).toBe(original.public);
    await subscribe();
    const row = await notification();
    const errors: Record<string, unknown>[] = [];
    await handleNotificationPush(
      {
        db: harness.db,
        resolveVapid: harness.app.resolveVapid,
        log: {
          ...log,
          error: (fields) => {
            errors.push(fields);
          },
        },
      },
      { notificationId: row.id, retryCount: 2, retryLimit: 2 },
    );
    expect(received).toHaveLength(0);
    expect((await read(row.id)).pushSkippedAt).not.toBeNull();
    expect(errors[0]).toMatchObject({
      notificationId: row.id,
      reason: expect.stringMatching(/unreadable/),
    });
    const keys = webPush.generateVAPIDKeys();
    expect(
      (await createVapidResolver(harness.db, keys, "https://openlaw.example")()).publicKey,
    ).toBe(keys.publicKey);
    const check = await harness.db.execute<{ private: string }>(
      sql`select vapid_private_key as private from org_settings`,
    );
    expect(check.rows[0]!.private).toBe("openlaw:v1:unreadable");
  } finally {
    await harness.db.execute(sql`update org_settings set vapid_private_key = ${original.private}`);
  }
});

it("concurrent first starts generate one pair, and env pins leave an empty database pair untouched", async () => {
  const [original] = await harness.db.select().from(orgSettings);
  try {
    await harness.db.update(orgSettings).set({ vapidPublicKey: null, vapidPrivateKey: null });
    const keys = webPush.generateVAPIDKeys();
    await createVapidResolver(harness.db, keys, "https://openlaw.example")();
    const [empty] = await harness.db.select().from(orgSettings);
    expect(empty!.vapidPrivateKey).toBeNull();
    const resolve = createVapidResolver(harness.db, {}, "https://openlaw.example");
    const results = await Promise.all([resolve(), resolve(), resolve()]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toEqual(results[2]);
  } finally {
    await harness.db.update(orgSettings).set({
      vapidPublicKey: original!.vapidPublicKey,
      vapidPrivateKey: original!.vapidPrivateKey,
    });
  }
});

it("keeps the email worker running when the stored push key is unreadable", async () => {
  const raw = await harness.db.execute<{ private: string }>(
    sql`select vapid_private_key as private from org_settings`,
  );
  const [contract] = await harness.db.select().from(contracts).where(eq(contracts.id, contractId));
  const row = await notification({
    pushOwed: false,
    emailOwed: true,
    payload: { contractTitle: contract!.title, contractNumber: contract!.number },
  });
  const errors: string[] = [];
  let worker: Awaited<ReturnType<typeof startPipeline>> | undefined;
  try {
    await harness.db.execute(
      sql`update org_settings set vapid_private_key = 'openlaw:v1:unreadable'`,
    );
    worker = await startPipeline({
      connectionString: harness.databaseUrl,
      log: {
        ...log,
        error: (_fields, message) => {
          errors.push(message);
        },
      },
      handlers: {
        db: harness.db,
        storage: harness.storage,
        docEngine: harness.docEngine,
        resolveSigningProvider: harness.resolveSigningProvider,
        resolveAiProvider: harness.resolveAiProvider,
        resolveMailer: harness.resolveMailer,
        baseUrl: "https://openlaw.example",
        log,
      },
    });
    expect(errors).toContain("the VAPID pair could not be resolved at worker startup");
    await harness.pipeline.requestNotificationEmail(row.id);
    await expect
      .poll(async () => (await read(row.id)).emailedAt, { timeout: 15_000 })
      .not.toBeNull();
    const stored = await harness.db.execute<{ private: string }>(
      sql`select vapid_private_key as private from org_settings`,
    );
    expect(stored.rows[0]!.private).toBe("openlaw:v1:unreadable");
  } finally {
    await worker?.stop();
    await harness.db.execute(
      sql`update org_settings set vapid_private_key = ${raw.rows[0]!.private}`,
    );
  }
});

it("pushes Requester events to a Business User enrolled through the Portal, with assignment on the staff bell", async () => {
  const person = {
    email: "portal-push@example.com",
    displayName: "Portal Requester",
    password: "portal-test-password",
  }; // NOSONAR — throwaway test account
  const requester = await provisionUser(harness.app.auth, person);
  await harness.db.update(users).set({ role: "business_user" }).where(eq(users.id, requester.id));
  const portalCookies = await signInCookies(harness.app, person.email, person.password);
  const enrolled = await harness.app.inject({
    method: "POST",
    url: "/api/v1/portal/notifications/subscriptions",
    cookies: portalCookies,
    payload: {
      endpoint: `${endpoint}/portal`,
      keys: {
        p256dh: browser.getPublicKey().toString("base64url"),
        auth: auth.toString("base64url"),
      },
    },
  });
  expect(enrolled.statusCode, enrolled.body).toBe(200);
  await subscribe("staff");
  const [type] = await harness.db.select().from(requestTypes).limit(1);
  const [request] = await harness.db
    .insert(requests)
    .values({
      requestTypeId: type!.id,
      requesterId: requester.id,
      title: "Review the Portal NDA",
      urgency: "medium",
    })
    .returning();
  const colleague = {
    ...person,
    email: "portal-push-legal@example.com",
    displayName: "Legal colleague",
  };
  const legal = await provisionUser(harness.app.auth, colleague);
  await harness.db.update(users).set({ role: "legal_team_member" }).where(eq(users.id, legal.id));
  const legalCookies = await signInCookies(harness.app, colleague.email, colleague.password);
  const assigned = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/requests/${request!.number}/assignee`,
    cookies: legalCookies,
    payload: { assigneeId: userId },
  });
  expect(assigned.statusCode, assigned.body).toBe(200);
  expect(assigned.headers["content-type"]).toContain("application/json");
  expect(assigned.json().request.assignee).toMatchObject({ id: userId });
  const replied = await harness.app.inject({
    method: "POST",
    url: "/api/v1/comments",
    cookies,
    payload: {
      entityType: "request",
      entityId: request!.id,
      body: "Legal is reviewing this.",
      visibility: "full_thread",
    },
  });
  expect(replied.statusCode, replied.body).toBe(201);
  expect(replied.headers["content-type"]).toContain("application/json");
  expect(replied.json().comment).toMatchObject({
    body: "Legal is reviewing this.",
    visibility: "full_thread",
  });
  const resolved = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${request!.number}/resolve`,
    cookies,
    payload: { reply: "The existing terms cover this." },
  });
  expect(resolved.statusCode, resolved.body).toBe(200);
  expect(resolved.headers["content-type"]).toContain("application/json");
  expect(resolved.json().request.status).toBe("resolved");
  const [other] = await harness.db
    .insert(requests)
    .values({
      requestTypeId: type!.id,
      requesterId: requester.id,
      title: "Review another Portal NDA",
      urgency: "medium",
    })
    .returning();
  const declined = await harness.app.inject({
    method: "POST",
    url: `/api/v1/requests/${other!.number}/decline`,
    cookies,
    payload: { reason: "Please ask Procurement." },
  });
  expect(declined.statusCode, declined.body).toBe(200);
  expect(declined.headers["content-type"]).toContain("application/json");
  expect(declined.json().request).toMatchObject({
    status: "declined",
    declinedReason: "Please ask Procurement.",
  });
  const rows = await harness.db
    .select()
    .from(notifications)
    .where(inArray(notifications.entityId, [request!.id, other!.id]));
  expect(rows).toHaveLength(5);
  for (const row of rows) {
    const assigned = row.eventType === "request.assigned";
    expect(row.userId).toBe(assigned ? userId : requester.id);
    expect(row.pushOwed).toBe(true);
    await deliver(row.id);
    expect(received.at(-1)!.body).toEqual({
      notificationId: row.id,
      surface: assigned ? "staff" : "portal",
    });
    expect((await read(row.id)).pushedAt).not.toBeNull();
    const portalRead = await harness.app.inject({
      url: `/api/v1/portal/notifications/${row.id}`,
      cookies: portalCookies,
    });
    expect(portalRead.statusCode, portalRead.body).toBe(assigned ? 404 : 200);
    if (!assigned) {
      const source = row.entityId === request!.id ? request! : other!;
      expect(portalRead.json().payload).toMatchObject({
        requestNumber: source.number,
        requestTitle: source.title,
      });
    }
  }
  expect(
    rows
      .filter((row) => row.userId === requester.id)
      .map((row) => row.eventType)
      .sort(),
  ).toEqual(["request.declined", "request.replied", "request.replied", "request.status_changed"]);
  expect(received).toHaveLength(5);
});
