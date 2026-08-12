// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The DD-013 role vocabulary, as one shared union: everything web-side
 * that branches on a role types against this symbol, so a misspelled
 * slug fails at compile time. The API's generated client carries the
 * same union on every user payload.
 */

export type Role = "administrator" | "legal_team_member" | "contributor" | "business_user";

/** Member+ (CONTEXT.md): Administrators and Legal Team Members — the
 * access floor for most legal-side surfaces. */
export const MEMBER_PLUS_ROLES: readonly Role[] = ["administrator", "legal_team_member"];

export function isMemberPlus(role: Role): boolean {
  return MEMBER_PLUS_ROLES.includes(role);
}
