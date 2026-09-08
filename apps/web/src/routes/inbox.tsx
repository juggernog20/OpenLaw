// SPDX-License-Identifier: AGPL-3.0-only

/** The staff triage queue, with shared quick filters and private saved views. */
import { HelpLink } from "../components/documentation/help-link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Inbox } from "lucide-react";
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
  INBOX_FILTER_KEYS,
  filterQuery,
  filterSearch,
  initialView,
  layoutFromUrl,
} from "../lib/record-filters";
import {
  createView,
  deleteView,
  readViews,
  resolveLayout,
  sameLayout,
  updateView,
  type Layout,
  type SavedView,
} from "../lib/list-views";
import type { InboxRow } from "../lib/requests";
import { isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import {
  INBOX_CATALOGUE as CATALOGUE,
  defaultInboxLayout,
  InboxAssignAction,
} from "../components/inbox/inbox-columns";
import { useInboxFilterDefinitions } from "../components/inbox/inbox-filter-definitions";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { ColumnMenu } from "../components/table/column-menu";
import { ManagedTable } from "../components/table/managed-table";
import { ViewsMenu } from "../components/table/views-menu";
import { RecordFilterBar } from "../components/table/record-filter-bar";

export function inboxRequestPath(number: number): string {
  return `/inbox/${number}`;
}

function listQuery(layout: Layout) {
  return {
    includeTriaged: "true" as const,
    ...filterQuery(layout.filters, INBOX_FILTER_KEYS),
    ...(layout.filters.receivedFrom || layout.filters.receivedTo
      ? { timeZone: resolveTimeZone() }
      : {}),
  };
}
function sameQuery(a: Layout, b: Layout) {
  return JSON.stringify(listQuery(a)) === JSON.stringify(listQuery(b));
}

export async function inboxLoader(args?: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!isMemberPlus(user.role)) return redirect("/");
  const views = await readViews(CATALOGUE.surface);
  const opensOn = initialView(views, args);
  let layout = layoutFromUrl(
    opensOn ? resolveLayout(CATALOGUE, opensOn.layout) : defaultInboxLayout(),
    args,
    INBOX_FILTER_KEYS,
    [],
  );
  const params = args && new URL(args.request.url).searchParams;
  if (params?.get("includeTriaged") === "true" && !params.has("status") && !params.has("filters"))
    layout = { ...layout, filters: {} };
  const [list, options] = await Promise.all([
    api.GET("/api/v1/requests", { params: { query: listQuery(layout) } }),
    api.GET("/api/v1/requests/filter-options"),
  ]);
  if (!list.data || !options.data) throw new Error("The Inbox could not be read.");
  return {
    user,
    requests: list.data.requests,
    total: list.data.total,
    nextCursor: list.data.nextCursor,
    filterOptions: options.data,
    views,
    layout,
    activeViewId: opensOn?.id ?? null,
  };
}

