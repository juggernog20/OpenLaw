// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What the log may carry, and what it never carries (TECH-029).
 *
 * Fastify's default request serializer writes `req.url` with its query
 * string. Three of this app's links carry a secret there: the
 * set-password token, the magic-link token, and the OIDC callback code.
 * Pino's default error serializer writes an error's message and every
 * enumerable field on it. A DrizzleQueryError's message is the SQL text
 * plus every bind parameter, so one failed write of a Document Version's
 * text would put the whole text in the log.
 *
 * The rules, in one place:
 *
 * - A request line carries the request id, the method, the path without
 *   its query string, and the client address. Never a header.
 * - A response line carries the status code.
 * - An error line carries the error's type, message, stack, and driver
 *   code. A database error carries the Postgres code, constraint, table,
 *   and column. It never carries the SQL text, the bind parameters, or
 *   the driver's `detail` line, which quotes the offending value.
 * - `redact` masks the header and parameter paths anyway, for any
 *   object logged under a key the serializers do not own.
 *
 * The pipeline logger and the worker use {@link loggable} too, so the
 * three processes agree on what an error looks like in a log.
 */

import type { FastifyServerOptions } from "fastify";

/** The logger options Fastify accepts when they are not a bare boolean. */
export type ApiLoggerOptions = Exclude<NonNullable<FastifyServerOptions["logger"]>, boolean>;

/** An error as a log line may carry it. */
export interface LoggableError {
  type: string;
  message: string;
  stack?: string;
  /** A driver's or a library's own code: the Postgres SQLSTATE, or a
   * Node `ERR_*` code. */
  code?: string;
  statusCode?: number;
  /** The Postgres object a database error names. */
  constraint?: string;
  table?: string;
  column?: string;
  cause?: LoggableError;
}

/**
 * The shape drizzle-orm gives a failed query: the SQL text, the bind
 * parameters, and the driver's error as `cause`. Matched by shape rather
 * than by class, because `drizzle-orm` is a dependency of `@openlaw/db`
 * and not of this package.
 */
export interface DrizzleQueryErrorLike extends Error {
  query: string;
  params: unknown[];
  cause?: unknown;
}

export function isDrizzleQueryError(error: unknown): error is DrizzleQueryErrorLike {
  return (
    error instanceof Error &&
    typeof (error as { query?: unknown }).query === "string" &&
    Array.isArray((error as { params?: unknown }).params)
  );
}

/** Postgres SQLSTATE 22021: a string carries a byte the encoding refuses.
 * U+0000 in a text column is the one this pipeline meets. */
export const CHARACTER_NOT_IN_REPERTOIRE = "22021";

/** How many `cause` links a log line follows. */
const CAUSE_DEPTH = 3;

function stringField(source: object, key: string): string | undefined {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(source: object, key: string): number | undefined {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function withoutUndefined<T extends object>(fields: T): T {
  for (const key of Object.keys(fields) as (keyof T)[]) {
    if (fields[key] === undefined) delete fields[key];
  }
  return fields;
}

/**
 * Only the frames of a stack. A DrizzleQueryError's stack opens with its
 * message, which is the query and its parameters, so the header lines
 * are dropped and the `at ...` lines are kept.
 */
function framesOf(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const frames = stack.split("\n").filter((line) => line.trimStart().startsWith("at "));
  return frames.length > 0 ? frames.join("\n") : undefined;
}

/**
 * What a database error may say in a log: the Postgres code and the
 * object it names. The driver's `message` and `detail` are left out on
 * purpose. `detail` quotes the value that broke a constraint, and
 * `message` quotes the input on a syntax error.
 */
function loggableDriverError(cause: unknown): LoggableError {
  if (!(cause instanceof Error)) return { type: "unknown", message: "the driver gave no error" };
  const code = stringField(cause, "code");
  return withoutUndefined({
    type: cause.constructor.name || cause.name,
    message: code ? `database query failed (${code})` : "database query failed",
    code,
    constraint: stringField(cause, "constraint"),
    table: stringField(cause, "table"),
    column: stringField(cause, "column"),
  });
}

/**
 * An error as a log line may carry it.
 *
 * A DrizzleQueryError becomes its driver error's code and object names,
 * with its own frames and none of its text. Any other error keeps its
 * type, message, stack, and codes, and its `cause` chain follows the
 * same rule a few links deep.
 */
export function loggable(error: unknown, depth = 0): LoggableError {
  if (!(error instanceof Error)) {
    return { type: typeof error, message: String(error) };
  }
  if (isDrizzleQueryError(error)) {
    return withoutUndefined({
      ...loggableDriverError(error.cause),
      type: "DrizzleQueryError",
      stack: framesOf(error.stack),
    });
  }
  const cause =
    depth < CAUSE_DEPTH && error.cause !== undefined && error.cause !== null
      ? loggable(error.cause, depth + 1)
      : undefined;
  return withoutUndefined({
    type: error.constructor.name || error.name,
    message: error.message,
    stack: error.stack,
    code: stringField(error, "code"),
    statusCode: numberField(error, "statusCode"),
    cause,
  });
}

/** The path of a request URL: everything before the query string or the fragment. */
export function pathOf(url: string): string {
  const end = url.search(/[?#]/);
  return end < 0 ? url : url.slice(0, end);
}

/** The little of a Fastify request the request line reads. */
export interface LoggableRequest {
  id?: unknown;
  method: string;
  url: string;
  ip?: string;
}

/** The little of a Fastify reply the response line reads. */
export interface LoggableReply {
  statusCode: number;
}

/**
 * The serializers behind the `req`, `res`, and `err` keys.
 *
 * The request line names the request, the method, the path, and the
 * client. It never reads a header, so a cookie or a bearer token cannot
 * reach it, and the path is cut before `?`, so a token in the query
 * string cannot either.
 */
export const serializers = {
  req(request: LoggableRequest): Record<string, unknown> {
    return withoutUndefined({
      id: request.id,
      method: request.method,
      path: pathOf(request.url),
      remoteAddress: request.ip,
    });
  },
  res(reply: LoggableReply): Record<string, unknown> {
    return { statusCode: reply.statusCode };
  },
  err(error: unknown): { [key: string]: unknown; type: string; message: string; stack: string } {
    const line = loggable(error);
    // Fastify's serializer type wants a stack string; a query error with
    // no frames left answers an empty one.
    return { ...line, stack: line.stack ?? "" };
  },
};

/**
 * Paths pino masks after the serializers ran, whatever object is under
 * them. The serializers above never write these keys. The list is for
 * an object logged under `req`, `err`, or `error` by hand, or by a
 * library that brought its own shape.
 */
export const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  "err.params",
  "err.query",
  "err.cause.params",
  "err.cause.query",
  "error.params",
  "error.query",
  "error.cause.params",
  "error.cause.query",
];

/** The logger options the API boots with. */
export function loggerOptions(): ApiLoggerOptions {
  return {
    serializers,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  };
}
