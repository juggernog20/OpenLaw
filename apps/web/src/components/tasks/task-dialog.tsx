// SPDX-License-Identifier: AGPL-3.0-only

/** Task details and a separate conversation under the parent record's access (CTR-017, MTR-005). */
import { useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { MessageSquare, X } from "lucide-react";
import {
  MAX_COMMENT_BODY_LENGTH,
  MAX_TASK_DESCRIPTION_LENGTH,
  MAX_TASK_TITLE_LENGTH,
} from "@openlaw/shared";
import { sendComment } from "../../lib/comments";
import { problem } from "../../lib/problem";
import { AutoResizeTextarea } from "../auto-resize-textarea";
import { useCommentApplet } from "../comments/comment-applet";
import { CommentFilePicker } from "../comments/comment-attachments";
import { useRecord } from "../record-context";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  TaskAssigneePicker,
  taskAssignee,
  type TaskAssigneePerson,
  type TaskTeamExpansion,
} from "./assignee-picker";

interface TaskDetail {
  id: string;
  title: string;
  description?: string | null;
  assigneeId: string | null;
  assigneeName?: string | null;
  assigneeImage?: string | null;
  dueDate: string | null;
}
interface TaskDraft {
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  addToTeam?: boolean;
  dueDate?: string | null;
}

