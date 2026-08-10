// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Top navigation, from the nv frame of final-themes.pen: 48px row on
 * the inverted surface, items 12px inset with 8px gaps (DES-007
 * normalized geometry), active destination underlined in the accent.
 * Renders from the destination registry only — see destinations.ts.
 */

import { NavLink } from "react-router";
import { FormattedMessage } from "react-intl";
import { cn } from "../../lib/utils";
import { destinations } from "./destinations";

export function TopNav() {
  return (
    <nav className="hidden h-(--height-nav) shrink-0 items-center gap-2 border-b border-(--chrome-nav-border) bg-(--chrome-nav-bg) px-4 md:flex">
      {destinations.map((destination) => (
        <NavLink
          key={destination.id}
          to={destination.path}
          end={destination.path === "/"}
          className={({ isActive }) =>
            cn(
              "-mb-px flex h-full items-center gap-2 border-b-2 px-3 text-md",
              isActive
                ? "border-accent font-semibold text-on-inverted"
                : "border-transparent font-medium text-(--chrome-nav-muted) hover:text-on-inverted",
            )
          }
        >
          <destination.icon size={16} aria-hidden="true" />
          <FormattedMessage {...destination.label} />
        </NavLink>
      ))}
    </nav>
  );
}
