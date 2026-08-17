// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Popover (DES-004: shadcn-shaped, owned source, semantic tokens only).
 * Radix supplies the behavior — anchoring, the focus trap, `Esc` to
 * dismiss (DES-010), and returning focus to the trigger on close.
 *
 * It is a **panel**, not a menu, and that is the whole reason it exists
 * beside `dropdown-menu.tsx`. A menu's contents are a list of commands
 * with roving focus, and every one of them closes the menu when it is
 * chosen. The notification centre is a list with a paging control in its
 * foot and a command in its head: pressing "Show older" has to leave the
 * panel open and tab has to walk the items, which is what a panel does
 * and a menu cannot.
 *
 * The surface is card chrome — `bg-raised` with the default border —
 * matching the dropdown's, so the two read as one family in the header.
 */

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "../../lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({
  className,
  align = "end",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-card border border-border-default bg-raised text-base text-primary shadow-md",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
