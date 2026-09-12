// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useState } from "react";
import { Archive, FolderInput, RotateCcw, Trash2, X } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  archiveDocument,
  restoreDocument,
  hardDeleteDocument,
  updateDocument,
  type ContractDocument,
} from "../../lib/documents";
import { pathOf, type ContractFolder } from "../../lib/folders";
import { runBounded } from "../../lib/batch-upload";
import { CONTROL_CLASS } from "../../lib/form-controls";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type Action = "move" | "archive" | "restore" | "delete";

export function BulkDocumentActions({
  documents,
  folders,
  canMove,
  canDelete,
  busy,
  onBusy,
  onClear,
  onFinished,
}: Readonly<{
  documents: readonly ContractDocument[];
  folders: readonly ContractFolder[];
  canMove: boolean;
  canDelete: boolean;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onClear: () => void;
  onFinished: (failedIds: string[]) => Promise<void>;
}>) {
  const intl = useIntl();
  const [dialog, setDialog] = useState<"move" | "delete" | null>(null);
  const [folderId, setFolderId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<{ id: string; title: string; detail: string }[]>([]);
  /** What sits between two names of a destination's path — a mark a
   * reader reads, so it is a message rather than a literal in the
   * joiner (DES-013), matching the same separator in DocumentsCard's
   * own move dialogs. */
  const pathSeparator = intl.formatMessage({
    id: "documents.folder.pathSeparator",
    defaultMessage: "/",
  });
  const running = useRef(false);
  const allLive = documents.every((document) => document.archivedAt === null);
  const allArchived = documents.every((document) => document.archivedAt !== null);

  async function run(action: Action) {
    if (busy || running.current || documents.length === 0) return;
    if (action === "delete" && (!canDelete || confirmation.trim().toLowerCase() !== "delete"))
      return;
    running.current = true;
    onBusy(true);
    setErrors([]);
    const failed: { id: string; title: string; detail: string }[] = [];
    try {
      await runBounded(documents, 3, async (document) => {
        const result =
          action === "delete"
            ? await hardDeleteDocument(document.id, document.title)
            : action === "archive"
              ? await archiveDocument(document.id)
              : action === "restore"
                ? await restoreDocument(document.id)
                : document.folderId === (folderId || null)
                  ? { ok: true as const }
                  : await updateDocument(document.id, { folderId: folderId || null });
        if (!result.ok)
          failed.push({
            id: document.id,
            title: document.title,
            detail:
              result.detail ??
              intl.formatMessage({
                id: "documents.bulk.failed",
                defaultMessage: "This document could not be updated. Try again.",
              }),
          });
      });
      setErrors(failed);
      setDialog(null);
      setConfirmation("");
      await onFinished(failed.map((document) => document.id));
    } finally {
      running.current = false;
      onBusy(false);
    }
  }

  return (
    <div className="border-b border-border-default bg-section-header px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-2 text-sm font-medium">
          <FormattedMessage
            id="documents.bulk.selected"
            defaultMessage="{count} selected"
            values={{ count: documents.length }}
          />
        </span>
        {canMove && (
          <Button
            variant="secondary"
            disabled={busy || !allLive}
            onClick={() => {
              setFolderId("");
              setDialog("move");
            }}
          >
            <FolderInput size={16} aria-hidden="true" />
            <FormattedMessage id="documents.bulk.move" defaultMessage="Move" />
          </Button>
        )}
        <Button variant="secondary" disabled={busy || !allLive} onClick={() => void run("archive")}>
          <Archive size={16} aria-hidden="true" />
          <FormattedMessage id="documents.action.archive" defaultMessage="Archive" />
        </Button>
        {allArchived && (
          <Button variant="secondary" disabled={busy} onClick={() => void run("restore")}>
            <RotateCcw size={16} aria-hidden="true" />
            <FormattedMessage id="documents.action.restore" defaultMessage="Restore" />
          </Button>
        )}
        {canDelete && (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setConfirmation("");
              setDialog("delete");
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            <FormattedMessage id="documents.action.delete" defaultMessage="Delete" />
          </Button>
        )}
        {busy && (
          <span role="status" className="text-sm text-muted">
            <FormattedMessage id="documents.bulk.updating" defaultMessage="Updating documents…" />
          </span>
        )}
        <Button
          className="ms-auto"
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={intl.formatMessage({
            id: "documents.bulk.clear",
            defaultMessage: "Clear selection",
          })}
          onClick={onClear}
        >
          <X size={16} aria-hidden="true" />
        </Button>
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="mt-2 space-y-1 text-sm text-status-danger-fg">
          {errors.map((error) => (
            <li key={error.id}>
              {error.title}: {error.detail}
            </li>
          ))}
        </ul>
      )}
      {dialog && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setDialog(null);
          }}
        >
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>
              {dialog === "delete" ? (
                <FormattedMessage
                  id="documents.bulk.deleteTitle"
                  defaultMessage="Delete {count, plural, one {# document} other {# documents}}?"
                  values={{ count: documents.length }}
                />
              ) : (
                <FormattedMessage
                  id="documents.bulk.moveTitle"
                  defaultMessage="Move {count, plural, one {# document} other {# documents}}"
                  values={{ count: documents.length }}
                />
              )}
            </DialogTitle>
            <ul className="mt-4 max-h-36 overflow-y-auto text-sm text-muted">
              {documents.map((document) => (
                <li key={document.id} className="break-words">
                  {document.title}
                </li>
              ))}
            </ul>
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void run(dialog);
              }}
            >
              {dialog === "move" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bulk-document-folder">
                    <FormattedMessage id="documents.move.into" defaultMessage="File in" />
                  </Label>
                  <select
                    id="bulk-document-folder"
                    className={CONTROL_CLASS}
                    value={folderId}
                    disabled={busy}
                    onChange={(event) => setFolderId(event.target.value)}
                  >
                    <option value="">
                      {intl.formatMessage({ id: "documents.bulk.none", defaultMessage: "None" })}
                    </option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {pathOf(folders, folder, pathSeparator)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <p className="text-sm">
                    <FormattedMessage
                      id="documents.bulk.deleteWarning"
                      defaultMessage="The selected documents and all their versions will be permanently deleted. This cannot be undone."
                    />
                  </p>
                  <Label htmlFor="bulk-document-delete">
                    <FormattedMessage
                      id="documents.delete.confirmLabel"
                      defaultMessage={'Type "delete" to confirm'}
                    />
                  </Label>
                  <Input
                    id="bulk-document-delete"
                    autoFocus
                    autoComplete="off"
                    disabled={busy}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </>
              )}
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setDialog(null)}
                >
                  <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
                </Button>
                <Button
                  type="submit"
                  variant={dialog === "delete" ? "danger" : "primary"}
                  disabled={
                    busy || (dialog === "delete" && confirmation.trim().toLowerCase() !== "delete")
                  }
                >
                  {dialog === "delete" ? (
                    <FormattedMessage id="documents.action.delete" defaultMessage="Delete" />
                  ) : (
                    <FormattedMessage id="documents.bulk.move" defaultMessage="Move" />
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
