// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The domain-allowlist admin surface (GET/PUT /api/v1/auth/allowed-domains,
 * TECH-018): Administrators round-trip the magic-link allowlist through the
 * API instead of writing org_settings directly, input is normalised to
 * lower case, invalid shapes are refused, and the stored list is the one
 * the magic-link policy actually enforces.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  tokenFrom,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let adminCookies: Record<string, string>;

const STAFF = {
  email: "petra@example.com",
  displayName: "Petra Lindqvist",
  password: "petra-sets-her-own",
} as const;

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  adminCookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);

  // An activated non-admin staffer, so the guard tests can present a real
  // session that still must be refused.
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
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

async function getDomains(cookies?: Record<string, string>) {
  return harness.app.inject({ method: "GET", url: "/api/v1/auth/allowed-domains", cookies });
}

async function putDomains(domains: unknown, cookies: Record<string, string> = adminCookies) {
  return harness.app.inject({
    method: "PUT",
    url: "/api/v1/auth/allowed-domains",
    cookies,
    payload: { domains },
  });
}

/** Replaces the list as test setup — asserts the write actually landed. */
async function setDomains(domains: string[]) {
  const res = await putDomains(domains);
  expect(res.statusCode, res.body).toBe(200);
}

describe("allowed-domains guards", () => {
  it("is an Administrator-only surface", async () => {
    const anonymous = await getDomains();
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers["content-type"]).toContain("application/problem+json");
    expect(anonymous.json()).toMatchObject({ status: 401 });

    const staffCookies = await signInCookies(harness.app, STAFF.email, STAFF.password);
    const read = await getDomains(staffCookies);
    expect(read.statusCode).toBe(403);
    expect(read.headers["content-type"]).toContain("application/problem+json");
    expect(read.json()).toMatchObject({ status: 403 });

    const write = await putDomains(["acme.example"], staffCookies);
    expect(write.statusCode).toBe(403);
    expect(write.headers["content-type"]).toContain("application/problem+json");

    const admin = await getDomains(adminCookies);
    expect(admin.statusCode, admin.body).toBe(200);
  });
});

describe("allowed-domains round-trip (PUT then GET)", () => {
  it("replaces the whole list and reads it back", async () => {
    await setDomains(["acme.example", "partners.example"]);
    expect((await getDomains(adminCookies)).json()).toEqual({
      domains: ["acme.example", "partners.example"],
    });

    // PUT is replacement, not merge: the next write is the whole truth.
    await setDomains(["solo.example"]);
    expect((await getDomains(adminCookies)).json()).toEqual({ domains: ["solo.example"] });
  });

  it("accepts the empty list — an empty allowlist admits nobody", async () => {
    await setDomains([]);
    expect((await getDomains(adminCookies)).json()).toEqual({ domains: [] });
  });
});

describe("allowed-domains normalisation", () => {
  it("stores and returns mixed-case input lower-cased, collapsing duplicates", async () => {
    const res = await putDomains(["Acme.Example", "ACME.EXAMPLE", "Beta.Example"]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ domains: ["acme.example", "beta.example"] });
    expect((await getDomains(adminCookies)).json()).toEqual({
      domains: ["acme.example", "beta.example"],
    });
  });
});

describe("allowed-domains validation", () => {
  it.each([
    ["a scheme", "https://acme.example"],
    ["a path", "acme.example/portal"],
    ["an email address", "user@acme.example"],
    ["whitespace", "acme .example"],
    ["an empty string", ""],
    ["a leading dot", ".acme.example"],
    ["a leading hyphen in a label", "-acme.example"],
  ])("rejects %s and leaves the list unchanged", async (_shape, invalid) => {
    await setDomains(["kept.example"]);
    const res = await putDomains(["fine.example", invalid]);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ status: 400 });
    expect((await getDomains(adminCookies)).json()).toEqual({ domains: ["kept.example"] });
  });

  it("rejects a non-array body", async () => {
    const res = await putDomains("acme.example");
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ status: 400 });
  });
});

describe("the stored list is the magic-link policy", () => {
  async function requestMagicLink(email: string) {
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/magic-link",
      payload: { email },
    });
    expect(res.statusCode, res.body).toBe(202);
  }

  it("admits allowed domains and silently skips others after a PUT", async () => {
    await setDomains(["acme.example"]);

    await requestMagicLink("client@acme.example");
    expect(harness.mailer.messagesTo("client@acme.example")).toHaveLength(1);

    // Same 202, no email: the allowlist decision stays unobservable.
    await requestMagicLink("stranger@other.example");
    expect(harness.mailer.messagesTo("stranger@other.example")).toHaveLength(0);
  });

  it("closes a domain the moment it leaves the list", async () => {
    await setDomains(["acme.example"]);
    await setDomains([]);
    await requestMagicLink("late@acme.example");
    expect(harness.mailer.messagesTo("late@acme.example")).toHaveLength(0);
  });
});
