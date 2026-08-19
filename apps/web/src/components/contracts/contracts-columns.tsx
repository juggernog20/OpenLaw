// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What the contracts list can draw (DES-046, DD-019 clause 7).
 *
 * The catalogue is the surface's contract with its own saved views: a
 * stored layout is resolved against this list, and a column that is not
 * here is read past rather than rendered. So this is a first-class thing
 * with stable keys, not an ordering of JSX — renaming a key orphans it out
 * of every view that named it.
 *
 * **Seventeen columns, seven of them on by default.** The seven are the
 * ones the C1 mock draws and the list shipped with. The other ten are
 * fields the row already carries — CTR-005's risk and priority, CTR-006's
 * term dates and the two counts derived from them, CTR-011's signing
 * entity, and the two timestamps — and every one of them is what somebody
 * came to this list for on some day. A renewals sweep wants expiry and the
 * notice deadline; a triage pass wants Owner and status.
 *
 * **Sortable is not the same as shown.** A column offers a sort by naming
 * an API sort key, and some of these deliberately name none: the notice
 * deadline, the days remaining, and the renewal proposal are derived at
 * read, so no index can serve an ordering the row does not hold (CTR-006),
 * and the value is an amount, a currency, and a cadence with no honest
 * single order between them (CTR-010).
 */

import { Link } from "react-router";
import { FormattedMessage } from "react-intl";
import type { IntlShape } from "react-intl";
import { FileText } from "lucide-react";
import { formatShortDate } from "../../lib/format";
import {
  contractReference,
  formatContractValue,
  riskLabel,
  severityLabel,
  termTypeLabel,
  STAGE_PILL,
  type ContractRow,
} from "../../lib/contracts";
import type { ColumnCatalogue, ColumnDef } from "../../lib/list-views";
import { Avatar } from "../avatar";
import { ConfidentialMarker } from "../confidential-marker";

/** Nothing recorded, said the same way in every cell that can be empty.
 * A blank cell reads as a rendering fault; a named absence reads as a
 * fact about the contract. */
function NotRecorded() {
  return (
    <span className="text-muted">
      <FormattedMessage id="contracts.column.none" defaultMessage="—" />
    </span>
  );
}

