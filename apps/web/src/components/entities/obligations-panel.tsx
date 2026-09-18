// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entity record's Obligations tab: the compliance calendar rows of
 * one Entity (ENT-006), edited through the row menu and completed through the
 * Mark complete dialog.
 *
 * Two rules the types do not show. A row is locked when the Entity is
 * archived or when `completedOn` is set, because a filed one-off is a
 * record, not a schedule. Filing a recurring obligation does not
 * complete the row. It advances `nextDueOn` by the recurrence, as many
 * times as it takes to pass the filing day, and the row stays open.
 */

import { AutoResizeTextarea } from "../auto-resize-textarea";
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { Check, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import type {
  EntityObligation,
  EntityObligationOptions,
  EntityRegistration,
} from "../../lib/entities";
import { civilToday, formatFullDate } from "../../lib/format";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import { matterReference } from "../../lib/matters";
import { type TableCatalogue } from "../../lib/list-views";
import { readTableWidths, writeTableWidths } from "../../lib/table-width-preferences";
import { ManagedTable } from "../table/managed-table";
import { problem } from "../../lib/problem";
import { RestrictedRecordCell } from "../restricted-record-cell";
import { StatusNote, type FieldStatus } from "../status-note";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

interface Draft {
  label: string;
  nextDueOn: string;
  recurrenceMonths: string;
  registrationId: string;
  assigneeId: string;
  matterId: string;
  note: string;
}

const EMPTY_DRAFT: Draft = {
  label: "",
  nextDueOn: "",
  recurrenceMonths: "",
  registrationId: "",
  assigneeId: "",
  matterId: "",
  note: "",
};

/** The field names the tab, the dialog, and the row labels share. */
function fieldLabels(intl: IntlShape) {
  return {
    dueDate: intl.formatMessage({
      id: "entities.record.obligations.dueDate",
      defaultMessage: "Due date",
    }),
    label: intl.formatMessage({ id: "entities.record.obligations.label", defaultMessage: "Label" }),
    repeat: intl.formatMessage({
      id: "entities.record.obligations.repeat",
      defaultMessage: "Repeat every (months)",
    }),
    registration: intl.formatMessage({
      id: "entities.record.obligations.registration",
      defaultMessage: "Registration",
    }),
    assignee: intl.formatMessage({
      id: "entities.record.obligations.assignee",
      defaultMessage: "Assignee",
    }),
    matter: intl.formatMessage({
      id: "entities.record.obligations.matter",
      defaultMessage: "Matter",
    }),
    note: intl.formatMessage({ id: "entities.record.obligations.note", defaultMessage: "Note" }),
    none: intl.formatMessage({ id: "entities.record.obligations.none", defaultMessage: "None" }),
    unassigned: intl.formatMessage({
      id: "entities.record.obligations.unassigned",
      defaultMessage: "Unassigned",
    }),
    add: intl.formatMessage({
      id: "entities.record.obligations.add",
      defaultMessage: "Add obligation",
    }),
    markComplete: intl.formatMessage({
      id: "entities.record.obligations.markComplete",
      defaultMessage: "Mark complete",
    }),
    cancel: intl.formatMessage({ id: "common.cancel", defaultMessage: "Cancel" }),
  };
}

export function ObligationsPanel({
  userId,
  entityId,
  initial,
  registrations,
  options,
  frozen,
}: Readonly<{
  userId: string;
  entityId: string;
  initial: readonly EntityObligation[];
  registrations: readonly EntityRegistration[];
  options: EntityObligationOptions;
  frozen: boolean;
}>) {
  const intl = useIntl();
  const labels = fieldLabels(intl);
  const catalogue = obligationCatalogue(intl);
  const [layout, setLayout] = useState(() =>
    readTableWidths(userId, "entity-obligations", catalogue),
  );
  const [rows, setRows] = useState(() => [...initial].sort(byDueDate));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EntityObligation>();
  const [filing, setFiling] = useState<EntityObligation>();
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [error, setError] = useState<string>();

  function replace(row: EntityObligation) {
    setRows((current) => current.map((held) => (held.id === row.id ? row : held)).sort(byDueDate));
  }

  async function remove(id: string) {
    setStatus("saving");
    const result = await api
      .DELETE("/api/v1/entities/{id}/obligations/{childId}", {
        params: { path: { id: entityId, childId: id } },
      })
      .catch(() => undefined);
    if (!result?.response.ok) {
      setStatus("error");
      setError((await problem(result)).detail);
      return;
    }
    setRows((current) => current.filter((row) => row.id !== id));
    setStatus("idle");
  }

  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex min-h-section-header items-center justify-between gap-3 border-b border-border-default bg-section-header px-4 py-2">
        <h2 id={headingId} className="text-lg font-semibold">
          <FormattedMessage id="entities.record.obligations.title" defaultMessage="Obligations" />
        </h2>
        <div className="flex items-center gap-3">
          <StatusNote status={status} detail={error} />
          {!frozen ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" />
              {labels.add}
            </Button>
          ) : null}
        </div>
      </header>
      {rows.length === 0 ? (
        <div className="p-8 text-center">
          <p className="font-medium">
            <FormattedMessage
              id="entities.record.obligations.empty"
              defaultMessage="No obligations for this Entity."
            />
          </p>
          <p className="mt-1 text-sm text-muted">
            <FormattedMessage
              id="entities.record.obligations.emptyHint"
              defaultMessage="Add the first due date when it is known."
            />
          </p>
        </div>
      ) : (
        <ManagedTable
          catalogue={catalogue}
          layout={layout}
          onLayoutChange={(next) => {
            setLayout(next);
            writeTableWidths(userId, "entity-obligations", next);
          }}
          rows={rows}
          rowKey={(row) => row.id}
          actionsColumn={{
            label: intl.formatMessage({
              id: "entities.record.obligations.actions",
              defaultMessage: "Actions",
            }),
            width: 192,
            pinned: true,
            render: (row) => (
              <ObligationActions
                row={row}
                frozen={frozen || status === "saving"}
                onEdit={() => setEditing(row)}
                onFile={() => setFiling(row)}
                onRemove={() => void remove(row.id)}
              />
            ),
          }}
        />
      )}
      {adding || editing ? (
        <ObligationDialog
          entityId={entityId}
          registrations={registrations}
          options={options}
          obligation={editing}
          onClose={() => {
            setAdding(false);
            setEditing(undefined);
          }}
          onSaved={(row) => {
            if (editing) replace(row);
            else setRows((current) => [...current, row].sort(byDueDate));
            setAdding(false);
            setEditing(undefined);
          }}
        />
      ) : null}
      {filing ? (
        <MarkFiledDialog
          entityId={entityId}
          obligation={filing}
          onClose={() => setFiling(undefined)}
          onFiled={(row) => {
            replace(row);
            setFiling(undefined);
          }}
        />
      ) : null}
    </section>
  );
}

