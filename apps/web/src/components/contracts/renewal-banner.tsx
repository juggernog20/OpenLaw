// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DES-043: the record page's "renewal pending confirmation" banner,
 * drawn as `S9 RenewBanner` in the C9 frame of `designs/contracts.pen`
 * — the same 36px strip between the top nav and the record sub-bar that
 * DES-009 puts the confidentiality statement in.
 *
 * **It is a reading of the record, not a notification and not a
 * status.** CTR-006's engine is notify-only: nothing advances a term on
 * its own, so an auto-renewing contract that passed its expiry
 * un-actioned says so and waits for a person. The state behind this
 * strip is a predicate over the record's own dates and today — no
 * column, no job, no scheduled sweep — so the banner appears because
 * the record read says so and goes the moment the expiry advances or
 * the term is re-typed. The contract's status and stage are untouched
 * by it, which is why nothing here draws a pill.
 *
 * **It is chrome, and there is no dismiss.** The component takes no
 * such prop, so a caller cannot add one — the same rule the
 * confidentiality banner is built on, for the same failure: a banner
 * that can be closed is a banner that is closed, and the missed
 * auto-renewal is the failure this whole milestone exists to stop.
 *
 * The trailing call to action is the one part that varies. Only a
 * Member+ viewer who may write the record is offered a way to the Renew
 * dialog; everybody else reads the statement and nothing more. The
 * caller decides — it is the page that knows where this viewer stands
 * — and the API is the real guard either way.
 */

import { RotateCw } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";

/** The banner's glyph, at DES-008's inline size — the size DES-009
 * already names for this strip, and a 36px strip has the room. */
const GLYPH_SIZE = 16;

export function RenewalBanner({
  onReview,
}: Readonly<{
  /** Opens the Renew dialog, for a viewer who may confirm the roll.
   * Absent for everyone else, so no control is rendered at all — an
   * affordance nobody may use is worse than none (DES-035 clause 9). */
  onReview?: () => void;
}>) {
  const intl = useIntl();
  return (
    // A named region, so the statement is reachable from the landmark
    // list after half an hour inside the record — the same persistence
    // the strip gives a sighted reader.
    <section
      aria-label={intl.formatMessage({
        id: "contracts.renewal.bannerRegion",
        defaultMessage: "Renewal pending confirmation",
      })}
      className="flex h-(--height-record-banner) shrink-0 items-center justify-between gap-4 border-b border-border-default bg-status-warning-bg px-page-x text-status-warning-fg"
    >
      <p className="flex min-w-0 items-center gap-2">
        <RotateCw size={GLYPH_SIZE} aria-hidden="true" className="shrink-0" />
        <span className="truncate text-sm font-medium">
          <FormattedMessage
            id="contracts.renewal.banner"
            defaultMessage="Renewal date passed — pending confirmation. The term does not advance until a human confirms."
          />
        </span>
      </p>
      {onReview !== undefined && (
        // A button rather than the confidentiality banner's anchor: the
        // act is raised here rather than somewhere else on the page,
        // and a link to nowhere would be a lie about what pressing it
        // does. `text-status-warning-fg` is restated because the base
        // layer colours controls from its own tokens, which would
        // otherwise win over the strip's foreground.
        <button
          type="button"
          onClick={onReview}
          className="shrink-0 rounded-chip text-sm font-semibold text-status-warning-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          <FormattedMessage id="contracts.renewal.review" defaultMessage="Review renewal" />
        </button>
      )}
    </section>
  );
}
