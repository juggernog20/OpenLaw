// SPDX-License-Identifier: AGPL-3.0-only

import { FormattedMessage, type MessageDescriptor } from "react-intl";
import { cn } from "../lib/utils";

/**
 * MTR-015's title-free, non-navigable placeholder for a restricted record.
 *
 * It renders the block element the card's list expects (`li` in a list,
 * `p` in a single-record card), so the row keeps the same line box and
 * padding as its unrestricted siblings. The label is the caller's copy;
 * this cell adds no words of its own.
 */
export function RestrictedRecordCell({
  label,
  as: Tag = "p",
  className,
}: Readonly<{ label: MessageDescriptor; as?: "p" | "li"; className?: string }>) {
  return (
    <Tag className={cn("text-sm text-muted", className)}>
      <FormattedMessage {...label} />
    </Tag>
  );
}
