// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Destination registry (M4 spec, #40): the top nav renders from this
 * list and nothing else. A destination is registered by the milestone
 * that ships its surface — no placeholder destinations, per the
 * no-stubbed-demos doctrine. Home holds slot one and Intake follows it
 * (INT-006 M21/13). A destination may carry a role floor: the nav draws
 * only what the signed-in role can enter (absent, not disabled — the
 * same convention as the settings rail, SET-002).
 */

import {
  BriefcaseBusiness,
  House,
  Inbox,
  Landmark,
  Signature,
  type LucideIcon,
} from "lucide-react";
import { defineMessage, type MessageDescriptor } from "react-intl";
import {
  CONTRACT_READER_ROLES,
  MATTER_READER_ROLES,
  MEMBER_PLUS_ROLES,
  type Role,
} from "../../lib/roles";

export interface Destination {
  id: string;
  path: string;
  icon: LucideIcon;
  label: MessageDescriptor;
  /** Roles that see this destination; absent = every signed-in role. */
  roles?: readonly Role[];
}

export const destinations: Destination[] = [
  {
    // Slot one. Home is where sign-in lands and the only destination
    // every role holds, so the nav opens with the one entry that is
    // never absent (INT-006 M21/13).
    id: "home",
    path: "/",
    icon: House,
    label: defineMessage({ id: "nav.home", defaultMessage: "Home" }),
  },
  {
    // Directly after Home: the Inbox is one click from anywhere in the
    // app, because triage is what a legal team opens the product to do.
    // Member+ only — triage stays legal's, so a Contributor and a
    // Business User get no entry at all.
    id: "inbox",
    path: "/inbox",
    icon: Inbox,
    label: defineMessage({ id: "nav.inbox", defaultMessage: "Inbox" }),
    roles: MEMBER_PLUS_ROLES,
  },
  {
    // The M22 matter record. The same reader floor as contracts: a
    // Contributor reaches the matters they are on the team of.
    id: "matters",
    path: "/matters",
    icon: BriefcaseBusiness,
    label: defineMessage({ id: "nav.matters", defaultMessage: "Matters" }),
    roles: MATTER_READER_ROLES,
  },
  {
    // The M8 contract record. Member+, plus a Contributor (CTR-021): they
    // have contracts to see — the ones they are on the team of — so
    // the destination is drawn for them too.
    id: "contracts",
    path: "/contracts",
    icon: Signature,
    label: defineMessage({ id: "nav.contracts", defaultMessage: "Contracts" }),
    roles: CONTRACT_READER_ROLES,
  },
  {
    // The M7 registry core; M27 grows this same destination into the
    // full Entities module. Member+ only (ENT-004).
    id: "entities",
    path: "/entities",
    icon: Landmark,
    label: defineMessage({ id: "nav.entities", defaultMessage: "Entities" }),
    roles: MEMBER_PLUS_ROLES,
  },
];

/** The destinations a signed-in role gets to see (ENT-004 et al.). */
export function destinationsFor(role: Role): Destination[] {
  return destinations.filter(
    (destination) => !destination.roles || destination.roles.includes(role),
  );
}
