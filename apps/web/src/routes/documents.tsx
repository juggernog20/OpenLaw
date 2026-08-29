// SPDX-License-Identifier: AGPL-3.0-only

/** M26's URL-backed flat Documents destination and DES-046 managed table. */
import { useEffect, useState } from "react";
import {
  redirect,
  Link,
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
  readDocumentOptions,
  restoreDocument,
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
import { formatRelativeOrShort } from "../lib/format";
import { canReadContracts, isMemberPlus } from "../lib/roles";
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
import { Avatar } from "../components/avatar";

type DocumentsQuery = NonNullable<paths["/api/v1/documents"]["get"]["parameters"]["query"]>;

const QUERY_KEYS = [
  "owner",
  "record",
  "folder",
  "format",
  "kind",
  "counterparty",
  "uploader",
  "uploadedFrom",
  "uploadedTo",
  "includeArchived",
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
    ...(filters.counterparty ? { counterparty: filters.counterparty } : {}),
    ...(filters.uploader ? { uploader: filters.uploader } : {}),
    ...(uploadedFrom ? { uploadedFrom } : {}),
    ...(uploadedTo ? { uploadedTo } : {}),
    ...(filters.includeArchived ? { includeArchived: "true" as const } : {}),
    ...(layout.sort
      ? { sort: layout.sort.key as DocumentsQuery["sort"], dir: layout.sort.dir }
      : {}),
  };
}

function sameQuery(a: Layout, b: Layout): boolean {
  return JSON.stringify(listQuery(a)) === JSON.stringify(listQuery(b));
}

function hasActiveFilters(layout: Layout): boolean {
  return Object.values(documentRepositoryFilters(layout.filters)).some(Boolean);
}

