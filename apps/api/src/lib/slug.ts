// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Slug derivation shared by every catalog that mints machine identities
 * from display names (taxonomy types, catalog fields). Slugs are
 * derived once at creation and immutable after it.
 */

/** `"Real Estate"` → `real_estate`; anything left empty becomes `fallback`. */
export function slugBaseOf(displayName: string, fallback: string): string {
  const base = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || fallback;
}

/** The derived slug, suffixed past every taken one: `nda`, `nda_2`, … */
export function freeSlug(displayName: string, fallback: string, taken: Set<string>): string {
  const base = slugBaseOf(displayName, fallback);
  let slug = base;
  for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}_${suffix}`;
  return slug;
}
