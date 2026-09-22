// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Label (DES-004: shadcn-shaped, owned source) over the Radix primitive,
 * which supplies the htmlFor/id association the field pattern depends on.
 * 12px medium, per the C10 field-label pattern in contracts.pen.
 */

import * as LabelPrimitive from "@radix-ui/react-label";
import * as React from "react";
import { cn } from "../../lib/utils";
import { FieldHelp } from "./field-help";

export function Label({
  className,
  children,
  required = false,
  help,
  helpId,
  ...props
}: Readonly<
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & {
    required?: boolean;
    help?: React.ReactNode;
    helpId?: string;
  }
>) {
  const generatedId = React.useId();
  const labelId = props.id ?? generatedId;
  const label = (
    <LabelPrimitive.Root
      className={cn("text-sm font-medium text-primary", className)}
      {...props}
      id={labelId}
    >
      {children}
      {required && (
        <span aria-hidden="true" className="ms-0.5 text-status-danger-fg">
          *
        </span>
      )}
    </LabelPrimitive.Root>
  );
  if (!help) return label;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 self-start">
      {label}
      <FieldHelp labelId={labelId} descriptionId={helpId}>
        {help}
      </FieldHelp>
    </span>
  );
}
