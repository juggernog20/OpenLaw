// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Contracts settings section head (ST10) on the shared
 * SettingsSectionTabs anatomy (#85). Fields and Approver groups join
 * the strip as their tickets land, the same way Statuses joined with
 * #82.
 */

import { FormattedMessage, useIntl } from "react-intl";
import { SettingsSectionTabs } from "./settings-section-tabs";

const TABS = [
  {
    path: "/settings/contracts/types",
    label: <FormattedMessage id="settings.contracts.tab.types" defaultMessage="Types" />,
  },
  {
    path: "/settings/contracts/statuses",
    label: <FormattedMessage id="settings.contracts.tab.statuses" defaultMessage="Statuses" />,
  },
  {
    path: "/settings/contracts/fields",
    label: <FormattedMessage id="settings.contracts.tab.fields" defaultMessage="Fields" />,
  },
] as const;

export function ContractsSettingsTabs() {
  const intl = useIntl();
  return (
    <SettingsSectionTabs
      title={<FormattedMessage id="settings.contracts.title" defaultMessage="Contracts" />}
      tabsLabel={intl.formatMessage({
        id: "settings.contracts.tabsLabel",
        defaultMessage: "Contracts panes",
      })}
      tabs={TABS}
    />
  );
}
