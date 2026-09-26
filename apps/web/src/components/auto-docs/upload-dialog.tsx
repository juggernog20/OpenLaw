// SPDX-License-Identifier: AGPL-3.0-only

/** Upload a Word template and review the detected changes. */
import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, FileText, Loader, Upload, X } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { z } from "zod";
import { autoDocUploadAnswer, type AutoDocAnswer } from "../../lib/auto-docs";
import { formatFileSize } from "../../lib/format";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

type Report = {
  version: number;
  placeholders: number;
  blocks: number;
  created: number;
  orphaned: number;
};

export function UploadDialog({
  record,
  onSaved,
  onClose,
}: {
  record: AutoDocAnswer;
  onSaved: (record: AutoDocAnswer) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const picker = useRef<HTMLInputElement>(null);
  const browse = useRef<HTMLButtonElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [report, setReport] = useState<Report>();
  useEffect(() => {
    if (report) done.current?.focus();
  }, [report]);
  const failed = () =>
    setError(
      intl.formatMessage({
        id: "autoDocs.uploadFailed",
        defaultMessage: "Could not upload the template. Try again.",
      }),
    );
  function choose(files: readonly File[]) {
    if (busy || files.length === 0) return;
    if (files.length !== 1 || !files[0]?.name.toLowerCase().endsWith(".docx")) {
      setFile(null);
      setError(
        intl.formatMessage({
          id: "autoDocs.uploadFileType",
          defaultMessage: "Choose a single Word document (.docx).",
        }),
      );
      return;
    }
    setFile(files[0]);
    setError(undefined);
  }
  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    setError(undefined);
    const body = new FormData();
    body.append("file", file);
    try {
      const response = await fetch(
        `/api/v1/auto-docs/${encodeURIComponent(record.autoDoc.id)}/template`,
        { method: "POST", credentials: "same-origin", body },
      );
      const result: unknown = await response.json();
      if (!response.ok) {
        const refusal = z.object({ detail: z.string() }).safeParse(result);
        if (refusal.success) setError(refusal.data.detail);
        else failed();
        return;
      }
      const parsed = autoDocUploadAnswer.safeParse(result);
      if (!parsed.success) {
        setError(
          intl.formatMessage({
            id: "autoDocs.invalidUploadReply",
            defaultMessage:
              "The upload response could not be read. Reload this Auto-Doc to check its saved template.",
          }),
        );
        return;
      }
      const before = new Set((record.formVersion?.definition.fields ?? []).map((f) => f.slug));
      const after = parsed.data.formVersion?.definition.fields ?? [];
      setReport({
        version: parsed.data.template?.versions[0]?.versionNumber ?? 1,
        placeholders: parsed.data.detection.placeholders.length,
        blocks: parsed.data.detection.blocks.length,
        created: after.filter((field) => !before.has(field.slug)).length,
        orphaned: parsed.data.orphanedFields.length,
      });
      onSaved(parsed.data);
    } catch {
      failed();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        width="xl"
        className="p-0"
        aria-describedby="auto-doc-upload-description"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          browse.current?.focus();
        }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border-default px-6 py-4">
          <div className="min-w-0">
            <DialogTitle>
              <FormattedMessage id="autoDocs.uploadVersion" defaultMessage="Upload version" />
            </DialogTitle>
            <p id="auto-doc-upload-description" className="mt-1 break-words text-sm text-muted">
              {record.autoDoc.name}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={busy}
            onClick={onClose}
            aria-label={intl.formatMessage({ id: "common.close", defaultMessage: "Close" })}
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </header>
        {report ? (
          <>
            <div role="status" className="flex flex-col gap-4 px-6 py-5">
              <div className="flex items-center gap-2 text-status-success-fg">
                <CircleCheck size={20} aria-hidden="true" />
                <p className="font-semibold">
                  <FormattedMessage
                    id="autoDocs.uploadComplete"
                    defaultMessage="File version {number} uploaded"
                    values={{ number: report.version }}
                  />
                </p>
              </div>
              <div className="grid grid-cols-2 divide-x divide-border-default rounded-card border border-border-default bg-control">
                <div className="p-4">
                  <p className="text-lg font-semibold">{intl.formatNumber(report.placeholders)}</p>
                  <p className="text-sm text-muted">
                    <FormattedMessage
                      id="autoDocs.uploadPlaceholders"
                      defaultMessage="Placeholders detected"
                    />
                  </p>
                </div>
                <div className="p-4">
                  <p className="text-lg font-semibold">{intl.formatNumber(report.blocks)}</p>
                  <p className="text-sm text-muted">
                    <FormattedMessage id="autoDocs.uploadBlocks" defaultMessage="Blocks detected" />
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="autoDocs.uploadFieldsCreated"
                  defaultMessage="{created, plural, =0 {No new form fields.} one {# form field created.} other {# form fields created.}}"
                  values={{ created: report.created }}
                />
              </p>
              {report.orphaned > 0 && (
                <p className="rounded-button bg-status-warning-bg p-3 text-sm text-status-warning-fg">
                  <FormattedMessage
                    id="autoDocs.uploadOrphanedFields"
                    defaultMessage="{count, plural, one {# field no longer has a placeholder in this file.} other {# fields no longer have placeholders in this file.}} Your existing fields have been kept for review."
                    values={{ count: report.orphaned }}
                  />
                </p>
              )}
            </div>
            <footer className="flex justify-end border-t border-border-default px-6 py-4">
              <Button ref={done} onClick={onClose}>
                <FormattedMessage id="common.done" defaultMessage="Done" />
              </Button>
            </footer>
          </>
        ) : (
          <form
            aria-busy={busy}
            onSubmit={(event) => {
              event.preventDefault();
              void upload();
            }}
          >
            <div className="flex flex-col gap-4 px-6 py-5">
              <div
                className={cn(
                  "flex flex-col items-center gap-3 rounded-card border border-dashed bg-control px-4 py-8 transition-colors duration-150",
                  over ? "border-link" : "border-border-strong",
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!busy) setOver(true);
                }}
                onDragLeave={(event) => {
                  const next = event.relatedTarget;
                  if (!(next instanceof Node && event.currentTarget.contains(next))) setOver(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setOver(false);
                  choose([...event.dataTransfer.files]);
                }}
              >
                <Upload size={24} aria-hidden="true" className="text-muted" />
                <div className="text-center">
                  <p className="text-sm font-medium">
                    <FormattedMessage
                      id="autoDocs.uploadDrop"
                      defaultMessage="Drop your Word template here"
                    />
                  </p>
                  <p id="auto-doc-upload-format" className="mt-1 text-xs text-muted">
                    <FormattedMessage id="autoDocs.uploadFormat" defaultMessage="One .docx file" />
                  </p>
                </div>
                <input
                  ref={picker}
                  id="auto-doc-upload-file"
                  disabled={busy}
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label={intl.formatMessage({
                    id: "autoDocs.wordTemplate",
                    defaultMessage: "Word template",
                  })}
                  aria-describedby="auto-doc-upload-format"
                  onChange={(event) => {
                    choose([...(event.target.files ?? [])]);
                    event.target.value = "";
                  }}
                />
                <Button
                  ref={browse}
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => picker.current?.click()}
                >
                  {file ? (
                    <FormattedMessage id="autoDocs.uploadChangeFile" defaultMessage="Change file" />
                  ) : (
                    <FormattedMessage id="autoDocs.uploadChooseFile" defaultMessage="Choose file" />
                  )}
                </Button>
              </div>
              {file && (
                <div className="flex items-center gap-3 rounded-card border border-border-default p-3">
                  <FileText size={20} aria-hidden="true" className="shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{file.name}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatFileSize(file.size, { locale: intl.locale })}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-label={intl.formatMessage({
                      id: "autoDocs.uploadRemoveFile",
                      defaultMessage: "Remove file",
                    })}
                    onClick={() => {
                      setFile(null);
                      setError(undefined);
                      browse.current?.focus();
                    }}
                  >
                    <X size={16} aria-hidden="true" />
                  </Button>
                </div>
              )}
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-button bg-status-danger-bg p-3 text-sm text-status-danger-fg"
                >
                  <CircleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <p className="min-w-0 break-words">{error}</p>
                </div>
              )}
            </div>
            <footer className="flex justify-end gap-2 border-t border-border-default px-6 py-4">
              <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
                <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
              </Button>
              <Button type="submit" disabled={!file || busy}>
                {busy ? (
                  <>
                    <Loader size={16} aria-hidden="true" className="animate-spin" />
                    <span role="status">
                      <FormattedMessage id="autoDocs.uploading" defaultMessage="Uploading…" />
                    </span>
                  </>
                ) : (
                  <>
                    <Upload size={16} aria-hidden="true" />
                    <FormattedMessage id="autoDocs.upload" defaultMessage="Upload" />
                  </>
                )}
              </Button>
            </footer>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
