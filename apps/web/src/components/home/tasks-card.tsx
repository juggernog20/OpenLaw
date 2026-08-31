// SPDX-License-Identifier: AGPL-3.0-only

/** Open Contract and Matter Tasks assigned to the signed-in viewer. */
import { ListChecks } from "lucide-react";
import { Link } from "react-router";
import { FormattedMessage } from "react-intl";
import type { TasksHomeSection } from "../../lib/home";
import { formatDeadline, formatFullDate } from "../../lib/format";
import { ConfidentialMarker } from "../confidential-marker";
import { HomeSectionCard } from "./section-card";

function taskHref(row: TasksHomeSection["rows"][number]): string {
  const destination = row.record.kind === "contract" ? "contracts" : "matters";
  return `/${destination}/${String(row.record.number)}/tasks`;
}

export function HomeTasksCard({ section }: Readonly<{ section: TasksHomeSection }>) {
  return (
    <HomeSectionCard
      headingId="home-tasks-heading"
      title={<FormattedMessage id="home.tasks.title" defaultMessage="Tasks assigned to you" />}
      total={section.total}
    >
      {section.rows.map((row) => (
        <li key={`${row.record.kind}:${row.id}`}>
          <Link
            to={taskHref(row)}
            className="flex min-h-11.25 items-center justify-between gap-3 px-3 py-2 text-primary hover:bg-section-header focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-6.5 shrink-0 items-center justify-center rounded-card bg-section-header text-muted">
                <ListChecks size={14} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-md font-medium">{row.title}</span>
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
                {formatDeadline(row.dueDate)}
              </time>
            ) : (
              <span className="shrink-0 text-xs text-muted">
                <FormattedMessage id="home.tasks.noDueDate" defaultMessage="No due date" />
              </span>
            )}
          </Link>
        </li>
      ))}
    </HomeSectionCard>
  );
}
