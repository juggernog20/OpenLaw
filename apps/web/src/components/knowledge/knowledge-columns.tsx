// SPDX-License-Identifier: AGPL-3.0-only

/** DES-046 column catalogue for the Knowledge library. */
import { BookOpen, MoreHorizontal } from "lucide-react";
import { FormattedMessage } from "react-intl";
import { Link } from "react-router";
import { formatShortDate } from "../../lib/format";
import {
  knowledgeAudienceLabel,
  knowledgeFormatLabel,
  knowledgeStateLabel,
  type KnowledgeItem,
} from "../../lib/knowledge";
import type { ColumnCatalogue, ColumnDef } from "../../lib/list-views";
import { Avatar } from "../avatar";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

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
    key: "format",
    header: <FormattedMessage id="knowledge.column.format" defaultMessage="Format" />,
    label: (intl) =>
      intl.formatMessage({ id: "knowledge.column.format", defaultMessage: "Format" }),
    defaultWidth: 120,
    minWidth: 88,
    render: (row, intl) => {
      const family = row.primaryDocument?.currentVersion.renderFamily;
      const label = family ? knowledgeFormatLabel(intl, family) : "—";
      return family ? (
        <span className="rounded-pill bg-status-neutral-bg px-2 py-0.5 text-xs font-medium text-status-neutral-fg">
          {label}
        </span>
      ) : (
        <span className="text-muted">{label}</span>
      );
    },
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
  {
    key: "actions",
    header: (
      <span className="sr-only">
        <FormattedMessage id="knowledge.column.actions" defaultMessage="Actions" />
      </span>
    ),
    label: (intl) =>
      intl.formatMessage({ id: "knowledge.column.actions", defaultMessage: "Actions" }),
    defaultWidth: 56,
    minWidth: 48,
    required: true,
    render: (row, intl) =>
      row.primaryDocument ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={intl.formatMessage(
                { id: "knowledge.actionsFor", defaultMessage: "Actions for {title}" },
                { title: row.title },
              )}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link
                to={`/knowledge/${row.id}?doc=${encodeURIComponent(row.primaryDocument.id)}&version=${encodeURIComponent(row.primaryDocument.currentVersion.id)}`}
              >
                <FormattedMessage id="knowledge.action.openPreview" defaultMessage="Open preview" />
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null,
  },
];

export const KNOWLEDGE_CATALOGUE: ColumnCatalogue<KnowledgeItem> = {
  surface: "knowledge",
  columns: COLUMNS,
  defaultColumnKeys: [
    "title",
    "type",
    "format",
    "state",
    "audience",
    "folder",
    "author",
    "updated",
    "actions",
  ],
  flexColumnKey: "title",
};
