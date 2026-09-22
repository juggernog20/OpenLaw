// SPDX-License-Identifier: AGPL-3.0-only

/** One way to show a file the reader has not opened yet: a square card
 * with the format badge, the name under it, and one action in the
 * corner. The Request form, the Convert dialog and the Portal upload
 * dialog all draw a chosen file this way, so a file looks the same
 * wherever it is picked, staged or carried in. */

import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { FileTypeIcon } from "./file-type-icon";

export function FileTileGrid({
  children,
  className,
  ...rest
}: Readonly<{ children: ReactNode } & React.ComponentProps<"ul">>) {
  return (
    <ul
      {...rest}
      className={cn(
        "grid w-full grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3",
        className,
      )}
    >
      {children}
    </ul>
  );
}

export function FileTile({
  filename,
  caption,
  action,
  status,
}: Readonly<{
  filename: string;
  /** One short line under the name, such as the file size. */
  caption?: ReactNode;
  /** The corner control: remove the file, or download it. */
  action?: ReactNode;
  /** What happened to the file, said after the caption. */
  status?: ReactNode;
}>) {
  return (
    <li className="relative flex aspect-square min-w-0 flex-col items-center justify-between gap-1 rounded-card border border-border-default bg-raised p-2.5 text-center shadow-sm">
      {action}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <FileTypeIcon filename={filename} />
      </div>
      <div className="flex w-full min-w-0 shrink-0 flex-col gap-1">
        <span
          title={filename}
          className="line-clamp-2 break-words text-sm font-medium leading-4 text-primary"
        >
          {filename}
        </span>
        {caption && <span className="text-xs text-muted">{caption}</span>}
        {status}
      </div>
    </li>
  );
}

/** The corner control's place on a tile. */
export const TILE_ACTION_CLASS = "absolute top-1 end-1 size-6 rounded-full bg-raised";
