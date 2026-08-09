// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Alert (DES-005: status colors as paired bg+fg, never mixed across
 * families).
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const alertVariants = cva("rounded-card px-3 py-2 text-md", {
  variants: {
    variant: {
      danger: "bg-status-danger-bg text-status-danger-fg",
      info: "bg-status-info-bg text-status-info-fg",
      success: "bg-status-success-bg text-status-success-fg",
    },
  },
  defaultVariants: {
    variant: "info",
  },
});

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
