// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Contracts settings section head (ST10): the section title and the
 * pane tab strip shared by every Contracts pane. Tabs are routed links,
 * not stateful tabs — each pane is its own URL (SET-001 deep links).
 * Fields and Approver groups join the strip as their tickets land, the
 * same way Statuses joined with #82.
 */

import { NavLink } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { cn } from "../lib/utils";

const TABS = [
  {
    path: "/settings/contracts/types",
    label: <FormattedMessage id="settings.contracts.tab.types" defaultMessage="Types" />,
  },
  {
    path: "/settings/contracts/statuses",
    label: <FormattedMessage id="settings.contracts.tab.statuses" defaultMessage="Statuses" />,
  },
] as const;

export function ContractsSettingsTabs() {
  const intl = useIntl();
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-primary">
        <FormattedMessage id="settings.contracts.title" defaultMessage="Contracts" />
      </h2>
      <nav
        aria-label={intl.formatMessage({
          id: "settings.contracts.tabsLabel",
          defaultMessage: "Contracts panes",
        })}
        className="flex border-b border-border-default"
      >
        {TABS.map((tab) => (
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
