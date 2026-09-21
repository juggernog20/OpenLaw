// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Start blank (SET-004, 2026-09-17 addendum): the catalog lists the
 * Review step can empty, and the skeleton each one keeps.
 *
 * Both ends read this. The API decides which rows to hard-delete, and
 * the wizard's confirmation dialog counts the rows it is about to
 * remove from the same lists it has already read. One definition, so
 * the number the dialog shows is the number the route removes.
 *
 * The keys are the DD-017 action prefixes of the lists, and they travel
 * in the `settings.catalog_cleared` activity payload.
 */

/**
 * The skeleton slugs per list: the rows code or a structural rule
 * depends on, so Start blank leaves them. Knowledge types and request
 * types have no fallback row and keep nothing.
 */
export const START_BLANK_LISTS = {
  matter_type: ["other", "default"],
  matter_status: ["open", "closed"],
  contract_type: ["other", "default"],
  contract_status: ["draft", "active", "expired"],
  entity_type: ["other"],
  officer_role: ["other"],
  knowledge_type: [],
  request_type: [],
} as const satisfies Record<string, readonly string[]>;

export type StartBlankList = keyof typeof START_BLANK_LISTS;

/** The lists in the order the route empties them and the dialog names them. */
export const START_BLANK_LIST_KEYS = Object.keys(START_BLANK_LISTS) as StartBlankList[];

/**
 * Whether a row is catalog rather than skeleton: a seed row that is only
 * vocabulary. A user-created row is never catalog; the route refuses
 * the whole call when one exists.
 */
export function isCatalogRow(
  list: StartBlankList,
  row: { slug: string; isSystemDefault: boolean },
): boolean {
  return row.isSystemDefault && !(START_BLANK_LISTS[list] as readonly string[]).includes(row.slug);
}
