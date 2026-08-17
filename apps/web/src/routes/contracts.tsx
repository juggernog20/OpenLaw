// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Contracts destination (M8), reduced to what the contract record
 * carries so far: the list (reference, title, primary counterparty,
 * type, status, value, Owner — ordered newest reference first by the
 * API, each row opening its record page at `/contracts/<number>`), the
 * create dialog that takes a title, a type, and whatever fields that
 * type hard-requires (CTR-016/MTR-014 — the dialog grows them the
 * moment a type is picked, and creation is refused while one is empty),
 * an empty state that says what the module is, and the show-archived
 * toggle with a row-level restore. The C1 mock's remaining columns — risk and expiry — join
 * with the tickets that add those fields to the record.
 *
 * A confidential row carries DES-009's Tier 1 marker beside its title,
 * where the C1 mock draws it. The list is the one surface in this build
 * that renders a contract title outside the record page, so it is the
 * one place the marker goes today. A viewer who cannot reach a
 * confidential record gets no row for it at all — the API narrowed the
 * list (DD-014, CTR-021) — so the marker marks records, never absences.
 *
 * The destination takes Member+ and Contributors (CTR-021). A Contributor's
 * list is the contracts they hold a `contract_team` row on — the API
 * does that narrowing, and an empty answer is the list's own empty
 * state, never a refusal. The page reads for them: no create, no
 * restore, no picker reads. Business Users are bounced home; the API's
 * 403 is the real refusal.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, redirect, useLoaderData, useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { FilePen, FileText, Plus } from "lucide-react";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import {
  contractReference,
  formatContractValue,
  STAGE_PILL,
  type ContractRow,
  type RegistryEntity,
  type UserOption,
} from "../lib/contracts";
import { problemDetail } from "../lib/messages";
import { canReadContracts, isMemberPlus } from "../lib/roles";
import { currentUser, needsSetup } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { Avatar } from "../components/avatar";
import { ConfidentialMarker } from "../components/confidential-marker";
import { CreateContractDialog } from "../components/contracts/create-contract-dialog";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";

export async function contractsLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  // A Business User gets no surface at all, not a disabled one. The
  // API's 403 stands behind this.
  if (!canReadContracts(user.role)) return redirect("/");
  // Whether this viewer may change anything from the list — create a
  // contract, or restore an archived one. Both are Member+, and so are
  // the two picker reads the create dialog needs. A Contributor asks
  // for neither: both seams refuse them, and a page with no create
  // dialog has nothing to fill.
  const canEdit = isMemberPlus(user.role);
  const [list, options, registry] = await Promise.all([
    api.GET("/api/v1/contracts"),
    // The create dialog grows the picked type's hard-required fields
    // (CTR-016), and two of the nine field types name a row: a person
    // or one of our Entities. The people ride the options read; the
    // Entities are the M7 registry's own Member+ list, the same source
    // the record's signing-entity picker reads.
    canEdit ? api.GET("/api/v1/contracts/options") : undefined,
    canEdit ? api.GET("/api/v1/entities") : undefined,
  ]);
  if (!list.data || (canEdit && !(options?.data && registry?.data))) {
    throw new Error("The contract list could not be read.");
  }
  return {
    user,
    canEdit,
    contracts: list.data.contracts,
    /** Where the next page starts, or null when the first page is the
     * whole list (CTR-024). */
    nextCursor: list.data.nextCursor,
    contractTypes: options?.data?.contractTypes ?? [],
    users: options?.data?.users ?? [],
    entities: registry?.data?.entities ?? [],
  };
}

