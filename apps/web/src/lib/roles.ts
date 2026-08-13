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

/** The contract read floor (CTR-021): Member+, plus a Contributor. The role
 * alone opens no contract — a Contributor reaches exactly the contracts
 * they hold a `contract_team` row on, which only the API knows. This is
 * what keeps the nav and the loaders from offering a door that would
 * open on nothing; the API's own answer is the real gate. */
export const CONTRACT_READER_ROLES: readonly Role[] = [...MEMBER_PLUS_ROLES, "contributor"];

export function canReadContracts(role: Role): boolean {
  return CONTRACT_READER_ROLES.includes(role);
}
