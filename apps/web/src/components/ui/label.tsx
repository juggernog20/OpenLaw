// SPDX-License-Identifier: AGPL-3.0-only

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "../../lib/utils";

export function Label({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  // 12px medium, per the C10 field-label pattern in contracts.pen.
  return (
    <LabelPrimitive.Root className={cn("text-sm font-medium text-primary", className)} {...props} />
  );
}
