// SPDX-License-Identifier: AGPL-3.0-only

import { X } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { roleLabel, type Role } from "../lib/roles";
import { cn } from "../lib/utils";
import { Avatar } from "./avatar";
import { Button } from "./ui/button";

export interface TeamPerson {
  id: string;
  displayName: string;
  image: string | null;
  archived: boolean;
  /** The account type, where the caller knows it. Only a Business User
   * gets a statement for it. */
  role?: Role;
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
  const intl = useIntl();
  const people = new Map<string, Omit<TeamRosterEntry, "statement"> & { statements: string[] }>();
  for (const { statement, ...entry } of entries) {
    let row = people.get(entry.person.id);
    if (!row) {
      row = { ...entry, statements: [] };
      people.set(entry.person.id, row);
    }
    if (statement && !row.statements.includes(statement)) row.statements.push(statement);
    if (entry.person.role && !row.person.role) row.person = entry.person;
    if (entry.onRemove) {
      row.onRemove = entry.onRemove;
      row.removeLabel = entry.removeLabel;
      row.removeDisabled = entry.removeDisabled;
    }
  }
  // The account type is a fact about access, not a team tag. A Business
  // User reaches the record in the Portal, so the roster says so. Legal
  // rows carry no role statement.
  for (const row of people.values())
    if (row.person.role === "business_user") {
      const label = roleLabel(intl, "business_user");
      if (!row.statements.includes(label)) row.statements.push(label);
    }
  return (
    <ul className="flex flex-col py-1">
      {[...people.values()].map(({ person, statements, onRemove, removeLabel, removeDisabled }) => (
        <li
          key={person.id}
          // SET-005: an archived person stays on the team, greyed out and
          // marked as gone, so nobody sends them work they will not see.
          className={cn(
            "flex items-center gap-2.5 px-4 py-2.5",
            person.archived ? "text-muted" : "text-primary",
          )}
        >
          <Avatar name={person.displayName} image={person.image} className="size-6" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {statements.length > 0 && (
              <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
                {statements.map((statement) => (
                  <span key={statement}>{statement}</span>
                ))}
              </div>
            )}
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-base font-medium" title={person.displayName}>
                {person.displayName}
              </span>
              {person.archived && (
                <span className="inline-flex shrink-0 rounded-pill bg-status-neutral-bg px-2 py-0.5 text-xs font-medium text-status-neutral-fg">
                  <FormattedMessage id="teamRoster.archived" defaultMessage="Archived" />
                </span>
              )}
            </div>
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
