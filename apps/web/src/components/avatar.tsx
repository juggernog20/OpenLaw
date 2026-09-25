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
  const last = (words.length > 1 ? words.at(-1)?.[0] : undefined) ?? "";
  return (first + last).toUpperCase();
}

/**
 * The glyph for an MCP Client (DES-092): two letters, so "Claude" and
 * "Claude Desktop" both fill the square. The consent page and the
 * Connected Clients card draw the same Client, so they share the rule.
 */
export function clientInitials(name: string): string {
  const trimmed = name.trim();
  return trimmed.includes(" ") ? initialsOf(trimmed) : trimmed.slice(0, 2).toUpperCase();
}

export function Avatar({
  name,
  image,
  className,
}: Readonly<{
  name: string;
  /** Photo as a data: URI (self-uploaded) or URL (IdP-written). */
  image?: string | null;
  className?: string;
}>) {
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
        "flex size-8 shrink-0 items-center justify-center rounded-avatar bg-avatar-bg text-xs leading-none font-semibold text-avatar-fg",
        className,
      )}
    >
      <span className="[text-box-edge:cap_alphabetic] [text-box-trim:trim-both]">
        {initialsOf(name)}
      </span>
    </span>
  );
}
