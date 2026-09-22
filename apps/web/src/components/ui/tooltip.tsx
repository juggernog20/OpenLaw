// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A short explanation that appears when the pointer rests on a control
 * or keyboard focus reaches it (DES-090 point 6: a disabled reason must
 * be available on focus, not hover alone). Radix Tooltip handles the
 * open delay, the portal and the escape key. The content is text, so
 * it closes as soon as the pointer leaves the control. Styled like the
 * dropdown menu so the two float the same way.
 *
 * Radix describes the trigger with the tooltip only while it is open.
 * A caller that needs the text as the control's accessible description
 * at rest keeps its own `sr-only` span and `aria-describedby`, which
 * wins over the one Radix would set.
 */

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../../lib/utils";

export function Tooltip({
  content,
  children,
  className,
  side = "top",
}: Readonly<{
  content: React.ReactNode;
  /** One element that accepts a ref and pointer/focus handlers. */
  children: React.ReactElement;
  className?: string;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
}>) {
  return (
    <TooltipPrimitive.Provider delayDuration={300} disableHoverableContent>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className={cn(
              "z-50 max-w-64 rounded-card border border-border-default bg-raised px-2 py-1 text-xs text-primary shadow-md",
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
