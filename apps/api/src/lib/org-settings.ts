// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization auth policy (TECH-008, DD-010/INT-001), read from the
 * single seeded org_settings row on every decision — policy changes take
 * effect immediately, with no cache to invalidate and no restart.
 */

import { orgSettings, type Db, type OrgSettings } from "@openlaw/db";

export async function getOrgSettings(db: Db): Promise<OrgSettings> {
  const [row] = await db.select().from(orgSettings).limit(1);
  if (!row) {
    throw new Error("org_settings has no row; the 0000_auth migration seeds exactly one.");
  }
  return row;
}

/**
 * Whether an email's domain is on the allowlist (case-insensitive, exact
 * match). An empty allowlist admits nobody: a fresh install grants portal
 * access only once an Administrator opens a domain.
 */
export function isEmailDomainAllowed(email: string, allowedDomains: string[]): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return allowedDomains.some((allowed) => allowed.toLowerCase() === domain);
}
