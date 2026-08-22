// SPDX-License-Identifier: AGPL-3.0-only

/** CMT-011's chosen-file chips and live thread attachment rows. */

import { useRef } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Paperclip, X } from "lucide-react";
import type { Comment, CommentEntityType } from "../../lib/comments";
import { Button } from "../ui/button";

export const MAX_COMMENT_ATTACHMENTS = 5;

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
}: Readonly<{
  comment: Comment;
  entityType: CommentEntityType;
  entityId: string;
}>) {
  const intl = useIntl();
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
        <li key={attachment.id} className="flex min-w-0 items-center gap-1.5 text-sm">
          <Paperclip size={14} className="shrink-0 text-muted" aria-hidden="true" />
          <a
            className="truncate text-link underline-offset-2 hover:underline"
            href={commentAttachmentHref(comment.id, attachment.id, entityType, entityId)}
            download={attachment.filename}
          >
            {attachment.filename}
          </a>
        </li>
      ))}
    </ul>
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
