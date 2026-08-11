// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A person's avatar, name, and email as one unit — with the SET-005
 * archived treatment built in. Archived people render greyed out on
 * every surface that shows them; this component IS that treatment, so
 * later surfaces (pickers, comments, activity) inherit it by rendering
 * people through here rather than re-deciding the styling.
 */

import { cn } from "../lib/utils";
import { initialsOf } from "./avatar";

export function UserIdentity({
  displayName,
  email,
  archived,
}: {
  displayName: string;
  /** Omitted on compact surfaces that show the name alone. */
  email?: string;
  archived?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", archived && "opacity-50")}>
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-control text-xs font-semibold text-primary"
      >
        {initialsOf(displayName)}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-medium whitespace-nowrap">{displayName}</span>
        {email && <span className="text-sm whitespace-nowrap text-muted">{email}</span>}
      </div>
    </div>
  );
}
