// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, FileText, Search, Upload, X } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { Avatar } from "../avatar";
import { AutoResizeTextarea } from "../auto-resize-textarea";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { dragCarriesFiles } from "../../lib/batch-upload";
import { formatFileSize, formatShortDate } from "../../lib/format";
import {
  documentDownloadHref,
  documentKindLabel,
  DOCUMENT_KIND_PILL,
  DOCUMENT_VERSION_KINDS,
  uploadDocumentVersion,
  uploadRecordDocument,
  type HandSetDocumentVersionKind,
} from "../../lib/documents";
import { portalContractReader } from "../../lib/portal-contracts";
import {
  readPortalDocuments,
  type PortalDocument,
  type PortalDocuments,
  type PortalDocumentVersion,
  type PortalRecordModule,
} from "../../lib/portal-records";
import { usePortalDocumentPanel } from "./record-shell";

export function PortalDocumentsSection({
  module,
  number,
  initial,
}: Readonly<{
  module: PortalRecordModule;
  number: number;
  initial: PortalDocuments;
}>) {
  const intl = useIntl();
  const [data, setData] = useState(initial);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [composer, setComposer] = useState<{ files: File[]; target?: PortalDocument } | null>(null);
  const generation = useRef(0);
  const dragDepth = useRef(0);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const openDocument = usePortalDocumentPanel();
  async function load(q: string, cursor?: string) {
    const attempt = ++generation.current;
    setBusy(true);
    setFailed(false);
    const result = await readPortalDocuments(module, number, cursor, q).catch(() => undefined);
    if (attempt !== generation.current) return;
    setBusy(false);
    if (!result?.data) {
      // A failed first page shows the empty list; a failed later page keeps
      // what is already on screen.
      if (!cursor) setData({ documents: [], nextCursor: null });
      setFailed(true);
      return;
    }
    setAppliedQuery(q);
    setData((previous) =>
      cursor
        ? { ...result.data, documents: [...previous.documents, ...result.data.documents] }
        : result.data,
    );
  }
  function compose(files: File[], target?: PortalDocument, control?: HTMLElement) {
    trigger.current = control ?? uploadButton.current;
    setNotice(0);
    setComposer({ files, target });
  }
  return (
    <section
      aria-labelledby="portal-documents-heading"
      className={`flex min-w-0 flex-col overflow-hidden rounded-card border bg-raised ${dragging ? "border-link ring-2 ring-link" : "border-border-default"}`}
      onDragEnter={(event) => {
        if (!dragCarriesFiles(event.dataTransfer) || composer) return;
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (dragCarriesFiles(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = composer ? "none" : "copy";
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (!dragCarriesFiles(event.dataTransfer)) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (!composer) compose(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <h2 id="portal-documents-heading" className="text-lg font-semibold">
          <FormattedMessage id="portal.record.documents" defaultMessage="Documents" />
        </h2>
        <Button ref={uploadButton} onClick={(event) => compose([], undefined, event.currentTarget)}>
          <Upload size={16} aria-hidden="true" />
          <FormattedMessage id="portal.documents.upload" defaultMessage="Upload documents" />
        </Button>
      </div>
      <div className="flex flex-col gap-3 px-5 pb-4">
        <button
          type="button"
          className="flex min-h-20 items-center justify-center gap-3 rounded-button border border-dashed border-border-default px-4 py-3 text-base text-muted hover:bg-control focus-visible:outline-2 focus-visible:outline-link"
          onClick={(event) => compose([], undefined, event.currentTarget)}
        >
          <Upload className="shrink-0" size={20} aria-hidden="true" />
          <span>
            <FormattedMessage
              id="portal.documents.drop"
              defaultMessage="Drop files here or click to upload"
            />
          </span>
        </button>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void load(query.trim());
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted"
              size={16}
              aria-hidden="true"
            />
            <Input
              className="ps-9"
              value={query}
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={intl.formatMessage({
                id: "portal.documents.search",
                defaultMessage: "Search Documents",
              })}
              placeholder={intl.formatMessage({
                id: "portal.documents.searchPlaceholder",
                defaultMessage: "Search by document name or filename",
              })}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={busy}>
            <FormattedMessage id="common.search" defaultMessage="Search" />
          </Button>
          {appliedQuery && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setQuery("");
                void load("");
              }}
            >
              <FormattedMessage id="common.clear" defaultMessage="Clear" />
            </Button>
          )}
        </form>
        {notice > 0 && (
          <p role="status" className="text-sm text-muted">
            <FormattedMessage
              id="portal.documents.uploaded"
              defaultMessage="{count, plural, one {# file uploaded.} other {# files uploaded.}}"
              values={{ count: notice }}
            />
          </p>
        )}
        {failed && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-status-danger-fg">
              <FormattedMessage
                id="portal.documents.readFailed"
                defaultMessage="The Documents could not be read."
              />
            </p>
            <Button type="button" variant="secondary" onClick={() => void load(query.trim())}>
              <FormattedMessage id="common.retry" defaultMessage="Try again" />
            </Button>
          </div>
        )}
      </div>
      <div aria-busy={busy}>
        {data.documents.length === 0 && !failed && (
          <p className="px-5 pb-5 text-base text-muted">
            {appliedQuery ? (
              <FormattedMessage
                id="portal.documents.noResults"
                defaultMessage="No Documents match your search."
              />
            ) : (
              <FormattedMessage id="portal.documents.empty" defaultMessage="No Documents yet." />
            )}
          </p>
        )}
        <ul className="divide-y divide-border-default border-t border-border-default">
          {data.documents.map((document) => (
            <DocumentRow
              key={document.id}
              document={document}
              download={(version) =>
                module === "contract" && document.isPrimary
                  ? portalContractReader(number).documentDownloadHref(document.id, version.id)
                  : documentDownloadHref(document.id, version.id)
              }
              onRead={(version, control) => openDocument(document, version, control)}
              onAdd={(control) => compose([], document, control)}
            />
          ))}
        </ul>
      </div>
      {data.nextCursor && (
        <div className="flex justify-center border-t border-border-default p-3">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void load(appliedQuery, data.nextCursor!)}
          >
            <FormattedMessage id="common.showMore" defaultMessage="Show more" />
          </Button>
        </div>
      )}
      {composer && (
        <UploadDocuments
          module={module}
          number={number}
          files={composer.files}
          target={composer.target}
          documents={data.documents}
          onUploaded={(count) => {
            setNotice(count);
            setQuery("");
            void load("");
          }}
          onClose={() => setComposer(null)}
          onRestoreFocus={() => {
            if (trigger.current?.isConnected) trigger.current.focus();
            else uploadButton.current?.focus();
          }}
        />
      )}
    </section>
  );
}

