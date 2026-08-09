// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Initials avatar (DES-018): every person gets the same treatment —
 * initials on the uniform light-blue avatar background. Per-person hue
 * hashing is rejected. Weight is the recorded normalization point: the
 * mocks show 700, the type ramp caps at semibold 600.
 */

import { cn } from "../lib/utils";

/** First letters of the first and last words: "Blair Wentworth" → "BW". */
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const last = (words.length > 1 ? words[words.length - 1]?.[0] : undefined) ?? "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, className }: { name: string; className?: string }) {
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
