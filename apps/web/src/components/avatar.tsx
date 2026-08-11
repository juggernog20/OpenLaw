// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Avatar (DES-018): the uploaded photo when one exists, otherwise
 * initials on the uniform light-blue avatar background — every person
 * gets the same treatment; per-person hue hashing is rejected. Weight
 * is the recorded normalization point: the mocks show 700, the type
 * ramp caps at semibold 600.
 */

import { cn } from "../lib/utils";

/** First letters of the first and last words: "Blair Wentworth" → "BW". */
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const last = (words.length > 1 ? words[words.length - 1]?.[0] : undefined) ?? "";
  return (first + last).toUpperCase();
}

export function Avatar({
  name,
  image,
  className,
}: {
  name: string;
  /** Photo as a data: URI (self-uploaded) or URL (IdP-written). */
  image?: string | null;
  className?: string;
}) {
  if (image) {
    return (
      <img
        src={image}
        alt=""
        aria-hidden="true"
        className={cn("size-8 shrink-0 rounded-avatar object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-avatar bg-avatar-bg text-xs font-semibold text-avatar-fg",
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
