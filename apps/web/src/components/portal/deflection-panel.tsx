// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The "Before you submit…" panel (INT-004), from the DeflectPanel frame
 * of I5 in intake.pen: an information-toned card carrying the
 * Administrator's deflection links, there to answer a question before
 * it becomes a Request.
 *
 * A component rather than markup inside the portal home, because the
 * panel has two mounts: the home draws the links placed on the home,
 * and each request type's form draws that type's own (INT-004). The
 * placement is decided by whoever reads the links; the panel only draws
 * what it is handed, and draws nothing at all when handed nothing.
 *
 * **The label is what a requester reads; the stored URL is where they
 * go.** Nothing normalizes the address — the Administrator pasted it
 * from somewhere that works — and the settings pane's schemeless
 * rendering is a fact about that pane, not about this one, which shows
 * no address at all.
 *
 * ### Recorded normalization points (I5 deviations accepted)
 *
 * 1. I5 draws a 14px `info` glyph in the head and a 13px glyph on each
 *    row. Both render at 16px, DES-008's inline size — the ramp has no
 *    13 and no 14, and a panel is not the place to open one.
 * 2. I5 varies the per-row glyph (`file-text`, `circle-help`, `link`).
 *    `intake_links` holds a label, a URL, and a placement, and INT-004
 *    gave a link no icon, so every row wears the one `link` glyph.
 */

import { useId } from "react";
import { FormattedMessage } from "react-intl";
import { Info, Link as LinkIcon } from "lucide-react";

/** One deflection link, as GET /portal/intake-links answers it. */
export interface DeflectionLink {
  id: string;
  label: string;
  /** Absolute http/https, exactly as stored (INT-004). */
  url: string;
}

export function DeflectionPanel({ links }: Readonly<{ links: readonly DeflectionLink[] }>) {
  // Generated rather than written: the portal home draws one panel and
  // each request type's form draws another, and a hand-picked id would
  // be one edit away from naming both.
  const headingId = useId();

  // An instance whose Administrator has configured no links draws no
  // panel: an empty "Before you submit…" heading deflects nobody.
  if (links.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2.5 rounded-card bg-status-info-bg p-4 text-status-info-fg"
    >
      <h2 id={headingId} className="flex items-center gap-1.5 text-base font-semibold">
        <Info aria-hidden="true" className="size-4 shrink-0" />
        <FormattedMessage id="portal.deflection.heading" defaultMessage="Before you submit" />
      </h2>
      <ul className="flex flex-col gap-1.5">
        {links.map((link) => (
          <li key={link.id}>
            <a
              href={link.url}
              // A deflection link leaves OpenLaw for a wiki or a policy
              // page. It opens beside the portal rather than over it, so
              // that reading the answer never costs a requester the form
              // they were part-way through; `noreferrer` keeps the
              // portal's address out of the destination's logs.
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-chip text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            >
              <LinkIcon aria-hidden="true" className="size-4 shrink-0" />
              {link.label}
              {/* The new tab, said out loud: a sighted requester sees
                  the switch happen and a screen-reader user does not. */}{" "}
              <span className="sr-only">
                <FormattedMessage
                  id="portal.deflection.newTab"
                  defaultMessage="(opens in a new tab)"
                />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
