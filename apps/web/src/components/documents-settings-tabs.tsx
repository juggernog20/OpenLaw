// SPDX-License-Identifier: AGPL-3.0-only

/** The Documents settings section head: one Document type list per
 * owning module (DOC-015), each on its own routed tab. Knowledge files
 * take their item's Knowledge type, so Knowledge has no tab. */
import { FormattedMessage, useIntl } from "react-intl";
import { SettingsSectionTabs } from "./settings-section-tabs";

const TABS = [
  {
    path: "/settings/documents/matters",
    label: <FormattedMessage id="settings.documents.tab.matters" defaultMessage="Matters" />,
  },
  {
    path: "/settings/documents/contracts",
    label: <FormattedMessage id="settings.documents.tab.contracts" defaultMessage="Contracts" />,
  },
  {
    path: "/settings/documents/entities",
    label: <FormattedMessage id="settings.documents.tab.entities" defaultMessage="Entities" />,
  },
] as const;

export function DocumentsSettingsTabs() {
  const intl = useIntl();
  return (
    <SettingsSectionTabs
      title={<FormattedMessage id="settings.documents.title" defaultMessage="Documents" />}
      tabsLabel={intl.formatMessage({
        id: "settings.documents.tabsLabel",
        defaultMessage: "Document type lists",
      })}
      tabs={TABS}
    />
  );
}
