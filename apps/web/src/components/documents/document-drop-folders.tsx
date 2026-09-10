// SPDX-License-Identifier: AGPL-3.0-only

/** Owning-record folder destinations for repository Document moves (DOC-008, DOC-011). */
import { useEffect, useState } from "react";
import { Folder, FolderOpen } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";
import { readRecordFolders, pathOf, type ContractFolder } from "../../lib/folders";
import {
  documentOwnerReference,
  type DocumentRecord,
  type RepositoryDocument,
} from "../../lib/documents";
import { Button } from "../ui/button";

/** The repository is flat; a dragged document reveals its own record's destinations. */
export function DocumentDropFolders({
  document,
  accepts,
  onDrop,
}: Readonly<{
  document: RepositoryDocument;
  accepts: (transfer: DataTransfer) => boolean;
  onDrop: (transfer: DataTransfer, folderId: string | null) => void;
}>) {
  const intl = useIntl();
  const [folders, setFolders] = useState<ContractFolder[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [over, setOver] = useState<string | null>(null);
  const owner = document.owner;
  const missingNumber =
    (owner.kind === "contract" || owner.kind === "matter") && owner.number === null;
  useEffect(() => {
    let live = true;
    let record: DocumentRecord;
    if (owner.kind === "contract" || owner.kind === "matter") {
      if (owner.number === null) {
        return;
      }
      record = { entityType: owner.kind, number: owner.number };
    } else record = { entityType: owner.kind, id: owner.id };
    void readRecordFolders(record).then((result) => {
      if (!live) return;
      if (result.ok) {
        setFolders(result.folders);
        setFailed(false);
      } else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [owner, attempt]);
  const targets = [
    {
      id: null,
      name: <FormattedMessage id="documents.drag.noFolder" defaultMessage="None" />,
    },
    ...(folders ?? []).map((folder) => ({
      id: folder.id,
      name: pathOf(folders ?? [], folder, "/"),
    })),
  ];
  return (
    <aside
      aria-label={intl.formatMessage({
        id: "documents.drag.moveTo",
        defaultMessage: "Move to folder",
      })}
      className="fixed bottom-6 right-6 z-50 max-h-[60vh] w-80 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-card border border-border-default bg-raised p-4 shadow-lg"
    >
      <h2 className="text-base font-semibold">
        <FormattedMessage id="documents.drag.moveTo" defaultMessage="Move to folder" />
      </h2>
      <p className="mb-3 truncate text-sm text-muted">
        <FormattedMessage
          id="documents.list.owner"
          defaultMessage="{reference} · {title}"
          values={{
            reference: documentOwnerReference(intl, owner),
            title: owner.title,
          }}
        />
      </p>
      {failed || missingNumber ? (
        <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
          <FormattedMessage id="documents.drag.retry" defaultMessage="Retry loading folders" />
        </Button>
      ) : folders === null ? (
        <p role="status" className="text-sm text-muted">
          <FormattedMessage id="documents.drag.loading" defaultMessage="Loading folders…" />
        </p>
      ) : (
        targets.map((folder) => {
          const current = (document.folder?.id ?? null) === folder.id;
          const key = folder.id ?? "root";
          return (
            <div
              key={key}
              className={`mb-1 flex items-center gap-2 rounded-control border px-3 py-3 text-sm ${current ? "border-transparent text-muted opacity-50" : over === key ? "border-link bg-hover text-link" : "border-border-default"}`}
              onDragOver={(event) => {
                if (current || !accepts(event.dataTransfer)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                setOver(key);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setOver(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!current) onDrop(event.dataTransfer, folder.id);
              }}
            >
              {over === key ? (
                <FolderOpen size={18} aria-hidden="true" />
              ) : (
                <Folder size={18} aria-hidden="true" />
              )}
              <span className="min-w-0 break-words">{folder.name}</span>
            </div>
          );
        })
      )}
    </aside>
  );
}
