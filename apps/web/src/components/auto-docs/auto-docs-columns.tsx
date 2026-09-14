// SPDX-License-Identifier: AGPL-3.0-only

import { defineMessages, FormattedMessage, type MessageDescriptor } from "react-intl";
import { Link } from "react-router";
import type { AutoDocAnswer, AutoDocOptions } from "../../lib/auto-docs";
import { formatShortDate } from "../../lib/format";
import type { TableCatalogue, ColumnDef, Layout } from "../../lib/list-views";

type AutoDocRow = AutoDocAnswer["autoDoc"];
export type AutoDocTableRow = AutoDocRow & {
  targetTypeName: string | null;
  legalOwnerName: string | null;
  entityName: string | null;
};

const messages = defineMessages({
  name: { id: "autoDocs.name", defaultMessage: "Name" },
  state: { id: "autoDocs.stateFilter", defaultMessage: "State" },
  audience: { id: "autoDocs.audience", defaultMessage: "Audience" },
  targetTypeName: { id: "autoDocs.targetType", defaultMessage: "Target Contract Type" },
  formats: { id: "autoDocs.column.formats", defaultMessage: "Output formats" },
  legalOwnerName: { id: "autoDocs.column.legalOwner", defaultMessage: "Default Legal Owner" },
  entityName: { id: "autoDocs.column.entity", defaultMessage: "Fixed Entity" },
  createdAt: { id: "autoDocs.column.created", defaultMessage: "Created" },
  updatedAt: { id: "autoDocs.column.updated", defaultMessage: "Updated" },
  publishedAt: { id: "autoDocs.column.published", defaultMessage: "Published" },
});

function column(
  key: keyof typeof messages,
  render: ColumnDef<AutoDocTableRow>["render"],
  width = 144,
): ColumnDef<AutoDocTableRow> {
  const message: MessageDescriptor = messages[key];
  return {
    key,
    header: <FormattedMessage {...message} />,
    label: (intl) => intl.formatMessage(message),
    defaultWidth: width,
    minWidth: key === "name" ? 240 : 100,
    sortKey: key,
    render,
  };
}

function ReferenceValue({ id, name }: { id: string | null; name: string | null }) {
  return (
    <span className="text-muted">
      {name ??
        (id ? (
          <FormattedMessage id="autoDocs.column.unavailable" defaultMessage="Unavailable" />
        ) : (
          "—"
        ))}
    </span>
  );
}

export const AUTO_DOCS_CATALOGUE: TableCatalogue<AutoDocTableRow> = {
  flexColumnKey: "name",
  defaultColumnKeys: ["name", "state", "audience", "targetTypeName", "formats", "updatedAt"],
  columns: [
    {
      ...column(
        "name",
        (row) => (
          <div className="min-w-0">
            <Link
              to={`/auto-docs/${encodeURIComponent(row.id)}`}
              className="block truncate rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
            >
              {row.name}
            </Link>
            {row.description && (
              <p className="mt-1 truncate text-xs text-muted" title={row.description}>
                {row.description}
              </p>
            )}
          </div>
        ),
        300,
      ),
      required: true,
    },
    {
      ...column(
        "state",
        (row) => (
          <span
            className={`inline-flex w-max rounded-pill px-2 py-0.5 text-xs font-medium ${
              row.state === "published"
                ? "bg-status-success-bg text-status-success-fg"
                : "bg-status-neutral-bg text-status-neutral-fg"
            }`}
          >
            <FormattedMessage
              id="autoDocs.state"
              defaultMessage="{state, select, draft {Draft} published {Published} other {Archived}}"
              values={{ state: row.state }}
            />
          </span>
        ),
        120,
      ),
      clip: true,
    },
    column("audience", (row) => (
      <FormattedMessage
        id="autoDocs.audienceName"
        defaultMessage="{audience, select, legal_only {Legal only} selected {Selected} other {Everyone}}"
        values={{ audience: row.audience }}
      />
    )),
    column(
      "targetTypeName",
      (row) => <ReferenceValue id={row.targetContractTypeId} name={row.targetTypeName} />,
      192,
    ),
    column(
      "formats",
      (row) => (row.formats === "both" ? "Word + PDF" : row.formats === "docx" ? "Word" : "PDF"),
      136,
    ),
    column(
      "updatedAt",
      (row) => <time dateTime={row.updatedAt}>{formatShortDate(row.updatedAt)}</time>,
      128,
    ),
    column(
      "legalOwnerName",
      (row) => <ReferenceValue id={row.defaultLegalOwnerId} name={row.legalOwnerName} />,
      184,
    ),
    column(
      "entityName",
      (row) => <ReferenceValue id={row.fixedEntityId} name={row.entityName} />,
      184,
    ),
    column(
      "createdAt",
      (row) => <time dateTime={row.createdAt}>{formatShortDate(row.createdAt)}</time>,
      128,
    ),
    column(
      "publishedAt",
      (row) =>
        row.publishedAt ? (
          <time dateTime={row.publishedAt}>{formatShortDate(row.publishedAt)}</time>
        ) : (
          <span className="text-muted">—</span>
        ),
      128,
    ),
  ],
};

export function autoDocTableRows(
  autoDocs: AutoDocRow[],
  options: AutoDocOptions,
): AutoDocTableRow[] {
  const types = new Map(options.contractTypes.map((type) => [type.id, type.displayName]));
  const owners = new Map(options.legalOwners.map((owner) => [owner.id, owner.displayName]));
  const entities = new Map(options.entities.map((entity) => [entity.id, entity.name]));
  return autoDocs.map((row) => ({
    ...row,
    targetTypeName: types.get(row.targetContractTypeId ?? "") ?? null,
    legalOwnerName: owners.get(row.defaultLegalOwnerId ?? "") ?? null,
    entityName: entities.get(row.fixedEntityId ?? "") ?? null,
  }));
}

export function sortAutoDocs(
  rows: AutoDocTableRow[],
  sort: Layout["sort"],
  locale: string,
): AutoDocTableRow[] {
  if (!sort) return rows;
  const key = sort.key as keyof typeof messages;
  if (!Object.hasOwn(messages, key)) return rows;
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  return [...rows].sort((left, right) => {
    const a = left[key],
      b = right[key];
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    return collator.compare(a, b) * (sort.dir === "asc" ? 1 : -1);
  });
}
