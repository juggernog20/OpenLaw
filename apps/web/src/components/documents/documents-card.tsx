// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Documents section of the contract record (M11/2, M11/3), drawn
 * from the C4 mock's list: the section heading with a count of what is
 * on the record, the upload control beside it, and one row per document
 * — name, kind, version, size, when it landed, and who put it there.
 *
 * **The chain reads as a negotiation, not as a pile of files.** A
 * document's row is the version that matters now (DOC-001), marked
 * Current and carrying the document's own name; the rounds it supersedes
 * open underneath it, newest first, each with the note whoever uploaded
 * it wrote about that round. Nothing is hidden by superseding it — every
 * version, including every superseded one, is its own download.
 *
 * **A contract holds as many documents as it needs.** A loose attachment
 * such as a schedule or a certificate is its own document with its own
 * chain, sitting beside the main instrument rather than inside its
 * history (CTR-014). The primary-document designation that names which
 * one is the main instrument lands with the executed pin.
 *
 * **Every open is a download in M11.** The name is a plain link to the
 * version's own address, so the browser saves the file the way it saves
 * any other: no client-side blob juggling, no presigned URL, and the
 * session cookie rides the navigation on its own. In-app viewing is
 * M12, and the wider document panel DES-016 places beside it lands with
 * that milestone — this is the record-body section and nothing more.
 *
 * **Two dialogs, because two of these edits are forms.** An upload
 * collects the file, the kind, and the note together, and a metadata
 * edit collects the name and the description together, so both go
 * through a purpose-built dialog with its own confirm rather than
 * committing per keystroke (DES-017). Renaming is offered in the dialog
 * rather than in place on the name cell, because on this surface the
 * name is the download.
 *
 * Writing is Member+ (DD-015): a Contributor reads the section and
 * downloads from it, and is offered no control — absent, not disabled,
 * the convention every other card on this page follows. An archived
 * record is read the same way, because archiving freezes the record.
 */

import { useRef, useState } from "react";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { ChevronDown, ChevronRight, FilePlus2, FileText, Pencil, Upload } from "lucide-react";
import { Avatar } from "../avatar";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { StatusNote, type FieldStatus } from "../status-note";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import { formatFileSize, formatShortDate } from "../../lib/format";
import {
  chainOf,
  documentDownloadHref,
  DOCUMENT_VERSION_KINDS,
  updateDocument,
  uploadContractDocument,
  uploadDocumentVersion,
  type ContractDocument,
  type DocumentVersion,
  type DocumentVersionKind,
  type UploadDraft,
} from "../../lib/documents";

/** What the note field holds, matching the seam's own ceiling — which
 * refuses a longer one rather than shortening it. */
const MAX_NOTE_LENGTH = 2000;

/** What the description holds, for the note's reason: the seam refuses
 * a longer one, so the control stops the writer at the same line. */
const MAX_DESCRIPTION_LENGTH = 10_000;

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

/** What a composer is opened for: the record's first file on a document
 * that does not exist yet, or the next round on one that does. */
