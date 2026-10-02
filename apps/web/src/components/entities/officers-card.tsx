// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entity record's Officers card: ENT-001's `entity_officers` rows,
 * added, edited inline, resigned, and removed one at a time.
 *
 * The list shows current officers unless "Show former" is on, so an
 * update that sets `resignedOn` drops the row from the list while the
 * toggle is off. Resign opens a dialog that confirms the date and says
 * so; the inline Resigned on field stays for corrections. The row still exists; the toggle reads it back. A
 * row's role may be archived, so the role selector retains its saved value.
 * The name picker also preserves links to users no longer offered in the list.
 */

import { useId, useState, type KeyboardEvent } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Plus, Trash2, UserMinus } from "lucide-react";
import { api } from "../../lib/api";
import type { EntityOfficer, EntityPersonOption, OfficerRoleOption } from "../../lib/entities";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { civilToday } from "../../lib/format";
import { problem } from "../../lib/problem";
import { StatusNote, type FieldStatus } from "../status-note";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { OfficerNameInput } from "./officer-name-input";

export function OfficersCard({
  entityId,
  initial,
  roles,
  users,
  frozen,
}: Readonly<{
  entityId: string;
  initial: readonly EntityOfficer[];
  roles: readonly OfficerRoleOption[];
  users: readonly EntityPersonOption[];
  frozen: boolean;
}>) {
  const [officers, setOfficers] = useState([...initial]);
  const [showFormer, setShowFormer] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [appointedOn, setAppointedOn] = useState("");
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [error, setError] = useState<string>();

  async function toggleFormer(next: boolean) {
    setShowFormer(next);
    const result = await api
      .GET("/api/v1/entities/{id}/officers", {
        params: { path: { id: entityId }, query: next ? { includeFormer: "true" } : {} },
      })
      .catch(() => undefined);
    if (!result?.data) {
      setStatus("error");
      setError((await problem(result)).detail);
      return;
    }
    setOfficers(result.data.officers);
  }

  async function addOfficer() {
    if (!name.trim() || !roleId || status === "saving") return;
    setStatus("saving");
    setError(undefined);
    const result = await api
      .POST("/api/v1/entities/{id}/officers", {
        params: { path: { id: entityId } },
        body: {
          name: name.trim(),
          officerRoleId: roleId,
          appointedOn: appointedOn || null,
          userId: userId || null,
        },
      })
      .catch(() => undefined);
    if (!result?.data) {
      setStatus("error");
      setError((await problem(result)).detail);
      return;
    }
    setOfficers((current) => [result.data.officer, ...current]);
    setName("");
    setAppointedOn("");
    setUserId("");
    setAdding(false);
    setStatus("saved");
  }

  async function updateOfficer(
    id: string,
    body: Record<string, unknown>,
    onRefused?: (detail: string | undefined) => void,
  ) {
    const result = await api
      .PATCH("/api/v1/entities/{id}/officers/{childId}", {
        params: { path: { id: entityId, childId: id } },
        body,
      })
      .catch(() => undefined);
    if (!result?.data) {
      const { detail } = await problem(result);
      if (onRefused) {
        onRefused(detail);
        return false;
      }
      setStatus("error");
      setError(detail);
      return false;
    }
    setOfficers((current) =>
      current
        .map((row) => (row.id === id ? result.data!.officer : row))
        .filter((row) => showFormer || row.resignedOn === null),
    );
    setStatus("saved");
    return true;
  }

  async function removeOfficer(id: string) {
    const result = await api
      .DELETE("/api/v1/entities/{id}/officers/{childId}", {
        params: { path: { id: entityId, childId: id } },
      })
      .catch(() => undefined);
    if (!result?.response.ok) {
      setStatus("error");
      setError((await problem(result)).detail);
      return;
    }
    setOfficers((current) => current.filter((row) => row.id !== id));
  }

  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex min-h-section-header items-center justify-between gap-3 border-b border-border-default bg-section-header px-4 py-2">
        <h2 id={headingId} className="text-base font-semibold">
          <FormattedMessage
            id="entities.record.officers.title"
            defaultMessage="Directors & Officers"
          />
        </h2>
        <div className="flex items-center gap-3">
          {!adding ? <StatusNote status={status} detail={error} /> : null}
          <label className="flex items-center gap-2 text-sm text-muted">
            <Checkbox
              checked={showFormer}
              onCheckedChange={(next) => void toggleFormer(next === true)}
            />
            <FormattedMessage
              id="entities.record.officers.showFormer"
              defaultMessage="Show former"
            />
          </label>
          {!frozen ? (
            <Button size="sm" variant="secondary" onClick={() => setAdding((current) => !current)}>
              <Plus size={16} aria-hidden="true" />
              <FormattedMessage
                id="entities.record.officers.add"
                defaultMessage="Add director or officer"
              />
            </Button>
          ) : null}
        </div>
      </header>
      {adding ? (
        <div className="grid grid-cols-1 gap-3 border-b border-border-muted bg-canvas p-4 @2xl/page:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-officer-name">
              <FormattedMessage
                id="entities.record.officers.name"
                defaultMessage="Director or officer name"
              />
            </Label>
            <OfficerNameInput
              id="new-officer-name"
              name={name}
              userId={userId || null}
              users={users}
              disabled={status === "saving"}
              onChange={(person) => {
                setName(person.name);
                setUserId(person.userId ?? "");
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-officer-role">
              <FormattedMessage id="entities.record.officers.role" defaultMessage="Role" />
            </Label>
            <select
              id="new-officer-role"
              className={CONTROL_CLASS}
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-officer-appointed">
              <FormattedMessage
                id="entities.record.officers.appointedOn"
                defaultMessage="Appointed on"
              />
            </Label>
            <Input
              id="new-officer-appointed"
              type="date"
              value={appointedOn}
              onChange={(event) => setAppointedOn(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 @2xl/page:col-span-3">
            <Button
              size="sm"
              disabled={status === "saving" || !name.trim() || !roleId}
              onClick={() => void addOfficer()}
            >
              <FormattedMessage id="common.add" defaultMessage="Add" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <StatusNote status={status} detail={error} />
          </div>
        </div>
      ) : null}
      {officers.length === 0 ? (
        <p className="p-4 text-base text-muted">
          <FormattedMessage
            id="entities.record.officers.empty"
            defaultMessage="No current directors or officers."
          />
        </p>
      ) : (
        <div className="divide-y divide-border-muted">
          {officers.map((officer) => (
            <OfficerRow
              key={officer.id}
              officer={officer}
              roles={roles}
              users={users}
              frozen={frozen}
              onUpdate={(body, onRefused) => updateOfficer(officer.id, body, onRefused)}
              onRemove={() => void removeOfficer(officer.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function OfficerRow({
  officer,
  roles,
  users,
  frozen,
  onUpdate,
  onRemove,
}: Readonly<{
  officer: EntityOfficer;
  roles: readonly OfficerRoleOption[];
  users: readonly EntityPersonOption[];
  frozen: boolean;
  onUpdate: (
    body: Record<string, unknown>,
    onRefused?: (detail: string | undefined) => void,
  ) => Promise<boolean>;
  onRemove: () => void;
}>) {
  const intl = useIntl();
  const label = (field: string) =>
    intl.formatMessage(
      {
        id: "entities.record.officers.rowField",
        defaultMessage: "{officer} {field}",
      },
      { officer: officer.name, field },
    );
  const [appointedOn, setAppointedOn] = useState(officer.appointedOn ?? "");
  const [resignedOn, setResignedOn] = useState(officer.resignedOn ?? "");
  const [resigning, setResigning] = useState(false);
  // DES-017: Enter commits through the blur, and Escape reverts the draft.
  const keys = (revert: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") revert();
  };
  return (
    <div className="grid grid-cols-1 gap-3 p-4 @2xl/page:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
      <OfficerNameInput
        label={label(
          intl.formatMessage({
            id: "entities.record.officers.name",
            defaultMessage: "Director or officer name",
          }),
        )}
        name={officer.name}
        userId={officer.user?.id ?? null}
        users={users}
        disabled={frozen}
        onCommit={(person) => onUpdate(person)}
      />
      <select
        aria-label={label(
          intl.formatMessage({ id: "entities.record.officers.role", defaultMessage: "Role" }),
        )}
        className={CONTROL_CLASS}
        value={officer.officerRoleId}
        disabled={frozen}
        onChange={(event) => onUpdate({ officerRoleId: event.target.value })}
      >
        {!roles.some((role) => role.id === officer.officerRoleId) ? (
          <option value={officer.officerRoleId}>{officer.officerRoleName}</option>
        ) : null}
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            {role.displayName}
          </option>
        ))}
      </select>
      <Input
        aria-label={label(
          intl.formatMessage({
            id: "entities.record.officers.appointedOn",
            defaultMessage: "Appointed on",
          }),
        )}
        type="date"
        value={appointedOn}
        disabled={frozen}
        onChange={(event) => setAppointedOn(event.target.value)}
        onKeyDown={keys(() => setAppointedOn(officer.appointedOn ?? ""))}
        onBlur={() =>
          appointedOn !== (officer.appointedOn ?? "") &&
          onUpdate({ appointedOn: appointedOn || null })
        }
      />
      <Input
        aria-label={label(
          intl.formatMessage({
            id: "entities.record.officers.resignedOn",
            defaultMessage: "Resigned on",
          }),
        )}
        type="date"
        value={resignedOn}
        disabled={frozen}
        onChange={(event) => setResignedOn(event.target.value)}
        onKeyDown={keys(() => setResignedOn(officer.resignedOn ?? ""))}
        onBlur={() =>
          resignedOn !== (officer.resignedOn ?? "") && onUpdate({ resignedOn: resignedOn || null })
        }
      />
      {!frozen ? (
        <div className="flex items-center gap-1">
          {officer.resignedOn === null ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={intl.formatMessage(
                { id: "entities.record.officers.resign", defaultMessage: "Resign {officer}" },
                { officer: officer.name },
              )}
              onClick={() => setResigning(true)}
            >
              <UserMinus size={16} aria-hidden="true" />
              <FormattedMessage
                id="entities.record.officers.resignAction"
                defaultMessage="Resign"
              />
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            aria-label={intl.formatMessage(
              { id: "entities.record.officers.remove", defaultMessage: "Remove {officer}" },
              { officer: officer.name },
            )}
            onClick={onRemove}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      ) : null}
      {resigning ? (
        <ResignOfficerDialog
          officer={officer}
          onClose={() => setResigning(false)}
          onResign={(date, onRefused) => onUpdate({ resignedOn: date }, onRefused)}
        />
      ) : null}
    </div>
  );
}

/** DES-017's compound-edit dialog: a resignation removes the row from
 * the current list, so it asks for the date and says where the row goes. */
function ResignOfficerDialog({
  officer,
  onClose,
  onResign,
}: Readonly<{
  officer: EntityOfficer;
  onClose: () => void;
  onResign: (date: string, onRefused: (detail: string | undefined) => void) => Promise<boolean>;
}>) {
  const intl = useIntl();
  const id = useId();
  const [date, setDate] = useState(() => civilToday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function confirm() {
    if (!date || busy) return;
    setBusy(true);
    setError(undefined);
    const saved = await onResign(date, (detail) =>
      setError(
        detail ??
          intl.formatMessage({
            id: "entities.record.officers.resignFailed",
            defaultMessage: "The resignation could not be saved. Try again.",
          }),
      ),
    );
    setBusy(false);
    if (saved) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent aria-describedby={`${id}-summary`}>
        <DialogTitle>
          <FormattedMessage
            id="entities.record.officers.resignTitle"
            defaultMessage="Resign {officer}"
            values={{ officer: officer.name }}
          />
        </DialogTitle>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <p id={`${id}-summary`} className="text-sm text-muted">
            <FormattedMessage
              id="entities.record.officers.resignSummary"
              defaultMessage="{officer} resigns as {role}. The row moves to Show former."
              values={{ officer: officer.name, role: officer.officerRoleName }}
            />
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-date`}>
              <FormattedMessage
                id="entities.record.officers.resignedOn"
                defaultMessage="Resigned on"
              />
            </Label>
            <Input
              id={`${id}-date`}
              type="date"
              required
              value={date}
              disabled={busy}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy || !date}>
              <FormattedMessage
                id="entities.record.officers.resignAction"
                defaultMessage="Resign"
              />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