function obligationCatalogue(intl: IntlShape): TableCatalogue<EntityObligation> {
  const labels = fieldLabels(intl);
  const columns: TableCatalogue<EntityObligation>["columns"] = [
    {
      key: "due",
      header: labels.dueDate,
      label: () => labels.dueDate,
      defaultWidth: 144,
      minWidth: 100,
      render: (row) => <time dateTime={row.nextDueOn}>{formatFullDate(row.nextDueOn)}</time>,
    },
    {
      key: "label",
      header: intl.formatMessage({
        id: "entities.record.obligations.column",
        defaultMessage: "Obligation",
      }),
      label: (intl) =>
        intl.formatMessage({
          id: "entities.record.obligations.column",
          defaultMessage: "Obligation",
        }),
      defaultWidth: 220,
      minWidth: 120,
      render: (row) => (
        <div className="min-w-0">
          <span className="font-medium">{row.label}</span>
          {row.completedOn ? (
            <span className="mt-1 block w-fit rounded-pill bg-status-success-bg px-2 py-0.5 text-xs text-status-success-fg">
              <FormattedMessage
                id="entities.record.obligations.completedOn"
                defaultMessage="Completed {date}"
                values={{ date: formatFullDate(row.completedOn) }}
              />
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "repeat",
      header: labels.repeat,
      label: () => labels.repeat,
      defaultWidth: 128,
      minWidth: 80,
      render: (row) => row.recurrenceMonths ?? "—",
    },
    {
      key: "registration",
      header: labels.registration,
      label: () => labels.registration,
      defaultWidth: 180,
      minWidth: 100,
      render: (row) => (row.registration ? registrationLabel(intl, row.registration) : "—"),
    },
    {
      key: "assignee",
      header: labels.assignee,
      label: () => labels.assignee,
      defaultWidth: 160,
      minWidth: 100,
      render: (row) => row.assignee?.displayName ?? labels.unassigned,
    },
    {
      key: "matter",
      header: labels.matter,
      label: () => labels.matter,
      defaultWidth: 180,
      minWidth: 100,
      render: (row) =>
        row.matter === null ? (
          "—"
        ) : "restricted" in row.matter ? (
          <RestrictedRecordCell
            label={{
              id: "entities.record.obligations.restrictedMatter",
              defaultMessage: "Restricted matter",
            }}
          />
        ) : (
          <Link className="text-link hover:underline" to={`/matters/${row.matter.number}`}>
            {matterLabel(intl, row.matter)}
          </Link>
        ),
    },
    {
      key: "note",
      header: labels.note,
      label: () => labels.note,
      defaultWidth: 180,
      minWidth: 80,
      render: (row) => row.note || "—",
    },
  ];
  return {
    columns,
    defaultColumnKeys: columns.map((column) => column.key),
    flexColumnKey: "label",
  };
}

function ObligationActions({
  row,
  frozen,
  onEdit,
  onFile,
  onRemove,
}: Readonly<{
  row: EntityObligation;
  frozen: boolean;
  onEdit: () => void;
  onFile: () => void;
  onRemove: () => void;
}>) {
  const intl = useIntl();
  const labels = fieldLabels(intl);
  const locked = frozen || row.completedOn !== null;
  if (locked) return null;
  return (
    <div className="flex items-center justify-end gap-1">
      <Button size="sm" onClick={onFile}>
        <Check size={16} aria-hidden="true" />
        {labels.markComplete}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            aria-label={intl.formatMessage(
              {
                id: "entities.record.obligations.rowActions",
                defaultMessage: "Actions for {label}",
              },
              { label: row.label },
            )}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil size={16} aria-hidden="true" />
            <FormattedMessage id="common.edit" defaultMessage="Edit" />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onRemove} className="text-status-danger-fg">
            <Trash2 size={16} aria-hidden="true" />
            <FormattedMessage id="common.delete" defaultMessage="Delete" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ObligationDialog({
  entityId,
  registrations,
  options,
  onClose,
  obligation,
  onSaved,
}: Readonly<{
  entityId: string;
  registrations: readonly EntityRegistration[];
  options: EntityObligationOptions;
  onClose: () => void;
  obligation?: EntityObligation;
  onSaved: (row: EntityObligation) => void;
}>) {
  const intl = useIntl();
  const labels = fieldLabels(intl);
  const [draft, setDraft] = useState<Draft>(() =>
    obligation
      ? {
          label: obligation.label,
          nextDueOn: obligation.nextDueOn,
          recurrenceMonths:
            obligation.recurrenceMonths === null ? "" : String(obligation.recurrenceMonths),
          registrationId: obligation.registration?.id ?? "",
          assigneeId: obligation.assignee?.id ?? "",
          matterId: obligation.matter?.id ?? "",
          note: obligation.note ?? "",
        }
      : EMPTY_DRAFT,
  );
  const title = obligation
    ? intl.formatMessage({
        id: "entities.record.obligations.edit",
        defaultMessage: "Edit obligation",
      })
    : labels.add;
  const saveLabel = obligation
    ? intl.formatMessage({ id: "common.saveChanges", defaultMessage: "Save changes" })
    : labels.add;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (key: keyof Draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (!draft.label.trim() || !draft.nextDueOn || busy) return;
    setBusy(true);
    const body = {
      label: draft.label.trim(),
      nextDueOn: draft.nextDueOn,
      recurrenceMonths: draft.recurrenceMonths ? Number(draft.recurrenceMonths) : null,
      note: draft.note.trim() || null,
      // Preserve existing links when their records are no longer available in the picker.
      ...(obligation && draft.registrationId === (obligation.registration?.id ?? "")
        ? {}
        : { registrationId: draft.registrationId || null }),
      ...(obligation && draft.assigneeId === (obligation.assignee?.id ?? "")
        ? {}
        : { assigneeId: draft.assigneeId || null }),
      ...(obligation && draft.matterId === (obligation.matter?.id ?? "")
        ? {}
        : { matterId: draft.matterId || null }),
    };
    const result = await (
      obligation
        ? api.PATCH("/api/v1/entities/{id}/obligations/{childId}", {
            params: { path: { id: entityId, childId: obligation.id } },
            body,
          })
        : api.POST("/api/v1/entities/{id}/obligations", {
            params: { path: { id: entityId } },
            body,
          })
    ).catch(() => undefined);
    setBusy(false);
    if (!result?.data) {
      setError((await problem(result)).detail);
      return;
    }
    onSaved(result.data.obligation);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent aria-describedby={undefined} width="xl">
        <DialogTitle>{title}</DialogTitle>
        <form
          className="mt-4 grid grid-cols-1 gap-4 @sm/dialog:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field id="obligation-label" label={labels.label}>
            <Input
              id="obligation-label"
              autoFocus
              required
              value={draft.label}
              onChange={(event) => set("label", event.target.value)}
            />
          </Field>
          <Field id="obligation-due" label={labels.dueDate}>
            <Input
              id="obligation-due"
              type="date"
              required
              value={draft.nextDueOn}
              onChange={(event) => set("nextDueOn", event.target.value)}
            />
          </Field>
          <Field id="obligation-recurrence" label={labels.repeat}>
            <Input
              id="obligation-recurrence"
              type="number"
              min={1}
              value={draft.recurrenceMonths}
              onChange={(event) => set("recurrenceMonths", event.target.value)}
            />
          </Field>
          <SelectDraft
            id="obligation-registration"
            label={labels.registration}
            value={draft.registrationId}
            onChange={(value) => set("registrationId", value)}
          >
            <option value="">{labels.none}</option>
            {obligation?.registration &&
            !registrations.some((row) => row.id === obligation.registration?.id) ? (
              <option value={obligation.registration.id}>
                {registrationLabel(intl, obligation.registration)}
              </option>
            ) : null}
            {registrations.map((row) => (
              <option key={row.id} value={row.id}>
                {registrationLabel(intl, row)}
              </option>
            ))}
          </SelectDraft>
          <SelectDraft
            id="obligation-assignee"
            label={labels.assignee}
            value={draft.assigneeId}
            onChange={(value) => set("assigneeId", value)}
          >
            <option value="">{labels.unassigned}</option>
            {obligation?.assignee &&
            !options.users.some((row) => row.id === obligation.assignee?.id) ? (
              <option value={obligation.assignee.id}>{obligation.assignee.displayName}</option>
            ) : null}
            {options.users.map((row) => (
              <option key={row.id} value={row.id}>
                {row.displayName}
              </option>
            ))}
          </SelectDraft>
          <SelectDraft
            id="obligation-matter"
            label={labels.matter}
            value={draft.matterId}
            onChange={(value) => set("matterId", value)}
          >
            <option value="">{labels.none}</option>
            {obligation?.matter &&
            !options.matters.some((row) => row.id === obligation.matter?.id) ? (
              <option value={obligation.matter.id}>
                {"restricted" in obligation.matter
                  ? intl.formatMessage({
                      id: "entities.record.obligations.restrictedMatter",
                      defaultMessage: "Restricted matter",
                    })
                  : matterLabel(intl, obligation.matter)}
              </option>
            ) : null}
            {options.matters.map((row) => (
              <option key={row.id} value={row.id}>
                {matterLabel(intl, row)}
              </option>
            ))}
          </SelectDraft>
          <div className="flex flex-col gap-1.5 @sm/dialog:col-span-2">
            <Label htmlFor="obligation-note">{labels.note}</Label>
            <AutoResizeTextarea
              id="obligation-note"
              className={TEXTAREA_CLASS}
              value={draft.note}
              onChange={(event) => set("note", event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-status-danger-fg @sm/dialog:col-span-2">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 @sm/dialog:col-span-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={busy}>
              {saveLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MarkFiledDialog({
  entityId,
  obligation,
  onClose,
  onFiled,
}: Readonly<{
  entityId: string;
  obligation: EntityObligation;
  onClose: () => void;
  onFiled: (row: EntityObligation) => void;
}>) {
  const intl = useIntl();
  const labels = fieldLabels(intl);
  const [filedOn, setFiledOn] = useState(() => civilToday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit() {
    if (!filedOn || busy) return;
    setBusy(true);
    const result = await api
      .POST("/api/v1/entities/{id}/obligations/{childId}/file", {
        params: { path: { id: entityId, childId: obligation.id } },
        body: { filedOn },
      })
      .catch(() => undefined);
    setBusy(false);
    if (!result?.data) {
      setError((await problem(result)).detail);
      return;
    }
    onFiled(result.data.obligation);
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent aria-describedby="mark-filed-explanation">
        <DialogTitle>{labels.markComplete}</DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p id="mark-filed-explanation" className="text-muted">
            {obligation.recurrenceMonths ? (
              <FormattedMessage
                id="entities.record.obligations.completeRecurring"
                defaultMessage="Completing this occurrence moves the due date forward by {months, plural, one {# month} other {# months}} until it is after the completion date. The recurring obligation stays open."
                values={{ months: obligation.recurrenceMonths }}
              />
            ) : (
              <FormattedMessage
                id="entities.record.obligations.completeOneOff"
                defaultMessage="This marks the one-off obligation as complete."
              />
            )}
          </p>
          <Field
            id="obligation-filed-on"
            label={intl.formatMessage({
              id: "entities.record.obligations.completedOnField",
              defaultMessage: "Completed on",
            })}
          >
            <Input
              id="obligation-filed-on"
              type="date"
              required
              value={filedOn}
              onChange={(event) => setFiledOn(event.target.value)}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-status-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={busy}>
              {labels.markComplete}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  children,
}: Readonly<{ id: string; label: string; children: ReactNode }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function SelectDraft({
  id,
  label,
  value,
  onChange,
  children,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}>) {
  return (
    <Field id={id} label={label}>
      <select
        id={id}
        className={CONTROL_CLASS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </Field>
  );
}

function registrationLabel(
  intl: IntlShape,
  row: Pick<EntityRegistration, "jurisdiction" | "registrationNumber">,
) {
  return row.registrationNumber
    ? intl.formatMessage(
        {
          id: "entities.record.obligations.registrationOption",
          defaultMessage: "{jurisdiction} · {registrationNumber}",
        },
        { jurisdiction: row.jurisdiction, registrationNumber: row.registrationNumber },
      )
    : row.jurisdiction;
}

function matterLabel(intl: IntlShape, row: { number: number; title: string }) {
  return intl.formatMessage(
    {
      id: "entities.record.obligations.matterOption",
      defaultMessage: "{reference} · {title}",
    },
    { reference: matterReference(intl, row.number), title: row.title },
  );
}

function byDueDate(a: EntityObligation, b: EntityObligation) {
  return a.nextDueOn.localeCompare(b.nextDueOn) || a.label.localeCompare(b.label);
}
