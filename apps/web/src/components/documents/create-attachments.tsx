// SPDX-License-Identifier: AGPL-3.0-only

/** Stages attachments before creation and uploads them through the document API afterward.
 * Failed files remain retryable (DOC-011 UX addendum). */

import { useEffect, useId, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Check, Download, FileText, Loader, Paperclip, X } from "lucide-react";
import {
  uploadRecordDocument,
  useDocumentTypeOptions,
  type DocumentRecord,
  type DocumentTypeModule,
} from "../../lib/documents";
import { formatFileSize } from "../../lib/format";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { Button } from "../ui/button";
import { FileTile, FileTileGrid, TILE_ACTION_CLASS } from "./file-tiles";
import { Label } from "../ui/label";

type Attachment = {
  id: number;
  file: File;
  state: "queued" | "uploading" | "done" | "failed";
  error?: string;
};

export function useCreateAttachments() {
  const intl = useIntl();
  const [rows, setRows] = useState<Attachment[]>([]);
  /** DOC-015: one type for every staged file; empty is no type. */
  const [typeId, setTypeId] = useState("");
  const [created, setCreated] = useState(false);
  const [pending, setPending] = useState(false);
  const nextId = useRef(0);
  const running = useRef(false);
  const destination = useRef<DocumentRecord | null>(null);
  const complete = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function add(files: File[]) {
    if (created || running.current) return;
    setRows((current) => {
      const next = [...current];
      for (const file of files) {
        if (
          next.some(
            (row) =>
              row.file.name === file.name &&
              row.file.size === file.size &&
              row.file.lastModified === file.lastModified,
          )
        )
          continue;
        next.push({ id: nextId.current++, file, state: "queued" });
      }
      return next;
    });
  }

  async function send(record: DocumentRecord, selected: Attachment[]) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    let failed = false;
    for (const row of selected) {
      if (!mounted.current) break;
      setRows((current) =>
        current.map((item) =>
          item.id === row.id ? { ...item, state: "uploading", error: undefined } : item,
        ),
      );
      const result = await uploadRecordDocument(record, {
        file: row.file,
        documentTypeId: typeId || null,
        note: "",
      });
      if (!result.ok) failed = true;
      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                state: result.ok ? "done" : "failed",
                error: result.ok
                  ? undefined
                  : (result.detail ??
                    intl.formatMessage({
                      id: "createAttachments.failed",
                      defaultMessage: "The file could not be uploaded.",
                    })),
              }
            : item,
        ),
      );
    }
    running.current = false;
    setPending(false);
    if (!failed && mounted.current) complete.current?.();
  }

  return {
    rows,
    typeId,
    setTypeId,
    created,
    pending,
    add,
    remove: (id: number) => setRows((current) => current.filter((row) => row.id !== id)),
    upload: async (record: DocumentRecord, onComplete: () => void) => {
      if (destination.current || running.current) return;
      destination.current = record;
      complete.current = onComplete;
      if (rows.length === 0) return onComplete();
      setCreated(true);
      await send(record, rows);
    },
    retry: () => {
      if (destination.current)
        void send(
          destination.current,
          rows.filter((row) => row.state === "failed"),
        );
    },
    finish: () => {
      if (!running.current) complete.current?.();
    },
  };
}

/** A file the record already carries before anything is staged here.
 * The Convert dialog passes the Request's own attachments, which the
 * conversion copies onto the new record (INT-002, DOC-008). */
export type ExistingAttachment = {
  id: string;
  filename: string;
  /** Download target, when the reader is allowed to open it. */
  href?: string;
};

