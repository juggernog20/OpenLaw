// SPDX-License-Identifier: AGPL-3.0-only

/** Administrator maintenance for the explicit readers of one Confidential Entity. */
import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import type { EntityGrantEnvelope, EntityGrantPerson } from "../../lib/entities";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { problem } from "../../lib/problem";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

export function EntityGrantsDialog({
  entityId,
  open,
  onOpenChange,
}: Readonly<{ entityId: string; open: boolean; onOpenChange: (open: boolean) => void }>) {
  const intl = useIntl();
  const [data, setData] = useState<EntityGrantEnvelope>();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    let live = true;
    void api
      .GET("/api/v1/entities/{id}/grants", { params: { path: { id: entityId } } })
      .then((result) => {
        if (live && result.data) setData(result.data);
      });
    return () => {
      live = false;
    };
  }, [entityId, open]);

  const granted = new Set(data?.grants.map((person) => person.id));
  const candidates = data?.candidates.filter((person) => !granted.has(person.id)) ?? [];

  async function add() {
    if (!selected) return;
    setError(undefined);
    const result = await api
      .POST("/api/v1/entities/{id}/grants", {
        params: { path: { id: entityId } },
        body: { userId: selected },
      })
      .catch(() => undefined);
    if (!result?.data) {
      setError((await problem(result)).detail);
      return;
    }
    const person = result.data.grant;
    setData((current) => (current ? { ...current, grants: [...current.grants, person] } : current));
    setSelected("");
  }

  async function remove(person: EntityGrantPerson) {
    setError(undefined);
    const result = await api
      .DELETE("/api/v1/entities/{id}/grants/{userId}", {
        params: { path: { id: entityId, userId: person.id } },
      })
      .catch(() => undefined);
    if (!result?.response.ok) {
      setError((await problem(result)).detail);
      return;
    }
    setData((current) =>
      current
        ? { ...current, grants: current.grants.filter((grant) => grant.id !== person.id) }
        : current,
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="entity-grants-description">
        <DialogTitle>
          <FormattedMessage id="entities.grants.title" defaultMessage="Confidential access" />
        </DialogTitle>
        <p id="entity-grants-description" className="mt-1 text-sm text-muted">
          <FormattedMessage
            id="entities.grants.description"
            defaultMessage="Administrators always have access. Grant Legal Team Members access here."
          />
        </p>
        <div className="mt-4 flex flex-col gap-4">
          <ul className="divide-y divide-border-default rounded-card border border-border-default">
            {data?.grants.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>{person.displayName}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={intl.formatMessage(
                    { id: "entities.grants.remove", defaultMessage: "Remove {name}" },
                    { name: person.displayName },
                  )}
                  onClick={() => void remove(person)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </Button>
              </li>
            ))}
            {data && data.grants.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">
                <FormattedMessage id="entities.grants.empty" defaultMessage="No grants yet." />
              </li>
            ) : null}
          </ul>
          <div className="flex gap-2">
            <select
              aria-label={intl.formatMessage({
                id: "entities.grants.person",
                defaultMessage: "Legal Team Member",
              })}
              className={CONTROL_CLASS}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">
                {intl.formatMessage({
                  id: "entities.grants.pick",
                  defaultMessage: "Pick a person",
                })}
              </option>
              {candidates.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
            <Button disabled={!selected} onClick={() => void add()}>
              <FormattedMessage id="entities.grants.add" defaultMessage="Grant access" />
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
