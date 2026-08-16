// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The guard behind `testDeps` (#255): the defaults are complete, so a
 * suite that overrides nothing still builds an app.
 *
 * This is what makes the "one edit for a new dependency" promise
 * enforceable. A dependency added to `AppDeps` with no default here
 * fails to compile in `deps.ts`, and a default that is wired but inert
 * in the wrong way fails this suite rather than eight others.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testDeps } from "./deps.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let deps: ReturnType<typeof testDeps>;

beforeAll(async () => {
  // No override at all — the whole point of the suite. The defaults are
  // container-free, so nothing here needs Postgres.
  deps = testDeps();
  app = await buildApp(deps);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await deps.db.$client.end();
});

describe("testDeps", () => {
  it("builds a working app with no override", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/meta" });
    expect(res.statusCode, res.body).toBe(200);
  });

  it("registers the whole route surface on the defaults alone", async () => {
    // A dependency with no default here would fail a module's plugin
    // registration rather than one route, so the generated document is
    // the cheapest whole-surface assertion there is.
    const res = await app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(res.statusCode, res.body).toBe(200);
    expect(
      Object.keys(res.json<{ paths: Record<string, unknown> }>().paths).length,
    ).toBeGreaterThan(0);
  });
});