export function CreateAttachments({
  uploads,
  disabled = false,
  module,
  existing = [],
}: Readonly<{
  uploads: ReturnType<typeof useCreateAttachments>;
  disabled?: boolean;
  /** Which Document type list the staged files take their type from;
   * null for a Knowledge Item, whose files take the item's type. */
  module: DocumentTypeModule | null;
  /** Files already on the way to the record, shown read-only before
   * anything staged here. */
  existing?: readonly ExistingAttachment[];
}>) {
  const intl = useIntl();
  const id = useId();
  const typeOptions = useDocumentTypeOptions(module);
  const { typeId, setTypeId } = uploads;
  // A module switch (the Convert dialog's target) leaves a type from the
  // other list behind; the seam would refuse it. It is dropped when the
  // module changes, without waiting for the new list to answer, and
  // again if the answered list does not hold it.
  const shownModule = useRef(module);
  useEffect(() => {
    if (shownModule.current === module) return;
    shownModule.current = module;
    setTypeId("");
  }, [module, setTypeId]);
  useEffect(() => {
    if (typeOptions && typeId && !typeOptions.some((option) => option.id === typeId)) {
      setTypeId("");
    }
  }, [typeOptions, typeId, setTypeId]);
  const input = useRef<HTMLInputElement>(null);
  const blocked = disabled || uploads.pending;
  const failures = uploads.rows.some((row) => row.state === "failed");
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${id}-label`}>
      <Label id={`${id}-label`}>
        <FormattedMessage id="createAttachments.label" defaultMessage="Documents" />
      </Label>
      {!uploads.created && (
        <div
          className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-5 text-center"
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (!blocked) uploads.add(Array.from(event.dataTransfer.files));
          }}
        >
          {existing.length > 0 && (
            <FileTileGrid>
              {existing.map((file) => (
                <FileTile
                  key={file.id}
                  filename={file.filename}
                  action={
                    file.href && (
                      <Button asChild variant="ghost" size="icon" className={TILE_ACTION_CLASS}>
                        <a download={file.filename} href={file.href}>
                          <Download aria-hidden="true" className="size-3.5" />
                          <span className="sr-only">
                            <FormattedMessage
                              id="createAttachments.download"
                              defaultMessage="Download {name}"
                              values={{ name: file.filename }}
                            />
                          </span>
                        </a>
                      </Button>
                    )
                  }
                />
              ))}
            </FileTileGrid>
          )}
          {uploads.rows.length > 0 && (
            <FileTileGrid>
              {uploads.rows.map((row) => (
                <FileTile
                  key={row.id}
                  filename={row.file.name}
                  caption={formatFileSize(row.file.size, { locale: intl.locale })}
                  action={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={TILE_ACTION_CLASS}
                      disabled={blocked}
                      aria-label={intl.formatMessage(
                        { id: "createAttachments.remove", defaultMessage: "Remove {name}" },
                        { name: row.file.name },
                      )}
                      onClick={() => uploads.remove(row.id)}
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </Button>
                  }
                />
              ))}
            </FileTileGrid>
          )}
          {existing.length === 0 && uploads.rows.length === 0 && (
            <Paperclip size={20} className="text-muted" aria-hidden="true" />
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={blocked}
            onClick={() => input.current?.click()}
          >
            <FormattedMessage id="createAttachments.choose" defaultMessage="Attach documents" />
          </Button>
          <span className="text-xs text-muted">
            <FormattedMessage
              id="createAttachments.drop"
              defaultMessage="or drag and drop files here"
            />
          </span>
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            disabled={blocked}
            aria-label={intl.formatMessage({
              id: "createAttachments.choose",
              defaultMessage: "Attach documents",
            })}
            onChange={(event) => {
              uploads.add(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </div>
      )}
      {uploads.rows.length > 0 && !uploads.created && typeOptions && typeOptions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-type`}>
            <FormattedMessage id="createAttachments.type" defaultMessage="Document type" />
          </Label>
          <select
            id={`${id}-type`}
            className={CONTROL_CLASS}
            value={typeId}
            disabled={blocked}
            onChange={(event) => setTypeId(event.target.value)}
          >
            <option value="">
              {intl.formatMessage({ id: "documents.type.none", defaultMessage: "No type" })}
            </option>
            {typeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayName}
              </option>
            ))}
          </select>
        </div>
      )}
      {uploads.rows.length > 0 && uploads.created && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {uploads.rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 p-3">
              {row.state === "uploading" ? (
                <Loader size={16} className="shrink-0 animate-spin" aria-hidden="true" />
              ) : row.state === "done" ? (
                <Check size={16} className="shrink-0 text-status-success-fg" aria-hidden="true" />
              ) : (
                <FileText size={16} className="shrink-0 text-muted" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm">{row.file.name}</p>
                <p className="text-xs text-muted">
                  {formatFileSize(row.file.size, { locale: intl.locale })}
                </p>
                {row.error && <p className="text-xs text-status-danger-fg">{row.error}</p>}
                {row.state === "done" && (
                  <span className="text-xs text-muted">
                    <FormattedMessage id="createAttachments.uploaded" defaultMessage="Uploaded" />
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {uploads.created && (
        <>
          <p role="status" className="text-sm text-muted">
            {uploads.pending ? (
              <FormattedMessage
                id="createAttachments.uploading"
                defaultMessage="Record created. Uploading documents…"
              />
            ) : (
              <FormattedMessage
                id="createAttachments.partial"
                defaultMessage="Record created. Some documents could not be uploaded."
              />
            )}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={uploads.pending}
              onClick={uploads.finish}
            >
              <FormattedMessage id="createAttachments.continue" defaultMessage="Continue" />
            </Button>
            {failures && (
              <Button type="button" disabled={uploads.pending} onClick={uploads.retry}>
                <FormattedMessage
                  id="createAttachments.retry"
                  defaultMessage="Retry failed uploads"
                />
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
