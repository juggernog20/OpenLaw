// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, and, asc, eq } from "@openlaw/db";
import {
  signIn,
  signInCookies,
  startHarness,
  TEST_ADMIN,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let adminCookies: Record<string, string>;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

async function listUsers(cookies?: Record<string, string>) {
  return harness.app.inject({ method: "GET", url: "/api/v1/users", cookies });
}

let seq = 0;

/** Invites a user, walks the set-password activation, and signs them in —
 * the shortest path to a real activated user with a live session. */
async function activatedUser(role: "administrator" | "legal_team_member" | "contributor") {
  seq += 1;
  const email = `person-${seq}@example.com`;
  const password = `their-own-password-${seq}`;
  const invited = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/invites",
    cookies: adminCookies,
    payload: { email, displayName: `Person ${seq}`, role },
  });
  expect(invited.statusCode, invited.body).toBe(201);
  const id = (invited.json() as { user: { id: string } }).user.id;
  const token = tokenFrom(harness.mailer.messagesTo(email).at(-1)!.text);
  const reset = await harness.app.inject({
    method: "POST",
    url: "/api/auth/reset-password",
    payload: { newPassword: password, token },
  });
  expect(reset.statusCode, reset.body).toBe(200);
  const cookies = await signInCookies(harness.app, email, password);
  return { id, email, password, cookies };
}

async function changeRole(userId: string, role: string, cookies?: Record<string, string>) {
  return harness.app.inject({
    method: "PATCH",
    url: `/api/v1/users/${userId}/role`,
    cookies,
    payload: { role },
  });
}

async function post(action: string, userId: string, cookies?: Record<string, string>) {
  return harness.app.inject({
    method: "POST",
    url: `/api/v1/users/${userId}/${action}`,
    cookies,
  });
}

async function adminId(): Promise<string> {
  const res = await listUsers(adminCookies);
  const { users } = res.json() as { users: { id: string; email: string }[] };
  return users.find((user) => user.email === TEST_ADMIN.email)!.id;
}

describe("the Users list (GET /api/v1/users, SET-005)", () => {
  it("lists every user with role, status, and last-active; a pending invite is a row", async () => {
    const invited = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/invites",
      cookies: adminCookies,
      payload: { email: "pat@example.com", displayName: "Pat Osei", role: "contributor" },
    });
    expect(invited.statusCode, invited.body).toBe(201);

    const res = await listUsers(adminCookies);
    expect(res.statusCode, res.body).toBe(200);
    const { users } = res.json() as {
      users: {
        id: string;
        email: string;
        displayName: string;
        role: string;
        status: string;
        lastActiveAt: string | null;
      }[];
    };

    // The Administrator signed in, so the session hook has stamped them.
    const admin = users.find((user) => user.email === TEST_ADMIN.email);
    expect(admin).toMatchObject({ role: "administrator", status: "active" });
    expect(admin?.lastActiveAt).toBeTruthy();

    // The pending invite renders as a row, not a fire-and-forget.
    const pat = users.find((user) => user.email === "pat@example.com");
    expect(pat).toMatchObject({
      displayName: "Pat Osei",
      role: "contributor",
      status: "invited",
      lastActiveAt: null,
    });

    // Oldest first: the install's Administrator leads the list.
    expect(users[0]?.email).toBe(TEST_ADMIN.email);
  });

  it("flips an invite to active once the invitee activates and signs in", async () => {
    const token = tokenFrom(harness.mailer.messagesTo("pat@example.com")[0]!.text);
    const reset = await harness.app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { newPassword: "pat-sets-his-own-1", token },
    });
    expect(reset.statusCode, reset.body).toBe(200);
    await signInCookies(harness.app, "pat@example.com", "pat-sets-his-own-1");

    const res = await listUsers(adminCookies);
    const pat = (
      res.json() as { users: { email: string; status: string; lastActiveAt: string | null }[] }
    ).users.find((user) => user.email === "pat@example.com");
    expect(pat?.status).toBe("active");
    expect(pat?.lastActiveAt).toBeTruthy();
  });

  it("holds the Administrator gate: 401 signed out, 403 for other roles", async () => {
    const anonymous = await listUsers();
    expect(anonymous.statusCode).toBe(401);

    const patCookies = await signInCookies(harness.app, "pat@example.com", "pat-sets-his-own-1");
    const forbidden = await listUsers(patCookies);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.headers["content-type"]).toContain("application/problem+json");
  });
});

