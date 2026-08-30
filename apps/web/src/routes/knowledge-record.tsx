// SPDX-License-Identifier: AGPL-3.0-only

/** M28's one-section Knowledge record with DES-017 field commits. */
import { useRef, useState } from "react";
import { BookOpen, ChevronRight, Eye, Pencil } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { useFieldCommit, type TextField } from "../lib/field-commit";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../lib/form-controls";
import { folderLabel, type KnowledgeItem } from "../lib/knowledge";
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

type PatchBody =
  paths["/api/v1/knowledge/{id}"]["patch"]["requestBody"]["content"]["application/json"];

export async function knowledgeRecordLoader({ params }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (!isMemberPlus(user.role)) return redirect("/");
  const id = params.id!;
  const [item, types, folders] = await Promise.all([
    api.GET("/api/v1/knowledge/{id}", { params: { path: { id } } }),
    api.GET("/api/v1/knowledge/type-options"),
    api.GET("/api/v1/knowledge/folders"),
  ]);
  if (!item.data || !types.data || !folders.data)
    throw new Error("The Knowledge item could not be read.");
  return {
    user,
    item: item.data.knowledgeItem,
    types: types.data.knowledgeTypes,
    folders: folders.data.folders,
  };
}

type FieldKey = "title" | "type" | "folder" | "body";

export function KnowledgeRecordPage() {
  const loaded = useLoaderData<typeof knowledgeRecordLoader>();
  const intl = useIntl();
  const signOut = useSignOut("/auth/login");
  const [saved, setSaved] = useState<KnowledgeItem>(loaded.item);
  const [title, setTitle] = useState(saved.title);
  const [body, setBody] = useState(saved.body ?? "");
  const [editingBody, setEditingBody] = useState(Boolean(saved.body));
  const [preview, setPreview] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const commits = useFieldCommit<FieldKey>();
  const history = useActivityApplet({ entityType: "knowledge_item", entityId: saved.id });

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

  return (
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
        </section>
      }
    >
      <PageTitle title={saved.title} />
      <RecordApplets applets={[history]}>
        <div className="flex flex-col gap-4 overflow-y-auto px-page-x py-page-y">
          <section
            aria-labelledby="knowledge-identity-heading"
            className="overflow-hidden rounded-card border border-border-default bg-raised"
          >
            <header className="flex h-section-header items-center border-b border-border-default bg-section-header px-4">
              <h2 id="knowledge-identity-heading" className="text-base font-semibold">
                <FormattedMessage id="knowledge.record.identity" defaultMessage="Knowledge item" />
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
                      <FormattedMessage id="knowledge.type.manage" defaultMessage="Manage types…" />
                    </Link>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    id="knowledge-record-type"
                    className={CONTROL_CLASS}
                    value={saved.knowledgeTypeId}
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
                  <StatusNote status={commits.status.type ?? "idle"} detail={commits.error.type} />
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
            </div>
          </section>
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
                  <StatusNote status={commits.status.body ?? "idle"} detail={commits.error.body} />
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-pressed={preview}
                    onClick={() => {
                      if (!preview) commitBody();
                      setPreview((value) => !value);
                    }}
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
                  <Button variant="secondary" onClick={showEditor}>
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
  );
}
