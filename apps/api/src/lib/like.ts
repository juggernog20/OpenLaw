// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `%` and `_` are LIKE wildcards, so a term typed with one in it must
 * be matched literally — otherwise searching for "50%" offers every row
 * we hold. The backslash is in the class too, because it is the escape
 * character Postgres reads: one pass over `[\\%_]` covers all three, so
 * a term can never grow an escape that escapes nothing.
 *
 * One copy, because every typeahead that matches a typed term against a
 * column needs the same sentence, and two copies of it would drift.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}
