// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DES-009 Tier 1: the inline marker, and its micro variant.
 *
 * Tier 2 is the banner on the record page, and it only works while the
 * reader is on that page. Tier 1 carries the restriction everywhere
 * else: a Contract title in a list of thirty, or a comment or activity
 * entry somebody is about to copy out of the panel.
 *
 * Two variants, one glyph. The inline variant is the `Lock` and the
 * literal "CONFI", beside a Contract title drawn outside the record's
 * own page. The micro variant is the lock alone, beside the timestamp on
 * every comment and activity entry inside a confidential record, so a
 * copied snippet visually carries its restriction.
 *
 * The marker is never a placeholder. It is drawn only for a viewer who
 * already reaches the record. A viewer who does not gets no row at all,
 * because the API answered them none (DD-014, CTR-021). Nothing here
 * takes a "hidden" state, so no caller can turn it into one.
 *
 * The two variants differ in what they say out loud. The inline one has
 * an accessible name, because a list row has no other statement of the
 * restriction. The micro one is decorative. It lives inside a record
 * whose banner is a labelled landmark saying the same thing, and
 * "Confidential" on thirty consecutive rows is noise, not information.
 */

import { Lock } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { cn } from "../lib/utils";

/** DES-009's own size for this glyph (12 to 14px), not DES-008's
 * 16/20/24 ramp. Beside an 11px label and inside a table row, a 16px
 * lock is taller than the text it marks. The tier badges take the same
 * carve-out (DES-023). */
const LOCK_SIZE = 12;

export function ConfidentialMarker({
  variant = "inline",
  className,
}: Readonly<{
  /** `inline` beside a title outside the record page; `micro` beside a
   * timestamp inside the record. */
  variant?: "inline" | "micro";
  className?: string;
}>) {
  const intl = useIntl();
  /** The word the marker abbreviates. "CONFI" is drawn, not spoken.
   * Read letter by letter it says nothing. */
  const spoken = intl.formatMessage({
    id: "confidential.marker",
    defaultMessage: "Confidential",
  });
  if (variant === "micro") {
    return (
      <Lock
        size={LOCK_SIZE}
        aria-hidden="true"
        className={cn("shrink-0 text-confidential", className)}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={spoken}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-confidential",
        className,
      )}
    >
      <Lock size={LOCK_SIZE} aria-hidden="true" />
      {/* DES-009's literal label, at the letter-spacing it names. Five
          uppercase letters need the extra track to stay legible at 11px.
          It is a message rather than a literal because it abbreviates a
          word, and another locale abbreviates its own word its own way
          (DES-013). */}
      <span aria-hidden="true" className="uppercase tracking-[0.4px]">
        <FormattedMessage id="confidential.markerShort" defaultMessage="CONFI" />
      </span>
    </span>
  );
}
