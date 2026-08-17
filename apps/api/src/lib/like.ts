// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `%` and `_` are LIKE wildcards, so a term typed with one in it must
 * be matched literally — otherwise searching for "50%" offers every row
 * we hold. The backslash is escaped first, because it is the escape
 * character doing the escaping.
 *
 * One copy, because every typeahead that matches a typed term against a
 * column needs the same sentence, and two copies of it would drift.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}
