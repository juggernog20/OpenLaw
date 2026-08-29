// SPDX-License-Identifier: AGPL-3.0-only

import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Check, Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import type {
  EntityObligation,
  EntityObligationOptions,
  EntityRegistration,
} from "../../lib/entities";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import { problem } from "../../lib/problem";
import { StatusNote, type FieldStatus } from "../status-note";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
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

export function ObligationsPanel({
  entityId,
  initial,
  registrations,
  options,
  frozen,
}: Readonly<{
  entityId: string;
  initial: readonly EntityObligation[];
  registrations: readonly EntityRegistration[];
  options: EntityObligationOptions;
  frozen: boolean;
}>) {
  const [rows, setRows] = useState(() => [...initial].sort(byDueDate));
  const [adding, setAdding] = useState(false);
  const [filing, setFiling] = useState<EntityObligation>();
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [error, setError] = useState<string>();

  function replace(row: EntityObligation) {
    setRows((current) => current.map((held) => (held.id === row.id ? row : held)).sort(byDueDate));
  }

  async function update(id: string, body: Record<string, unknown>) {
    setStatus("saving");
    const result = await api
      .PATCH("/api/v1/entities/{id}/obligations/{childId}", {
        params: { path: { id: entityId, childId: id } },
        body,
      })
      .catch(() => undefined);
    if (!result?.data) {
      setStatus("error");
      setError((await problem(result)).detail);
      return;
    }
    replace(result.data.obligation);
    setStatus("saved");
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

  return (
    <section className="overflow-hidden rounded-card border border-border-default bg-raised">
      <header className="flex min-h-section-header items-center justify-between gap-3 border-b border-border-default bg-section-header px-4 py-2">
        <h2 className="text-lg font-semibold">Obligations</h2>
        <div className="flex items-center gap-3">
          <StatusNote status={status} detail={error} />
          {!frozen ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" />
              Add obligation
            </Button>
          ) : null}
        </div>
      </header>
      {rows.length === 0 ? (
        <div className="p-8 text-center">
          <p className="font-medium">No obligations for this Entity.</p>
          <p className="mt-1 text-sm text-muted">Add the first due date when it is known.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px]">
            <thead>
              <tr className="bg-section-header text-sm text-muted">
                <Header>Due date</Header>
                <Header>Obligation</Header>
                <Header>Repeat</Header>
                <Header>Registration</Header>
                <Header>Assignee</Header>
                <Header>Matter</Header>
                <Header>Note</Header>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ObligationRow
                  key={row.id}
                  row={row}
                  registrations={registrations}
                  options={options}
                  frozen={frozen}
                  onUpdate={(body) => void update(row.id, body)}
                  onFile={() => setFiling(row)}
                  onRemove={() => void remove(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding ? (
        <AddObligationDialog
          entityId={entityId}
          registrations={registrations}
          options={options}
          onClose={() => setAdding(false)}
          onCreated={(row) => {
            setRows((current) => [...current, row].sort(byDueDate));
            setAdding(false);
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

function Header({ children }: Readonly<{ children: string }>) {
  return (
    <th scope="col" className="px-3 py-2 text-start font-medium">
      {children}
    </th>
  );
}

function ObligationRow({
  row,
  registrations,
  options,
  frozen,
  onUpdate,
  onFile,
  onRemove,
}: Readonly<{
  row: EntityObligation;
  registrations: readonly EntityRegistration[];
  options: EntityObligationOptions;
  frozen: boolean;
  onUpdate: (body: Record<string, unknown>) => void;
  onFile: () => void;
  onRemove: () => void;
}>) {
  const [label, setLabel] = useState(row.label);
  const [note, setNote] = useState(row.note ?? "");
  return (
    <tr className="border-t border-border-default align-top">
      <td className="p-3">
        <Input
          aria-label={`${row.label} due date`}
          type="date"
          value={row.nextDueOn}
          disabled={frozen || row.completedOn !== null}
          onChange={(event) => onUpdate({ nextDueOn: event.target.value })}
        />
      </td>
      <td className="p-3">
        <span className="mb-1 block text-sm font-medium">{row.label}</span>
        <Input
          aria-label={`${row.label} label`}
          value={label}
          disabled={frozen || row.completedOn !== null}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() =>
            label.trim() && label.trim() !== row.label && onUpdate({ label: label.trim() })
          }
        />
        {row.completedOn ? (
          <span className="mt-1 inline-flex rounded-pill bg-status-success-bg px-2 py-0.5 text-xs text-status-success-fg">
            Filed {row.completedOn}
          </span>
        ) : null}
      </td>
      <td className="p-3">
        <Input
          aria-label={`${row.label} repeat every months`}
          type="number"
          min={1}
          value={row.recurrenceMonths ?? ""}
          disabled={frozen || row.completedOn !== null}
          onChange={(event) =>
            onUpdate({ recurrenceMonths: event.target.value ? Number(event.target.value) : null })
          }
        />
      </td>
      <td className="p-3">
        <select
          aria-label={`${row.label} registration`}
          className={CONTROL_CLASS}
          value={row.registration?.id ?? ""}
          disabled={frozen || row.completedOn !== null}
          onChange={(event) => onUpdate({ registrationId: event.target.value || null })}
        >
          <option value="">None</option>
          {registrations.map((registration) => (
            <option key={registration.id} value={registration.id}>
              {registrationLabel(registration)}
            </option>
          ))}
        </select>
        {row.registration ? (
          <span className="mt-1 block text-sm text-muted">{row.registration.jurisdiction}</span>
        ) : null}
      </td>
      <td className="p-3">
        <select
          aria-label={`${row.label} assignee`}
          className={CONTROL_CLASS}
          value={row.assignee?.id ?? ""}
          disabled={frozen || row.completedOn !== null}
          onChange={(event) => onUpdate({ assigneeId: event.target.value || null })}
        >
          <option value="">Unassigned</option>
          {options.users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName}
            </option>
          ))}
        </select>
      </td>
      <td className="p-3">
        <select
          aria-label={`${row.label} matter`}
          className={CONTROL_CLASS}
          value={row.matter?.id ?? ""}
          disabled={frozen || row.completedOn !== null}
          onChange={(event) => onUpdate({ matterId: event.target.value || null })}
        >
          <option value="">None</option>
          {options.matters.map((matter) => (
            <option key={matter.id} value={matter.id}>
              {matterLabel(matter)}
            </option>
          ))}
        </select>
        {row.matter ? (
          <Link
            className="mt-1 block text-sm text-link hover:underline"
            to={`/matters/${row.matter.number}`}
          >
            {matterLabel(row.matter)}
          </Link>
        ) : null}
      </td>
      <td className="p-3">
        <Input
          aria-label={`${row.label} note`}
          value={note}
          disabled={frozen || row.completedOn !== null}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => note !== (row.note ?? "") && onUpdate({ note: note || null })}
        />
      </td>
      <td className="p-3">
        {!frozen && row.completedOn === null ? (
          <div className="flex items-center justify-end gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Mark ${row.label} filed`}
              onClick={onFile}
            >
              <Check size={16} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Delete ${row.label}`}
              onClick={onRemove}
            >
              <Trash2 size={16} />
            </Button>
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function AddObligationDialog({
  entityId,
  registrations,
  options,
  onClose,
  onCreated,
}: Readonly<{
  entityId: string;
  registrations: readonly EntityRegistration[];
  options: EntityObligationOptions;
  onClose: () => void;
  onCreated: (row: EntityObligation) => void;
}>) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (key: keyof Draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function submit() {
    if (!draft.label.trim() || !draft.nextDueOn || busy) return;
    setBusy(true);
    const result = await api
      .POST("/api/v1/entities/{id}/obligations", {
        params: { path: { id: entityId } },
        body: {
          label: draft.label.trim(),
          nextDueOn: draft.nextDueOn,
          recurrenceMonths: draft.recurrenceMonths ? Number(draft.recurrenceMonths) : null,
          registrationId: draft.registrationId || null,
          assigneeId: draft.assigneeId || null,
          matterId: draft.matterId || null,
          note: draft.note.trim() || null,
        },
      })
      .catch(() => undefined);
    setBusy(false);
    if (!result?.data) {
      setError((await problem(result)).detail);
      return;
    }
    onCreated(result.data.obligation);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} width="xl">
        <DialogTitle>Add obligation</DialogTitle>
        <form
          className="mt-4 grid grid-cols-1 gap-4 @sm/dialog:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field id="obligation-label" label="Label">
            <Input
              id="obligation-label"
              autoFocus
              required
              value={draft.label}
              onChange={(event) => set("label", event.target.value)}
            />
          </Field>
          <Field id="obligation-due" label="Due date">
            <Input
              id="obligation-due"
              type="date"
              required
              value={draft.nextDueOn}
              onChange={(event) => set("nextDueOn", event.target.value)}
            />
          </Field>
          <Field id="obligation-recurrence" label="Repeat every (months)">
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
            label="Registration"
            value={draft.registrationId}
            onChange={(value) => set("registrationId", value)}
          >
            <option value="">None</option>
            {registrations.map((row) => (
              <option key={row.id} value={row.id}>
                {registrationLabel(row)}
              </option>
            ))}
          </SelectDraft>
          <SelectDraft
            id="obligation-assignee"
            label="Assignee"
            value={draft.assigneeId}
            onChange={(value) => set("assigneeId", value)}
          >
            <option value="">Unassigned</option>
            {options.users.map((row) => (
              <option key={row.id} value={row.id}>
                {row.displayName}
              </option>
            ))}
          </SelectDraft>
          <SelectDraft
            id="obligation-matter"
            label="Matter"
            value={draft.matterId}
            onChange={(value) => set("matterId", value)}
          >
            <option value="">None</option>
            {options.matters.map((row) => (
              <option key={row.id} value={row.id}>
                {matterLabel(row)}
              </option>
            ))}
          </SelectDraft>
          <div className="flex flex-col gap-1.5 @sm/dialog:col-span-2">
            <Label htmlFor="obligation-note">Note</Label>
            <textarea
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
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Add obligation
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
  const [filedOn, setFiledOn] = useState(localDay());
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby="mark-filed-explanation">
        <DialogTitle>Mark filed</DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p id="mark-filed-explanation" className="text-muted">
            {obligation.recurrenceMonths
              ? `Filing this moves forward ${obligation.recurrenceMonths} months from the current due date until the next due date is after the filing date.`
              : "Filing this completes the one-off obligation."}
          </p>
          <Field id="obligation-filed-on" label="Filed on">
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
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Mark filed
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

function registrationLabel(row: Pick<EntityRegistration, "jurisdiction" | "registrationNumber">) {
  return row.registrationNumber
    ? `${row.jurisdiction} · ${row.registrationNumber}`
    : row.jurisdiction;
}

function matterLabel(row: { number: number; title: string }) {
  return `M-${row.number} · ${row.title}`;
}

function byDueDate(a: EntityObligation, b: EntityObligation) {
  return a.nextDueOn.localeCompare(b.nextDueOn) || a.label.localeCompare(b.label);
}

function localDay() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
