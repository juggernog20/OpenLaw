// SPDX-License-Identifier: AGPL-3.0-only

/** The scoped, filterable, saved-view Matters destination. */
import { useEffect, useRef, useState } from "react";
import { BriefcaseBusiness, Plus } from "lucide-react";
import { MATTER_SORT_KEYS, type MatterSortKey } from "@openlaw/shared";
import { FormattedMessage, useIntl } from "react-intl";
import {
  redirect,
  useLoaderData,
  useNavigate,
  useNavigation,
  type LoaderFunctionArgs,
} from "react-router";
import { api } from "../lib/api";
import { resolveTimeZone } from "../lib/format";
import {
  MATTER_FILTER_KEYS,
  filterQuery,
  filterSearch,
  initialView,
  layoutFromUrl,
} from "../lib/record-filters";
import { RecordFilterBar } from "../components/table/record-filter-bar";
import { useRecordFilterDefinitions } from "../components/table/record-filter-definitions";
import { readRegistry } from "../lib/entities";

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
import { matterPath, type MatterRow } from "../lib/matters";
import { canReadMatters, isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { CreateMatterDialog } from "../components/matters/create-matter-dialog";
import { MATTERS_CATALOGUE as CATALOGUE } from "../components/matters/matters-columns";
import { PageTitle } from "../components/page-title";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { ColumnMenu } from "../components/table/column-menu";
import { ManagedTable } from "../components/table/managed-table";
import { ViewsMenu } from "../components/table/views-menu";
import { Button } from "../components/ui/button";

function isMatterSortKey(value: string): value is MatterSortKey {
  return (MATTER_SORT_KEYS as readonly string[]).includes(value);
}

function listQuery(layout: Layout) {
  const sort =
    layout.sort && isMatterSortKey(layout.sort.key)
      ? { key: layout.sort.key, dir: layout.sort.dir }
      : null;
  return {
    ...filterQuery(layout.filters, MATTER_FILTER_KEYS),
    ...(layout.filters.openedFrom || layout.filters.openedTo
      ? { timeZone: resolveTimeZone() }
      : {}),
    ...(sort ? { sort: sort.key, dir: sort.dir } : {}),
  };
}

function sameQuery(a: Layout, b: Layout): boolean {
  return JSON.stringify(listQuery(a)) === JSON.stringify(listQuery(b));
}

export async function mattersLoader(args?: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!canReadMatters(user.role)) return redirect("/");
  const canCreate = isMemberPlus(user.role);
  const views = await readViews(CATALOGUE.surface);
  const opensOn = initialView(views, args);
  const layout = layoutFromUrl(
    opensOn ? resolveLayout(CATALOGUE, opensOn.layout) : builtInLayout(CATALOGUE),
    args,
    MATTER_FILTER_KEYS,
    MATTER_SORT_KEYS,
  );
  const [list, options, entities, filterOptions] = await Promise.all([
    api.GET("/api/v1/matters", { params: { query: listQuery(layout) } }),
    api.GET("/api/v1/matters/options"),
    canCreate ? readRegistry() : undefined,
    api.GET("/api/v1/matters/filter-options"),
  ]);
  if (!filterOptions.data || !list.data || !options.data || (canCreate && !entities?.data)) {
    throw new Error("The matter list could not be read.");
  }
  return {
    filterOptions: filterOptions.data,
    user,
    canCreate,
    matters: list.data.matters,
    total: list.data.total,
    nextCursor: list.data.nextCursor,
    counts: list.data.counts,
    matterTypes: options.data.matterTypes,
    matterStatuses: options.data.matterStatuses,
    users: options.data.users,
    entities: entities?.data?.entities ?? [],
    views,
    layout,
    activeViewId: opensOn?.id ?? null,
  };
}

