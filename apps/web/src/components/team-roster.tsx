// SPDX-License-Identifier: AGPL-3.0-only

import { X } from "lucide-react";
import { Avatar } from "./avatar";
import { Button } from "./ui/button";

interface TeamPerson {
  id: string;
  displayName: string;
  image: string | null;
  archived: boolean;
}
interface TeamRoleTag {
  id: string;
  label: string;
  onRemove?: () => void;
  removeLabel?: string;
  removeDisabled?: boolean;
}
export interface TeamRosterEntry {
  person: TeamPerson;
  role: TeamRoleTag;
}

/** One person can hold several roles; removing a tag removes only that role. */
export function TeamRoster({ entries }: Readonly<{ entries: readonly TeamRosterEntry[] }>) {
  const people = new Map<string, { person: TeamPerson; roles: Map<string, TeamRoleTag> }>();
  for (const { person, role } of entries) {
    let row = people.get(person.id);
    if (!row) {
      row = { person, roles: new Map() };
      people.set(person.id, row);
    }
    row.roles.set(role.id, role);
  }
  return (
    <ul className="flex flex-col py-1">
      {[...people.values()].map(({ person, roles }) => (
        <li
          key={person.id}
          className={`flex items-start gap-2.5 px-4 py-2.5 ${person.archived ? "opacity-50" : ""}`}
        >
          <Avatar name={person.displayName} image={person.image} className="mt-0.5 size-6" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="truncate text-base font-medium" title={person.displayName}>
              {person.displayName}
            </span>
            <div className="flex flex-wrap gap-1">
              {[...roles.values()].map((role) => (
                <span
                  key={role.id}
                  className="inline-flex min-h-6 items-center rounded-chip border border-border-default bg-control ps-2 text-xs text-muted"
                >
                  <span className={role.onRemove ? "" : "pe-2"}>{role.label}</span>
                  {role.onRemove && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ms-0.5"
                      disabled={role.removeDisabled}
                      aria-label={role.removeLabel}
                      title={role.removeLabel}
                      onClick={role.onRemove}
                    >
                      <X size={12} aria-hidden="true" />
                    </Button>
                  )}
                </span>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
