// SPDX-License-Identifier: AGPL-3.0-only

/** The stable column catalogue and saved filter vocabulary for the Matters list. */
import { FormattedMessage } from "react-intl";
import { Link } from "react-router";
import { formatDeadline, formatShortDate } from "../../lib/format";
import type { ColumnCatalogue, ColumnDef } from "../../lib/list-views";
import {
  matterPath,
  matterReference,
  matterSeverityLabel,
  type MatterRow,
} from "../../lib/matters";
import { Avatar } from "../avatar";
import { ConfidentialMarker } from "../confidential-marker";

const COLUMNS: ColumnDef<MatterRow>[] = [
  {
    key: "reference",
    header: <FormattedMessage id="matters.column.reference" defaultMessage="Matter" />,
    label: (intl) =>
      intl.formatMessage({ id: "matters.column.reference", defaultMessage: "Matter" }),
    defaultWidth: 112,
    minWidth: 72,
    sortKey: "number",
    render: (row, intl) => <span className="text-muted">{matterReference(intl, row.number)}</span>,
  },
  {
    key: "title",
    header: <FormattedMessage id="matters.column.title" defaultMessage="Title" />,
    label: (intl) => intl.formatMessage({ id: "matters.column.title", defaultMessage: "Title" }),
    defaultWidth: 280,
    minWidth: 176,
    required: true,
    sortKey: "title",
    render: (row) => (
      <span className="flex items-center gap-2.5">
        <Link
          to={matterPath(row.number)}
          className="truncate rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          {row.title}
        </Link>
        {row.isConfidential && <ConfidentialMarker />}
        {row.archivedAt !== null && (
          <span className="inline-flex shrink-0 rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
            <FormattedMessage id="matters.archivedPill" defaultMessage="Archived" />
          </span>
        )}
      </span>
    ),
  },
  {
    key: "type",
    header: <FormattedMessage id="matters.column.type" defaultMessage="Type" />,
    label: (intl) => intl.formatMessage({ id: "matters.column.type", defaultMessage: "Type" }),
    defaultWidth: 150,
    minWidth: 88,
    sortKey: "type",
    render: (row) => <span className="text-muted">{row.matterTypeName}</span>,
  },
  {
    key: "status",
    header: <FormattedMessage id="matters.column.status" defaultMessage="Status" />,
    label: (intl) => intl.formatMessage({ id: "matters.column.status", defaultMessage: "Status" }),
    defaultWidth: 128,
    minWidth: 88,
    sortKey: "status",
    clip: true,
    render: (row) => (
      <span
        className={`inline-flex w-max rounded-pill px-2 py-0.5 text-xs font-medium ${
          row.statusCategory === "closed"
            ? "bg-badge-neutral-bg text-badge-neutral-fg"
            : "bg-badge-positive-bg text-badge-positive-fg"
        }`}
      >
        {row.statusName}
      </span>
    ),
  },
  {
    key: "priority",
    header: <FormattedMessage id="matters.column.priority" defaultMessage="Priority" />,
    label: (intl) =>
      intl.formatMessage({ id: "matters.column.priority", defaultMessage: "Priority" }),
    defaultWidth: 112,
    minWidth: 80,
    sortKey: "priority",
    render: (row, intl) => matterSeverityLabel(intl, row.priority),
  },
  {
    key: "nextDeadline",
    header: <FormattedMessage id="matters.column.nextDeadline" defaultMessage="Next deadline" />,
    label: (intl) =>
      intl.formatMessage({ id: "matters.column.nextDeadline", defaultMessage: "Next deadline" }),
    defaultWidth: 220,
    minWidth: 144,
    render: (row) =>
      row.nextDeadline ? (
        <Link
          to={`${matterPath(row.number)}/key-dates`}
          className="flex min-w-0 flex-col rounded-chip hover:text-link hover:underline"
        >
          <span className="truncate">{row.nextDeadline.label}</span>
          <span className="text-xs text-muted">{formatDeadline(row.nextDeadline.date)}</span>
        </Link>
      ) : (
        <span className="text-muted">
          <FormattedMessage id="matters.value.noDeadline" defaultMessage="—" />
        </span>
      ),
  },
  {
    key: "risk",
    header: <FormattedMessage id="matters.column.risk" defaultMessage="Risk" />,
    label: (intl) => intl.formatMessage({ id: "matters.column.risk", defaultMessage: "Risk" }),
    defaultWidth: 120,
    minWidth: 80,
    sortKey: "risk",
    render: (row, intl) =>
      row.risk === null ? (
        <span className="text-muted">
          <FormattedMessage id="matters.risk.none" defaultMessage="Not assessed" />
        </span>
      ) : (
        matterSeverityLabel(intl, row.risk)
      ),
  },
  {
    key: "manager",
    header: <FormattedMessage id="matters.column.manager" defaultMessage="Matter Manager" />,
    label: (intl) =>
      intl.formatMessage({ id: "matters.column.manager", defaultMessage: "Matter Manager" }),
    defaultWidth: 176,
    minWidth: 104,
    sortKey: "manager",
    render: (row) =>
      row.manager ? (
        <span
          className={`flex min-w-0 items-center gap-2 ${row.manager.archived ? "opacity-50" : ""}`}
        >
          <Avatar name={row.manager.displayName} image={row.manager.image} className="size-6" />
          <span className="truncate">{row.manager.displayName}</span>
        </span>
      ) : (
        <span className="text-muted">
          <FormattedMessage id="matters.unassigned" defaultMessage="Unassigned" />
        </span>
      ),
  },
  {
    key: "openedAt",
    header: <FormattedMessage id="matters.column.opened" defaultMessage="Opened" />,
    label: (intl) => intl.formatMessage({ id: "matters.column.opened", defaultMessage: "Opened" }),
    defaultWidth: 128,
    minWidth: 88,
    sortKey: "openedAt",
    render: (row) => formatShortDate(row.openedAt),
  },
];

export const MATTERS_CATALOGUE: ColumnCatalogue<MatterRow> = {
  surface: "matters",
  columns: COLUMNS,
  defaultColumnKeys: [
    "reference",
    "title",
    "type",
    "status",
    "nextDeadline",
    "priority",
    "risk",
    "manager",
    "openedAt",
  ],
  flexColumnKey: "title",
};

export interface MatterFilters {
  includeClosed: boolean;
  includeArchived: boolean;
  status: string;
  type: string;
  priority: string;
  manager: string;
  incomplete: boolean;
}

export function matterFilters(filters: Record<string, boolean | string>): MatterFilters {
  return {
    includeClosed: filters.includeClosed === true,
    includeArchived: filters.includeArchived === true,
    status: typeof filters.status === "string" ? filters.status : "",
    type: typeof filters.type === "string" ? filters.type : "",
    priority: typeof filters.priority === "string" ? filters.priority : "",
    manager: typeof filters.manager === "string" ? filters.manager : "",
    incomplete: filters.incomplete === true,
  };
}
