// SPDX-License-Identifier: AGPL-3.0-only

/** DES-069's Matter portfolio card in the TECH-001/TECH-003 Home SPA. */
import { BriefcaseBusiness } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { Link } from "react-router";
import type { MattersHomeSection } from "../../lib/home";
import { formatDeadline, formatFullDate } from "../../lib/format";
import { ConfidentialMarker } from "../confidential-marker";
import { HomeSectionCard } from "./section-card";

export function HomeMattersCard({ section }: { section: MattersHomeSection }) {
  return (
    <HomeSectionCard
      headingId="home-matters-heading"
      title={<FormattedMessage id="home.matters.title" defaultMessage="Your matters" />}
      total={section.total}
      viewAllTo="/matters?manager=me"
    >
      {section.rows.map((row) => (
        <li key={row.id}>
          <Link
            to={`/matters/${String(row.number)}`}
            className="flex min-h-11.25 items-center justify-between gap-3 px-3 py-2 text-primary hover:bg-section-header focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-6.5 shrink-0 items-center justify-center rounded-card bg-section-header text-muted">
                <BriefcaseBusiness size={16} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-md font-medium">{row.title}</span>
                  {row.isConfidential ? <ConfidentialMarker /> : null}
                </span>
                <span className="block truncate text-xs text-muted">
                  <FormattedMessage
                    id="home.matters.meta"
                    defaultMessage="Matter M-{number} · {status}"
                    values={{ number: row.number, status: row.status.displayName }}
                  />
                </span>
              </span>
            </span>
            {row.nextDeadline === null ? (
              <span className="shrink-0 text-xs text-muted">
                <FormattedMessage
                  id="home.matters.noUpcomingDeadline"
                  defaultMessage="No upcoming deadline"
                />
              </span>
            ) : (
              <span className="flex min-w-0 shrink-0 flex-col items-end text-xs">
                <span className="max-w-45 truncate font-medium text-primary">
                  {row.nextDeadline.label}
                </span>
                <time
                  dateTime={row.nextDeadline.date}
                  title={formatFullDate(row.nextDeadline.date)}
                  className="font-semibold text-muted"
                >
                  {formatDeadline(row.nextDeadline.date)}
                </time>
              </span>
            )}
          </Link>
        </li>
      ))}
    </HomeSectionCard>
  );
}
