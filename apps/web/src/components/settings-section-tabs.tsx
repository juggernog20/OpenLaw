// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A settings section head (ST10): the section title and the pane tab
 * strip shared by every pane of a module section — Matters and
 * Contracts mount it with their own vocabulary (#85). Tabs are routed
 * links, not stateful tabs — each pane is its own URL (SET-001 deep
 * links). Panes join each strip as their tickets land.
 */

import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { cn } from "../lib/utils";

export interface SectionTab {
  path: string;
  label: ReactNode;
}

export function SettingsSectionTabs({
  title,
  tabsLabel,
  tabs,
}: Readonly<{
  title: ReactNode;
  /** The nav landmark's accessible name, e.g. "Contracts panes". */
  tabsLabel: string;
  tabs: readonly SectionTab[];
}>) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-primary">{title}</h2>
      <nav aria-label={tabsLabel} className="flex border-b border-border-default">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              cn(
                "flex h-9 items-center px-3 text-base whitespace-nowrap",
                isActive
                  ? "-mb-px border-b-2 border-accent font-semibold text-primary"
                  : "text-muted hover:text-primary",
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
