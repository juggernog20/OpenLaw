// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Origin check on API mutations (TECH-033). Container-free: the
 * probe routes touch nothing, and the hook runs before any handler.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@openlaw/db";
import { buildApp } from "./app.js";
import { testDeps, UNUSED_DATABASE_URL } from "./testing/deps.js";
import { TEST_AUTH_CONFIG } from "./testing/harness.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let db: ReturnType<typeof createDb>;

/** The install's own origin, as the browser would name it. */
const OWN_ORIGIN = new URL(TEST_AUTH_CONFIG.baseUrl).origin;

beforeAll(async () => {
  db = createDb(UNUSED_DATABASE_URL);
  app = await buildApp(testDeps({ db }));
  // Probe routes, registered on the root context after the hook so the
  // hook applies to them the way it applies to every module.
  app.post("/api/v1/probe", { schema: { hide: true } }, async () => ({ ok: true }));
  app.get("/api/v1/probe", { schema: { hide: true } }, async () => ({ ok: true }));
  app.post("/api/v1/signing/probe", { schema: { hide: true } }, async () => ({ ok: true }));
  app.post("/api/probe", { schema: { hide: true } }, async () => ({ ok: true }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.$client.end();
});

const post = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url, headers, payload: {} });

describe("the Origin check on /api/v1 mutations", () => {
  it("refuses a POST from another origin with a stable problem body", async () => {
    const res = await post("/api/v1/probe", { origin: "https://other.example.com" });
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({
      type: "about:blank",
      status: 403,
      detail: "This request did not come from this OpenLaw instance's own origin.",
    });
  });

  it("refuses the opaque origin a sandboxed or redirected sender carries", async () => {
    expect((await post("/api/v1/probe", { origin: "null" })).statusCode).toBe(403);
  });

  it("admits a POST from the install's own origin", async () => {
    const res = await post("/api/v1/probe", { origin: OWN_ORIGIN });
    expect(res.statusCode, res.body).toBe(200);
  });

  it("admits a POST that names no sender at all", async () => {
    expect((await post("/api/v1/probe")).statusCode).toBe(200);
  });

  it("reads Sec-Fetch-Site the same way", async () => {
    expect((await post("/api/v1/probe", { "sec-fetch-site": "same-site" })).statusCode).toBe(403);
    expect((await post("/api/v1/probe", { "sec-fetch-site": "cross-site" })).statusCode).toBe(403);
    expect((await post("/api/v1/probe", { "sec-fetch-site": "same-origin" })).statusCode).toBe(200);
    expect((await post("/api/v1/probe", { "sec-fetch-site": "none" })).statusCode).toBe(200);
  });

  it("never checks a read", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/probe",
      headers: { origin: "https://other.example.com" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("exempts the signing webhook, which another site is meant to call", async () => {
    const res = await post("/api/v1/signing/probe", { origin: "https://other.example.com" });
    expect(res.statusCode, res.body).toBe(200);
  });

  it("leaves paths outside /api/v1 to their own checks", async () => {
    const res = await post("/api/probe", { origin: "https://other.example.com" });
    expect(res.statusCode, res.body).toBe(200);
  });
});
