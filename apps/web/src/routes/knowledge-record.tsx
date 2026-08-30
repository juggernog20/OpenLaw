// SPDX-License-Identifier: AGPL-3.0-only

/** M28's one-section Knowledge record with DES-017 field commits. */
import { useMemo, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  ChevronRight,
  Eye,
  Globe2,
  MoreHorizontal,
  Pencil,
  Send,
  Undo2,
} from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { useFieldCommit, type TextField } from "../lib/field-commit";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { folderLabel, type KnowledgeRecord } from "../lib/knowledge";
import { isMemberPlus } from "../lib/roles";
import { requireUser, useSignOut } from "../lib/session";
import { useActivityApplet } from "../components/activity/activity-applet";
import { KnowledgeMarkdown } from "../components/knowledge/markdown";
import { PageTitle } from "../components/page-title";
import { AppShell } from "../components/shell/app-shell";
import { RecordApplets } from "../components/shell/record-applets";
import { StatusNote } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { DocumentsCard } from "../components/documents/documents-card";
import { DocPanel } from "../components/documents/doc-panel";
import { RecordContext } from "../components/record-context";
import { readDocumentLanding, readRecordDocuments, type ContractDocument } from "../lib/documents";

type PatchBody =
  paths["/api/v1/knowledge/{id}"]["patch"]["requestBody"]["content"]["application/json"];

export async function knowledgeRecordLoader({ params, request }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!isMemberPlus(user.role)) return redirect("/");
  const id = params.id!;
  const landingQuery = new URL(request.url).searchParams;
  const documentId = landingQuery.get("doc")?.trim();
  const versionId = landingQuery.get("version")?.trim();
  const [item, types, folders, paper, landing, replacements] = await Promise.all([
    api.GET("/api/v1/knowledge/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/knowledge/type-options"),
    api.GET("/api/v1/knowledge/folders"),
    readRecordDocuments({ entityType: "knowledge_item", id }, false),
    documentId && versionId
      ? readDocumentLanding({ entityType: "knowledge_item", id }, documentId, versionId)
      : null,
    api.GET("/api/v1/knowledge", {
      params: { query: { sort: "title", dir: "asc" } },
    }),
  ]);
  if (!item.data || !types.data || !folders.data || !paper.ok || !replacements.data)
    throw new Error("The Knowledge item could not be read.");
  return {
    user,
    item: item.data.knowledgeItem,
    types: types.data.knowledgeTypes,
    folders: folders.data.folders,
    documents: paper.documents,
    documentCursor: paper.nextCursor,
    landing,
    documentFindQuery: landingQuery.get("find")?.trim() || null,
    replacementItems: replacements.data.knowledgeItems.filter((row) => row.id !== id),
  };
}

type FieldKey = "title" | "type" | "folder" | "body" | "audience";

