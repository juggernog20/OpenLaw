// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Publish (DES-087 clause 4): the pair that will go live, newest file
 * and newest form preselected, with ADO-004's refusal list inside.
 */
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../../lib/api";
import { CONTROL_CLASS } from "../../lib/form-controls";
import type { AutoDocAnswer } from "../../lib/auto-docs";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";

export function PublishDialog({
  record,
  onSaved,
  onClose,
}: {
  record: AutoDocAnswer;
  onSaved: (record: AutoDocAnswer) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const [fileId, setFileId] = useState(record.template?.versions[0]?.id ?? "");
  const [formId, setFormId] = useState(record.formVersion?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const unchanged =
    record.autoDoc.state === "published" &&
    record.autoDoc.publishedDocumentVersionId === fileId &&
    record.autoDoc.publishedFormVersionId === formId;
  async function publish() {
    setBusy(true);
    setError(undefined);
    const result = await api
      .POST("/api/v1/auto-docs/{id}/publish", {
        params: { path: { id: record.autoDoc.id } },
        body: { documentVersionId: fileId, formVersionId: formId },
      })
      .catch(() => undefined);
    setBusy(false);
    if (result?.data) {
      onSaved(result.data);
      onClose();
    } else
      setError(
        result?.error?.detail ??
          intl.formatMessage({
            id: "autoDocs.lifecycleFailed",
            defaultMessage: "Could not change this Auto-Doc's state. Try again.",
          }),
      );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="autoDocs.publish" defaultMessage="Publish" />
        </DialogTitle>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void publish();
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              <FormattedMessage id="autoDocs.fileToPublish" defaultMessage="File version" />
            </span>
            <select
              className={CONTROL_CLASS}
              disabled={busy}
              value={fileId}
              onChange={(event) => setFileId(event.target.value)}
            >
              {!record.template?.versions.length && (
                <option value="">
                  {intl.formatMessage({
                    id: "autoDocs.noFileYet",
                    defaultMessage: "No file uploaded",
                  })}
                </option>
              )}
              {record.template?.versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {intl.formatMessage(
                    { id: "autoDocs.fileVersionNumber", defaultMessage: "File version {number}" },
                    { number: version.versionNumber },
                  )}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              <FormattedMessage id="autoDocs.formToPublish" defaultMessage="Form version" />
            </span>
            <select
              className={CONTROL_CLASS}
              disabled={busy}
              value={formId}
              onChange={(event) => setFormId(event.target.value)}
            >
              {!record.formVersions.length && (
                <option value="">
                  {intl.formatMessage({ id: "autoDocs.noFormYet", defaultMessage: "No form yet" })}
                </option>
              )}
              {record.formVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {intl.formatMessage(
                    { id: "autoDocs.formVersion", defaultMessage: "Form version {number}" },
                    { number: version.versionNumber },
                  )}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted">
            <FormattedMessage
              id="autoDocs.publishCaption"
              defaultMessage="Later edits leave this pair unchanged until you publish again."
            />
          </p>
          {error && (
            <p role="alert" className="text-sm text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy || !fileId || !formId || unchanged}>
              <FormattedMessage id="autoDocs.publish" defaultMessage="Publish" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
