// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Ordered Matter-template Task and Key date editing for MTR-013. The
 * shared editor keeps creation-time content and its ordering rules in
 * one place for both live and archived templates.
 */

import { useRef, type DragEvent, type KeyboardEvent } from "react";
import { GripVertical, Plus, X } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { SettingsCard } from "./settings-card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export interface TemplateTaskDraft {
  key: string;
  title: string;
  dueOffsetDays: string;
  assigneeRole: "matter_manager" | "none";
}

export interface TemplateKeyDateDraft {
  key: string;
  label: string;
  offsetDays: string;
  note: string;
}

let draftSequence = 0;

export function newDraftKey(kind: "task" | "key-date") {
  draftSequence += 1;
  return `${kind}-${draftSequence}`;
}

function move<T>(rows: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= rows.length || from === to) return [...rows];
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row!);
  return next;
}

function ReorderButton({
  name,
  position,
  total,
  disabled,
  onMove,
  onDragStart,
}: Readonly<{
  name: string;
  position: number;
  total: number;
  disabled: boolean;
  onMove: (to: number) => void;
  onDragStart: () => void;
}>) {
  const intl = useIntl();
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onMove(position - 2);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onMove(position);
    }
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="cursor-grab px-1"
      aria-disabled={disabled}
      draggable={!disabled}
      onDragStart={onDragStart}
      aria-label={intl.formatMessage(
        {
          id: "settings.matterTemplateEditor.reorder",
          defaultMessage:
            "Reorder {name}, position {position} of {total}. Use the arrow keys to move it.",
        },
        { name, position, total },
      )}
      onKeyDown={onKeyDown}
    >
      <GripVertical size={16} aria-hidden="true" className="text-muted" />
    </Button>
  );
}

