// SPDX-License-Identifier: AGPL-3.0-only

/** A Matter's lightweight Task checklist (MTR-005, M23/4). */
import { useState } from "react";
import {
  TaskAssigneePicker,
  taskAssignee,
  type TaskAssigneePerson,
  type TaskTeamExpansion,
} from "../tasks/assignee-picker";
import { useRecord } from "../record-context";
import { FormattedMessage, useIntl } from "react-intl";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { TaskDialog } from "../tasks/task-dialog";
import { useSearchParams } from "react-router";
import {
  addMatterTask,
  removeMatterTask,
  toggleMatterTask,
  updateMatterTask,
  type MatterTask,
  type MatterTasksOutcome,
} from "../../lib/matter-tasks";
import { formatShortDate } from "../../lib/format";
import { StatusNote, type FieldStatus } from "../status-note";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

export type MatterTaskPerson = TaskAssigneePerson;

type Editing = { row: MatterTask | null };

export function MatterTasksCard({
  tasks,
  doneCount,
  totalCount,
  assignees,
  teamExpansion,
  onTasksChange,
}: Readonly<{
  tasks: readonly MatterTask[];
  doneCount: number;
  totalCount: number;
  assignees: readonly MatterTaskPerson[];
  teamExpansion?: TaskTeamExpansion;
  onTasksChange: (value: { tasks: MatterTask[]; doneCount: number; totalCount: number }) => void;
}>) {
  const { record, frozen } = useRecord();
  const matterNumber = record.number;
  const intl = useIntl();
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [manualEditing, setEditing] = useState<Editing | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedTask = tasks.find((task) => task.id === searchParams.get("task"));
  const editing = manualEditing ?? (linkedTask ? { row: linkedTask } : null);
  function closeEditing() {
    setEditing(null);
    if (searchParams.has("task")) {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete("task");
          return next;
        },
        { replace: true },
      );
    }
  }
  const busy = status === "saving";

  async function run(write: () => Promise<MatterTasksOutcome>, inDialog = false) {
    setStatus("saving");
    setDetail(null);
    const result = await write();
    if (!result.ok) {
      const message =
        result.detail ??
        intl.formatMessage({
          id: "matterTasks.writeFailed",
          defaultMessage: "The Task change could not be saved. Try again.",
        });
      setStatus(inDialog ? "idle" : "error");
      setDetail(inDialog ? null : message);
      return message;
    }
    onTasksChange(result);
    setStatus("saved");
    return null;
  }

  return (
    <section
      id="matter-tasks"
      aria-labelledby="matter-tasks-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center justify-between gap-2 rounded-t-card border-b border-border-default bg-section-header px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="matter-tasks-heading" className="text-base font-semibold">
            <FormattedMessage id="matterTasks.section" defaultMessage="Tasks" />
          </h2>
          <span
            role="img"
            aria-label={intl.formatMessage(
              {
                id: "matterTasks.countLabel",
                defaultMessage: "{count, plural, one {# Task} other {# Tasks}}",
              },
              { count: totalCount },
            )}
            className="rounded-chip bg-badge-count-bg px-1.5 py-px text-xs font-medium text-badge-count-fg"
          >
            {intl.formatNumber(totalCount)}
          </span>
          {totalCount > 0 && (
            <span className="truncate text-sm text-muted">
              <FormattedMessage
                id="matterTasks.doneCount"
                defaultMessage="{done} of {total} done"
                values={{ done: doneCount, total: totalCount }}
              />
            </span>
          )}
        </div>
        {!frozen && (
          <div className="flex shrink-0 items-center gap-2">
            <StatusNote status={status} detail={detail} />
            <Button variant="secondary" disabled={busy} onClick={() => setEditing({ row: null })}>
              <Plus size={16} aria-hidden="true" />
              <FormattedMessage id="matterTasks.add" defaultMessage="Add Task" />
            </Button>
          </div>
        )}
      </header>
      {tasks.length === 0 ? (
        <p className="px-4 py-3 text-base text-muted">
          <FormattedMessage id="matterTasks.empty" defaultMessage="No Tasks on this Matter yet." />
        </p>
      ) : (
        <ul className="divide-y divide-border-muted" role="list">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              assignees={assignees}
              teamExpansion={teamExpansion}
              onAssign={async (assigneeId, addToTeam) => {
                const refusal = await run(
                  () =>
                    updateMatterTask(task.id, { assigneeId, ...(addToTeam ? { addToTeam } : {}) }),
                  true,
                );
                if (!refusal && addToTeam && assigneeId) teamExpansion?.onAdded(assigneeId);
                return refusal;
              }}
              frozen={frozen}
              busy={busy}
              onToggle={() => void run(() => toggleMatterTask(task.id))}
              onEdit={() => setEditing({ row: task })}
              onRemove={() => void run(() => removeMatterTask(task.id))}
            />
          ))}
        </ul>
      )}
      {editing && (
        <TaskDialog
          key={editing.row?.id ?? "new"}
          row={editing.row}
          assignees={assignees}
          teamExpansion={teamExpansion}
          onClose={closeEditing}
          onSave={async (input, taskId) => {
            const result = taskId
              ? await updateMatterTask(taskId, input)
              : await addMatterTask(matterNumber, input);
            if (!result.ok)
              return {
                error:
                  result.detail ??
                  intl.formatMessage({
                    id: "matterTasks.writeFailed",
                    defaultMessage: "The Task change could not be saved. Try again.",
                  }),
              };
            onTasksChange(result);
            const saved =
              result.tasks.find((task) => task.id === (taskId ?? result.createdTaskId)) ??
              result.tasks.find((task) => !tasks.some((previous) => previous.id === task.id));
            if (!saved)
              return {
                error: intl.formatMessage({
                  id: "taskDetails.missing",
                  defaultMessage: "The saved task could not be loaded. Close and reopen it.",
                }),
              };
            return { task: saved };
          }}
        />
      )}
    </section>
  );
}