export function KnowledgeRecordPage() {
  const loaded = useLoaderData<typeof knowledgeRecordLoader>();
  const intl = useIntl();
  const signOut = useSignOut("/auth/login");
  const [saved, setSaved] = useState<KnowledgeRecord>(loaded.item);
  const [title, setTitle] = useState(saved.title);
  const [body, setBody] = useState(saved.body ?? "");
  const [editingBody, setEditingBody] = useState(Boolean(saved.body));
  const [preview, setPreview] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [replacementId, setReplacementId] = useState("");
  const [reachWarning, setReachWarning] = useState<"unpublish" | "legal_only" | null>(null);
  const [paper, setPaper] = useState<ContractDocument[]>(loaded.documents);
  const [paperCursor, setPaperCursor] = useState<string | null>(loaded.documentCursor);
  const [filed, setFiled] = useState<ContractDocument[]>([]);
  const [reading, setReading] = useState<{ documentId: string; versionId: string } | null>(
    loaded.landing
      ? { documentId: loaded.landing.document.id, versionId: loaded.landing.versionId }
      : null,
  );
  const textarea = useRef<HTMLTextAreaElement>(null);
  const commits = useFieldCommit<FieldKey>();
  const history = useActivityApplet({ entityType: "knowledge_item", entityId: saved.id });
  const recordFacts = useMemo(
    () => ({
      record: { kind: "knowledge_item" as const, id: saved.id, number: 0 },
      viewer: { id: loaded.user.id, role: loaded.user.role },
      ownerId: null,
      confidential: false,
      canEdit: true,
      frozen: saved.archivedAt !== null,
    }),
    [loaded.user.id, loaded.user.role, saved.archivedAt, saved.id],
  );
  const open = useMemo(() => {
    if (!reading) return null;
    const document = [...paper, ...filed].find((row) => row.id === reading.documentId);
    const version = document?.versions.find((row) => row.id === reading.versionId);
    return document && version ? { document, version } : null;
  }, [filed, paper, reading]);

  function commit(key: FieldKey, changes: PatchBody) {
    return commits.commit(
      key,
      () =>
        api.PATCH("/api/v1/knowledge/{id}", { params: { path: { id: saved.id } }, body: changes }),
      (data) => {
        setSaved(data.knowledgeItem);
        if (key === "title") setTitle(data.knowledgeItem.title);
        if (key === "body") setBody(data.knowledgeItem.body ?? "");
      },
    );
  }

  const titleField: TextField = {
    draft: title,
    saved: saved.title,
    required: true,
    reset: setTitle,
    send: (value) => commit("title", { title: value }),
  };

  function commitBody() {
    const next = body.trim() || null;
    if (next === saved.body) return;
    void commit("body", { body: next });
  }

  function showEditor() {
    setEditingBody(true);
    requestAnimationFrame(() => textarea.current?.focus());
  }

  async function runAction(kind: "publish" | "unpublish" | "archive" | "restore") {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError(undefined);
    const response =
      kind === "publish"
        ? await api.POST("/api/v1/knowledge/{id}/publish", {
            params: { path: { id: saved.id } },
            body: {},
          })
        : kind === "unpublish"
          ? await api.POST("/api/v1/knowledge/{id}/unpublish", {
              params: { path: { id: saved.id } },
              body: {},
            })
          : kind === "archive"
            ? await api.POST("/api/v1/knowledge/{id}/archive", {
                params: { path: { id: saved.id } },
                body: replacementId ? { replacedById: replacementId } : {},
              })
            : await api.POST("/api/v1/knowledge/{id}/restore", {
                params: { path: { id: saved.id } },
                body: {},
              });
    setActionBusy(false);
    if (!response.data) {
      setActionError(
        intl.formatMessage({
          id: "knowledge.action.failed",
          defaultMessage: "The Knowledge Item could not be changed.",
        }),
      );
      return;
    }
    setSaved(response.data.knowledgeItem);
    setArchiveOpen(false);
    setReachWarning(null);
  }

  function requestUnpublish() {
    if (saved.deflectionLinkCount > 0) setReachWarning("unpublish");
    else void runAction("unpublish");
  }

  function requestAudience(audience: "legal_only" | "everyone") {
    if (audience === saved.audience) return;
    if (audience === "legal_only" && saved.deflectionLinkCount > 0) {
      setReachWarning("legal_only");
      return;
    }
    void commit("audience", { audience });
  }

  function confirmLostReach() {
    if (reachWarning === "unpublish") void runAction("unpublish");
    else if (reachWarning === "legal_only") {
      setReachWarning(null);
      void commit("audience", { audience: "legal_only" });
    }
  }

  return (
    <RecordContext.Provider value={recordFacts}>
      <AppShell
        user={loaded.user}
        onSignOut={() => void signOut()}
        flush
        subbar={
          <section
            aria-labelledby="page-title"
            className="flex h-(--height-subbar) items-center gap-2 border-b border-(--chrome-subbar-border) bg-canvas px-page-x"
          >
            <Link to="/knowledge" className="text-link hover:underline">
              <FormattedMessage id="nav.knowledge" defaultMessage="Knowledge" />
            </Link>
            <ChevronRight size={16} aria-hidden="true" className="text-subtle" />
            <BookOpen size={16} aria-hidden="true" className="text-muted" />
            <h1 id="page-title" className="truncate text-md font-semibold">
              {saved.title}
            </h1>
            {saved.state === "draft" ? (
              <span className="rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
                <FormattedMessage id="knowledge.draftMarker" defaultMessage="Draft" />
              </span>
            ) : null}
            {saved.audience === "everyone" && saved.state === "published" && !saved.archivedAt ? (
              <span className="inline-flex items-center gap-1 rounded-pill bg-status-info-bg px-2 py-0.5 text-xs font-medium text-status-info-fg">
                <Globe2 size={12} aria-hidden="true" />
                <FormattedMessage id="knowledge.onPortal" defaultMessage="On the portal" />
              </span>
            ) : null}
            {saved.archivedAt ? (
              <span className="rounded-pill bg-status-neutral-bg px-2 py-0.5 text-xs font-medium text-status-neutral-fg">
                <FormattedMessage id="knowledge.archivedMarker" defaultMessage="Archived" />
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <StatusNote
                status={actionBusy ? "saving" : actionError ? "error" : "idle"}
                detail={actionError}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={actionBusy}
                    aria-label={intl.formatMessage({
                      id: "knowledge.actions",
                      defaultMessage: "Knowledge Item actions",
                    })}
                  >
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {saved.archivedAt ? (
                    <DropdownMenuItem onSelect={() => void runAction("restore")}>
                      <ArchiveRestore size={16} aria-hidden="true" />
                      <FormattedMessage id="knowledge.action.restore" defaultMessage="Restore" />
                    </DropdownMenuItem>
                  ) : (
                    <>
                      {saved.state === "draft" ? (
                        <DropdownMenuItem onSelect={() => void runAction("publish")}>
                          <Send size={16} aria-hidden="true" />
                          <FormattedMessage
                            id="knowledge.action.publish"
                            defaultMessage="Publish"
                          />
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={requestUnpublish}>
                          <Undo2 size={16} aria-hidden="true" />
                          <FormattedMessage
                            id="knowledge.action.unpublish"
                            defaultMessage="Unpublish"
                          />
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
                        <Archive size={16} aria-hidden="true" />
                        <FormattedMessage id="knowledge.action.archive" defaultMessage="Archive" />
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </section>
        }
      >
        <PageTitle title={saved.title} />
        <RecordApplets
          applets={[history]}
          layer={
            open ? (
              <DocPanel
                documentId={open.document.id}
                title={open.document.title}
                version={open.version}
                initialFind={loaded.documentFindQuery}
                onClose={() => setReading(null)}
              />
            ) : undefined
          }
        >
          <div className="flex flex-col gap-4 overflow-y-auto px-page-x py-page-y">
            <section
              aria-labelledby="knowledge-identity-heading"
              className="overflow-hidden rounded-card border border-border-default bg-raised"
            >
              <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
                <h2 id="knowledge-identity-heading" className="text-base font-semibold">
                  <FormattedMessage
                    id="knowledge.record.identity"
                    defaultMessage="Knowledge item"
                  />
                </h2>
              </header>
              <div className="grid grid-cols-1 gap-4 p-4 @2xl/page:grid-cols-2">
                <div className="flex flex-col gap-1.5 @2xl/page:col-span-2">
                  <Label htmlFor="knowledge-record-title">
                    <FormattedMessage id="knowledge.form.title" defaultMessage="Title" />
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="knowledge-record-title"
                      value={title}
                      disabled={saved.archivedAt !== null}
                      onChange={(event) => setTitle(event.target.value)}
                      onBlur={() => commits.commitText("title", titleField)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commits.commitText("title", titleField);
                        if (event.key === "Escape") commits.revertText("title", titleField);
                      }}
                    />
                    <StatusNote
                      status={commits.status.title ?? "idle"}
                      detail={commits.error.title}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="knowledge-record-type">
                      <FormattedMessage id="knowledge.form.type" defaultMessage="Type" />
                    </Label>
                    {loaded.user.role === "administrator" ? (
                      <Link
                        to="/settings/knowledge/types"
                        className="text-sm text-link hover:underline"
                      >
                        <FormattedMessage
                          id="knowledge.type.manage"
                          defaultMessage="Manage types…"
                        />
                      </Link>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      id="knowledge-record-type"
                      className={CONTROL_CLASS}
                      value={saved.knowledgeTypeId}
                      disabled={saved.archivedAt !== null}
                      onChange={(event) =>
                        void commit("type", { knowledgeTypeId: event.target.value })
                      }
                    >
                      {loaded.types.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.displayName}
                        </option>
                      ))}
                    </select>
                    <StatusNote
                      status={commits.status.type ?? "idle"}
                      detail={commits.error.type}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="knowledge-record-folder">
                    <FormattedMessage id="knowledge.form.folder" defaultMessage="Folder" />
                  </Label>
                  <div className="flex items-center gap-2">
                    <select
                      id="knowledge-record-folder"
                      className={CONTROL_CLASS}
                      value={saved.folderId ?? ""}
                      disabled={saved.archivedAt !== null}
                      onChange={(event) =>
                        void commit("folder", { folderId: event.target.value || null })
                      }
                    >
                      <option value="">
                        <FormattedMessage id="knowledge.folder.root" defaultMessage="Library" />
                      </option>
                      {loaded.folders.map((row) => (
                        <option key={row.id} value={row.id}>
                          {folderLabel(loaded.folders, row.id)}
                        </option>
                      ))}
                    </select>
                    <StatusNote
                      status={commits.status.folder ?? "idle"}
                      detail={commits.error.folder}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="knowledge-record-audience">
                    <FormattedMessage id="knowledge.form.audience" defaultMessage="Audience" />
                  </Label>
                  <div className="flex items-center gap-2">
                    <select
                      id="knowledge-record-audience"
                      className={CONTROL_CLASS}
                      value={saved.audience}
                      disabled={saved.archivedAt !== null}
                      onChange={(event) =>
                        requestAudience(event.target.value as "legal_only" | "everyone")
                      }
                    >
                      <option value="legal_only">
                        {intl.formatMessage({
                          id: "knowledge.audience.legalOnly",
                          defaultMessage: "Legal Only",
                        })}
                      </option>
                      <option value="everyone">
                        {intl.formatMessage({
                          id: "knowledge.audience.everyone",
                          defaultMessage: "Everyone",
                        })}
                      </option>
                    </select>
                    <StatusNote
                      status={commits.status.audience ?? "idle"}
                      detail={commits.error.audience}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 @2xl/page:col-span-2">
                  <Label>
                    <FormattedMessage
                      id="knowledge.record.primaryDocument"
                      defaultMessage="Primary document"
                    />
                  </Label>
                  {saved.primaryDocument ? (
                    <button
                      type="button"
                      aria-label={intl.formatMessage({
                        id: "knowledge.action.openPreview",
                        defaultMessage: "Open preview",
                      })}
                      className="flex items-center justify-between rounded-button border border-border-default px-3 py-2 text-start hover:bg-hover"
                      onClick={() =>
                        setReading({
                          documentId: saved.primaryDocument!.id,
                          versionId: saved.primaryDocument!.currentVersion.id,
                        })
                      }
                    >
                      <span>{saved.primaryDocument.title}</span>
                      <span className="text-sm text-link">
                        <FormattedMessage
                          id="knowledge.action.openPreview"
                          defaultMessage="Open preview"
                        />
                      </span>
                    </button>
                  ) : (
                    <span className="text-muted">
                      <FormattedMessage id="knowledge.record.noPrimary" defaultMessage="None" />
                    </span>
                  )}
                </div>
              </div>
            </section>
            <DocumentsCard
              documents={paper}
              folders={[]}
              nextCursor={paperCursor}
              supportingUploads={false}
              reading={reading?.versionId ?? null}
              amending={null}
              onAmendmentOpened={() => undefined}
              onRead={(document, version) =>
                setReading({ documentId: document.id, versionId: version.id })
              }
              onDocuments={(documents, cursor) => {
                setPaper(documents);
                if (cursor !== undefined) setPaperCursor(cursor);
                // The card's listing is the newer truth for the identity
                // row: a designation moved, or the primary was erased.
                const primary = documents.find((document) => document.isPrimary);
                const current = primary?.versions.find((version) => version.isCurrent);
                setSaved((item) => ({
                  ...item,
                  primaryDocument:
                    primary && current
                      ? {
                          id: primary.id,
                          title: primary.title,
                          currentVersion: {
                            id: current.id,
                            originalFilename: current.originalFilename,
                            mimeType: current.mimeType,
                            renderFamily: current.renderFamily,
                          },
                        }
                      : null,
                  documentCount: documents.filter((document) => document.archivedAt === null)
                    .length,
                }));
              }}
              onFiled={setFiled}
              onFolders={() => undefined}
            />
            <section
              aria-labelledby="knowledge-guidance-heading"
              className="overflow-hidden rounded-card border border-border-default bg-raised"
            >
              <header className="flex min-h-section-header items-center justify-between gap-3 border-b border-border-default bg-section-header px-4">
                <h2 id="knowledge-guidance-heading" className="text-base font-semibold">
                  <FormattedMessage id="knowledge.record.guidance" defaultMessage="Guidance" />
                </h2>
                {editingBody ? (
                  <div className="flex items-center gap-2">
                    <StatusNote
                      status={commits.status.body ?? "idle"}
                      detail={commits.error.body}
                    />
                    {/* The textarea's blur has already committed the draft by
                      the time this click lands, so the toggle only flips. */}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={saved.archivedAt !== null}
                      aria-pressed={preview}
                      onClick={() => setPreview((value) => !value)}
                    >
                      {preview ? (
                        <>
                          <Pencil size={16} />
                          <FormattedMessage id="knowledge.body.edit" defaultMessage="Edit" />
                        </>
                      ) : (
                        <>
                          <Eye size={16} />
                          <FormattedMessage id="knowledge.body.preview" defaultMessage="Preview" />
                        </>
                      )}
                    </Button>
                  </div>
                ) : null}
              </header>
              <div className="min-h-48 p-4">
                {!editingBody ? (
                  <div className="flex min-h-40 items-center justify-center">
                    <Button
                      variant="secondary"
                      onClick={showEditor}
                      disabled={saved.archivedAt !== null}
                    >
                      <Pencil size={16} />
                      <FormattedMessage id="knowledge.body.add" defaultMessage="Add guidance" />
                    </Button>
                  </div>
                ) : preview ? (
                  <KnowledgeMarkdown source={body} />
                ) : (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="knowledge-body" className="sr-only">
                      <FormattedMessage
                        id="knowledge.body.markdown"
                        defaultMessage="Guidance in Markdown"
                      />
                    </Label>
                    <textarea
                      ref={textarea}
                      id="knowledge-body"
                      className={`${TEXTAREA_CLASS} min-h-64 font-mono`}
                      value={body}
                      disabled={saved.archivedAt !== null}
                      placeholder={intl.formatMessage({
                        id: "knowledge.body.placeholder",
                        defaultMessage: "Write guidance in Markdown…",
                      })}
                      onChange={(event) => setBody(event.target.value)}
                      onBlur={commitBody}
                    />
                    <p className="text-xs text-muted">
                      <FormattedMessage
                        id="knowledge.body.help"
                        defaultMessage="Markdown headings, lists, emphasis, code, and links are supported."
                      />
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </RecordApplets>
      </AppShell>
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent aria-describedby="knowledge-archive-help">
          <DialogTitle>
            <FormattedMessage
              id="knowledge.archive.title"
              defaultMessage="Archive Knowledge Item"
            />
          </DialogTitle>
          <div className="mt-4 flex flex-col gap-4">
            <p id="knowledge-archive-help" className="text-sm text-muted">
              <FormattedMessage
                id="knowledge.archive.help"
                defaultMessage="Optionally point readers to the Knowledge Item that replaces this one."
              />
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="knowledge-replacement">
                <FormattedMessage id="knowledge.archive.replacedBy" defaultMessage="Replaced by" />
              </Label>
              <select
                id="knowledge-replacement"
                className={CONTROL_CLASS}
                value={replacementId}
                onChange={(event) => setReplacementId(event.target.value)}
              >
                <option value="">
                  {intl.formatMessage({
                    id: "knowledge.archive.none",
                    defaultMessage: "No replacement",
                  })}
                </option>
                {loaded.replacementItems.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setArchiveOpen(false)}>
                <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
              </Button>
              <Button onClick={() => void runAction("archive")} disabled={actionBusy}>
                <FormattedMessage id="knowledge.action.archive" defaultMessage="Archive" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={reachWarning !== null} onOpenChange={(open) => !open && setReachWarning(null)}>
        <DialogContent aria-describedby="knowledge-reach-warning">
          <DialogTitle>
            <FormattedMessage
              id="knowledge.reach.title"
              defaultMessage="Remove this from the portal?"
            />
          </DialogTitle>
          <p id="knowledge-reach-warning" className="mt-4 text-sm text-muted">
            <FormattedMessage
              id="knowledge.reach.warning"
              defaultMessage="{count, plural, one {# deflection link points} other {# deflection links point}} at this item. The {count, plural, one {link} other {links}} will stay in Settings but disappear from the portal."
              values={{ count: saved.deflectionLinkCount }}
            />
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReachWarning(null)}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button onClick={confirmLostReach} disabled={actionBusy}>
              <FormattedMessage id="action.continue" defaultMessage="Continue" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </RecordContext.Provider>
  );
}
