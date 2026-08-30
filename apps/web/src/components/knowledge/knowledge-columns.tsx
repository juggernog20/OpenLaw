// SPDX-License-Identifier: AGPL-3.0-only

/** DES-046 column catalogue for the Knowledge library. */
import { BookOpen } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { Link } from "react-router";
import { formatShortDate } from "../../lib/format";
import {
  knowledgeAudienceLabel,
  knowledgeStateLabel,
  type KnowledgeItem,
} from "../../lib/knowledge";
import type { ColumnCatalogue, ColumnDef } from "../../lib/list-views";
import { Avatar } from "../avatar";

const COLUMNS: ColumnDef<KnowledgeItem>[] = [
  {
    key: "title",
    header: <FormattedMessage id="knowledge.column.title" defaultMessage="Title" />,
    label: (intl) => intl.formatMessage({ id: "knowledge.column.title", defaultMessage: "Title" }),
    defaultWidth: 320,
    minWidth: 180,
    required: true,
    sortKey: "title",
    render: (row) => (
      <span className="flex items-center gap-2.5">
        <BookOpen size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <Link
          to={`/knowledge/${row.id}`}
          className="truncate rounded-chip font-medium hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          {row.title}
        </Link>
        {row.state === "draft" ? (
          <span className="shrink-0 rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
            <FormattedMessage id="knowledge.draftMarker" defaultMessage="Draft" />
          </span>
        ) : null}
      </span>
    ),
  },
  {
    key: "type",
    header: <FormattedMessage id="knowledge.column.type" defaultMessage="Type" />,
    label: (intl) => intl.formatMessage({ id: "knowledge.column.type", defaultMessage: "Type" }),
    defaultWidth: 160,
    minWidth: 96,
    sortKey: "type",
    render: (row) => <span className="text-muted">{row.knowledgeTypeName}</span>,
  },
  {
    key: "state",
    header: <FormattedMessage id="knowledge.column.state" defaultMessage="State" />,
    label: (intl) => intl.formatMessage({ id: "knowledge.column.state", defaultMessage: "State" }),
    defaultWidth: 112,
    minWidth: 80,
    sortKey: "state",
    render: (row, intl) => (
      <span className="text-muted">{knowledgeStateLabel(intl, row.state)}</span>
    ),
  },
  {
    key: "audience",
    header: <FormattedMessage id="knowledge.column.audience" defaultMessage="Audience" />,
    label: (intl) =>
      intl.formatMessage({ id: "knowledge.column.audience", defaultMessage: "Audience" }),
    defaultWidth: 136,
    minWidth: 96,
    sortKey: "audience",
    render: (row, intl) => (
      <span className="text-muted">{knowledgeAudienceLabel(intl, row.audience)}</span>
    ),
  },
  {
    key: "folder",
    header: <FormattedMessage id="knowledge.column.folder" defaultMessage="Folder" />,
    label: (intl) =>
      intl.formatMessage({ id: "knowledge.column.folder", defaultMessage: "Folder" }),
    defaultWidth: 168,
    minWidth: 96,
    sortKey: "folder",
    render: (row) => (
      <span className="text-muted">
        {row.folderName ?? <FormattedMessage id="knowledge.folder.root" defaultMessage="Library" />}
      </span>
    ),
  },
  {
    key: "author",
    header: <FormattedMessage id="knowledge.column.author" defaultMessage="Author" />,
    label: (intl) =>
      intl.formatMessage({ id: "knowledge.column.author", defaultMessage: "Author" }),
    defaultWidth: 176,
    minWidth: 112,
    sortKey: "author",
    render: (row) => (
      <span className="flex items-center gap-2 text-muted">
        <Avatar name={row.createdBy.displayName} image={row.createdBy.image} className="size-6" />
        <span className="truncate">{row.createdBy.displayName}</span>
      </span>
    ),
  },
  {
    key: "created",
    header: <FormattedMessage id="knowledge.column.created" defaultMessage="Created" />,
    label: (intl) =>
      intl.formatMessage({ id: "knowledge.column.created", defaultMessage: "Created" }),
    defaultWidth: 128,
    minWidth: 96,
    sortKey: "created",
    render: (row) => <span className="text-muted">{formatShortDate(row.createdAt)}</span>,
  },
  {
    key: "updated",
    header: <FormattedMessage id="knowledge.column.updated" defaultMessage="Updated" />,
    label: (intl) =>
      intl.formatMessage({ id: "knowledge.column.updated", defaultMessage: "Updated" }),
    defaultWidth: 128,
    minWidth: 96,
    sortKey: "updated",
    render: (row) => <span className="text-muted">{formatShortDate(row.updatedAt)}</span>,
  },
];

export const KNOWLEDGE_CATALOGUE: ColumnCatalogue<KnowledgeItem> = {
  surface: "knowledge",
  columns: COLUMNS,
  defaultColumnKeys: ["title", "type", "state", "audience", "folder", "author", "updated"],
  flexColumnKey: "title",
};
