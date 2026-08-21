// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SPA serving (TECH-017: the app container serves the built web bundle
 * same-origin) and readiness probes (TECH-014). The SPA suite runs
 * container-free against a fixture asset directory; the readiness suite
 * uses the real harness because /readyz's whole job is touching the DB.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@openlaw/db";
import { buildApp } from "./app.js";
import { testDeps, UNUSED_DATABASE_URL } from "./testing/deps.js";
import { startHarness, type TestHarness } from "./testing/harness.js";

const SHELL_MARKER = '<div id="root">openlaw-shell</div>';

describe("SPA serving", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: ReturnType<typeof createDb>;
  let webDist: string;

  beforeAll(async () => {
    webDist = mkdtempSync(join(tmpdir(), "openlaw-webdist-"));
    writeFileSync(
      join(webDist, "index.html"),
      `<!doctype html><html><body>${SHELL_MARKER}</body></html>`,
    );
    mkdirSync(join(webDist, "assets"));
    writeFileSync(join(webDist, "assets", "app-abc123.js"), "console.log('openlaw');");

    // pg pools connect lazily; these suites never touch the database.
    db = createDb(UNUSED_DATABASE_URL);
    app = await buildApp({ ...testDeps({ db }), webDist });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end();
    rmSync(webDist, { recursive: true, force: true });
  });

  it("serves the app shell at the root", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain(SHELL_MARKER);
  });

  it("serves the app shell for client-side deep links", async () => {
    const res = await app.inject({ method: "GET", url: "/matters/0198e0aa-cafe" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(SHELL_MARKER);
  });

  it("never caches the shell, so deploys take effect on reload", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.headers["cache-control"]).toContain("no-cache");
  });

  it("serves hashed assets as immutable", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/app-abc123.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("keeps unknown API routes as problem+json, not the shell", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });

  it("keeps API paths with query strings as problem+json, not the shell", async () => {
    const res = await app.inject({ method: "GET", url: "/api?redirect=1" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });

  it("keeps non-GET requests as problem+json, not the shell", async () => {
    const res = await app.inject({ method: "POST", url: "/matters/0198e0aa-cafe" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });
});

describe("readiness", () => {
  describe("with the database reachable", () => {
    let harness: TestHarness;

    beforeAll(async () => {
      harness = await startHarness();
    });

    afterAll(async () => {
      await harness.stop();
    });

    it("reports ready", async () => {
      const res = await harness.app.inject({ method: "GET", url: "/readyz" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok" });
    });

    it("reports live", async () => {
      const res = await harness.app.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("with the database unreachable", () => {
    let app: Awaited<ReturnType<typeof buildApp>>;
    let db: ReturnType<typeof createDb>;

    beforeAll(async () => {
      // A port nothing listens on: connection attempts fail fast.
      db = createDb("postgresql://unused:unused@127.0.0.1:59999/unused");
      app = await buildApp(testDeps({ db }));
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      await db.$client.end();
    });

    it("reports unavailable, but stays live", async () => {
      const ready = await app.inject({ method: "GET", url: "/readyz" });
      expect(ready.statusCode).toBe(503);

      const live = await app.inject({ method: "GET", url: "/healthz" });
      expect(live.statusCode).toBe(200);
    });
  });
});
