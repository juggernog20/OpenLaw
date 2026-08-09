// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Label (DES-004: shadcn-shaped, owned source) over the Radix primitive,
 * which supplies the htmlFor/id association the field pattern depends on.
 * 12px medium, per the C10 field-label pattern in contracts.pen.
 */

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "../../lib/utils";

export function Label({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root className={cn("text-sm font-medium text-primary", className)} {...props} />
  );
}
