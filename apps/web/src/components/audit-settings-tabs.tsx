// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Audit log section head on the shared SettingsSectionTabs anatomy.
 * Two panes: Activity, the DD-017 audit log over `activity_log`, and
 * Tool calls, the DD-029 ledger over `mcp_tool_calls`. Activity keeps
 * the section's root URL, so its tab matches that URL only (`end`),
 * or it would also light up under Tool calls.
 */

import { FormattedMessage, useIntl } from "react-intl";
import { SettingsSectionTabs } from "./settings-section-tabs";

const TABS = [
  {
    path: "/settings/audit-log",
    end: true,
    label: <FormattedMessage id="audit.activityTab" defaultMessage="Activity" />,
  },
  {
    path: "/settings/audit-log/tool-calls",
    label: <FormattedMessage id="audit.toolCalls" defaultMessage="Tool calls" />,
  },
] as const;

export function AuditSettingsTabs() {
  const intl = useIntl();
  return (
    <SettingsSectionTabs
      title={<FormattedMessage id="settings.section.auditLog" defaultMessage="Audit log" />}
      tabsLabel={intl.formatMessage({ id: "audit.panes", defaultMessage: "Audit log panes" })}
      tabs={TABS}
    />
  );
}