describe("role edits (PATCH /api/v1/users/:userId/role, SET-005 #66)", () => {
  it("changes the role in place, effective on the target's next request", async () => {
    const person = await activatedUser("contributor");

    // A Contributor cannot read the Users pane…
    expect((await listUsers(person.cookies)).statusCode).toBe(403);

    // …until the Administrator promotes them. Same session, no ceremony:
    // the guard chain reads the role live on every request.
    const promoted = await changeRole(person.id, "administrator", adminCookies);
    expect(promoted.statusCode, promoted.body).toBe(200);
    expect(promoted.json()).toMatchObject({ user: { role: "administrator", status: "active" } });
    expect((await listUsers(person.cookies)).statusCode).toBe(200);

    // Demotion cuts the other way, equally immediately.
    const demoted = await changeRole(person.id, "contributor", adminCookies);
    expect(demoted.statusCode, demoted.body).toBe(200);
    expect((await listUsers(person.cookies)).statusCode).toBe(403);
  });

  it("refuses demoting the last Administrator", async () => {
    // The floor test only means anything with exactly one Administrator
    // standing — hold that precondition explicitly so test reordering
    // (or a stray promotion above) fails loudly here, not mysteriously.
    const listed = (await listUsers(adminCookies)).json() as { users: { role: string }[] };
    expect(listed.users.filter((user) => user.role === "administrator")).toHaveLength(1);

    const refused = await changeRole(await adminId(), "legal_team_member", adminCookies);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({
      detail: "You cannot demote the last Administrator.",
    });
  });

  it("404s on an unknown user and holds the Administrator gate", async () => {
    expect((await changeRole("no-such-user", "contributor", adminCookies)).statusCode).toBe(404);
    expect((await changeRole("any", "contributor")).statusCode).toBe(401);
    const person = await activatedUser("legal_team_member");
    expect((await changeRole(person.id, "contributor", person.cookies)).statusCode).toBe(403);
  });
});

describe("user archive (POST /api/v1/users/:userId/archive, SET-005 #66)", () => {
  it("blocks sign-in and kills live sessions immediately", async () => {
    const person = await activatedUser("legal_team_member");
    expect(
      (await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies: person.cookies }))
        .statusCode,
    ).toBe(200);

    const archived = await post("archive", person.id, adminCookies);
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json()).toMatchObject({ user: { status: "archived" } });

    // The proof SET-005 asks for: the existing session fails its very
    // next request — an archived person must not outlive their session.
    const nextRequest = await harness.app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: person.cookies,
    });
    expect(nextRequest.statusCode).toBe(401);

    // The door is barred too: a fresh sign-in is refused outright.
    expect((await signIn(harness.app, person.email, person.password)).statusCode).toBe(403);

    // The list keeps the row, behind the Archived filter's status.
    const listed = (await listUsers(adminCookies)).json() as {
      users: { id: string; status: string }[];
    };
    expect(listed.users.find((user) => user.id === person.id)?.status).toBe("archived");
  });

  it("refuses the last Administrator and refuses archiving yourself", async () => {
    // With one Administrator, the floor speaks first — even to yourself.
    const self = await adminId();
    const floor = await post("archive", self, adminCookies);
    expect(floor.statusCode, floor.body).toBe(409);
    expect(floor.json()).toMatchObject({
      detail: "You cannot archive the last Administrator.",
    });

    // With a second Administrator the floor clears; self-archive is still
    // refused on its own terms.
    const other = await activatedUser("administrator");
    const refused = await post("archive", self, adminCookies);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ detail: "You cannot archive yourself." });
    expect((await changeRole(other.id, "contributor", adminCookies)).statusCode).toBe(200);
  });

  it("409s on an already-archived user; 404 unknown; gate holds", async () => {
    const person = await activatedUser("contributor");
    expect((await post("archive", person.id, adminCookies)).statusCode).toBe(200);
    const again = await post("archive", person.id, adminCookies);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ detail: "This user is already archived." });

    expect((await post("archive", "no-such-user", adminCookies)).statusCode).toBe(404);
    expect((await post("archive", person.id)).statusCode).toBe(401);
    const outsider = await activatedUser("contributor");
    expect((await post("archive", person.id, outsider.cookies)).statusCode).toBe(403);
  });
});

