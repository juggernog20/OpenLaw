// SPDX-License-Identifier: AGPL-3.0-only

import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { ListEditor } from "./list-editor";

const FIELD_LABELS = defineMessages({
  reference: { id: "settings.fields.default.reference", defaultMessage: "Reference" },
  title: { id: "settings.fields.default.title", defaultMessage: "Title" },
  matterType: { id: "settings.fields.default.matterType", defaultMessage: "Matter type" },
  contractType: { id: "settings.fields.default.contractType", defaultMessage: "Contract type" },
  status: { id: "settings.fields.default.status", defaultMessage: "Status" },
  matterManager: { id: "settings.fields.default.matterManager", defaultMessage: "Matter Manager" },
  legalOwner: { id: "settings.fields.default.legalOwner", defaultMessage: "Legal Owner" },
  businessOwner: { id: "settings.fields.default.businessOwner", defaultMessage: "Business Owner" },
  department: { id: "settings.fields.default.department", defaultMessage: "Department" },
  region: { id: "settings.fields.default.region", defaultMessage: "Region" },
  priority: { id: "settings.fields.default.priority", defaultMessage: "Priority" },
  risk: { id: "settings.fields.default.risk", defaultMessage: "Risk" },
  opened: { id: "settings.fields.default.opened", defaultMessage: "Opened" },
  closed: { id: "settings.fields.default.closed", defaultMessage: "Closed" },
  confidentiality: {
    id: "settings.fields.default.confidentiality",
    defaultMessage: "Confidentiality",
  },
  description: { id: "settings.fields.default.description", defaultMessage: "Description" },
  parentMatter: { id: "settings.fields.default.parentMatter", defaultMessage: "Parent Matter" },
  ourEntity: { id: "settings.fields.default.ourEntity", defaultMessage: "Our entity" },
  counterparties: {
    id: "settings.fields.default.counterparties",
    defaultMessage: "Counterparties",
  },
  termType: { id: "settings.fields.default.termType", defaultMessage: "Term type" },
  effectiveDate: { id: "settings.fields.default.effectiveDate", defaultMessage: "Effective date" },
  expiryDate: { id: "settings.fields.default.expiryDate", defaultMessage: "Expiry date" },
  renewalPeriod: {
    id: "settings.fields.default.renewalPeriod",
    defaultMessage: "Renewal period (months)",
  },
  noticePeriod: {
    id: "settings.fields.default.noticePeriod",
    defaultMessage: "Notice period (days)",
  },
  value: { id: "settings.fields.default.value", defaultMessage: "Value" },
  parentContract: {
    id: "settings.fields.default.parentContract",
    defaultMessage: "Parent Contract",
  },
  linkedMatter: { id: "settings.fields.default.linkedMatter", defaultMessage: "Linked Matter" },
  primaryDocument: {
    id: "settings.fields.default.primaryDocument",
    defaultMessage: "Primary Document",
  },
});

/** Built-in record fields are displayed here without custom-field mutation controls. */
const DEFAULT_FIELDS = {
  matter: [
    "reference",
    "title",
    "matterType",
    "status",
    "matterManager",
    "businessOwner",
    "department",
    "region",
    "priority",
    "risk",
    "opened",
    "closed",
    "confidentiality",
    "description",
    "parentMatter",
  ],
  contract: [
    "reference",
    "title",
    "contractType",
    "status",
    "legalOwner",
    "businessOwner",
    "department",
    "region",
    "priority",
    "risk",
    "ourEntity",
    "counterparties",
    "termType",
    "effectiveDate",
    "expiryDate",
    "renewalPeriod",
    "noticePeriod",
    "value",
    "confidentiality",
    "description",
    "parentContract",
    "linkedMatter",
    "primaryDocument",
  ],
} as const satisfies Record<"matter" | "contract", readonly (keyof typeof FIELD_LABELS)[]>;

export function DefaultFields({ module }: Readonly<{ module: "matter" | "contract" }>) {
  const intl = useIntl();
  const rows = DEFAULT_FIELDS[module].map((key) => ({
    id: key,
    displayName: intl.formatMessage(FIELD_LABELS[key]),
    archivedAt: null,
  }));
  return (
    <ListEditor
      region
      cardClassName="max-w-none"
      collapsible
      defaultOpen={false}
      title={<FormattedMessage id="settings.fields.defaults" defaultMessage="Default Fields" />}
      rows={rows}
      count={
        <FormattedMessage
          id="settings.contractFields.count"
          defaultMessage="{count, plural, one {# field} other {# fields}}"
          values={{ count: rows.length }}
        />
      }
      rowStatus={{}}
      rowError={{}}
      protectedLabel={(row) =>
        intl.formatMessage(
          {
            id: "settings.fields.defaultLocked",
            defaultMessage: "{name}: built-in field, read-only here",
          },
          { name: row.displayName },
        )
      }
    />
  );
}
