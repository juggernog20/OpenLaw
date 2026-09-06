// SPDX-License-Identifier: AGPL-3.0-only

/** DES-069's Contract portfolio card in the TECH-001/TECH-003 Home SPA. */
import { FileText, RotateCw } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link } from "react-router";
import type { ContractsHomeSection } from "../../lib/home";
import { stageLabel } from "../../lib/contracts";
import { formatDeadline, formatFullDate } from "../../lib/format";
import { ConfidentialMarker } from "../confidential-marker";
import { HomeSectionCard } from "./section-card";

export function HomeContractsCard({ section }: { section: ContractsHomeSection }) {
  const intl = useIntl();
  return (
    <HomeSectionCard
      headingId="home-contracts-heading"
      title={<FormattedMessage id="home.contracts.title" defaultMessage="Your contracts" />}
      total={section.total}
      viewAllTo="/contracts?owner=me"
    >
      {section.rows.map((row) => (
        <li key={row.id}>
          <Link
            to={`/contracts/${String(row.number)}`}
            className="flex min-h-11.25 items-center justify-between gap-3 px-3 py-2 text-primary hover:bg-section-header focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-6.5 shrink-0 items-center justify-center rounded-card bg-section-header text-muted">
                <FileText size={16} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-md font-medium">{row.title}</span>
                  {row.isConfidential ? <ConfidentialMarker /> : null}
                </span>
                <span className="block truncate text-xs text-muted">
                  <FormattedMessage
                    id="home.contracts.meta"
                    defaultMessage="Contract C-{number} · {stage}"
                    values={{ number: row.number, stage: stageLabel(intl, row.stage) }}
                  />
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2.5">
              {row.renewalPendingConfirmation ? (
                <span
                  role="img"
                  aria-label={intl.formatMessage({
                    id: "home.contracts.renewalPending",
                    defaultMessage: "Renewal pending confirmation",
                  })}
                  className="inline-flex shrink-0 items-center rounded-pill bg-status-warning-bg px-2 py-0.5 text-xs font-semibold text-status-warning-fg"
                >
                  <RotateCw size={16} aria-hidden="true" className="@sm/page:hidden" />
                  <span aria-hidden="true" className="hidden @sm/page:inline">
                    <FormattedMessage
                      id="home.contracts.renewalPending"
                      defaultMessage="Renewal pending confirmation"
                    />
                  </span>
                </span>
              ) : null}
              {row.nextDate === null ? (
                <span className="text-xs text-muted">
                  <FormattedMessage
                    id="home.contracts.noUpcomingDate"
                    defaultMessage="No upcoming date"
                  />
                </span>
              ) : (
                <time
                  dateTime={row.nextDate}
                  title={formatFullDate(row.nextDate)}
                  className="text-xs font-semibold text-muted"
                >
                  {formatDeadline(row.nextDate)}
                </time>
              )}
            </span>
          </Link>
        </li>
      ))}
    </HomeSectionCard>
  );
}
