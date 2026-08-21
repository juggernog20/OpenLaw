// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, users } from "@openlaw/db";
import { startHarness, type TestHarness } from "../../testing/harness.js";

let h: TestHarness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h.stop();
});

describe("first-run setup", () => {
  it("reports setup needed on an empty database", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/v1/auth/setup" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ needsSetup: true });
  });

  it("creates the first Administrator with a live session", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/setup",
      payload: {
        email: "gc@example.com",
        displayName: "Grace Counsel",
        password: "correct-horse-battery",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user).toMatchObject({
      email: "gc@example.com",
      displayName: "Grace Counsel",
      role: "administrator",
    });
    const cookies = res.cookies.map((c) => c.name);
    expect(cookies.some((name) => name.includes("session_token"))).toBe(true);

    const status = await h.app.inject({ method: "GET", url: "/api/v1/auth/setup" });
    expect(status.json()).toEqual({ needsSetup: false });
  });

  it("rejects setup once a user exists", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/auth/setup",
      payload: {
        email: "intruder@example.com",
        displayName: "Intruder",
        password: "correct-horse-battery",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });

  it("refuses public registration even with the database empty", async () => {
    await h.db.delete(users);
    // Sign-up is closed at the config level, so the mounted better-auth
    // handler rejects it whether or not setup has run — an empty database
    // is not an open door.
    const res = await h.app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      payload: { email: "walkin@example.com", password: "correct-horse-battery", name: "Walk In" },
    });
    expect(res.statusCode).toBe(400);
    const rows = await h.db.select({ id: users.id }).from(users);
    expect(rows).toHaveLength(0);
  });
});

describe("concurrent first-run setup", () => {
  it("creates exactly one Administrator when requests race", async () => {
    await h.db.delete(users);

    const attempts = Array.from({ length: 6 }, (_, i) =>
      h.app.inject({
        method: "POST",
        url: "/api/v1/auth/setup",
        payload: {
          email: `racer${i}@example.com`,
          displayName: `Racer ${i}`,
          password: "correct-horse-battery",
        },
      }),
    );
    const results = await Promise.all(attempts);

    const created = results.filter((r) => r.statusCode === 201);
    expect(created).toHaveLength(1);
    const winner = created[0]!;
    for (const rejected of results.filter((r) => r.statusCode !== 201)) {
      expect(rejected.statusCode).toBe(409);
    }

    // The winner is the only user, and it is an Administrator — no losing
    // request left a stray account behind or deleted the winner's.
    const rows = await h.db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: winner.json().user.email,
      role: "administrator",
    });

    const admins = await h.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "administrator"));
    expect(admins).toHaveLength(1);
  });
});