function TaskRow({
  task,
  assignees,
  teamExpansion,
  onAssign,
  frozen,
  busy,
  onToggle,
  onEdit,
  onRemove,
}: Readonly<{
  task: MatterTask;
  assignees: readonly TaskAssigneePerson[];
  teamExpansion?: TaskTeamExpansion;
  onAssign: (id: string | null, addToTeam?: boolean) => Promise<string | null>;
  frozen: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}>) {
  const intl = useIntl();
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Checkbox
        checked={task.isDone}
        disabled={frozen || busy}
        {...(frozen ? {} : { onCheckedChange: onToggle })}
        aria-label={intl.formatMessage(
          {
            id: "matterTasks.toggle",
            defaultMessage:
              "{done, select, true {Reopen Task: {title}} other {Complete Task: {title}}}",
          },
          { done: String(task.isDone), title: task.title },
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={onEdit}
          className={`w-fit max-w-full rounded-button text-left text-base hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-link ${task.isDone ? "text-muted line-through" : "text-primary"}`}
        >
          {task.title}
        </button>
        {task.dueDate && (
          <span className="text-xs text-muted">
            <FormattedMessage
              id="matterTasks.due"
              defaultMessage="Due {date}"
              values={{ date: formatShortDate(task.dueDate) }}
            />
          </span>
        )}
      </div>
      <TaskAssigneePicker
        value={taskAssignee(task, assignees)}
        people={assignees}
        additionalPeople={teamExpansion?.people}
        taskTitle={task.title}
        disabled={busy}
        readOnly={frozen}
        onChange={onAssign}
      />
      {!frozen && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-label={intl.formatMessage(
                { id: "matterTasks.actions", defaultMessage: "Actions for {title}" },
                { title: task.title },
              )}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil size={16} aria-hidden="true" />
              <FormattedMessage id="matterTasks.edit" defaultMessage="Edit Task" />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRemove}>
              <Trash2 size={16} aria-hidden="true" />
              <FormattedMessage id="matterTasks.remove" defaultMessage="Remove Task" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
