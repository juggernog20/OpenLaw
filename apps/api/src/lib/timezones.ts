// SPDX-License-Identifier: AGPL-3.0-only

/**
 * IANA zone names the runtime knows; "UTC" rides along as the seed
 * value. Shared by the org-defaults editor (SET-001) and the per-user
 * override (SET-006/DES-014) so both accept the same vocabulary.
 */

import { z } from "zod";

export const KNOWN_TIMEZONES = new Set<string>([...Intl.supportedValuesOf("timeZone"), "UTC"]);

/**
 * The canonical spelling of a zone, or null for an invalid one.
 * `Intl.supportedValuesOf` omits runtime-valid aliases like `US/Eastern`,
 * which `Intl.DateTimeFormat` accepts and resolves to `America/New_York`
 * — an alias is accepted but stored under its canonical name.
 */
export function canonicalTimezone(zone: string): string | null {
  if (KNOWN_TIMEZONES.has(zone)) return zone;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions()
      .timeZone;
    return KNOWN_TIMEZONES.has(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/** A request-body timezone: validated and canonicalised in one step. */
export const TimezoneSchema = z.string().transform((zone, ctx) => {
  const canonical = canonicalTimezone(zone);
  if (canonical === null) {
    ctx.addIssue({ code: "custom", message: "An IANA zone name like Europe/Berlin." });
    return z.NEVER;
  }
  return canonical;
});
