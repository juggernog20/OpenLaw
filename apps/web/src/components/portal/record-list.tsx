// SPDX-License-Identifier: AGPL-3.0-only

/** Portal destinations share the staff table controls and keep each server read tied to its URL. */
import { useContext, useEffect, useRef, useState } from "react";
import {
  useNavigate,
  useNavigation,
  useLoaderData,
  useMatches,
  UNSAFE_DataRouterContext,
} from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Search, X } from "lucide-react";
import { type ColumnCatalogue, type Layout } from "../../lib/list-views";
import { portalListQuery, portalListSearch } from "../../lib/portal-lists";
import { useListReadGuard } from "../../lib/list-read-guard";
import { useSignOut } from "../../lib/session";
import { PageTitle } from "../page-title";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ManagedTable } from "../table/managed-table";
import { ColumnMenu } from "../table/column-menu";
import { RecordFilterBar, type RecordFilter } from "../table/record-filter-bar";
import { PortalShell, type PortalUser } from "./portal-shell";

export interface PortalListData<Row> {
  rows: Row[];
  total: number;
  nextCursor: number | null;
  filterOptions: {
    types: { id: string; displayName: string }[];
    owners: { id: string; displayName: string }[];
    statuses?: { id: string; displayName: string }[];
  };
}
export function PortalRecordList<Row extends { number: number; title: string }>({
  catalogue,
  filterKeys,
  title,
  description,
  searchLabel,
  definitions,
  read,
  path,
}: {
  catalogue: ColumnCatalogue<Row>;
  filterKeys: readonly string[];
  title: string;
  description: string;
  searchLabel: string;
  definitions: (options: PortalListData<Row>["filterOptions"]) => RecordFilter[];
  read: (layout: Layout, cursor?: number) => Promise<PortalListData<Row> | undefined>;
  path: string;
}) {
  const loaded = useLoaderData<PortalListData<Row> & { user: PortalUser; layout: Layout }>();
  const context = useContext(UNSAFE_DataRouterContext);
  if (!context) throw new Error("Portal lists require a data router.");
  const { router } = context;
  const routeId = useMatches().at(-1)!.id;
  const intl = useIntl();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const signOut = useSignOut("/portal/enter");
  const { beginRead, noteUrlSync, shouldAdoptLoader } = useListReadGuard();
  const [data, setData] = useState<PortalListData<Row>>(loaded);
  const [layout, setLayout] = useState(loaded.layout);
  const [search, setSearch] = useState(String(loaded.layout.filters.q ?? ""));
  const [requestBusy, setBusy] = useState(false);
  const activeRequest = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [appended, setAppended] = useState<{ count: number; from: string } | null>(null);
  const busy = requestBusy || navigation.state !== "idle";
  const previous = useRef(loaded);
  // Router completions arrive through its subscription, including Back and
  // Forward. Local column choices and appended pages survive unrelated renders.
  useEffect(
    () =>
      router.subscribe((state) => {
        const next = state.loaderData[routeId] as typeof loaded | undefined;
        if (!next || previous.current === next) return;
        previous.current = next;
        if (!shouldAdoptLoader(next)) return;
        activeRequest.current += 1;
        setBusy(false);
        setData(next);
        setLayout((current) => ({
          ...current,
          filters: next.layout.filters,
          sort: next.layout.sort,
        }));
        setSearch(String(next.layout.filters.q ?? ""));
        setAppended(null);
        setError(null);
      }),
    [router, routeId, shouldAdoptLoader],
  );

  async function fetchList(next: Layout, more = false) {
    if (busy) return;
    if (
      !more &&
      JSON.stringify(portalListQuery(layout, filterKeys)) ===
        JSON.stringify(portalListQuery(next, filterKeys))
    ) {
      setLayout(next);
      return;
    }
    setError(null);
    const requestId = ++activeRequest.current;
    setBusy(true);
    const isCurrent = beginRead();
    const result = await read(next, more ? (data.nextCursor ?? undefined) : undefined)
      .catch(() => undefined)
      .finally(() => {
        if (activeRequest.current === requestId) setBusy(false);
      });
    if (!isCurrent()) return;
    if (!result) {
      setError(
        intl.formatMessage({
          id: "portal.list.readError",
          defaultMessage: "The list could not be updated. Try again.",
        }),
      );
      return;
    }
    if (more) {
      const existing = new Set(data.rows.map((row) => row.number));
      const added = result.rows.filter((row) => !existing.has(row.number));
      setData({ ...result, rows: [...data.rows, ...added] });
      setAppended(added.length ? { count: added.length, from: String(added[0]!.number) } : null);
      return;
    }
    setData(result);
    setLayout(next);
    setSearch(String(next.filters.q ?? ""));
    setAppended(null);
    await noteUrlSync(
      navigate({ search: portalListSearch(next, filterKeys) }, { preventScrollReset: true }),
    );
  }
  const narrowed = Object.values(layout.filters).some(Boolean);
  return (
    <PortalShell user={loaded.user} wide onSignOut={() => void signOut()}>
      <PageTitle title={title} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-base text-muted">{description}</p>
          <p className="text-sm text-muted" role="status">
            <FormattedMessage
              id="portal.list.count"
              defaultMessage="{shown} of {total, plural, one {# record} other {# records}}"
              values={{ shown: data.rows.length, total: data.total }}
            />
          </p>
        </div>
        <ColumnMenu
          catalogue={catalogue}
          layout={layout}
          onLayoutChange={(next) => void fetchList(next)}
        />
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <form
            role="search"
            aria-label={searchLabel}
            className="flex w-full items-center gap-2 @sm/page:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              void fetchList({ ...layout, filters: { ...layout.filters, q: search.trim() } });
            }}
          >
            <div className="relative min-w-0 flex-1 @sm/page:w-80">
              <Search
                aria-hidden="true"
                size={16}
                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <Input
                type="search"
                name="q"
                maxLength={200}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={searchLabel}
                placeholder={searchLabel}
                className="ps-9"
                disabled={busy}
              />
            </div>
            <Button type="submit" variant="secondary" disabled={busy}>
              <FormattedMessage id="portal.list.search" defaultMessage="Search" />
            </Button>
            {(search || layout.filters.q) && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy}
                aria-label={intl.formatMessage({
                  id: "portal.list.clearSearch",
                  defaultMessage: "Clear search",
                })}
                onClick={() => {
                  setSearch("");
                  void fetchList({ ...layout, filters: { ...layout.filters, q: "" } });
                }}
              >
                <X size={16} aria-hidden="true" />
              </Button>
            )}
          </form>
          <RecordFilterBar
            definitions={definitions(data.filterOptions)}
            values={layout.filters}
            busy={busy}
            error={null}
            onChange={(filters) =>
              void fetchList({
                ...layout,
                filters: { ...filters, ...(layout.filters.q ? { q: layout.filters.q } : {}) },
              })
            }
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-status-danger-fg">
            {error}
          </p>
        )}
        {data.rows.length ? (
          <ManagedTable
            catalogue={catalogue}
            layout={layout}
            rows={data.rows}
            rowKey={(row) => String(row.number)}
            onLayoutChange={(next) => void fetchList(next)}
            onRowActivate={(row) => void navigate(`${path}/${row.number}`)}
            focusRowKey={appended?.from}
            foot={
              data.nextCursor !== null ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void fetchList(layout, true)}
                >
                  <FormattedMessage id="portal.list.more" defaultMessage="Show more" />
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
            <Search size={24} aria-hidden="true" className="text-subtle" />
            <h2 className="text-md font-semibold">
              {narrowed ? (
                <FormattedMessage
                  id="portal.list.empty.filtered"
                  defaultMessage="No records match your search or filters"
                />
              ) : (
                <FormattedMessage
                  id="portal.list.empty"
                  defaultMessage="No records are available to you"
                />
              )}
            </h2>
            <p className="max-w-md text-base text-muted">
              {narrowed ? (
                <FormattedMessage
                  id="portal.list.empty.filteredBody"
                  defaultMessage="Try another search or clear a filter to widen the list."
                />
              ) : (
                <FormattedMessage
                  id="portal.list.empty.body"
                  defaultMessage="Records appear here when Legal adds you to their team."
                />
              )}
            </p>
            {narrowed && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void fetchList({ ...layout, filters: {} })}
              >
                <FormattedMessage
                  id="portal.list.clearAll"
                  defaultMessage="Clear search and filters"
                />
              </Button>
            )}
          </div>
        )}
        <p aria-live="polite" className="sr-only">
          {appended && (
            <FormattedMessage
              id="portal.list.moreAdded"
              defaultMessage="{count, plural, one {# more record} other {# more records}}. {total} shown."
              values={{ count: appended.count, total: data.rows.length }}
            />
          )}
        </p>
      </div>
    </PortalShell>
  );
}
