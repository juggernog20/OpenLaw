// SPDX-License-Identifier: AGPL-3.0-only

/** Contract and Matter Tasks assigned to the signed-in viewer. */
import { ListChecks } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import type { TasksHomeSection } from "../../lib/home";
import { formatDeadline, formatFullDate, formatShortDate } from "../../lib/format";
import { ConfidentialMarker } from "../confidential-marker";
import { HomeSectionCard } from "./section-card";
import { Checkbox } from "../ui/checkbox";

const taskActions = defineMessages({
  reopen: { id: "home.tasks.reopen", defaultMessage: "Reopen Task: {title}" },
  complete: { id: "home.tasks.complete", defaultMessage: "Complete Task: {title}" },
});

function taskHref(row: TasksHomeSection["rows"][number]): string {
  const destination = row.record.kind === "contract" ? "contracts" : "matters";
  return `/${destination}/${String(row.record.number)}/tasks`;
}

export function HomeTasksCard({
  section,
  showViewAll = true,
  headerAction,
  emptyMessage,
  onComplete,
  busy = false,
  checkedTaskKey,
  exitingTaskKey,
  onExit,
}: Readonly<{
  section: TasksHomeSection;
  showViewAll?: boolean;
  headerAction?: ReactNode;
  emptyMessage?: ReactNode;
  onComplete?: (row: TasksHomeSection["rows"][number]) => void;
  busy?: boolean;
  checkedTaskKey?: string;
  exitingTaskKey?: string;
  onExit?: (row: TasksHomeSection["rows"][number]) => void;
}>) {
  const intl = useIntl();
  return (
    <HomeSectionCard
      headingId="home-tasks-heading"
      title={<FormattedMessage id="home.tasks.title" defaultMessage="Tasks assigned to you" />}
      total={section.total}
      viewAllTo={showViewAll ? "/home/tasks" : undefined}
      headerAction={headerAction}
    >
      {section.rows.length === 0 && emptyMessage ? (
        <li className="px-4 py-3 text-base text-muted">{emptyMessage}</li>
      ) : null}
      {section.rows.map((row) => (
        <li
          key={`${row.record.kind}:${row.id}`}
          className={`grid grid-rows-[1fr] ${exitingTaskKey === `${row.record.kind}:${row.id}` ? "home-task-exit" : ""}`}
          onAnimationEnd={(event) => {
            if (
              event.target === event.currentTarget &&
              exitingTaskKey === `${row.record.kind}:${row.id}`
            )
              onExit?.(row);
          }}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex items-center">
              {onComplete ? (
                <Checkbox
                  className="ms-4 me-1 data-[state=checked]:disabled:opacity-100"
                  checked={row.isDone || checkedTaskKey === `${row.record.kind}:${row.id}`}
                  disabled={busy}
                  onCheckedChange={() => onComplete(row)}
                  aria-label={intl.formatMessage(
                    row.isDone ? taskActions.reopen : taskActions.complete,
                    { title: row.title },
                  )}
                />
              ) : null}
              <Link
                to={taskHref(row)}
                tabIndex={exitingTaskKey === `${row.record.kind}:${row.id}` ? -1 : undefined}
                className="flex min-h-11.25 min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-primary hover:bg-section-header focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-6.5 shrink-0 items-center justify-center rounded-card bg-section-header text-muted">
                    <ListChecks size={16} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`truncate text-md font-medium ${row.isDone ? "text-muted line-through" : ""}`}
                      >
                        {row.title}
                      </span>
                      {row.record.isConfidential ? <ConfidentialMarker /> : null}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      <FormattedMessage
                        id="home.tasks.record"
                        defaultMessage="{title} · {kind, select, contract {Contract C-{number}} other {Matter M-{number}}}"
                        values={{
                          title: row.record.title,
                          kind: row.record.kind,
                          number: row.record.number,
                        }}
                      />
                    </span>
                  </span>
                </span>
                {row.dueDate ? (
                  <time
                    dateTime={row.dueDate}
                    title={formatFullDate(row.dueDate)}
                    className={`shrink-0 rounded-pill px-2 py-0.5 text-xs font-semibold ${row.isOverdue ? "bg-status-severe-bg text-status-severe-fg" : "text-muted"}`}
                  >
                    {row.isOverdue ? (
                      <span className="sr-only">
                        <FormattedMessage id="home.tasks.overdue" defaultMessage="Overdue" />{" "}
                      </span>
                    ) : null}
                    {row.isDone ? formatShortDate(row.dueDate) : formatDeadline(row.dueDate)}
                  </time>
                ) : (
                  <span className="shrink-0 text-xs text-muted">
                    <FormattedMessage id="home.tasks.noDueDate" defaultMessage="No due date" />
                  </span>
                )}
              </Link>
            </div>
          </div>
        </li>
      ))}
    </HomeSectionCard>
  );
}
