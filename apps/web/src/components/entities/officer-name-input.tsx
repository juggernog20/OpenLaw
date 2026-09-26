// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The name control on an Officer row. One combobox holds the name and
 * the optional link to a user, so the two cannot disagree.
 */
import { useId, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { FormattedMessage, useIntl } from "react-intl";
import { Check, User } from "lucide-react";
import type { EntityPersonOption } from "../../lib/entities";
import { Popover, PopoverContent } from "../ui/popover";
import { Input } from "../ui/input";

type Person = { name: string; userId: string | null };

/** Selecting a user links the name; typing a name records an unlinked person. */
export function OfficerNameInput({
  id,
  label,
  name,
  userId,
  users,
  disabled,
  onChange,
  onCommit,
}: {
  id?: string;
  label?: string;
  name: string;
  userId: string | null;
  users: readonly EntityPersonOption[];
  disabled?: boolean;
  onChange?: (person: Person) => void;
  onCommit?: (person: Person) => Promise<boolean>;
}) {
  const intl = useIntl();
  const listId = useId();
  const [draft, setDraft] = useState<Person>({ name, userId });
  const [source, setSource] = useState<Person>({ name, userId });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  if (source.name !== name || source.userId !== userId) {
    setSource({ name, userId });
    setDraft({ name, userId });
  }
  const matches = users.filter((user) =>
    user.displayName.toLocaleLowerCase().includes(draft.name.trim().toLocaleLowerCase()),
  );
  const choices: Person[] = matches.map((user) => ({ name: user.displayName, userId: user.id }));
  if (draft.name.trim()) choices.push({ name: draft.name.trim(), userId: null });
  const selected = choices[active];
  function change(person: Person) {
    setDraft(person);
    onChange?.(person);
  }
  async function commit(person: Person) {
    setOpen(false);
    setActive(-1);
    if (busy) return;
    if (!person.name.trim()) {
      change({ name, userId });
      return;
    }
    const next = { ...person, name: person.name.trim() };
    change(next);
    if (!onCommit || (next.name === name && next.userId === userId)) return;
    setBusy(true);
    try {
      if (!(await onCommit(next))) change({ name, userId });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Popover open={open && !disabled && !busy} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div className="relative min-w-0">
          <Input
            id={id}
            aria-label={label}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && !disabled && !busy}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && selected ? `${listId}-${active}` : undefined}
            autoComplete="off"
            maxLength={200}
            disabled={disabled || busy}
            className={draft.userId ? "pe-8" : undefined}
            placeholder={intl.formatMessage({
              id: "entities.record.officers.namePlaceholder",
              defaultMessage: "Select a user or enter a name",
            })}
            value={draft.name}
            onFocus={() => {
              setOpen(true);
              setActive(-1);
            }}
            onChange={(event) => {
              change({ name: event.target.value, userId: null });
              setActive(-1);
              setOpen(true);
            }}
            onBlur={() => void commit(draft)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                if (choices.length)
                  setActive(
                    event.key === "ArrowDown"
                      ? (active + 1) % choices.length
                      : (active <= 0 ? choices.length : active) - 1,
                  );
              } else if (event.key === "Enter") {
                event.preventDefault();
                void commit(open && selected ? selected : draft);
              } else if (event.key === "Escape") {
                // Nothing to undo: let Escape reach the page's own handler.
                if (!open && draft.name === name && draft.userId === userId) return;
                event.preventDefault();
                event.stopPropagation();
                change({ name, userId });
                setOpen(false);
              }
            }}
          />
          {draft.userId && (
            <User
              size={14}
              aria-label={intl.formatMessage({
                id: "entities.record.officers.userLinked",
                defaultMessage: "User linked",
              })}
              className="pointer-events-none absolute end-2 top-2 text-muted"
            />
          )}
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-56 p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (event.target instanceof Element && event.target.closest('[role="combobox"]'))
            event.preventDefault();
        }}
      >
        <ul
          id={listId}
          role="listbox"
          aria-label={intl.formatMessage({
            id: "entities.record.officers.people",
            defaultMessage: "People",
          })}
          className="max-h-60 overflow-y-auto"
        >
          {choices.map((person, index) => (
            <li
              key={person.userId ?? "manual"}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={draft.userId === person.userId && draft.name === person.name}
              className={`flex cursor-pointer items-center gap-2 rounded-button px-3 py-2 text-sm ${active === index ? "bg-selected" : "hover:bg-control"}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void commit(person)}
            >
              <span className="min-w-0 flex-1 break-words">
                {person.userId ? (
                  person.name
                ) : (
                  <FormattedMessage
                    id="entities.record.officers.useName"
                    defaultMessage={'Use "{name}" without linking a user'}
                    values={{ name: person.name }}
                  />
                )}
              </span>
              {person.userId && draft.userId === person.userId && (
                <Check size={14} aria-hidden="true" className="shrink-0 text-muted" />
              )}
            </li>
          ))}
          {!choices.length && (
            <li className="px-3 py-2 text-sm text-muted">
              <FormattedMessage
                id="entities.record.officers.enterName"
                defaultMessage="Enter a name to add someone outside the user list."
              />
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
