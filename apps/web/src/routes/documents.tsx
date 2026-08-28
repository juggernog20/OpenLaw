// SPDX-License-Identifier: AGPL-3.0-only

/** M26's URL-backed flat Documents destination and DES-046 managed table. */
import { useEffect, useState } from "react";
import {
  redirect,
  useLoaderData,
  useNavigate,
  type LoaderFunctionArgs,
  type NavigateFunction,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { FileText } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import {
  DOCUMENT_REPOSITORY_FORMATS,
  DOCUMENT_REPOSITORY_KINDS,
  DOCUMENT_REPOSITORY_SORT_KEYS,
  documentLandingPath,
  documentRecordReference,
  documentRepositoryFilters,
  type DocumentRepositoryFilters,
  type RepositoryDocument,
} from "../lib/documents";
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
import { canReadContracts } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { PageTitle } from "../components/page-title";
import { DOCUMENTS_CATALOGUE as CATALOGUE } from "../components/documents/documents-columns";
import { DocumentFilterBar } from "../components/documents/document-filter-bar";
import { ColumnMenu } from "../components/table/column-menu";
import { ManagedTable } from "../components/table/managed-table";
import { ViewsMenu } from "../components/table/views-menu";
import { Button } from "../components/ui/button";
import { civilToLocalDate } from "../components/date-picker";

type DocumentsQuery = NonNullable<paths["/api/v1/documents"]["get"]["parameters"]["query"]>;

const QUERY_KEYS = [
  "owner",
  "record",
  "folder",
  "format",
  "kind",
  "uploadedFrom",
  "uploadedTo",
  "sort",
  "dir",
] as const;

// A filter commit has already read the exact list it is about to put in
// the address bar. Only that one navigation skips the loader; an ordinary
// link to /documents must still reload and clear a filtered page.
let locallyReadSearch: string | null = null;

// Counts loader runs. The page remounts from loader data on every run, so a
// skipped revalidation keeps the local state and a real one replaces it.
let loads = 0;

function mirrorSearch(navigate: NavigateFunction, search: string) {
  locallyReadSearch = search;
  void navigate({ search }, { replace: true });
}

function listQuery(layout: Layout): DocumentsQuery {
  const filters = documentRepositoryFilters(layout.filters);
  const record = documentRecordReference(filters.record);
  const uploadedFrom = civilToLocalDate(filters.uploadedFrom) ? filters.uploadedFrom : "";
  const uploadedTo = civilToLocalDate(filters.uploadedTo) ? filters.uploadedTo : "";
  return {
    ...(filters.owner ? { owner: filters.owner } : {}),
    ...(record ? { record: filters.record } : {}),
    ...(record && filters.folder ? { folder: filters.folder } : {}),
    ...(filters.format ? { format: filters.format } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(uploadedFrom ? { uploadedFrom } : {}),
    ...(uploadedTo ? { uploadedTo } : {}),
    ...(layout.sort
      ? { sort: layout.sort.key as DocumentsQuery["sort"], dir: layout.sort.dir }
      : {}),
  };
}

function sameQuery(a: Layout, b: Layout): boolean {
  return JSON.stringify(listQuery(a)) === JSON.stringify(listQuery(b));
}

function querySearch(layout: Layout): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(listQuery(layout))) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function layoutFromSearch(base: Layout, search: string): { layout: Layout; fromUrl: boolean } {
  const params = new URLSearchParams(search);
  const fromUrl = QUERY_KEYS.some((key) => params.has(key));
  if (!fromUrl) return { layout: base, fromUrl: false };

  const filters: Layout["filters"] = {};
  const owner = params.get("owner");
  if (owner === "contract" || owner === "matter") filters.owner = owner;
  const record = params.get("record") ?? "";
  if (documentRecordReference(record)) {
    filters.record = record;
    const folder = params.get("folder");
    if (folder) filters.folder = folder;
  }
  const format = params.get("format");
  if (DOCUMENT_REPOSITORY_FORMATS.some((candidate) => candidate === format)) {
    filters.format = format!;
  }
  const kind = params.get("kind");
  if (DOCUMENT_REPOSITORY_KINDS.some((candidate) => candidate === kind)) filters.kind = kind!;
  for (const key of ["uploadedFrom", "uploadedTo"] as const) {
    const value = params.get(key) ?? "";
    if (civilToLocalDate(value)) filters[key] = value;
  }
  const sort = params.get("sort");
  const dir = params.get("dir");
  return {
    fromUrl: true,
    layout: {
      ...base,
      filters,
      sort: DOCUMENT_REPOSITORY_SORT_KEYS.some((candidate) => candidate === sort)
        ? { key: sort!, dir: dir === "desc" ? "desc" : "asc" }
        : null,
    },
  };
}

export async function documentsLoader({ request }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!canReadContracts(user.role)) return redirect("/");
  const views = await readViews(CATALOGUE.surface);
  const opensOn = views.find((view) => view.isDefault) ?? null;
  const stored = opensOn ? resolveLayout(CATALOGUE, opensOn.layout) : builtInLayout(CATALOGUE);
  const { layout, fromUrl } = layoutFromSearch(stored, new URL(request.url).search);
  const { data } = await api.GET("/api/v1/documents", { params: { query: listQuery(layout) } });
  if (!data) throw new Error("The Document list could not be read.");
  return {
    user,
    documents: data.documents,
    nextCursor: data.nextCursor,
    views,
    layout,
    activeViewId: opensOn?.id ?? null,
    fromUrl,
    loadKey: ++loads,
  };
}

