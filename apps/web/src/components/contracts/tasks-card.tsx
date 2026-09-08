// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The "Tasks" section of the contract record (M17/1, CTR-017): a
 * lightweight checklist with a done count, a toggle per row, and an
 * empty state.
 *
 * The section draws the checklist, and nothing more. No comments, no
 * statuses beyond done/not-done, no sub-tasks, no detail page.
 * Discussion happens in the record's comment thread (CTR-017).
 *
 * Adding and editing are dialogs. A task is a title and an optional
 * due date that commit together, the compound edit DES-017 carves out
 * of the inline rule. Assignees can also be changed directly on a row.
 * Toggling and removing are one click
 * each: toggling flips a boolean, and removing destroys nothing that
 * matters. The row goes, the activity entry keeps it (DD-017), and
 * adding it back is one dialog away.
 *
 * Display order belongs to the tasks seam. It is set on add and
 * adjusted on reorder; the read side orders by it.
 *
 * Task due dates never join the deadline union (CTR-017). A task due
 * date is a team intention, not a contractual obligation. Nothing here
 * routes them to the key-dates section.
 */

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
  addContractTask,
  removeContractTask,
  toggleContractTask,
  updateContractTask,
  type ContractTask,
  type TasksOutcome,
} from "../../lib/tasks";
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

/** What the add and edit dialogs are opened for. */
type Editing = { row: null } | { row: ContractTask };

export function TasksCard({
  tasks,
  doneCount,
  totalCount,
  assignees,
  teamExpansion,
  onTasksChange,
}: Readonly<{
  tasks: readonly ContractTask[];
  doneCount: number;
  totalCount: number;
  assignees: readonly TaskAssigneePerson[];
  teamExpansion?: TaskTeamExpansion;
  onTasksChange: (outcome: {
    tasks: ContractTask[];
    doneCount: number;
    totalCount: number;
  }) => void;
}>) {
  const { record, frozen } = useRecord();
  const contractNumber = record.number;
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

  async function run(
    write: () => Promise<TasksOutcome>,
    reportedInDialog = false,
  ): Promise<string | null> {
    setStatus("saving");
    setDetail(null);
    const outcome = await write();
    if (!outcome.ok) {
      setStatus(reportedInDialog ? "idle" : "error");
      setDetail(reportedInDialog ? null : (outcome.detail ?? null));
      return (
        outcome.detail ??
        intl.formatMessage({
          id: "tasks.writeFailed",
          defaultMessage: "The change could not be saved. Try again.",
        })
      );
    }
    onTasksChange({
      tasks: outcome.tasks,
      doneCount: outcome.doneCount,
      totalCount: outcome.totalCount,
    });
    setStatus("saved");
    setDetail(null);
    return null;
  }

  return (
    <section
      id="contract-tasks"
      aria-labelledby="contract-tasks-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center justify-between gap-2 rounded-t-card border-b border-border-default bg-section-header px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="contract-tasks-heading" className="text-base font-semibold">
            <FormattedMessage id="tasks.section" defaultMessage="Tasks" />
          </h2>
          <span
            role="img"
            aria-label={intl.formatMessage(
              {
                id: "tasks.countLabel",
                defaultMessage: "{count, plural, one {# task} other {# tasks}}",
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
                id="tasks.count.done"
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
              <FormattedMessage id="tasks.add" defaultMessage="Add task" />
            </Button>
          </div>
        )}
      </header>
      {tasks.length === 0 ? (
        <p className="px-4 py-3 text-base text-muted">
          <FormattedMessage id="tasks.empty" defaultMessage="No tasks on this contract yet." />
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
                    updateContractTask(task.id, {
                      assigneeId,
                      ...(addToTeam ? { addToTeam } : {}),
                    }),
                  true,
                );
                if (!refusal && addToTeam && assigneeId) teamExpansion?.onAdded(assigneeId);
                return refusal;
              }}
              intl={intl}
              busy={busy}
              frozen={frozen}
              onToggle={() => {
                void run(() => toggleContractTask(task.id));
              }}
              onEdit={() => setEditing({ row: task })}
              onRemove={() => {
                void run(() => removeContractTask(task.id));
              }}
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
              ? await updateContractTask(taskId, input)
              : await addContractTask(contractNumber, input);
            if (!result.ok)
              return {
                error:
                  result.detail ??
                  intl.formatMessage({
                    id: "tasks.writeFailed",
                    defaultMessage: "The change could not be saved. Try again.",
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

/** One task row in the checklist. */
function TaskRow({
  task,
  assignees,
  teamExpansion,
  onAssign,
  intl,
  busy,
  frozen,
  onToggle,
  onEdit,
  onRemove,
}: Readonly<{
  task: ContractTask;
  intl: ReturnType<typeof useIntl>;
  busy: boolean;
  assignees: readonly TaskAssigneePerson[];
  teamExpansion?: TaskTeamExpansion;
  onAssign: (id: string | null, addToTeam?: boolean) => Promise<string | null>;
  frozen: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}>) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Checkbox
        checked={task.isDone}
        disabled={frozen || busy}
        {...(frozen ? {} : { onCheckedChange: onToggle })}
        aria-label={intl.formatMessage(
          {
            id: "tasks.toggleLabel",
            defaultMessage:
              "{isDone, select, true {Reopen task: {title}} other {Complete task: {title}}}",
          },
          { isDone: String(task.isDone), title: task.title },
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
        {task.dueDate !== null && (
          <span className="text-xs text-muted">
            <FormattedMessage
              id="tasks.dueDate"
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
                { id: "tasks.actionsFor", defaultMessage: "Actions for {title}" },
                { title: task.title },
              )}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil size={16} aria-hidden="true" />
              <FormattedMessage id="tasks.edit" defaultMessage="Edit task" />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRemove}>
              <Trash2 size={16} aria-hidden="true" />
              <FormattedMessage id="tasks.remove" defaultMessage="Remove task" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

/**
 * One task, collected whole (CTR-017).
 *
 * The same form adds and edits: the fields are the same, and a second
 * component for one different title would be a second place for the
 * bounds to drift.
 */
