// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A person's avatar, name, and email as one unit — with the SET-005
 * archived treatment built in. Archived people render greyed out on
 * every surface that shows them; this component IS that treatment, so
 * later surfaces (pickers, comments, activity) inherit it by rendering
 * people through here rather than re-deciding the styling.
 */

import { cn } from "../lib/utils";
import { Avatar } from "./avatar";

export function UserIdentity({
  displayName,
  email,
  image,
  archived,
}: {
  displayName: string;
  /** Omitted on compact surfaces that show the name alone. */
  email?: string;
  /** Photo as a data: URI or URL; omitted where the API sends none. */
  image?: string | null;
  archived?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", archived && "opacity-50")}>
      {/* One avatar treatment everywhere (DES-018): render through
          Avatar, never a re-styled copy of its initials branch. */}
      <Avatar name={displayName} image={image} className="size-7" />
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-medium whitespace-nowrap">{displayName}</span>
        {email && <span className="text-sm whitespace-nowrap text-muted">{email}</span>}
      </div>
    </div>
  );
}