export function TemplateTasksEditor({
  rows,
  disabled,
  onChange,
}: Readonly<{
  rows: TemplateTaskDraft[];
  disabled: boolean;
  onChange: (rows: TemplateTaskDraft[]) => void;
}>) {
  const intl = useIntl();
  const dragFrom = useRef<number | null>(null);

  function drop(event: DragEvent, to: number) {
    event.preventDefault();
    if (disabled || dragFrom.current === null) return;
    onChange(move(rows, dragFrom.current, to));
    dragFrom.current = null;
  }

  return (
    <SettingsCard
      className="max-w-none"
      flush
      title={<FormattedMessage id="settings.matterTemplateEditor.tasks" defaultMessage="Tasks" />}
      actions={
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled || rows.length >= 100}
          onClick={() =>
            onChange([
              ...rows,
              {
                key: newDraftKey("task"),
                title: "",
                dueOffsetDays: "",
                assigneeRole: "none",
              },
            ])
          }
        >
          <Plus size={16} aria-hidden="true" />
          <FormattedMessage id="settings.matterTemplateEditor.addTask" defaultMessage="Add task" />
        </Button>
      }
    >
      <p className="border-b border-border-muted px-4 py-3 text-sm text-muted">
        <FormattedMessage
          id="settings.matterTemplateEditor.tasksHint"
          defaultMessage="Ordered checklist inserted when the Matter is created"
        />
      </p>
      <div className="overflow-x-auto">
        <div className="min-w-160">
          <div
            aria-hidden="true"
            className="grid grid-cols-[2.5rem_minmax(12rem,1fr)_8rem_11rem_2.5rem] border-b border-border-muted px-2 py-2 text-xs font-medium text-muted"
          >
            <span className="text-center">
              <FormattedMessage id="settings.matterTemplateEditor.order" defaultMessage="Order" />
            </span>
            <span className="px-1">
              <FormattedMessage
                id="settings.matterTemplateEditor.taskTitle"
                defaultMessage="Title"
              />
            </span>
            <span className="px-1">
              <FormattedMessage
                id="settings.matterTemplateEditor.dueOffset"
                defaultMessage="Due offset"
              />
            </span>
            <span className="px-1">
              <FormattedMessage id="settings.matterTemplateEditor.role" defaultMessage="Role" />
            </span>
            <span />
          </div>
          {rows.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted">
              <FormattedMessage
                id="settings.matterTemplateEditor.noTasks"
                defaultMessage="No tasks are included in this template."
              />
            </p>
          ) : (
            <ol>
              {rows.map((row, index) => {
                const title =
                  row.title.trim() ||
                  intl.formatMessage(
                    {
                      id: "settings.matterTemplateEditor.taskNumber",
                      defaultMessage: "Task {number}",
                    },
                    { number: index + 1 },
                  );
                return (
                  <li
                    key={row.key}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => drop(event, index)}
                    className="grid grid-cols-[2.5rem_minmax(12rem,1fr)_8rem_11rem_2.5rem] items-center border-b border-border-muted px-2 py-2"
                  >
                    <ReorderButton
                      name={title}
                      position={index + 1}
                      total={rows.length}
                      disabled={disabled}
                      onMove={(to) => !disabled && onChange(move(rows, index, to))}
                      onDragStart={() => {
                        dragFrom.current = index;
                      }}
                    />
                    <Input
                      value={row.title}
                      disabled={disabled}
                      maxLength={200}
                      aria-label={intl.formatMessage(
                        {
                          id: "settings.matterTemplateEditor.taskTitleNumber",
                          defaultMessage: "Task {number} title",
                        },
                        { number: index + 1 },
                      )}
                      onChange={(event) =>
                        onChange(
                          rows.map((candidate, rowIndex) =>
                            rowIndex === index
                              ? { ...candidate, title: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                    <div className="px-1">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={3650}
                        step={1}
                        value={row.dueOffsetDays}
                        disabled={disabled}
                        placeholder="—"
                        aria-label={intl.formatMessage(
                          {
                            id: "settings.matterTemplateEditor.taskDueNumber",
                            defaultMessage: "Task {number} due offset in days",
                          },
                          { number: index + 1 },
                        )}
                        className="w-full"
                        onChange={(event) =>
                          onChange(
                            rows.map((candidate, rowIndex) =>
                              rowIndex === index
                                ? { ...candidate, dueOffsetDays: event.target.value }
                                : candidate,
                            ),
                          )
                        }
                      />
                    </div>
                    <select
                      value={row.assigneeRole}
                      disabled={disabled}
                      aria-label={intl.formatMessage(
                        {
                          id: "settings.matterTemplateEditor.taskRoleNumber",
                          defaultMessage: "Task {number} role",
                        },
                        { number: index + 1 },
                      )}
                      className="mx-1 h-8 rounded-button border border-border-default bg-raised px-2 text-base text-primary"
                      onChange={(event) =>
                        onChange(
                          rows.map((candidate, rowIndex) =>
                            rowIndex === index
                              ? {
                                  ...candidate,
                                  assigneeRole: event.target.value as "matter_manager" | "none",
                                }
                              : candidate,
                          ),
                        )
                      }
                    >
                      <option value="matter_manager">
                        {intl.formatMessage({
                          id: "settings.matterTemplateEditor.matterManager",
                          defaultMessage: "Matter Manager",
                        })}
                      </option>
                      <option value="none">
                        {intl.formatMessage({
                          id: "settings.matterTemplateEditor.unassigned",
                          defaultMessage: "Unassigned",
                        })}
                      </option>
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled}
                      aria-label={intl.formatMessage(
                        {
                          id: "settings.matterTemplateEditor.removeTask",
                          defaultMessage: "Remove {name}",
                        },
                        { name: title },
                      )}
                      onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
                    >
                      <X size={16} aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}

export function TemplateKeyDatesEditor({
  rows,
  disabled,
  onChange,
}: Readonly<{
  rows: TemplateKeyDateDraft[];
  disabled: boolean;
  onChange: (rows: TemplateKeyDateDraft[]) => void;
}>) {
  const intl = useIntl();
  const dragFrom = useRef<number | null>(null);

  function drop(event: DragEvent, to: number) {
    event.preventDefault();
    if (disabled || dragFrom.current === null) return;
    onChange(move(rows, dragFrom.current, to));
    dragFrom.current = null;
  }

  return (
    <SettingsCard
      className="max-w-none"
      flush
      title={
        <FormattedMessage id="settings.matterTemplateEditor.keyDates" defaultMessage="Key dates" />
      }
      actions={
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled || rows.length >= 100}
          onClick={() =>
            onChange([
              ...rows,
              { key: newDraftKey("key-date"), label: "", offsetDays: "", note: "" },
            ])
          }
        >
          <Plus size={16} aria-hidden="true" />
          <FormattedMessage
            id="settings.matterTemplateEditor.addKeyDate"
            defaultMessage="Add key date"
          />
        </Button>
      }
    >
      <p className="border-b border-border-muted px-4 py-3 text-sm text-muted">
        <FormattedMessage
          id="settings.matterTemplateEditor.keyDatesHint"
          defaultMessage="Dates resolve relative to the Matter creation date"
        />
      </p>
      <div className="overflow-x-auto">
        <div className="min-w-160">
          <div
            aria-hidden="true"
            className="grid grid-cols-[2.5rem_minmax(10rem,1fr)_8rem_minmax(12rem,1fr)_2.5rem] border-b border-border-muted px-2 py-2 text-xs font-medium text-muted"
          >
            <span className="text-center">
              <FormattedMessage id="settings.matterTemplateEditor.order" defaultMessage="Order" />
            </span>
            <span className="px-1">
              <FormattedMessage id="settings.matterTemplateEditor.label" defaultMessage="Label" />
            </span>
            <span className="px-1">
              <FormattedMessage
                id="settings.matterTemplateEditor.dateOffset"
                defaultMessage="Date offset"
              />
            </span>
            <span className="px-1">
              <FormattedMessage id="settings.matterTemplateEditor.note" defaultMessage="Note" />
            </span>
            <span />
          </div>
          {rows.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted">
              <FormattedMessage
                id="settings.matterTemplateEditor.noKeyDates"
                defaultMessage="No key dates are included in this template."
              />
            </p>
          ) : (
            <ol>
              {rows.map((row, index) => {
                const label =
                  row.label.trim() ||
                  intl.formatMessage(
                    {
                      id: "settings.matterTemplateEditor.keyDateNumber",
                      defaultMessage: "Key date {number}",
                    },
                    { number: index + 1 },
                  );
                return (
                  <li
                    key={row.key}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => drop(event, index)}
                    className="grid grid-cols-[2.5rem_minmax(10rem,1fr)_8rem_minmax(12rem,1fr)_2.5rem] items-center border-b border-border-muted px-2 py-2"
                  >
                    <ReorderButton
                      name={label}
                      position={index + 1}
                      total={rows.length}
                      disabled={disabled}
                      onMove={(to) => !disabled && onChange(move(rows, index, to))}
                      onDragStart={() => {
                        dragFrom.current = index;
                      }}
                    />
                    <Input
                      value={row.label}
                      disabled={disabled}
                      maxLength={200}
                      aria-label={intl.formatMessage(
                        {
                          id: "settings.matterTemplateEditor.keyDateLabelNumber",
                          defaultMessage: "Key date {number} label",
                        },
                        { number: index + 1 },
                      )}
                      onChange={(event) =>
                        onChange(
                          rows.map((candidate, rowIndex) =>
                            rowIndex === index
                              ? { ...candidate, label: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                    <div className="px-1">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={3650}
                        step={1}
                        value={row.offsetDays}
                        disabled={disabled}
                        aria-label={intl.formatMessage(
                          {
                            id: "settings.matterTemplateEditor.keyDateOffsetNumber",
                            defaultMessage: "Key date {number} offset in days",
                          },
                          { number: index + 1 },
                        )}
                        className="w-full"
                        onChange={(event) =>
                          onChange(
                            rows.map((candidate, rowIndex) =>
                              rowIndex === index
                                ? { ...candidate, offsetDays: event.target.value }
                                : candidate,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="px-1">
                      <Input
                        value={row.note}
                        disabled={disabled}
                        maxLength={2000}
                        aria-label={intl.formatMessage(
                          {
                            id: "settings.matterTemplateEditor.keyDateNoteNumber",
                            defaultMessage: "Key date {number} note",
                          },
                          { number: index + 1 },
                        )}
                        className="w-full"
                        onChange={(event) =>
                          onChange(
                            rows.map((candidate, rowIndex) =>
                              rowIndex === index
                                ? { ...candidate, note: event.target.value }
                                : candidate,
                            ),
                          )
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled}
                      aria-label={intl.formatMessage(
                        {
                          id: "settings.matterTemplateEditor.removeKeyDate",
                          defaultMessage: "Remove {name}",
                        },
                        { name: label },
                      )}
                      onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
                    >
                      <X size={16} aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}
