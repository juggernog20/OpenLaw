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
