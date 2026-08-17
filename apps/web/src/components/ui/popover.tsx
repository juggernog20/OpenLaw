// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Popover (DES-004: shadcn-shaped, owned source, semantic tokens
 * only). Radix supplies positioning, focus, Esc dismissal, and focus
 * restoration; only the parts the app uses are kept. The surface
 * matches the dropdown: bg-raised with the default border. No enter
 * animation — DES-003 caps motion at hover/focus, ≤200ms.
 */

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "../../lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-card border border-border-default bg-raised p-2 text-base text-primary shadow-md outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
