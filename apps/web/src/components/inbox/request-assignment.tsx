// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";
import { Check, Search, UserPlus, UserRound } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { requestReference, type InboxRow, type StaffRequest } from "../../lib/requests";
import { Avatar } from "../avatar";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Input } from "../ui/input";

type Person = NonNullable<InboxRow["assignee"]>;
type AssignableRequest = Pick<InboxRow, "number" | "summary" | "status" | "assignee">;

export function RequestAssignment({
  request,
  onAssigned,
  showName = false,
}: Readonly<{
  request: AssignableRequest;
  onAssigned: (request: StaffRequest) => void;
  showName?: boolean;
}>) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const pending = useRef(false);
  const reference = requestReference(intl, request.number);
  const name = request.assignee?.displayName;
  const label = name
    ? intl.formatMessage(
        { id: "inbox.reassignRow", defaultMessage: "Reassign {reference}: {name}" },
        { reference, name },
      )
    : intl.formatMessage(
        { id: "inbox.assignRow", defaultMessage: "Assign {reference}" },
        { reference },
      );
  const face = request.assignee && (
    <Avatar name={request.assignee.displayName} image={request.assignee.image} />
  );
  if (request.status !== "new")
    return face ? (
      <span className="inline-flex items-center gap-2" title={name} aria-label={name}>
        {face}
        {showName && name}
      </span>
    ) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending.current) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        {request.assignee ? (
          <button
            type="button"
            aria-label={label}
            title={label}
            className="inline-flex items-center gap-2 rounded-avatar p-1 text-sm hover:bg-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
          >
            {face}
            {showName && <span className="max-w-36 truncate">{name}</span>}
          </button>
        ) : (
          <Button variant="secondary" size="sm" aria-label={label}>
            <UserPlus size={16} aria-hidden="true" />
            <FormattedMessage id="inbox.assign" defaultMessage="Assign" />
          </Button>
        )}
      </DialogTrigger>
      {open && (
        <AssignmentDialog
          request={request}
          reference={reference}
          onBusy={(busy) => {
            pending.current = busy;
          }}
          onClose={() => setOpen(false)}
          onAssigned={(updated) => {
            onAssigned(updated);
            setOpen(false);
          }}
        />
      )}
    </Dialog>
  );
}

function AssignmentDialog({
  request,
  reference,
  onBusy,
  onClose,
  onAssigned,
}: Readonly<{
  request: AssignableRequest;
  reference: string;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
  onAssigned: (request: StaffRequest) => void;
}>) {
  const intl = useIntl();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(request.assignee?.id ?? null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api
      .GET("/api/v1/requests/assignees")
      .then((result) => {
        if (!active) return;
        if (result.data) setPeople(result.data.people);
        else setLoadError(true);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  async function save() {
    if (pending.current || people === null || selected === (request.assignee?.id ?? null)) return;
    pending.current = true;
    onBusy(true);
    setSaving(true);
    setError(null);
    try {
      const result = await api.PATCH("/api/v1/requests/{number}/assignee", {
        params: { path: { number: request.number } },
        body: { assigneeId: selected },
      });
      if (result.data) onAssigned(result.data.request);
      else
        setError(
          result.error?.detail ??
            intl.formatMessage({
              id: "inbox.assignment.failed",
              defaultMessage: "The assignment could not be saved. Try again.",
            }),
        );
    } catch {
      setError(
        intl.formatMessage({
          id: "inbox.assignment.failed",
          defaultMessage: "The assignment could not be saved. Try again.",
        }),
      );
    } finally {
      pending.current = false;
      onBusy(false);
      setSaving(false);
    }
  }
  const candidates = people?.filter((person) =>
    person.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const unassigned = intl.formatMessage({
    id: "inbox.assignment.unassigned",
    defaultMessage: "Unassigned",
  });
  const unavailable =
    request.assignee && people && !people.some((person) => person.id === request.assignee?.id);
  return (
    <DialogContent aria-describedby="assignment-description">
      <DialogTitle>
        <FormattedMessage
          id="inbox.assignment.title"
          defaultMessage="Assign {reference} for triage"
          values={{ reference }}
        />
      </DialogTitle>
      <p id="assignment-description" className="mt-2 text-sm text-muted">
        <FormattedMessage
          id="inbox.assignment.explains"
          defaultMessage="Choose who should triage this request."
        />
      </p>
      <p className="mt-1 truncate text-sm font-medium">{request.summary}</p>
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
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
            disabled={saving}
            className="max-h-72 overflow-y-auto rounded-card border border-border-default p-1"
          >
            <legend className="sr-only">
              <FormattedMessage id="inbox.assignment.person" defaultMessage="Triage assignee" />
            </legend>
            {[{ id: null, displayName: unassigned, image: null }, ...(candidates ?? [])].map(
              (person) => (
                <label
                  key={person.id ?? "unassigned"}
                  className="flex cursor-pointer items-center gap-3 rounded-chip px-3 py-2 hover:bg-control has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-link"
                >
                  <input
                    type="radio"
                    name="triage-assignee"
                    value={person.id ?? ""}
                    checked={selected === person.id}
                    className="sr-only"
                    onChange={() => {
                      setSelected(person.id);
                      setError(null);
                    }}
                  />
                  {person.id ? (
                    <Avatar name={person.displayName} image={person.image} />
                  ) : (
                    <span className="flex size-8 items-center justify-center rounded-avatar border border-dashed border-border-default text-muted">
                      <UserRound size={16} aria-hidden="true" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{person.displayName}</span>
                  {selected === person.id && (
                    <Check size={16} aria-hidden="true" className="text-link" />
                  )}
                </label>
              ),
            )}
            {candidates?.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted">
                <FormattedMessage
                  id="inbox.assignment.noMatch"
                  defaultMessage="No people match your search."
                />
              </p>
            )}
          </fieldset>
        )}
        {unavailable && (
          <p className="text-sm text-muted">
            <FormattedMessage
              id="inbox.assignment.unavailable"
              defaultMessage="{name} is no longer available to triage. Choose another person or clear the assignment."
              values={{ name: request.assignee?.displayName }}
            />
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-status-danger-fg">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
          </Button>
          <Button
            type="submit"
            disabled={saving || people === null || selected === (request.assignee?.id ?? null)}
          >
            <FormattedMessage id="inbox.assignment.save" defaultMessage="Save assignment" />
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}
