// SPDX-License-Identifier: AGPL-3.0-only

import { FormattedMessage, useIntl } from "react-intl";
import { SettingsSectionTabs } from "./settings-section-tabs";

// One pane today. AI analysis left for a section of its own (#675,
// SET-008); a second connector would join this strip as a second tab.
const TABS = [
  {
    path: "/settings/integrations/e-signature",
    label: (
      <FormattedMessage id="settings.integrations.tab.eSignature" defaultMessage="E-signature" />
    ),
  },
] as const;

export function IntegrationsSettingsTabs() {
  const intl = useIntl();
  return (
    <SettingsSectionTabs
      title={<FormattedMessage id="settings.integrations.title" defaultMessage="Integrations" />}
      tabsLabel={intl.formatMessage({
        id: "settings.integrations.tabsLabel",
        defaultMessage: "Integration panes",
      })}
      tabs={TABS}
    />
  );
}
