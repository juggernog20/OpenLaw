// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, UserPlus, UserRound } from "lucide-react";
import { useIntl } from "react-intl";
import { Avatar } from "../avatar";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

export interface TaskAssigneePerson {
  id: string;
  displayName: string;
  image?: string | null;
}

export interface TaskTeamExpansion {
  people: readonly TaskAssigneePerson[];
  onAdded: (id: string) => void;
}

export function taskAssignee(
  task: { assigneeId: string | null; assigneeName?: string | null; assigneeImage?: string | null },
  people: readonly TaskAssigneePerson[],
): TaskAssigneePerson | null {
  if (!task.assigneeId) return null;
  const person = people.find((entry) => entry.id === task.assigneeId);
  return {
    id: task.assigneeId,
    displayName: task.assigneeName ?? person?.displayName ?? task.assigneeId,
    image: task.assigneeImage ?? person?.image,
  };
}

export function TaskAssigneePicker({
  value,
  people,
  taskTitle,
  additionalPeople,
  deferred = false,
  disabled = false,
  readOnly = false,
  id,
  label,
  onChange,
}: Readonly<{
  value: TaskAssigneePerson | null;
  people: readonly TaskAssigneePerson[];
  taskTitle: string;
  additionalPeople?: readonly TaskAssigneePerson[];
  deferred?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  label?: string;
  onChange: (id: string | null, addToTeam?: boolean) => Promise<string | null>;
}>) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<TaskAssigneePerson | null>(null);
  const unassigned = intl.formatMessage({
    id: "taskAssignee.unassigned",
    defaultMessage: "Unassigned",
  });
  const name = value?.displayName ?? unassigned;
  const outsiders = additionalPeople?.filter(
    (person) => !people.some((member) => member.id === person.id),
  );
  const candidates = (adding ? (outsiders ?? []) : people).filter((person) =>
    person.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  async function choose(next: string | null, addToTeam = false) {
    if (pending.current || disabled) return;
    if (!addToTeam && next === (value?.id ?? null)) {
      setOpen(false);
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      const refusal = await onChange(next, addToTeam || undefined);
      if (refusal) setError(refusal);
      else setOpen(false);
    } catch {
      setError(
        intl.formatMessage({
          id: "taskAssignee.failed",
          defaultMessage: "The assignee could not be changed. Try again.",
        }),
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  const face = value ? (
    <Avatar name={name} image={value.image} className="size-6" />
  ) : (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-avatar border border-dashed border-border-default text-muted">
      <UserRound size={14} aria-hidden="true" />
    </span>
  );
  if (readOnly)
    return (
      <span className="flex shrink-0 items-center gap-2 text-sm text-muted" title={name}>
        {face}
        <span className="max-w-36 truncate">{name}</span>
      </span>
    );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (pending.current) return;
        setOpen(next);
        setQuery("");
        setAdding(false);
        setSelected(null);
        setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled || saving}
          aria-label={
            label ??
            intl.formatMessage(
              { id: "taskAssignee.change", defaultMessage: "Change assignee for {task}: {name}" },
              { task: taskTitle, name },
            )
          }
          title={name}
          className="flex min-h-8 shrink-0 items-center gap-2 rounded-button border border-border-default bg-raised px-2 py-1 text-sm hover:bg-control focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link disabled:opacity-50"
        >
          {face}
          <span className="max-w-36 truncate">{name}</span>
          <ChevronDown size={12} className="text-muted" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
        aria-label={intl.formatMessage({
          id: "taskAssignee.choose",
          defaultMessage: "Assign task",
        })}
      >
        {adding && (
          <Button
            type="button"
            variant="ghost"
            className="mb-2"
            disabled={saving}
            onClick={() => {
              if (selected) setSelected(null);
              else {
                setAdding(false);
                setQuery("");
              }
              setError(null);
            }}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            {intl.formatMessage({ id: "taskAssignee.back", defaultMessage: "Back" })}
          </Button>
        )}
        {selected ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Avatar name={selected.displayName} image={selected.image} className="size-8" />
              <span className="font-medium">{selected.displayName}</span>
            </div>
            <p className="text-sm text-muted">
              {intl.formatMessage({
                id: "taskAssignee.access",
                defaultMessage:
                  "This person will join the team, gain access to this record, and be assigned this task.",
              })}
            </p>
            {deferred && (
              <p className="text-sm text-muted">
                {intl.formatMessage({
                  id: "taskAssignee.deferred",
                  defaultMessage:
                    "Team membership and assignment are saved when you save the task.",
                })}
              </p>
            )}
            <Button
              type="button"
              disabled={saving || disabled}
              onClick={() => void choose(selected.id, true)}
            >
              {deferred
                ? intl.formatMessage({
                    id: "taskAssignee.usePerson",
                    defaultMessage: "Use this person",
                  })
                : intl.formatMessage({
                    id: "taskAssignee.addAndAssign",
                    defaultMessage: "Add to team and assign",
                  })}
            </Button>
          </div>
        ) : (
          <>
            <Input
              autoFocus
              aria-label={intl.formatMessage({
                id: "taskAssignee.search",
                defaultMessage: "Search people",
              })}
              placeholder={intl.formatMessage({
                id: "taskAssignee.search",
                defaultMessage: "Search people",
              })}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={saving}
            />
            <div className="mt-2 max-h-64 overflow-y-auto">
              {!adding && (
                <button
                  type="button"
                  disabled={saving || disabled}
                  onClick={() => void choose(null)}
                  className="flex min-h-10 w-full items-center gap-2 rounded-button px-2 py-2 text-start text-sm hover:bg-control focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
                >
                  <UserRound size={24} className="text-muted" aria-hidden="true" />
                  <span className="flex-1">{unassigned}</span>
                  {!value && <Check size={16} aria-hidden="true" />}
                </button>
              )}
              {candidates.map((person) => (
                <button
                  type="button"
                  key={person.id}
                  disabled={saving || disabled}
                  onClick={() => (adding ? setSelected(person) : void choose(person.id))}
                  className="flex min-h-10 w-full items-center gap-2 rounded-button px-2 py-2 text-start text-sm hover:bg-control focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"
                >
                  <Avatar name={person.displayName} image={person.image} className="size-6" />
                  <span className="flex-1">{person.displayName}</span>
                  {person.id === value?.id && <Check size={16} aria-hidden="true" />}
                </button>
              ))}
              {candidates.length === 0 && (
                <p className="px-2 py-3 text-sm text-muted">
                  {intl.formatMessage({
                    id: "taskAssignee.empty",
                    defaultMessage: "No matching people",
                  })}
                </p>
              )}
            </div>
            {!adding && outsiders && outsiders.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                className="mt-2 w-full justify-start border-t border-border-muted"
                disabled={saving || disabled}
                onClick={() => {
                  setAdding(true);
                  setQuery("");
                  setError(null);
                }}
              >
                <UserPlus size={16} aria-hidden="true" />
                {intl.formatMessage({
                  id: "taskAssignee.addSomeone",
                  defaultMessage: "Add someone to the team…",
                })}
              </Button>
            )}
          </>
        )}
        {saving && (
          <p role="status" className="px-2 py-2 text-xs text-muted">
            {intl.formatMessage({ id: "taskAssignee.saving", defaultMessage: "Saving…" })}
          </p>
        )}
        {error && (
          <p role="alert" className="px-2 py-2 text-sm text-status-danger-fg">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
