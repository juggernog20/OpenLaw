// SPDX-License-Identifier: AGPL-3.0-only

/** CMT-011's chosen-file chips and live thread attachment rows. */

import { useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { FileCheck2, Paperclip, X } from "lucide-react";
import { fileCommentAttachment, type Comment, type CommentEntityType } from "../../lib/comments";
import { DOCUMENT_VERSION_KINDS, type HandSetDocumentVersionKind } from "../../lib/documents";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import { problemDetail } from "../../lib/messages";
import { ConfidentialToggle } from "../confidential-toggle";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export const MAX_COMMENT_ATTACHMENTS = 5;

/** The record-owned part of filing, supplied only where Documents exist. */
export interface CommentFilingContext {
  documents: readonly { id: string; title: string }[];
  /** Reads every reachable chain, including ones in unopened folders. */
  loadDocuments: () => Promise<readonly { id: string; title: string }[]>;
  recordHref: string;
  canFile: boolean;
  /** Opens the exact round in place, or false to let the link navigate. */
  onOpen: (documentId: string, versionId: string, trigger: HTMLElement) => boolean;
  onPaperFiled: () => Promise<void>;
}

export function CommentFilePicker({
  files,
  disabled,
  onChange,
}: Readonly<{
  files: readonly File[];
  disabled: boolean;
  onChange: (files: File[]) => void;
}>) {
  const intl = useIntl();
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col items-start gap-1.5">
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        aria-label={intl.formatMessage({
          id: "comments.attachments.choose",
          defaultMessage: "Choose files for this comment",
        })}
        disabled={disabled || files.length >= MAX_COMMENT_ATTACHMENTS}
        onChange={(event) => {
          const chosen = Array.from(event.currentTarget.files ?? []);
          onChange([...files, ...chosen].slice(0, MAX_COMMENT_ATTACHMENTS));
          event.currentTarget.value = "";
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || files.length >= MAX_COMMENT_ATTACHMENTS}
          onClick={() => input.current?.click()}
        >
          <Paperclip size={16} aria-hidden="true" />
          <FormattedMessage id="comments.attachments.add" defaultMessage="Attach files" />
        </Button>
        <span className="text-xs text-muted">
          <FormattedMessage
            id="comments.attachments.bound"
            defaultMessage="Up to {count} files."
            values={{ count: MAX_COMMENT_ATTACHMENTS }}
          />
        </span>
      </div>
      {files.length > 0 && (
        <ul
          aria-label={intl.formatMessage({
            id: "comments.attachments.chosen",
            defaultMessage: "Files attached to this comment",
          })}
          className="flex flex-wrap gap-1"
        >
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
              <span className="inline-flex items-center gap-1 rounded-chip bg-badge-count-bg py-px ps-2 pe-px text-xs font-medium text-badge-count-fg">
                <span className="max-w-52 truncate">{file.name}</span>
                <button
                  type="button"
                  className="inline-flex size-6 items-center justify-center rounded-chip text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
                  aria-label={intl.formatMessage(
                    {
                      id: "comments.attachments.remove",
                      defaultMessage: "Remove {filename}",
                    },
                    { filename: file.name },
                  )}
                  disabled={disabled}
                  onClick={() => onChange(files.filter((_file, at) => at !== index))}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CommentAttachmentRows({
  comment,
  entityType,
  entityId,
  filing,
  onChanged,
}: Readonly<{
  comment: Comment;
  entityType: CommentEntityType;
  entityId: string;
  filing?: CommentFilingContext;
  onChanged?: (comment: Comment) => void;
}>) {
  const intl = useIntl();
  const [filingAttachment, setFilingAttachment] = useState<
    NonNullable<Comment["attachments"]>[number] | null
  >(null);
  if (!comment.attachments?.length) return null;
  return (
    <ul
      aria-label={intl.formatMessage({
        id: "comments.attachments.list",
        defaultMessage: "Comment attachments",
      })}
      className="mt-1 flex flex-col gap-1"
    >
      {comment.attachments.map((attachment) => (
        <li key={attachment.id} className="flex min-w-0 flex-col gap-0.5 text-sm">
          <span className="flex min-w-0 items-center gap-1.5">
            <Paperclip size={14} className="shrink-0 text-muted" aria-hidden="true" />
            <a
              className="truncate text-link underline-offset-2 hover:underline"
              href={commentAttachmentHref(comment.id, attachment.id, entityType, entityId)}
              download={attachment.filename}
            >
              {attachment.filename}
            </a>
            {filing?.canFile && onChanged && !attachment.filed && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ms-auto shrink-0"
                onClick={() => setFilingAttachment(attachment)}
              >
                <FormattedMessage id="comments.attachments.file" defaultMessage="File" />
              </Button>
            )}
          </span>
          {attachment.filed && filing && (
            <span className="ms-5 flex min-w-0 items-center gap-1 text-xs text-muted">
              <FileCheck2 size={16} className="shrink-0" aria-hidden="true" />
              <FormattedMessage
                id="comments.attachments.filedTo"
                defaultMessage="Filed to {destination}"
                values={{
                  destination: (
                    <a
                      className="truncate text-link underline-offset-2 hover:underline"
                      href={filing.recordHref}
                      onClick={(event) => {
                        const opened = filing.onOpen(
                          attachment.filed!.documentId,
                          attachment.filed!.versionId,
                          event.currentTarget,
                        );
                        if (opened) event.preventDefault();
                      }}
                    >
                      <FormattedMessage
                        id="comments.attachments.destination"
                        defaultMessage="{title}, version {number}"
                        values={{
                          title: attachment.filed.documentTitle,
                          number: attachment.filed.versionNumber,
                        }}
                      />
                    </a>
                  ),
                }}
              />
            </span>
          )}
        </li>
      ))}
      {filingAttachment && filing && onChanged && (
        <FilingDialog
          comment={comment}
          attachment={filingAttachment}
          entityType={entityType}
          entityId={entityId}
          filing={filing}
          onClose={() => setFilingAttachment(null)}
          onChanged={onChanged}
        />
      )}
    </ul>
  );
}

function FilingDialog({
  comment,
  attachment,
  entityType,
  entityId,
  filing,
  onClose,
  onChanged,
}: Readonly<{
  comment: Comment;
  attachment: NonNullable<Comment["attachments"]>[number];
  entityType: CommentEntityType;
  entityId: string;
  filing: CommentFilingContext;
  onClose: () => void;
  onChanged: (comment: Comment) => void;
}>) {
  const intl = useIntl();
  const [destination, setDestination] = useState<"new_document" | "new_version">("new_document");
  const [documents, setDocuments] = useState(filing.documents);
  const [name, setName] = useState(attachment.filename);
  const [documentId, setDocumentId] = useState(filing.documents[0]?.id ?? "");
  const [kind, setKind] = useState<HandSetDocumentVersionKind>("draft_ours");
  const [note, setNote] = useState("");
  // CMT-011: the room proposes the flag; it never mandates it.
  const [isConfidential, setConfidential] = useState(comment.visibility === "legal_only");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { loadDocuments } = filing;

  useEffect(() => {
    let live = true;
    void loadDocuments()
      .then((rows) => {
        if (!live) return;
        setDocuments(rows);
        setDocumentId((current) => current || rows[0]?.id || "");
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [loadDocuments]);

  async function submit() {
    if (busy) return;
    if (destination === "new_version" && !documentId) {
      setError(
        intl.formatMessage({
          id: "comments.filing.documentRequired",
          defaultMessage: "Choose the Document this round belongs to.",
        }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await fileCommentAttachment(
      entityType,
      entityId,
      comment.id,
      attachment.id,
      destination === "new_document"
        ? { destination, kind, name, isConfidential }
        : { destination, documentId, kind, ...(note.trim() ? { note } : {}) },
    ).catch(() => ({ data: undefined, error: undefined }));
    if (!outcome.data) {
      setBusy(false);
      setError(
        problemDetail(outcome.error) ??
          intl.formatMessage({
            id: "comments.filing.error",
            defaultMessage: "That attachment could not be filed. Try again.",
          }),
      );
      return;
    }
    onChanged(outcome.data.comment);
    await filing.onPaperFiled().catch(() => undefined);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="comments.filing.title" defaultMessage="File attachment" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="truncate text-sm text-muted">{attachment.filename}</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="comment-filing-destination">
              <FormattedMessage id="comments.filing.destination" defaultMessage="Destination" />
            </Label>
            <select
              id="comment-filing-destination"
              className={CONTROL_CLASS}
              value={destination}
              onChange={(event) =>
                setDestination(event.target.value as "new_document" | "new_version")
              }
            >
              <option value="new_document">
                {intl.formatMessage({
                  id: "comments.filing.newDocument",
                  defaultMessage: "New Document",
                })}
              </option>
              <option value="new_version" disabled={documents.length === 0}>
                {intl.formatMessage({
                  id: "comments.filing.newVersion",
                  defaultMessage: "New Version on an existing Document",
                })}
              </option>
            </select>
          </div>
          {destination === "new_document" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="comment-filing-name">
                  <FormattedMessage id="comments.filing.name" defaultMessage="Document name" />
                </Label>
                <Input
                  id="comment-filing-name"
                  required
                  maxLength={200}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <ConfidentialToggle
                id="comment-filing-confidential"
                confidential={isConfidential}
                disabled={busy}
                onChange={setConfidential}
              />
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="comment-filing-document">
                  <FormattedMessage id="comments.filing.document" defaultMessage="Document" />
                </Label>
                <select
                  id="comment-filing-document"
                  className={CONTROL_CLASS}
                  value={documentId}
                  onChange={(event) => setDocumentId(event.target.value)}
                >
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="comment-filing-note">
                  <FormattedMessage id="comments.filing.note" defaultMessage="Note" />
                </Label>
                <textarea
                  id="comment-filing-note"
                  className={TEXTAREA_CLASS}
                  maxLength={2000}
                  value={note}
                  placeholder={intl.formatMessage({
                    id: "comments.filing.notePlaceholder",
                    defaultMessage: "What changed in this round",
                  })}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
            </>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="comment-filing-kind">
              <FormattedMessage id="comments.filing.kind" defaultMessage="Kind" />
            </Label>
            <select
              id="comment-filing-kind"
              className={CONTROL_CLASS}
              value={kind}
              onChange={(event) => setKind(event.target.value as HandSetDocumentVersionKind)}
            >
              {DOCUMENT_VERSION_KINDS.map((option) => (
                <option key={option} value={option}>
                  {intl.formatMessage(
                    {
                      id: "comments.filing.kindOption",
                      defaultMessage:
                        "{kind, select, draft_ours {Draft · ours} draft_theirs {Draft · theirs} redline_theirs {Redline · theirs} redline_ours {Redline · ours} amendment {Amendment} executed {Executed} other {{kind}}}",
                    },
                    { kind: option },
                  )}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="comments.filing.submit" defaultMessage="File" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function commentAttachmentHref(
  commentId: string,
  attachmentId: string,
  entityType: CommentEntityType,
  entityId: string,
): string {
  const query = new URLSearchParams({ entityType, entityId });
  return `/api/v1/comments/${encodeURIComponent(commentId)}/attachments/${encodeURIComponent(attachmentId)}?${query}`;
}