export function ContractsPage() {
  const { user, canEdit, contracts, nextCursor, contractTypes, users, entities } =
    useLoaderData<typeof contractsLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ContractRow[]>(contracts);
  /** Where the next page starts, or null at the end of the list
   * (CTR-024). */
  const [cursor, setCursor] = useState<string | null>(nextCursor);
  /** How many rows the last page brought, and the reference it started
   * at. The first is what the live region announces; the second is the
   * row focus moves to, because that is where what the reader asked for
   * begins (DES-031). */
  const [appended, setAppended] = useState<{ count: number; from: number } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  /** CTR-019: ended contracts drop out of the working list; this brings
   * them back for a viewer who wants to see dead deals. */
  const [showEnded, setShowEnded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  /** One list-level request at a time: a second toggle or restore
   * launched mid-flight would race the first, and the loser's answer
   * would overwrite the winner's list. */
  const [listBusy, setListBusy] = useState(false);

  /** The working list — archived rows never count, whichever view is
   * showing (they are mistakes, not contracts). */
  const liveCount = rows.filter((row) => row.archivedAt === null).length;

  async function signOut() {
    await authClient.signOut();
    void navigate("/auth/login", { replace: true });
  }

  /** Build the query flags the list API needs from the current filter
   * state. Each flag is omitted rather than sent as "false", so the
   * server sees no key and applies its default — the same wire shape
   * every other filter on this page follows. */
  function listQuery(archived: boolean, ended: boolean) {
    return {
      ...(archived ? { includeArchived: "true" as const } : {}),
      ...(ended ? { includeEnded: "true" as const } : {}),
    };
  }

  /** The toggle re-reads either way: archived rows only exist
   * server-side, and coming back should not trust a stale list either. */
  async function toggleArchived(next: boolean) {
    if (listBusy) return;
    setListError(null);
    setListBusy(true);
    const { data } = await api
      .GET("/api/v1/contracts", { params: { query: listQuery(next, showEnded) } })
      .catch(() => ({ data: undefined }))
      .finally(() => setListBusy(false));
    if (!data) {
      setListError(
        intl.formatMessage({
          id: "contracts.listError",
          defaultMessage: "The contract list could not be read. Try again.",
        }),
      );
      return;
    }
    setRows(data.contracts);
    setCursor(data.nextCursor);
    setAppended(null);
    setPageError(null);
    setShowArchived(next);
  }

  /** CTR-019: toggle ended contracts in and out of the list. Re-reads
   * the same way the archived toggle does, because the server is the
   * authority on which contracts are ended. */
  async function toggleEnded(next: boolean) {
    if (listBusy) return;
    setListError(null);
    setListBusy(true);
    const { data } = await api
      .GET("/api/v1/contracts", { params: { query: listQuery(showArchived, next) } })
      .catch(() => ({ data: undefined }))
      .finally(() => setListBusy(false));
    if (!data) {
      setListError(
        intl.formatMessage({
          id: "contracts.listError",
          defaultMessage: "The contract list could not be read. Try again.",
        }),
      );
      return;
    }
    setRows(data.contracts);
    setCursor(data.nextCursor);
    setAppended(null);
    setPageError(null);
    setShowEnded(next);
  }

  /**
   * One more page, appended in place (CTR-024, DES-031).
   *
   * The archived view is carried back, because the cursor is a position
   * in whichever list is on screen and a page read without the filter
   * would be a page of a different list.
   */
  async function showMore() {
    if (listBusy || cursor === null) return;
    setPageError(null);
    setListBusy(true);
    const { data } = await api
      .GET("/api/v1/contracts", {
        params: {
          query: {
            cursor,
            ...listQuery(showArchived, showEnded),
          },
        },
      })
      .catch(() => ({ data: undefined }))
      .finally(() => setListBusy(false));
    if (!data) {
      // Beside the control that failed, and the control stays: the
      // retry is the button already under the reader's hand.
      setPageError(
        intl.formatMessage({
          id: "contracts.moreError",
          defaultMessage: "The next contracts could not be read. Try again.",
        }),
      );
      return;
    }
    const first = data.contracts[0];
    setRows((current) => [...current, ...data.contracts]);
    setCursor(data.nextCursor);
    setAppended(first ? { count: data.contracts.length, from: first.number } : null);
  }

  /** Row-level restore, offered in the archived view — archiving is for
   * mistakes, so the way back sits where the mistake surfaces. */
  async function restoreRow(row: ContractRow) {
    if (listBusy) return;
    setListError(null);
    setListBusy(true);
    const { data, error } = await api
      .POST("/api/v1/contracts/{number}/restore", { params: { path: { number: row.number } } })
      .catch(() => ({ data: undefined, error: undefined }))
      .finally(() => setListBusy(false));
    if (!data) {
      setListError(
        problemDetail(error) ??
          intl.formatMessage(
            {
              id: "contracts.restoreError",
              defaultMessage: "{reference} could not be restored.",
            },
            { reference: contractReference(intl, row.number) },
          ),
      );
      return;
    }
    const restored = data.contract;
    setRows((current) => current.map((existing) => (existing.id === row.id ? restored : existing)));
  }

  /** Absent, not disabled, for a read-only viewer — the same
   * convention the nav and the settings rail follow (SET-002). */
  const createButton = canEdit ? (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus size={16} aria-hidden="true" />
      <FormattedMessage id="contracts.create" defaultMessage="Create contract" />
    </Button>
  ) : undefined;

  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
      subbar={
        <PageSubBar
          title={<FormattedMessage id="contracts.title" defaultMessage="Contracts" />}
          subtitle={
            // What is on screen, and it says so whenever that is not the
            // whole list. There is no total to state (CTR-024), and a
            // bare "50 contracts" over a list of three hundred would be
            // a number the page cannot stand behind.
            cursor === null ? (
              <FormattedMessage
                id="contracts.count"
                defaultMessage="{count, plural, one {# contract} other {# contracts}}"
                values={{ count: liveCount }}
              />
            ) : (
              <FormattedMessage
                id="contracts.countShown"
                defaultMessage="{count, plural, one {# contract shown} other {# contracts shown}}"
                values={{ count: liveCount }}
              />
            )
          }
          primaryAction={createButton}
        />
      }
    >
      <PageTitle
        title={intl.formatMessage({ id: "contracts.title", defaultMessage: "Contracts" })}
      />
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-end gap-2">
          {listError && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {listError}
            </p>
          )}
          <Label htmlFor="contracts-show-ended">
            <FormattedMessage id="contracts.showEnded" defaultMessage="Show ended" />
          </Label>
          <Switch
            id="contracts-show-ended"
            checked={showEnded}
            disabled={listBusy}
            onCheckedChange={(next) => void toggleEnded(next)}
          />
          <Label htmlFor="contracts-show-archived">
            <FormattedMessage id="contracts.showArchived" defaultMessage="Show archived" />
          </Label>
          <Switch
            id="contracts-show-archived"
            checked={showArchived}
            disabled={listBusy}
            onCheckedChange={(next) => void toggleArchived(next)}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyContracts
            archived={showArchived}
            onCreate={canEdit ? () => setCreateOpen(true) : undefined}
          />
        ) : (
          <ContractsTable
            rows={rows}
            showArchived={showArchived}
            busy={listBusy}
            // Restore is a mutation, so a read-only viewer is offered
            // no way to ask for one.
            onRestore={canEdit ? (row) => void restoreRow(row) : undefined}
            focusRow={appended?.from}
            foot={
              cursor === null ? undefined : (
                <>
                  {pageError && (
                    <p role="alert" className="text-xs text-status-danger-fg">
                      {pageError}
                    </p>
                  )}
                  <Button variant="secondary" disabled={listBusy} onClick={() => void showMore()}>
                    <FormattedMessage id="contracts.more" defaultMessage="Show more" />
                  </Button>
                </>
              )
            }
          />
        )}
        {/* What the press did, for a reader who cannot see the rows
            arrive. Focus lands on the first of them, so this says how
            many followed it (DES-031). */}
        <p aria-live="polite" className="sr-only">
          {appended && (
            <FormattedMessage
              id="contracts.moreAdded"
              defaultMessage="{count, plural, one {# more contract} other {# more contracts}}. {total} shown."
              values={{ count: appended.count, total: rows.length }}
            />
          )}
        </p>
      </div>
      {createOpen && (
        <CreateContractDialog
          contractTypes={contractTypes}
          people={users.map((person: UserOption) => ({
            id: person.id,
            label: person.displayName,
            archived: person.archived,
          }))}
          entities={entities.map((entity: RegistryEntity) => ({
            id: entity.id,
            label: entity.legalName,
          }))}
          onOpenChange={setCreateOpen}
          onCreated={(row) => setRows((current) => [row, ...current])}
        />
      )}
    </AppShell>
  );
}

