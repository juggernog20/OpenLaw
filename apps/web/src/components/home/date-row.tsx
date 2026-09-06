// SPDX-License-Identifier: AGPL-3.0-only

/** Contract and Matter dates approaching on records personal to the viewer. */
import { CalendarDays } from "lucide-react";
import { Link } from "react-router";
import { FormattedMessage } from "react-intl";
import type { DatesHomeSection } from "../../lib/home";
import { formatDeadline, formatFullDate } from "../../lib/format";
import { ConfidentialMarker } from "../confidential-marker";
import { UnverifiedMarker } from "../contracts/ai-analysis-card";

type DateRow = DatesHomeSection["rows"][number];

function dateHref(row: DateRow): string {
  const destination = row.record.kind === "contract" ? "contracts" : "matters";
  return `/${destination}/${String(row.record.number)}/key-dates`;
}

/** DES-042's event vocabulary: a named Key date keeps its label, while
 * the two term-derived rows say what the term produced. */
function EventName({ row }: Readonly<{ row: DateRow }>) {
  if (row.source === "key_date") return <>{row.label}</>;
  if (row.source === "expiry") {
    return <FormattedMessage id="home.dates.expiry" defaultMessage="Current term expires" />;
  }
  return row.noticePeriodDays === null ? (
    <FormattedMessage id="home.dates.noticeDeadline" defaultMessage="Renewal notice deadline" />
  ) : (
    <FormattedMessage
      id="home.dates.noticeDeadlineWithPeriod"
      defaultMessage="Renewal notice deadline — {days, plural, one {# day} other {# days}} before expiry"
      values={{ days: row.noticePeriodDays }}
    />
  );
}

function SourceName({ source }: Readonly<{ source: DateRow["source"] }>) {
  return source === "key_date" ? (
    <FormattedMessage id="home.dates.keyDate" defaultMessage="Key date" />
  ) : (
    <FormattedMessage id="home.dates.derived" defaultMessage="Derived" />
  );
}

export function HomeDateLink({ row }: Readonly<{ row: DateRow }>) {
  return (
    <Link
      to={dateHref(row)}
      className="flex min-h-11.25 items-center justify-between gap-3 px-3 py-2 text-primary hover:bg-section-header focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-6.5 shrink-0 items-center justify-center rounded-card bg-section-header text-muted">
          <CalendarDays size={16} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-md font-medium">
            <EventName row={row} />
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <span className="truncate">{row.record.title}</span>
            {row.record.isConfidential ? <ConfidentialMarker /> : null}
            <span aria-hidden="true">·</span>
            <span className="shrink-0">
              <SourceName source={row.source} />
            </span>
            {row.unverified ? <UnverifiedMarker /> : null}
            <span aria-hidden="true">·</span>
            <span className="shrink-0">
              <FormattedMessage
                id="home.dates.record"
                defaultMessage="{kind, select, contract {Contract C-{number}} other {Matter M-{number}}}"
                values={{
                  kind: row.record.kind,
                  number: row.record.number,
                }}
              />
            </span>
          </span>
        </span>
      </span>
      <time
        dateTime={row.date}
        title={formatFullDate(row.date)}
        className="shrink-0 text-xs font-semibold text-muted"
      >
        {formatDeadline(row.date)}
      </time>
    </Link>
  );
}
