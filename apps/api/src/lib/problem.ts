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
 * What `type` carries when a refusal did not name itself (RFC 9457
 * §4.2.1). Almost every refusal is one a client prints rather than one
 * it acts on, so this is the default rather than the exception.
 */
export const UNNAMED_PROBLEM_TYPE = "about:blank";

/**
 * Throwable that the app error handler renders as a Problem response.
 * A 4xx message is always exposed as the Problem's title and detail. A
 * 5xx message is scrubbed unless `expose` opts it in — set that only on
 * copy authored for the client (the 502 test-send reasons), never on
 * text relayed from another component, which could quote internals.
 *
 * `type` is the RFC 9457 problem type URI, and it defaults to
 * `about:blank` because almost every refusal here is one a client
 * prints rather than one it acts on. Set it only where a client has to
 * tell *this* refusal apart from every other refusal the same route can
 * give — a client that told them apart by reading the sentence would
 * break the first time the sentence was reworded.
 *
 * `extensions` are RFC 9457 §3.2 extension members: the facts a named
 * refusal carries beyond its identity, merged into the body beside
 * `title` and `detail`. They exist for the refusal a client has to
 * **act on** rather than print — the disposition race answers the
 * outcome that was recorded, and a client that had to parse that out of
 * a sentence would break the first time the sentence was reworded. Send
 * them only with a named `type`, and never with a key the envelope
 * already owns.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly expose: boolean;
  readonly type: string;
  readonly extensions?: Readonly<Record<string, unknown>>;

  constructor(statusCode: number, message: string, options?: HttpErrorOptions) {
    super(message);
    this.statusCode = statusCode;
    this.expose = options?.expose ?? false;
    this.type = options?.type ?? UNNAMED_PROBLEM_TYPE;
    this.extensions = options?.extensions;
  }
}

export interface HttpErrorOptions {
  expose?: boolean;
  type?: string;
  /** RFC 9457 §3.2 extension members, merged into the problem body. */
  extensions?: Readonly<Record<string, unknown>>;
}

export function httpError(
  statusCode: number,
  message: string,
  options?: HttpErrorOptions,
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

/**
 * A response entry that **names** the problem types one status code on
 * one route can answer with.
 *
 * `problemResponse` above describes the envelope, which is the same on
 * every operation. This describes the vocabulary, which is not. A URN
 * exists so a caller can branch on *which* refusal happened rather than
 * on the wording of `detail`, and a caller cannot branch on a string it
 * has no way of learning. Until this existed the only way to learn a URN
 * was to read our source — fine for us, useless for the self-hoster and
 * the integrator the generated document is for (TECH-003).
 *
 * The strings come from `@openlaw/shared`, never retyped here: one
 * source for the wire contract, and the document then cannot drift from
 * what the route actually throws.
 *
 * `type` is narrowed to the named URNs **plus `about:blank`**, and the
 * rest of the Problem shape is unchanged. `about:blank` is in the list
 * rather than left out because it is reachable: every status code that
 * carries a named refusal on one branch carries an ordinary unnamed one
 * on another — an archived record, a reach that was refused — and a
 * document that promised otherwise would be a document that lies. What
 * the entry says is "this is the vocabulary at this status", which is
 * what a caller writing a switch needs.
 *
 * This is documentation and never serialization: the error handler sends
 * an already-stringified body, which Fastify passes through untouched.
 */
export function problemTypeResponse(
  description: string,
  types: readonly [string, ...string[]],
  /**
   * The RFC 9457 §3.2 extension members one of these refusals carries,
   * as a Zod shape. Optional on purpose: a refusal's `type` is enough
   * for almost every client, and only the few that carry a fact the
   * client acts on declare one. Every member is optional in the schema,
   * because the same status code also answers the unnamed refusals in
   * `types` and those carry none.
   */
  extensions?: z.ZodRawShape,
): {
  description: string;
  content: { "application/problem+json": { schema: z.ZodType } };
} {
  return {
    description,
    content: {
      "application/problem+json": {
        schema: ProblemSchema.extend({
          type: z
            .literal([...types, UNNAMED_PROBLEM_TYPE])
            .describe(
              "Which refusal this is. A client branches on this, never on `detail` — " +
                "`detail` is copy, and copy is rewritten. `about:blank` is a refusal at " +
                "this status that names no type; print it rather than branching on it.",
            ),
          ...(extensions ?? {}),
        }).describe(description),
      },
    },
  };
}
