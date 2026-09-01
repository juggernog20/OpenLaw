// SPDX-License-Identifier: AGPL-3.0-only

/** DES-069's single all-empty state, with role-reachable destinations. */
import { ArrowRight, House } from "lucide-react";
import { Link } from "react-router";
import { FormattedMessage } from "react-intl";
import type { Role } from "../../lib/roles";
import { destinationsFor } from "../shell/destinations";

export function HomeWelcomeCard({ role }: Readonly<{ role: Role }>) {
  const destinations = destinationsFor(role).filter((destination) => destination.path !== "/");
  return (
    <section className="mx-auto w-full max-w-190 overflow-hidden rounded-card border border-border-default bg-raised text-center">
      <div className="flex flex-col items-center gap-2.5 px-6 py-7">
        <span className="flex size-11 items-center justify-center rounded-full bg-section-header text-muted">
          <House size={24} aria-hidden="true" />
        </span>
        <h2 className="text-xl font-semibold">
          <FormattedMessage id="home.welcome.title" defaultMessage="Welcome to OpenLaw" />
        </h2>
        <p className="max-w-150 text-md leading-relaxed text-muted">
          <FormattedMessage
            id="home.welcome.body"
            defaultMessage="Nothing is waiting on you. Approvals, Tasks, dates, obligations, contracts, matters, and Requests will appear here when they need you."
          />
        </p>
      </div>
      <div className="border-t border-border-default bg-section-header px-6 py-4 text-start">
        <h3 className="mb-2 text-sm font-semibold text-muted">
          <FormattedMessage id="home.welcome.destinations" defaultMessage="Go to a destination" />
        </h3>
        <ul className="grid grid-cols-1 gap-x-6 @sm/page:grid-cols-2">
          {destinations.map((destination) => (
            <li key={destination.id}>
              <Link
                to={destination.path}
                className="flex min-h-11 items-center gap-2 border-b border-border-muted px-2 text-md font-medium text-link hover:underline"
              >
                <destination.icon size={16} aria-hidden="true" />
                <span className="flex-1">
                  <FormattedMessage {...destination.label} />
                </span>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
