// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { OPENLAW_VERSION } from "@openlaw/shared";
import { createDb } from "@openlaw/db";
import { buildApp } from "./app.js";
import { createFakeDocEngine } from "./lib/doc-engine/fake.js";
import { createUnconfiguredJobQueue } from "./pipeline/jobs.js";
import { createUnconfiguredSigningResolver } from "./lib/signing/resolver.js";
import {
  CapturingMailer,
  createTestStorage,
  fixedMailerResolver,
  TEST_AUTH_CONFIG,
  type TestStorage,
} from "./testing/harness.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let db: ReturnType<typeof createDb>;
let storage: TestStorage;

beforeAll(async () => {
  // These suites never touch the database; pg pools connect lazily, so a
  // placeholder URL keeps them container-free.
  db = createDb("postgresql://unused:unused@localhost:5432/unused");
  storage = await createTestStorage();
  app = await buildApp({
    db,
    config: TEST_AUTH_CONFIG,
    resolveMailer: fixedMailerResolver(new CapturingMailer()),
    storage: storage.storage,
    docEngine: createFakeDocEngine(),
    jobs: createUnconfiguredJobQueue(),
    resolveSigningProvider: createUnconfiguredSigningResolver(),
  });
  // Test-only route exercising the validation → problem+json path.
  app.get(
    "/api/v1/echo",
    { schema: { hide: true, querystring: z.object({ n: z.coerce.number() }) } },
    async (request) => ({ n: request.query.n }),
  );
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.$client.end();
  await storage.cleanup();
});

describe("meta", () => {
  it("returns instance metadata", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/meta" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: "OpenLaw", version: OPENLAW_VERSION });
  });
});

describe("error envelope (RFC 9457)", () => {
  it("returns problem+json on unknown routes", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ title: "Not found", status: 404 });
  });

  it("returns problem+json with field errors on invalid input", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/echo?n=abc" });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    const body = res.json();
    expect(body).toMatchObject({ title: "Request validation failed", status: 400 });
    expect(body.errors).toHaveLength(1);
  });
});

describe("openapi document", () => {
  it("serves the generated 3.1 document with the meta operation", async () => {
    const res = await app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/api/v1/meta"].get.operationId).toBe("getMeta");
    expect(doc.paths["/api/v1/echo"]).toBeUndefined();
  });
});
