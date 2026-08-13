// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DES-009 Tier 1: the inline marker, and its micro variant.
 *
 * Tier 2 is the banner on the record page, and it only works while the
 * reader is on the record page. Tier 1 is what carries the restriction
 * everywhere else — a contract title in a list of thirty, and a comment
 * or an activity entry that somebody is about to copy out of the panel.
 *
 * Two variants, one glyph. The **inline** variant is the `Lock` and the
 * literal "CONFI", and it rides beside a contract title rendered outside
 * the record's own page. The **micro** variant is the lock alone, and it
 * rides beside the timestamp on every comment and every activity entry
 * inside a confidential record, so a copied snippet visually carries its
 * restriction.
 *
 * The marker is never a placeholder. It is drawn only for a viewer who
 * already reaches the record; a viewer who does not gets no row at all,
 * because the API answered them none (DD-014, CTR-021). Nothing here
 * takes a "hidden" state, so no caller can turn it into one.
 *
 * The two variants differ in what they say out loud. The inline one
 * carries an accessible name, because a list row has no other statement
 * of the restriction. The micro one is decorative: it lives inside a
 * record whose banner is a labelled landmark saying the same thing, and
 * repeating "Confidential" on thirty consecutive rows is noise rather
 * than information.
 */

import { Lock } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { cn } from "../lib/utils";

/** DES-009's own size for this glyph (12–14px), not DES-008's 16/20/24
 * ramp: beside an 11px label and inside a table row, a 16px lock is
 * taller than the text it marks. The same carve-out the tier badges
 * already take (DES-023). */
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
  /** The word the marker abbreviates. "CONFI" is drawn, not spoken:
   * read letter by letter it says nothing. */
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
      {/* DES-009's literal label, at the letter-spacing it names —
          uppercase five letters need the extra track to stay legible at
          11px. It is a message rather than a literal because it is an
          abbreviation of a word, and another locale abbreviates its own
          word its own way (DES-013). */}
      <span aria-hidden="true" className="uppercase tracking-[0.4px]">
        <FormattedMessage id="confidential.markerShort" defaultMessage="CONFI" />
      </span>
    </span>
  );
}