const COLUMNS: ColumnDef<ContractRow>[] = [
  {
    key: "reference",
    header: <FormattedMessage id="contracts.column.reference" defaultMessage="Reference" />,
    label: (intl) =>
      intl.formatMessage({ id: "contracts.column.reference", defaultMessage: "Reference" }),
    // Wide enough for the word "Reference" itself, which is the widest
    // thing in this column — the C-1 under it needs a third of it. The
    // budget is the text plus the cell's 16px insets plus the 20px the
    // sort glyph's slot holds open whether or not the glyph is showing.
    defaultWidth: 128,
    minWidth: 96,
    sortKey: "number",
    render: (row, intl) => (
      <span className="text-muted">{contractReference(intl, row.number)}</span>
    ),
  },
  {
    key: "title",
    header: <FormattedMessage id="contracts.column.title" defaultMessage="Title" />,
    label: (intl) => intl.formatMessage({ id: "contracts.column.title", defaultMessage: "Title" }),
    // The catalogue's stretching column: the built-in layout gives it the
    // card's spare width, because a contract title is the longest and least
    // predictable thing on a row (DES-046 clause 1). This is the column the
    // old table starved. The number is what it takes once a drag pins it,
    // and the floor is what the table's own min-width is built on.
    defaultWidth: 280,
    minWidth: 200,
    required: true,
    sortKey: "title",
    render: (row) => (
      <span className="flex items-center gap-2.5">
        <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
        <Link
          to={`/contracts/${String(row.number)}`}
          className="truncate rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
        >
          {row.title}
        </Link>
        {/* DES-009 Tier 1, beside the title, so a walled-off record is
            told apart while scanning thirty rows. A row is here only
            because this viewer reaches the record — the API answers no
            row at all to anyone else — so the marker never doubles as a
            placeholder (DD-014). */}
        {row.isConfidential && <ConfidentialMarker />}
        {row.archivedAt !== null && (
          <span className="inline-flex shrink-0 rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
            <FormattedMessage id="contracts.archivedPill" defaultMessage="Archived" />
          </span>
        )}
      </span>
    ),
  },
  {
    key: "counterparty",
    header: <FormattedMessage id="contracts.column.counterparty" defaultMessage="Counterparty" />,
    label: (intl) =>
      intl.formatMessage({ id: "contracts.column.counterparty", defaultMessage: "Counterparty" }),
    defaultWidth: 150,
    minWidth: 100,
    sortKey: "counterparty",
    // One name per row: the primary is what a list can show, and the
    // record holds the rest (CTR-011). The cell needs no truncating span
    // of its own now — the <col> is the width, and the row truncates.
    render: (row) =>
      row.primaryCounterparty ? (
        row.primaryCounterparty.name
      ) : (
        <span className="text-muted">
          <FormattedMessage id="contracts.counterpartyNone" defaultMessage="None recorded" />
        </span>
      ),
  },
  {
    key: "type",
    header: <FormattedMessage id="contracts.column.type" defaultMessage="Type" />,
    label: (intl) => intl.formatMessage({ id: "contracts.column.type", defaultMessage: "Type" }),
    defaultWidth: 112,
    minWidth: 90,
    sortKey: "type",
    render: (row) => <span className="text-muted">{row.contractTypeName}</span>,
  },
  {
    key: "status",
    header: <FormattedMessage id="contracts.column.status" defaultMessage="Status" />,
    label: (intl) =>
      intl.formatMessage({ id: "contracts.column.status", defaultMessage: "Status" }),
    defaultWidth: 140,
    minWidth: 110,
    // Orders by the pipeline an Administrator arranged, not the alphabet
    // — the seam's own note says why (CTR-001).
    sortKey: "status",
    render: (row) => (
      <span
        className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${STAGE_PILL[row.stage]}`}
      >
        {row.statusName}
      </span>
    ),
  },
  {
    key: "value",
    header: <FormattedMessage id="contracts.column.value" defaultMessage="Value" />,
    label: (intl) => intl.formatMessage({ id: "contracts.column.value", defaultMessage: "Value" }),
    defaultWidth: 130,
    minWidth: 100,
    // No sort: an amount, a currency, and a cadence have no single order
    // without an exchange rate (CTR-010).
    render: (row, intl) =>
      row.value ? (
        formatContractValue(intl, row.value)
      ) : (
        // No value recorded is a real state, not a gap: an NDA is worth
        // nothing and says nothing (CTR-010).
        <span className="text-muted">
          <FormattedMessage id="contracts.valueNone" defaultMessage="No value" />
        </span>
      ),
  },
  {
    key: "owner",
    header: <FormattedMessage id="contracts.column.owner" defaultMessage="Owner" />,
    label: (intl) => intl.formatMessage({ id: "contracts.column.owner", defaultMessage: "Owner" }),
    defaultWidth: 160,
    minWidth: 120,
    sortKey: "owner",
    render: (row) =>
      row.manager ? (
        <span
          className={`flex min-w-0 items-center gap-2 ${row.manager.archived ? "opacity-50" : ""}`}
        >
          <Avatar name={row.manager.displayName} image={row.manager.image} className="size-6" />
          <span className="truncate">{row.manager.displayName}</span>
        </span>
      ) : (
        // Unassigned is a real state — the contract is in triage until
        // someone takes it (CTR-004).
        <span className="text-muted">
          <FormattedMessage id="contracts.ownerUnassigned" defaultMessage="Unassigned" />
        </span>
      ),
  },
  {
    key: "risk",
    header: <FormattedMessage id="contracts.column.risk" defaultMessage="Risk" />,
    label: (intl) => intl.formatMessage({ id: "contracts.column.risk", defaultMessage: "Risk" }),
    defaultWidth: 110,
    minWidth: 90,
    sortKey: "risk",
    // Not assessed is not low (CTR-005), and `riskLabel` is the one place
    // that distinction is worded.
    render: (row, intl) => (
      <span className={row.risk === null ? "text-muted" : undefined}>
        {riskLabel(intl, row.risk)}
      </span>
    ),
  },
  {
    key: "priority",
    header: <FormattedMessage id="contracts.column.priority" defaultMessage="Priority" />,
    label: (intl) =>
      intl.formatMessage({ id: "contracts.column.priority", defaultMessage: "Priority" }),
    defaultWidth: 110,
    minWidth: 90,
    sortKey: "priority",
    render: (row, intl) => severityLabel(intl, row.priority),
  },
  {
    key: "effectiveDate",
    header: <FormattedMessage id="contracts.column.effectiveDate" defaultMessage="Starts" />,
    label: (intl) =>
      intl.formatMessage({ id: "contracts.column.effectiveDate", defaultMessage: "Starts" }),
    defaultWidth: 120,
    minWidth: 100,
    sortKey: "effectiveDate",
    render: (row) => (row.effectiveDate ? formatShortDate(row.effectiveDate) : <NotRecorded />),
  },
  {
    key: "expiryDate",
    header: <FormattedMessage id="contracts.column.expiryDate" defaultMessage="Expires" />,
    label: (intl) =>
      intl.formatMessage({ id: "contracts.column.expiryDate", defaultMessage: "Expires" }),
    defaultWidth: 120,
    minWidth: 100,
    sortKey: "expiryDate",
    render: (row) =>
      row.expiryDate ? (
        formatShortDate(row.expiryDate)
      ) : row.termType === "evergreen" ? (
        // An evergreen contract has no end, which is not a missing date
        // (CTR-006).
        <span className="text-muted">
          <FormattedMessage id="contracts.column.noEnd" defaultMessage="No end" />
        </span>
      ) : (
        <NotRecorded />
      ),
  },
  {
    key: "noticeDeadline",
    header: <FormattedMessage id="contracts.column.noticeDeadline" defaultMessage="Notice by" />,
    label: (intl) =>
      intl.formatMessage({ id: "contracts.column.noticeDeadline", defaultMessage: "Notice by" }),
    defaultWidth: 120,
    minWidth: 100,
    // Derived at read and never stored (CTR-006), so there is nothing to
    // order on.
    render: (row) => (row.noticeDeadline ? formatShortDate(row.noticeDeadline) : <NotRecorded />),
  },
  {
    key: "daysRemaining",
    header: <FormattedMessage id="contracts.column.daysRemaining" defaultMessage="Term left" />,
    label: (intl) =>
      intl.formatMessage({ id: "contracts.column.daysRemaining", defaultMessage: "Term left" }),
    defaultWidth: 120,
    minWidth: 100,
    // A count of days, not a relative phrase. "Next year" is true of any
    // date between 6 and 18 months out, and a renewals sweep is reading
    // this column to tell those apart. The overrun wording carries the
    // same count the other way, because a term that ran out last month
    // is a fact the row still has to state.
    render: (row, intl) => {
      const days = row.daysRemaining;
      if (days === null) return <NotRecorded />;
      return days < 0
        ? intl.formatMessage(
            {
              id: "contracts.column.termOverrun",
              defaultMessage: "{days, plural, one {# day over} other {# days over}}",
            },
            { days: -days },
          )
        : intl.formatMessage(
            {
              id: "contracts.column.termLeft",
              defaultMessage: "{days, plural, one {# day} other {# days}}",
            },
            { days },
          );
    },
  },
  {
    key: "termType",
    header: <FormattedMessage id="contracts.column.termType" defaultMessage="Term" />,
    label: (intl) =>
      intl.formatMessage({ id: "contracts.column.termType", defaultMessage: "Term" }),
    defaultWidth: 130,
    minWidth: 100,
    render: (row, intl) => <span className="text-muted">{termTypeLabel(intl, row.termType)}</span>,
  },
  {
    key: "entity",
    header: <FormattedMessage id="contracts.column.entity" defaultMessage="Our entity" />,
    label: (intl) =>
      intl.formatMessage({ id: "contracts.column.entity", defaultMessage: "Our entity" }),
    defaultWidth: 170,
    minWidth: 120,
    // CTR-011's our side, ordered by legal name with case folded — the
    // same shape as the other three name sorts.
    sortKey: "entity",
    render: (row) => row.entity?.legalName ?? <NotRecorded />,
  },
  {
    key: "createdAt",
    header: <FormattedMessage id="contracts.column.createdAt" defaultMessage="Created" />,
    label: (intl) =>
      intl.formatMessage({ id: "contracts.column.createdAt", defaultMessage: "Created" }),
    defaultWidth: 130,
    minWidth: 100,
    sortKey: "createdAt",
    render: (row) => <span className="text-muted">{formatShortDate(row.createdAt)}</span>,
  },
  {
    key: "updatedAt",
    header: <FormattedMessage id="contracts.column.updatedAt" defaultMessage="Updated" />,
    label: (intl) =>
      intl.formatMessage({ id: "contracts.column.updatedAt", defaultMessage: "Updated" }),
    defaultWidth: 130,
    minWidth: 100,
    sortKey: "updatedAt",
    render: (row) => <span className="text-muted">{formatShortDate(row.updatedAt)}</span>,
  },
];

/**
 * The contracts list's catalogue.
 *
 * The default seven are the C1 mock's columns. The six pinned ones sum to
 * 820px, and Title stretches over whatever the card has spare, so the
 * table's own minimum is 820 plus Title's 200px floor — 1020px. The list
 * therefore fits comfortably in a 1280px window and still fits a 1120px
 * one, and below that it scrolls sideways rather than starving the Title
 * (DES-046 clause 1). Title's own 280px is what it takes the moment a drag
 * pins it. Each width is its heading's text plus the cell's 32px of insets
 * plus, on a sortable column, the 20px its sort glyph holds open.
 */
export const CONTRACTS_CATALOGUE: ColumnCatalogue<ContractRow> = {
  surface: "contracts",
  columns: COLUMNS,
  defaultColumnKeys: ["reference", "title", "counterparty", "type", "status", "value", "owner"],
  flexColumnKey: "title",
};

/** Which filters a contracts view carries. The two the list has: CTR-019's
 * ended contracts, and SET-003's archived ones. */
export interface ContractFilters {
  includeEnded: boolean;
  includeArchived: boolean;
}

/** A layout's filter map, read as the two flags the list understands.
 * Anything else a stored view carries is ignored, the same way an unknown
 * column key is (DD-019 clause 7). */
export function contractFilters(filters: Record<string, boolean | string>): ContractFilters {
  return {
    includeEnded: filters.includeEnded === true,
    includeArchived: filters.includeArchived === true,
  };
}

/** The intl label of one column, for a message that has to name it. */
export function columnLabel(intl: IntlShape, key: string): string {
  return COLUMNS.find((column) => column.key === key)?.label(intl) ?? key;
}