export function MattersPage() {
  const loaded = useLoaderData<typeof mattersLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  const [rows, setRows] = useState<MatterRow[]>(loaded.matters);
  const [total, setTotal] = useState(loaded.total ?? loaded.matters.length);
  const [cursor, setCursor] = useState<string | null>(loaded.nextCursor);
  const [layout, setLayout] = useState<Layout>(loaded.layout);
  const [views, setViews] = useState<SavedView[]>(loaded.views);
  const [activeViewId, setActiveViewId] = useState<string | null>(loaded.activeViewId);
  const [createOpen, setCreateOpen] = useState(false);
  const [requestBusy, setBusy] = useState(false);
  const navigation = useNavigation();
  const busy = requestBusy || navigation.state !== "idle";
  const readVersion = useRef(0);
  useEffect(() => {
    readVersion.current += 1;
  }, [loaded, navigation.location]);
  const [listError, setListError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [appended, setAppended] = useState<{ count: number; from: string } | null>(null);

  const previousLoad = useRef(loaded);
  useEffect(() => {
    const previous = previousLoad.current;
    previousLoad.current = loaded;
    if (previous === loaded) return;
    setRows(loaded.matters);
    setCursor(loaded.nextCursor);
    setTotal(loaded.total ?? loaded.matters.length);
    setLayout((current) =>
      previous.activeViewId === loaded.activeViewId
        ? { ...current, filters: loaded.layout.filters, sort: loaded.layout.sort }
        : loaded.layout,
    );
    setViews(loaded.views);
    setActiveViewId(loaded.activeViewId);
    setAppended(null);
    setPageError(null);
    setListError(null);
  }, [loaded]);
  const definitions = useRecordFilterDefinitions("matters", loaded.filterOptions);

  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  const storedLayout = activeView
    ? resolveLayout(CATALOGUE, activeView.layout)
    : builtInLayout(CATALOGUE);
  const modified = !sameLayout(layout, storedLayout);

  // A filter that answers nothing is not the module's first visit: the
  // empty state has to say which of the two it is.
  const narrowed = Object.keys(filterQuery(layout.filters, MATTER_FILTER_KEYS)).some(
    (key) => !key.startsWith("include"),
  );

  const signOut = useSignOut("/auth/login");

  async function commit(next: Layout, nextActiveId: string | null = activeViewId) {
    if (sameQuery(layout, next)) {
      setLayout(next);
      setActiveViewId(nextActiveId);
      if (nextActiveId !== activeViewId)
        await navigate(
          { search: filterSearch(next, MATTER_FILTER_KEYS, nextActiveId) },
          { preventScrollReset: true },
        );
      return;
    }
    if (busy) return;
    setListError(null);
    setBusy(true);
    const version = ++readVersion.current;
    const { data } = await api
      .GET("/api/v1/matters", { params: { query: listQuery(next) } })
      .catch(() => ({ data: undefined }))
      .finally(() => setBusy(false));
    if (version !== readVersion.current) return;
    if (!data) {
      setListError(
        intl.formatMessage({
          id: "matters.listError",
          defaultMessage: "The matter list could not be read. Try again.",
        }),
      );
      return;
    }
    setRows(data.matters);
    setCursor(data.nextCursor);
    setTotal(data.total ?? data.matters.length);
    setAppended(null);
    setPageError(null);
    setLayout(next);
    setActiveViewId(nextActiveId);
    await navigate(
      { search: filterSearch(next, MATTER_FILTER_KEYS, nextActiveId) },
      { preventScrollReset: true },
    );
  }

  async function showMore() {
    if (busy || cursor === null) return;
    setPageError(null);
    setBusy(true);
    const version = ++readVersion.current;
    const { data } = await api
      .GET("/api/v1/matters", { params: { query: { cursor, ...listQuery(layout) } } })
      .catch(() => ({ data: undefined }))
      .finally(() => setBusy(false));
    if (version !== readVersion.current) return;
    if (!data) {
      setPageError(
        intl.formatMessage({
          id: "matters.moreError",
          defaultMessage: "The next matters could not be read. Try again.",
        }),
      );
      return;
    }
    const first = data.matters[0];
    setRows((current) => [...current, ...data.matters]);
    setCursor(data.nextCursor);
    setTotal(data.total ?? data.matters.length);
    setAppended(first ? { count: data.matters.length, from: first.id } : null);
  }

  function selectView(view: SavedView | null) {
    void commit(
      view ? resolveLayout(CATALOGUE, view.layout) : builtInLayout(CATALOGUE),
      view?.id ?? null,
    );
  }

  function adopt(next: SavedView[], activeId: string | null) {
    setViews(next);
    setActiveViewId(activeId);
    if (activeId !== activeViewId)
      void navigate(
        { search: filterSearch(layout, MATTER_FILTER_KEYS, activeId) },
        { replace: true, preventScrollReset: true },
      );
  }

  const createButton = loaded.canCreate ? (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus size={16} aria-hidden="true" />
      <FormattedMessage id="matters.new" defaultMessage="New matter" />
    </Button>
  ) : undefined;

  const tableControls = (
    <>
      <ViewsMenu
        views={views}
        activeView={activeView}
        modified={modified}
        busy={busy}
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
      user={loaded.user}
      onSignOut={() => void signOut()}
      subbar={
        <PageSubBar
          title={<FormattedMessage id="matters.title" defaultMessage="Matters" />}
          subtitle={
            rows.length < total ? (
              <FormattedMessage
                id="matters.filteredCount"
                defaultMessage="{shown} of {total, plural, one {# matter} other {# matters}}"
                values={{ shown: rows.length, total }}
              />
            ) : (
              <FormattedMessage
                id="matters.matchingCount"
                defaultMessage="{count, plural, one {# matter} other {# matters}}"
                values={{ count: total }}
              />
            )
          }

          actions={tableControls}
          primaryAction={createButton}
        />
      }
    >
      <PageTitle title={intl.formatMessage({ id: "matters.title", defaultMessage: "Matters" })} />
      <div className="flex flex-col gap-3">
        <RecordFilterBar
          definitions={definitions}
          values={layout.filters}
          busy={busy}
          error={listError}
          onChange={(filters) => void commit({ ...layout, filters })}
        />
        {rows.length === 0 ? (
          <EmptyMatters
            narrowed={narrowed}
            onCreate={loaded.canCreate ? () => setCreateOpen(true) : undefined}
          />
        ) : (
          <ManagedTable
            catalogue={CATALOGUE}
            layout={layout}
            rows={rows}
            rowKey={(row) => row.id}
            onLayoutChange={(next) => void commit(next)}
            focusRowKey={appended?.from}
            foot={
              cursor === null ? undefined : (
                <>
                  {pageError && (
                    <p role="alert" className="text-xs text-status-danger-fg">
                      {pageError}
                    </p>
                  )}
                  <Button variant="secondary" disabled={busy} onClick={() => void showMore()}>
                    <FormattedMessage id="matters.more" defaultMessage="Show more" />
                  </Button>
                </>
              )
            }
          />
        )}
        <p aria-live="polite" className="sr-only">
          {appended && (
            <FormattedMessage
              id="matters.moreAdded"
              defaultMessage="{count, plural, one {# more matter} other {# more matters}}. {total} shown."
              values={{ count: appended.count, total: rows.length }}
            />
          )}
        </p>
      </div>
      {createOpen && (
        <CreateMatterDialog
          matterTypes={loaded.matterTypes}
          users={loaded.users}
          entities={loaded.entities.map((entity) => ({ id: entity.id, label: entity.legalName }))}
          onOpenChange={setCreateOpen}
          onCreated={(matter) => void navigate(matterPath(matter.number))}
        />
      )}
    </AppShell>
  );
}

/** The module's pitch on the first visit, or the plain fact that the
 * filters on screen match nothing. New matter is offered only on the
 * first: a filter that answers nothing is cleared, not created into. */
function EmptyMatters({
  narrowed,
  onCreate,
}: Readonly<{ narrowed: boolean; onCreate?: () => void }>) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
      <BriefcaseBusiness size={24} aria-hidden="true" className="text-subtle" />
      <div>
        <h2 className="text-md font-semibold">
          {narrowed ? (
            <FormattedMessage
              id="matters.empty.narrowed.title"
              defaultMessage="No matters match these filters"
            />
          ) : (
            <FormattedMessage id="matters.empty.title" defaultMessage="No matters yet" />
          )}
        </h2>
        <p className="mt-1 max-w-md text-base text-muted">
          {narrowed ? (
            <FormattedMessage
              id="matters.empty.narrowed.body"
              defaultMessage="Clear a filter to widen the list."
            />
          ) : (
            <FormattedMessage
              id="matters.empty.body"
              defaultMessage="Matters organize legal work that is not centered on a contract."
            />
          )}
        </p>
      </div>
      {!narrowed && onCreate && (
        <Button onClick={onCreate}>
          <Plus size={16} aria-hidden="true" />
          <FormattedMessage id="matters.new" defaultMessage="New matter" />
        </Button>
      )}
    </div>
  );
}
