// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The "Before you submit" panel (INT-004), from the DeflectPanel frame
 * of I5 in intake.pen: a card carrying the Administrator's deflection
 * links, there to answer a question before it becomes a Request.
 *
 * A component rather than markup inside the portal home, because the
 * panel has two mounts: the home draws the links placed on the home,
 * and each request type's form draws that type's own (INT-004). The
 * placement is decided by whoever reads the links; the panel only draws
 * what it is handed, and draws nothing at all when handed nothing.
 *
 * **The label is what a requester reads; the stored URL is where they
 * go.** Nothing normalizes the address. The Administrator pasted it
 * from somewhere that works. The domain shown under an external label
 * is a reading aid, cut from the same string; what the anchor follows
 * is the string itself.
 *
 * ### Recorded normalization points (I5 deviations accepted)
 *
 * 1. I5 draws a 14px `info` glyph in the head and a 13px glyph on each
 *    row. Both render at 16px, DES-008's inline size. The ramp has no
 *    13 and no 14, and a panel is not the place to open one.
 * 2. I5 washes the whole panel in the information pair. It renders on
 *    the card surface instead: a persistent list of reading is not an
 *    alert, and a page that wears a status colour for something that is
 *    always there has nothing left for the moment something happens.
 * 3. I5 varies the per-row glyph by hand. The glyph follows the
 *    target, DES-068's rule: a Knowledge Item wears the book and opens
 *    in this tab; an external address wears the external-link glyph,
 *    shows its domain, and opens beside the portal.
 */

import { useId } from "react";
import { FormattedMessage } from "react-intl";
import { Link } from "react-router";
import { BookOpen, ExternalLink, Lightbulb } from "lucide-react";

/** One deflection link, as GET /portal/intake-links answers it. */
export interface DeflectionLink {
  id: string;
  label: string;
  /** Exactly one target is present. */
  url?: string;
  knowledgeItemId?: string;
}

/** The host of an external address, for the line under its label. A
 * string that does not parse as a URL shows nothing rather than a
 * guess: the anchor still follows it exactly as stored. */
function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const ROW_LINK_CLASS =
  "flex min-w-0 flex-1 flex-col gap-0.5 rounded-chip text-sm font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link";

export function DeflectionPanel({ links }: Readonly<{ links: readonly DeflectionLink[] }>) {
  // Generated rather than written. The portal home draws one panel and
  // each request type's form draws another, and a hand-picked id would
  // be one edit away from naming both.
  const headingId = useId();

  // A row that answers neither target has nothing to open; rendering
  // an anchor with no href would put a dead, focusable-looking item in
  // the list, so such a row is dropped rather than drawn.
  const reachable = links.filter((link) => link.knowledgeItemId || link.url);

  // An instance whose Administrator has configured no links draws no
  // panel. An empty "Before you submit" heading deflects nobody.
  if (reachable.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <div className="flex h-section-header items-center gap-2 border-b border-border-default bg-section-header px-4">
        <Lightbulb aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <h2 id={headingId} className="text-base font-semibold">
          <FormattedMessage id="portal.deflection.heading" defaultMessage="Before you submit" />
        </h2>
      </div>
      <ul className="divide-y divide-border-muted">
        {reachable.map((link) => (
          <li key={link.id} className="flex items-start gap-2.5 px-4 py-2.5">
            {link.knowledgeItemId ? (
              <>
                <BookOpen aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
                <Link to={`/portal/knowledge/${link.knowledgeItemId}`} className={ROW_LINK_CLASS}>
                  {link.label}
                </Link>
              </>
            ) : link.url ? (
              <>
                <ExternalLink aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <a
                    href={link.url}
                    // A deflection link leaves OpenLaw for a wiki or a
                    // policy page. It opens beside the portal rather than
                    // over it, so that reading the answer never costs a
                    // requester the form they were part-way through;
                    // `noreferrer` keeps the portal's address out of the
                    // destination's logs.
                    target="_blank"
                    rel="noreferrer"
                    className={ROW_LINK_CLASS}
                  >
                    {link.label}
                    {/* The new tab, said out loud. A sighted requester
                        sees the switch happen and a screen-reader user
                        does not. */}{" "}
                    <span className="sr-only">
                      <FormattedMessage
                        id="portal.deflection.newTab"
                        defaultMessage="(opens in a new tab)"
                      />
                    </span>
                  </a>
                  {/* Beside the anchor, not inside it: the link's name
                      stays the label the Administrator wrote. */}
                  {domainOf(link.url) !== null && (
                    <span aria-hidden="true" className="truncate text-xs text-muted">
                      {domainOf(link.url)}
                    </span>
                  )}
                </span>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
