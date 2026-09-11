// SPDX-License-Identifier: AGPL-3.0-only

import { X } from "lucide-react";
import { Avatar } from "./avatar";
import { Button } from "./ui/button";

export interface TeamPerson {
  id: string;
  displayName: string;
  image: string | null;
  archived: boolean;
}
export interface TeamRosterEntry {
  person: TeamPerson;
  statement?: string;
  onRemove?: () => void;
  removeLabel?: string;
  removeDisabled?: boolean;
}

/** Responsibility statements and one removable membership per person. */
export function TeamRoster({ entries }: Readonly<{ entries: readonly TeamRosterEntry[] }>) {
  return (
    <ul className="flex flex-col py-1">
      {entries.map(({ person, statement, onRemove, removeLabel, removeDisabled }) => (
        <li
          key={`${person.id}:${statement ?? "membership"}`}
          className={`flex items-center gap-2.5 px-4 py-2.5 ${person.archived ? "opacity-50" : ""}`}
        >
          <Avatar name={person.displayName} image={person.image} className="size-6" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {statement && <span className="text-xs text-muted">{statement}</span>}
            <span className="truncate text-base font-medium" title={person.displayName}>
              {person.displayName}
            </span>
          </div>
          {onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={removeDisabled}
              aria-label={removeLabel}
              title={removeLabel}
              onClick={onRemove}
            >
              <X size={16} aria-hidden="true" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
