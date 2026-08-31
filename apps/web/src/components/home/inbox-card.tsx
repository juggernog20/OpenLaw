// SPDX-License-Identifier: AGPL-3.0-only

/** The Member+ Inbox pressure summary. */
import { Inbox } from "lucide-react";
import { Link } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import type { InboxHomeSection } from "../../lib/home";
import { SEVERITY_PILL, severityLabel } from "../../lib/contracts";
import { formatFullDate, formatRelativeOrShort } from "../../lib/format";
import { requestReference } from "../../lib/requests";
import { HomeSectionCard } from "./section-card";

export function HomeInboxCard({ section }: Readonly<{ section: InboxHomeSection }>) {
  const intl = useIntl();
  return (
    <HomeSectionCard
      headingId="home-inbox-heading"
      title={<FormattedMessage id="home.inbox.title" defaultMessage="Inbox" />}
      total={section.total}
      viewAllTo="/inbox"
    >
      {section.rows.map((row) => (
        <li key={row.id}>
          <Link
            to={`/inbox/${String(row.number)}`}
            className="flex min-h-11.25 items-center justify-between gap-3 px-3 py-2 text-primary hover:bg-section-header focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-6.5 shrink-0 items-center justify-center rounded-card bg-section-header text-muted">
                <Inbox size={14} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-md font-medium">{row.summary}</span>
                <span className="block truncate text-xs text-muted">
                  <FormattedMessage
                    id="home.inbox.request"
                    defaultMessage="{reference} · {requestType} · {requester}"
                    values={{
                      reference: requestReference(intl, row.number),
                      requestType: row.requestType.displayName,
                      requester: row.requester.displayName,
                    }}
                  />
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${SEVERITY_PILL[row.urgency]}`}
              >
                <FormattedMessage
                  id="home.inbox.urgency"
                  defaultMessage="{urgency} urgency"
                  values={{ urgency: severityLabel(intl, row.urgency) }}
                />
              </span>
              <time
                dateTime={row.createdAt}
                title={formatFullDate(row.createdAt)}
                className="text-xs text-muted"
              >
                {formatRelativeOrShort(row.createdAt, { locale: intl.locale })}
              </time>
            </span>
          </Link>
        </li>
      ))}
    </HomeSectionCard>
  );
}
