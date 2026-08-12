// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Destination registry (M4 spec, #40): the top nav renders from this
 * list and nothing else. A destination is registered by the milestone
 * that ships its surface — no placeholder destinations, per the
 * no-stubbed-demos doctrine. Intake takes slot one when it lands
 * (INT-006). A destination may carry a role floor: the nav draws only
 * what the signed-in role can enter (absent, not disabled — the same
 * convention as the settings rail, SET-002).
 */

import { House, Landmark, type LucideIcon } from "lucide-react";
import { defineMessage, type MessageDescriptor } from "react-intl";
import { MEMBER_PLUS_ROLES, type Role } from "../../lib/roles";

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
    id: "home",
    path: "/",
    icon: House,
    label: defineMessage({ id: "nav.home", defaultMessage: "Home" }),
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
