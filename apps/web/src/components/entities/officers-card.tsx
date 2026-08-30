// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entity record's Officers card: ENT-001's `entity_officers` rows,
 * added, edited inline, resigned, and removed one at a time.
 *
 * The list shows current officers unless "Show former" is on, so an
 * update that sets `resignedOn` drops the row from the list while the
 * toggle is off. The row still exists; the toggle reads it back. A
 * row's role or linked user may no longer be in the option lists (an
 * archived role, a person no longer offered), so the row's own value
 * is re-offered as one extra option. Without it the select would show
 * the first option and read as a change nobody made.
 */

import { useId, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import type { EntityOfficer, EntityPersonOption, OfficerRoleOption } from "../../lib/entities";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { problem } from "../../lib/problem";
import { StatusNote, type FieldStatus } from "../status-note";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

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
  const intl = useIntl();
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
    if (!name.trim() || !roleId) return;
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

  async function updateOfficer(id: string, body: Record<string, unknown>) {
    const result = await api
      .PATCH("/api/v1/entities/{id}/officers/{childId}", {
        params: { path: { id: entityId, childId: id } },
        body,
      })
      .catch(() => undefined);
    if (!result?.data) {
      setStatus("error");
      setError((await problem(result)).detail);
      return;
    }
    setOfficers((current) =>
      current
        .map((row) => (row.id === id ? result.data!.officer : row))
        .filter((row) => showFormer || row.resignedOn === null),
    );
    setStatus("saved");
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
          <FormattedMessage id="entities.record.officers.title" defaultMessage="Officers" />
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
              <FormattedMessage id="entities.record.officers.add" defaultMessage="Add officer" />
            </Button>
          ) : null}
        </div>
      </header>
      {adding ? (
        <div className="grid grid-cols-1 gap-3 border-b border-border-muted bg-canvas p-4 @2xl/page:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-officer-name">
              <FormattedMessage id="entities.record.officers.name" defaultMessage="Officer name" />
            </Label>
            <Input
              id="new-officer-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-officer-user">
              <FormattedMessage id="entities.record.officers.user" defaultMessage="Linked user" />
            </Label>
            <select
              id="new-officer-user"
              className={CONTROL_CLASS}
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="">
                {intl.formatMessage({ id: "entities.record.none", defaultMessage: "None" })}
              </option>
              {users.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 @2xl/page:col-span-4">
            <Button size="sm" onClick={() => void addOfficer()}>
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
            defaultMessage="No current officers."
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
              onUpdate={(body) => void updateOfficer(officer.id, body)}
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
  onUpdate: (body: Record<string, unknown>) => void;
  onRemove: () => void;
}>) {
  const intl = useIntl();
  const [name, setName] = useState(officer.name);
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
  return (
    <div className="grid grid-cols-1 gap-3 p-4 @2xl/page:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_auto]">
      <Input
        aria-label={label(
          intl.formatMessage({
            id: "entities.record.officers.name",
            defaultMessage: "Officer name",
          }),
        )}
        value={name}
        disabled={frozen}
        onChange={(event) => setName(event.target.value)}
        onBlur={() =>
          name.trim() && name.trim() !== officer.name && onUpdate({ name: name.trim() })
        }
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
        onBlur={() =>
          resignedOn !== (officer.resignedOn ?? "") && onUpdate({ resignedOn: resignedOn || null })
        }
      />
      <select
        aria-label={label(
          intl.formatMessage({
            id: "entities.record.officers.user",
            defaultMessage: "Linked user",
          }),
        )}
        className={CONTROL_CLASS}
        value={officer.user?.id ?? ""}
        disabled={frozen}
        onChange={(event) => onUpdate({ userId: event.target.value || null })}
      >
        <option value="">
          {intl.formatMessage({ id: "entities.record.none", defaultMessage: "None" })}
        </option>
        {officer.user && !users.some((person) => person.id === officer.user!.id) ? (
          <option value={officer.user.id}>{officer.user.displayName}</option>
        ) : null}
        {users.map((person) => (
          <option key={person.id} value={person.id}>
            {person.displayName}
          </option>
        ))}
      </select>
      {!frozen ? (
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
      ) : null}
    </div>
  );
}
