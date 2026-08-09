// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Destination registry (M4 spec, #40): the top nav renders from this
 * list and nothing else. A destination is registered by the milestone
 * that ships its surface — no placeholder destinations, per the
 * no-stubbed-demos doctrine. Intake takes slot one when it lands
 * (INT-006).
 */

import { House, type LucideIcon } from "lucide-react";
import { defineMessage, type MessageDescriptor } from "react-intl";

export interface Destination {
  id: string;
  path: string;
  icon: LucideIcon;
  label: MessageDescriptor;
}

export const destinations: Destination[] = [
  {
    id: "home",
    path: "/",
    icon: House,
    label: defineMessage({ id: "nav.home", defaultMessage: "Home" }),
  },
];
