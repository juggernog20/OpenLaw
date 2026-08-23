// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DES-009 Tier 2: the record page's confidentiality banner, drawn as
 * `S8 ConfBanner` in the C8 frame of `designs/contracts.pen` — a 36px
 * strip between the top nav and the record sub-bar.
 *
 * It is **chrome, not a notification**. There is no dismiss, no close,
 * and no state that could hide it: the component takes no such prop, so
 * a caller cannot add one. DD-014's failure mode is the person who has
 * been heads-down for half an hour and reaches for the screenshot
 * button, and a banner that can be closed is a banner that is closed.
 *
 * The trailing link is the one part that varies. Only the people who
 * may change the audience are offered a way to it (DD-014, CTR-022:
 * Administrators, the record's creator, and its Owner); everyone else
 * reads the statement and nothing more. The caller decides — it is the
 * page that knows where this viewer stands on this record, and the API
 * is the real guard either way.
 */

import { ArrowRight, Lock } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";

/** The banner's glyph, at DES-008's inline size — the one size DES-009
 * names for this surface. The 12px carve-out is for the badges and the
 * inline marker, where a 16px lock is taller than the text it marks;
 * a 36px strip has the room. */
const LOCK_SIZE = 16;

export function ConfidentialBanner({
  manageTeamHref,
}: Readonly<{
  /** Where "Manage team" goes, for a viewer who may change the
   * audience. Absent for everyone else, so the link is not rendered at
   * all — an affordance nobody may use is worse than none. */
  manageTeamHref?: string;
}>) {
  const intl = useIntl();
  return (
    // A named region, so the statement is reachable from the landmark
    // list after half an hour inside the record — the same persistence
    // the strip gives a sighted reader.
    <section
      aria-label={intl.formatMessage({
        id: "contracts.confidential.bannerRegion",
        defaultMessage: "Confidential contract",
      })}
      className="flex h-(--height-record-banner) shrink-0 items-center justify-between gap-4 border-b border-border-default bg-confidential-bg px-page-x text-confidential"
    >
      <p className="flex min-w-0 items-center gap-2">
        <Lock size={LOCK_SIZE} aria-hidden="true" className="shrink-0" />
        <span className="truncate text-sm font-medium">
          <FormattedMessage
            id="contracts.confidential.banner"
            defaultMessage="Confidential contract — the contract team, the Owner, and Administrators see it."
          />
        </span>
      </p>
      {manageTeamHref !== undefined && (
        // `text-confidential` is restated on the anchor because the base
        // layer colours every `<a>` with the link token, which would
        // otherwise win over the strip's own foreground. DES-028 puts
        // the trailing link on the banner's pair, and that is the pair
        // the contrast lint checks against `confidential-bg` — the link
        // token on this surface is 4.34:1, under the 4.5 floor.
        <a
          href={manageTeamHref}
          className="flex shrink-0 items-center gap-1 rounded-chip text-sm font-semibold text-confidential hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          <FormattedMessage id="contracts.confidential.manageTeam" defaultMessage="Manage team" />
          <ArrowRight size={LOCK_SIZE} aria-hidden="true" />
        </a>
      )}
    </section>
  );
}
