// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Contracts destination (M8), now a **managed table** (DES-046) whose
 * columns the reader chooses and whose layout they can save (DD-019).
 *
 * The list draws seventeen possible columns, seven of them by default —
 * the C1 mock's set, which is what shipped. Which seven, in what order, at
 * what widths, under which filters, sorted how: all of it is one `Layout`
 * this page holds, and a saved view is that layout with a name on it.
 *
 * **The page owns the layout, and the table only asks.** A width drag, a
 * sort press, and a filter toggle all arrive here as one `Layout`, and this
 * is the one place that decides whether the change needs the server. A
 * column hidden or widened does not: the rows on screen are already the
 * answer. A filter or a sort does, because the server is the authority on
 * which contracts are in the list and in what order — a client-side sort of
 * one 50-row page of a longer list would order the page and call it the
 * list (CTR-024).
 *
 * **Saving is an act** (DD-019 clause 5). The layout on screen is local
 * until the views menu writes it, and the menu says "Modified" while the
 * two differ. So a reader can widen a column to read one long title
 * without editing the view they open on every morning.
 *
 * The rest of the destination is unchanged: the create dialog that grows
 * the picked type's hard-required fields (CTR-016/MTR-014), an empty state
 * that says what the module is, and a row-level restore in the archived
 * view.
 *
 * A confidential row carries DES-009's Tier 1 marker beside its title. A
 * viewer who cannot reach a confidential record gets no row for it at all —
 * the API narrowed the list (DD-014, CTR-021) — so the marker marks
 * records, never absences.
 *
 * The destination takes Member+ and Contributors (CTR-021). A Contributor's
 * list is the contracts they hold a `contract_team` row on. The page reads
 * for them: no create, no restore, no picker reads. Their views are still
 * their own — a preference says nothing about a record (DD-019). Business
 * Users are bounced home; the API's 403 is the real refusal.
 */

import { useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { FilePen, Plus } from "lucide-react";
import type { SortDirection } from "@openlaw/shared";
import { api } from "../lib/api";
import {
  contractReference,
  type ContractRow,
  type RegistryEntity,
  type UserOption,
} from "../lib/contracts";
import {
  builtInLayout,
  createView,
  deleteView,
  readViews,
  resolveLayout,
  sameLayout,
  updateView,
  type Layout,
  type SavedView,
} from "../lib/list-views";
import { problemDetail } from "../lib/messages";
import { canReadContracts, isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import {
  CONTRACTS_CATALOGUE as CATALOGUE,
  contractFilters,
} from "../components/contracts/contracts-columns";
import { CreateContractDialog } from "../components/contracts/create-contract-dialog";
import { ColumnMenu } from "../components/table/column-menu";
import { ManagedTable } from "../components/table/managed-table";
import { ViewsMenu } from "../components/table/views-menu";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";

/**
 * The query one layout asks the list for: the two filters, and the sort.
 *
 * Each flag is omitted rather than sent as "false", so the server sees no
 * key and applies its default — the wire shape every filter on this page
 * has always followed. The sort rides the same way, and it has to ride on
 * every page read: a cursor is a position in one ordering (CTR-024).
 */
function listQuery(layout: Layout) {
  const filters = contractFilters(layout.filters);
  return {
    ...(filters.includeArchived ? { includeArchived: "true" as const } : {}),
    ...(filters.includeEnded ? { includeEnded: "true" as const } : {}),
    ...(layout.sort
      ? { sort: layout.sort.key as never, dir: layout.sort.dir as SortDirection }
      : {}),
  };
}

/** Whether two layouts would ask the server different questions. Columns
 * and widths are the client's business; filters and the sort are not. */
function sameQuery(a: Layout, b: Layout): boolean {
  return JSON.stringify(listQuery(a)) === JSON.stringify(listQuery(b));
}

export async function contractsLoader() {
  const user = await requireUser();
  // A Business User gets no surface at all, not a disabled one. The
  // API's 403 stands behind this.
  if (!canReadContracts(user.role)) return redirect("/");
  // Whether this viewer may change anything from the list — create a
  // contract, or restore an archived one. Both are Member+, and so are
  // the two picker reads the create dialog needs.
  const canEdit = isMemberPlus(user.role);

  // The views come first, because the one marked default decides which
  // filters and which sort the list's own read carries (DD-019 clause 6).
  // A failed views read answers an empty list rather than throwing: the
  // built-in layout is always available, and a contracts page that would
  // not render because a preference read failed is worse than one with no
  // saved views in its menu.
  const views = await readViews(CATALOGUE.surface);
  const opensOn = views.find((view) => view.isDefault) ?? null;
  const layout = opensOn ? resolveLayout(CATALOGUE, opensOn.layout) : builtInLayout(CATALOGUE);

  const [list, options, registry] = await Promise.all([
    api.GET("/api/v1/contracts", { params: { query: listQuery(layout) } }),
    // The create dialog grows the picked type's hard-required fields
    // (CTR-016), and two of the nine field types name a row: a person or
    // one of our Entities. The people ride the options read; the Entities
    // are the M7 registry's own Member+ list.
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
    views,
    layout,
    activeViewId: opensOn?.id ?? null,
  };
}

export function ContractsPage() {
  const loaded = useLoaderData<typeof contractsLoader>();
  const { user, canEdit, contractTypes, users, entities } = loaded;
  const intl = useIntl();
  const [rows, setRows] = useState<ContractRow[]>(loaded.contracts);
  /** Where the next page starts, or null at the end of the list
   * (CTR-024). */
  const [cursor, setCursor] = useState<string | null>(loaded.nextCursor);
  /** How many rows the last page brought, and the reference it started
   * at. The first is what the live region announces; the second is the
   * row focus moves to, because that is where what the reader asked for
   * begins (DES-031). */
  const [appended, setAppended] = useState<{ count: number; from: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  /** One list-level request at a time: a second toggle or restore
   * launched mid-flight would race the first, and the loser's answer
   * would overwrite the winner's list. */
  const [listBusy, setListBusy] = useState(false);

  /** What the reader is looking at, and the views they could be looking
   * at instead. Both start from the loader, which already resolved the
   * default view against the catalogue. */
  const [layout, setLayout] = useState<Layout>(loaded.layout);
  const [views, setViews] = useState<SavedView[]>(loaded.views);
  const [activeViewId, setActiveViewId] = useState<string | null>(loaded.activeViewId);

  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  /** The layout the active view stores, resolved — or the built-in one
   * when no view is active. This is what "Modified" compares against. */
  const storedLayout = activeView
    ? resolveLayout(CATALOGUE, activeView.layout)
    : builtInLayout(CATALOGUE);
  const modified = !sameLayout(layout, storedLayout);
  const filters = contractFilters(layout.filters);

  /** The working list — archived rows never count, whichever view is
   * showing (they are mistakes, not contracts). */
  const liveCount = rows.filter((row) => row.archivedAt === null).length;

  const signOut = useSignOut("/auth/login");

  /**
   * Every layout change lands here — a width drag, a sort press, a
   * reorder, a filter toggle, or a view being chosen.
   *
   * **The server is asked only when the question changed.** Hiding a
   * column or dragging one wider does not change which contracts are in
   * the list or in what order, so the rows on screen are already the
   * answer and a round-trip would fetch what is already there.
   *
   * **When it is asked, the layout lands only if the read lands.** A
   * failed read leaves the layout, the switches, and the sort arrows
   * exactly as they were, because the alternative is a page whose
   * controls say one thing and whose rows say another — a "Show
   * archived" switch that is on over a list with no archived rows in it.
   * This is the archived toggle's original contract, generalized to every
   * part of a layout that the server has an opinion about.
   */
  async function commit(next: Layout, nextActiveId: string | null = activeViewId) {
    if (sameQuery(layout, next)) {
      setLayout(next);
      setActiveViewId(nextActiveId);
      return;
    }
    // One list-level request at a time: a second toggle launched
    // mid-flight would race the first, and the loser's answer would
    // overwrite the winner's list.
    if (listBusy) return;
    setListError(null);
    setListBusy(true);
    const { data } = await api
      .GET("/api/v1/contracts", { params: { query: listQuery(next) } })
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
    setLayout(next);
    setActiveViewId(nextActiveId);
  }

  /** Toggle one of the two list filters. They live in the layout, so a
   * saved view remembers them (DD-019 clause 2). */
  function toggleFilter(key: "includeEnded" | "includeArchived", on: boolean) {
    void commit({ ...layout, filters: { ...layout.filters, [key]: on } });
  }

  /**
   * One more page, appended in place (CTR-024, DES-031).
   *
   * The whole layout's query is carried back, filters and sort alike: a
   * cursor is a position in one ordering, and a page read under a
   * different one is a page of a different list.
   */
  async function showMore() {
    if (listBusy || cursor === null) return;
    setPageError(null);
    setListBusy(true);
    const { data } = await api
      .GET("/api/v1/contracts", { params: { query: { cursor, ...listQuery(layout) } } })
      .catch(() => ({ data: undefined }))
      .finally(() => setListBusy(false));
    if (!data) {
      // Beside the control that failed, and the control stays: the retry
      // is the button already under the reader's hand.
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
    setAppended(first ? { count: data.contracts.length, from: first.id } : null);
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

  /** Choose a saved view, or the built-in layout. The chosen layout is
   * resolved against the catalogue first, so a view naming a column this
   * build dropped opens without it rather than failing (DD-019 clause 7). */
  function selectView(view: SavedView | null) {
    void commit(
      view ? resolveLayout(CATALOGUE, view.layout) : builtInLayout(CATALOGUE),
      view?.id ?? null,
    );
  }

  /** After any write, the seam answers the whole list of views, so the
   * menu never needs a second read. */
  function adopt(next: SavedView[], activeId: string | null) {
    setViews(next);
    setActiveViewId(activeId);
  }

  /** Absent, not disabled, for a read-only viewer — the same convention
   * the nav and the settings rail follow (SET-002). */
  const createButton = canEdit ? (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus size={16} aria-hidden="true" />
      <FormattedMessage id="contracts.create" defaultMessage="Create contract" />
    </Button>
  ) : undefined;

  /** Whether the page holds a row the restore column could act on. The
   * filter being on is not the same thing: an organisation with nothing
   * archived turns it on and the answer comes back unchanged, so the
   * column would be a blank heading over a column of blank cells. */
  const hasArchivedRow = rows.some((row) => row.archivedAt !== null);

  /** Both table controls are absent while the list has no rows to
   * arrange (DES-046 clause 7). */
  const tableControls =
    rows.length === 0 ? undefined : (
      <>
        <ViewsMenu
          views={views}
          activeView={activeView}
          modified={modified}
          busy={listBusy}
          onSelect={selectView}
          onSave={async () => {
            if (!activeView) return;
            adopt(await updateView(activeView.id, { config: layout }), activeView.id);
          }}
          onSaveAs={async (name) => {
            const next = await createView(CATALOGUE.surface, name, layout);
            adopt(next, next.find((view) => view.name === name)?.id ?? null);
          }}
          onRename={async (name) => {
            if (!activeView) return;
            adopt(await updateView(activeView.id, { name }), activeView.id);
          }}
          onSetDefault={async () => {
            if (!activeView) return;
            adopt(await updateView(activeView.id, { isDefault: true }), activeView.id);
          }}
          onDelete={async (view) => {
            setViews(await deleteView(view.id));
            await commit(builtInLayout(CATALOGUE), null);
          }}
          onReset={() => void commit(storedLayout)}
        />
        <ColumnMenu
          catalogue={CATALOGUE}
          layout={layout}
          onLayoutChange={(next) => void commit(next)}
        />
      </>
    );

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
          actions={tableControls}
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
            checked={filters.includeEnded}
            disabled={listBusy}
            onCheckedChange={(next) => toggleFilter("includeEnded", next)}
          />
          <Label htmlFor="contracts-show-archived">
            <FormattedMessage id="contracts.showArchived" defaultMessage="Show archived" />
          </Label>
          <Switch
            id="contracts-show-archived"
            checked={filters.includeArchived}
            disabled={listBusy}
            onCheckedChange={(next) => toggleFilter("includeArchived", next)}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyContracts
            archived={filters.includeArchived}
            onCreate={canEdit ? () => setCreateOpen(true) : undefined}
          />
        ) : (
          <ManagedTable
            catalogue={CATALOGUE}
            layout={layout}
            rows={rows}
            rowKey={(row) => row.id}
            onLayoutChange={(next) => void commit(next)}
            focusRowKey={appended?.from}
            // The actions column exists only where an action does: a row
            // to restore, and a viewer who may ask for one — restore is a
            // mutation, so a read-only viewer is offered no way in.
            actionsColumn={
              hasArchivedRow && canEdit
                ? {
                    label: intl.formatMessage({
                      id: "contracts.column.actions",
                      defaultMessage: "Actions",
                    }),
                    width: 108,
                    render: (row) =>
                      row.archivedAt === null ? null : (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={listBusy}
                          aria-label={intl.formatMessage(
                            { id: "contracts.restoreRow", defaultMessage: "Restore {title}" },
                            { title: row.title },
                          )}
                          onClick={() => void restoreRow(row)}
                        >
                          <FormattedMessage
                            id="contracts.record.restore"
                            defaultMessage="Restore"
                          />
                        </Button>
                      ),
                  }
                : undefined
            }
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
