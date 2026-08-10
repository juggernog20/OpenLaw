// SPDX-License-Identifier: AGPL-3.0-only

/**
 * RFC 9457 problem details — the error envelope for every non-2xx API
 * response (TECH-016 consequence: error schemas are uniform and generated).
 */

import { z } from "zod";

export const ProblemSchema = z
  .object({
    type: z.string().default("about:blank"),
    title: z.string(),
    status: z.int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .describe("RFC 9457 problem details");

export type Problem = z.infer<typeof ProblemSchema>;

z.globalRegistry.add(ProblemSchema, { id: "Problem" });

export const PROBLEM_CONTENT_TYPE = "application/problem+json; charset=utf-8";

/**
 * Throwable that the app error handler renders as a Problem response.
 * A 4xx message is always exposed as the Problem's title and detail. A
 * 5xx message is scrubbed unless `expose` opts it in — set that only on
 * copy authored for the client (the 502 test-send reasons), never on
 * text relayed from another component, which could quote internals.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(statusCode: number, message: string, options?: { expose?: boolean }) {
    super(message);
    this.statusCode = statusCode;
    this.expose = options?.expose ?? false;
  }
}

export function httpError(
  statusCode: number,
  message: string,
  options?: { expose?: boolean },
): HttpError {
  return new HttpError(statusCode, message, options);
}

/**
 * Shared `default` response entry for route schemas: every operation
 * answers non-2xx with a Problem body, so the generated OpenAPI document
 * (and the typed client derived from it) must declare it.
 */
export const problemResponse = {
  description: "Problem details (RFC 9457)",
  content: {
    "application/problem+json": { schema: ProblemSchema },
  },
} as const;
