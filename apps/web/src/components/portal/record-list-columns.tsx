// SPDX-License-Identifier: AGPL-3.0-only

import { defineMessages, FormattedMessage, type MessageDescriptor } from "react-intl";
import { Link } from "react-router";
import type { paths } from "@openlaw/api-client";
import type { ColumnCatalogue, ColumnDef } from "../../lib/list-views";
import {
  contractReference,
  formatContractValue,
  stageLabel,
  STAGE_PILL,
} from "../../lib/contracts";
import { matterReference, MATTER_STATUS_PILL } from "../../lib/matters";
import { formatShortDate } from "../../lib/format";
import { Avatar } from "../avatar";

export type PortalContractRow =
  paths["/api/v1/portal/contracts"]["get"]["responses"]["200"]["content"]["application/json"]["contracts"][number];
export type PortalMatterRow =
  paths["/api/v1/portal/matters"]["get"]["responses"]["200"]["content"]["application/json"]["matters"][number];
const messages = defineMessages({
  reference: { id: "portal.list.column.reference", defaultMessage: "Reference" },
  title: { id: "portal.list.column.title", defaultMessage: "Title" },
  counterparty: { id: "portal.list.column.counterparty", defaultMessage: "Counterparty" },
  type: { id: "portal.list.column.type", defaultMessage: "Type" },
  stage: { id: "portal.list.column.stage", defaultMessage: "Stage" },
  status: { id: "portal.list.column.status", defaultMessage: "Status" },
  legalOwner: { id: "portal.list.column.legalOwner", defaultMessage: "Legal Owner" },
  manager: { id: "portal.list.column.manager", defaultMessage: "Matter Manager" },
  businessOwner: { id: "portal.list.column.businessOwner", defaultMessage: "Business Owner" },
  effectiveDate: { id: "portal.list.column.effectiveDate", defaultMessage: "Effective date" },
  expiryDate: { id: "portal.list.column.expiryDate", defaultMessage: "Expiry date" },
  value: { id: "portal.list.column.value", defaultMessage: "Value" },
});
function column<Row>(
  key: string,
  message: MessageDescriptor,
  render: ColumnDef<Row>["render"],
  width = 160,
  sortKey?: string,
): ColumnDef<Row> {
  return {
    key,
    header: <FormattedMessage {...message} />,
    label: (intl) => intl.formatMessage(message),
    defaultWidth: width,
    minWidth: key === "title" ? 176 : 88,
    render,
    ...(sortKey ? { sortKey } : {}),
  };
}
function Person({ person }: { person: PortalContractRow["legalOwner"] }) {
  return person ? (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={person.displayName} image={person.image} className="size-6" />
      <span className="truncate">{person.displayName}</span>
    </span>
  ) : (
    <span className="text-muted">
      <FormattedMessage id="portal.list.unassigned" defaultMessage="Unassigned" />
    </span>
  );
}
function EmptyValue() {
  return (
    <span className="text-muted">
      <FormattedMessage id="portal.list.notRecorded" defaultMessage="Not recorded" />
    </span>
  );
}
const linkClass =
  "truncate rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link";
export const PORTAL_CONTRACTS_CATALOGUE: ColumnCatalogue<PortalContractRow> = {
  surface: "contracts",
  flexColumnKey: "title",
  defaultColumnKeys: ["reference", "title", "counterparty", "stage", "legalOwner", "expiryDate"],
  columns: [
    column(
      "reference",
      messages.reference,
      (row, intl) => <span className="text-muted">{contractReference(intl, row.number)}</span>,
      112,
      "number",
    ),
    {
      ...column<PortalContractRow>(
        "title",
        messages.title,
        (row) => (
          <Link className={linkClass} to={`/portal/contracts/${row.number}`}>
            {row.title}
          </Link>
        ),
        300,
        "title",
      ),
      required: true,
    },
    column(
      "counterparty",
      messages.counterparty,
      (row) => row.counterparty ?? <EmptyValue />,
      180,
      "counterparty",
    ),
    column("type", messages.type, (row) => row.type, 160, "type"),
    {
      ...column<PortalContractRow>(
        "stage",
        messages.stage,
        (row, intl) => (
          <span
            className={`inline-flex w-max rounded-pill px-2 py-0.5 text-xs font-medium ${STAGE_PILL[row.stage]}`}
          >
            {stageLabel(intl, row.stage)}
          </span>
        ),
        140,
        "stage",
      ),
      clip: true,
    },
    column(
      "legalOwner",
      messages.legalOwner,
      (row) => <Person person={row.legalOwner} />,
      190,
      "owner",
    ),
    column(
      "businessOwner",
      messages.businessOwner,
      (row) => <Person person={row.businessOwner} />,
      190,
    ),
    column(
      "effectiveDate",
      messages.effectiveDate,
      (row) => (row.effectiveDate ? formatShortDate(row.effectiveDate) : <EmptyValue />),
      150,
      "effectiveDate",
    ),
    column(
      "expiryDate",
      messages.expiryDate,
      (row) => (row.expiryDate ? formatShortDate(row.expiryDate) : <EmptyValue />),
      150,
      "expiryDate",
    ),
    column(
      "value",
      messages.value,
      (row, intl) => (row.value ? formatContractValue(intl, row.value) : <EmptyValue />),
      210,
    ),
  ],
};
export const PORTAL_MATTERS_CATALOGUE: ColumnCatalogue<PortalMatterRow> = {
  surface: "matters",
  flexColumnKey: "title",
  defaultColumnKeys: ["reference", "title", "type", "status", "manager"],
  columns: [
    column(
      "reference",
      messages.reference,
      (row, intl) => <span className="text-muted">{matterReference(intl, row.number)}</span>,
      112,
      "number",
    ),
    {
      ...column<PortalMatterRow>(
        "title",
        messages.title,
        (row) => (
          <Link className={linkClass} to={`/portal/matters/${row.number}`}>
            {row.title}
          </Link>
        ),
        320,
        "title",
      ),
      required: true,
    },
    column("type", messages.type, (row) => row.type, 180, "type"),
    {
      ...column<PortalMatterRow>(
        "status",
        messages.status,
        (row) => (
          <span
            className={`inline-flex w-max rounded-pill px-2 py-0.5 text-xs font-medium ${MATTER_STATUS_PILL[row.category]}`}
          >
            {row.status}
          </span>
        ),
        160,
        "status",
      ),
      clip: true,
    },
    column("manager", messages.manager, (row) => <Person person={row.manager} />, 210, "owner"),
    column(
      "businessOwner",
      messages.businessOwner,
      (row) => <Person person={row.businessOwner} />,
      210,
    ),
  ],
};
