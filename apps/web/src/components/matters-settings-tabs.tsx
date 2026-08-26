// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Matters settings section head on the shared SettingsSectionTabs
 * anatomy (#85), per the ST6 frame of settings.pen. Types is the only
 * pane at #85; M22 added Statuses and Fields, and M24 adds Templates.
 * The strip grows through the same shared component as Contracts.
 */

import { FormattedMessage, useIntl } from "react-intl";
import { SettingsSectionTabs } from "./settings-section-tabs";

const TABS = [
  {
    path: "/settings/matters/types",
    label: <FormattedMessage id="settings.matters.tab.types" defaultMessage="Types" />,
  },
  {
    path: "/settings/matters/statuses",
    label: <FormattedMessage id="settings.matters.tab.statuses" defaultMessage="Statuses" />,
  },
  {
    path: "/settings/matters/fields",
    label: <FormattedMessage id="settings.matters.tab.fields" defaultMessage="Fields" />,
  },
  {
    path: "/settings/matters/templates",
    label: <FormattedMessage id="settings.matters.tab.templates" defaultMessage="Templates" />,
  },
] as const;

export function MattersSettingsTabs() {
  const intl = useIntl();
  return (
    <SettingsSectionTabs
      title={<FormattedMessage id="settings.matters.title" defaultMessage="Matters" />}
      tabsLabel={intl.formatMessage({
        id: "settings.matters.tabsLabel",
        defaultMessage: "Matters panes",
      })}
      tabs={TABS}
    />
  );
}
