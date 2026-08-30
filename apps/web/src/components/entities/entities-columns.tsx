// SPDX-License-Identifier: AGPL-3.0-only

/** M27/9's Entity column catalogue and saved filter vocabulary. */
import { FormattedMessage } from "react-intl";
import { Link } from "react-router";
import { Building2 } from "lucide-react";
import { formatDeadline, formatShortDate } from "../../lib/format";
import type { ColumnCatalogue, ColumnDef } from "../../lib/list-views";
import { STATUS_PILL, statusLabel, type RegistryEntityRow } from "../../lib/entities";
import { ConfidentialMarker } from "../confidential-marker";

const COLUMNS: ColumnDef<RegistryEntityRow>[] = [
  {
    key: "legalName",
    header: <FormattedMessage id="entities.list.column.legalName" defaultMessage="Legal name" />,
    label: (intl) =>
      intl.formatMessage({ id: "entities.list.column.legalName", defaultMessage: "Legal name" }),
    defaultWidth: 280,
    minWidth: 176,
    required: true,
    sortKey: "name",
    render: (row) => (
      <span className="flex items-center gap-2.5">
        <Building2 size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <Link
          to={`/entities/${row.id}`}
          className="truncate rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          {row.legalName}
        </Link>
        {row.isConfidential && <ConfidentialMarker />}
        {row.archivedAt !== null && (
          <span className="inline-flex shrink-0 rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
            <FormattedMessage id="entities.list.archived" defaultMessage="Archived" />
          </span>
        )}
      </span>
    ),
  },
  {
    key: "type",
    header: <FormattedMessage id="entities.list.column.type" defaultMessage="Type" />,
    label: (intl) =>
      intl.formatMessage({ id: "entities.list.column.type", defaultMessage: "Type" }),
    defaultWidth: 144,
    minWidth: 88,
    sortKey: "type",
    render: (row) => <span className="text-muted">{row.entityTypeName}</span>,
  },
  {
    key: "jurisdiction",
    header: (
      <FormattedMessage id="entities.list.column.jurisdiction" defaultMessage="Jurisdiction" />
    ),
    label: (intl) =>
      intl.formatMessage({
        id: "entities.list.column.jurisdiction",
        defaultMessage: "Jurisdiction",
      }),
    defaultWidth: 176,
    minWidth: 104,
    sortKey: "jurisdiction",
    render: (row) => (
      <span className="text-muted">
        {row.jurisdiction ?? <FormattedMessage id="entities.list.value.none" defaultMessage="—" />}
      </span>
    ),
  },
  {
    key: "registrationNumber",
    header: (
      <FormattedMessage
        id="entities.list.column.registrationNumber"
        defaultMessage="Registration no."
      />
    ),
    label: (intl) =>
      intl.formatMessage({
        id: "entities.list.column.registrationNumber",
        defaultMessage: "Registration no.",
      }),
    defaultWidth: 152,
    minWidth: 96,
    render: (row) => (
      <span className="text-muted">
        {row.registrationNumber ?? (
          <FormattedMessage id="entities.list.value.none" defaultMessage="—" />
        )}
      </span>
    ),
  },
  {
    key: "status",
    header: <FormattedMessage id="entities.list.column.status" defaultMessage="Status" />,
    label: (intl) =>
      intl.formatMessage({ id: "entities.list.column.status", defaultMessage: "Status" }),
    defaultWidth: 120,
    minWidth: 88,
    sortKey: "status",
    clip: true,
    render: (row, intl) => (
      <span
        className={`inline-flex w-max rounded-pill px-2 py-0.5 text-xs font-medium ${STATUS_PILL[row.status]}`}
      >
        {statusLabel(intl, row.status)}
      </span>
    ),
  },
  {
    key: "nextObligation",
    header: (
      <FormattedMessage id="entities.list.column.nextObligation" defaultMessage="Next obligation" />
    ),
    label: (intl) =>
      intl.formatMessage({
        id: "entities.list.column.nextObligation",
        defaultMessage: "Next obligation",
      }),
    defaultWidth: 220,
    minWidth: 144,
    sortKey: "nextObligation",
    render: (row) =>
      row.nextObligation ? (
        <Link
          to={`/entities/${row.id}/obligations`}
          className="flex min-w-0 flex-col rounded-chip hover:text-link hover:underline"
        >
          <span className="truncate">{row.nextObligation.label}</span>
          <span className="text-xs text-muted">{formatDeadline(row.nextObligation.dueOn)}</span>
        </Link>
      ) : (
        <span className="text-muted">
          <FormattedMessage id="entities.list.value.noObligation" defaultMessage="—" />
        </span>
      ),
  },
  {
    key: "created",
    header: <FormattedMessage id="entities.list.column.created" defaultMessage="Created" />,
    label: (intl) =>
      intl.formatMessage({ id: "entities.list.column.created", defaultMessage: "Created" }),
    defaultWidth: 136,
    minWidth: 96,
    sortKey: "created",
    render: (row) => formatShortDate(row.createdAt),
  },
];

export const ENTITIES_CATALOGUE: ColumnCatalogue<RegistryEntityRow> = {
  surface: "entities",
  columns: COLUMNS,
  defaultColumnKeys: [
    "legalName",
    "type",
    "jurisdiction",
    "registrationNumber",
    "status",
    "nextObligation",
  ],
  flexColumnKey: "legalName",
};

export interface EntityListFilters {
  includeArchived: boolean;
  type: string;
  status: string;
  jurisdiction: string;
  majorityOwner: string;
}

export function entityListFilters(filters: Record<string, boolean | string>): EntityListFilters {
  return {
    includeArchived: filters.includeArchived === true,
    type: typeof filters.type === "string" ? filters.type : "",
    status: typeof filters.status === "string" ? filters.status : "",
    jurisdiction: typeof filters.jurisdiction === "string" ? filters.jurisdiction : "",
    majorityOwner: typeof filters.majorityOwner === "string" ? filters.majorityOwner : "",
  };
}