export function TaskDialog({
  row,
  assignees,
  teamExpansion,
  onClose,
  onSave,
}: Readonly<{
  row: TaskDetail | null;
  assignees: readonly TaskAssigneePerson[];
  teamExpansion?: TaskTeamExpansion;
  onClose: () => void;
  onSave: (input: TaskDraft, taskId?: string) => Promise<{ task: TaskDetail } | { error: string }>;
}>) {
  const intl = useIntl();
  const { record, frozen } = useRecord();
  const [held, setHeld] = useState(row);
  const [title, setTitle] = useState(row?.title ?? "");
  const [description, setDescription] = useState(row?.description ?? "");
  const [assigneeId, setAssigneeId] = useState(row?.assigneeId ?? "");
  const [addToTeam, setAddToTeam] = useState(false);
  const [dueDate, setDueDate] = useState(row?.dueDate ?? "");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [attachmentRetry, setAttachmentRetry] = useState(false);
  const matter = record.kind === "matter";
  const people = [...assignees, ...(teamExpansion?.people ?? [])];

  async function save() {
    if (saving.current || frozen) return;
    if (!title.trim()) {
      setError(
        intl.formatMessage({
          id: "matterTasks.needTitle",
          defaultMessage: "Name what needs doing.",
        }),
      );
      return;
    }
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      let task = held;
      if (!attachmentRetry) {
        const result = await onSave(
          {
            title: title.trim(),
            ...(description.trim() || held?.description
              ? { description: description.trim() || null }
              : {}),
            ...(held && assigneeId === (held.assigneeId ?? "")
              ? {}
              : { assigneeId: assigneeId || null }),
            ...(addToTeam && assigneeId ? { assigneeId, addToTeam: true } : {}),
            dueDate: dueDate || null,
          },
          held?.id,
        );
        if ("error" in result) {
          setError(result.error);
          return;
        }
        task = result.task;
        setHeld(task);
        if (addToTeam && assigneeId) teamExpansion?.onAdded(assigneeId);
        setAddToTeam(false);
      }
      if (task && (note.trim() || files.length)) {
        const result = await sendComment(
          {
            entityType: matter ? "matter_task" : "contract_task",
            entityId: task.id,
            body: note.trim(),
            visibility: "working_team",
          },
          files,
        ).catch(() => undefined);
        if (!result?.data) {
          const failure = await problem(result);
          setAttachmentRetry(true);
          setError(
            intl.formatMessage(
              {
                id: "taskDetails.commentFailed",
                defaultMessage:
                  "Task saved. Your note and attachments could not be added. {detail}",
              },
              {
                detail:
                  failure.detail ??
                  intl.formatMessage({
                    id: "taskDetails.tryAgain",
                    defaultMessage: "Please try again.",
                  }),
              },
            ),
          );
          return;
        }
      }
      onClose();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving.current && onClose()}>
      <DialogContent width="wide" aria-describedby={undefined} className="p-0">
        <header className="flex items-center justify-between gap-4 border-b border-border-default px-6 py-4">
          <DialogTitle>
            {row ? (
              <FormattedMessage id="taskDetails.title" defaultMessage="Task details" />
            ) : matter ? (
              <FormattedMessage id="matterTasks.addTitle" defaultMessage="Add a Task" />
            ) : (
              <FormattedMessage id="tasks.addTitle" defaultMessage="Add a task" />
            )}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={onClose}
            aria-label={intl.formatMessage({ id: "action.close", defaultMessage: "Close" })}
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </header>
        <div className="grid @3xl/dialog:grid-cols-2">
          <form
            id="task-details-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="flex flex-col gap-5 p-6"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-detail-title" required>
                <FormattedMessage id="matterTasks.field.title" defaultMessage="Title" />
              </Label>
              <Input
                id="task-detail-title"
                autoFocus
                aria-required="true"
                aria-invalid={Boolean(error) && !title.trim()}
                aria-describedby={error ? "task-details-error" : undefined}
                maxLength={MAX_TASK_TITLE_LENGTH}
                value={title}
                disabled={frozen || busy || attachmentRetry}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setError(null);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-detail-description">
                <FormattedMessage id="taskDetails.description" defaultMessage="Description" />
              </Label>
              <AutoResizeTextarea
                id="task-detail-description"
                rows={4}
                maxLength={MAX_TASK_DESCRIPTION_LENGTH}
                value={description}
                disabled={frozen || busy || attachmentRetry}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 @sm/dialog:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="task-detail-assignee">
                  <FormattedMessage id="matterTasks.field.assignee" defaultMessage="Assignee" />
                </Label>
                <TaskAssigneePicker
                  id="task-detail-assignee"
                  label={intl.formatMessage({
                    id: "matterTasks.field.assignee",
                    defaultMessage: "Assignee",
                  })}
                  taskTitle={title}
                  deferred
                  value={
                    assigneeId
                      ? (people.find((person) => person.id === assigneeId) ??
                        (held ? taskAssignee(held, assignees) : null))
                      : null
                  }
                  people={assignees}
                  additionalPeople={teamExpansion?.people}
                  disabled={frozen || busy || attachmentRetry}
                  onChange={async (id, adding) => {
                    setAssigneeId(id ?? "");
                    setAddToTeam(adding ?? false);
                    return null;
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="task-detail-due">
                  <FormattedMessage id="matterTasks.field.due" defaultMessage="Due date" />
                </Label>
                <Input
                  id="task-detail-due"
                  type="date"
                  value={dueDate}
                  disabled={frozen || busy || attachmentRetry}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </div>
            </div>
            {addToTeam && (
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="taskAssignee.deferred"
                  defaultMessage="Team membership and assignment are saved when you save the task."
                />
              </p>
            )}
          </form>
          <section className="flex min-h-80 min-w-0 flex-col border-t border-border-default bg-section-header @3xl/dialog:border-t-0 @3xl/dialog:border-l">
            <h3 className="flex items-center gap-2 border-b border-border-default px-6 py-4 text-sm font-semibold">
              <MessageSquare size={16} aria-hidden="true" />
              <FormattedMessage
                id="taskDetails.conversation"
                defaultMessage="Comments & attachments"
              />
            </h3>
            {row && !attachmentRetry ? (
              <div className="h-96 min-h-0">
                <TaskThread taskId={row.id} />
              </div>
            ) : (
              <div className="flex flex-col gap-4 p-6">
                <Label htmlFor="task-initial-note">
                  <FormattedMessage id="taskDetails.note" defaultMessage="Add a note" />
                </Label>
                <AutoResizeTextarea
                  id="task-initial-note"
                  rows={4}
                  maxLength={MAX_COMMENT_BODY_LENGTH}
                  value={note}
                  disabled={busy || frozen}
                  onChange={(event) => setNote(event.target.value)}
                />
                <CommentFilePicker files={files} disabled={busy || frozen} onChange={setFiles} />
              </div>
            )}
          </section>
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-border-default px-6 py-4">
          {error && (
            <p
              id="task-details-error"
              role="alert"
              className="mr-auto max-w-lg text-sm text-status-danger-fg"
            >
              {error}
            </p>
          )}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {row ? (
              <FormattedMessage id="action.close" defaultMessage="Close" />
            ) : (
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            )}
          </Button>
          {!frozen && (
            <Button type="submit" form="task-details-form" disabled={busy}>
              {attachmentRetry ? (
                <FormattedMessage
                  id="taskDetails.retry"
                  defaultMessage="Retry note & attachments"
                />
              ) : row ? (
                <FormattedMessage id="action.save" defaultMessage="Save" />
              ) : matter ? (
                <FormattedMessage id="matterTasks.add" defaultMessage="Add Task" />
              ) : (
                <FormattedMessage id="tasks.add" defaultMessage="Add task" />
              )}
            </Button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function TaskThread({ taskId }: { taskId: string }) {
  const { record, viewer, confidential } = useRecord();
  const applet = useCommentApplet({
    entityType: record.kind === "matter" ? "matter_task" : "contract_task",
    entityId: taskId,
    role: viewer.role,
    viewerId: viewer.id,
    confidential,
  });
  const onExpandedChange = "onExpandedChange" in applet ? applet.onExpandedChange : undefined;
  useEffect(() => {
    onExpandedChange?.(true);
    return () => onExpandedChange?.(false);
  }, [onExpandedChange]);
  return applet.render?.();
}