/** The module's pitch, for the first visit. The C17 mock's second route
 * in — convert an intake request from the Inbox — waits for intake
 * (M20/M21), so the first visit is offered the one door that exists.
 * A Contributor gets the same empty state with no door: they are on no
 * contract yet, and being added to one is what puts a row here. */
function EmptyContracts({
  archived,
  onCreate,
}: Readonly<{ archived: boolean; onCreate?: () => void }>) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
      {/* The destination's own glyph, as the C17 mock and the nav draw it. */}
      <FilePen size={24} aria-hidden="true" className="text-subtle" />
      {/* One static id per line, so every one of them is extracted —
          a composed id is a message the catalog never sees (DES-013). */}
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-semibold">
          {archived ? (
            <FormattedMessage
              id="contracts.empty.archived.title"
              defaultMessage="No archived contracts"
            />
          ) : (
            <FormattedMessage id="contracts.empty.title" defaultMessage="No contracts yet" />
          )}
        </h2>
        <p className="max-w-md text-base text-muted">
          {archived ? (
            <FormattedMessage
              id="contracts.empty.archived.body"
              defaultMessage="Archived contracts are kept out of the way until they are restored."
            />
          ) : onCreate ? (
            <FormattedMessage
              id="contracts.empty.body"
              defaultMessage={
                "A contract is the workspace for work that ends in a signed " +
                "document. Create one when a deal starts; it takes a reference " +
                "you can quote in email."
              }
            />
          ) : (
            // A Contributor cannot make the first one: being added to a
            // contract's team is what puts a row here (DD-015).
            <FormattedMessage
              id="contracts.empty.readOnly.body"
              defaultMessage={
                "Contracts you are added to appear here. Ask a Legal Team " +
                "Member to add you to the ones you work on."
              }
            />
          )}
        </p>
      </div>
      {!archived && onCreate && (
        <Button onClick={onCreate}>
          <Plus size={16} aria-hidden="true" />
          <FormattedMessage id="contracts.create" defaultMessage="Create contract" />
        </Button>
      )}
    </div>
  );
}

