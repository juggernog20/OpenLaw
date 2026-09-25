// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from "vitest";
import { activityLog, eq, mcpToolCalls, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let h: TestHarness;
let admin: Record<string, string>;
const others: Record<string, string>[] = [];
let personId: string;
const instant = "2026-09-23T12:00:00.000Z";
const path = "/api/v1/audit-log/tool-calls";
beforeAll(async () => {
  h = await startHarness();
  await h.app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: TEST_ADMIN });
  admin = await signInCookies(h.app, TEST_ADMIN.email, TEST_ADMIN.password);
  for (const role of ["legal_team_member", "business_user"] as const) {
    const fixture = {
      email: `${role}@example.com`,
      displayName: "=Person",
      password: "correct-horse-battery",
    };
    const person = await provisionUser(h.app.auth, fixture);
    await h.db.update(users).set({ role }).where(eq(users.id, person.id));
    others.push(await signInCookies(h.app, fixture.email, fixture.password));
    personId = person.id;
  }
  await h.db.insert(mcpToolCalls).values(
    Array.from({ length: 503 }, (_, i) => ({
      personId,
      credentialId: "credential-metadata",
      clientName: '=Client,"quoted"',
      tool: `openlaw_test_${String(i).padStart(3, "0")}`,
      outcome: i % 2 ? "success" : "error",
      durationMs: i,
      requestId: `request-${i}`,
      createdAt: new Date(instant),
    })),
  );
  await h.db.insert(mcpToolCalls).values({
    personId,
    credentialId: "old",
    clientName: "Old Client",
    tool: "openlaw_old",
    outcome: "success",
    durationMs: 1,
    requestId: "old",
    createdAt: new Date("2026-09-21T00:00:00Z"),
  });
});
afterAll(async () => {
  await h?.stop();
});

it("requires an Administrator for reads and exports", async () => {
  for (const url of [path, `${path}/export`]) {
    expect((await h.app.inject({ method: "GET", url })).statusCode).toBe(401);
    for (const cookies of others) {
      expect((await h.app.inject({ method: "GET", url, cookies })).statusCode).toBe(403);
    }
  }
});
it("pages every call newest first with stable ties and inclusive date bounds", async () => {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const response = await h.app.inject({
      method: "GET",
      url: path,
      cookies: admin,
      query: { from: instant, to: instant, ...(cursor ? { cursor } : {}) },
    });
    expect(response.statusCode, response.body).toBe(200);
    const page: { entries: { id: string }[]; nextCursor: string | null } = response.json();
    expect(page.entries.length).toBeLessThanOrEqual(50);
    for (const row of page.entries) {
      expect(row).toEqual({
        id: expect.any(String),
        createdAt: instant,
        person: { id: personId, displayName: "=Person" },
        clientName: '=Client,"quoted"',
        tool: expect.stringMatching(/^openlaw_test_/),
        outcome: expect.stringMatching(/success|error/),
        durationMs: expect.any(Number),
      });
      ids.push(row.id);
    }
    cursor = page.nextCursor;
  } while (cursor);
  expect(ids).toHaveLength(503);
  expect(new Set(ids).size).toBe(503);
  expect(ids).toEqual([...ids].sort().reverse());
  const missing = await h.app.inject({
    method: "GET",
    url: path,
    cookies: admin,
    query: { cursor: "missing" },
  });
  expect(missing.json()).toEqual({ entries: [], nextCursor: null });
  const empty = await h.app.inject({
    method: "GET",
    url: path,
    cookies: admin,
    query: { to: "2020-01-01T00:00:00Z" },
  });
  expect(empty.json()).toEqual({ entries: [], nextCursor: null });
});
it("exports the entire filtered set across chunks, escapes CSV and records the export", async () => {
  const response = await h.app.inject({
    method: "GET",
    url: `${path}/export`,
    cookies: admin,
    query: { from: instant, to: instant },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.headers["content-type"]).toContain("text/csv");
  expect(response.headers["content-disposition"]).toContain("attachment;");
  const lines = response.body.trim().split("\r\n");
  expect(lines).toHaveLength(504);
  expect(lines[0]).toBe(
    '"id","created_at","person_id","person_name","client_name","tool","outcome","duration_ms"',
  );
  expect(response.body).toContain('"\'=Person","\'=Client,""quoted"""');
  expect(response.body).not.toContain("openlaw_old");
  expect(response.body).not.toContain("credential-metadata");
  const events = await h.db
    .select()
    .from(activityLog)
    .where(eq(activityLog.action, "export.performed"));
  expect(events.at(-1)).toMatchObject({
    visibility: "admin_only",
    payload: { surface: "mcp_tool_calls", format: "csv", filters: { from: instant, to: instant } },
  });
});
it("rejects invalid dates on both routes", async () => {
  for (const url of [path, `${path}/export`]) {
    const response = await h.app.inject({
      method: "GET",
      url,
      cookies: admin,
      query: { from: "yesterday" },
    });
    expect(response.statusCode).toBe(400);
  }
});
