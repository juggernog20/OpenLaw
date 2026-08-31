// SPDX-License-Identifier: AGPL-3.0-only

/** Open Entity Obligations assigned to the viewer. */
import { CalendarClock } from "lucide-react";
import { Link } from "react-router";
import { FormattedMessage } from "react-intl";
import type { ObligationsHomeSection } from "../../lib/home";
import { formatDeadline, formatFullDate } from "../../lib/format";
import { HomeSectionCard } from "./section-card";

export function HomeObligationsCard({ section }: Readonly<{ section: ObligationsHomeSection }>) {
  return (
    <HomeSectionCard
      headingId="home-obligations-heading"
      title={<FormattedMessage id="home.obligations.title" defaultMessage="Entity obligations" />}
      total={section.total}
      viewAllTo="/entities"
    >
      {section.rows.map((row) => (
        <li key={row.id}>
          <Link
            to={`/entities/${row.entity.id}/obligations`}
            className="flex min-h-11.25 items-center justify-between gap-3 px-3 py-2 text-primary hover:bg-section-header focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-6.5 shrink-0 items-center justify-center rounded-card bg-section-header text-muted">
                <CalendarClock size={14} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-md font-medium">{row.label}</span>
                  {row.isUnassigned ? (
                    <span className="rounded-pill bg-status-warning-bg px-1.5 py-0.5 text-xs font-semibold text-status-warning-fg">
                      <FormattedMessage
                        id="home.obligations.unassigned"
                        defaultMessage="Unassigned"
                      />
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-xs text-muted">
                  <FormattedMessage
                    id="home.obligations.entityDue"
                    defaultMessage="{entity} · Due {date}"
                    values={{ entity: row.entity.legalName, date: formatFullDate(row.dueDate) }}
                  />
                </span>
              </span>
            </span>
            <time
              dateTime={row.dueDate}
              title={formatFullDate(row.dueDate)}
              className={`shrink-0 rounded-pill px-2 py-0.5 text-xs font-semibold ${row.isOverdue ? "bg-status-severe-bg text-status-severe-fg" : "text-muted"}`}
            >
              {row.isOverdue ? (
                <span className="sr-only">
                  <FormattedMessage id="home.obligations.overdue" defaultMessage="Overdue" />{" "}
                </span>
              ) : null}
              {formatDeadline(row.dueDate)}
            </time>
          </Link>
        </li>
      ))}
    </HomeSectionCard>
  );
}