function DocumentRow({
  document,
  download,
  onRead,
  onAdd,
}: Readonly<{
  document: PortalDocument;
  download: (version: PortalDocumentVersion) => string;
  onRead: (version: PortalDocumentVersion, control: HTMLElement) => void;
  onAdd: (control: HTMLElement) => void;
}>) {
  const intl = useIntl();
  const [expanded, setExpanded] = useState(false);
  const current = document.versions.find((version) => version.isCurrent);
  if (!current) return null;
  const previous = document.versions.filter((version) => !version.isCurrent);
  return (
    <li className={document.isPrimary ? "bg-control/30" : undefined}>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <FileText className="mt-1 shrink-0 text-muted" size={24} aria-hidden="true" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {document.isPrimary && (
                <span className="text-xs font-semibold text-muted">
                  <FormattedMessage
                    id="portal.documents.primary"
                    defaultMessage="Primary Document"
                  />
                </span>
              )}
              <button
                className="break-words text-start text-base font-semibold text-link hover:underline"
                onClick={(event) => onRead(current, event.currentTarget)}
              >
                {document.title}
              </button>
              <VersionSummary version={current} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={(event) => onAdd(event.currentTarget)}
            >
              <Upload size={14} aria-hidden="true" />
              <FormattedMessage id="documents.action.addVersion" defaultMessage="Add version" />
            </Button>
            <Button type="button" variant="ghost" size="icon" asChild>
              <a
                href={download(current)}
                aria-label={intl.formatMessage(
                  {
                    id: "portal.documents.download",
                    defaultMessage: "Download {name}, version {version}",
                  },
                  { name: document.title, version: current.versionNumber },
                )}
              >
                <Download size={16} aria-hidden="true" />
              </a>
            </Button>
          </div>
        </div>
        {previous.length > 0 && (
          <button
            className="flex w-fit items-center gap-1 text-sm text-link hover:underline"
            aria-expanded={expanded}
            aria-controls={`portal-versions-${document.id}`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronDown size={14} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
            <FormattedMessage
              id="portal.documents.earlierVersions"
              defaultMessage="{count, plural, one {# earlier version} other {# earlier versions}}"
              values={{ count: previous.length }}
            />
          </button>
        )}
        {expanded && previous.length > 0 && (
          <ol
            id={`portal-versions-${document.id}`}
            className="flex flex-col gap-4 border-s-2 border-border-default ps-4"
          >
            {previous.map((version) => (
              <li key={version.id} className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <button
                    className="break-words text-start text-base text-link hover:underline"
                    onClick={(event) => onRead(version, event.currentTarget)}
                  >
                    {version.originalFilename}
                  </button>
                  <VersionSummary version={version} />
                </div>
                <Button type="button" variant="ghost" size="icon" asChild>
                  <a
                    href={download(version)}
                    aria-label={intl.formatMessage(
                      {
                        id: "portal.documents.download",
                        defaultMessage: "Download {name}, version {version}",
                      },
                      { name: document.title, version: version.versionNumber },
                    )}
                  >
                    <Download size={16} aria-hidden="true" />
                  </a>
                </Button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

function VersionSummary({ version }: Readonly<{ version: PortalDocumentVersion }>) {
  const intl = useIntl();
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span>
          <FormattedMessage
            id="portal.documents.version"
            defaultMessage="Version {number}"
            values={{ number: version.versionNumber }}
          />
        </span>
        <span className={`rounded-pill px-2 py-0.5 ${DOCUMENT_KIND_PILL[version.kind]}`}>
          {documentKindLabel(intl, version.kind)}
        </span>
        {version.isCurrent && (
          <span>
            <FormattedMessage id="documents.current" defaultMessage="Current" />
          </span>
        )}
        {version.isExecuted && (
          <span>
            <FormattedMessage id="portal.documents.signedCopy" defaultMessage="Signed copy" />
          </span>
        )}
        <span>{formatFileSize(version.byteSize)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <Avatar
          name={version.uploadedBy.displayName}
          image={version.uploadedBy.image}
          className="size-5"
        />
        <span>{version.uploadedBy.displayName}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={version.createdAt}>{formatShortDate(version.createdAt)}</time>
      </div>
      {version.note && (
        <p className="whitespace-pre-wrap break-words text-sm text-muted">{version.note}</p>
      )}
    </>
  );
}

function UploadDocuments({
  module,
  number,
  files: initialFiles,
  target,
  documents,
  onUploaded,
  onClose,
  onRestoreFocus,
}: Readonly<{
  module: PortalRecordModule;
  number: number;
  files: File[];
  target?: PortalDocument;
  documents: PortalDocument[];
  onUploaded: (count: number) => void;
  onClose: () => void;
  onRestoreFocus: () => void;
}>) {
  const intl = useIntl();
  const [files, setFiles] = useState(initialFiles);
  const [destination, setDestination] = useState(target?.id ?? "");
  const [kind, setKind] = useState<HandSetDocumentVersionKind>("general");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState<Set<File>>(new Set());
  const [failures, setFailures] = useState<Map<File, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  async function submit() {
    if (submitting.current) return;
    if (!files.length || (destination && files.length !== 1)) {
      setError(
        intl.formatMessage(
          destination
            ? {
                id: "portal.documents.oneVersionFile",
                defaultMessage: "Choose one file for a new version.",
              }
            : { id: "documents.fileMissing", defaultMessage: "Choose a file to upload." },
        ),
      );
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    const done = new Set(completed);
    const failed = new Map<File, string>();
    for (const file of files) {
      if (done.has(file)) continue;
      const draft = { file, kind, note, surface: "portal" as const };
      const result = await (destination
        ? uploadDocumentVersion(destination, draft)
        : uploadRecordDocument({ entityType: module, number }, draft));
      if (result.ok) done.add(file);
      else
        failed.set(
          file,
          result.detail ??
            intl.formatMessage({
              id: "documents.uploadError",
              defaultMessage: "That file could not be uploaded. Try again.",
            }),
        );
      setCompleted(new Set(done));
      setFailures(new Map(failed));
    }
    submitting.current = false;
    setBusy(false);
    if (done.size) onUploaded(done.size);
    if (failed.size === 0) onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting.current) onClose();
      }}
    >
      <DialogContent
        width="xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogTitle>
          <FormattedMessage id="portal.documents.upload" defaultMessage="Upload documents" />
        </DialogTitle>
        <form
          className="mt-5 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="portal-upload-destination">
              <FormattedMessage id="portal.documents.uploadAs" defaultMessage="Add as" />
            </Label>
            <select
              id="portal-upload-destination"
              className={CONTROL_CLASS}
              disabled={busy || completed.size > 0}
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            >
              <option value="">
                <FormattedMessage
                  id="portal.documents.newDocuments"
                  defaultMessage="New documents"
                />
              </option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {intl.formatMessage(
                    { id: "portal.documents.versionOf", defaultMessage: "New version of {name}" },
                    { name: document.title },
                  )}
                </option>
              ))}
            </select>
          </div>
          <input
            ref={input}
            type="file"
            multiple={!destination}
            className="sr-only"
            tabIndex={-1}
            disabled={busy || completed.size > 0}
            aria-label={intl.formatMessage({
              id: "portal.documents.files",
              defaultMessage: "Files to upload",
            })}
            onChange={(event) => {
              setFiles(Array.from(event.target.files ?? []));
              setFailures(new Map());
              setError(null);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy || completed.size > 0}
            className="flex min-h-24 items-center justify-center gap-2 rounded-button border border-dashed border-border-default p-4 text-base text-link hover:bg-control disabled:opacity-50"
            onClick={() => input.current?.click()}
            onDragOver={(event) => {
              if (dragCarriesFiles(event.dataTransfer)) {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = busy || completed.size > 0 ? "none" : "copy";
              }
            }}
            onDrop={(event) => {
              if (!dragCarriesFiles(event.dataTransfer)) return;
              event.preventDefault();
              event.stopPropagation();
              if (!busy && completed.size === 0) {
                setFiles(Array.from(event.dataTransfer.files));
                setError(null);
                setFailures(new Map());
              }
            }}
          >
            <Upload size={20} aria-hidden="true" />
            <FormattedMessage
              id="portal.documents.chooseFiles"
              defaultMessage="Drop files or choose files"
            />
          </button>
          {files.length > 0 && (
            <ul className="flex max-h-60 flex-col gap-3 overflow-y-auto">
              {files.map((file, index) => (
                <li key={index} className="flex items-start justify-between gap-2 text-sm">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="break-words font-medium">{file.name}</span>
                    <span className="text-muted">{formatFileSize(file.size)}</span>
                    {completed.has(file) && (
                      <span role="status">
                        <FormattedMessage
                          id="portal.documents.fileUploaded"
                          defaultMessage="Uploaded"
                        />
                      </span>
                    )}
                    {failures.has(file) && (
                      <span role="alert" className="text-status-danger-fg">
                        {failures.get(file)}
                      </span>
                    )}
                  </div>
                  {!completed.has(file) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label={intl.formatMessage(
                        { id: "portal.documents.removeFile", defaultMessage: "Remove {name}" },
                        { name: file.name },
                      )}
                      onClick={() => setFiles((previous) => previous.filter((_, i) => i !== index))}
                    >
                      <X size={16} aria-hidden="true" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="portal-upload-kind">
              <FormattedMessage id="documents.kindLabel" defaultMessage="Kind" />
            </Label>
            <select
              id="portal-upload-kind"
              className={CONTROL_CLASS}
              value={kind}
              disabled={busy || completed.size > 0}
              onChange={(event) => setKind(event.target.value as HandSetDocumentVersionKind)}
            >
              {["general" as const, ...DOCUMENT_VERSION_KINDS].map((kind) => (
                <option key={kind} value={kind}>
                  {documentKindLabel(intl, kind)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="portal-upload-note">
              <FormattedMessage id="portal.documents.note" defaultMessage="Note (optional)" />
            </Label>
            <AutoResizeTextarea
              id="portal-upload-note"
              value={note}
              disabled={busy || completed.size > 0}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <FormattedMessage id="portal.documents.uploading" defaultMessage="Uploading…" />
              ) : failures.size ? (
                <FormattedMessage
                  id="portal.documents.retryFiles"
                  defaultMessage="Retry failed uploads"
                />
              ) : (
                <FormattedMessage id="portal.documents.uploadAction" defaultMessage="Upload" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
