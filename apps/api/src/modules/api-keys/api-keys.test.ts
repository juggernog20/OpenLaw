// SPDX-License-Identifier: AGPL-3.0-only
import { provisionUser } from "../../auth/instance.js";
import { users, eq, orgSettings } from "@openlaw/db";
import { sweepApiKeyExpiry } from "../../pipeline/api-key-expiry.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startHarness,
  signInCookies,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let admin: Record<string, string>;
let member: Record<string, string>;
let business: Record<string, string>;
const url = "/api/v1/api-key-requests";
const ask = { clientName: "Research script", toolsets: ["contracts"], scope: "read" };
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  for (const role of ["legal_team_member", "business_user"]) {
    const email = `${role}@example.com`;
    const person = await provisionUser(h.app.auth, {
      email,
      displayName: role,
      password: TEST_ADMIN.password,
    });
    await h.db
      .update(users)
      .set({ role: role as "business_user" | "legal_team_member" })
      .where(eq(users.id, person.id));
    const cookies = await signInCookies(h.app, email, TEST_ADMIN.password);
    if (role === "business_user") business = cookies;
    else member = cookies;
  }
});
afterAll(async () => {
  await h?.stop();
});
async function policy(payload: Record<string, unknown>) {
  const r = await h.app.inject({
    method: "PATCH",
    url: "/api/v1/mcp-settings",
    cookies: admin,
    payload,
  });
  expect(r.statusCode, r.body).toBe(200);
}
async function request(cookies = member) {
  const r = await h.app.inject({ method: "POST", url, cookies, payload: ask });
  expect(r.statusCode, r.body).toBe(201);
  return r.json();
}
it("names each policy refusal, including the Business Users toggle", async () => {
  for (const [settings, cookies, payload, problem] of [
    [{ enabled: false }, member, ask, "mcp-disabled"],
    [{ enabled: true, legalApiKeysEnabled: false }, member, ask, "api-keys-disabled"],
    [{ businessApiKeysEnabled: false }, business, ask, "api-keys-disabled"],
    [
      { legalApiKeysEnabled: true, toolsetCeiling: ["tasks"] },
      member,
      ask,
      "toolset-outside-ceiling",
    ],
    [
      { toolsetCeiling: ["contracts"], readOnly: true },
      member,
      { ...ask, scope: "write" },
      "mcp-read-only",
    ],
  ] as const) {
    await policy(settings);
    const r = await h.app.inject({ method: "POST", url, cookies, payload });
    expect(r.statusCode, r.body).toBe(403);
    expect(r.json().type).toBe(`urn:openlaw:problem:${problem}`);
  }
  await policy({ readOnly: false, businessApiKeysEnabled: true });
});
it("approves in another session and gives only one concurrent owner read the key", async () => {
  const pending = await request();
  const approved = await h.app.inject({
    method: "POST",
    url: `${url}/${pending.id}/approve`,
    cookies: admin,
    payload: { note: "Approved for research" },
  });
  expect(approved.statusCode, approved.body).toBe(200);
  expect(approved.json().key).toBeUndefined();
  const stored = await h.db.$client.query(
    "select sealed_key, key_id from api_key_requests where id = $1",
    [pending.id],
  );
  expect(stored.rows[0].sealed_key).toMatch(/^openlaw:v1:/);
  expect(stored.rows[0].key_id).toBeTruthy();
  const reads = await Promise.all(
    [1, 2].map(() => h.app.inject({ method: "GET", url: `${url}/${pending.id}`, cookies: member })),
  );
  const keys = reads.map((r) => r.json().key).filter(Boolean);
  expect(keys).toHaveLength(1);
  expect(keys[0]).toMatch(/^ol_/);
  expect(
    (
      await h.db.$client.query("select sealed_key from api_key_requests where id = $1", [
        pending.id,
      ])
    ).rows[0].sealed_key,
  ).toBeNull();
  expect(
    (await h.app.inject({ method: "GET", url: `${url}/${pending.id}`, cookies: business }))
      .statusCode,
  ).toBe(404);
  expect(
    (await h.app.inject({ method: "GET", url: `${url}/${pending.id}`, cookies: member })).json()
      .key,
  ).toBeUndefined();
});
it("self-approves and returns the key in the request transaction only", async () => {
  const approved = await request(admin);
  expect(approved.status).toBe("active");
  expect(approved.key).toMatch(/^ol_/);
  expect(
    (await h.app.inject({ method: "GET", url: `${url}/${approved.id}`, cookies: admin })).json()
      .key,
  ).toBeUndefined();
  const rows = await h.db.$client.query("select sealed_key from api_key_requests where id = $1", [
    approved.id,
  ]);
  expect(rows.rows[0].sealed_key).toBeNull();
  const audit = await h.db.$client.query(
    "select action, visibility, payload from activity_log where payload->>'requestId' = $1",
    [approved.id],
  );
  expect(audit.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        action: "api_key.approved",
        visibility: "admin_only",
        payload: expect.objectContaining({ selfApproved: true }),
      }),
      expect.objectContaining({ action: "api_key.minted", visibility: "admin_only" }),
    ]),
  );
});
it("denies with a note, cancels, and retains revoked Business User keys", async () => {
  const denied = await request();
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: `${url}/${denied.id}/deny`,
        cookies: admin,
        payload: { note: "Use the other Client" },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await h.app.inject({ method: "GET", url: `${url}/${denied.id}`, cookies: member })).json(),
  ).toMatchObject({ status: "denied", decisionNote: "Use the other Client" });
  const cancelled = await request();
  expect(
    (await h.app.inject({ method: "POST", url: `${url}/${cancelled.id}/cancel`, cookies: member }))
      .statusCode,
  ).toBe(200);
  const portal = await request(business);
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: `${url}/${portal.id}/approve`,
        cookies: member,
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  await h.app.inject({
    method: "POST",
    url: `${url}/${portal.id}/approve`,
    cookies: admin,
    payload: {},
  });
  expect(
    (await h.app.inject({ method: "POST", url: `${url}/${portal.id}/revoke`, cookies: business }))
      .statusCode,
  ).toBe(200);
  const list = await h.app.inject({ method: "GET", url, cookies: business });
  expect(list.json().requests).toContainEqual(
    expect.objectContaining({ id: portal.id, status: "revoked" }),
  );
});
it("refuses direct plugin management and API keys as browser sessions", async () => {
  const approved = await request(admin);
  expect(
    (
      await h.app.inject({
        method: "POST",
        url: "/api/auth/api-key/create",
        cookies: admin,
        payload: { name: "bypass" },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await h.app.inject({ method: "GET", url, headers: { "x-api-key": approved.key } })).statusCode,
  ).toBe(401);
});

it("derives expiry before the sweep and audits it once across concurrent sweeps", async () => {
  const key = await request(admin);
  await h.db.$client.query(
    "update api_keys set expires_at = now() - interval '1 second' where id = (select key_id from api_key_requests where id = $1)",
    [key.id],
  );
  expect(
    (await h.app.inject({ method: "GET", url: `${url}/${key.id}`, cookies: admin })).json().status,
  ).toBe("expired");
  await Promise.all([sweepApiKeyExpiry(h.db), sweepApiKeyExpiry(h.db)]);
  await sweepApiKeyExpiry(h.db);
  const audit = await h.db.$client.query(
    "select visibility from activity_log where action = 'api_key.expired' and payload->>'requestId' = $1",
    [key.id],
  );
  expect(audit.rows).toEqual([{ visibility: "admin_only" }]);
  await request(admin);
  expect(
    (await h.app.inject({ method: "GET", url: `${url}/${key.id}`, cookies: admin })).json().status,
  ).toBe("expired");
});
it("notifies every Administrator and the requester, with email preferences and no secret", async () => {
  const second = await provisionUser(h.app.auth, {
    email: "second-admin@example.com",
    displayName: "Second Administrator",
    password: TEST_ADMIN.password,
  });
  await h.db.update(users).set({ role: "administrator" }).where(eq(users.id, second.id));
  const secondCookies = await signInCookies(h.app, "second-admin@example.com", TEST_ADMIN.password);
  await h.app.inject({
    method: "PATCH",
    url: "/api/v1/me/notification-preferences",
    cookies: secondCookies,
    payload: { eventGroup: "assigned_to_you", channel: "email", enabled: false },
  });
  const pending = await request();
  const bell = await h.db.$client.query(
    "select user_id, email_owed, payload from notifications where event_type = 'api_key.requested' and entity_id = $1",
    [pending.id],
  );
  expect(bell.rows).toHaveLength(2);
  expect(bell.rows.find((r) => r.user_id === second.id).email_owed).toBe(false);
  expect(bell.rows.filter((r) => r.email_owed)).toHaveLength(1);
  for (const cookies of [admin, secondCookies]) {
    const items = await h.app.inject({ method: "GET", url: "/api/v1/notifications", cookies });
    expect(items.statusCode, items.body).toBe(200);
    expect(items.body).toContain(pending.id);
  }
  await h.app.inject({
    method: "POST",
    url: `${url}/${pending.id}/approve`,
    cookies: secondCookies,
    payload: {},
  });
  const items = await h.app.inject({
    method: "GET",
    url: "/api/v1/notifications",
    cookies: member,
  });
  expect(items.body).toContain(pending.id);
  expect(items.body).not.toContain("ol_");
  await expect
    .poll(
      () =>
        h.mailer
          .messagesTo(TEST_ADMIN.email)
          .some((m) => m.subject === "API key request needs approval"),
      { timeout: 10000 },
    )
    .toBe(true);
  await expect
    .poll(
      () =>
        h.mailer
          .messagesTo("legal_team_member@example.com")
          .some((m) => m.subject === "API key request was approved"),
      { timeout: 10000 },
    )
    .toBe(true);
  expect(
    h.mailer
      .messagesTo("second-admin@example.com")
      .some((m) => m.subject === "API key request needs approval"),
  ).toBe(false);
  const denied = await request(business);
  await h.app.inject({
    method: "POST",
    url: `${url}/${denied.id}/deny`,
    cookies: admin,
    payload: { note: "Please use Legal's Client" },
  });
  const portal = await h.app.inject({
    method: "GET",
    url: "/api/v1/portal/notifications",
    cookies: business,
  });
  expect(portal.body).toContain(denied.id);
  await expect
    .poll(
      () =>
        h.mailer
          .messagesTo("business_user@example.com")
          .some(
            (m) =>
              m.text.includes("/portal/settings/api-keys") &&
              m.subject === "API key request was denied",
          ),
      { timeout: 10000 },
    )
    .toBe(true);
});
it("allows only one decision and rechecks policy at approval", async () => {
  const pending = await request();
  await policy({ enabled: false });
  const refused = await h.app.inject({
    method: "POST",
    url: `${url}/${pending.id}/approve`,
    cookies: admin,
    payload: {},
  });
  expect(refused.statusCode).toBe(403);
  await policy({ enabled: true });
  const decisions = await Promise.all(
    ["approve", "deny"].map((action) =>
      h.app.inject({
        method: "POST",
        url: `${url}/${pending.id}/${action}`,
        cookies: admin,
        payload: {},
      }),
    ),
  );
  expect(decisions.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const rows = await h.db.$client.query(
    "select action from activity_log where payload->>'requestId' = $1 and action in ('api_key.approved', 'api_key.denied')",
    [pending.id],
  );
  expect(rows.rows).toHaveLength(1);
});
it("rolls back mint, approval and notification together when the audit write fails", async () => {
  const pending = await request();
  await h.db.$client.query(
    "CREATE FUNCTION reject_api_key_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'api_key.approved' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$",
  );
  await h.db.$client.query(
    "CREATE TRIGGER reject_api_key_audit BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION reject_api_key_audit()",
  );
  try {
    expect(
      (
        await h.app.inject({
          method: "POST",
          url: `${url}/${pending.id}/approve`,
          cookies: admin,
          payload: {},
        })
      ).statusCode,
    ).toBe(500);
    expect(
      (
        await h.db.$client.query(
          "select status, key_id, sealed_key from api_key_requests where id = $1",
          [pending.id],
        )
      ).rows,
    ).toEqual([{ status: "pending", key_id: null, sealed_key: null }]);
    expect(
      (
        await h.db.$client.query(
          "select id from api_keys where id not in (select key_id from api_key_requests where key_id is not null)",
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await h.db.$client.query("DROP TRIGGER reject_api_key_audit ON activity_log");
    await h.db.$client.query("DROP FUNCTION reject_api_key_audit()");
  }
});
it("records every lifecycle action at admin_only and keeps keys hashed", async () => {
  const rows = await h.db.$client.query(
    "select action, visibility from activity_log where action like 'api_key.%'",
  );
  for (const action of [
    "requested",
    "minted",
    "approved",
    "denied",
    "cancelled",
    "revoked",
    "expired",
  ]) {
    expect(rows.rows).toContainEqual({ action: `api_key.${action}`, visibility: "admin_only" });
  }
  expect(rows.rows.every((r) => r.visibility === "admin_only")).toBe(true);
  const approved = await request(admin);
  const stored = await h.db.$client.query(
    "select key, rate_limit_enabled from api_keys where id = (select key_id from api_key_requests where id = $1)",
    [approved.id],
  );
  expect(stored.rows[0].key).not.toBe(approved.key);
  // TECH-035: the calls-per-hour limit lives in Advanced, not on the plugin row.
  expect(stored.rows[0].rate_limit_enabled).toBe(false);
  const verified = await h.app.auth.api.verifyApiKey({ body: { key: approved.key } });
  expect(verified.valid).toBe(true);
  await h.app.inject({ method: "POST", url: `${url}/${approved.id}/revoke`, cookies: admin });
  expect((await h.app.auth.api.verifyApiKey({ body: { key: approved.key } })).valid).toBe(false);
});
it("lets only an Administrator list and revoke another person's key", async () => {
  const pending = await request();
  await h.app.inject({
    method: "POST",
    url: `${url}/${pending.id}/approve`,
    cookies: admin,
    payload: {},
  });
  expect(
    (await h.app.inject({ method: "GET", url: "/api/v1/mcp-settings/api-keys", cookies: member }))
      .statusCode,
  ).toBe(403);
  const listed = await h.app.inject({
    method: "GET",
    url: "/api/v1/mcp-settings/api-keys",
    cookies: admin,
  });
  expect(listed.statusCode, listed.body).toBe(200);
  expect(listed.json()).toContainEqual(
    expect.objectContaining({ id: pending.id, status: "active", keyAvailable: false }),
  );
  expect(
    (await h.app.inject({ method: "POST", url: `${url}/${pending.id}/revoke`, cookies: business }))
      .statusCode,
  ).toBe(404);
  const revoked = await h.app.inject({
    method: "POST",
    url: `${url}/${pending.id}/revoke`,
    cookies: admin,
  });
  expect(revoked.statusCode, revoked.body).toBe(200);
  expect(revoked.json().status).toBe("revoked");
  expect(
    (await h.app.inject({ method: "GET", url: `${url}/${pending.id}`, cookies: member })).json(),
  ).toMatchObject({ status: "revoked", keyAvailable: false });
});
it("stores an empty note as null", async () => {
  const pending = await request();
  await h.app.inject({
    method: "POST",
    url: `${url}/${pending.id}/deny`,
    cookies: admin,
    payload: { note: "   " },
  });
  const rows = await h.db.$client.query(
    "select decision_note from api_key_requests where id = $1",
    [pending.id],
  );
  expect(rows.rows).toEqual([{ decision_note: null }]);
});

it.each(["approve", "deny", "cancel"] as const)(
  "%s handles every Administrator's open item on both bells",
  async (action) => {
    const pending = await request();
    for (const root of ["/api/v1/notifications", "/api/v1/portal/notifications"]) {
      const list = await h.app.inject({ method: "GET", url: root, cookies: admin });
      const item = list
        .json()
        .notifications.find((row: { entityId: string }) => row.entityId === pending.id);
      expect(item).toMatchObject({ approvalKind: "api_key", handledAt: null });
      const before = await h.app.inject({
        method: "GET",
        url: `${root}/unread-count`,
        cookies: admin,
      });
      expect(before.statusCode, before.body).toBe(200);
      const read = await h.app.inject({
        method: "POST",
        url: `${root}/read`,
        cookies: admin,
        payload: { ids: [item.id] },
      });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json().unread).toBe(before.json().unread);
      const readAll = await h.app.inject({
        method: "POST",
        url: `${root}/read-all`,
        cookies: admin,
      });
      expect(readAll.statusCode, readAll.body).toBe(200);
      const openItems = list
        .json()
        .notifications.filter(
          (row: { approvalKind: string | null; handledAt: string | null }) =>
            row.approvalKind !== null && row.handledAt === null,
        );
      expect(openItems.map((row: { id: string }) => row.id)).toContain(item.id);
      expect(readAll.json().unread).toBe(openItems.length);
    }
    const response = await h.app.inject({
      method: "POST",
      url: `${url}/${pending.id}/${action}`,
      cookies: action === "cancel" ? member : admin,
      ...(action !== "cancel" ? { payload: {} } : {}),
    });
    expect(response.statusCode, response.body).toBe(200);
    const rows = await h.db.$client.query(
      "select approval_kind, handled_at, read_at from notifications where event_type = 'api_key.requested' and entity_id = $1",
      [pending.id],
    );
    expect(rows.rows.length).toBeGreaterThan(1);
    expect(
      rows.rows.every((row) => row.approval_kind === "api_key" && row.handled_at && row.read_at),
    ).toBe(true);
  },
);

it("refuses audience-ineligible and empty Toolsets and rechecks the audience at approval", async () => {
  const [before] = await h.db.select().from(orgSettings);
  const [owner] = await h.db
    .select()
    .from(users)
    .where(eq(users.email, "legal_team_member@example.com"));
  try {
    await policy({
      enabled: true,
      legalApiKeysEnabled: true,
      businessApiKeysEnabled: true,
      readOnly: false,
      toolsetCeiling: ["tasks", "team", "administration"],
    });
    for (const [cookies, toolsets] of [
      [business, ["tasks"]],
      [member, ["team"]],
      [admin, ["administration"]],
    ] as const) {
      const response = await h.app.inject({
        method: "POST",
        url,
        cookies,
        payload: { ...ask, toolsets },
      });
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().type).toBe("urn:openlaw:problem:toolset-outside-ceiling");
    }
    const pending = await h.app.inject({
      method: "POST",
      url,
      cookies: member,
      payload: { ...ask, toolsets: ["tasks"] },
    });
    expect(pending.statusCode, pending.body).toBe(201);
    await h.db.update(users).set({ role: "business_user" }).where(eq(users.id, owner!.id));
    const approved = await h.app.inject({
      method: "POST",
      url: `${url}/${pending.json().id}/approve`,
      cookies: admin,
      payload: {},
    });
    expect(approved.statusCode, approved.body).toBe(403);
    expect(approved.json().type).toBe("urn:openlaw:problem:toolset-outside-ceiling");
    const current = await h.app.inject({
      method: "GET",
      url: `${url}/${pending.json().id}`,
      cookies: member,
    });
    expect(current.statusCode, current.body).toBe(200);
    expect(current.json()).toMatchObject({ status: "pending", keyAvailable: false });
    expect(current.json()).not.toHaveProperty("key");
  } finally {
    await h.db.update(users).set({ role: owner!.role }).where(eq(users.id, owner!.id));
    await h.db.update(orgSettings).set({
      mcpEnabled: before!.mcpEnabled,
      mcpLegalApiKeysEnabled: before!.mcpLegalApiKeysEnabled,
      mcpBusinessApiKeysEnabled: before!.mcpBusinessApiKeysEnabled,
      mcpReadOnly: before!.mcpReadOnly,
      mcpToolsetCeiling: before!.mcpToolsetCeiling,
    });
  }
});
