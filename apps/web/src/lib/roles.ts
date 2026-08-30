// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The DD-013 role vocabulary, as one shared union. Everything web-side
 * that branches on a role types against this symbol, so a misspelled
 * slug fails at compile time. The API's generated client carries the
 * same union on every user payload.
 *
 * The wording lives here too (M9/7). Four surfaces name a role in
 * words: the Users pane's in-place select, the first-run wizard's
 * invite buttons, the Profile pane's own line, and the audit log's
 * narration of a role change. One copy is what keeps "Legal team
 * member" from becoming "Legal Team Member" on one of them.
 */

import { defineMessages, type IntlShape, type MessageDescriptor } from "react-intl";

export type Role = "administrator" | "legal_team_member" | "contributor" | "business_user";

/** How each role reads. The ids predate this file, so the message
 * catalog did not change when the map moved here. */
export const ROLE_MESSAGES: Readonly<Record<Role, MessageDescriptor>> = defineMessages({
  administrator: { id: "role.administrator", defaultMessage: "Administrator" },
  legal_team_member: { id: "role.legalTeamMember", defaultMessage: "Legal team member" },
  contributor: { id: "role.contributor", defaultMessage: "Contributor" },
  business_user: { id: "role.businessUser", defaultMessage: "Business user" },
});

/**
 * A role as plain text, for a place that needs a string rather than an
 * element, such as an accessible name or a value inside a narrated
 * sentence. A slug outside the union reads as itself. The activity log
 * is append-only, so a role this build no longer has can still sit in a
 * payload.
 */
export function roleLabel(intl: IntlShape, role: string): string {
  // Indexed as an open vocabulary rather than asserted into the union.
  // The caller's string is whatever a payload holds, and a miss is the
  // case this function exists to answer.
  const catalog: Readonly<Partial<Record<string, MessageDescriptor>>> = ROLE_MESSAGES;
  const message = catalog[role];
  return message ? intl.formatMessage(message) : role;
}

/** Member+ (CONTEXT.md): Administrators and Legal Team Members, the
 * access floor for most legal-side surfaces. */
export const MEMBER_PLUS_ROLES: readonly Role[] = ["administrator", "legal_team_member"];

export function isMemberPlus(role: Role): boolean {
  return MEMBER_PLUS_ROLES.includes(role);
}

/** The Contract read floor (CTR-021): Member+, plus a Contributor. The
 * role alone opens no Contract. A Contributor reaches exactly the
 * Contracts they hold a `contract_team` row on, which only the API
 * knows. This keeps the nav and the loaders from offering a door that
 * opens on nothing. The API's own answer is the real gate. */
export const CONTRACT_READER_ROLES: readonly Role[] = [...MEMBER_PLUS_ROLES, "contributor"];

export function canReadContracts(role: Role): boolean {
  return CONTRACT_READER_ROLES.includes(role);
}

/** Matters share the record-reader floor: Member+, plus a scoped Contributor. */
export const MATTER_READER_ROLES: readonly Role[] = [...MEMBER_PLUS_ROLES, "contributor"];

export function canReadMatters(role: Role): boolean {
  return MATTER_READER_ROLES.includes(role);
}
