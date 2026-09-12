// SPDX-License-Identifier: AGPL-3.0-only

/** Persistent Portal destinations, shared by lists and records (DES-078). */

import { BriefcaseBusiness, Inbox, Signature } from "lucide-react";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { Link, matchPath, useLocation } from "react-router";
import { cn } from "../../lib/utils";

const destinations = [
  {
    to: "/portal",
    matches: ["/portal", "/portal/new/*", "/portal/requests/*"],
    icon: Inbox,
    label: defineMessage({ id: "portal.navigation.requests", defaultMessage: "Requests" }),
  },
  {
    to: "/portal/contracts",
    matches: ["/portal/contracts/*"],
    icon: Signature,
    label: defineMessage({ id: "portal.navigation.contracts", defaultMessage: "Contracts" }),
  },
  {
    to: "/portal/matters",
    matches: ["/portal/matters/*"],
    icon: BriefcaseBusiness,
    label: defineMessage({ id: "portal.navigation.matters", defaultMessage: "Matters" }),
  },
];

export function PortalNav() {
  const intl = useIntl();
  const { pathname } = useLocation();

  return (
    <nav
      aria-label={intl.formatMessage({ id: "portal.navigation", defaultMessage: "Portal" })}
      className="flex h-(--height-nav) shrink-0 items-center gap-2 overflow-x-auto border-b border-(--chrome-nav-border) bg-(--chrome-nav-bg) px-2 @sm/shell:px-4"
    >
      {destinations.map((destination) => {
        const active = destination.matches.some((pattern) => matchPath(pattern, pathname));
        return (
          <Link
            key={destination.to}
            to={destination.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-full shrink-0 items-center gap-2 border-b-2 px-3 text-base whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent @sm/shell:text-md",
              active
                ? "border-accent font-semibold text-on-inverted"
                : "border-transparent font-medium text-(--chrome-nav-muted) hover:text-on-inverted",
            )}
          >
            <destination.icon
              size={16}
              aria-hidden="true"
              className="hidden shrink-0 @sm/shell:block"
            />
            <FormattedMessage {...destination.label} />
          </Link>
        );
      })}
    </nav>
  );
}
