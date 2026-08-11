// SPDX-License-Identifier: AGPL-3.0-only

/**
 * IANA zone names the runtime knows; "UTC" rides along as the seed
 * value. Shared by the org-defaults editor (SET-001) and the per-user
 * override (SET-006/DES-014) so both accept the same vocabulary.
 */
export const KNOWN_TIMEZONES = new Set<string>([...Intl.supportedValuesOf("timeZone"), "UTC"]);
