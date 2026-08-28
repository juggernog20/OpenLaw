// SPDX-License-Identifier: AGPL-3.0-only

/** The scoped, filterable, saved-view Matters destination. */
import { useState, type ReactNode } from "react";
import { BriefcaseBusiness, Plus } from "lucide-react";
import { MATTER_SORT_KEYS, type MatterSortKey } from "@openlaw/shared";
import { FormattedMessage, useIntl } from "react-intl";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { api } from "../lib/api";
import { CONTROL_CLASS } from "../lib/form-controls";
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
import {
  MATTER_SEVERITIES,
  matterPath,
  matterSeverityLabel,
  type MatterRow,
  type MatterSeverity,
} from "../lib/matters";
import { canReadMatters, isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { CreateMatterDialog } from "../components/matters/create-matter-dialog";
import {
  MATTERS_CATALOGUE as CATALOGUE,
  matterFilters,
  type MatterFilters,
} from "../components/matters/matters-columns";
import { PageTitle } from "../components/page-title";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { ColumnMenu } from "../components/table/column-menu";
import { ManagedTable } from "../components/table/managed-table";
import { ViewsMenu } from "../components/table/views-menu";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";

function isMatterSeverity(value: string): value is MatterSeverity {
  return (MATTER_SEVERITIES as readonly string[]).includes(value);
}

function isMatterSortKey(value: string): value is MatterSortKey {
  return (MATTER_SORT_KEYS as readonly string[]).includes(value);
}

function listQuery(layout: Layout) {
  const filters = matterFilters(layout.filters);
  const priority = isMatterSeverity(filters.priority) ? filters.priority : null;
  const sort =
    layout.sort && isMatterSortKey(layout.sort.key)
      ? { key: layout.sort.key, dir: layout.sort.dir }
      : null;
  return {
    ...(filters.includeClosed ? { includeClosed: "true" as const } : {}),
    ...(filters.includeArchived ? { includeArchived: "true" as const } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(priority ? { priority } : {}),
    ...(filters.manager ? { manager: filters.manager } : {}),
    ...(filters.incomplete ? { incomplete: "true" as const } : {}),
    ...(sort ? { sort: sort.key, dir: sort.dir } : {}),
  };
}

function sameQuery(a: Layout, b: Layout): boolean {
  return JSON.stringify(listQuery(a)) === JSON.stringify(listQuery(b));
}

export async function mattersLoader() {
  const user = await requireUser();
  if (!canReadMatters(user.role)) return redirect("/");
  const canCreate = isMemberPlus(user.role);
  const views = await readViews(CATALOGUE.surface);
  const opensOn = views.find((view) => view.isDefault) ?? null;
  const layout = opensOn ? resolveLayout(CATALOGUE, opensOn.layout) : builtInLayout(CATALOGUE);
  const [list, options, entities] = await Promise.all([
    api.GET("/api/v1/matters", { params: { query: listQuery(layout) } }),
    api.GET("/api/v1/matters/options"),
    canCreate ? api.GET("/api/v1/entities") : undefined,
  ]);
  if (!list.data || !options.data || (canCreate && !entities?.data)) {
    throw new Error("The matter list could not be read.");
  }
  return {
    user,
    canCreate,
    matters: list.data.matters,
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
  const [cursor, setCursor] = useState<string | null>(loaded.nextCursor);
  const [counts, setCounts] = useState(loaded.counts);
  const [layout, setLayout] = useState<Layout>(loaded.layout);
  const [views, setViews] = useState<SavedView[]>(loaded.views);
  const [activeViewId, setActiveViewId] = useState<string | null>(loaded.activeViewId);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [appended, setAppended] = useState<{ count: number; from: string } | null>(null);

  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  const storedLayout = activeView
    ? resolveLayout(CATALOGUE, activeView.layout)
    : builtInLayout(CATALOGUE);
  const modified = !sameLayout(layout, storedLayout);
  const filters = matterFilters(layout.filters);
  // A filter that answers nothing is not the module's first visit: the
  // empty state has to say which of the two it is.
  const narrowed =
    filters.status !== "" ||
    filters.type !== "" ||
    filters.priority !== "" ||
    filters.manager !== "" ||
    filters.incomplete;

  const signOut = useSignOut("/auth/login");

  async function commit(next: Layout, nextActiveId: string | null = activeViewId) {
    if (sameQuery(layout, next)) {
      setLayout(next);
      setActiveViewId(nextActiveId);
      return;
    }
    if (busy) return;
    setListError(null);
    setBusy(true);
    const { data } = await api
      .GET("/api/v1/matters", { params: { query: listQuery(next) } })
      .catch(() => ({ data: undefined }))
      .finally(() => setBusy(false));
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
    setCounts(data.counts);
    setAppended(null);
    setPageError(null);
    setLayout(next);
    setActiveViewId(nextActiveId);
  }

  function setFilter<K extends keyof MatterFilters>(key: K, value: MatterFilters[K]) {
    void commit({ ...layout, filters: { ...layout.filters, [key]: value } });
  }

  async function showMore() {
    if (busy || cursor === null) return;
    setPageError(null);
    setBusy(true);
    const { data } = await api
      .GET("/api/v1/matters", { params: { query: { cursor, ...listQuery(layout) } } })
      .catch(() => ({ data: undefined }))
      .finally(() => setBusy(false));
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
    setCounts(data.counts);
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
            <FormattedMessage
              id="matters.counts"
              defaultMessage="{open} open · {onHold} on hold"
              values={counts}
            />
          }
          // DES-046 point 7: a list drawing its empty state has no column
          // strip to arrange, so neither menu is drawn.
          actions={rows.length === 0 ? undefined : tableControls}
          primaryAction={createButton}
        />
      }
    >
      <PageTitle title={intl.formatMessage({ id: "matters.title", defaultMessage: "Matters" })} />
      <div className="flex flex-col gap-3">
        <MatterFilterBar
          filters={filters}
          types={loaded.matterTypes}
          statuses={loaded.matterStatuses}
          users={loaded.users}
          busy={busy}
          error={listError}
          onFilter={setFilter}
        />
        {filters.manager === "me" && (
          <div>
            <span className="inline-flex rounded-pill bg-badge-count-bg px-2 py-1 text-xs font-medium text-badge-count-fg">
              <FormattedMessage id="matters.filter.managerMe" defaultMessage="Manager: me" />
            </span>
          </div>
        )}
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

function MatterFilterBar({
  filters,
  types,
  statuses,
  users,
  busy,
  error,
  onFilter,
}: Readonly<{
  filters: MatterFilters;
  types: { id: string; displayName: string }[];
  statuses: { id: string; displayName: string }[];
  users: { id: string; displayName: string; role: string }[];
  busy: boolean;
  error: string | null;
  onFilter: <K extends keyof MatterFilters>(key: K, value: MatterFilters[K]) => void;
}>) {
  const intl = useIntl();
  const managers = users.filter(
    (person) => person.role === "administrator" || person.role === "legal_team_member",
  );
  const selectClass = `${CONTROL_CLASS} w-auto min-w-32`;
  return (
    <div className="flex flex-wrap items-end justify-end gap-3">
      {error && (
        <p role="alert" className="me-auto text-xs text-status-danger-fg">
          {error}
        </p>
      )}
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        <FormattedMessage id="matters.filter.status" defaultMessage="Status" />
        <select
          aria-label={intl.formatMessage({ id: "matters.filter.status", defaultMessage: "Status" })}
          className={selectClass}
          value={filters.status}
          disabled={busy}
          onChange={(event) => onFilter("status", event.target.value)}
        >
          <option value="">
            <FormattedMessage id="matters.filter.status.all" defaultMessage="All statuses" />
          </option>
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        <FormattedMessage id="matters.filter.type" defaultMessage="Type" />
        <select
          aria-label={intl.formatMessage({ id: "matters.filter.type", defaultMessage: "Type" })}
          className={selectClass}
          value={filters.type}
          disabled={busy}
          onChange={(event) => onFilter("type", event.target.value)}
        >
          <option value="">
            <FormattedMessage id="matters.filter.type.all" defaultMessage="All types" />
          </option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        <FormattedMessage id="matters.filter.priority" defaultMessage="Priority" />
        <select
          aria-label={intl.formatMessage({
            id: "matters.filter.priority",
            defaultMessage: "Priority",
          })}
          className={selectClass}
          value={filters.priority}
          disabled={busy}
          onChange={(event) => onFilter("priority", event.target.value)}
        >
          <option value="">
            <FormattedMessage id="matters.filter.priority.all" defaultMessage="All priorities" />
          </option>
          {MATTER_SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {matterSeverityLabel(intl, severity)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        <FormattedMessage id="matters.filter.manager" defaultMessage="Manager" />
        <select
          aria-label={intl.formatMessage({
            id: "matters.filter.manager",
            defaultMessage: "Manager",
          })}
          className={selectClass}
          value={filters.manager}
          disabled={busy}
          onChange={(event) => onFilter("manager", event.target.value)}
        >
          <option value="">
            <FormattedMessage id="matters.filter.manager.all" defaultMessage="All managers" />
          </option>
          <option value="me">
            <FormattedMessage id="matters.filter.manager.me" defaultMessage="Me" />
          </option>
          {managers.map((manager) => (
            <option key={manager.id} value={manager.id}>
              {manager.displayName}
            </option>
          ))}
        </select>
      </label>
      <ToggleFilter
        id="matters-incomplete"
        label={<FormattedMessage id="matters.filter.incomplete" defaultMessage="Incomplete" />}
        checked={filters.incomplete}
        disabled={busy}
        onChange={(next) => onFilter("incomplete", next)}
      />
      <ToggleFilter
        id="matters-show-closed"
        label={<FormattedMessage id="matters.showClosed" defaultMessage="Show closed" />}
        checked={filters.includeClosed}
        disabled={busy}
        onChange={(next) => onFilter("includeClosed", next)}
      />
      <ToggleFilter
        id="matters-show-archived"
        label={<FormattedMessage id="matters.showArchived" defaultMessage="Show archived" />}
        checked={filters.includeArchived}
        disabled={busy}
        onChange={(next) => onFilter("includeArchived", next)}
      />
    </div>
  );
}

function ToggleFilter({
  id,
  label,
  checked,
  disabled,
  onChange,
}: Readonly<{
  id: string;
  label: ReactNode;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}>) {
  return (
    <span className="flex h-8 items-center gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </span>
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