describe("user unarchive (POST /api/v1/users/:userId/unarchive, SET-003 recovery)", () => {
  it("restores an archived user, who can sign in again", async () => {
    const person = await activatedUser("legal_team_member");
    expect((await post("archive", person.id, adminCookies)).statusCode).toBe(200);
    expect((await signIn(harness.app, person.email, person.password)).statusCode).toBe(403);

    const restored = await post("unarchive", person.id, adminCookies);
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({ user: { status: "active" } });

    // The door reopens — but the sessions archive killed stay dead.
    expect((await signIn(harness.app, person.email, person.password)).statusCode).toBe(200);
    const oldSession = await harness.app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: person.cookies,
    });
    expect(oldSession.statusCode).toBe(401);
  });

  it("409s on a user who is not archived; 404 unknown; gate holds", async () => {
    const person = await activatedUser("contributor");
    const refused = await post("unarchive", person.id, adminCookies);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ detail: "This user is not archived." });
    expect((await post("unarchive", "no-such-user", adminCookies)).statusCode).toBe(404);
    expect((await post("unarchive", person.id, person.cookies)).statusCode).toBe(403);
  });
});

describe("session revocation (POST /api/v1/users/:userId/revoke-sessions, SET-005 #66)", () => {
  it("kills every live session; the user signs back in unharmed", async () => {
    const person = await activatedUser("contributor");
    // The lost-laptop case has two devices, so mint a second session.
    const laptop = await signInCookies(harness.app, person.email, person.password);

    const revoked = await post("revoke-sessions", person.id, adminCookies);
    expect(revoked.statusCode, revoked.body).toBe(204);

    for (const cookies of [person.cookies, laptop]) {
      const next = await harness.app.inject({ method: "GET", url: "/api/v1/me", cookies });
      expect(next.statusCode).toBe(401);
    }

    // Revocation is not archival: the account itself is untouched.
    expect((await signIn(harness.app, person.email, person.password)).statusCode).toBe(200);
  });

  it("404s on an unknown user and holds the Administrator gate", async () => {
    expect((await post("revoke-sessions", "no-such-user", adminCookies)).statusCode).toBe(404);
    expect((await post("revoke-sessions", "any")).statusCode).toBe(401);
    const person = await activatedUser("contributor");
    expect((await post("revoke-sessions", person.id, person.cookies)).statusCode).toBe(403);
  });
});

describe("the DD-017 audit trail (#66)", () => {
  /** Scoped to the subject, so entries other tests wrote for the same
   * action can never satisfy an assertion here. */
  function entries(action: string, entityId: string) {
    return harness.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.action, action), eq(activityLog.entityId, entityId)))
      .orderBy(asc(activityLog.createdAt));
  }

  it("logs every mutation: role change, archive, unarchive, revocation", async () => {
    const admin = await adminId();
    const person = await activatedUser("contributor");
    expect((await changeRole(person.id, "legal_team_member", adminCookies)).statusCode).toBe(200);
    expect((await post("revoke-sessions", person.id, adminCookies)).statusCode).toBe(204);
    expect((await post("archive", person.id, adminCookies)).statusCode).toBe(200);
    expect((await post("unarchive", person.id, adminCookies)).statusCode).toBe(200);

    const changed = (await entries("user.role_changed", person.id)).at(-1);
    expect(changed).toMatchObject({
      entityType: "user",
      entityId: person.id,
      actorId: admin,
      visibility: "admin_only",
      payload: { email: person.email, from: "contributor", to: "legal_team_member" },
    });

    const revoked = (await entries("user.sessions_revoked", person.id)).at(-1);
    expect(revoked).toMatchObject({
      entityId: person.id,
      actorId: admin,
      payload: { email: person.email, sessions: 1 },
    });

    const archived = (await entries("user.archived", person.id)).at(-1);
    expect(archived).toMatchObject({
      entityId: person.id,
      actorId: admin,
      payload: { email: person.email, role: "legal_team_member" },
    });

    const unarchived = (await entries("user.unarchived", person.id)).at(-1);
    expect(unarchived).toMatchObject({
      entityId: person.id,
      actorId: admin,
      payload: { email: person.email, role: "legal_team_member" },
    });
  });
});
