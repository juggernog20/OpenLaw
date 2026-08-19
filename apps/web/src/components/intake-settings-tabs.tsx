// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Intake settings section head on the shared SettingsSectionTabs
 * anatomy (#85), per the ST12 frame of settings.pen. Request types is
 * the only pane this ticket; Deflection links (ST13, INT-004) joins the
 * strip with its own ticket, the same way the Contracts strip grew.
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
