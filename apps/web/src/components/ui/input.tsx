// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Input (DES-004/DES-005: bg-control surface tier, semantic tokens).
 * Focus ring matches the Button's Primer-shaped convention.
 */

import * as React from "react";
import { cn } from "../../lib/utils";

export function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "h-8 w-full rounded-button border border-border-default bg-control px-3 text-md text-primary placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