function layoutForViewer(layout: Layout, canManage: boolean): Layout {
  return canManage ? layout : { ...layout, filters: { ...layout.filters, includeArchived: false } };
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
  const counterparty = params.get("counterparty");
  if (counterparty) filters.counterparty = counterparty;
  const uploader = params.get("uploader");
  if (uploader) filters.uploader = uploader;
  for (const key of ["uploadedFrom", "uploadedTo"] as const) {
    const value = params.get(key) ?? "";
    if (civilToLocalDate(value)) filters[key] = value;
  }
  if (params.get("includeArchived") === "true") filters.includeArchived = true;
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
  const canManage = isMemberPlus(user.role);
  const [views, optionsAnswer] = await Promise.all([
    readViews(CATALOGUE.surface),
    readDocumentOptions(),
  ]);
  if (!optionsAnswer.ok) throw new Error("The Document filter options could not be read.");
  const opensOn = views.find((view) => view.isDefault) ?? null;
  const stored = opensOn ? resolveLayout(CATALOGUE, opensOn.layout) : builtInLayout(CATALOGUE);
  const parsed = layoutFromSearch(stored, new URL(request.url).search);
  const layout = layoutForViewer(parsed.layout, canManage);
  const [listAnswer, recentAnswer] = await Promise.all([
    api.GET("/api/v1/documents", { params: { query: listQuery(layout) } }),
    hasActiveFilters(layout)
      ? Promise.resolve(null)
      : api.GET("/api/v1/documents", { params: { query: { limit: 5 } } }),
  ]);
  if (!listAnswer.data || (!hasActiveFilters(layout) && !recentAnswer?.data)) {
    throw new Error("The Document list could not be read.");
  }
  return {
    user,
    canManage,
    documents: listAnswer.data.documents,
    nextCursor: listAnswer.data.nextCursor,
    recent: recentAnswer?.data?.documents ?? [],
    views,
    options: optionsAnswer.options,
    layout,
    activeViewId: opensOn?.id ?? null,
    fromUrl: parsed.fromUrl,
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
  const [recent, setRecent] = useState<RepositoryDocument[]>(loaded.recent);
  const [cursor, setCursor] = useState<string | null>(loaded.nextCursor);
  const [layout, setLayout] = useState<Layout>(loaded.layout);
  const [views, setViews] = useState<SavedView[]>(loaded.views);
  const [activeViewId, setActiveViewId] = useState<string | null>(loaded.activeViewId);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [pageError, setPageError] = useState(false);
  const [appended, setAppended] = useState<{ count: number; from: string } | null>(null);

  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  const storedLayout = layoutForViewer(
    activeView ? resolveLayout(CATALOGUE, activeView.layout) : builtInLayout(CATALOGUE),
    loaded.canManage,
  );
  const modified = !sameLayout(layout, storedLayout);
  const filters = documentRepositoryFilters(layout.filters);
  const narrowed = Object.values(filters).some(Boolean);
  const hasArchivedRow = rows.some((row) => row.archivedAt !== null);

  useEffect(() => {
    if (loaded.fromUrl) return;
    const search = querySearch(loaded.layout);
    if (search) mirrorSearch(navigate, search);
  }, [loaded.fromUrl, loaded.layout, navigate]);

  async function commit(next: Layout, nextActiveId: string | null = activeViewId) {
    const allowed = layoutForViewer(next, loaded.canManage);
    if (sameQuery(layout, allowed)) {
      setLayout(allowed);
      setActiveViewId(nextActiveId);
      return;
    }
    if (busy) return;
    setBusy(true);
    setListError(null);
    const nextNarrowed = hasActiveFilters(allowed);
    const [listAnswer, recentAnswer] = await Promise.all([
      api
        .GET("/api/v1/documents", { params: { query: listQuery(allowed) } })
        .catch(() => ({ data: undefined })),
      nextNarrowed
        ? Promise.resolve(null)
        : api
            .GET("/api/v1/documents", { params: { query: { limit: 5 } } })
            .catch(() => ({ data: undefined })),
    ]).finally(() => setBusy(false));
    if (!listAnswer.data || (!nextNarrowed && !recentAnswer?.data)) {
      setListError(
        intl.formatMessage({
          id: "documents.listError",
          defaultMessage: "The Document list could not be read. Try again.",
        }),
      );
      return;
    }
    setRows(listAnswer.data.documents);
    setCursor(listAnswer.data.nextCursor);
    setRecent(recentAnswer?.data?.documents ?? []);
    setAppended(null);
    setPageError(false);
    setLayout(allowed);
    setActiveViewId(nextActiveId);
    mirrorSearch(navigate, querySearch(allowed));
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

  async function restoreRow(row: RepositoryDocument) {
    if (busy) return;
    setBusy(true);
    setListError(null);
    const outcome = await restoreDocument(row.id)
      .catch(() => ({ ok: false as const, detail: undefined }))
      .finally(() => setBusy(false));
    if (!outcome.ok) {
      setListError(
        outcome.detail ??
          intl.formatMessage(
            {
              id: "documents.restoreError",
              defaultMessage: "{title} could not be restored.",
            },
            { title: row.title },
          ),
      );
      return;
    }
    setRows((current) =>
      current.map((candidate) =>
        candidate.id === row.id ? { ...candidate, archivedAt: null } : candidate,
      ),
    );
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
              options={loaded.options}
              busy={busy}
              empty={rows.length === 0}
              error={listError}
              canManage={loaded.canManage}
              onFilter={setFilter}
              onClear={clearFilters}
            />
          }
        />
      }
    >
      <PageTitle title={intl.formatMessage({ id: "nav.documents", defaultMessage: "Documents" })} />
      <div className="flex flex-col gap-4">
        {!narrowed && recent.length > 0 && <RecentDocuments documents={recent} />}
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
            rowClassName={(row) => (row.archivedAt === null ? undefined : "opacity-60")}
            focusRowKey={appended?.from}
            actionsColumn={
              hasArchivedRow && loaded.canManage
                ? {
                    label: intl.formatMessage({
                      id: "documents.list.column.actions",
                      defaultMessage: "Actions",
                    }),
                    width: 108,
                    render: (row) =>
                      row.archivedAt === null ? null : (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          aria-label={intl.formatMessage(
                            { id: "documents.restoreRow", defaultMessage: "Restore {title}" },
                            { title: row.title },
                          )}
                          onClick={() => void restoreRow(row)}
                        >
                          <FormattedMessage
                            id="documents.action.restore"
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
      </div>
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

function RecentDocuments({ documents }: Readonly<{ documents: RepositoryDocument[] }>) {
  const intl = useIntl();
  return (
    <section
      aria-label={intl.formatMessage({
        id: "documents.recent.region",
        defaultMessage: "Recent documents",
      })}
      className="flex flex-col gap-2"
    >
      <h2 className="text-sm font-semibold text-primary">
        <FormattedMessage id="documents.recent.title" defaultMessage="Recent" />
      </h2>
      <ul className="rounded-card border border-border-default bg-raised">
        {documents.map((document, index) => (
          <li
            key={document.id}
            className={index === 0 ? undefined : "border-t border-border-default"}
          >
            <Link
              to={documentLandingPath(document)}
              aria-label={intl.formatMessage(
                {
                  id: "documents.recent.open",
                  defaultMessage: "Open recent Document {title}",
                },
                { title: document.title },
              )}
              className="grid min-h-11 grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(10rem,auto)_auto] items-center gap-4 px-4 py-2 text-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-link"
            >
              <span className="truncate font-medium">{document.title}</span>
              <span className="truncate text-muted">
                <FormattedMessage
                  id="documents.list.owner"
                  defaultMessage="{reference} · {title}"
                  values={{
                    reference: `${document.owner.kind === "contract" ? "C" : "M"}-${String(document.owner.number)}`,
                    title: document.owner.title,
                  }}
                />
              </span>
              <span className="flex min-w-0 items-center gap-2 text-muted">
                <Avatar
                  name={document.currentVersion.uploadedBy.displayName}
                  image={document.currentVersion.uploadedBy.image}
                  className="size-6"
                />
                <span className="truncate">{document.currentVersion.uploadedBy.displayName}</span>
              </span>
              <span className="whitespace-nowrap text-muted">
                {formatRelativeOrShort(document.currentVersion.createdAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
