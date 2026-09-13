// SPDX-License-Identifier: AGPL-3.0-only

/** CTR-026: default people apply to Contracts created after each change commits. */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { SettingsCard } from "./settings-card";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

type Person =
  paths["/api/v1/contract-types/{id}/people"]["get"]["responses"]["200"]["content"]["application/json"]["people"][number];
type User =
  paths["/api/v1/users"]["get"]["responses"]["200"]["content"]["application/json"]["users"][number];

export function ContractTypePeople({
  typeId,
  initialPeople,
  users,
  archived,
}: Readonly<{ typeId: string; initialPeople: Person[]; users: User[]; archived: boolean }>) {
  const intl = useIntl();
  const [people, setPeople] = useState(initialPeople);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const candidates = users.filter(
    (p) => p.status !== "archived" && !people.some((member) => member.id === p.id),
  );
  async function save(action: "add" | "remove" | "order", personId?: string, userIds?: string[]) {
    setBusy(true);
    setError(undefined);
    setAnnouncement("");
    const result = await (
      action === "add"
        ? api.POST("/api/v1/contract-types/{id}/people", {
            params: { path: { id: typeId } },
            body: { userId: selected },
          })
        : action === "remove"
          ? api.DELETE("/api/v1/contract-types/{id}/people/{userId}", {
              params: { path: { id: typeId, userId: personId! } },
            })
          : api.PUT("/api/v1/contract-types/{id}/people/order", {
              params: { path: { id: typeId } },
              body: { userIds: userIds! },
            })
    ).catch(() => undefined);
    if (result?.data) {
      setPeople(result.data.people);
      if (action === "order")
        setAnnouncement(
          intl.formatMessage({
            id: "settings.contractTypePeople.reordered",
            defaultMessage: "Default people reordered.",
          }),
        );
      if (action === "add") setSelected("");
    } else
      setError(
        (await problem(result)).detail ??
          intl.formatMessage({
            id: "settings.contractTypePeople.failed",
            defaultMessage: "Could not save default people. Please try again.",
          }),
      );
    setBusy(false);
  }
  function move(index: number, offset: number) {
    const ids = people.map((p) => p.id);
    [ids[index], ids[index + offset]] = [ids[index + offset]!, ids[index]!];
    void save("order", undefined, ids);
  }
  return (
    <SettingsCard
      title={<FormattedMessage id="settings.contractTypePeople.title" defaultMessage="People" />}
      className="w-140 shrink-0 grow-0"
    >
      <p className="text-sm text-muted">
        <FormattedMessage
          id="settings.contractTypePeople.help"
          defaultMessage="These people join every new Contract of this Contract Type and receive a notification. Changes apply to future Contracts. Archived people are skipped."
        />
      </p>
      {people.length === 0 && (
        <p className="text-sm text-muted">
          <FormattedMessage
            id="settings.contractTypePeople.empty"
            defaultMessage="No default people."
          />
        </p>
      )}
      <ul
        aria-label={intl.formatMessage({
          id: "settings.contractTypePeople.list",
          defaultMessage: "Default people",
        })}
        className="flex flex-col gap-2"
      >
        {people.map((person, index) => (
          <li key={person.id} className="flex items-center gap-2">
            <span className="flex-1">
              {person.displayName}
              {person.archived && (
                <>
                  {" "}
                  <FormattedMessage
                    id="settings.contractTypePeople.archived"
                    defaultMessage="(Archived)"
                  />
                </>
              )}
            </span>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy || archived || index === 0}
              aria-label={intl.formatMessage(
                { id: "settings.contractTypePeople.up", defaultMessage: "Move {name} up" },
                { name: person.displayName },
              )}
              onClick={() => move(index, -1)}
            >
              <ArrowUp size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy || archived || index === people.length - 1}
              aria-label={intl.formatMessage(
                { id: "settings.contractTypePeople.down", defaultMessage: "Move {name} down" },
                { name: person.displayName },
              )}
              onClick={() => move(index, 1)}
            >
              <ArrowDown size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy || archived}
              aria-label={intl.formatMessage(
                { id: "settings.contractTypePeople.remove", defaultMessage: "Remove {name}" },
                { name: person.displayName },
              )}
              onClick={() => void save("remove", person.id)}
            >
              <X size={16} />
            </Button>
          </li>
        ))}
      </ul>
      <Label htmlFor="contract-default-person">
        <FormattedMessage id="settings.contractTypePeople.person" defaultMessage="Default person" />
      </Label>
      <div className="flex gap-2">
        <select
          id="contract-default-person"
          className="min-w-0 flex-1 rounded-input border border-border-default bg-input px-3 py-2 text-sm"
          value={selected}
          disabled={busy || archived || candidates.length === 0}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">
            {intl.formatMessage({
              id: "settings.contractTypePeople.choose",
              defaultMessage: "Choose a person",
            })}
          </option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
        <Button disabled={busy || archived || !selected} onClick={() => void save("add")}>
          <FormattedMessage id="settings.contractTypePeople.add" defaultMessage="Add person" />
        </Button>
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}
