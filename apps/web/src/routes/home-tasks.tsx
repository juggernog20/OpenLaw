// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Undo2 } from "lucide-react";
import { api } from "../lib/api";
import { requireUser, useSignOut } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { PageTitle } from "../components/page-title";
import { HomeTasksCard } from "../components/home/tasks-card";
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

export async function homeTasksLoader() {
  const user = await requireUser();
  if (user.role === "business_user") return redirect("/portal");
  const { data } = await api.GET("/api/v1/home/tasks");
  if (!data) throw new Error("Your Tasks could not be read.");
  return { user, tasks: data };
}

export function HomeTasksPage() {
  const { user, tasks } = useLoaderData<typeof homeTasksLoader>();
  const intl = useIntl();
  const signOut = useSignOut("/auth/login");
  const [page, setPage] = useState(tasks);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<"complete" | "undo" | null>(null);
  const [completedTask, setCompletedTask] = useState<AssignedTask | null>(null);
  const [restoredTitle, setRestoredTitle] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string>();
  const [undoing, setUndoing] = useState(false);
  const [departure, setDeparture] = useState<AssignedTask | null>(null);
  const busy = loading || completing || undoing || departure !== null;

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
      if (!result.ok || !result.tasks.find((task) => task.id === row.id)?.isDone) {
        setCompletionError("complete");
        return;
      }
      setCompletedTask(row);
      setDeparture(row);
    } catch {
      setCompletionError("complete");
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
        if (previous.rows.some((task) => taskKey(task) === taskKey(row))) return previous;
        return {
          ...previous,
          total: previous.total + 1,
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
        params: { query: { cursor: page.nextCursor } },
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
    defaultMessage: "Your Tasks",
  });
  return (
    <AppShell user={user} onSignOut={() => void signOut()} subbar={<PageSubBar title={title} />}>
      <PageTitle title={title} />
      <div className="space-y-4">
        <Button asChild variant="link" className="px-0">
          <Link to="/">
            <FormattedMessage id="home.tasks.back" defaultMessage="Back to Home" />
          </Link>
        </Button>
        <div className="flex min-h-8 items-center gap-2">
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
            {completionError === "undo" ? (
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
        {page.rows.length === 0 && !page.nextCursor ? (
          <p className="text-muted">
            <FormattedMessage
              id="home.tasks.empty"
              defaultMessage="No open Tasks assigned to you."
            />
          </p>
        ) : (
          <HomeTasksCard
            section={{ type: "tasks", total: page.total, rows: page.rows }}
            showViewAll={false}
            onComplete={user.role === "contributor" ? undefined : (row) => void completeTask(row)}
            busy={busy}
            checkedTaskKey={pendingKey ?? (departure ? taskKey(departure) : undefined)}
            exitingTaskKey={departure ? taskKey(departure) : undefined}
            onExit={finishDeparture}
          />
        )}
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
