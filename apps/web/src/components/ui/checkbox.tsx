// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Checkbox (DES-004: shadcn-shaped, owned source, semantic tokens
 * only). Radix supplies behavior and the checkbox role. The 16px box
 * matches the ST16 required cell: CTA-filled with the check when on,
 * raised with the default border when off. The ::before inset expands
 * the hit area to DES-011's 24px floor without growing the drawn box.
 */

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "relative flex size-4 shrink-0 items-center justify-center rounded-chip border border-border-default bg-raised transition-colors duration-150 before:absolute before:-inset-1 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-transparent data-[state=checked]:bg-cta-primary data-[state=checked]:text-on-cta",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {/* 12px inside the 16px box — control-internal, not a DES-008
            standalone icon, mirroring the mock's proportions. */}
        <Check size={12} strokeWidth={3} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
