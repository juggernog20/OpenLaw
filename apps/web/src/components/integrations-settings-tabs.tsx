// SPDX-License-Identifier: AGPL-3.0-only

import { FormattedMessage, useIntl } from "react-intl";
import { SettingsSectionTabs } from "./settings-section-tabs";

const TABS = [
  {
    path: "/settings/integrations/e-signature",
    label: (
      <FormattedMessage id="settings.integrations.tab.eSignature" defaultMessage="E-signature" />
    ),
  },
  {
    path: "/settings/integrations/ai-analysis",
    label: (
      <FormattedMessage id="settings.integrations.tab.aiAnalysis" defaultMessage="AI analysis" />
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
