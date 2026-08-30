// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Entities settings section head on the shared SettingsSectionTabs
 * anatomy. M27 adds the shared Officer roles taxonomy and Fields
 * catalog alongside the Entity types pane.
 */

import { FormattedMessage, useIntl } from "react-intl";
import { SettingsSectionTabs } from "./settings-section-tabs";

const TABS = [
  {
    path: "/settings/entities/types",
    label: <FormattedMessage id="settings.entities.tab.types" defaultMessage="Types" />,
  },
  {
    path: "/settings/entities/officer-roles",
    label: (
      <FormattedMessage id="settings.entities.tab.officerRoles" defaultMessage="Officer roles" />
    ),
  },
  {
    path: "/settings/entities/fields",
    label: <FormattedMessage id="settings.entities.tab.fields" defaultMessage="Fields" />,
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
