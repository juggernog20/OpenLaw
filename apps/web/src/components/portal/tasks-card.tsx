// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Tasks Legal assigned to the Portal viewer (MTR-005 addendum, 2026-10-02).
 * The viewer completes or reopens their own Task here. Every other Task change
 * stays with Legal.
 */
import { useId, useState } from "react";
import { Link } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Checkbox } from "../ui/checkbox";
import { Button } from "../ui/button";
import { CompletedTasksToggle } from "../tasks/completed-toggle";
import { TaskDueDate } from "../tasks/due-date";
import type { PortalRecordModule } from "../../lib/portal-records";
import {
  readPortalTasks,
  togglePortalTask,
  type PortalTask,
  type PortalTaskPage,
} from "../../lib/portal-tasks";

const taskKey = (task: PortalTask) => `${task.record.kind}:${task.id}`;

export function PortalTasksCard({
  initial,
  record,
}: Readonly<{
  initial: PortalTaskPage;
  /** Set on a record page: the card lists only that record's Tasks. */
  record?: { kind: PortalRecordModule; number: number };
}>) {
  const intl = useIntl();
  const headingId = useId();
  const [page, setPage] = useState(initial);
  const [showCompleted, setShowCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<"load" | "save" | null>(null);
  const [notice, setNotice] = useState<{ isDone: boolean; title: string } | null>(null);

  async function changeCompleted(includeCompleted: boolean) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const data = await readPortalTasks({ includeCompleted, record }).catch(() => undefined);
    if (data) {
      setPage(data);
      setShowCompleted(includeCompleted);
    } else setFailure("load");
    setBusy(false);
  }

  async function loadMore() {
    if (busy || !page.nextCursor) return;
    setBusy(true);
    setFailure(null);
    const data = await readPortalTasks({
      includeCompleted: showCompleted,
      cursor: page.nextCursor,
      record,
    }).catch(() => undefined);
    if (data) {
      setPage((previous) => {
        const seen = new Set(previous.rows.map(taskKey));
        return {
          ...previous,
          nextCursor: data.nextCursor,
          rows: [...previous.rows, ...data.rows.filter((row) => !seen.has(taskKey(row)))],
        };
      });
    } else setFailure("load");
    setBusy(false);
  }

  async function toggle(task: PortalTask) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setNotice(null);
    const updated = await togglePortalTask(task).catch(() => undefined);
    if (updated) {
      setNotice({ isDone: updated.isDone, title: updated.title });
      setPage((previous) =>
        updated.isDone && !showCompleted
          ? {
              ...previous,
              total: Math.max(0, previous.total - 1),
              rows: previous.rows.filter((row) => taskKey(row) !== taskKey(updated)),
            }
          : {
              ...previous,
              rows: previous.rows.map((row) => (taskKey(row) === taskKey(updated) ? updated : row)),
            },
      );
    } else setFailure("save");
    setBusy(false);
  }

  return (
    <section
      aria-labelledby={headingId}
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex min-h-section-header flex-wrap items-center justify-between gap-2 border-b border-border-default bg-section-header px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={headingId} className="text-base font-semibold">
            <FormattedMessage id="portal.tasks.assigned" defaultMessage="Tasks assigned to you" />
          </h2>
          <span
            role="img"
            aria-label={intl.formatMessage(
              {
                id: "portal.tasks.count",
                defaultMessage: "{count, plural, one {# Task} other {# Tasks}}",
              },
              { count: page.total },
            )}
            className="rounded-chip bg-badge-count-bg px-1.5 py-px text-xs font-medium text-badge-count-fg"
          >
            {intl.formatNumber(page.total)}
          </span>
        </div>
        <CompletedTasksToggle
          showCompleted={showCompleted}
          disabled={busy}
          onChange={(value) => void changeCompleted(value)}
        />
      </header>
      <p role="status" className={notice ? "px-4 pt-3 text-base text-muted" : "sr-only"}>
        {notice ? (
          notice.isDone ? (
            <FormattedMessage
              id="portal.tasks.completed"
              defaultMessage="Completed: {title}"
              values={{ title: notice.title }}
            />
          ) : (
            <FormattedMessage
              id="portal.tasks.reopened"
              defaultMessage="Reopened: {title}"
              values={{ title: notice.title }}
            />
          )
        ) : null}
      </p>
      {failure ? (
        <p role="alert" className="px-4 pt-3 text-base text-status-severe-fg">
          {failure === "save" ? (
            <FormattedMessage
              id="portal.tasks.saveFailed"
              defaultMessage="The Task could not be saved. Try again."
            />
          ) : (
            <FormattedMessage
              id="portal.tasks.loadFailed"
              defaultMessage="Tasks could not be loaded. Try again."
            />
          )}
        </p>
      ) : null}
      {page.rows.length === 0 ? (
        <p className="px-4 py-3 text-base text-muted">
          {showCompleted ? (
            <FormattedMessage
              id="portal.tasks.emptyAll"
              defaultMessage="No Tasks assigned to you."
            />
          ) : (
            <FormattedMessage
              id="portal.tasks.empty"
              defaultMessage="No open Tasks assigned to you."
            />
          )}
        </p>
      ) : (
        <ul className="divide-y divide-border-muted" role="list">
          {page.rows.map((task) => (
            <li key={taskKey(task)} className="flex items-center gap-3 px-4 py-2.5">
              <Checkbox
                checked={task.isDone}
                disabled={busy}
                onCheckedChange={() => void toggle(task)}
                aria-label={intl.formatMessage(
                  {
                    id: "portal.tasks.toggle",
                    defaultMessage:
                      "{done, select, true {Reopen Task: {title}} other {Complete Task: {title}}}",
                  },
                  { done: String(task.isDone), title: task.title },
                )}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className={`text-base ${task.isDone ? "text-muted line-through" : "text-primary"}`}
                >
                  {task.title}
                </span>
                {record ? null : (
                  <Link
                    to={`/portal/${task.record.kind}s/${task.record.number}`}
                    className="w-fit max-w-full truncate text-xs text-link hover:underline focus-visible:outline-2 focus-visible:outline-link"
                  >
                    <FormattedMessage
                      id="portal.tasks.record"
                      defaultMessage="{title} · {kind, select, contract {Contract C-{number}} other {Matter M-{number}}}"
                      values={{
                        title: task.record.title,
                        kind: task.record.kind,
                        number: task.record.number,
                      }}
                    />
                  </Link>
                )}
                {task.dueDate ? <TaskDueDate dueDate={task.dueDate} isDone={task.isDone} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor ? (
        <div className="border-t border-border-muted px-4 py-3">
          <Button variant="secondary" disabled={busy} onClick={() => void loadMore()}>
            <FormattedMessage id="portal.tasks.loadMore" defaultMessage="Load more Tasks" />
          </Button>
        </div>
      ) : null}
    </section>
  );
}
