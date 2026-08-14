// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Documents section of the contract record (M11/2), drawn from the
 * C4 mock's list: the section heading with a count of what is on the
 * record, the upload control beside it, and one row per document —
 * name, kind, size, when it landed, and who put it there.
 *
 * **Every open is a download in M11.** The name is a plain link to the
 * version's own address, so the browser saves the file the way it saves
 * any other: no client-side blob juggling, no presigned URL, and the
 * session cookie rides the navigation on its own. In-app viewing is
 * M12, and the wider document panel DES-016 places beside it lands with
 * that milestone — this is the record-body section and nothing more.
 *
 * The version chain is deliberately absent. Each document shows the
 * version that is current (DOC-001), which in this step is its only
 * one; the chain, its pin, and the kind-and-note composer arrive with
 * revision upload.
 *
 * Uploading is Member+ (DD-015): a Contributor reads the section and
 * downloads from it, and is offered no control — absent, not disabled,
 * the convention every other card on this page follows. An archived
 * record is read the same way, because archiving freezes the record.
 */

import { useRef, useState } from "react";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { FileText, Upload } from "lucide-react";
import { Avatar } from "../avatar";
import { Button } from "../ui/button";
import { StatusNote, type FieldStatus } from "../status-note";
import { formatFileSize, formatShortDate } from "../../lib/format";
import {
  documentDownloadHref,
  uploadContractDocument,
  type ContractDocument,
  type DocumentVersionKind,
} from "../../lib/documents";

/**
 * The kind, as the C4 mock colors it: our own work reads as the calm
 * informational pair, their redline as the one that wants attention, a
 * signed copy as settled, and an amendment as a plain fact. Paired
 * bg+fg from one family per DES-005 — never mixed across families.
 */
const KIND_PILL: Record<DocumentVersionKind, string> = {
  draft_ours: "bg-status-info-bg text-status-info-fg",
  redline_ours: "bg-status-info-bg text-status-info-fg",
  redline_theirs: "bg-status-warning-bg text-status-warning-fg",
  executed: "bg-status-success-bg text-status-success-fg",
  amendment: "bg-status-neutral-bg text-status-neutral-fg",
};

/** The five CTR-014 kinds, named as the negotiation names them. The
 * value is selected inside the message rather than pasted in as a
 * translated fragment, so a locale that inflects it has the raw value
 * to work with (DES-013). */
function kindLabel(intl: IntlShape, kind: DocumentVersionKind): string {
  return intl.formatMessage(
    {
      id: "documents.kind",
      defaultMessage:
        "{kind, select, draft_ours {Draft · ours} redline_theirs {Redline · theirs} " +
        "redline_ours {Redline · ours} executed {Executed} amendment {Amendment} " +
        "other {Unknown}}",
    },
    { kind },
  );
}

