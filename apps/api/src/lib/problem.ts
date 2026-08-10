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
 * The message is authored for the client, so the handler exposes it even
 * on 5xx — unlike unexpected errors, whose messages are scrubbed there.
 */
export function httpError(statusCode: number, message: string): Error {
  const err = new Error(message) as Error & { statusCode: number; expose: boolean };
  err.statusCode = statusCode;
  err.expose = true;
  return err;
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
