// SPDX-License-Identifier: AGPL-3.0-only

/** The first M29 Home section: pending Contract approval requests. */
import { BadgeCheck } from "lucide-react";
import { Link } from "react-router";
import { FormattedMessage } from "react-intl";
import type { ApprovalHomeSection } from "../../lib/home";
import { formatLongDateTime, formatRelativeOrShort } from "../../lib/format";
import { ConfidentialMarker } from "../confidential-marker";
import { HomeSectionCard } from "./section-card";

export function HomeApprovalsCard({ section }: Readonly<{ section: ApprovalHomeSection }>) {
  return (
    <HomeSectionCard
      headingId="home-approvals-heading"
      title={
        <FormattedMessage id="home.approvals.title" defaultMessage="Approvals waiting on you" />
      }
      total={section.total}
      viewAllTo="/contracts"
    >
      {section.rows.map((row) => (
        <li key={row.id}>
          <Link
            to={`/contracts/${String(row.contract.number)}/approvals`}
            aria-label={row.contract.title}
            className="flex min-h-11.25 items-center justify-between gap-3 px-3 py-2 text-primary hover:bg-section-header focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-6.5 shrink-0 items-center justify-center rounded-card bg-section-header text-muted">
                <BadgeCheck size={16} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-md font-medium">{row.contract.title}</span>
                  {row.contract.isConfidential ? <ConfidentialMarker /> : null}
                </span>
                <span className="block truncate text-xs text-muted">
                  <FormattedMessage
                    id="home.approvals.requestedBy"
                    defaultMessage="Requested by {name} · Contract C-{number}"
                    values={{ name: row.requestedBy.displayName, number: row.contract.number }}
                  />
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2.5">
              <span className="hidden rounded-pill bg-status-info-bg px-2 py-0.5 text-xs font-semibold text-status-info-fg @sm/page:inline-flex">
                <FormattedMessage id="home.approvals.awaiting" defaultMessage="Awaiting you" />
              </span>
              <time
                dateTime={row.requestedAt}
                title={formatLongDateTime(row.requestedAt)}
                className="text-xs text-muted"
              >
                {formatRelativeOrShort(row.requestedAt)}
              </time>
            </span>
          </Link>
        </li>
      ))}
    </HomeSectionCard>
  );
}