/** The list, reduced to the columns the record core carries. The API
 * orders the rows; this renders them. The archived view adds an
 * Archived pill and, for a viewer who may restore, a row-level restore. */
function ContractsTable({
  rows,
  showArchived,
  busy,
  onRestore,
  focusRow,
  foot,
}: Readonly<{
  rows: ContractRow[];
  showArchived: boolean;
  /** The reference of the first row of the page just appended. Focus
   * moves to it, because the rows are what the reader asked for and
   * their first one is where the answer starts (DES-031). */
  focusRow?: number;
  /** The paging foot, or absent at the end of the list. It rides under
   * the table's last rule, inside the same card. */
  foot?: ReactNode;
  /** A list-level request is in flight; row actions stand down. */
  busy: boolean;
  /** Absent for a read-only viewer, so no restore is offered at all. */
  onRestore?: (row: ContractRow) => void;
}>) {
  const intl = useIntl();
  /** The actions column exists only where an action does. */
  const actions = showArchived && onRestore !== undefined;
  /** The row focus is moved to after a page appends. A `tr` is the
   * focus target rather than a cell or the title link, because the row
   * is what arrived — a screen reader lands on the whole of it. */
  const landing = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (focusRow !== undefined) landing.current?.focus();
  }, [focusRow]);
  return (
    <div className="rounded-card border border-border-default bg-raised">
      {/* The horizontal scroll belongs to the table, not to the card:
          the paging foot below must not slide out of reach sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-section-header text-start text-sm font-medium text-muted">
              <th scope="col" className="w-24 px-4 py-2 text-start font-medium">
                <FormattedMessage id="contracts.column.reference" defaultMessage="Reference" />
              </th>
              <th scope="col" className="px-4 py-2 text-start font-medium">
                <FormattedMessage id="contracts.column.title" defaultMessage="Title" />
              </th>
              {/* Their side, where the C1 mock draws it: straight after
                the title, because "who is this with" is the second
                thing a reader scans for. */}
              <th scope="col" className="w-44 px-4 py-2 text-start font-medium">
                <FormattedMessage
                  id="contracts.column.counterparty"
                  defaultMessage="Counterparty"
                />
              </th>
              <th scope="col" className="w-32 px-4 py-2 text-start font-medium">
                <FormattedMessage id="contracts.column.type" defaultMessage="Type" />
              </th>
              <th scope="col" className="w-44 px-4 py-2 text-start font-medium">
                <FormattedMessage id="contracts.column.status" defaultMessage="Status" />
              </th>
              {/* What the contract is worth, where the C1 mock draws it:
                after the status and before the Owner. */}
              <th scope="col" className="w-40 px-4 py-2 text-start font-medium">
                <FormattedMessage id="contracts.column.value" defaultMessage="Value" />
              </th>
              <th scope="col" className="w-48 px-4 py-2 text-start font-medium">
                <FormattedMessage id="contracts.column.owner" defaultMessage="Owner" />
              </th>
              {actions && (
                <th scope="col" className="w-24 px-4 py-2 text-end font-medium">
                  <span className="sr-only">
                    <FormattedMessage id="contracts.column.actions" defaultMessage="Actions" />
                  </span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                // Focusable only while it is the landing row: a table of
                // fifty tab stops nobody asked for is worse than none.
                ref={row.number === focusRow ? landing : undefined}
                tabIndex={row.number === focusRow ? -1 : undefined}
                className="border-t border-border-default"
              >
                <td className="px-4 py-2.5 text-sm text-muted">
                  {contractReference(intl, row.number)}
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
                    <Link
                      to={`/contracts/${row.number}`}
                      className="rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                    >
                      {row.title}
                    </Link>
                    {/* DES-009 Tier 1, where the C1 mock draws it: beside
                      the title, so a walled-off record is told apart
                      while scanning thirty rows. A row is here only
                      because this viewer reaches the record — the API
                      answers no row at all to anyone else — so the
                      marker never doubles as a placeholder (DD-014). */}
                    {row.isConfidential && <ConfidentialMarker />}
                    {row.archivedAt !== null && (
                      <span className="inline-flex rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
                        <FormattedMessage id="contracts.archivedPill" defaultMessage="Archived" />
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-sm">
                  {row.primaryCounterparty ? (
                    // One name per row: the primary is what a list can
                    // show, and the record holds the rest (CTR-011).
                    // The width rides the cell's own content, not the
                    // column hint: a table cell grows to fit, so a long
                    // name needs something to be truncated against.
                    <span className="block w-44 truncate">{row.primaryCounterparty.name}</span>
                  ) : (
                    <span className="text-muted">
                      <FormattedMessage
                        id="contracts.counterpartyNone"
                        defaultMessage="None recorded"
                      />
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-sm text-muted">{row.contractTypeName}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${STAGE_PILL[row.stage]}`}
                  >
                    {row.statusName}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-sm">
                  {row.value ? (
                    formatContractValue(intl, row.value)
                  ) : (
                    // No value recorded is a real state, not a gap: an
                    // NDA is worth nothing and says nothing (CTR-010).
                    <span className="text-muted">
                      <FormattedMessage id="contracts.valueNone" defaultMessage="No value" />
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {row.manager ? (
                    <span
                      className={`flex min-w-0 items-center gap-2 ${row.manager.archived ? "opacity-50" : ""}`}
                    >
                      <Avatar
                        name={row.manager.displayName}
                        image={row.manager.image}
                        className="size-6"
                      />
                      <span className="truncate text-sm">{row.manager.displayName}</span>
                    </span>
                  ) : (
                    // Unassigned is a real state — the contract is in
                    // triage until someone takes it (CTR-004).
                    <span className="text-sm text-muted">
                      <FormattedMessage
                        id="contracts.ownerUnassigned"
                        defaultMessage="Unassigned"
                      />
                    </span>
                  )}
                </td>
                {actions && (
                  <td className="px-4 py-2.5 text-end">
                    {row.archivedAt !== null && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        aria-label={intl.formatMessage(
                          { id: "contracts.restoreRow", defaultMessage: "Restore {title}" },
                          { title: row.title },
                        )}
                        onClick={() => onRestore(row)}
                      >
                        <FormattedMessage id="contracts.record.restore" defaultMessage="Restore" />
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Under the table's last rule and inside its card, so the control
          reads as part of the list rather than as a page action
          (DES-031). */}
      {foot && (
        <div className="flex items-center justify-between gap-3 border-t border-border-default px-4 py-3">
          {foot}
        </div>
      )}
    </div>
  );
}
