// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entities settings section head on the shared SettingsSectionTabs
 * anatomy (#97). Types is the only pane this milestone; Officer Roles
 * and Fields join the strip when the full module lands (M27), the same
 * way the Contracts strip grew.
 */

import { FormattedMessage, useIntl } from "react-intl";
import { SettingsSectionTabs } from "./settings-section-tabs";

const TABS = [
  {
    path: "/settings/entities/types",
    label: <FormattedMessage id="settings.entities.tab.types" defaultMessage="Types" />,
  },
] as const;

export function EntitiesSettingsTabs() {
  const intl = useIntl();
  return (
    <SettingsSectionTabs
      title={<FormattedMessage id="settings.entities.title" defaultMessage="Entities" />}
      tabsLabel={intl.formatMessage({
        id: "settings.entities.tabsLabel",
        defaultMessage: "Entities panes",
      })}
      tabs={TABS}
    />
  );
}
