// SPDX-License-Identifier: AGPL-3.0-only

/** M28's Member+ Knowledge library and folder-scoped managed list. */
import { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { redirect, useLoaderData, useNavigate } from "react-router";
import type { paths } from "@openlaw/api-client";
import { KNOWLEDGE_LIST_SORT_KEYS, type KnowledgeListSortKey } from "@openlaw/shared";
import { api } from "../lib/api";
import { CONTROL_CLASS } from "../lib/form-controls";
import {
  folderDepth,
  folderLabel,
  type KnowledgeFolder,
  type KnowledgeItem,
} from "../lib/knowledge";
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
import { problem } from "../lib/problem";
import { isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { KNOWLEDGE_CATALOGUE as CATALOGUE } from "../components/knowledge/knowledge-columns";
import { PageTitle } from "../components/page-title";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { ColumnMenu } from "../components/table/column-menu";
import { ManagedTable } from "../components/table/managed-table";
import { ViewsMenu } from "../components/table/views-menu";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

type KnowledgeQuery = NonNullable<paths["/api/v1/knowledge"]["get"]["parameters"]["query"]>;
type KnowledgeType = { id: string; slug: string; displayName: string };
type Author = { id: string; displayName: string; image: string | null; archived: boolean };

function isSortKey(value: string): value is KnowledgeListSortKey {
  return (KNOWLEDGE_LIST_SORT_KEYS as readonly string[]).includes(value);
}

function listQuery(layout: Layout): KnowledgeQuery {
  const value = (key: string) => {
    const raw = layout.filters[key];
    return typeof raw === "string" && raw ? raw : undefined;
  };
  const state = value("state");
  const audience = value("audience");
  const sort =
    layout.sort && isSortKey(layout.sort.key)
      ? { key: layout.sort.key, dir: layout.sort.dir }
      : null;
  return {
    ...(value("type") ? { type: value("type") } : {}),
    ...(state === "draft" || state === "published" ? { state } : {}),
    ...(audience === "legal_only" || audience === "everyone" ? { audience } : {}),
    ...(value("folder") ? { folder: value("folder") } : {}),
    ...(value("author") ? { author: value("author") } : {}),
    ...(value("format") ? { format: value("format") as KnowledgeQuery["format"] } : {}),
    ...(sort ? { sort: sort.key, dir: sort.dir } : {}),
  };
}

async function readList(layout: Layout) {
  return api.GET("/api/v1/knowledge", { params: { query: listQuery(layout) } });
}

export async function knowledgeLoader() {
  const user = await requireUser();
  if (!isMemberPlus(user.role)) return redirect("/");
  const [views, types, folders, options] = await Promise.all([
    readViews(CATALOGUE.surface),
    api.GET("/api/v1/knowledge/type-options"),
    api.GET("/api/v1/knowledge/folders"),
    api.GET("/api/v1/knowledge/options"),
  ]);
  if (!types.data || !folders.data || !options.data)
    throw new Error("The Knowledge library could not be read.");
  const active = views.find((view) => view.isDefault) ?? null;
  const layout = active ? resolveLayout(CATALOGUE, active.layout) : builtInLayout(CATALOGUE);
  const list = await readList(layout);
  if (!list.data) throw new Error("The Knowledge library could not be read.");
  return {
    user,
    views,
    activeViewId: active?.id ?? null,
    layout,
    rows: list.data.knowledgeItems,
    cursor: list.data.nextCursor,
    types: types.data.knowledgeTypes,
    folders: folders.data.folders,
    authors: options.data.authors,
  };
}

export function KnowledgePage() {
  const loaded = useLoaderData<typeof knowledgeLoader>();
  const intl = useIntl();
  const navigate = useNavigate();
  const signOut = useSignOut("/auth/login");
  const [rows, setRows] = useState<KnowledgeItem[]>(loaded.rows);
  const [cursor, setCursor] = useState<string | null>(loaded.cursor);
  const [layout, setLayout] = useState<Layout>(loaded.layout);
  const [views, setViews] = useState<SavedView[]>(loaded.views);
  const [activeViewId, setActiveViewId] = useState<string | null>(loaded.activeViewId);
  const [folders, setFolders] = useState<KnowledgeFolder[]>(loaded.folders);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [folderEditOpen, setFolderEditOpen] = useState(false);
  const [folderEditName, setFolderEditName] = useState("");
  const [folderEditParent, setFolderEditParent] = useState("");
  const [folderDeleteOpen, setFolderDeleteOpen] = useState(false);
  const [folderDeleteError, setFolderDeleteError] = useState<string | null>(null);
  const activeView = views.find((view) => view.id === activeViewId) ?? null;
  const stored = activeView
    ? resolveLayout(CATALOGUE, activeView.layout)
    : builtInLayout(CATALOGUE);
  const narrowed = Object.values(layout.filters).some((value) => Boolean(value));
  const selectedFolder = typeof layout.filters.folder === "string" ? layout.filters.folder : "";

  async function commit(next: Layout, nextView = activeViewId) {
    if (busy) return;
    if (JSON.stringify(listQuery(next)) === JSON.stringify(listQuery(layout))) {
      setLayout(next);
      setActiveViewId(nextView);
      return;
    }
    setBusy(true);
    setError(null);
    const answer = await readList(next).catch(() => ({ data: undefined }));
    setBusy(false);
    if (!answer.data) {
      setError(
        intl.formatMessage({
          id: "knowledge.list.error",
          defaultMessage: "The Knowledge list could not be read. Try again.",
        }),
      );
      return;
    }
    setRows(answer.data.knowledgeItems);
    setCursor(answer.data.nextCursor);
    setLayout(next);
    setActiveViewId(nextView);
  }

  function filter(key: string, value: string) {
    void commit({ ...layout, filters: { ...layout.filters, [key]: value } });
  }

  async function showMore() {
    if (!cursor || busy) return;
    setBusy(true);
    const answer = await api
      .GET("/api/v1/knowledge", { params: { query: { ...listQuery(layout), cursor } } })
      .catch(() => ({ data: undefined }));
    setBusy(false);
    if (!answer.data)
      return setError(
        intl.formatMessage({
          id: "knowledge.list.moreError",
          defaultMessage: "More Knowledge items could not be read.",
        }),
      );
    setRows((current) => [...current, ...answer.data.knowledgeItems]);
    setCursor(answer.data.nextCursor);
  }

  async function createFolder() {
    const name = folderNameDraft.trim();
    if (!name || busy) return;
    setBusy(true);
    const answer = await api
      .POST("/api/v1/knowledge/folders", {
        body: { name, ...(selectedFolder ? { parentId: selectedFolder } : {}) },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (!answer.data) {
      const issue = await problem(answer);
      setError(
        issue.detail ??
          intl.formatMessage({
            id: "knowledge.folder.createError",
            defaultMessage: "The folder could not be created.",
          }),
      );
      return;
    }
    setFolders(answer.data.folders);
    setFolderNameDraft("");
    setFolderOpen(false);
  }

  async function deleteFolder() {
    const target = folders.find((row) => row.id === selectedFolder);
    if (!target || busy) return;
    setBusy(true);
    const answer = await api
      .DELETE("/api/v1/knowledge/folders/{folderId}", { params: { path: { folderId: target.id } } })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (!answer.data) {
      setFolderDeleteError(
        (await problem(answer)).detail ??
          intl.formatMessage({
            id: "knowledge.folder.deleteError",
            defaultMessage: "The folder could not be deleted.",
          }),
      );
      return;
    }
    setFolderDeleteOpen(false);
    setFolders(answer.data.folders);
    await commit({ ...layout, filters: { ...layout.filters, folder: target.parentId ?? "" } });
  }

  function openFolderEditor() {
    const target = folders.find((row) => row.id === selectedFolder);
    if (!target) return;
    setFolderEditName(target.name);
    setFolderEditParent(target.parentId ?? "");
    setFolderEditOpen(true);
  }

  async function updateFolder() {
    const target = folders.find((row) => row.id === selectedFolder);
    const name = folderEditName.trim();
    if (!target || !name || busy) return;
    const body: { name?: string; parentId?: string | null } = {};
    if (name !== target.name) body.name = name;
    if ((folderEditParent || null) !== target.parentId) body.parentId = folderEditParent || null;
    if (Object.keys(body).length === 0) {
      setFolderEditOpen(false);
      return;
    }
    setBusy(true);
    const answer = await api
      .PATCH("/api/v1/knowledge/folders/{folderId}", {
        params: { path: { folderId: target.id } },
        body,
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (!answer.data) {
      setError(
        (await problem(answer)).detail ??
          intl.formatMessage({
            id: "knowledge.folder.updateError",
            defaultMessage: "The folder could not be updated.",
          }),
      );
      return;
    }
    setFolders(answer.data.folders);
    if (body.name) {
      setRows((current) =>
        current.map((row) =>
          row.folderId === target.id ? { ...row, folderName: body.name ?? row.folderName } : row,
        ),
      );
    }
    setFolderEditOpen(false);
  }

  async function reorder(folder: KnowledgeFolder, direction: -1 | 1) {
    const siblings = folders.filter((row) => row.parentId === folder.parentId);
    const index = siblings.findIndex((row) => row.id === folder.id);
    const other = index + direction;
    if (index < 0 || other < 0 || other >= siblings.length || busy) return;
    const ids = siblings.map((row) => row.id);
    [ids[index], ids[other]] = [ids[other]!, ids[index]!];
    setBusy(true);
    const answer = await api
      .PUT("/api/v1/knowledge/folders/order", { body: { parentId: folder.parentId, ids } })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (answer.data) setFolders(answer.data.folders);
    else
      setError(
        (await problem(answer)).detail ??
          intl.formatMessage({
            id: "knowledge.folder.reorderError",
            defaultMessage: "The folder could not be reordered.",
          }),
      );
  }

  const controls =
    rows.length === 0 && !narrowed ? null : (
      <>
        <ViewsMenu
          views={views}
          activeView={activeView}
          modified={!sameLayout(layout, stored)}
          busy={busy}
          onSelect={(view) =>
            void commit(
              view ? resolveLayout(CATALOGUE, view.layout) : builtInLayout(CATALOGUE),
              view?.id ?? null,
            )
          }
          onSave={async () => {
            if (activeView) setViews(await updateView(activeView.id, { config: layout }));
          }}
          onSaveAs={async (name) => {
            const next = await createView(CATALOGUE.surface, name, layout);
            setViews(next);
            setActiveViewId(next.find((view) => view.name === name)?.id ?? null);
          }}
          onRename={async (name) => {
            if (activeView) setViews(await updateView(activeView.id, { name }));
          }}
          onSetDefault={async () => {
            if (activeView) setViews(await updateView(activeView.id, { isDefault: true }));
          }}
          onDelete={async (view) => {
            setViews(await deleteView(view.id));
            await commit(builtInLayout(CATALOGUE), null);
          }}
          onReset={() => void commit(stored)}
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
          title={<FormattedMessage id="nav.knowledge" defaultMessage="Knowledge" />}
          subtitle={
            <FormattedMessage
              id="knowledge.list.count"
              defaultMessage="{count, plural, one {# item shown} other {# items shown}}"
              values={{ count: rows.length }}
            />
          }
          primaryAction={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Plus size={16} aria-hidden="true" />
                  <FormattedMessage id="knowledge.new.action" defaultMessage="New" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setFilesOpen(true)}>
                  <Upload size={16} aria-hidden="true" />
                  <FormattedMessage id="knowledge.new.fromFiles" defaultMessage="New from files" />
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
                  <BookOpen size={16} aria-hidden="true" />
                  <FormattedMessage id="knowledge.new.item" defaultMessage="New knowledge item" />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
          actions={controls}
          filters={
            <KnowledgeFilters
              layout={layout}
              types={loaded.types}
              authors={loaded.authors}
              busy={busy}
              onFilter={filter}
              onClear={() => void commit({ ...layout, filters: {} })}
            />
          }
        />
      }
    >
      <PageTitle title={intl.formatMessage({ id: "nav.knowledge", defaultMessage: "Knowledge" })} />
      <div className="grid min-h-0 gap-4 @xl/page:grid-cols-[16rem_minmax(0,1fr)]">
        <aside
          aria-label={intl.formatMessage({
            id: "knowledge.folder.tree",
            defaultMessage: "Knowledge folders",
          })}
          className="rounded-card border border-border-default bg-raised p-2"
        >
          <button
            type="button"
            aria-current={!selectedFolder ? "page" : undefined}
            onClick={() => filter("folder", "")}
            className="flex min-h-8 w-full items-center gap-2 rounded-button px-2 text-start text-sm hover:bg-hover aria-[current=page]:bg-selected"
          >
            <BookOpen size={16} aria-hidden="true" />
            <FormattedMessage id="knowledge.folder.all" defaultMessage="All Knowledge" />
          </button>
          <ul className="mt-1">
            {folders.map((folder) => (
              <li key={folder.id} className="flex items-center">
                <button
                  type="button"
                  aria-current={selectedFolder === folder.id ? "page" : undefined}
                  onClick={() => filter("folder", folder.id)}
                  style={{
                    paddingInlineStart: `${String(8 + folderDepth(folders, folder) * 16)}px`,
                  }}
                  className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-button pe-2 text-start text-sm hover:bg-hover aria-[current=page]:bg-selected"
                >
                  <Folder size={16} aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{folder.name}</span>
                  <span className="ms-auto text-xs text-muted">{folder.itemCount}</span>
                </button>
                {selectedFolder === folder.id ? (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={intl.formatMessage(
                        { id: "knowledge.folder.moveUp", defaultMessage: "Move {name} up" },
                        { name: folder.name },
                      )}
                      onClick={() => void reorder(folder, -1)}
                    >
                      <ChevronUp size={16} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={intl.formatMessage(
                        { id: "knowledge.folder.moveDown", defaultMessage: "Move {name} down" },
                        { name: folder.name },
                      )}
                      onClick={() => void reorder(folder, 1)}
                    >
                      <ChevronDown size={16} />
                    </Button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-1 border-t border-border-default pt-2">
            <Button size="sm" variant="secondary" onClick={() => setFolderOpen(true)}>
              <FolderPlus size={16} />
              <FormattedMessage id="knowledge.folder.add" defaultMessage="Add folder" />
            </Button>
            {selectedFolder ? (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={intl.formatMessage({
                    id: "knowledge.folder.edit",
                    defaultMessage: "Rename or move selected folder",
                  })}
                  onClick={openFolderEditor}
                >
                  <Pencil size={16} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={intl.formatMessage({
                    id: "knowledge.folder.delete",
                    defaultMessage: "Delete selected folder",
                  })}
                  onClick={() => {
                    setFolderDeleteError(null);
                    setFolderDeleteOpen(true);
                  }}
                >
                  <Trash2 size={16} />
                </Button>
              </>
            ) : null}
          </div>
        </aside>
        <section
          aria-label={intl.formatMessage({
            id: "knowledge.list.region",
            defaultMessage: "Knowledge items",
          })}
        >
          {error ? (
            <p
              role="alert"
              className="mb-3 rounded-card bg-status-danger-bg px-3 py-2 text-status-danger-fg"
            >
              {error}
            </p>
          ) : null}
          {rows.length === 0 ? (
            <Empty
              narrowed={narrowed}
              busy={busy}
              onClear={() => void commit({ ...layout, filters: {} })}
              onCreate={() => setCreateOpen(true)}
            />
          ) : (
            <ManagedTable
              catalogue={CATALOGUE}
              layout={layout}
              rows={rows}
              rowKey={(row) => row.id}
              onLayoutChange={(next) => void commit(next)}
              onRowActivate={(row) => void navigate(`/knowledge/${row.id}`)}
              foot={
                cursor ? (
                  <Button variant="secondary" disabled={busy} onClick={() => void showMore()}>
                    <FormattedMessage id="knowledge.list.more" defaultMessage="Show more" />
                  </Button>
                ) : undefined
              }
            />
          )}
        </section>
      </div>
      <CreateItemDialog
        key={createOpen ? `create-open:${selectedFolder}` : "create-closed"}
        open={createOpen}
        onOpenChange={setCreateOpen}
        types={loaded.types}
        folders={folders}
        initialFolder={selectedFolder}
        onCreated={(item) => void navigate(`/knowledge/${item.id}`)}
      />
      <CreateFromFilesDialog
        key={filesOpen ? `files-open:${selectedFolder}` : "files-closed"}
        open={filesOpen}
        onOpenChange={setFilesOpen}
        types={loaded.types}
        folders={folders}
        initialFolder={selectedFolder}
        onCreated={(id) => void navigate(`/knowledge/${id}`)}
      />
      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent>
          <DialogTitle>
            <FormattedMessage id="knowledge.folder.addTitle" defaultMessage="Add folder" />
          </DialogTitle>
          <div className="mt-4 flex flex-col gap-1.5">
            <Label htmlFor="knowledge-folder-name">
              <FormattedMessage id="knowledge.folder.name" defaultMessage="Folder name" />
            </Label>
            <Input
              id="knowledge-folder-name"
              value={folderNameDraft}
              onChange={(event) => setFolderNameDraft(event.target.value)}
            />
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setFolderOpen(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button disabled={!folderNameDraft.trim() || busy} onClick={() => void createFolder()}>
              <FormattedMessage id="knowledge.folder.add" defaultMessage="Add folder" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={folderEditOpen} onOpenChange={setFolderEditOpen}>
        <DialogContent>
          <DialogTitle>
            <FormattedMessage
              id="knowledge.folder.editTitle"
              defaultMessage="Rename or move folder"
            />
          </DialogTitle>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="knowledge-folder-edit-name">
                <FormattedMessage id="knowledge.folder.name" defaultMessage="Folder name" />
              </Label>
              <Input
                id="knowledge-folder-edit-name"
                value={folderEditName}
                onChange={(event) => setFolderEditName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="knowledge-folder-parent">
                <FormattedMessage id="knowledge.folder.parent" defaultMessage="Parent folder" />
              </Label>
              <select
                id="knowledge-folder-parent"
                className={CONTROL_CLASS}
                value={folderEditParent}
                onChange={(event) => setFolderEditParent(event.target.value)}
              >
                <option value="">
                  <FormattedMessage id="knowledge.folder.root" defaultMessage="Library" />
                </option>
                {folders
                  .filter(
                    (row) =>
                      row.id !== selectedFolder && !folderIsInside(folders, row.id, selectedFolder),
                  )
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {folderLabel(folders, row.id)}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setFolderEditOpen(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button disabled={!folderEditName.trim() || busy} onClick={() => void updateFolder()}>
              <FormattedMessage id="knowledge.folder.save" defaultMessage="Save folder" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={folderDeleteOpen} onOpenChange={setFolderDeleteOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>
            <FormattedMessage
              id="knowledge.folder.deleteTitle"
              defaultMessage="Delete the {name} folder?"
              values={{ name: folders.find((row) => row.id === selectedFolder)?.name ?? "" }}
            />
          </DialogTitle>
          <p className="mt-4 text-base text-primary">
            <FormattedMessage
              id="knowledge.folder.deleteBody"
              defaultMessage="Its folders and items move to the parent folder. Nothing is deleted."
            />
          </p>
          {folderDeleteError ? (
            <p role="alert" className="mt-2.5 text-xs text-status-danger-fg">
              {folderDeleteError}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setFolderDeleteOpen(false)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void deleteFolder()}>
              <FormattedMessage id="knowledge.folder.deleteSubmit" defaultMessage="Delete folder" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

/** Whether candidate sits below target and would therefore close a cycle. */
function folderIsInside(
  folders: readonly KnowledgeFolder[],
  candidateId: string,
  targetId: string,
): boolean {
  const byId = new Map(folders.map((row) => [row.id, row]));
  let current = byId.get(candidateId);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parentId === targetId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

function KnowledgeFilters({
  layout,
  types,
  authors,
  busy,
  onFilter,
  onClear,
}: Readonly<{
  layout: Layout;
  types: KnowledgeType[];
  authors: Author[];
  busy: boolean;
  onFilter: (key: string, value: string) => void;
  onClear: () => void;
}>) {
  const intl = useIntl();
  const filters = layout.filters;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter
        label={intl.formatMessage({ id: "knowledge.filter.type", defaultMessage: "Type" })}
        value={String(filters.type ?? "")}
        disabled={busy}
        onChange={(value) => onFilter("type", value)}
        options={types.map((row) => [row.id, row.displayName])}
      />
      <Filter
        label={intl.formatMessage({ id: "knowledge.filter.state", defaultMessage: "State" })}
        value={String(filters.state ?? "")}
        disabled={busy}
        onChange={(value) => onFilter("state", value)}
        options={[
          ["draft", intl.formatMessage({ id: "knowledge.state.draft", defaultMessage: "Draft" })],
          [
            "published",
            intl.formatMessage({ id: "knowledge.state.published", defaultMessage: "Published" }),
          ],
        ]}
      />
      <Filter
        label={intl.formatMessage({
          id: "knowledge.filter.audience",
          defaultMessage: "Audience",
        })}
        value={String(filters.audience ?? "")}
        disabled={busy}
        onChange={(value) => onFilter("audience", value)}
        options={[
          [
            "legal_only",
            intl.formatMessage({
              id: "knowledge.audience.legalOnly",
              defaultMessage: "Legal Only",
            }),
          ],
          [
            "everyone",
            intl.formatMessage({
              id: "knowledge.audience.everyone",
              defaultMessage: "Everyone",
            }),
          ],
        ]}
      />
      <Filter
        label={intl.formatMessage({ id: "knowledge.filter.author", defaultMessage: "Author" })}
        value={String(filters.author ?? "")}
        disabled={busy}
        onChange={(value) => onFilter("author", value)}
        options={authors.map((row) => [row.id, row.displayName])}
      />
      <Filter
        label={intl.formatMessage({ id: "knowledge.filter.format", defaultMessage: "Format" })}
        value={String(filters.format ?? "")}
        disabled={busy}
        onChange={(value) => onFilter("format", value)}
        options={[
          ["pdf", "PDF"],
          ["word", "Word"],
          ["powerpoint", "PowerPoint"],
          ["image", "Image"],
          ["email", "Email"],
          ["other", "Other"],
        ]}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || !Object.values(filters).some(Boolean)}
        onClick={onClear}
      >
        <FormattedMessage id="knowledge.filters.clear" defaultMessage="Clear filters" />
      </Button>
    </div>
  );
}

function Filter({
  label,
  value,
  disabled,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  disabled: boolean;
  options: string[][];
  onChange: (value: string) => void;
}>) {
  const intl = useIntl();
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted">
      <span>{label}</span>
      <select
        aria-label={label}
        className={`${CONTROL_CLASS} min-w-32`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {intl.formatMessage({ id: "knowledge.filter.all", defaultMessage: "All" })}
        </option>
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Empty({
  narrowed,
  busy,
  onClear,
  onCreate,
}: Readonly<{ narrowed: boolean; busy: boolean; onClear: () => void; onCreate: () => void }>) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-border-default bg-raised px-6 py-16 text-center">
      <BookOpen size={24} aria-hidden="true" className="text-subtle" />
      <div>
        <h2 className="text-md font-semibold">
          {narrowed ? (
            <FormattedMessage
              id="knowledge.empty.filteredTitle"
              defaultMessage="No Knowledge items match these filters"
            />
          ) : (
            <FormattedMessage
              id="knowledge.empty.title"
              defaultMessage="Build your Knowledge library"
            />
          )}
        </h2>
        <p className="mt-1 text-muted">
          {narrowed ? (
            <FormattedMessage
              id="knowledge.empty.filteredBody"
              defaultMessage="Clear filters or choose another folder."
            />
          ) : (
            <FormattedMessage
              id="knowledge.empty.body"
              defaultMessage="Create guidance your legal team can find again."
            />
          )}
        </p>
      </div>
      <Button disabled={busy} onClick={narrowed ? onClear : onCreate}>
        {narrowed ? (
          <FormattedMessage id="knowledge.filters.clear" defaultMessage="Clear filters" />
        ) : (
          <FormattedMessage id="knowledge.create.action" defaultMessage="New item" />
        )}
      </Button>
    </div>
  );
}

function CreateItemDialog({
  open,
  onOpenChange,
  types,
  folders,
  initialFolder,
  onCreated,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: KnowledgeType[];
  folders: KnowledgeFolder[];
  initialFolder: string;
  onCreated: (item: KnowledgeItem) => void;
}>) {
  const intl = useIntl();
  const [title, setTitle] = useState("");
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [folderId, setFolderId] = useState(initialFolder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function create() {
    if (!title.trim() || !typeId || busy) return;
    setBusy(true);
    setError(undefined);
    const answer = await api
      .POST("/api/v1/knowledge", {
        body: { title: title.trim(), knowledgeTypeId: typeId, ...(folderId ? { folderId } : {}) },
      })
      .catch(() => ({ data: undefined, error: undefined }));
    setBusy(false);
    if (!answer.data) return setError((await problem(answer)).detail);
    onOpenChange(false);
    onCreated(answer.data.knowledgeItem);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>
          <FormattedMessage id="knowledge.create.title" defaultMessage="New Knowledge item" />
        </DialogTitle>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge-title">
              <FormattedMessage id="knowledge.form.title" defaultMessage="Title" />
            </Label>
            <Input
              id="knowledge-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge-type">
              <FormattedMessage id="knowledge.form.type" defaultMessage="Type" />
            </Label>
            <select
              id="knowledge-type"
              className={CONTROL_CLASS}
              value={typeId}
              onChange={(event) => setTypeId(event.target.value)}
            >
              {types.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.displayName}
                </option>
              ))}
            </select>
            {types.length === 0 ? (
              <p className="text-sm text-status-danger-fg">
                <FormattedMessage
                  id="knowledge.form.noTypes"
                  defaultMessage="An Administrator must add a Knowledge type first."
                />
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge-folder">
              <FormattedMessage id="knowledge.form.folder" defaultMessage="Folder" />
            </Label>
            <select
              id="knowledge-folder"
              className={CONTROL_CLASS}
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
            >
              <option value="">
                <FormattedMessage id="knowledge.folder.root" defaultMessage="Library" />
              </option>
              {folders.map((row) => (
                <option key={row.id} value={row.id}>
                  {folderLabel(folders, row.id)}
                </option>
              ))}
            </select>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
          </Button>
          <Button disabled={busy || !title.trim() || !typeId} onClick={() => void create()}>
            {busy
              ? intl.formatMessage({ id: "knowledge.creating", defaultMessage: "Creating…" })
              : intl.formatMessage({
                  id: "knowledge.create.submit",
                  defaultMessage: "Create item",
                })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateFromFilesDialog({
  open,
  onOpenChange,
  types,
  folders,
  initialFolder,
  onCreated,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: KnowledgeType[];
  folders: KnowledgeFolder[];
  initialFolder: string;
  onCreated: (id: string) => void;
}>) {
  const [files, setFiles] = useState<File[]>([]);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [folderId, setFolderId] = useState(initialFolder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const intl = useIntl();
  const refused = intl.formatMessage({
    id: "knowledge.fromFiles.failed",
    defaultMessage: "The files could not be added.",
  });

  async function create() {
    if (files.length === 0 || !typeId || busy) return;
    setBusy(true);
    setError(undefined);
    const body = new FormData();
    body.append("knowledgeTypeId", typeId);
    if (folderId) body.append("folderId", folderId);
    for (const file of files) body.append("file", file, file.name);
    const response = await fetch("/api/v1/knowledge/from-files", { method: "POST", body }).catch(
      () => undefined,
    );
    setBusy(false);
    if (!response?.ok) {
      setError((await problem(response)).detail ?? refused);
      return;
    }
    const answer = (await response.json()) as { knowledgeItems?: Array<{ id: string }> };
    const first = answer.knowledgeItems?.[0];
    if (!first) {
      setError(refused);
      return;
    }
    onOpenChange(false);
    onCreated(first.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>
          <FormattedMessage id="knowledge.fromFiles.title" defaultMessage="New from files" />
        </DialogTitle>
        <div className="mt-4 flex flex-col gap-4">
          <label
            className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-card border border-dashed border-border-strong bg-subtle px-4 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              setFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <Upload size={24} aria-hidden="true" className="mb-2 text-muted" />
            <span className="font-medium">
              <FormattedMessage
                id="knowledge.fromFiles.drop"
                defaultMessage="Drop files here or choose files"
              />
            </span>
            <span className="mt-1 text-sm text-muted">
              <FormattedMessage
                id="knowledge.fromFiles.count"
                defaultMessage="{count, plural, =0 {No files selected} one {# file selected} other {# files selected}}"
                values={{ count: files.length }}
              />
            </span>
            <input
              className="sr-only"
              type="file"
              multiple
              aria-label={intl.formatMessage({
                id: "knowledge.fromFiles.choose",
                defaultMessage: "Choose Knowledge files",
              })}
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge-files-type">
              <FormattedMessage id="knowledge.form.type" defaultMessage="Type" />
            </Label>
            <select
              id="knowledge-files-type"
              className={CONTROL_CLASS}
              value={typeId}
              onChange={(event) => setTypeId(event.target.value)}
            >
              {types.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="knowledge-files-folder">
              <FormattedMessage id="knowledge.form.folder" defaultMessage="Folder" />
            </Label>
            <select
              id="knowledge-files-folder"
              className={CONTROL_CLASS}
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
            >
              <option value="">
                <FormattedMessage id="knowledge.folder.root" defaultMessage="Library" />
              </option>
              {folders.map((row) => (
                <option key={row.id} value={row.id}>
                  {folderLabel(folders, row.id)}
                </option>
              ))}
            </select>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          ) : null}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
          </Button>
          <Button disabled={busy || files.length === 0 || !typeId} onClick={() => void create()}>
            <FormattedMessage id="knowledge.fromFiles.submit" defaultMessage="Create drafts" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