export function InboxPage() {
  const loaded = useLoaderData<typeof inboxLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  const [rows, setRows] = useState<InboxRow[]>(loaded.requests);
  const [total, setTotal] = useState(loaded.total ?? loaded.requests.length);
  const [cursor, setCursor] = useState<string | null>(loaded.nextCursor);
  const [layout, setLayout] = useState<Layout>(loaded.layout);
  const [views, setViews] = useState<SavedView[]>(loaded.views);
  const [activeViewId, setActiveViewId] = useState<string | null>(loaded.activeViewId);
  const [requestBusy, setBusy] = useState(false);
  const navigation = useNavigation();
  const busy = requestBusy || navigation.state !== "idle";
  const readVersion = useRef(0);
  // A layout effect, not a passive one: the bump has to land in the
  // same commit as the render that shows the new list. A passive effect
  // runs a scheduler tick later, and a click in that gap starts a read
  // that the late bump then discards, so the click is silently lost.
  useLayoutEffect(() => {
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
    setRows(loaded.requests);
    setCursor(loaded.nextCursor);
    setTotal(loaded.total ?? loaded.requests.length);
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
  const definitions = useInboxFilterDefinitions(loaded.filterOptions);

  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  const storedLayout = activeView
    ? resolveLayout(CATALOGUE, activeView.layout)
    : defaultInboxLayout();
  const modified = !sameLayout(layout, storedLayout);

  // A filter that answers nothing is not the module's first visit: the
  // empty state has to say which of the two it is.
  const signOut = useSignOut("/auth/login");

  async function commit(next: Layout, nextActiveId: string | null = activeViewId) {
    if (sameQuery(layout, next)) {
      setLayout(next);
      setActiveViewId(nextActiveId);
      if (nextActiveId !== activeViewId)
        await navigate(
          { search: filterSearch(next, INBOX_FILTER_KEYS, nextActiveId) },
          { preventScrollReset: true },
        );
      return;
    }
    if (busy) return;
    setListError(null);
    setBusy(true);
    const version = ++readVersion.current;
    const { data } = await api
      .GET("/api/v1/requests", { params: { query: listQuery(next) } })
      .catch(() => ({ data: undefined }))
      .finally(() => setBusy(false));
    if (version !== readVersion.current) return;
    if (!data) {
      setListError(
        intl.formatMessage({
          id: "inbox.listError",
          defaultMessage: "The Inbox could not be read. Try again.",
        }),
      );
      return;
    }
    setRows(data.requests);
    setCursor(data.nextCursor);
    setTotal(data.total ?? data.requests.length);
    setAppended(null);
    setPageError(null);
    setLayout(next);
    setActiveViewId(nextActiveId);
    await navigate(
      { search: filterSearch(next, INBOX_FILTER_KEYS, nextActiveId) },
      { preventScrollReset: true },
    );
  }

  async function showMore() {
    if (busy || cursor === null) return;
    setPageError(null);
    setBusy(true);
    const version = ++readVersion.current;
    const { data } = await api
      .GET("/api/v1/requests", { params: { query: { cursor, ...listQuery(layout) } } })
      .catch(() => ({ data: undefined }))
      .finally(() => setBusy(false));
    if (version !== readVersion.current) return;
    if (!data) {
      setPageError(
        intl.formatMessage({
          id: "inbox.moreError",
          defaultMessage: "The next requests could not be read. Try again.",
        }),
      );
      return;
    }
    const first = data.requests[0];
    setRows((current) => [...current, ...data.requests]);
    setCursor(data.nextCursor);
    setTotal(data.total ?? data.requests.length);
    setAppended(first ? { count: data.requests.length, from: first.id } : null);
  }

  function selectView(view: SavedView | null) {
    void commit(
      view ? resolveLayout(CATALOGUE, view.layout) : defaultInboxLayout(),
      view?.id ?? null,
    );
  }

  function adopt(next: SavedView[], activeId: string | null) {
    setViews(next);
    setActiveViewId(activeId);
    if (activeId !== activeViewId)
      void navigate(
        { search: filterSearch(layout, INBOX_FILTER_KEYS, activeId) },
        { replace: true, preventScrollReset: true },
      );
  }

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
          await commit(defaultInboxLayout(), null);
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
          title={<FormattedMessage id="inbox.title" defaultMessage="Inbox" />}
          subtitle={
            rows.length < total ? (
              <FormattedMessage
                id="inbox.filteredCount"
                defaultMessage="{shown} of {total, plural, one {# request} other {# requests}}"
                values={{ shown: rows.length, total }}
              />
            ) : (
              <FormattedMessage
                id="inbox.matchingCount"
                defaultMessage="{count, plural, one {# request} other {# requests}}"
                values={{ count: total }}
              />
            )
          }
          actions={
            <>
              <HelpLink surface="staff" contextual />
              {tableControls}
            </>
          }
        />
      }
    >
      <PageTitle title={intl.formatMessage({ id: "inbox.title", defaultMessage: "Inbox" })} />
      <div className="flex flex-col gap-3">
        <RecordFilterBar
          definitions={definitions}
          values={layout.filters}
          busy={busy}
          error={listError}
          onChange={(filters) => void commit({ ...layout, filters })}
        />
        {rows.length === 0 ? (
          <EmptyInbox
            awaitingOnly={
              JSON.stringify(filterQuery(layout.filters, INBOX_FILTER_KEYS)) ===
              JSON.stringify({ status: "new" })
            }
          />
        ) : (
          <ManagedTable
            catalogue={CATALOGUE}
            actionsColumn={{
              label: intl.formatMessage({ id: "inbox.column.actions", defaultMessage: "Actions" }),
              width: 128,
              pinned: true,
              render: (row) => (
                <InboxAssignAction
                  row={row}
                  onAssigned={(updated) =>
                    setRows((current) =>
                      current.map((item) =>
                        item.id === updated.id ? { ...item, assignee: updated.assignee } : item,
                      ),
                    )
                  }
                />
              ),
            }}
            layout={layout}
            rows={rows}
            rowKey={(row) => row.id}
            onLayoutChange={(next) => void commit(next)}
            focusRowKey={appended?.from}
            foot={
              <>
                <p className="text-xs text-muted">
                  <FormattedMessage
                    id="inbox.ordering"
                    defaultMessage="Ordered by urgency, then age"
                  />
                </p>
                {pageError && (
                  <p role="alert" className="text-xs text-status-danger-fg">
                    {pageError}
                  </p>
                )}
                {cursor !== null && (
                  <Button variant="secondary" disabled={busy} onClick={() => void showMore()}>
                    <FormattedMessage id="inbox.more" defaultMessage="Show more" />
                  </Button>
                )}
              </>
            }
          />
        )}
        <p aria-live="polite" className="sr-only">
          {appended && (
            <FormattedMessage
              id="inbox.moreAdded"
              defaultMessage="{count, plural, one {# more request} other {# more requests}}. {total} shown."
              values={{ count: appended.count, total: rows.length }}
            />
          )}
        </p>
      </div>
    </AppShell>
  );
}

function EmptyInbox({ awaitingOnly }: Readonly<{ awaitingOnly: boolean }>) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
      <Inbox size={24} aria-hidden="true" className="text-subtle" />
      <div className="flex flex-col gap-1">
        <h2 className="text-md font-semibold">
          {awaitingOnly ? (
            <FormattedMessage id="inbox.empty.title" defaultMessage="Nothing is waiting" />
          ) : (
            <FormattedMessage
              id="inbox.empty.filteredTitle"
              defaultMessage="No requests match these filters"
            />
          )}
        </h2>
        <p className="max-w-md text-base text-muted">
          {awaitingOnly ? (
            <FormattedMessage
              id="inbox.empty.body"
              defaultMessage="Every Request has been decided. New ones land here as they arrive, hottest and oldest first."
            />
          ) : (
            <FormattedMessage
              id="inbox.empty.filteredBody"
              defaultMessage="Clear a filter to widen the list."
            />
          )}
        </p>
      </div>
    </div>
  );
}