type Composer = { document: ContractDocument } | { document: undefined };

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
  /** Which documents have their earlier rounds open. Collapsed by
   * default: the section answers "which file matters now" first, and the
   * history is one click away rather than in the way. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [composer, setComposer] = useState<Composer | null>(null);
  const [editing, setEditing] = useState<ContractDocument | null>(null);

  /** A document that just changed, put back where it was. The list order
   * is the API's (newest document first), and adding a version to an
   * older document does not move it. */
  function replace(document: ContractDocument) {
    onDocuments(documents.map((row) => (row.id === document.id ? document : row)));
    setStatus("saved");
  }

  function prepend(document: ContractDocument) {
    // Newest first, as the list is ordered: the new document goes on
    // top without a re-read.
    onDocuments([document, ...documents]);
    setStatus("saved");
  }

  function toggle(documentId: string) {
    setOpened((current) => {
      const next = new Set(current);
      if (!next.delete(documentId)) next.add(documentId);
      return next;
    });
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
            <StatusNote status={status} />
            <Button variant="secondary" onClick={() => setComposer({ document: undefined })}>
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
                <th scope="col" className="w-32 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="documents.column.version" defaultMessage="Version" />
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
                {!frozen && (
                  <th scope="col" className="w-20 px-4 py-2 text-end font-medium">
                    <span className="sr-only">
                      <FormattedMessage id="documents.column.actions" defaultMessage="Actions" />
                    </span>
                  </th>
                )}
              </tr>
            </thead>
            {/* One row group per document, because one document is one
                chain: its current version leads, and the rounds it
                supersedes belong to it and to nothing else. */}
            {documents.map((document) => {
              const chain = chainOf(document);
              // A document with no version is a broken record, not an
              // empty one, so it is left undrawn rather than drawn
              // without a file.
              if (!chain) return null;
              const isOpen = opened.has(document.id);
              return (
                <tbody key={document.id}>
                  <tr className="border-t border-border-default">
                    <td className="px-4 py-2.5">
                      <span className="flex items-start gap-1">
                        {chain.superseded.length > 0 ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-expanded={isOpen}
                            onClick={() => toggle(document.id)}
                            aria-label={intl.formatMessage(
                              {
                                id: "documents.chain.toggle",
                                defaultMessage:
                                  "{open, select, true {Hide} other {Show}} the " +
                                  "{count, plural, one {# earlier version} " +
                                  "other {# earlier versions}} of {title}",
                              },
                              {
                                open: isOpen,
                                count: chain.superseded.length,
                                title: document.title,
                              },
                            )}
                          >
                            {isOpen ? (
                              <ChevronDown size={16} aria-hidden="true" />
                            ) : (
                              <ChevronRight size={16} aria-hidden="true" />
                            )}
                          </Button>
                        ) : (
                          // The column keeps its width whether a
                          // document has history or not, so the names
                          // stay on one line down the section.
                          <span className="size-6" aria-hidden="true" />
                        )}
                        <FileText
                          size={16}
                          aria-hidden="true"
                          className="mt-1 shrink-0 text-muted"
                        />
                        <span className="flex min-w-0 flex-col">
                          <a
                            href={documentDownloadHref(document.id, chain.current.id)}
                            // The name is the download. `download` asks
                            // the browser to save rather than navigate;
                            // the response says the same thing in its own
                            // headers, so a browser that ignores the
                            // attribute still saves the file.
                            download={chain.current.originalFilename}
                            className="rounded-chip font-medium text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                          >
                            {document.title}
                          </a>
                          {/* Two muted lines at most, and each says
                              which one it is to a reader who cannot see
                              the difference — the DES-021 sr-only
                              prefix rule, for the same ambiguity. */}
                          {document.description && (
                            <span className="text-sm text-muted">
                              <span className="sr-only">
                                <FormattedMessage
                                  id="documents.descriptionPrefix"
                                  defaultMessage="Description:"
                                />{" "}
                              </span>
                              {document.description}
                            </span>
                          )}
                          {chain.current.note && (
                            <span className="text-sm text-muted">
                              <span className="sr-only">
                                <FormattedMessage
                                  id="documents.notePrefix"
                                  defaultMessage="Note:"
                                />{" "}
                              </span>
                              {chain.current.note}
                            </span>
                          )}
                        </span>
                      </span>
                    </td>
                    <KindCell version={chain.current} intl={intl} />
                    <VersionCell version={chain.current} intl={intl} />
                    <SizeCell version={chain.current} />
                    <ModifiedCell version={chain.current} />
                    <UploaderCell version={chain.current} intl={intl} />
                    {!frozen && (
                      <td className="px-4 py-2.5">
                        <span className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setComposer({ document })}
                            aria-label={intl.formatMessage(
                              {
                                id: "documents.addVersionFor",
                                defaultMessage: "Add a version to {title}",
                              },
                              { title: document.title },
                            )}
                          >
                            <FilePlus2 size={16} aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditing(document)}
                            aria-label={intl.formatMessage(
                              {
                                id: "documents.editDetailsFor",
                                defaultMessage: "Edit the details of {title}",
                              },
                              { title: document.title },
                            )}
                          >
                            <Pencil size={16} aria-hidden="true" />
                          </Button>
                        </span>
                      </td>
                    )}
                  </tr>
                  {isOpen &&
                    chain.superseded.map((version) => (
                      <tr key={version.id} className="border-t border-border-default">
                        <td className="px-4 py-2.5">
                          {/* Indented under the document it belongs to:
                              a superseded round is part of one chain,
                              not a document of its own. */}
                          <span className="flex items-start gap-1 ps-7">
                            <FileText
                              size={16}
                              aria-hidden="true"
                              className="mt-1 shrink-0 text-muted"
                            />
                            <span className="flex min-w-0 flex-col">
                              <a
                                href={documentDownloadHref(document.id, version.id)}
                                download={version.originalFilename}
                                className="rounded-chip text-primary hover:text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link"
                              >
                                {version.originalFilename}
                              </a>
                              {version.note && (
                                <span className="text-sm text-muted">
                                  <span className="sr-only">
                                    <FormattedMessage
                                      id="documents.notePrefix"
                                      defaultMessage="Note:"
                                    />{" "}
                                  </span>
                                  {version.note}
                                </span>
                              )}
                            </span>
                          </span>
                        </td>
                        <KindCell version={version} intl={intl} />
                        <VersionCell version={version} intl={intl} />
                        <SizeCell version={version} />
                        <ModifiedCell version={version} />
                        <UploaderCell version={version} intl={intl} />
                        {!frozen && <td className="px-4 py-2.5" />}
                      </tr>
                    ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
      {composer && (
        <UploadDialog
          contractNumber={contractNumber}
          document={composer.document}
          onClose={() => setComposer(null)}
          onSaved={(document) => {
            if (composer.document) replace(document);
            else prepend(document);
            setComposer(null);
          }}
        />
      )}
      {editing && (
        <DetailsDialog
          document={editing}
          onClose={() => setEditing(null)}
          onSaved={(document) => {
            replace(document);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function KindCell({ version, intl }: Readonly<{ version: DocumentVersion; intl: IntlShape }>) {
  return (
    <td className="px-4 py-2.5 align-top">
      <span
        className={`inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${KIND_PILL[version.kind]}`}
      >
        {kindLabel(intl, version.kind)}
      </span>
    </td>
  );
}

/** The version's number, and — on the one the chain pins — that it is
 * the file that matters now (DOC-001). The mark is the API's own, so the
 * section cannot disagree with the record about which one it is. */
function VersionCell({ version, intl }: Readonly<{ version: DocumentVersion; intl: IntlShape }>) {
  return (
    <td className="px-4 py-2.5 align-top">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-chip bg-badge-count-bg px-1.5 py-px text-xs font-medium text-badge-count-fg">
          {intl.formatMessage(
            { id: "documents.versionNumber", defaultMessage: "v{number}" },
            { number: version.versionNumber },
          )}
        </span>
        {version.isCurrent && (
          <span className="text-xs font-medium text-muted">
            <FormattedMessage id="documents.current" defaultMessage="Current" />
          </span>
        )}
      </span>
    </td>
  );
}

function SizeCell({ version }: Readonly<{ version: DocumentVersion }>) {
  return (
    <td className="px-4 py-2.5 align-top text-sm text-muted">{formatFileSize(version.byteSize)}</td>
  );
}

function ModifiedCell({ version }: Readonly<{ version: DocumentVersion }>) {
  return (
    <td className="px-4 py-2.5 align-top text-sm text-muted">
      {formatShortDate(version.createdAt)}
    </td>
  );
}

function UploaderCell({ version, intl }: Readonly<{ version: DocumentVersion; intl: IntlShape }>) {
  return (
    <td className="px-4 py-2.5 align-top">
      <span className="flex items-center justify-end">
        {/* The face is decorative (DES-018 draws it aria-hidden), so the
            name is here for a reader who cannot see it. */}
        <span className="sr-only">
          {intl.formatMessage(
            { id: "documents.uploadedBy", defaultMessage: "Uploaded by {name}" },
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
  );
}

/**
 * The composer: one file, what it is in the negotiation, and what
 * changed in this round.
 *
 * One dialog for both uploads, because the form is the same form. The
 * only difference is where it is sent — a contract that has no document
 * for this file yet, or a document that has a chain to append to — and
 * the seam assigns the number either way, so nothing here counts
 * versions.
 */
function UploadDialog({
  contractNumber,
  document,
  onClose,
  onSaved,
}: Readonly<{
  contractNumber: number;
  /** The document being added to, or undefined for a new one. */
  document: ContractDocument | undefined;
  onClose: () => void;
  onSaved: (document: ContractDocument) => void;
}>) {
  const intl = useIntl();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<DocumentVersionKind>("draft_ours");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The file input is the real control; the button beside it is what a
   * person sees, because a bare file input cannot be styled to the
   * system. */
  const picker = useRef<HTMLInputElement>(null);

  async function submit() {
    // One upload at a time. The CTA is disabled while one is in
    // flight, but a form has more than one way to submit itself, and a
    // second send would put the same file on the record twice — with
    // its own version number, which no correction can take back.
    if (busy) return;
    if (!file) {
      setError(
        intl.formatMessage({
          id: "documents.composer.fileRequired",
          defaultMessage: "Choose a file to upload.",
        }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    const draft: UploadDraft = { file, kind, note };
    const outcome = document
      ? await uploadDocumentVersion(document.id, draft)
      : await uploadContractDocument(contractNumber, draft);
    setBusy(false);
    if (outcome.ok) {
      onSaved(outcome.document);
      return;
    }
    setError(
      outcome.detail ??
        intl.formatMessage({
          id: "documents.uploadError",
          defaultMessage: "That file could not be uploaded. Try again.",
        }),
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {document ? (
            <FormattedMessage id="documents.composer.versionTitle" defaultMessage="Add version" />
          ) : (
            <FormattedMessage
              id="documents.composer.uploadTitle"
              defaultMessage="Upload document"
            />
          )}
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-file">
              <FormattedMessage id="documents.composer.file" defaultMessage="File" />
            </Label>
            <span className="flex items-center gap-2">
              <input
                ref={picker}
                id="document-file"
                type="file"
                className="sr-only"
                // Out of the tab order: the button beside it is the
                // control a keyboard reaches, and a second stop on an
                // invisible input is a trap rather than an affordance.
                tabIndex={-1}
                // Any file type (DOC-004): the seam accepts whatever the
                // counterparty sent, so the picker offers no filter.
                onChange={(event) => {
                  const chosen = event.target.files?.[0] ?? null;
                  if (chosen) setError(null);
                  setFile(chosen);
                }}
              />
              <Button type="button" variant="secondary" onClick={() => picker.current?.click()}>
                <FormattedMessage id="documents.composer.choose" defaultMessage="Choose file" />
              </Button>
              <span className="min-w-0 truncate text-sm text-muted">
                {file?.name ?? (
                  <FormattedMessage
                    id="documents.composer.noFile"
                    defaultMessage="No file chosen"
                  />
                )}
              </span>
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-kind">
              <FormattedMessage id="documents.composer.kind" defaultMessage="Kind" />
            </Label>
            <select
              id="document-kind"
              value={kind}
              className={CONTROL_CLASS}
              onChange={(event) => setKind(event.target.value as DocumentVersionKind)}
            >
              {DOCUMENT_VERSION_KINDS.map((option) => (
                <option key={option} value={option}>
                  {kindLabel(intl, option)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-note">
              <FormattedMessage id="documents.composer.note" defaultMessage="Note" />
            </Label>
            <textarea
              id="document-note"
              value={note}
              maxLength={MAX_NOTE_LENGTH}
              className={TEXTAREA_CLASS}
              placeholder={intl.formatMessage({
                id: "documents.composer.notePlaceholder",
                defaultMessage: "What changed in this round",
              })}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="documents.composer.submit" defaultMessage="Upload" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The metadata edit: what the record is called, and what it says about
 * itself (DOC-007).
 *
 * Both fields at once, with one confirm, because they are one small form
 * — the DES-017 dialog clause. The stored files are untouched by either:
 * a version keeps the filename it arrived under, and a download still
 * offers it back under that name.
 */
function DetailsDialog({
  document,
  onClose,
  onSaved,
}: Readonly<{
  document: ContractDocument;
  onClose: () => void;
  onSaved: (document: ContractDocument) => void;
}>) {
  const intl = useIntl();
  const [title, setTitle] = useState(document.title);
  const [description, setDescription] = useState(document.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    // One write at a time, for the composer's reason.
    if (busy) return;
    const named = title.trim();
    if (named.length === 0) {
      setError(
        intl.formatMessage({
          id: "documents.details.nameRequired",
          defaultMessage: "Give the document a name.",
        }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await updateDocument(document.id, {
      title: named,
      // Blank clears it: an empty box is "there is no description",
      // which the seam stores as nothing at all.
      description: description.trim() || null,
    });
    setBusy(false);
    if (outcome.ok) {
      onSaved(outcome.document);
      return;
    }
    setError(
      outcome.detail ??
        intl.formatMessage({
          id: "documents.details.error",
          defaultMessage: "Those details could not be saved. Try again.",
        }),
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="documents.details.title" defaultMessage="Edit details" />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-title">
              <FormattedMessage id="documents.details.name" defaultMessage="Name" />
            </Label>
            <Input
              id="document-title"
              value={title}
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value);
                if (event.target.value.trim().length > 0) setError(null);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-description">
              <FormattedMessage id="documents.details.description" defaultMessage="Description" />
            </Label>
            <textarea
              id="document-description"
              value={description}
              maxLength={MAX_DESCRIPTION_LENGTH}
              className={TEXTAREA_CLASS}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              <FormattedMessage id="documents.details.submit" defaultMessage="Save" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
