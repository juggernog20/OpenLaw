// SPDX-License-Identifier: AGPL-3.0-only

import type { IntlShape } from "react-intl";

/**
 * The one error a fetch rejection can mean: the request never got an
 * answer. Neither fetch client catches network failures (they reject),
 * so every submit handler catches into this.
 */
export function networkError(intl: IntlShape): string {
  return intl.formatMessage({
    id: "error.network",
    defaultMessage: "The server could not be reached. Try again.",
  });
}

/** The problem envelope's human sentence, when the refusal carried one.
 * The API's own copy (already-localized policy language like the
 * last-Administrator floor) always beats a generic line. */
export function problemDetail(problem: unknown): string | undefined {
  if (problem && typeof problem === "object" && "detail" in problem) {
    const { detail } = problem as { detail?: unknown };
    if (typeof detail === "string") return detail;
  }
  return undefined;
}

/**
 * The problem envelope's RFC 9457 `type` — the refusal's own identity.
 *
 * Almost every refusal is one the client prints, and `type` on those is
 * `about:blank`. A handful are refusals the client has to **act on**,
 * and this is what tells one of those apart. Never branch on the
 * wording of `detail`: it is copy, and copy is rewritten.
 */
export function problemType(problem: unknown): string | undefined {
  if (problem && typeof problem === "object" && "type" in problem) {
    const { type } = problem as { type?: unknown };
    if (typeof type === "string") return type;
  }
  return undefined;
}
