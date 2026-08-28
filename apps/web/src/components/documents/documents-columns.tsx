// SPDX-License-Identifier: AGPL-3.0-only

/** The stable DES-066 column catalogue for the flat Documents repository. */
import { FormattedMessage } from "react-intl";
import { FileText } from "lucide-react";
import { Link } from "react-router";
import { formatFileSize, formatRelativeOrShort } from "../../lib/format";
import {
  documentKindLabel,
  documentLandingPath,
  DOCUMENT_KIND_PILL,
  type RepositoryDocument,
} from "../../lib/documents";
import type { ColumnCatalogue, ColumnDef } from "../../lib/list-views";
import { Avatar } from "../avatar";
import { ConfidentialMarker } from "../confidential-marker";

function formatName(filename: string, mimeType: string): string {
  const extension = filename.includes(".") ? filename.split(".").at(-1) : undefined;
  return (extension || mimeType.split("/").at(-1) || mimeType).toUpperCase();
}

const COLUMNS: ColumnDef<RepositoryDocument>[] = [
  {
    key: "title",
    header: <FormattedMessage id="documents.list.column.title" defaultMessage="Title" />,
    label: (intl) =>
      intl.formatMessage({ id: "documents.list.column.title", defaultMessage: "Title" }),
    defaultWidth: 320,
    minWidth: 192,
    required: true,
    render: (row) => (
      <span className="flex min-w-0 items-center gap-2.5">
        <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <Link
          to={documentLandingPath(row)}
          className="truncate rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          {row.title}
        </Link>
        {row.isConfidential && <ConfidentialMarker />}
      </span>
    ),
  },
  {
    key: "owner",
    header: <FormattedMessage id="documents.list.column.owner" defaultMessage="Owning record" />,
    label: (intl) =>
      intl.formatMessage({ id: "documents.list.column.owner", defaultMessage: "Owning record" }),
    defaultWidth: 260,
    minWidth: 152,
    render: (row) => (
      <FormattedMessage
        id="documents.list.owner"
        defaultMessage="{reference} · {title}"
        values={{
          reference: `${row.owner.kind === "contract" ? "C" : "M"}-${row.owner.number}`,
          title: row.owner.title,
        }}
      />
    ),
  },
  {
    key: "kind",
    header: <FormattedMessage id="documents.list.column.kind" defaultMessage="Kind" />,
    label: (intl) =>
      intl.formatMessage({ id: "documents.list.column.kind", defaultMessage: "Kind" }),
    defaultWidth: 144,
    minWidth: 96,
    clip: true,
    render: (row, intl) => (
      <span
        className={`inline-flex w-max rounded-pill px-2 py-0.5 text-xs font-medium ${DOCUMENT_KIND_PILL[row.currentVersion.kind]}`}
      >
        {documentKindLabel(intl, row.currentVersion.kind)}
      </span>
    ),
  },
  {
    key: "format",
    header: <FormattedMessage id="documents.list.column.format" defaultMessage="Format" />,
    label: (intl) =>
      intl.formatMessage({ id: "documents.list.column.format", defaultMessage: "Format" }),
    defaultWidth: 96,
    minWidth: 72,
    render: (row) => (
      <span className="text-muted">
        {formatName(row.currentVersion.originalFilename, row.currentVersion.mimeType)}
      </span>
    ),
  },
  {
    key: "size",
    header: <FormattedMessage id="documents.list.column.size" defaultMessage="Size" />,
    label: (intl) =>
      intl.formatMessage({ id: "documents.list.column.size", defaultMessage: "Size" }),
    defaultWidth: 104,
    minWidth: 72,
    render: (row) => formatFileSize(row.currentVersion.byteSize),
  },
  {
    key: "versions",
    header: <FormattedMessage id="documents.list.column.versions" defaultMessage="Versions" />,
    label: (intl) =>
      intl.formatMessage({ id: "documents.list.column.versions", defaultMessage: "Versions" }),
    defaultWidth: 104,
    minWidth: 72,
    render: (row) => row.versionCount,
  },
  {
    key: "uploader",
    header: <FormattedMessage id="documents.list.column.uploader" defaultMessage="Uploader" />,
    label: (intl) =>
      intl.formatMessage({ id: "documents.list.column.uploader", defaultMessage: "Uploader" }),
    defaultWidth: 176,
    minWidth: 112,
    render: (row) => (
      <span
        className={`flex min-w-0 items-center gap-2 ${row.currentVersion.uploadedBy.archived ? "opacity-50" : ""}`}
      >
        <Avatar
          name={row.currentVersion.uploadedBy.displayName}
          image={row.currentVersion.uploadedBy.image}
          className="size-6"
        />
        <span className="truncate">{row.currentVersion.uploadedBy.displayName}</span>
      </span>
    ),
  },
  {
    key: "uploaded",
    header: <FormattedMessage id="documents.list.column.uploaded" defaultMessage="Uploaded" />,
    label: (intl) =>
      intl.formatMessage({ id: "documents.list.column.uploaded", defaultMessage: "Uploaded" }),
    defaultWidth: 136,
    minWidth: 88,
    render: (row) => (
      <span className="text-muted">{formatRelativeOrShort(row.currentVersion.createdAt)}</span>
    ),
  },
];

export const DOCUMENTS_CATALOGUE: ColumnCatalogue<RepositoryDocument> = {
  surface: "documents",
  columns: COLUMNS,
  defaultColumnKeys: [
    "title",
    "owner",
    "kind",
    "format",
    "size",
    "versions",
    "uploader",
    "uploaded",
  ],
  flexColumnKey: "title",
};
