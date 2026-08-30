// SPDX-License-Identifier: AGPL-3.0-only

/** The Knowledge settings section head; Types is M28's first pane. */
import { FormattedMessage, useIntl } from "react-intl";
import { SettingsSectionTabs } from "./settings-section-tabs";

const TABS = [
  {
    path: "/settings/knowledge/types",
    label: <FormattedMessage id="settings.knowledge.tab.types" defaultMessage="Types" />,
  },
] as const;

export function KnowledgeSettingsTabs() {
  const intl = useIntl();
  return (
    <SettingsSectionTabs
      title={<FormattedMessage id="settings.knowledge.title" defaultMessage="Knowledge" />}
      tabsLabel={intl.formatMessage({
        id: "settings.knowledge.tabsLabel",
        defaultMessage: "Knowledge panes",
      })}
      tabs={TABS}
    />
  );
}
