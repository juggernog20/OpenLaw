// SPDX-License-Identifier: AGPL-3.0-only

/** A Task row's due date; an open Task past it shows the severe pill (DES-018). */
import { FormattedMessage } from "react-intl";
import { civilToday, formatDeadline, formatFullDate, formatShortDate } from "../../lib/format";

export function TaskDueDate({ dueDate, isDone }: Readonly<{ dueDate: string; isDone: boolean }>) {
  if (isDone || dueDate >= civilToday()) {
    return (
      <span className="text-xs text-muted">
        <FormattedMessage
          id="tasks.dueDate"
          defaultMessage="Due {date}"
          values={{ date: formatShortDate(dueDate) }}
        />
      </span>
    );
  }
  return (
    <time
      dateTime={dueDate}
      title={formatFullDate(dueDate)}
      className="w-fit rounded-pill bg-status-severe-bg px-2 py-0.5 text-xs font-semibold text-status-severe-fg"
    >
      <span className="sr-only">
        <FormattedMessage id="tasks.overdue" defaultMessage="Overdue" />{" "}
      </span>
      {formatDeadline(dueDate)}
    </time>
  );
}
