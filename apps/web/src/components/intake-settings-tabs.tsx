// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Intake settings section head on the shared SettingsSectionTabs
 * anatomy (#85), per the ST12 and ST13 frames of settings.pen: Request
 * types (INT-002) and Deflection links (INT-004), in the order both
 * frames draw them.
 */

import { FormattedMessage, useIntl } from "react-intl";
import { SettingsSectionTabs } from "./settings-section-tabs";

const TABS = [
  {
    path: "/settings/intake/request-types",
    label: (
      <FormattedMessage id="settings.intake.tab.requestTypes" defaultMessage="Request types" />
    ),
  },
  {
    path: "/settings/intake/links",
    label: <FormattedMessage id="settings.intake.tab.links" defaultMessage="Deflection links" />,
  },
] as const;

export function IntakeSettingsTabs() {
  const intl = useIntl();
  return (
    <SettingsSectionTabs
      title={<FormattedMessage id="settings.intake.title" defaultMessage="Intake" />}
      tabsLabel={intl.formatMessage({
        id: "settings.intake.tabsLabel",
        defaultMessage: "Intake panes",
      })}
      tabs={TABS}
    />
  );
}
