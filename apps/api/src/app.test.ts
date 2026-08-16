// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ENVELOPE_LIVE_PROBLEM_TYPE,
  OPENLAW_VERSION,
  SIGNING_NOT_CONFIGURED_PROBLEM_TYPE,
  SOFT_GATE_PROBLEM_TYPE,
} from "@openlaw/shared";
import { createDb } from "@openlaw/db";
import { buildApp } from "./app.js";
import { UNNAMED_PROBLEM_TYPE } from "./lib/problem.js";
import { testDeps, UNUSED_DATABASE_URL } from "./testing/deps.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let db: ReturnType<typeof createDb>;

beforeAll(async () => {
  // These suites never touch the database; pg pools connect lazily, so a
  // placeholder URL keeps them container-free.
  db = createDb(UNUSED_DATABASE_URL);
  app = await buildApp({ ...testDeps(), db });
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

  /**
   * The error vocabulary is a contract, and a contract nobody can read
   * is not one. These assert that every problem type the API can emit
   * is named at the status code and the operation that emits it — so a
   * fourth URN added to `@openlaw/shared` and thrown without being
   * declared fails here rather than reaching an integrator as a string
   * they can only discover by reading our source.
   */
  /** The `type` enum the document declares for one operation's one
   * status code. Reaching through the shape by hand rather than typing
   * it: the assertion is about the document, so a wrong path here must
   * fail the test rather than be smoothed over by a cast. */
  interface ProblemTypeDocument {
    paths: Record<
      string,
      Record<
        string,
        {
          responses: Record<
            string,
            {
              content: {
                "application/problem+json": {
                  schema: { properties: { type: { enum: string[] } } };
                };
              };
            }
          >;
        }
      >
    >;
  }

  let document: ProblemTypeDocument;

  const namedTypesAt = (path: string, method: string, status: string): string[] =>
    document.paths[path]![method]!.responses[status]!.content["application/problem+json"].schema
      .properties.type.enum;

  beforeAll(async () => {
    const res = await app.inject({ method: "GET", url: "/api/openapi.json" });
    document = res.json<ProblemTypeDocument>();
  });

  it("names the soft-gate problem type on the status change that raises it", () => {
    expect(namedTypesAt("/api/v1/contracts/{number}", "patch", "409")).toContain(
      SOFT_GATE_PROBLEM_TYPE,
    );
  });

  it("names both send refusals on the send operation", () => {
    const types = namedTypesAt("/api/v1/contracts/{number}/envelopes", "post", "409");
    expect(types).toContain(SIGNING_NOT_CONFIGURED_PROBLEM_TYPE);
    expect(types).toContain(ENVELOPE_LIVE_PROBLEM_TYPE);
  });

  it("names the unconfigured refusal on the void operation", () => {
    expect(namedTypesAt("/api/v1/envelopes/{envelopeId}/void", "post", "409")).toContain(
      SIGNING_NOT_CONFIGURED_PROBLEM_TYPE,
    );
  });

  /** A refusal that names no type is reachable at each of these status
   * codes too — an archived record, an envelope that already ended —
   * so the vocabulary has to admit it or the document is wrong. */
  it("admits the unnamed type wherever it names one", () => {
    for (const [path, method] of [
      ["/api/v1/contracts/{number}", "patch"],
      ["/api/v1/contracts/{number}/envelopes", "post"],
      ["/api/v1/envelopes/{envelopeId}/void", "post"],
    ] as const) {
      expect(namedTypesAt(path, method, "409")).toContain(UNNAMED_PROBLEM_TYPE);
    }
  });
});
