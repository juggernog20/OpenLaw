// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record-page tab strip (DES-032): the horizontal strip of section
 * tabs in the shell's sub-bar slot, directly under the breadcrumb. It
 * splits a long record into sections a reader opens one at a time.
 *
 * Tabs are routed links, not stateful tabs. Each section is its own
 * URL, so a reader can quote "the Documents tab of C-42" and land on
 * it. `SettingsSectionTabs` makes the same choice for settings panes,
 * and it is why this is a `nav` of links rather than a Radix `Tabs`:
 * an ARIA tablist promises keyboard semantics that a set of links does
 * not have, and links promise a URL that a tablist does not.
 *
 * It draws the settings strip's treatment verbatim (one tab look in
 * the app) over the sub-bar's own chrome border, so the strip reads as
 * the bottom edge of the chrome rather than as the top of the record.
 */

import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { formatCount } from "../../lib/format";
import { cn } from "../../lib/utils";

export interface RecordTab {
  /** The tab's address. Absolute, because the record's sections are
   * siblings under one route and a relative link would stack them. */
  to: string;
  /** True for the tab the bare record URL lands on. Without it, that
   * tab reads as active on every sibling section. */
  end?: boolean;
  label: ReactNode;
  /**
   * Work waiting in this section. Drawn as a DES-005 count chip beside
   * the label when greater than zero; an empty section is not news, so
   * zero and unset both mean no chip.
   */
  count?: number;
  /**
   * The chip's accessible name. A whole phrase, because a lone "3"
   * after a tab label says nothing. Required for the chip to render.
   */
  countLabel?: string;
}

export function RecordTabs({
  label,
  tabs,
}: Readonly<{
  /** The nav landmark's accessible name, e.g. "Contract sections". */
  label: string;
  tabs: readonly RecordTab[];
}>) {
  return (
    <nav
      aria-label={label}
      className="flex shrink-0 border-b border-(--chrome-subbar-border) bg-canvas px-page-x"
    >
      {tabs.map((tab) => {
        const count = tab.count ?? 0;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                "flex h-9 items-center gap-1 px-3 text-base whitespace-nowrap",
                isActive
                  ? "-mb-px border-b-2 border-accent font-semibold text-primary"
                  : "text-muted hover:text-primary",
              )
            }
          >
            {tab.label}
            {count > 0 && tab.countLabel ? (
              <span
                role="img"
                aria-label={tab.countLabel}
                className="shrink-0 rounded-chip bg-badge-count-bg px-1.5 py-px text-xs font-medium tabular-nums text-badge-count-fg"
              >
                {formatCount(count)}
              </span>
            ) : null}
          </NavLink>
        );
      })}
    </nav>
  );
}
