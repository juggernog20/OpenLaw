// SPDX-License-Identifier: AGPL-3.0-only

/** M26's flat Documents destination, with the DES-046 managed table. */
import { useState } from "react";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { FileText } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { documentLandingPath, type RepositoryDocument } from "../lib/documents";
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
import { ColumnMenu } from "../components/table/column-menu";
import { ManagedTable } from "../components/table/managed-table";
import { ViewsMenu } from "../components/table/views-menu";
import { Button } from "../components/ui/button";

export async function documentsLoader() {
  const user = await requireUser();
  if (!canReadContracts(user.role)) return redirect("/");
  const views = await readViews(CATALOGUE.surface);
  const opensOn = views.find((view) => view.isDefault) ?? null;
  const layout = opensOn ? resolveLayout(CATALOGUE, opensOn.layout) : builtInLayout(CATALOGUE);
  const { data } = await api.GET("/api/v1/documents");
  if (!data) throw new Error("The Document list could not be read.");
  return {
    user,
    documents: data.documents,
    nextCursor: data.nextCursor,
    views,
    layout,
    activeViewId: opensOn?.id ?? null,
  };
}

export function DocumentsPage() {
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
  const [pageError, setPageError] = useState(false);
  const [appended, setAppended] = useState<{ count: number; from: string } | null>(null);

  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  const storedLayout = activeView
    ? resolveLayout(CATALOGUE, activeView.layout)
    : builtInLayout(CATALOGUE);
  const modified = !sameLayout(layout, storedLayout);

  async function showMore() {
    if (busy || cursor === null) return;
    setBusy(true);
    setPageError(false);
    const { data } = await api
      .GET("/api/v1/documents", { params: { query: { cursor } } })
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
    rows.length === 0 ? undefined : (
      <>
        <ViewsMenu
          views={views}
          activeView={activeView}
          modified={modified}
          busy={busy}
          onSelect={(view) => {
            setLayout(view ? resolveLayout(CATALOGUE, view.layout) : builtInLayout(CATALOGUE));
            setActiveViewId(view?.id ?? null);
          }}
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
            setLayout(builtInLayout(CATALOGUE));
            setActiveViewId(null);
          }}
          onReset={() => setLayout(storedLayout)}
        />
        <ColumnMenu catalogue={CATALOGUE} layout={layout} onLayoutChange={setLayout} />
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
        />
      }
    >
      <PageTitle title={intl.formatMessage({ id: "nav.documents", defaultMessage: "Documents" })} />
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
          <FileText size={24} aria-hidden="true" className="text-subtle" />
          <div className="flex flex-col gap-1">
            <h2 className="text-md font-semibold">
              <FormattedMessage
                id="documents.list.empty.title"
                defaultMessage="Paper lives on Contracts and Matters."
              />
            </h2>
            <p className="text-base text-muted">
              <FormattedMessage
                id="documents.list.empty.body"
                defaultMessage="Upload to a record and it appears here."
              />
            </p>
          </div>
        </div>
      ) : (
        <ManagedTable
          catalogue={CATALOGUE}
          layout={layout}
          rows={rows}
          rowKey={(row) => row.id}
          onLayoutChange={setLayout}
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