/** URL mirroring follows a successful local read, so it must not repeat it. */
export function documentsShouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  if (
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search !== nextUrl.search &&
    locallyReadSearch === nextUrl.search
  ) {
    locallyReadSearch = null;
    return false;
  }
  locallyReadSearch = null;
  return defaultShouldRevalidate;
}

export function DocumentsPage() {
  const loaded = useLoaderData<typeof documentsLoader>();
  return <DocumentsPageState key={loaded.loadKey} />;
}

function DocumentsPageState() {
  const loaded = useLoaderData<typeof documentsLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  const signOut = useSignOut("/auth/login");
  const [rows, setRows] = useState<RepositoryDocument[]>(loaded.documents);
  const [cursor, setCursor] = useState<string | null>(loaded.nextCursor);
  const [layout, setLayout] = useState<Layout>(loaded.layout);
  const [views, setViews] = useState<SavedView[]>(loaded.views);
  const [activeViewId, setActiveViewId] = useState<string | null>(loaded.activeViewId);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [pageError, setPageError] = useState(false);
  const [appended, setAppended] = useState<{ count: number; from: string } | null>(null);

  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  const storedLayout = activeView
    ? resolveLayout(CATALOGUE, activeView.layout)
    : builtInLayout(CATALOGUE);
  const modified = !sameLayout(layout, storedLayout);
  const filters = documentRepositoryFilters(layout.filters);
  const narrowed = Object.values(filters).some(Boolean);

  useEffect(() => {
    if (loaded.fromUrl) return;
    const search = querySearch(loaded.layout);
    if (search) mirrorSearch(navigate, search);
  }, [loaded.fromUrl, loaded.layout, navigate]);

  async function commit(next: Layout, nextActiveId: string | null = activeViewId) {
    if (sameQuery(layout, next)) {
      setLayout(next);
      setActiveViewId(nextActiveId);
      return;
    }
    if (busy) return;
    setBusy(true);
    setListError(null);
    const { data } = await api
      .GET("/api/v1/documents", { params: { query: listQuery(next) } })
      .catch(() => ({ data: undefined }))
      .finally(() => setBusy(false));
    if (!data) {
      setListError(
        intl.formatMessage({
          id: "documents.listError",
          defaultMessage: "The Document list could not be read. Try again.",
        }),
      );
      return;
    }
    setRows(data.documents);
    setCursor(data.nextCursor);
    setAppended(null);
    setPageError(false);
    setLayout(next);
    setActiveViewId(nextActiveId);
    mirrorSearch(navigate, querySearch(next));
  }

  function setFilter<K extends keyof DocumentRepositoryFilters>(
    key: K,
    value: DocumentRepositoryFilters[K],
  ) {
    const next = { ...layout.filters, [key]: value };
    if (key === "record") next.folder = "";
    if (key === "owner" && value) {
      const record = documentRecordReference(filters.record);
      if (record && record.entityType !== value) {
        next.record = "";
        next.folder = "";
      }
    }
    void commit({ ...layout, filters: next });
  }

  function clearFilters() {
    void commit({ ...layout, filters: {} });
  }

  async function showMore() {
    if (busy || cursor === null) return;
    setBusy(true);
    setPageError(false);
    const { data } = await api
      .GET("/api/v1/documents", { params: { query: { ...listQuery(layout), cursor } } })
      .catch(() => ({ data: undefined }))
      .finally(() => setBusy(false));
    if (!data) {
      setPageError(true);
      return;
    }
    const first = data.documents[0];
    setRows((current) => [...current, ...data.documents]);
    setCursor(data.nextCursor);
    setAppended(first ? { count: data.documents.length, from: first.id } : null);
  }

  function adopt(next: SavedView[], activeId: string | null) {
    setViews(next);
    setActiveViewId(activeId);
  }

  const controls =
    rows.length === 0 && !narrowed ? undefined : (
      <>
        <ViewsMenu
          views={views}
          activeView={activeView}
          modified={modified}
          busy={busy}
          onSelect={(view) =>
            void commit(
              view ? resolveLayout(CATALOGUE, view.layout) : builtInLayout(CATALOGUE),
              view?.id ?? null,
            )
          }
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
          title={<FormattedMessage id="nav.documents" defaultMessage="Documents" />}
          subtitle={
            <FormattedMessage
              id="documents.list.countShown"
              defaultMessage="{count, plural, one {# document shown} other {# documents shown}}"
              values={{ count: rows.length }}
            />
          }
          actions={controls}
          filters={
            <DocumentFilterBar
              filters={filters}
              busy={busy}
              empty={rows.length === 0}
              error={listError}
              onFilter={setFilter}
              onClear={clearFilters}
            />
          }
        />
      }
    >
      <PageTitle title={intl.formatMessage({ id: "nav.documents", defaultMessage: "Documents" })} />
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
          <FileText size={24} aria-hidden="true" className="text-subtle" />
          <div className="flex flex-col gap-1">
            <h2 className="text-md font-semibold">
              {narrowed ? (
                <FormattedMessage
                  id="documents.list.filteredEmpty.title"
                  defaultMessage="No documents match these filters."
                />
              ) : (
                <FormattedMessage
                  id="documents.list.empty.title"
                  defaultMessage="Paper lives on Contracts and Matters."
                />
              )}
            </h2>
            <p className="text-base text-muted">
              {narrowed ? (
                <FormattedMessage
                  id="documents.list.filteredEmpty.body"
                  defaultMessage="Clear filters to return to the whole list."
                />
              ) : (
                <FormattedMessage
                  id="documents.list.empty.body"
                  defaultMessage="Upload to a record and it appears here."
                />
              )}
            </p>
          </div>
          {narrowed && (
            <Button variant="secondary" onClick={clearFilters} disabled={busy}>
              <FormattedMessage
                id="documents.list.filteredEmpty.clear"
                defaultMessage="Clear filters"
              />
            </Button>
          )}
        </div>
      ) : (
        <ManagedTable
          catalogue={CATALOGUE}
          layout={layout}
          rows={rows}
          rowKey={(row) => row.id}
          onLayoutChange={(next) => void commit(next)}
          onRowActivate={(row) => void navigate(documentLandingPath(row))}
          focusRowKey={appended?.from}
          foot={
            cursor === null ? undefined : (
              <>
                {pageError && (
                  <p role="alert" className="text-xs text-status-danger-fg">
                    <FormattedMessage
                      id="documents.list.moreError"
                      defaultMessage="The next Documents could not be read. Try again."
                    />
                  </p>
                )}
                <Button variant="secondary" disabled={busy} onClick={() => void showMore()}>
                  <FormattedMessage id="documents.list.more" defaultMessage="Show more" />
                </Button>
              </>
            )
          }
        />
      )}
      <p aria-live="polite" className="sr-only">
        {appended && (
          <FormattedMessage
            id="documents.list.moreAdded"
            defaultMessage="{count, plural, one {# more Document} other {# more Documents}}. {total} shown."
            values={{ count: appended.count, total: rows.length }}
          />
        )}
      </p>
    </AppShell>
  );
}
