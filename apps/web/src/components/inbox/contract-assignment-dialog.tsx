// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useState } from "react";
import { Check, Search } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { contractReference } from "../../lib/contracts";
import { Avatar } from "../avatar";
import { Button } from "../ui/button";
import { DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import type { UnassignedContract } from "./unassigned-contracts-columns";

export function ContractAssignmentDialog({
  row,
  busy,
  error,
  onAssign,
  onClose,
}: {
  row: UnassignedContract;
  busy: boolean;
  error: string | undefined;
  onAssign: (ownerId: string) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const [people, setPeople] = useState<{ id: string; displayName: string; email: string }[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api
      .GET("/api/v1/inbox/unassigned-contracts/assignees")
      .then(({ data }) => {
        if (!active) return;
        if (data) setPeople(data.people);
        else setLoadError(true);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const candidates = people?.filter((person) =>
    `${person.displayName} ${person.email}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <DialogContent aria-describedby="contract-assignment-description">
      <DialogTitle>
        <FormattedMessage
          id="inbox.contractAssignment.title"
          defaultMessage="Assign {reference}"
          values={{ reference: contractReference(intl, row.number) }}
        />
      </DialogTitle>
      <p id="contract-assignment-description" className="mt-2 text-sm text-muted">
        <FormattedMessage
          id="inbox.contractAssignment.explains"
          defaultMessage="Choose the Legal Owner responsible for this contract."
        />
      </p>
      <p className="mt-1 truncate text-sm font-medium">{row.title}</p>
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && selected && people?.some((person) => person.id === selected))
            onAssign(selected);
        }}
      >
        <div className="relative">
          <Search
            size={16}
            aria-hidden="true"
            className="absolute start-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            autoFocus
            className="ps-9"
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={intl.formatMessage({
              id: "inbox.assignment.search",
              defaultMessage: "Search people",
            })}
            placeholder={intl.formatMessage({
              id: "inbox.assignment.search",
              defaultMessage: "Search people",
            })}
          />
        </div>
        {loadError ? (
          <div role="alert" className="text-sm text-status-danger-fg">
            <FormattedMessage
              id="inbox.assignment.loadFailed"
              defaultMessage="People could not be loaded."
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="ms-2"
              onClick={() => {
                setLoadError(false);
                setAttempt((value) => value + 1);
              }}
            >
              <FormattedMessage id="action.retry" defaultMessage="Retry" />
            </Button>
          </div>
        ) : people === null ? (
          <p role="status" className="text-sm text-muted">
            <FormattedMessage id="inbox.assignment.loading" defaultMessage="Loading people…" />
          </p>
        ) : (
          <fieldset
            disabled={busy}
            className="max-h-72 overflow-y-auto rounded-card border border-border-default p-1"
          >
            <legend className="sr-only">
              <FormattedMessage id="inbox.contractAssignment.owner" defaultMessage="Legal Owner" />
            </legend>
            {candidates?.map((person) => (
              <label
                key={person.id}
                className="flex cursor-pointer items-center gap-3 rounded-chip px-3 py-2 hover:bg-control has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-link"
              >
                <input
                  type="radio"
                  name="legal-owner"
                  value={person.id}
                  checked={selected === person.id}
                  className="sr-only"
                  onChange={() => setSelected(person.id)}
                />
                <Avatar name={person.displayName} />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate">{person.displayName}</span>
                  <span className="block truncate text-xs text-muted">{person.email}</span>
                </span>
                {selected === person.id && (
                  <Check size={16} aria-hidden="true" className="text-link" />
                )}
              </label>
            ))}
            {!candidates?.length && (
              <p className="px-3 py-2 text-sm text-muted">
                <FormattedMessage
                  id="inbox.assignment.noMatch"
                  defaultMessage="No people match your search."
                />
              </p>
            )}
          </fieldset>
        )}
        {error && (
          <p role="alert" className="text-sm text-status-danger-fg">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
          </Button>
          <Button type="submit" disabled={busy || !selected || !people}>
            <FormattedMessage id="inbox.assignment.save" defaultMessage="Save assignment" />
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
