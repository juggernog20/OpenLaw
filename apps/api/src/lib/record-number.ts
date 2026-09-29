// SPDX-License-Identifier: AGPL-3.0-only

/** The largest number a Postgres `integer` column holds. */
const MAX_RECORD_NUMBER = 2_147_483_647;

/**
 * The record number a picker's typed term names, or null when it names
 * none. People type a number the way the app prints it, "C-92", as
 * often as "92", and the top search already takes both. So the display
 * prefix is optional here too, in either case. A longer digit string
 * cannot be a number the column holds, and handing it to Postgres
 * anyway would error the whole read.
 */
export function recordNumberFrom(term: string, prefix: "C" | "M"): number | null {
  const match = new RegExp(`^(?:${prefix}-?)?(\\d+)$`, "i").exec(term.trim());
  if (!match) return null;
  const number = Number(match[1]);
  return number <= MAX_RECORD_NUMBER ? number : null;
}
