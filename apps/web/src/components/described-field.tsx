// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentPropsWithoutRef } from "react";
import { Tooltip } from "./ui/tooltip";

/** Saved Field descriptions stay available to assistive technology while the
 * shared tooltip reveals them on hover or focus anywhere in the field row. */
export function DescribedField({
  description,
  descriptionId,
  children,
  ...props
}: Readonly<
  ComponentPropsWithoutRef<"div"> & {
    description?: string | null;
    descriptionId: string;
  }
>) {
  const row = (
    <div {...props} aria-describedby={description ? descriptionId : undefined}>
      {children}
      {description && (
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      )}
    </div>
  );
  return description?.trim() ? (
    <Tooltip content={description} className="whitespace-pre-wrap break-words">
      {row}
    </Tooltip>
  ) : (
    row
  );
}
