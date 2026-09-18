// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The little of a logger the pipeline needs.
 *
 * Written out rather than taken from Fastify, because the worker is not
 * a Fastify process and the handlers run in both. Fastify's own logger
 * satisfies this shape, so the API passes `app.log` straight in.
 *
 * The pipeline logs rather than writes activity, and that is a decision
 * (DD-017): rendering and OCR are system acts, and the feed narrates
 * people. A derivation that failed says so in its own row, which is what
 * a reader sees; why it failed belongs here, which is what an operator
 * reads.
 */

import { loggable } from "../logging.js";

/** One structured line. */
export type LogFields = Readonly<Record<string, unknown>>;

export interface PipelineLogger {
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
}

/** A logger that writes one line of JSON per call. The worker's, and the
 * fallback for anything built without one. */
export function createConsoleLogger(): PipelineLogger {
  const write = (level: string, fields: LogFields, message: string) => {
    // An error in a field goes through the same rule the API's logger
    // applies (TECH-029). `JSON.stringify` on a raw error prints its
    // enumerable fields, and a DrizzleQueryError's are the SQL text and
    // every bind parameter.
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      safe[key] = value instanceof Error ? loggable(value) : value;
    }
    // The caller's fields first, so a field called `level` or `message`
    // cannot quietly replace the ones a log shipper reads.
    const line = JSON.stringify({ ...safe, level, time: new Date().toISOString(), message });
    // Warnings and failures go to stderr, where a container runtime and
    // an operator's shell both expect to find them.
    if (level === "info") console.log(line);
    else console.error(line);
  };
  return {
    info: (fields, message) => write("info", fields, message),
    warn: (fields, message) => write("warn", fields, message),
    error: (fields, message) => write("error", fields, message),
  };
}
