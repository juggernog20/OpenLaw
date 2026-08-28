// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The "Tasks" section of the contract record (M17/1, CTR-017): a
 * lightweight checklist with a done count, a toggle per row, and an
 * empty state.
 *
 * **The section draws the checklist, and nothing more.** No comments, no
 * statuses beyond done/not-done, no sub-tasks, no detail page —
 * discussion happens in the record's comment thread (CTR-017).
 *
 * **Adding and editing are dialogs.** A task is a title and an optional
 * due date that commit together — the compound edit DES-017 carves out
 * of the inline rule. The assignee field exists on the model but is not
 * yet collected from this surface. Toggling and removing are
 * one click each: toggling flips a boolean, and removing destroys
 * nothing that matters — the row goes, the activity entry keeps it
 * (DD-017), and adding it back is one dialog away.
 *
 * **Order is the seam's.** The display order is set on add and adjusted
 * on reorder; the read surface orders by it.
 *
 * **Task due dates never join the deadline union** (CTR-017). A task due
 * date is a team intention, not a contractual obligation. The code
 * enforces this by simply never routing them to the key-dates surface.
 */

import { useState } from "react";
import { useRecord } from "../record-context";
import { FormattedMessage, useIntl } from "react-intl";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { MAX_TASK_TITLE_LENGTH } from "@openlaw/shared";
import {
  addContractTask,
  removeContractTask,
  toggleContractTask,
  updateContractTask,
  type ContractTask,
  type TaskInput,
  type TasksOutcome,
} from "../../lib/tasks";
import { formatShortDate } from "../../lib/format";
import { StatusNote, type FieldStatus } from "../status-note";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

/** One task as the dialog collects it. */
type DraftInput = { title: string; assigneeId: string; dueDate: string };

/** What the add and edit dialogs are opened for. */
type Editing = { row: null } | { row: ContractTask };

export function TasksCard({
  tasks,
  doneCount,
  totalCount,
  onTasksChange,
}: Readonly<{
  tasks: readonly ContractTask[];
  doneCount: number;
  totalCount: number;
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
  const [editing, setEditing] = useState<Editing | null>(null);
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
          row={editing.row}
          busy={busy}
          onClose={() => setEditing(null)}
          onConfirm={async (input) => {
            const refusal = await run(
              () =>
                editing.row
                  ? updateContractTask(editing.row.id, input)
                  : addContractTask(contractNumber, input),
              true,
            );
            if (refusal === null) setEditing(null);
            return refusal;
          }}
        />
      )}
    </section>
  );
}

/** One task row in the checklist. */
function TaskRow({
  task,
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
        <span className={`text-base ${task.isDone ? "text-muted line-through" : "text-primary"}`}>
          {task.title}
        </span>
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
function TaskDialog({
  row,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  row: ContractTask | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (input: TaskInput) => Promise<string | null>;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState<DraftInput>({
    title: row?.title ?? "",
    assigneeId: row?.assigneeId ?? "",
    dueDate: row?.dueDate ?? "",
  });
  const [error, setError] = useState<{ field: "title" | null; message: string } | null>(null);

  async function submit() {
    if (busy) return;
    if (draft.title.trim() === "") {
      setError({
        field: "title",
        message: intl.formatMessage({
          id: "tasks.needTitle",
          defaultMessage: "Name what needs doing.",
        }),
      });
      return;
    }
    const refusal = await onConfirm({
      title: draft.title.trim(),
      assigneeId: draft.assigneeId || null,
      dueDate: draft.dueDate || null,
    });
    setError(refusal === null ? null : { field: null, message: refusal });
  }

  const change = (next: Partial<DraftInput>) => {
    setDraft((current) => ({ ...current, ...next }));
    setError(null);
  };

  const ERROR_ID = "task-error";
  const invalid = (field: "title") =>
    error?.field === field ? ({ "aria-invalid": true, "aria-describedby": ERROR_ID } as const) : {};

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {row ? (
            <FormattedMessage id="tasks.editTitle" defaultMessage="Edit task" />
          ) : (
            <FormattedMessage id="tasks.addTitle" defaultMessage="Add a task" />
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
            <Label htmlFor="task-title">
              <FormattedMessage id="tasks.field.title" defaultMessage="Title" />
            </Label>
            <Input
              id="task-title"
              value={draft.title}
              maxLength={MAX_TASK_TITLE_LENGTH}
              autoFocus
              {...invalid("title")}
              onChange={(event) => change({ title: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-due-date">
              <FormattedMessage id="tasks.field.dueDate" defaultMessage="Due date (optional)" />
            </Label>
            <Input
              id="task-due-date"
              type="date"
              value={draft.dueDate}
              onChange={(event) => change({ dueDate: event.target.value })}
            />
          </div>
          {error && (
            <p id={ERROR_ID} role="alert" className="text-xs text-status-danger-fg">
              {error.message}
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
                <FormattedMessage id="tasks.add" defaultMessage="Add task" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