export function DocumentsCard({
  contractNumber,
  documents,
  frozen,
  onDocuments,
}: Readonly<{
  /** CTR-003's reference — the address the upload route takes. */
  contractNumber: number;
  documents: readonly ContractDocument[];
  /** The record is frozen: it is archived, or this viewer reads it
   * rather than edits it. Either way it renders as facts. */
  frozen: boolean;
  onDocuments: (documents: ContractDocument[]) => void;
}>) {
  const intl = useIntl();
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  /** The file input is the real control; the button is what a person
   * sees, because a bare file input cannot be styled to the system. */
  const picker = useRef<HTMLInputElement>(null);

  async function send(file: File) {
    setStatus("saving");
    setError(undefined);
    const outcome = await uploadContractDocument(contractNumber, file);
    if (outcome.ok) {
      // Newest first, as the list is ordered: the new document goes on
      // top without a re-read.
      onDocuments([outcome.document, ...documents]);
      setStatus("saved");
      return;
    }
    setStatus("error");
    setError(
      outcome.detail ??
        intl.formatMessage({
          id: "documents.uploadError",
          defaultMessage: "That file could not be uploaded. Try again.",
        }),
    );
  }

  return (
    <section
      aria-labelledby="contract-documents-heading"
      className="w-full overflow-hidden rounded-card border border-border-default bg-raised"
    >
      <header className="flex h-section-header items-center justify-between gap-2 rounded-t-card border-b border-border-default bg-section-header px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="contract-documents-heading" className="text-base font-semibold">
            <FormattedMessage id="documents.section" defaultMessage="Documents" />
          </h2>
          {/* How much paper is on the record, without opening anything
              (story 22). The number is what the list holds — the API
              leaves out what this viewer may not see, so a count taken
              here can never announce what was left out. */}
          <span className="rounded-chip bg-badge-count-bg px-1.5 py-px text-xs font-medium text-badge-count-fg">
            {intl.formatNumber(documents.length)}
          </span>
        </div>
        {!frozen && (
          <div className="flex shrink-0 items-center gap-2">
            <StatusNote status={status} detail={error} />
            <input
              ref={picker}
              type="file"
              className="sr-only"
              // Out of the tab order: the button beside it is the
              // control a keyboard reaches, and a second stop on an
              // invisible input is a trap rather than an affordance.
              tabIndex={-1}
              // Any file type (DOC-004): the seam accepts whatever the
              // counterparty sent, so the picker offers no filter.
              onChange={(event) => {
                const file = event.target.files?.[0];
                // The same file picked twice in a row fires no change
                // event unless the input is cleared between them.
                event.target.value = "";
                if (file) void send(file);
              }}
              aria-label={intl.formatMessage({
                id: "documents.uploadField",
                defaultMessage: "File to upload",
              })}
            />
            <Button
              variant="secondary"
              disabled={status === "saving"}
              onClick={() => picker.current?.click()}
            >
              <Upload size={16} aria-hidden="true" />
              <FormattedMessage id="documents.upload" defaultMessage="Upload" />
            </Button>
          </div>
        )}
      </header>
      {documents.length === 0 ? (
        <p className="px-4 py-3 text-base text-muted">
          <FormattedMessage
            id="documents.empty"
            defaultMessage="No documents on this contract yet."
          />
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-start text-sm font-medium text-muted">
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  <FormattedMessage id="documents.column.name" defaultMessage="Name" />
                </th>
                <th scope="col" className="w-40 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="documents.column.kind" defaultMessage="Kind" />
                </th>
                <th scope="col" className="w-28 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="documents.column.size" defaultMessage="Size" />
                </th>
                <th scope="col" className="w-32 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="documents.column.modified" defaultMessage="Modified" />
                </th>
                <th scope="col" className="w-16 px-4 py-2 text-end font-medium">
                  <span className="sr-only">
                    <FormattedMessage
                      id="documents.column.uploadedBy"
                      defaultMessage="Uploaded by"
                    />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => {
                const version = document.currentVersion;
                return (
                  <tr key={document.id} className="border-t border-border-default">
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <FileText size={16} aria-hidden="true" className="shrink-0 text-muted" />
                        <a
                          href={documentDownloadHref(document.id, version.id)}
                          // The name is the download. `download` asks
                          // the browser to save rather than navigate;
                          // the response says the same thing in its own
                          // headers, so a browser that ignores the
                          // attribute still saves the file.
                          download={version.originalFilename}
                          className="rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                        >
                          {document.title}
                        </a>
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${KIND_PILL[version.kind]}`}
                      >
                        {kindLabel(intl, version.kind)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted">
                      {formatFileSize(version.byteSize)}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted">
                      {formatShortDate(version.createdAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center justify-end">
                        {/* The face is decorative (DES-018 draws it
                            aria-hidden), so the name is here for a
                            reader who cannot see it. */}
                        <span className="sr-only">
                          {intl.formatMessage(
                            {
                              id: "documents.uploadedBy",
                              defaultMessage: "Uploaded by {name}",
                            },
                            { name: version.uploadedBy.displayName },
                          )}
                        </span>
                        <Avatar
                          name={version.uploadedBy.displayName}
                          image={version.uploadedBy.image}
                          className="size-6 text-xs"
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
