// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The log's rules (TECH-029), asserted on the serializers alone.
 *
 * No Fastify and no database: the options are built, and each
 * serializer is called on a fake of what Fastify would hand it. What is
 * asserted is what a line never carries, because that is the property a
 * log reader cannot check for themselves.
 */

import { describe, expect, it } from "vitest";
import {
  CHARACTER_NOT_IN_REPERTOIRE,
  isDrizzleQueryError,
  loggable,
  loggerOptions,
  pathOf,
  REDACT_PATHS,
  serializers,
} from "./logging.js";

/** The shape drizzle-orm throws, built by hand so no database is needed. */
function drizzleQueryError(query: string, params: unknown[], cause: Error): Error {
  const error = new Error(`Failed query: ${query}\nparams: ${params}`);
  Object.assign(error, { query, params, cause });
  return error;
}

/** The shape pg throws, with the fields Postgres fills in. */
function driverError(fields: Record<string, string>): Error {
  const error = new Error(fields.message ?? "database refused");
  error.name = "DatabaseError";
  Object.assign(error, fields);
  return error;
}

describe("the request line", () => {
  it("carries the method, the path, the client, and the request id", () => {
    const line = serializers.req({
      id: "req-1",
      method: "GET",
      url: "/api/v1/auth/magic-link/verify?token=secret-token&callbackURL=/",
      ip: "10.0.0.7",
    });
    expect(line).toEqual({
      id: "req-1",
      method: "GET",
      path: "/api/v1/auth/magic-link/verify",
      remoteAddress: "10.0.0.7",
    });
  });

  it("never carries the query string or a header", () => {
    const line = serializers.req({
      id: "req-2",
      method: "GET",
      url: "/auth/set-password?token=one-hour-token",
      ip: "10.0.0.7",
      // Fastify's request carries these. The serializer must not read them.
      ...({ headers: { cookie: "session=abc", authorization: "Bearer xyz" } } as object),
    });
    const printed = JSON.stringify(line);
    expect(printed).not.toContain("one-hour-token");
    expect(printed).not.toContain("session=abc");
    expect(printed).not.toContain("Bearer");
    expect(line).not.toHaveProperty("headers");
    expect(line).not.toHaveProperty("url");
  });

  it("cuts the path before a fragment too", () => {
    expect(pathOf("/auth/set-password#token=abc")).toBe("/auth/set-password");
    expect(pathOf("/api/v1/contracts")).toBe("/api/v1/contracts");
    expect(pathOf("/api/v1/contracts?page=2#top")).toBe("/api/v1/contracts");
  });
});

describe("the response line", () => {
  it("carries the status code and nothing else", () => {
    expect(
      serializers.res({
        statusCode: 302,
        ...({ getHeaders: () => ({ "set-cookie": "session=abc" }) } as object),
      }),
    ).toEqual({ statusCode: 302 });
  });
});

describe("the error line", () => {
  const text = "the assignor transfers \u0000 every right";
  const failed = drizzleQueryError(
    'insert into "document_version_text" ("version_id", "text") values ($1, $2)',
    ["0198f2ab-0000-7000-8000-0000000012ab", text],
    driverError({
      code: CHARACTER_NOT_IN_REPERTOIRE,
      message: 'invalid byte sequence for encoding "UTF8": 0x00',
      table: "document_version_text",
      column: "text",
      detail: `Failing row contains (${text}).`,
    }),
  );

  it("recognises a failed query by its shape", () => {
    expect(isDrizzleQueryError(failed)).toBe(true);
    expect(isDrizzleQueryError(new Error("plain"))).toBe(false);
    expect(isDrizzleQueryError("not an error")).toBe(false);
  });

  it("names the Postgres code and object for a failed query", () => {
    expect(loggable(failed)).toMatchObject({
      type: "DrizzleQueryError",
      code: CHARACTER_NOT_IN_REPERTOIRE,
      table: "document_version_text",
      column: "text",
      message: `database query failed (${CHARACTER_NOT_IN_REPERTOIRE})`,
    });
  });

  it("never carries the SQL text, the parameters, or the driver's detail line", () => {
    const printed = JSON.stringify(loggable(failed));
    expect(printed).not.toContain("insert into");
    expect(printed).not.toContain("0198f2ab");
    expect(printed).not.toContain("assignor");
    expect(printed).not.toContain("Failing row");
    expect(printed).not.toContain("0x00");
    // The same through the serializer Fastify calls.
    expect(JSON.stringify(serializers.err(failed))).not.toContain("assignor");
  });

  it("keeps the frames of a failed query's stack and drops its header", () => {
    const { stack } = loggable(failed);
    expect(stack).toBeDefined();
    expect(stack).not.toContain("Failed query");
    expect(stack).not.toContain("assignor");
    expect(stack!.split("\n").every((line) => line.trimStart().startsWith("at "))).toBe(true);
  });

  it("keeps an ordinary error whole, and follows its cause", () => {
    const inner = new Error("relay refused", { cause: undefined });
    Object.assign(inner, { code: "ECONNREFUSED" });
    const outer = new Error("could not send", { cause: inner });
    expect(loggable(outer)).toMatchObject({
      type: "Error",
      message: "could not send",
      cause: { type: "Error", message: "relay refused", code: "ECONNREFUSED" },
    });
    expect(loggable(outer).stack).toContain("could not send");
  });

  it("applies the query rule to a cause that is a failed query", () => {
    const outer = new Error("text extraction failed", { cause: failed });
    const printed = JSON.stringify(loggable(outer));
    expect(printed).toContain("text extraction failed");
    expect(printed).toContain(CHARACTER_NOT_IN_REPERTOIRE);
    expect(printed).not.toContain("assignor");
  });

  it("describes a thrown non-error without throwing", () => {
    expect(loggable("just a string")).toEqual({ type: "string", message: "just a string" });
    expect(loggable(undefined)).toEqual({ type: "undefined", message: "undefined" });
  });
});

describe("the logger options", () => {
  it("wire the three serializers and the redact list", () => {
    const options = loggerOptions();
    expect(options.serializers).toBe(serializers);
    expect(options.redact).toEqual({ paths: REDACT_PATHS, censor: "[redacted]" });
    for (const path of [
      "req.headers.cookie",
      "req.headers.authorization",
      "err.params",
      "err.query",
    ]) {
      expect(REDACT_PATHS).toContain(path);
    }
  });
});
