// SPDX-License-Identifier: AGPL-3.0-only

/** A Matter's lightweight Task checklist (MTR-005, M23/4). */
import { useState } from "react";
import { useRecord } from "../record-context";
import { FormattedMessage, useIntl } from "react-intl";
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { MAX_TASK_TITLE_LENGTH } from "@openlaw/shared";
import {
  addMatterTask,
  removeMatterTask,
  reorderMatterTasks,
  toggleMatterTask,
  updateMatterTask,
  type MatterTask,
  type MatterTaskInput,
  type MatterTasksOutcome,
} from "../../lib/matter-tasks";
import { formatShortDate } from "../../lib/format";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { StatusNote, type FieldStatus } from "../status-note";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export interface MatterTaskPerson {
  id: string;
  displayName: string;
}

type Editing = { row: MatterTask | null };

export function MatterTasksCard({
  tasks,
  doneCount,
  totalCount,
  assignees,
  onTasksChange,
}: Readonly<{
  tasks: readonly MatterTask[];
  doneCount: number;
  totalCount: number;
  assignees: readonly MatterTaskPerson[];
  onTasksChange: (value: { tasks: MatterTask[]; doneCount: number; totalCount: number }) => void;
}>) {
  const { record, frozen } = useRecord();
  const matterNumber = record.number;
  const intl = useIntl();
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
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

  function move(index: number, offset: -1 | 1) {
    const reordered = [...tasks];
    const target = index + offset;
    [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
    void run(() =>
      reorderMatterTasks(
        matterNumber,
        reordered.map((task) => task.id),
      ),
    );
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
          {tasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              frozen={frozen}
              busy={busy}
              first={index === 0}
              last={index === tasks.length - 1}
              onToggle={() => void run(() => toggleMatterTask(task.id))}
              onEdit={() => setEditing({ row: task })}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              onRemove={() => void run(() => removeMatterTask(task.id))}
            />
          ))}
        </ul>
      )}
      {editing && (
        <TaskDialog
          row={editing.row}
          assignees={assignees}
          busy={busy}
          onClose={() => setEditing(null)}
          onConfirm={async (input) => {
            const refusal = await run(
              () =>
                editing.row
                  ? updateMatterTask(editing.row.id, input)
                  : addMatterTask(matterNumber, input),
              true,
            );
            if (!refusal) setEditing(null);
            return refusal;
          }}
        />
      )}
    </section>
  );
}

function TaskRow({
  task,
  frozen,
  busy,
  first,
  last,
  onToggle,
  onEdit,
  onMoveUp,
  onMoveDown,
  onRemove,
}: Readonly<{
  task: MatterTask;
  frozen: boolean;
  busy: boolean;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
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
        <span className={`text-base ${task.isDone ? "text-muted line-through" : "text-primary"}`}>
          {task.title}
        </span>
        {(task.assigneeName || task.dueDate) && (
          <span className="text-xs text-muted">
            {task.assigneeName}
            {task.assigneeName && task.dueDate && (
              <span aria-hidden="true">
                {intl.formatMessage({ id: "matterTasks.separator", defaultMessage: " · " })}
              </span>
            )}
            {task.dueDate && (
              <FormattedMessage
                id="matterTasks.due"
                defaultMessage="Due {date}"
                values={{ date: formatShortDate(task.dueDate) }}
              />
            )}
          </span>
        )}
      </div>
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
            <DropdownMenuItem disabled={first} onSelect={onMoveUp}>
              <ArrowUp size={16} aria-hidden="true" />
              <FormattedMessage id="matterTasks.up" defaultMessage="Move up" />
            </DropdownMenuItem>
            <DropdownMenuItem disabled={last} onSelect={onMoveDown}>
              <ArrowDown size={16} aria-hidden="true" />
              <FormattedMessage id="matterTasks.down" defaultMessage="Move down" />
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

function TaskDialog({
  row,
  assignees,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  row: MatterTask | null;
  assignees: readonly MatterTaskPerson[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (input: MatterTaskInput) => Promise<string | null>;
}>) {
  const intl = useIntl();
  const [title, setTitle] = useState(row?.title ?? "");
  const [assigneeId, setAssigneeId] = useState(row?.assigneeId ?? "");
  const [dueDate, setDueDate] = useState(row?.dueDate ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) {
      setError(
        intl.formatMessage({
          id: "matterTasks.needTitle",
          defaultMessage: "Name what needs doing.",
        }),
      );
      return;
    }
    setError(
      await onConfirm({
        title: title.trim(),
        ...(row && assigneeId === (row.assigneeId ?? "") ? {} : { assigneeId: assigneeId || null }),
        dueDate: dueDate || null,
      }),
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {row ? (
            <FormattedMessage id="matterTasks.editTitle" defaultMessage="Edit Task" />
          ) : (
            <FormattedMessage id="matterTasks.addTitle" defaultMessage="Add a Task" />
          )}
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="matter-task-title">
              <FormattedMessage id="matterTasks.field.title" defaultMessage="Title" />
            </Label>
            <Input
              id="matter-task-title"
              value={title}
              maxLength={MAX_TASK_TITLE_LENGTH}
              autoFocus
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setTitle(event.target.value);
                setError(null);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="matter-task-assignee">
              <FormattedMessage id="matterTasks.field.assignee" defaultMessage="Assignee" />
            </Label>
            <select
              id="matter-task-assignee"
              className={CONTROL_CLASS}
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">
                {intl.formatMessage({ id: "matterTasks.unassigned", defaultMessage: "Unassigned" })}
              </option>
              {row?.assigneeId && !assignees.some((person) => person.id === row.assigneeId) && (
                <option value={row.assigneeId} disabled>
                  {row.assigneeName ?? row.assigneeId}
                </option>
              )}
              {assignees.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="matter-task-due">
              <FormattedMessage id="matterTasks.field.due" defaultMessage="Due date (optional)" />
            </Label>
            <Input
              id="matter-task-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              {row ? (
                <FormattedMessage id="action.save" defaultMessage="Save" />
              ) : (
                <FormattedMessage id="matterTasks.add" defaultMessage="Add Task" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
