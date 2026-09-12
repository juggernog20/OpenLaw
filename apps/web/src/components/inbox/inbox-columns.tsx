// SPDX-License-Identifier: AGPL-3.0-only

/** DES-056 supplies the Inbox column catalogue and built-in layout. */

import { FormattedMessage } from "react-intl";
import { Link } from "react-router";
import type { ColumnCatalogue, ColumnDef, Layout } from "../../lib/list-views";
import { builtInLayout } from "../../lib/list-views";
import { contractPath, contractReference, SEVERITY_PILL, severityLabel } from "../../lib/contracts";
import { matterPath, matterReference } from "../../lib/matters";
import { formatRelativeOrShort } from "../../lib/format";
import {
  requestReference,
  requestStatusLabel,
  requestTargetLabel,
  REQUEST_STATUS_PILL,
  type InboxRow,
} from "../../lib/requests";
import { RequestAssignment } from "./request-assignment";
import type { StaffRequest } from "../../lib/requests";

const COLUMNS: ColumnDef<InboxRow>[] = [
  {
    key: "reference",
    sortKey: "number",
    header: <FormattedMessage id="inbox.column.reference" defaultMessage="Ref" />,
    label: (intl) => intl.formatMessage({ id: "inbox.column.reference", defaultMessage: "Ref" }),
    defaultWidth: 88,
    minWidth: 72,
    render: (row, intl) => (
      <span className="font-semibold text-muted">{requestReference(intl, row.number)}</span>
    ),
  },
  {
    key: "title",
    sortKey: "title",
    header: <FormattedMessage id="inbox.column.title" defaultMessage="Title" />,
    label: (intl) => intl.formatMessage({ id: "inbox.column.title", defaultMessage: "Title" }),
    defaultWidth: 300,
    minWidth: 192,
    required: true,
    render: (row) => (
      <Link
        to={`/inbox/${row.number}`}
        className="truncate rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
      >
        {row.title}
      </Link>
    ),
  },
  {
    key: "type",
    sortKey: "type",
    header: <FormattedMessage id="inbox.column.type" defaultMessage="Type" />,
    label: (intl) => intl.formatMessage({ id: "inbox.column.type", defaultMessage: "Type" }),
    defaultWidth: 176,
    minWidth: 112,
    render: (row, intl) => (
      <span className="flex flex-col">
        <span className="truncate">{row.requestType.displayName}</span>
        <span className="truncate text-xs text-muted">
          {requestTargetLabel(intl, row.requestType)}
        </span>
      </span>
    ),
  },
  {
    key: "requester",
    sortKey: "requester",
    header: <FormattedMessage id="inbox.column.requester" defaultMessage="Requester" />,
    label: (intl) =>
      intl.formatMessage({ id: "inbox.column.requester", defaultMessage: "Requester" }),
    defaultWidth: 144,
    minWidth: 96,
    render: (row) => row.requester.displayName,
  },
  {
    key: "urgency",
    sortKey: "urgency",
    header: <FormattedMessage id="inbox.column.urgency" defaultMessage="Urgency" />,
    label: (intl) => intl.formatMessage({ id: "inbox.column.urgency", defaultMessage: "Urgency" }),
    defaultWidth: 104,
    minWidth: 88,
    clip: true,
    render: (row, intl) => (
      <span
        className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${SEVERITY_PILL[row.urgency]}`}
      >
        {severityLabel(intl, row.urgency)}
      </span>
    ),
  },
  {
    key: "age",
    sortKey: "createdAt",
    header: <FormattedMessage id="inbox.column.age" defaultMessage="Age" />,
    label: (intl) => intl.formatMessage({ id: "inbox.column.age", defaultMessage: "Age" }),
    defaultWidth: 112,
    minWidth: 88,
    render: (row, intl) => (
      <span className="text-muted">
        {formatRelativeOrShort(row.createdAt, { locale: intl.locale })}
      </span>
    ),
  },
  {
    key: "outcome",
    sortKey: "status",
    header: <FormattedMessage id="inbox.column.status" defaultMessage="Status" />,
    label: (intl) => intl.formatMessage({ id: "inbox.column.status", defaultMessage: "Status" }),
    defaultWidth: 112,
    minWidth: 80,
    clip: true,
    render: (row, intl) => (
      <span className="flex items-center gap-2">
        <span
          className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_PILL[row.status]}`}
        >
          {requestStatusLabel(intl, row.status)}
        </span>
        {row.convertedRecord && (
          <Link
            to={
              row.convertedRecord.module === "matter"
                ? matterPath(row.convertedRecord.number)
                : contractPath(row.convertedRecord.number)
            }
            className="text-sm font-medium hover:text-link hover:underline"
          >
            {row.convertedRecord.module === "matter"
              ? matterReference(intl, row.convertedRecord.number)
              : contractReference(intl, row.convertedRecord.number)}
          </Link>
        )}
      </span>
    ),
  },
];

export const INBOX_CATALOGUE: ColumnCatalogue<InboxRow> = {
  surface: "inbox",
  columns: COLUMNS,
  defaultColumnKeys: ["reference", "title", "type", "requester", "urgency", "age", "outcome"],
  flexColumnKey: "title",
};
export function defaultInboxLayout(): Layout {
  return { ...builtInLayout(INBOX_CATALOGUE), filters: { status: "new" } };
}

export function InboxAssignAction({
  row,
  onAssigned,
}: Readonly<{ row: InboxRow; onAssigned: (request: StaffRequest) => void }>) {
  return <RequestAssignment request={row} onAssigned={onAssigned} />;
}
