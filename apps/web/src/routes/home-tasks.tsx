// SPDX-License-Identifier: AGPL-3.0-only

/** Assigned Tasks, with a Due filter, optional completed rows and Undo for the latest completion (DES-069). */

import { useId, useState } from "react";
import {
  redirect,
  useLoaderData,
  useSearchParams,
  type LoaderFunctionArgs,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { Undo2 } from "lucide-react";
import { api } from "../lib/api";
import { civilToday } from "../lib/format";
import { requireUser, useSignOut } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { PageTitle } from "../components/page-title";
import { HomeTasksCard } from "../components/home/tasks-card";
import { CompletedTasksToggle } from "../components/tasks/completed-toggle";
import { Button } from "../components/ui/button";
import { toggleContractTask } from "../lib/tasks";
import { toggleMatterTask } from "../lib/matter-tasks";
import type { TasksHomeSection } from "../lib/home";

type AssignedTask = TasksHomeSection["rows"][number];
const taskKey = (task: AssignedTask) => `${task.record.kind}:${task.id}`;

function compareTasks(a: AssignedTask, b: AssignedTask) {
  const left = `${a.dueDate ?? "9999-12-31"}:${taskKey(a)}`;
  const right = `${b.dueDate ?? "9999-12-31"}:${taskKey(b)}`;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The Due filter lives in the `due` search parameter; no parameter means All. */
type Due = "all" | "overdue" | "week";
const dueChoices = defineMessages({
  all: { id: "home.tasks.dueAll", defaultMessage: "All" },
  overdue: { id: "home.tasks.dueOverdue", defaultMessage: "Overdue" },
  week: { id: "home.tasks.dueWeek", defaultMessage: "Due in the next 7 days" },
});

function dueFrom(value: string | null): Due {
  return value === "overdue" || value === "week" ? value : "all";
}

function dueQuery(due: Due) {
  if (due === "overdue") return { overdue: "true" as const };
  if (due === "week") return { dueWithinDays: 7 };
  return {};
}

// A Due change has already read the exact list it is about to put in the
// address bar. Only that one navigation skips the loader; a link to
// /home/tasks with another Due, such as My Tasks while a filter is on,
// must still reload. The same arrangement as the Documents page.
let locallyReadSearch: string | null = null;

// Counts loader runs. The page remounts from loader data on every run, so a
// skipped revalidation keeps the local state and a real one replaces it.
let loads = 0;

export async function homeTasksLoader({ request }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (user.role === "business_user") return redirect("/portal");
  const due = dueFrom(new URL(request.url).searchParams.get("due"));
  const { data } = await api.GET("/api/v1/home/tasks", { params: { query: dueQuery(due) } });
  if (!data) throw new Error("My Tasks could not be read.");
  return { user, tasks: data, loadKey: ++loads };
}

/** The page reads its own Due choice itself, so that one address change
 * does not reload it. Any other change to the address does. */
export function homeTasksShouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  if (
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search !== nextUrl.search &&
    locallyReadSearch === nextUrl.search
  ) {
    locallyReadSearch = null;
    return false;
  }
  locallyReadSearch = null;
  return defaultShouldRevalidate;
}

export function HomeTasksPage() {
  const { loadKey } = useLoaderData<typeof homeTasksLoader>();
  return <HomeTasksPageState key={loadKey} />;
}

function HomeTasksPageState() {
  const { user, tasks } = useLoaderData<typeof homeTasksLoader>();
  const intl = useIntl();
  const signOut = useSignOut("/auth/login");
  const [page, setPage] = useState(tasks);
  const [searchParams, setSearchParams] = useSearchParams();
  const due = dueFrom(searchParams.get("due"));
  const dueId = useId();
  const [showCompleted, setShowCompleted] = useState(false);
  const [filterFailed, setFilterFailed] = useState<"completed" | "due" | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<"complete" | "undo" | "reopen" | null>(
    null,
  );
  const [completedTask, setCompletedTask] = useState<AssignedTask | null>(null);
  const [restoredTitle, setRestoredTitle] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string>();
  const [undoing, setUndoing] = useState(false);
  const [departure, setDeparture] = useState<AssignedTask | null>(null);
  const busy = loading || completing || undoing || departure !== null;

  async function changeFilter(includeCompleted: boolean, nextDue: Due) {
    if (busy) return;
    setLoading(true);
    setFilterFailed(null);
    try {
      const { data } = await api.GET("/api/v1/home/tasks", {
        params: {
          query: { includeCompleted: includeCompleted ? "true" : "false", ...dueQuery(nextDue) },
        },
      });
      if (!data) throw new Error("Tasks could not be read.");
      setPage(data);
      setShowCompleted(includeCompleted);
      if (nextDue !== due) {
        const next = new URLSearchParams(searchParams);
        if (nextDue === "all") next.delete("due");
        else next.set("due", nextDue);
        const search = next.toString();
        locallyReadSearch = search ? `?${search}` : "";
        setSearchParams(next, { replace: true });
      }
      setFailed(false);
    } catch {
      setFilterFailed(nextDue === due ? "completed" : "due");
    } finally {
      setLoading(false);
    }
  }

  function finishDeparture(row: AssignedTask) {
    if (!departure || taskKey(row) !== taskKey(departure)) return;
    setPage((previous) => ({
      ...previous,
      total: Math.max(0, previous.total - 1),
      rows: previous.rows.filter((task) => taskKey(task) !== taskKey(row)),
    }));
    setDeparture(null);
  }

  async function completeTask(row: AssignedTask) {
    if (busy) return;
    setCompleting(true);
    setPendingKey(taskKey(row));
    setCompletionError(null);
    setRestoredTitle(null);
    try {
      const result = await (row.record.kind === "contract"
        ? toggleContractTask(row.id)
        : toggleMatterTask(row.id));
      const updated = result.ok ? result.tasks.find((task) => task.id === row.id) : undefined;
      if (!updated || updated.isDone === Boolean(row.isDone)) {
        setCompletionError(row.isDone ? "reopen" : "complete");
        return;
      }
      if (updated.isDone) {
        setCompletedTask(row);
        if (!showCompleted) setDeparture(row);
      } else {
        if (completedTask && taskKey(completedTask) === taskKey(row)) setCompletedTask(null);
        setRestoredTitle(row.title);
      }
      if (showCompleted) {
        setPage((previous) => ({
          ...previous,
          rows: previous.rows.map((task) =>
            taskKey(task) === taskKey(row)
              ? {
                  ...task,
                  isDone: updated.isDone,
                  isOverdue:
                    !updated.isDone && Boolean(task.dueDate && task.dueDate < civilToday()),
                }
              : task,
          ),
        }));
      }
    } catch {
      setCompletionError(row.isDone ? "reopen" : "complete");
    } finally {
      setCompleting(false);
      setPendingKey(undefined);
    }
  }

  async function undoCompletion() {
    if (!completedTask || completing || loading || undoing) return;
    const row = completedTask;
    setUndoing(true);
    setCompletionError(null);
    try {
      const result = await (row.record.kind === "contract"
        ? toggleContractTask(row.id)
        : toggleMatterTask(row.id));
      const restored = result.ok ? result.tasks.find((task) => task.id === row.id) : undefined;
      if (!restored || restored.isDone) {
        setCompletionError("undo");
        return;
      }
      setDeparture(null);
      setPage((previous) => {
        if (previous.rows.some((task) => taskKey(task) === taskKey(row))) {
          return {
            ...previous,
            rows: previous.rows.map((task) => (taskKey(task) === taskKey(row) ? row : task)),
          };
        }
        return {
          ...previous,
          total: previous.total + (showCompleted ? 0 : 1),
          rows: [...previous.rows, row].sort(compareTasks),
        };
      });
      setCompletedTask(null);
      setRestoredTitle(row.title);
    } catch {
      setCompletionError("undo");
    } finally {
      setUndoing(false);
    }
  }

  async function loadMore() {
    if (busy || !page.nextCursor) return;
    setLoading(true);
    setFailed(false);
    try {
      const { data } = await api.GET("/api/v1/home/tasks", {
        params: {
          query: {
            cursor: page.nextCursor,
            includeCompleted: showCompleted ? "true" : "false",
            ...dueQuery(due),
          },
        },
      });
      if (!data) throw new Error("Tasks could not be read.");
      setPage((previous) => {
        const seen = new Set(previous.rows.map((row) => `${row.record.kind}:${row.id}`));
        return {
          ...previous,
          nextCursor: data.nextCursor,
          rows: [
            ...previous.rows,
            ...data.rows.filter((row) => !seen.has(`${row.record.kind}:${row.id}`)),
          ],
        };
      });
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const title = intl.formatMessage({
    id: "home.tasks.pageTitle",
    defaultMessage: "My Tasks",
  });
  return (
    <AppShell user={user} onSignOut={() => void signOut()} subbar={<PageSubBar title={title} />}>
      <PageTitle title={title} />
      <div className="space-y-4">
        {filterFailed ? (
          <p role="alert" className="text-status-severe-fg">
            {filterFailed === "due" ? (
              <FormattedMessage
                id="home.tasks.dueFailed"
                defaultMessage="Tasks could not be loaded. Try changing the Due filter again."
              />
            ) : (
              <FormattedMessage
                id="tasks.completed.failed"
                defaultMessage="Tasks could not be loaded. Try changing the completed filter again."
              />
            )}
          </p>
        ) : null}
        <div
          className={completedTask || restoredTitle ? "flex min-h-8 items-center gap-2" : "sr-only"}
        >
          <p role="status" className="text-muted empty:hidden">
            {completedTask ? (
              <FormattedMessage
                id="home.tasks.completed"
                defaultMessage="Completed: {title}"
                values={{ title: completedTask.title }}
              />
            ) : restoredTitle ? (
              <FormattedMessage
                id="home.tasks.restored"
                defaultMessage="Reopened: {title}"
                values={{ title: restoredTitle }}
              />
            ) : null}
          </p>
          {completedTask ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={completing || loading || undoing}
              onClick={() => void undoCompletion()}
            >
              <Undo2 size={14} aria-hidden="true" />
              <FormattedMessage id="home.tasks.undo" defaultMessage="Undo" />
            </Button>
          ) : null}
        </div>
        {completionError ? (
          <p role="alert" className="text-status-severe-fg">
            {completionError === "reopen" ? (
              <FormattedMessage
                id="home.tasks.reopenFailed"
                defaultMessage="The Task could not be reopened. Please try again."
              />
            ) : completionError === "undo" ? (
              <FormattedMessage
                id="home.tasks.undoFailed"
                defaultMessage="The Task could not be reopened. Please try Undo again."
              />
            ) : (
              <FormattedMessage
                id="home.tasks.completeFailed"
                defaultMessage="The Task could not be marked done. Please try again."
              />
            )}
          </p>
        ) : null}
        <HomeTasksCard
          section={{ type: "tasks", total: page.total, rows: page.rows }}
          showViewAll={false}
          headerAction={
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-primary">
                <label htmlFor={dueId}>
                  <FormattedMessage id="home.tasks.due" defaultMessage="Due" />
                </label>
                <select
                  id={dueId}
                  value={due}
                  disabled={busy}
                  onChange={(event) =>
                    void changeFilter(showCompleted, dueFrom(event.target.value))
                  }
                  className="h-7 rounded-button border border-border-default bg-raised px-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-link"
                >
                  <option value="all">{intl.formatMessage(dueChoices.all)}</option>
                  <option value="overdue">{intl.formatMessage(dueChoices.overdue)}</option>
                  <option value="week">{intl.formatMessage(dueChoices.week)}</option>
                </select>
              </div>
              <CompletedTasksToggle
                showCompleted={showCompleted}
                disabled={busy}
                onChange={(value) => void changeFilter(value, due)}
              />
            </div>
          }
          emptyMessage={
            !page.nextCursor &&
            (showCompleted ? (
              <FormattedMessage
                id="home.tasks.emptyAll"
                defaultMessage="No Tasks assigned to you."
              />
            ) : (
              <FormattedMessage
                id="home.tasks.empty"
                defaultMessage="No open Tasks assigned to you."
              />
            ))
          }
          onComplete={user.role === "business_user" ? undefined : (row) => void completeTask(row)}
          busy={busy}
          checkedTaskKey={pendingKey ?? (departure ? taskKey(departure) : undefined)}
          exitingTaskKey={departure ? taskKey(departure) : undefined}
          onExit={finishDeparture}
        />
        {failed ? (
          <p role="alert" className="text-status-severe-fg">
            <FormattedMessage
              id="home.tasks.loadFailed"
              defaultMessage="More Tasks could not be loaded. Please try again."
            />
          </p>
        ) : null}
        {page.nextCursor ? (
          <Button variant="secondary" disabled={busy} onClick={() => void loadMore()}>
            {loading ? (
              <FormattedMessage id="home.tasks.loading" defaultMessage="Loading…" />
            ) : (
              <FormattedMessage id="home.tasks.loadMore" defaultMessage="Load more Tasks" />
            )}
          </Button>
        ) : null}
      </div>
    </AppShell>
  );
}
