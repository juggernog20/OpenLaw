// SPDX-License-Identifier: AGPL-3.0-only

/** DES-069's shared frame for one populated Home section. */
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { FormattedMessage } from "react-intl";

export function HomeSectionCard({
  headingId,
  title,
  total,
  viewAllTo,
  children,
}: Readonly<{
  headingId: string;
  title: ReactNode;
  total: number;
  viewAllTo?: string;
  children: ReactNode;
}>) {
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center justify-between gap-3 border-b border-border-default bg-section-header px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={headingId} className="truncate text-base font-semibold">
            {title}
          </h2>
          <span className="rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-semibold tabular-nums text-badge-count-fg">
            {total}
          </span>
        </div>
        {viewAllTo ? (
          <Link
            to={viewAllTo}
            className="inline-flex min-h-6 shrink-0 items-center gap-1 text-sm font-medium text-link hover:underline"
          >
            <FormattedMessage
              id="home.section.viewAll"
              defaultMessage="View all {count}"
              values={{ count: total }}
            />
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : null}
      </header>
      <ul className="divide-y divide-border-muted">{children}</ul>
    </section>
  );
}
