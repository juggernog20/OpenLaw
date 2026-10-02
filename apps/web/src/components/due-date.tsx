// SPDX-License-Identifier: AGPL-3.0-only

/**
 * An open due date in the DES-014 due-date format. An overdue date sits
 * in the severe pill and starts with "Overdue" for screen readers, so
 * the state does not rest on colour alone (DES-018). Home, the
 * compliance calendar and the Entity Obligations tab draw it this way.
 */
import { FormattedMessage } from "react-intl";
import { formatDeadline, formatFullDate } from "../lib/format";
import { cn } from "../lib/utils";

/** The screen-reader prefix that names an overdue date or chip. The
 * space sits outside the hidden span, or the accessible name runs the
 * two words together. A leading space collapses on screen. */
export function OverduePrefix() {
  return (
    <>
      <span className="sr-only">
        <FormattedMessage id="dueDate.overdue" defaultMessage="Overdue" />
      </span>{" "}
    </>
  );
}

export function DueDate({
  date,
  overdue,
  className,
}: Readonly<{ date: string; overdue: boolean; className?: string }>) {
  return (
    <time
      dateTime={date}
      title={formatFullDate(date)}
      className={cn(
        "rounded-pill px-2 py-0.5 text-xs font-semibold",
        overdue ? "bg-status-severe-bg text-status-severe-fg" : "text-muted",
        className,
      )}
    >
      {overdue ? <OverduePrefix /> : null}
      {formatDeadline(date)}
    </time>
  );
}
