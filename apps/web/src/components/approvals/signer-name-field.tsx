// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The name box of one signer row in the send dialog (CTR-013). It
 * suggests users of this install as the sender types. Picking one hands
 * the person to the row, and the seam reads their address. Text that
 * matches nobody stays a typed name, for a signer outside OpenLaw.
 */
import { useId, useState } from "react";
import { useIntl } from "react-intl";
import type { UserOption } from "../../lib/contracts";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { Avatar } from "../avatar";

/** How many suggestions the list shows at once. */
const MAX_MATCHES = 8;

export function SignerNameField({
  value,
  label,
  people,
  onType,
  onPick,
}: Readonly<{
  value: string;
  label: string;
  /** The users this row may offer: live, and not already on another row. */
  people: readonly UserOption[];
  onType: (name: string) => void;
  onPick: (person: UserOption) => void;
}>) {
  const intl = useIntl();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = value.trim().toLowerCase();
  const matches = (
    query === ""
      ? people
      : people.filter((person) => person.displayName.toLowerCase().includes(query))
  ).slice(0, MAX_MATCHES);
  const shown = open && matches.length > 0;

  function pick(person: UserOption) {
    setOpen(false);
    onPick(person);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listboxId}
        aria-activedescendant={
          shown && matches[activeIndex] ? `${listboxId}-${matches[activeIndex].id}` : undefined
        }
        autoComplete="off"
        className={CONTROL_CLASS}
        placeholder={intl.formatMessage({
          id: "signing.namePlaceholder",
          defaultMessage: "Search people or type a name",
        })}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onType(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          const count = Math.max(matches.length, 1);
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => (current + 1) % count);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => (current - 1 + count) % count);
          }
          if (event.key === "Enter" && shown && matches[activeIndex]) {
            event.preventDefault();
            pick(matches[activeIndex]);
          }
          if (event.key === "Escape" && shown) {
            // Closes the list, not the dialog around it.
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {shown && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={intl.formatMessage({
            id: "signing.peopleMatches",
            defaultMessage: "People in OpenLaw",
          })}
          className="absolute top-full z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-card border border-border-default bg-raised p-1 shadow-md"
        >
          {matches.map((person, index) => (
            <li
              id={`${listboxId}-${person.id}`}
              key={person.id}
              role="option"
              aria-selected={index === activeIndex}
              className={`flex cursor-pointer items-center gap-2 rounded-chip px-2 py-1.5 text-sm ${index === activeIndex ? "bg-control" : ""}`}
              // Keeps focus in the box, so the blur does not close the
              // list before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(person)}
            >
              <Avatar name={person.displayName} image={person.image} className="size-6" />
              <span className="truncate">{person.displayName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
