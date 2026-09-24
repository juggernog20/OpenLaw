// SPDX-License-Identifier: AGPL-3.0-only
import { FormattedMessage, useIntl } from "react-intl";
import { SettingsSectionTabs } from "../components/settings-section-tabs";

export function SettingsAuditTabs() {
  const intl = useIntl();
  return (
    <SettingsSectionTabs
      title={<FormattedMessage id="settings.section.auditLog" defaultMessage="Audit log" />}
      tabsLabel={intl.formatMessage({ id: "audit.panes", defaultMessage: "Audit log panes" })}
      tabs={[
        {
          path: "/settings/audit-log",
          end: true,
          label: <FormattedMessage id="audit.activityTab" defaultMessage="Activity" />,
        },
        {
          path: "/settings/audit-log/tool-calls",
          label: <FormattedMessage id="audit.toolCalls" defaultMessage="Tool calls" />,
        },
      ]}
    />
  );
}
