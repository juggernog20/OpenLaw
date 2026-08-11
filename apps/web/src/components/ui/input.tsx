// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Input, per the C10 form-field pattern in contracts.pen: raised
 * surface (bg-control is for secondary buttons and the header search
 * per DES-005, not form fields), 32px tall, 10px inset, 12px text with
 * a muted placeholder. Focus ring matches the Button's Primer-shaped
 * convention.
 */

import * as React from "react";
import { cn } from "../../lib/utils";

export function Input({
  className,
  type,
  ...props
}: Readonly<React.InputHTMLAttributes<HTMLInputElement>>) {
  return (
    <input
      type={type}
      className={cn(
        "h-8 w-full rounded-button border border-border-default bg-raised px-2.5 text-sm text-primary placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
