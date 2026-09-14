// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Upload version (DES-087 clause 3): a dialog, because detection can
 * refuse. After the upload it says what changed before it closes.
 */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { z } from "zod";
import { autoDocUploadAnswer, type AutoDocAnswer } from "../../lib/auto-docs";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

type Report = { placeholders: number; blocks: number; created: number; orphaned: number };

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
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [report, setReport] = useState<Report>();
  const failed = () =>
    setError(
      intl.formatMessage({
        id: "autoDocs.uploadFailed",
        defaultMessage: "Could not upload the template. Try again.",
      }),
    );
  async function upload() {
    if (!file) return;
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="autoDocs.uploadVersion" defaultMessage="Upload version" />
        </DialogTitle>
        {report ? (
          <div className="flex flex-col gap-3">
            <p role="status" className="text-sm">
              <FormattedMessage
                id="autoDocs.uploadReport"
                defaultMessage="File version {number}: {placeholders, plural, one {# Placeholder} other {# Placeholders}}, {blocks, plural, one {# Block} other {# Blocks}}. {created, plural, =0 {No new form fields.} one {# form field created.} other {# form fields created.}} {orphaned, plural, =0 {} one {# field has no Placeholder now.} other {# fields have no Placeholder now.}}"
                values={{ ...report, number: record.template?.versions[0]?.versionNumber ?? 1 }}
              />
            </p>
            <div className="flex justify-end">
              <Button onClick={onClose}>
                <FormattedMessage id="common.close" defaultMessage="Close" />
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void upload();
            }}
          >
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor="auto-doc-upload-file" className="font-medium">
                <FormattedMessage id="autoDocs.wordTemplate" defaultMessage="Word template" />
              </label>
              <input
                id="auto-doc-upload-file"
                disabled={busy}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className={CONTROL_CLASS}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <span className="text-xs text-muted">
                <FormattedMessage
                  id="autoDocs.uploadCaption"
                  defaultMessage="Each upload adds a file version. A new Placeholder gets a form field; a removed one leaves its field in place."
                />
              </span>
            </div>
            {error && (
              <p role="alert" className="text-sm text-status-danger-fg">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
              </Button>
              <Button type="submit" disabled={!file || busy}>
                <FormattedMessage id="autoDocs.upload" defaultMessage="Upload" />
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
