// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Documents section of the contract record (M11/2, M11/3, M11/4,
 * M11/5), drawn from the C4 mock's list: the section heading with a
 * count of what is on the record, the upload control beside it, and one
 * row per document — name, kind, version, size, when it landed, and who
 * put it there.
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
 * history (CTR-014).
 *
 * **Two designations are marked here, and each is one word** (CTR-014).
 * The document the record calls its instrument is marked Primary — the
 * mock's own caption, moved onto the row it is about, because a caption
 * over a list of six cannot say which one. The version the team pinned
 * as the signed copy is marked Executed, beside Current and in the same
 * quiet treatment: they are two answers to "what is this version to the
 * record", and a coloured pill there would argue with the kind pill in
 * the next column, which is a different fact with the same word on it.
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
 * **The two designations are one click each, and they report where the
 * section already reports.** Neither collects anything, so neither is a
 * form: naming the instrument is a control on the document's row, and
 * pinning the signed copy is a control on the version's own row —
 * including a superseded one, because the signed copy is often not the
 * last round. Each write says saving, then saved or why not, in the
 * header's own micro-state (DES-017).
 *
 * **Controls are split by what they are about, and the document's own
 * go in one overflow menu** (DES-025's pattern, for its reason). The pin
 * is a fact about a version, so it stays inline on the version's own
 * row. Everything else — the instrument, the next round, the details,
 * and DOC-010's two removals — is about the document, and six unlabelled
 * glyphs on a 13px row have nowhere to sit and no way to tell an archive
 * from an erasure. The menu is the shipped DropdownMenu on a `ghost`
 * `icon` Button, offering what this viewer may do and nothing else —
 * absent, not disabled, the convention the comment row already follows.
 *
 * **Archiving is one click and erasing is not** (DOC-010). Archive
 * destroys nothing, so it takes no confirmation: the row leaves the list
 * and the count, and Restore in the archived view is the two-second way
 * back. The Administrator's hard delete takes a typed confirmation —
 * the document's own name, typed out — because it removes the record,
 * every round of the chain, and every stored file, and nothing puts
 * those back.
 *
 * **A confidential document is marked, never placeheld** (DD-014,
 * M11/6). The DES-009 Tier 1 marker rides beside the name of a document
 * whose flag is set, so a reader who is inside its audience can see
 * which file is narrowed. A reader who is outside it gets no row here at
 * all, because the API answered them none — the section draws what it is
 * given and has no "hidden" state to draw, which is what makes the
 * omission silent rather than announced.
 *
 * Writing is Member+ (DD-015): a Contributor reads the section and
 * downloads from it, and is offered no control. An archived record is
 * read the same way, because archiving freezes the record. Erasing is
 * the Administrator's alone, so the Delete item is drawn for nobody
 * else. Deciding one document's audience is a fourth actor set again —
 * an Administrator, the person who uploaded it, and the contract's Owner
 * (CTR-022) — so that item is drawn for those three and nobody else.
 */

import { useRef, useState } from "react";
import { defineMessage, FormattedMessage, useIntl, type IntlShape } from "react-intl";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Lock,
  MoreHorizontal,
  Pencil,
  Pin,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { Avatar } from "../avatar";
import { ConfidentialMarker } from "../confidential-marker";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { StatusNote, type FieldStatus } from "../status-note";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "../../lib/form-controls";
import { formatFileSize, formatShortDate } from "../../lib/format";
import type { Role } from "../../lib/roles";
import {
  archiveDocument,
  chainOf,
  clearExecutedVersion,
  documentDownloadHref,
  DOCUMENT_VERSION_KINDS,
  hardDeleteDocument,
  readContractDocuments,
  restoreDocument,
  setExecutedVersion,
  setPrimaryDocument,
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
  role,
  viewerId,
  ownerId,
  onDocuments,
}: Readonly<{
  /** CTR-003's reference — the address the upload route takes. */
  contractNumber: number;
  documents: readonly ContractDocument[];
  /** The record is frozen: it is archived, or this viewer reads it
   * rather than edits it. Either way it renders as facts. */
  frozen: boolean;
  /** The viewer's role. It answers one question the section cannot ask
   * of the rows: whether to draw DOC-010's erasure, which is the
   * Administrator's alone. */
  role: Role;
  /** Who is reading. The Confidential flag's actor set is a fact about
   * this person and this document (CTR-022), so the section needs to
   * know which person it is drawing for. */
  viewerId: string;
  /** The contract's Owner (CTR-004), or none. The record holds it, so
   * it is passed down rather than read again per row. */
  ownerId: string | null;
  onDocuments: (documents: ContractDocument[]) => void;
}>) {
  const intl = useIntl();
  const [status, setStatus] = useState<FieldStatus>("idle");
  /** The seam's own refusal, when it sent one, so the section says what
   * the server said rather than a generic line over the top of it. */
  const [detail, setDetail] = useState<string | null>(null);
  /** A designation write is in flight. One at a time: both of them
   * answer with rows this list is replaced from, so a second click
   * landing first would leave the section drawing the older answer. */
  const [busy, setBusy] = useState(false);
  /** Which documents have their earlier rounds open. Collapsed by
   * default: the section answers "which file matters now" first, and the
   * history is one click away rather than in the way. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const [composer, setComposer] = useState<Composer | null>(null);
  const [editing, setEditing] = useState<ContractDocument | null>(null);
  /** Whether the archived rows are drawn beside the live ones — the
   * view restoring one is offered in (DOC-010), as the contracts list
   * and the entity registry already do it. */
  const [showArchived, setShowArchived] = useState(false);
  /** The document a typed confirmation is open for, or none. */
  const [deleting, setDeleting] = useState<ContractDocument | null>(null);

  /** Erasing is the Administrator's alone (DOC-010), so nobody else is
   * shown the item. The seam refuses everyone else regardless; this is
   * what keeps a control from offering a dead end. */
  const canErase = role === "administrator";

  /**
   * Whether this viewer may decide who sees one document (DD-014,
   * CTR-022). Three actors: an Administrator, the person who uploaded
   * it, and the contract's Owner.
   *
   * It says exactly what the seam says, out of facts the record already
   * answered — the uploader is on the row, and the Owner is on the
   * contract. Reach is not asked again, because being drawn this row is
   * what proves it. The API refuses anybody else with a plain 403; this
   * is only what keeps a control from offering a dead end.
   */
  const canFlag = (document: ContractDocument) =>
    role === "administrator" || document.createdBy.id === viewerId || ownerId === viewerId;

  /** How much paper is on the record. Archived rows never count,
   * whichever view is showing: being off the count is what archiving
   * means. */
  const liveCount = documents.filter((row) => row.archivedAt === null).length;

  /** A document that just changed, put back where it was. The list order
   * is the API's (newest document first), and adding a version to an
   * older document does not move it. */
  function replace(document: ContractDocument) {
    onDocuments(documents.map((row) => (row.id === document.id ? document : row)));
    setDetail(null);
    setStatus("saved");
  }

  function prepend(document: ContractDocument) {
    // Newest first, as the list is ordered: the new document goes on
    // top without a re-read.
    onDocuments([document, ...documents]);
    setDetail(null);
    setStatus("saved");
  }

  /**
   * The record's whole paper, as the seam just answered it.
   *
   * The seam answers the live list. In the archived view that is not the
   * list on screen, so it is re-read in the view being shown rather than
   * half-replaced — the alternative is the section quietly dropping the
   * archived rows the moment anything else is written.
   */
  async function applyPaper(paper: ContractDocument[]) {
    if (!showArchived) {
      onDocuments(paper);
      return;
    }
    const outcome = await readContractDocuments(contractNumber, true);
    onDocuments(outcome.ok ? outcome.documents : paper);
  }

  /** The show-archived toggle. It re-reads either way: the archived rows
   * only exist server-side, and coming back should not trust a stale
   * list either. */
  async function toggleArchived(next: boolean) {
    if (busy) return;
    setBusy(true);
    setStatus("saving");
    setDetail(null);
    const outcome = await readContractDocuments(contractNumber, next);
    setBusy(false);
    if (!outcome.ok) {
      setStatus("error");
      setDetail(outcome.detail ?? null);
      return;
    }
    onDocuments(outcome.documents);
    setShowArchived(next);
    setStatus("idle");
  }

  /**
   * Names a document the contract's instrument (CTR-014).
   *
   * The whole list comes back and the whole list is replaced: the
   * designation moving changes two rows, and re-deriving the second one
   * here would be the section disagreeing with the record the moment
   * anything else changed.
   */
  async function makePrimary(document: ContractDocument) {
    if (busy) return;
    setBusy(true);
    setStatus("saving");
    setDetail(null);
    const outcome = await setPrimaryDocument(document.id);
    if (outcome.ok) await applyPaper(outcome.documents);
    setBusy(false);
    if (outcome.ok) {
      setStatus("saved");
      return;
    }
    setStatus("error");
    setDetail(outcome.detail ?? null);
  }

  /**
   * DOC-010's soft delete, and its undo.
   *
   * Archiving takes no confirmation, because it destroys nothing: the
   * row leaves the list and the count, and Restore in the archived view
   * is the way back. In the live view the archived row simply goes; in
   * the archived view it stays where it is and takes its mark.
   */
  async function setArchived(document: ContractDocument, next: boolean) {
    if (busy) return;
    setBusy(true);
    setStatus("saving");
    setDetail(null);
    const outcome = next ? await archiveDocument(document.id) : await restoreDocument(document.id);
    setBusy(false);
    if (!outcome.ok) {
      setStatus("error");
      setDetail(outcome.detail ?? null);
      return;
    }
    if (next && !showArchived) {
      onDocuments(documents.filter((row) => row.id !== document.id));
      setDetail(null);
      setStatus("saved");
      return;
    }
    replace(outcome.document);
  }

  /**
   * DD-014's per-document flag, set and cleared.
   *
   * It narrows one file to the contract's named team, its Owner, and
   * Administrators, even on a record everybody can open. Clearing it
   * puts the file back where the contract's own audience is.
   *
   * **Setting it can put the file outside the setter's own audience.**
   * An Administrator and the record's Owner always stay inside it; a
   * Legal Team Member who uploaded a file to a contract they hold no
   * team row on does not, because uploading grants nothing (DOC-008).
   * The seam answers their own write with the row, so the section keeps
   * drawing it until the page is loaded again — a successful write that
   * made the row disappear under the person who made it would read as a
   * failure. On the next load it is simply not in the list.
   */
  async function setConfidential(document: ContractDocument, next: boolean) {
    if (busy) return;
    setBusy(true);
    setStatus("saving");
    setDetail(null);
    const outcome = await updateDocument(document.id, { isConfidential: next });
    setBusy(false);
    if (!outcome.ok) {
      setStatus("error");
      setDetail(outcome.detail ?? null);
      return;
    }
    replace(outcome.document);
  }

  /**
   * DOC-010's hard delete: the document, its whole chain, and every
   * stored file behind it.
   *
   * The typed name goes to the seam rather than being checked only here.
   * The dialog can be skipped, and the seam is where the ceremony has to
   * hold — this is the client half of one rule, not the rule itself.
   *
   * A refusal is handed back to the dialog rather than written to the
   * section note, because the dialog covers the spot that note reads in.
   * The refusal is reachable: a rename that lands between the dialog
   * opening and Delete arriving makes the typed name the wrong one, and
   * a role taken away in the same window answers 403. Success keeps the
   * note — by then the dialog is gone and the note is what is left.
   */
  async function erase(document: ContractDocument, confirmTitle: string): Promise<string | null> {
    if (busy) return null;
    setBusy(true);
    setStatus("saving");
    setDetail(null);
    const outcome = await hardDeleteDocument(document.id, confirmTitle);
    if (outcome.ok) await applyPaper(outcome.documents);
    setBusy(false);
    if (outcome.ok) {
      setDeleting(null);
      setStatus("saved");
      return null;
    }
    // Back to idle, not to error: the dialog says what happened, and a
    // note behind it would say it again to whoever closes the dialog.
    setStatus("idle");
    return (
      outcome.detail ??
      intl.formatMessage({
        id: "documents.delete.error",
        defaultMessage: "That document could not be deleted. Try again.",
      })
    );
  }

  /**
   * Pins one version as the signed copy, or takes the pin off it
   * (CTR-014).
   *
   * One control for both, because the pin is one fact with two states.
   * Which way it goes is read off the version the button is on, never
   * off the version's kind — a round tagged Executed is what its
   * uploader called it, and the pin is what the team decided.
   */
  async function togglePin(document: ContractDocument, version: DocumentVersion) {
    if (busy) return;
    setBusy(true);
    setStatus("saving");
    setDetail(null);
    const outcome = version.isExecuted
      ? await clearExecutedVersion(document.id)
      : await setExecutedVersion(document.id, version.id);
    setBusy(false);
    if (outcome.ok) {
      replace(outcome.document);
      return;
    }
    setStatus("error");
    setDetail(outcome.detail ?? null);
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
              here can never announce what was left out — minus whatever
              is archived, because being off the count is what archiving
              a document means (DOC-010).

              The badge draws a bare number and says a whole phrase, the
              same split the confidential marker takes: on screen the
              heading beside it supplies the noun, and to a screen reader
              a lone "3" after a heading says nothing. `role="img"` is
              what lets the name replace the digits rather than sit
              beside them. */}
          <span
            role="img"
            aria-label={intl.formatMessage(
              {
                id: "documents.countLabel",
                defaultMessage: "{count, plural, one {# document} other {# documents}}",
              },
              { count: liveCount },
            )}
            className="rounded-chip bg-badge-count-bg px-1.5 py-px text-xs font-medium text-badge-count-fg"
          >
            {intl.formatNumber(liveCount)}
          </span>
        </div>
        {!frozen && (
          <div className="flex shrink-0 items-center gap-2">
            <StatusNote status={status} detail={detail} />
            {/* The archived view, where restoring one is offered — the
                same control the contracts list and the entity registry
                already carry, in the same words. */}
            <Label htmlFor="documents-show-archived" className="text-sm font-normal text-muted">
              <FormattedMessage id="documents.showArchived" defaultMessage="Show archived" />
            </Label>
            <Switch
              id="documents-show-archived"
              checked={showArchived}
              disabled={busy}
              onCheckedChange={(next) => void toggleArchived(next)}
            />
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
                  <th scope="col" className="w-24 px-4 py-2 text-end font-medium">
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
                          <span className="flex flex-wrap items-center gap-1.5">
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
                            {/* DES-009 Tier 1, beside a document's name
                                rather than a record's: this file is
                                narrowed to the contract's named team
                                (DD-014). It is a mark on a row the
                                reader can already see — a reader
                                outside the audience is sent no row, so
                                nothing here is ever a placeholder. */}
                            {document.isConfidential && <ConfidentialMarker />}
                            {/* The instrument the contract is (CTR-014).
                                Marked on the row rather than in a caption
                                over the list, because a caption cannot say
                                which of six documents it means. The quiet
                                chip is the count badge's own pair: a
                                designation is a structural fact, not a
                                status. */}
                            {document.isPrimary && (
                              <span className="rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
                                <FormattedMessage id="documents.primary" defaultMessage="Primary" />
                              </span>
                            )}
                            {/* Off the list and out of the count
                                (DOC-010), drawn only in the archived
                                view — the same pill the contracts list
                                marks an archived record with, because
                                it is the same fact one level down. */}
                            {document.archivedAt !== null && (
                              <span className="rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
                                <FormattedMessage
                                  id="documents.archivedPill"
                                  defaultMessage="Archived"
                                />
                              </span>
                            )}
                          </span>
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
                          {/* The pin is a fact about a version, so it
                              stays on the version's own row. An archived
                              document takes no pin — the seam refuses
                              it — so the control is absent there rather
                              than dead. */}
                          {document.archivedAt === null && (
                            <PinButton
                              document={document}
                              version={chain.current}
                              busy={busy}
                              intl={intl}
                              onToggle={togglePin}
                            />
                          )}
                          <DocumentActions
                            document={document}
                            busy={busy}
                            canErase={canErase}
                            canFlag={canFlag(document)}
                            intl={intl}
                            onMakePrimary={() => void makePrimary(document)}
                            onAddVersion={() => setComposer({ document })}
                            onEditDetails={() => setEditing(document)}
                            onSetConfidential={(next) => void setConfidential(document, next)}
                            onArchive={() => void setArchived(document, true)}
                            onRestore={() => void setArchived(document, false)}
                            onDelete={() => setDeleting(document)}
                          />
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
                        {!frozen && (
                          <td className="px-4 py-2.5">
                            {/* A superseded round takes the pin as
                                readily as the current one: a contract
                                signed in round two and amended in round
                                three has its signed copy behind its
                                head. An archived document takes none,
                                for the reason its own row gives. */}
                            <span className="flex items-center justify-end gap-1">
                              {document.archivedAt === null && (
                                <PinButton
                                  document={document}
                                  version={version}
                                  busy={busy}
                                  intl={intl}
                                  onToggle={togglePin}
                                />
                              )}
                            </span>
                          </td>
                        )}
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
      {deleting && (
        <DeleteDialog
          document={deleting}
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={(confirmTitle) => erase(deleting, confirmTitle)}
        />
      )}
    </section>
  );
}

/** What each menu item says, in the words DES-015 asks for: a verb, in
 * sentence case, and no phrase where a word will do. */
const ACTION_LABEL = {
  makePrimary: defineMessage({
    id: "documents.action.makePrimary",
    defaultMessage: "Make primary",
  }),
  addVersion: defineMessage({ id: "documents.action.addVersion", defaultMessage: "Add version" }),
  editDetails: defineMessage({
    id: "documents.action.editDetails",
    defaultMessage: "Edit details",
  }),
  markConfidential: defineMessage({
    id: "documents.action.markConfidential",
    defaultMessage: "Mark confidential",
  }),
  clearConfidential: defineMessage({
    id: "documents.action.clearConfidential",
    defaultMessage: "Clear confidential mark",
  }),
  archive: defineMessage({ id: "documents.action.archive", defaultMessage: "Archive" }),
  restore: defineMessage({ id: "documents.action.restore", defaultMessage: "Restore" }),
  delete: defineMessage({ id: "documents.action.delete", defaultMessage: "Delete" }),
} as const;

/**
 * Everything a viewer may do to one document, in one overflow menu
 * (DES-025's pattern).
 *
 * Six unlabelled glyphs will not fit a 13px row, and two of them would
 * be an archive and an erasure sitting side by side — the one pair on
 * this page where a misread is unrecoverable. The menu gives each act a
 * verb.
 *
 * It offers what this viewer may do and nothing else: absent, not
 * disabled. An archived document is offered its way back and its
 * erasure, and nothing else — every other write on it is refused by the
 * seam until it is restored, so a control for one would be a dead end.
 */
function DocumentActions({
  document,
  busy,
  canErase,
  canFlag,
  intl,
  onMakePrimary,
  onAddVersion,
  onEditDetails,
  onSetConfidential,
  onArchive,
  onRestore,
  onDelete,
}: Readonly<{
  document: ContractDocument;
  busy: boolean;
  canErase: boolean;
  /** Whether this viewer is one of DD-014's three actors for this
   * document. The item is absent for everybody else, not disabled. */
  canFlag: boolean;
  intl: IntlShape;
  onMakePrimary: () => void;
  onAddVersion: () => void;
  onEditDetails: () => void;
  onSetConfidential: (confidential: boolean) => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}>) {
  const archived = document.archivedAt !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={intl.formatMessage(
            { id: "documents.actionsFor", defaultMessage: "Actions for {title}" },
            { title: document.title },
          )}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!archived && (
          <>
            {/* Absent on the row that already holds the designation —
                the Primary mark beside the name is what says why. There
                is no clear: a record with paper on it has an
                instrument, so the designation moves or it stays. */}
            {!document.isPrimary && (
              <DropdownMenuItem onSelect={onMakePrimary}>
                <Star size={16} aria-hidden="true" />
                <FormattedMessage {...ACTION_LABEL.makePrimary} />
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onAddVersion}>
              <FilePlus2 size={16} aria-hidden="true" />
              <FormattedMessage {...ACTION_LABEL.addVersion} />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEditDetails}>
              <Pencil size={16} aria-hidden="true" />
              <FormattedMessage {...ACTION_LABEL.editDetails} />
            </DropdownMenuItem>
            {/* DD-014's flag, one item that says which way it goes
                (CTR-022). One glyph for confidentiality everywhere, as
                DES-009 asks: the words are what tell the set from the
                clear. It is drawn for the three actors and for nobody
                else — absent, not disabled, as every other item here. */}
            {canFlag && (
              <DropdownMenuItem onSelect={() => onSetConfidential(!document.isConfidential)}>
                <Lock size={16} aria-hidden="true" />
                <FormattedMessage
                  {...(document.isConfidential
                    ? ACTION_LABEL.clearConfidential
                    : ACTION_LABEL.markConfidential)}
                />
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onArchive}>
              <Archive size={16} aria-hidden="true" />
              <FormattedMessage {...ACTION_LABEL.archive} />
            </DropdownMenuItem>
          </>
        )}
        {archived && (
          <DropdownMenuItem onSelect={onRestore}>
            <ArchiveRestore size={16} aria-hidden="true" />
            <FormattedMessage {...ACTION_LABEL.restore} />
          </DropdownMenuItem>
        )}
        {canErase && (
          <DropdownMenuItem onSelect={onDelete}>
            <Trash2 size={16} aria-hidden="true" />
            <FormattedMessage {...ACTION_LABEL.delete} />
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * DOC-010's typed confirmation: the Administrator types the name of what
 * they are destroying.
 *
 * Proportionate to what it takes. Archiving is one click, because it
 * destroys nothing; this removes the record, every round of the chain,
 * and every stored file, and there is no undo — so the dialog names the
 * consequence before the verb and asks for the document's own name, in
 * full, before the button will do anything (DES-025's normalization
 * point 2 names this as the pattern DOC-010 asks for).
 *
 * The typed value is sent to the seam rather than only checked here: the
 * dialog can be skipped, and the seam is where the rule has to hold.
 */
function DeleteDialog({
  document,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  document: ContractDocument;
  busy: boolean;
  onClose: () => void;
  /** Answers with the refusal to show, or `null` when the erasure landed. */
  onConfirm: (confirmTitle: string) => Promise<string | null>;
}>) {
  const intl = useIntl();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === document.title.trim();

  async function submit() {
    if (busy || !matches) return;
    setError(null);
    setError(await onConfirm(typed.trim()));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage id="documents.delete.title" defaultMessage="Delete this document?" />
        </DialogTitle>
        <p className="mt-4 text-base text-primary">
          <FormattedMessage
            id="documents.delete.body"
            defaultMessage={
              "{title} and its {count, plural, one {# version} other {# versions}} " +
              "are removed, and the stored files with them. You cannot undo this."
            }
            values={{ title: document.title, count: document.versions.length }}
          />
        </p>
        <form
          className="mt-4 flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor="document-delete-confirm">
            <FormattedMessage
              id="documents.delete.confirmLabel"
              defaultMessage="Type {title} to confirm"
              values={{ title: document.title }}
            />
          </Label>
          <Input
            id="document-delete-confirm"
            value={typed}
            // The viewer opened this dialog to type one thing, so the
            // caret belongs in the box they opened it for. This is a
            // mount inside a click handler, not a page load.
            autoFocus
            autoComplete="off"
            // The filename's ceiling, not the rename field's: a title
            // seeded from a long filename can run past 200, and the box
            // has to be able to hold every name a document can carry —
            // a shorter cap would leave this button disabled forever.
            maxLength={255}
            onChange={(event) => {
              setTyped(event.target.value);
              setError(null);
            }}
          />
          {error && (
            <p role="alert" className="mt-2.5 text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button
              type="submit"
              variant="danger"
              // Disabled rather than absent, unlike every other control
              // in this section: the button is the thing the typing is
              // for, and taking it away would leave the box with nothing
              // to explain it.
              disabled={busy || !matches}
              aria-label={intl.formatMessage(
                { id: "documents.delete.confirmAction", defaultMessage: "Delete {title}" },
                { title: document.title },
              )}
            >
              <FormattedMessage {...ACTION_LABEL.delete} />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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

/**
 * The version's number, and what the record calls this round: the file
 * that matters now (DOC-001), the signed copy (CTR-014), or both, or
 * neither.
 *
 * Both marks are the API's own, so the section cannot disagree with the
 * record about which version is which. They wear the same quiet
 * treatment because they answer the same kind of question — and because
 * a coloured Executed here would argue with the Executed *kind* pill in
 * the next column, which is a different fact wearing the same word.
 */
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
        {version.isExecuted && (
          <span className="text-xs font-medium text-muted">
            <FormattedMessage id="documents.executed" defaultMessage="Executed" />
          </span>
        )}
      </span>
    </td>
  );
}

/**
 * The executed pin, as one control (CTR-014).
 *
 * One glyph for both directions, for DES-009's reason on the
 * confidentiality mark: an alternate glyph for the clear would be a
 * second icon for one concept.
 *
 * A toggle, named for what it toggles and never for what the next click
 * does. `aria-pressed` is what carries the state, so a reader hears
 * "Pin version 2 of … as the executed copy, pressed" — a name that also
 * changed would announce the state twice, in two different words.
 */
function PinButton({
  document,
  version,
  busy,
  intl,
  onToggle,
}: Readonly<{
  document: ContractDocument;
  version: DocumentVersion;
  busy: boolean;
  intl: IntlShape;
  onToggle: (document: ContractDocument, version: DocumentVersion) => Promise<void>;
}>) {
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={busy}
      aria-pressed={version.isExecuted}
      onClick={() => void onToggle(document, version)}
      aria-label={intl.formatMessage(
        {
          id: "documents.pinExecuted",
          defaultMessage: "Pin version {number} of {title} as the executed copy",
        },
        { number: version.versionNumber, title: document.title },
      )}
    >
      <Pin size={16} aria-hidden="true" />
    </Button>
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
            <Label id="document-file-label" htmlFor="document-file">
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
              {/* The label points at the input, but the input is out of
                  the tab order — this button is the control a keyboard
                  reaches, so it has to carry the field's name itself, or
                  the dialog opens on "Choose file, button" with nothing
                  saying which field it fills. The refusal below is about
                  this field too, so the button describes itself with it
                  rather than leaving it to be found by sight. */}
              <Button
                type="button"
                variant="secondary"
                id="document-file-choose"
                aria-labelledby="document-file-label document-file-choose"
                aria-describedby={error ? "document-upload-error" : undefined}
                onClick={() => picker.current?.click()}
              >
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
            <p id="document-upload-error" role="alert" className="text-xs text-status-danger-fg">
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
