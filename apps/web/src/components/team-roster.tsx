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

/** One row per person, with responsibility statements and a membership action. */
export function TeamRoster({ entries }: Readonly<{ entries: readonly TeamRosterEntry[] }>) {
  const people = new Map<string, Omit<TeamRosterEntry, "statement"> & { statements: string[] }>();
  for (const { statement, ...entry } of entries) {
    let row = people.get(entry.person.id);
    if (!row) {
      row = { ...entry, statements: [] };
      people.set(entry.person.id, row);
    }
    if (statement && !row.statements.includes(statement)) row.statements.push(statement);
    if (entry.onRemove) {
      row.onRemove = entry.onRemove;
      row.removeLabel = entry.removeLabel;
      row.removeDisabled = entry.removeDisabled;
    }
  }
  return (
    <ul className="flex flex-col py-1">
      {[...people.values()].map(({ person, statements, onRemove, removeLabel, removeDisabled }) => (
        <li
          key={person.id}
          className={`flex items-center gap-2.5 px-4 py-2.5 ${person.archived ? "opacity-50" : ""}`}
        >
          <Avatar name={person.displayName} image={person.image} className="size-6" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {statements.length > 0 && (
              <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted">
                {statements.map((statement) => (
                  <span key={statement}>{statement}</span>
                ))}
              </div>
            )}
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
