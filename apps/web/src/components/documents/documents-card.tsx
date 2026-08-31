// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Documents section of the contract record (M11/2, M11/3, M11/4,
 * M11/5), drawn from the C4 mock's list: the section heading with a
 * count of what is on the record, the upload control beside it, and one
 * row per document — name, kind, version, when it landed, and who put
 * it there. The mock's own Size column is dropped (2026-08-18): a
 * legal team reads a contract's paper by what it is and when it moved,
 * never by how many bytes it takes on disk.
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
 * **The name is the open, and what opening means depends on the file**
 * (M12/2, DOC-004). A PDF or an image opens in the doc panel — the
 * wider sibling layer DES-016 places beside the record — and everything
 * else is still a plain download link to the version's own address, so
 * the browser saves it the way it saves any other file: no client-side
 * blob juggling, no presigned URL, and the session cookie rides the
 * navigation on its own. Every round in the chain opens the same way,
 * superseded ones included. The panel itself is mounted by the record,
 * not by this section: it is a layer beside the record body, and this
 * is the record body.
 *
 * **Two dialogs, because two of these edits are forms.** An upload
 * collects the file, the kind, and the note together, and a metadata
 * edit collects the name and the description together, so both go
 * through a purpose-built dialog with its own confirm rather than
 * committing per keystroke (DES-017). Renaming is offered in the dialog
 * rather than in place on the name cell, because on this surface the
 * name is what opens the file.
 *
 * **The two designations report where the section already reports.**
 * Neither collects anything, so neither is a form: each write says
 * saving, then saved or why not, in the header's own micro-state
 * (DES-017).
 *
 * **Both designations sit in an overflow menu on the version's own
 * row** (DES-025's pattern, for its reason). Naming the instrument is a
 * document-level menu item, on the current-version row; pinning the
 * signed copy is a menu item too, on whichever row it applies to —
 * including a superseded one, because the signed copy is often not the
 * last round. A superseded round has no document-level act, so it gets
 * a one-item menu of its own (`VersionPinMenu`) rather than borrowing
 * the current row's `DocumentActions`, which speaks for the document,
 * not for that round. Six unlabelled glyphs on a 13px row would have
 * nowhere to sit and no way to tell an archive from an erasure, so
 * everything about the document — the instrument, the next round, the
 * details, and DOC-010's two removals — lives in the one menu with it.
 * The menu is the shipped DropdownMenu on a `ghost` `icon` Button,
 * offering what this viewer may do and nothing else — absent, not
 * disabled, the convention the comment row already follows.
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
 * **Folders are rows of this table, not a second surface** (M13/2,
 * DES-033). A folder's anatomy lives in the Name cell — an indent spacer
 * of 18px per level, the disclosure chevron, the folder glyph, the name,
 * then how much is filed in it — and Kind, Version, Size and Modified
 * are empty on it, because a folder has none of them and an em dash in
 * each would be four pieces of nothing. Folders sort before documents
 * and siblings sort by name without case, which is how a file manager
 * lists a directory. The whole tree is drawn from one read of the
 * record's folder set.
 *
 * **The section draws several listings, not one list** (M13/3). The
 * record root holds the documents filed in no folder; each folder's own
 * documents are read when it is opened, through the same list route
 * filtered to it, and DES-031's paging foot then applies inside that
 * folder rather than across the record. A filed document is the same row
 * as an unfiled one — it opens, previews, takes a version, and is erased
 * identically — so both are drawn by one component and the only
 * difference between them is how far in they sit.
 *
 * **Every folder takes a chevron, and its count is the viewer's**
 * (DD-014, DES-033). A folder whose count reads "Empty" may be a folder
 * whose contents this viewer cannot see: the seam leaves those documents
 * out of the listing and out of the count together, by the one predicate
 * every document read passes through. So nothing here tells the two
 * apart — no hidden-item hint, no different empty line, and no chevron
 * drawn only on the folders that hold something.
 *
 * **Dissolving a folder destroys nothing** (DOC-006). Its child folders
 * and the documents filed in it are re-filed into its parent, or into
 * the record root when it had none, so the confirmation says where the
 * contents go rather than asking for a typed name: the ceremony
 * DOC-010's erasure earns is out of proportion to a grouping that can be
 * made again.
 *
 * Writing is Member+ (DD-015): a Contributor reads the section and
 * downloads from it, and is offered no control. An archived record is
 * read the same way, because archiving freezes the record. Erasing is
 * the Administrator's alone, so the Delete item is drawn for nobody
 * else. Deciding one document's audience is a fourth actor set again —
 * an Administrator, the person who uploaded it, and the contract's Owner
 * (CTR-022) — so that item is drawn for those three and nobody else.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRecord } from "../record-context";
import { defineMessage, FormattedMessage, useIntl, type IntlShape } from "react-intl";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Lock,
  MoreHorizontal,
  Pencil,
  Pin,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { Avatar } from "../avatar";
import { BatchDialog, type BatchDestination, type BatchSource } from "./batch-dialog";
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
import { cn } from "../../lib/utils";
import { formatShortDate } from "../../lib/format";
import {
  dragCarriesFiles,
  filesFromDirectoryPicker,
  filesFromDrop,
  type DroppedFile,
} from "../../lib/batch-upload";
import {
  archiveDocument,
  chainOf,
  clearExecutedVersion,
  documentDownloadHref,
  documentKindLabel,
  DOCUMENT_KIND_PILL,
  DOCUMENT_VERSION_KINDS,
  FOLDER_ROOT,
  hardDeleteDocument,
  isPreviewable,
  readRecordDocuments,
  restoreDocument,
  setExecutedVersion,
  setPrimaryDocument,
  updateDocument,
  updateDocumentVersionKind,
  uploadRecordDocument,
  uploadDocumentVersion,
  type ContractDocument,
  type DocumentVersion,
  type DocumentRecord,
  type HandSetDocumentVersionKind,
  type UploadDraft,
} from "../../lib/documents";
import {
  childrenOf,
  createRecordFolder,
  deleteContractFolder,
  movableInto,
  pathOf,
  readRecordFolders,
  updateContractFolder,
  type ContractFolder,
  type FoldersOutcome,
} from "../../lib/folders";

/** What the note field holds, matching the seam's own ceiling — which
 * refuses a longer one rather than shortening it. */
const MAX_NOTE_LENGTH = 2000;

/** What the description holds, for the note's reason: the seam refuses
 * a longer one, so the control stops the writer at the same line. */
const MAX_DESCRIPTION_LENGTH = 10_000;

/** What a folder name holds, matching the seam's own ceiling — the
 * filesystem's, because a folder is made from a directory name as often
 * as it is typed (DOC-011). */
const MAX_FOLDER_NAME_LENGTH = 255;

/** How far one level of the tree sits in from the one above it, in
 * pixels (DES-033). Drawn as a spacer at the head of the Name cell, so
 * one rule serves both row kinds and nothing is positioned by eye. */
const FOLDER_INDENT = 18;

/**
 * The kind, as the C4 mock colors it: our own work reads as the calm
 * informational pair, their paper as the one that wants attention, a
 * signed copy as settled, and an amendment as a plain fact. Paired
 * bg+fg from one family per DES-005 — never mixed across families.
 *
 * **The color says whose paper it is; the label says what the round
 * is.** So `draft_theirs` takes the same amber as `redline_theirs`
 * (#326) rather than a sixth family. The two axes are already split
 * this way — `draft_ours` and `redline_ours` share the informational
 * pair for exactly the same reason — and giving the sixth kind its own
 * color would make the column encode two facts at once, leaving the
 * reader to work out which one a color meant. The palette also has no
 * spare family that would not misread: `assigned` is within a shade of
 * the confidentiality marker (DES-009) on the light theme, `neutral` is
 * the amendment's, and the two red families would call a routine round
 * a problem.
 */

/**
 * What a composer is opened for: the record's first file on a document
 * that does not exist yet, or the next round on one that does.
 *
 * `kind` is what the round is seeded as, and it is only ever set by a
 * renewal routed here to be papered as an amendment (M16/5). Everything
 * else opens the composer on its own default, and the person picks — a
 * seeded kind is a statement about why the composer was opened, not a
 * property of the document it was opened on.
 */
type Composer = ({ document: ContractDocument } | { document: undefined }) & {
  kind?: HandSetDocumentVersionKind;
};

/** What the folder dialog is open for. Creating and renaming collect one
 * name and are one form; moving collects a destination; deleting
 * confirms. */
type FolderDialog =
  | { mode: "create"; parent: ContractFolder | null }
  | { mode: "rename"; folder: ContractFolder }
  | { mode: "move"; folder: ContractFolder }
  | { mode: "delete"; folder: ContractFolder };

/**
 * One folder's documents, as the section holds them once the folder has
 * been opened (M13/3, DES-033).
 *
 * A listing of its own rather than a slice of the record's paper,
 * because it is read on its own: opening a folder asks the list route
 * for that folder, and DES-031's paging foot then applies inside it. A
 * heavy folder pages without touching the rows around it.
 */
interface FolderListing {
  documents: ContractDocument[];
  /** Where the next page of *this* folder starts, or null at its end. */
  nextCursor: string | null;
  /** A read is in flight. The first one draws skeleton rows at the
   * opened folder's depth, so the tree around them stays readable while
   * they arrive (DES-033). */
  loading: boolean;
  /** Why the last read failed, said on the folder's own rows. The
   * control that failed stays, so the retry is under the reader's
   * hand. */
  error: string | null;
}

/** How many skeleton rows a folder draws while its documents arrive.
 * Three, as C25 draws them: enough to read as a list, few enough not to
 * promise a length nobody knows yet. */
const FOLDER_SKELETON_ROWS = 3;

/**
 * Everything one document row needs that is the same for every row on
 * the section.
 *
 * One object rather than fifteen props, because a document row is drawn
 * at the record root **and** inside every open folder, and threading the
 * same fifteen through two call sites is how the two come to differ.
 */
interface RowContext {
  designations: boolean;
  executedDesignations: boolean;
  folders: boolean;
  setPrimaryCopy: boolean;
  frozen: boolean;
  /** The narrow live-record write mode DD-015 grants a Contributor. */
  supportingUploads: boolean;
  /** Whether this section draws an Actions column at all. */
  showActionColumn: boolean;
  busy: boolean;
  intl: IntlShape;
  reading: string | null;
  /** Whether DOC-010's erasure is drawn at all — the Administrator's
   * alone. */
  canErase: boolean;
  /** Whether this viewer is one of DD-014's three actors for one
   * document (CTR-022). */
  canFlag: (document: ContractDocument) => boolean;
  /** Which documents have their earlier rounds open. */
  opened: ReadonlySet<string>;
  /** What the last "Show more" brought, wherever it was pressed. Only
   * one row is ever the landing row, so one ref serves every listing. */
  appended: { count: number; from: string } | null;
  landing: RefObject<HTMLTableRowElement | null>;
  onToggle: (documentId: string) => void;
  onRead: (
    document: ContractDocument,
    version: DocumentVersion,
    trigger: HTMLElement | null,
  ) => void;
  onPin: (document: ContractDocument, version: DocumentVersion) => void;
  onKindChange: (
    document: ContractDocument,
    version: DocumentVersion,
    kind: HandSetDocumentVersionKind,
  ) => void;
  onMakePrimary: (document: ContractDocument) => void;
  onAddVersion: (document: ContractDocument) => void;
  onEditDetails: (document: ContractDocument) => void;
  onMoveToFolder: (document: ContractDocument) => void;
  onSetConfidential: (document: ContractDocument, confidential: boolean) => void;
  onArchive: (document: ContractDocument, archived: boolean) => void;
  onDelete: (document: ContractDocument) => void;
}

function supportsDesignations(owner: DocumentRecord["entityType"]): boolean {
  switch (owner) {
    case "contract":
    case "knowledge_item":
      return true;
    case "matter":
    case "entity":
      return false;
  }
}

export function DocumentsCard({
  documents,
  folders,
  nextCursor,
  supportingUploads,
  reading,
  amending,
  onRead,
  onDocuments,
  onFiled,
  onFolders,
  onAmendmentOpened,
}: Readonly<{
  documents: readonly ContractDocument[];
  /** The record's folders, whole (M13/2, DOC-006). The tree is drawn
   * from this one set: a record's folders are few, so there is no read
   * per level and no page to ask for. */
  folders: readonly ContractFolder[];
  /** Where the next page starts, or null at the end of the record's
   * paper (CTR-024). */
  nextCursor: string | null;
  /** Whether this viewer may create supporting paper and append to a
   * supporting chain. This is true only for a Contributor on a live
   * reached record; every administration control remains frozen. */
  supportingUploads: boolean;
  /** The version the doc panel is reading, or none (M12/2). The record
   * holds it, because the panel is a layer beside the record and not
   * part of this section. */
  reading: string | null;
  /**
   * The record's instrument, when a renewal was routed here to be
   * papered as an amendment (M16/5, CTR-007's second vehicle), and null
   * the rest of the time.
   *
   * The section opens its version composer on that document with the
   * kind already set to `amendment`, which is the whole of the routing:
   * the file, the note, and the write are the M11 upload path,
   * unchanged. The **id** rather than the flag on a row, because the
   * designation is the record's answer (CTR-014) and this list is paged
   * (CTR-024) — an instrument filed below the fold is still the
   * instrument. It answers `onAmendmentOpened` once it has, so returning
   * to this section later does not re-open the composer.
   */
  amending: string | null;
  /**
   * Open one version in the doc panel.
   *
   * The control that was pressed rides with it, so closing the panel
   * puts focus back where it came from (DES-010) — this section knows
   * which row was clicked and the record does not.
   */
  onRead: (
    document: ContractDocument,
    version: DocumentVersion,
    trigger: HTMLElement | null,
  ) => void;
  /** The list as it now stands, and where the next page starts. The
   * cursor is omitted by a write that changed rows without moving the
   * position — a metadata edit is not a page. */
  onDocuments: (documents: ContractDocument[], nextCursor?: string | null) => void;
  /**
   * The documents this section is holding **inside folders** (M13/3).
   *
   * The record draws the doc panel, and it resolves what the panel is
   * reading from the paper it holds — which is the record root alone,
   * because a folder's documents are read when the folder is opened.
   * Without this a filed document's name could be pressed and nothing
   * would open: the reference would be resolved against a list it was
   * never in.
   *
   * Told rather than asked for, because the folder listings live here.
   */
  onFiled: (documents: ContractDocument[]) => void;
  /** The record's folders as the seam now answers them. Every folder
   * write answers the whole set, because a delete re-files the children
   * it had and more rows move than the one addressed. */
  onFolders: (folders: ContractFolder[]) => void;
  /** The routed amendment has been taken up: the composer is open, or
   * there was no chain to open it on. Either way the record clears the
   * request, so it is answered exactly once. */
  onAmendmentOpened: () => void;
}>) {
  // The record page says which record this is, who is reading, who the
  // Owner is, and whether administration is frozen (TECH-024 rule 7).
  // The viewer's role decides one control here: DOC-010's erasure. The
  // viewer's id and the Owner's are two of the Confidential flag's three
  // actors (CTR-022). An Entity record answers no Owner (ENT-005).
  const { record: reference, viewer, ownerId, frozen } = useRecord();
  /** CTR-003's reference, the address the upload route takes. One
   * object per record, so nothing keyed on it re-runs every render. */
  const record = useMemo<DocumentRecord>(
    () =>
      reference.kind === "entity" || reference.kind === "knowledge_item"
        ? { entityType: reference.kind, id: reference.id }
        : { entityType: reference.kind, number: reference.number },
    [reference],
  );
  const role = viewer.role;
  const viewerId = viewer.id;
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
  /** Which folders have their contents open. Collapsed by default, for
   * the reason a document's earlier rounds are: the section answers what
   * is on the record first, and the structure opens on a press. */
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(() => new Set());
  /** What each opened folder holds, keyed by the folder's id. A folder
   * that has never been opened is not in here at all, which is what
   * makes a heavy record a short table until somebody opens one. */
  const [listings, setListings] = useState<ReadonlyMap<string, FolderListing>>(() => new Map());
  /**
   * The record is told what this section is holding inside folders
   * (M13/3, M12/2).
   *
   * The doc panel is the record's, and it resolves the version it is
   * reading out of the paper the record holds. That paper is the record
   * root, so a filed document would never resolve and its name would
   * open nothing. This is the one place that knows what the folders on
   * screen hold.
   *
   * A listing survives a folder being closed (M13/3), so a document
   * stays resolvable while its folder is shut — and a listing the
   * refresh evicted takes its documents with it, which is what closes
   * the panel over a document that has been erased.
   *
   * **A folder that is re-reading has not stopped holding its
   * documents.** A write that re-reads the listings puts each open
   * folder into its skeleton state until the read answers, and the
   * skeleton is presentation, not the paper leaving the record. So
   * while a listing is loading, the report keeps the last word it said
   * for that folder — otherwise the panel over a filed document would
   * close on every write to any other row of the paper, which is not
   * what happens to a document at the record root. The word moves on
   * when the read answers: a document the fresh listing no longer holds
   * leaves the report then, and the panel with it.
   *
   * **"I hold nothing" and "I have not looked" are different answers.**
   * This section is mounted and unmounted by the record's tab strip
   * (DES-032), so it starts again with no listing at all every time the
   * reader comes back to the paper. Saying "nothing" then would take
   * away a panel the reader left open — while a root document's panel
   * survives the same trip, because the record holds that list itself.
   * So the first word is only spoken once there is something to say,
   * and every word after it is spoken whatever it says.
   *
   * The listings are the whole of what this says, so they are the whole
   * of what it watches: re-running because the record passed a new
   * callback would say the same thing again on every render of the page.
   */
  const told = useRef(false);
  /** The last word said for each folder, kept so a listing that is
   * mid-read can repeat it rather than say "nothing". */
  const spoken = useRef<ReadonlyMap<string, readonly ContractDocument[]>>(new Map());
  useEffect(() => {
    if (!told.current && listings.size === 0) return;
    const word = new Map<string, readonly ContractDocument[]>();
    for (const [folderId, listing] of listings) {
      if (listing.loading) {
        const last = spoken.current.get(folderId);
        // A first read with no earlier word is "I have not looked yet"
        // for this folder — the remount rule again, one folder at a
        // time. Nothing is said this round; the read's answer speaks.
        if (last === undefined) return;
        word.set(folderId, last);
      } else {
        word.set(folderId, listing.documents);
      }
    }
    told.current = true;
    spoken.current = word;
    onFiled([...word.values()].flat());
  }, [listings, onFiled]);
  /** The folder dialog that is open, or none. */
  const [folderDialog, setFolderDialog] = useState<FolderDialog | null>(null);
  /** The document a "Move to folder" dialog is open for, or none. */
  const [filing, setFiling] = useState<ContractDocument | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  /**
   * The batch a confirmation is open for, or none (M13/4, M13/5,
   * DOC-011).
   *
   * It carries what the gesture carried, whole: the files with the
   * folder each one sat at, the directories of the dropped tree that
   * held nothing, and the folder the gesture landed on. Nothing is sent
   * until the dialog is confirmed, so an accidental drop of the wrong
   * tree costs nothing.
   */
  const [batch, setBatch] = useState<{
    files: DroppedFile[];
    emptyFolders: (readonly string[])[];
    /** The directories the walk could not read to the end, so the
     * confirmation can say the batch may be short rather than let a drop
     * arrive silently missing part of itself. */
    unreadable: (readonly string[])[];
    destination: BatchDestination | null;
    source: BatchSource;
  } | null>(null);
  /** A drag carrying files is over the section, so the surface says it
   * is a target rather than leaving the reader to guess (DES-033 §7).
   * Null when nothing is over it; a folder's id when the drag is over
   * that folder's row, so the row that will take the drop is the row
   * that lights up. */
  const [dragging, setDragging] = useState(false);
  const [dragFolder, setDragFolder] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContractDocument | null>(null);
  /** Whether the archived rows are drawn beside the live ones — the
   * view restoring one is offered in (DOC-010), as the contracts list
   * and the entity registry already do it. */
  const [showArchived, setShowArchived] = useState(false);
  /** The document a typed confirmation is open for, or none. */
  const [deleting, setDeleting] = useState<ContractDocument | null>(null);
  /** How many rows the last page brought, and the id it started at. The
   * first is what the live region announces; the second is the row focus
   * moves to, because that is where what the reader asked for begins
   * (DES-031). */
  const [appended, setAppended] = useState<{ count: number; from: string } | null>(null);
  /** A failed "Show more", said beside the control that failed. The
   * control stays, so the retry is the button already under the
   * reader's hand. */
  const [pageError, setPageError] = useState<string | null>(null);
  /** The row focus is moved to after a page appends. */
  const landing = useRef<HTMLTableRowElement>(null);
  /** The section itself, so the page-wide drop handler can tell a drag
   * outside it from one the section is already answering. */
  const surface = useRef<HTMLElement>(null);
  useEffect(() => {
    if (appended) landing.current?.focus();
  }, [appended]);

  /**
   * A renewal routed here to be papered as an amendment (M16/5,
   * CTR-007's second vehicle): open the composer on the record's
   * instrument, seeded with the `amendment` kind.
   *
   * The record names which document that is; this section finds it in
   * the paper it is holding. A record whose instrument is filed below
   * the fold answers the request anyway rather than leaving it pending,
   * because a request that outlived its page would open a composer the
   * next time somebody walked into this section.
   */
  // Seeded null, not with the prop: the card can mount with the request
  // already set, and that first render has to open the composer too.
  const [amendmentTaken, setAmendmentTaken] = useState<string | null>(null);
  if (amendmentTaken !== amending) {
    setAmendmentTaken(amending);
    const primary = amending === null ? undefined : documents.find((row) => row.id === amending);
    if (primary) setComposer({ document: primary, kind: "amendment" });
  }
  useEffect(() => {
    if (amending !== null) onAmendmentOpened();
  }, [amending, onAmendmentOpened]);

  /** What a listing says when its read did not land. Shared by the
   * record root's foot and every folder's, because it is the same
   * failure said in the same place. */
  const readFailed = () =>
    intl.formatMessage({
      id: "documents.moreError",
      defaultMessage: "The next documents could not be read. Try again.",
    });

  /** One more page of the record root, appended in place (CTR-024,
   * DES-031). The archived view is carried back, because the cursor is a
   * position in whichever list is on screen. */
  async function showMore() {
    if (busy || nextCursor === null) return;
    setBusy(true);
    setPageError(null);
    const outcome = await readRecordDocuments(record, showArchived, nextCursor, FOLDER_ROOT);
    setBusy(false);
    if (!outcome.ok) {
      setPageError(outcome.detail ?? readFailed());
      return;
    }
    const first = outcome.documents[0];
    onDocuments([...documents, ...outcome.documents], outcome.nextCursor);
    setAppended(first ? { count: outcome.documents.length, from: first.id } : null);
  }

  /** One folder's listing, replaced or updated in place. */
  function putListing(folderId: string, listing: FolderListing) {
    setListings((current) => new Map(current).set(folderId, listing));
  }

  /**
   * One folder's documents, read through the same list route the record
   * root is read through (M13/3).
   *
   * `cursor` makes it a "Show more" inside the folder rather than a
   * first load: the page is appended to what the folder already holds,
   * and the cursor is a position inside this folder alone (DES-031).
   *
   * A failure is written onto the folder's own rows rather than the
   * section's note, because the folder is where the reader is looking.
   */
  async function loadFolder(folderId: string, cursor?: string): Promise<void> {
    const held = listings.get(folderId);
    const carried = cursor === undefined ? [] : (held?.documents ?? []);
    // A first read replaces the listing, so the position the folder held
    // no longer describes it — a foot left pointing into the old one
    // would page from somewhere the rows on screen never came from. Only
    // a "Show more" keeps the position it is retrying from.
    const position = cursor === undefined ? null : (held?.nextCursor ?? null);
    putListing(folderId, {
      documents: carried,
      nextCursor: position,
      loading: true,
      error: null,
    });
    const outcome = await readRecordDocuments(record, showArchived, cursor, folderId);
    if (!outcome.ok) {
      // A failed "Show more" keeps the cursor it tried, so the control
      // that failed is still there and the retry is the button already
      // under the reader's hand. A failed first read has no position to
      // keep.
      putListing(folderId, {
        documents: carried,
        nextCursor: position,
        loading: false,
        error: outcome.detail ?? readFailed(),
      });
      return;
    }
    const first = outcome.documents[0];
    putListing(folderId, {
      documents: [...carried, ...outcome.documents],
      nextCursor: outcome.nextCursor,
      loading: false,
      error: null,
    });
    // Only a "Show more" announces and moves focus. A first load is the
    // folder opening, and the reader is already looking at it.
    if (cursor !== undefined && first) {
      setAppended({ count: outcome.documents.length, from: first.id });
    }
  }

  /**
   * Every listing the section is drawing, read again.
   *
   * The writes that answer the record's whole paper — naming the
   * instrument, and DOC-010's erasure — move rows the section is not
   * drawing as one list any more: the root draws what is filed nowhere,
   * and each open folder draws its own. So the answer is discarded and
   * what is on screen is re-read, rather than half-replaced with a list
   * that would put every filed document at the root.
   */
  async function refreshPaper(dissolved?: string): Promise<void> {
    const root = await readRecordDocuments(record, showArchived, undefined, FOLDER_ROOT);
    if (root.ok) onDocuments(root.documents, root.nextCursor);
    setAppended(null);
    // A closed folder's cached listing is evicted rather than re-read:
    // the write may have moved a row into it — a Move names any folder,
    // open or not — and a cache this refresh skipped would be reopened
    // as it stood before the write, beside a count that has moved on.
    // Evicted, reopening reads fresh, which is the promise the toggle
    // trusts.
    setListings((current) => {
      const kept = [...current].filter(
        ([folderId]) => openFolders.has(folderId) && folderId !== dissolved,
      );
      return kept.length === current.size ? current : new Map(kept);
    });
    for (const folderId of openFolders) {
      // A folder that has just been dissolved has no listing to read.
      if (folderId === dissolved) continue;
      await loadFolder(folderId);
    }
  }

  /** Forgets a folder that no longer exists: it is neither open nor
   * holding a listing, because there is nothing left to open. */
  function forgetFolder(folderId: string) {
    setOpenFolders((current) => {
      if (!current.has(folderId)) return current;
      const next = new Set(current);
      next.delete(folderId);
      return next;
    });
    setListings((current) => {
      if (!current.has(folderId)) return current;
      const next = new Map(current);
      next.delete(folderId);
      return next;
    });
  }

  /**
   * The record's folder set, read again for its counts (DES-033).
   *
   * A count is live and viewer-scoped, so anything that files, archives,
   * restores or erases a document moves one. The set is small and the
   * read is one query, so it is asked again rather than guessed at here
   * — a count the section worked out for itself would be a second answer
   * to a question DD-014 allows only one of.
   */
  async function refreshFolders(): Promise<void> {
    const outcome = await readRecordFolders(record);
    if (outcome.ok) onFolders(outcome.folders);
  }

  /** Erasing is the Administrator's alone (DOC-010), so nobody else is
   * shown the item. The seam refuses everyone else regardless; this is
   * what keeps a control from offering a dead end. */
  const canErase = role === "administrator";

  /**
   * Whether this viewer may decide who sees one document (DD-014,
   * CTR-022). Three actors: an Administrator, the person who uploaded
   * it, and the record's Owner. An Entity has no Owner, so there the
   * first two decide.
   *
   * It says exactly what the seam says, out of facts the record already
   * answered — the uploader is on the row, and the Owner is on the
   * record. Reach is not asked again, because being drawn this row is
   * what proves it. The API refuses anybody else with a plain 403; this
   * is only what keeps a control from offering a dead end.
   */
  const canFlag = (document: ContractDocument) =>
    role === "administrator" || document.createdBy.id === viewerId || ownerId === viewerId;

  /**
   * How much paper is on the record: what is filed nowhere, plus what
   * each folder says is filed in it.
   *
   * Two halves because the section reads two listings, and both halves
   * come through the one predicate every document read passes through —
   * the root list leaves out what this viewer may not see, and so does
   * each folder's count (DD-014). So the total can no more announce a
   * hidden document than either half can.
   *
   * Archived rows never count, whichever view is showing: being off the
   * count is what archiving one means (DOC-010). The folder counts leave
   * them out at the seam; the root list is filtered here, because the
   * archived view draws them.
   */
  const liveCount =
    documents.filter((row) => row.archivedAt === null).length +
    folders.reduce((total, folder) => total + folder.documentCount, 0);

  /**
   * A document that just changed, put back where it was — in the record
   * root and in every folder listing that holds it.
   *
   * The order is the API's (newest document first), and editing a
   * document does not move it. Every listing is asked, because the row
   * may be drawn inside an open folder rather than at the root and the
   * caller should not have to know which.
   */
  function replace(document: ContractDocument) {
    onDocuments(documents.map((row) => (row.id === document.id ? document : row)));
    setListings((current) => {
      const next = new Map(current);
      for (const [folderId, listing] of current) {
        if (!listing.documents.some((row) => row.id === document.id)) continue;
        next.set(folderId, {
          ...listing,
          documents: listing.documents.map((row) => (row.id === document.id ? document : row)),
        });
      }
      return next;
    });
    setDetail(null);
    setStatus("saved");
  }

  /** A document that has left the listings on screen — archived out of
   * the live view, or erased. */
  function drop(documentId: string) {
    onDocuments(documents.filter((row) => row.id !== documentId));
    setListings((current) => {
      const next = new Map(current);
      for (const [folderId, listing] of current) {
        if (!listing.documents.some((row) => row.id === documentId)) continue;
        next.set(folderId, {
          ...listing,
          documents: listing.documents.filter((row) => row.id !== documentId),
        });
      }
      return next;
    });
  }

  function prepend(document: ContractDocument) {
    // Newest first, as the list is ordered: the new document goes on
    // top without a re-read.
    onDocuments([document, ...documents]);
    setDetail(null);
    setStatus("saved");
  }

  /**
   * The record's paper after a write that answered all of it.
   *
   * The answer is discarded and the listings on screen are re-read
   * (M13/3). The seam answers the record's whole live list; the section
   * draws the record root and each open folder, so pouring the whole
   * list into the root would put every filed document there as well.
   * Re-reading is also what the archived view already needed, because
   * the archived rows only exist server-side.
   */
  async function applyPaper() {
    await refreshPaper();
    // A write that moved rows may have moved a folder's count with them.
    await refreshFolders();
  }

  /** The show-archived toggle. It re-reads either way: the archived rows
   * only exist server-side, and coming back should not trust a stale
   * list either. Every open folder is re-read with it, because a
   * folder's listing is drawn in whichever view the section is in. */
  async function toggleArchived(next: boolean) {
    if (busy) return;
    setBusy(true);
    setStatus("saving");
    setDetail(null);
    const outcome = await readRecordDocuments(record, next, undefined, FOLDER_ROOT);
    if (!outcome.ok) {
      setBusy(false);
      setStatus("error");
      setDetail(outcome.detail ?? null);
      return;
    }
    onDocuments(outcome.documents, outcome.nextCursor);
    setAppended(null);
    setShowArchived(next);
    // Read in the view being switched to, not the one being left. The
    // rows are dropped first so a folder that fails to re-read draws
    // its skeletons rather than the other view's rows — but each open
    // folder keeps a listing, marked loading, because a folder that is
    // re-reading has not stopped holding its documents: the report
    // above repeats its last word until the new view answers, and the
    // panel over a filed document survives the toggle the way a root
    // document's does. Closed folders' caches go entirely, as before.
    setListings(
      new Map(
        [...openFolders].map((folderId) => [
          folderId,
          { documents: [], nextCursor: null, loading: true, error: null },
        ]),
      ),
    );
    for (const folderId of openFolders) {
      const folder = await readRecordDocuments(record, next, undefined, folderId);
      putListing(folderId, {
        documents: folder.ok ? folder.documents : [],
        nextCursor: folder.ok ? folder.nextCursor : null,
        loading: false,
        error: folder.ok ? null : (folder.detail ?? readFailed()),
      });
    }
    setBusy(false);
    setStatus("idle");
  }

  /**
   * Files a document into a folder, or moves it back out to the record
   * root (DOC-006, M13/3).
   *
   * The row leaves one listing and joins another, and both folders'
   * counts move with it, so everything on screen is read again rather
   * than spliced: working out here which listing gained what is the
   * section deciding for itself something the seam has just answered.
   *
   * A refusal is handed back to the dialog, the way the folder writes'
   * are: the seam's refusals here are things the person can act on — a
   * folder deleted under them, an archived record — and the dialog
   * covers the spot the section note reads in.
   */
  async function fileDocument(
    document: ContractDocument,
    folderId: string | null,
  ): Promise<string | null> {
    if (busy) return null;
    setBusy(true);
    setStatus("saving");
    setDetail(null);
    const outcome = await updateDocument(document.id, { folderId });
    if (outcome.ok) await applyPaper();
    setBusy(false);
    if (outcome.ok) {
      setFiling(null);
      setStatus("saved");
      return null;
    }
    // Back to idle, not to error: the dialog says what happened, and a
    // note behind it would say it again to whoever closes the dialog.
    setStatus("idle");
    return (
      outcome.detail ??
      intl.formatMessage({
        id: "documents.move.error",
        defaultMessage: "That document could not be moved. Try again.",
      })
    );
  }

  /**
   * Names a document the contract's instrument (CTR-014).
   *
   * The designation moving changes two rows — the one that takes it and
   * the one that loses it — and the two can sit in different listings,
   * so everything on screen is read again rather than re-derived here.
   */
  async function makePrimary(document: ContractDocument) {
    if (busy) return;
    setBusy(true);
    setStatus("saving");
    setDetail(null);
    const outcome = await setPrimaryDocument(document.id);
    if (outcome.ok) await applyPaper();
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
   *
   * The count it leaves may be a folder's, so the folder set is read
   * again when the document was filed in one (DES-033).
   */
  async function setArchived(document: ContractDocument, next: boolean) {
    if (busy) return;
    setBusy(true);
    setStatus("saving");
    setDetail(null);
    const outcome = next ? await archiveDocument(document.id) : await restoreDocument(document.id);
    if (outcome.ok && document.folderId !== null) await refreshFolders();
    setBusy(false);
    if (!outcome.ok) {
      setStatus("error");
      setDetail(outcome.detail ?? null);
      return;
    }
    if (next && !showArchived) {
      drop(document.id);
      setDetail(null);
      setStatus("saved");
      return;
    }
    replace(outcome.document);
  }

  /**
   * DD-014's per-document flag, set and cleared.
   *
   * It narrows one file to the record's named team, its Owner, and
   * Administrators, even on a record everybody can open. Clearing it
   * puts the file back where the record's own audience is. On an
   * Entity, which has no team and no Owner, the flag narrows the file
   * to Administrators and the Entity's own grant list (ENT-004).
   *
   * **Setting it can put the file outside the setter's own audience.**
   * An Administrator and the record's Owner always stay inside it; a
   * Legal Team Member who uploaded a file to a record they hold no
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
    if (outcome.ok) await applyPaper();
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

  /** Corrects one round's kind and leaves every other fact on it alone. */
  async function changeKind(
    document: ContractDocument,
    version: DocumentVersion,
    kind: HandSetDocumentVersionKind,
  ) {
    if (busy || version.kind === kind || version.kind === "generated_redline") return;
    setBusy(true);
    setStatus("saving");
    setDetail(null);
    const outcome = await updateDocumentVersionKind(document.id, version.id, kind);
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

  /**
   * Opens or closes one folder (DES-033).
   *
   * Opening one for the first time reads its documents. A folder that
   * has been opened before keeps what it read, so closing and re-opening
   * costs nothing — every write that could change it re-reads it.
   */
  function toggleFolder(folderId: string) {
    const opening = !openFolders.has(folderId);
    setOpenFolders((current) => {
      const next = new Set(current);
      if (!next.delete(folderId)) next.add(folderId);
      return next;
    });
    if (opening && !listings.has(folderId)) void loadFolder(folderId);
  }

  /**
   * One folder write, whichever of the four it is (M13/2).
   *
   * They share a shape: every one answers the record's whole folder set,
   * because dissolving a folder re-files the children it had and more
   * rows move than the one that was addressed. The caller replaces what
   * it holds rather than working out which other row moved.
   *
   * A refusal is handed back to the dialog rather than written to the
   * section note, the way the erasure's is: the dialog covers the spot
   * that note reads in, and the seam's refusals here are all things the
   * person can act on — a name already taken, a move that would close a
   * cycle, a delete that would put two folders of one name in one place.
   *
   * **The refusal stays inside the open dialog**, carrying the server's
   * own sentence, rather than closing it and marking the row. That is a
   * deliberate normalization of DES-033 §6, recorded there: the person
   * can read why and then cancel or fix, which is the DOC-010 erasure
   * dialog's precedent on this same surface.
   *
   * `dissolved` names the folder a delete is dissolving. Its documents
   * go up into the parent, so the listings on screen are read again —
   * skipping the folder that has just stopped existing, and forgetting
   * what it held. Nothing else here moves a document.
   */
  async function writeFolders(
    write: () => Promise<FoldersOutcome>,
    dissolved?: string,
  ): Promise<string | null> {
    if (busy) return null;
    setBusy(true);
    setStatus("saving");
    setDetail(null);
    const outcome = await write();
    if (outcome.ok && dissolved !== undefined) {
      forgetFolder(dissolved);
      await refreshPaper(dissolved);
    }
    setBusy(false);
    if (outcome.ok) {
      onFolders(outcome.folders);
      setFolderDialog(null);
      setStatus("saved");
      return null;
    }
    // Back to idle, not to error: the dialog says what happened, and a
    // note behind it would say it again to whoever closes the dialog.
    setStatus("idle");
    return (
      outcome.detail ??
      intl.formatMessage({
        id: "documents.folder.error",
        defaultMessage: "That folder could not be saved. Try again.",
      })
    );
  }

  /**
   * What a drop carried, read and handed to the batch confirmation
   * (M13/5, DOC-011, DES-033 §7).
   *
   * The reading is the walk of the dropped tree, so this is async and
   * the `DataTransfer` is read inside `filesFromDrop` before anything is
   * awaited — a transfer is emptied when the drop handler returns.
   *
   * `into` is the folder the gesture landed on: null for the section
   * itself, a folder for one of its rows. Every path in the batch is
   * relative to it, so a tree dropped on a folder row is recreated
   * inside that row.
   *
   * A gesture carrying nothing at all — a dragged text selection, an
   * empty transfer — opens nothing. There is no batch to confirm.
   */
  async function openDrop(
    transfer: DataTransfer | null,
    into: BatchDestination | null,
  ): Promise<void> {
    const dropped = await filesFromDrop(transfer);
    if (
      dropped.files.length === 0 &&
      dropped.emptyFolders.length === 0 &&
      dropped.unreadable.length === 0
    ) {
      return;
    }
    setBatch({
      files: dropped.files,
      emptyFolders: dropped.emptyFolders,
      unreadable: dropped.unreadable,
      destination: into,
      source: "drop",
    });
  }

  /**
   * The page is the target, not only the section (DES-033 §7, widened).
   *
   * Somebody dragging a file into the window has already said what they
   * want. Making them find a small rectangle first is a gesture the
   * reader can miss, and a miss costs them the file: the browser's own
   * default for a dropped file is to open it and leave the record.
   *
   * The section keeps its own handlers, and this one answers only for a
   * drag outside it. That is what keeps a folder row's drop the
   * folder's: inside the section, the row and the section already
   * decide between themselves where the files are filed.
   *
   * A drag over an open dialog is left alone. The batch confirmation is
   * itself the answer to a drop, and the composer has its own file
   * control — neither should take a second drop underneath.
   */
  useEffect(() => {
    if (frozen) return;
    const outside = (event: DragEvent) => {
      // A window handler answers for every target, and not every target
      // is a Node — `contains` throws on one that is not.
      const node = event.target instanceof Node ? event.target : null;
      if (node && surface.current?.contains(node)) return false;
      return document.querySelector('[role="dialog"], [role="alertdialog"]') === null;
    };
    const over = (event: DragEvent) => {
      if (!outside(event) || !dragCarriesFiles(event.dataTransfer)) return;
      // Without this the browser opens the dropped file instead of
      // handing it over.
      event.preventDefault();
      // The section takes a copy of what is dropped and moves nothing.
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    };
    // A null related target is the pointer leaving the window itself;
    // crossing between two elements of the page is not leaving it.
    const leave = (event: DragEvent) => {
      if (event.relatedTarget !== null) return;
      setDragging(false);
      setDragFolder(null);
    };
    const drop = (event: DragEvent) => {
      // The same file check the dragover does. Without it a dropped
      // link or a dropped selection is swallowed by a section that
      // has no use for it.
      if (!outside(event) || !dragCarriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      setDragging(false);
      setDragFolder(null);
      void openDrop(event.dataTransfer, null);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragend", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragend", leave);
      window.removeEventListener("drop", drop);
    };
    // `openDrop` reads nothing that changes between renders — it hands
    // what the drop carried to `setBatch` and nothing else.
  }, [frozen]);

  /** A Contributor gets one narrow Actions column on a live record;
   * Member+ gets the full one. An archived record gets neither. */
  const showActionColumn = !frozen || supportingUploads;

  /** Everything a document row draws from, built once and handed to
   * every listing — the record root's and each open folder's. */
  const rowContext: RowContext = {
    designations: supportsDesignations(record.entityType),
    executedDesignations: record.entityType === "contract",
    folders: record.entityType !== "knowledge_item",
    setPrimaryCopy: record.entityType === "knowledge_item",
    frozen,
    supportingUploads,
    showActionColumn,
    busy,
    intl,
    reading,
    canErase,
    canFlag,
    opened,
    appended,
    landing,
    onToggle: toggle,
    onRead,
    onPin: (document, version) => void togglePin(document, version),
    onKindChange: (document, version, kind) => void changeKind(document, version, kind),
    onMakePrimary: (document) => void makePrimary(document),
    onAddVersion: (document) => setComposer({ document }),
    onEditDetails: setEditing,
    onMoveToFolder: setFiling,
    onSetConfidential: (document, next) => void setConfidential(document, next),
    onArchive: (document, next) => void setArchived(document, next),
    onDelete: setDeleting,
  };

  return (
    <section
      ref={surface}
      aria-labelledby="contract-documents-heading"
      className={cn(
        "w-full overflow-hidden rounded-card border border-border-default bg-raised",
        dragging && "outline outline-2 outline-offset-2 outline-link",
      )}
      // The whole section is the target (DES-033 §7), and so is the
      // page around it — the effect above answers for everything
      // outside. A frozen record takes no drop at all: an archived
      // record's paper is frozen, and a Contributor is offered no
      // control anywhere else here either.
      onDragOver={(event) => {
        if (frozen || !dragCarriesFiles(event.dataTransfer)) return;
        // Without this the browser opens the dropped file instead of
        // handing it over.
        event.preventDefault();
        // The section takes a copy of what is dropped and moves nothing.
        // Left unset, the cursor can promise a move that never happens.
        event.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(event) => {
        // Crossing between the section's own children is not leaving it.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
        setDragFolder(null);
      }}
      onDrop={(event) => {
        if (frozen) return;
        event.preventDefault();
        setDragging(false);
        setDragFolder(null);
        void openDrop(event.dataTransfer, null);
      }}
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
        {showActionColumn && (
          <div className="flex shrink-0 items-center gap-2">
            <StatusNote status={status} detail={detail} />
            {!frozen && (
              <>
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
                {/* The keyboard twin of every organizing gesture the drop
                will add in M13/4 (DES-033): a folder is made from a
                control, never only by dropping one. */}
                {record.entityType !== "knowledge_item" && (
                  <Button
                    variant="secondary"
                    onClick={() => setFolderDialog({ mode: "create", parent: null })}
                  >
                    <FolderPlus size={16} aria-hidden="true" />
                    <FormattedMessage id="documents.newFolder" defaultMessage="New folder" />
                  </Button>
                )}
              </>
            )}
            <Button variant="secondary" onClick={() => setComposer({ document: undefined })}>
              <Upload size={16} aria-hidden="true" />
              <FormattedMessage id="documents.upload" defaultMessage="Upload" />
            </Button>
          </div>
        )}
      </header>
      {/* A record with folders on it but no paper still draws the
          table: the folders are the record's organization, and hiding
          them behind the paper's empty state would say the tree is not
          there. */}
      {documents.length === 0 && folders.length === 0 ? (
        <p className="px-4 py-3 text-base text-muted">
          <FormattedMessage {...RECORD_COPY[record.entityType].empty} />
        </p>
      ) : (
        <div className="overflow-x-auto">
          {/* Fixed rather than auto: every other column already carries
              an explicit width, and a truncating Name cell needs a
              stable width to truncate against — auto layout keeps
              recomputing column widths from content, which is what let
              a long file name squeeze the Kind pill into wrapping. */}
          <table className="w-full table-fixed">
            <thead>
              <tr className="text-start text-sm font-medium text-muted">
                <th scope="col" className="px-4 py-2 text-start font-medium">
                  <FormattedMessage id="documents.column.name" defaultMessage="Name" />
                </th>
                <th scope="col" className="w-32 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="documents.column.kind" defaultMessage="Kind" />
                </th>
                <th scope="col" className="w-24 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="documents.column.version" defaultMessage="Version" />
                </th>
                <th scope="col" className="w-24 px-4 py-2 text-start font-medium">
                  <FormattedMessage id="documents.column.modified" defaultMessage="Modified" />
                </th>
                <th scope="col" className="w-10 px-2 py-2 text-end font-medium">
                  <span className="sr-only">
                    <FormattedMessage
                      id="documents.column.uploadedBy"
                      defaultMessage="Uploaded by"
                    />
                  </span>
                </th>
                {showActionColumn && (
                  <th scope="col" className="w-10 px-2 py-2 text-end font-medium">
                    <span className="sr-only">
                      <FormattedMessage id="documents.column.actions" defaultMessage="Actions" />
                    </span>
                  </th>
                )}
              </tr>
            </thead>
            {/* The record's organization, above its loose paper
                (DES-033): folders sort before documents, and the root
                mixes the two exactly as a file manager does. Each folder
                brings its own row groups, because the documents inside
                one are row groups too. */}
            {record.entityType !== "knowledge_item" && (
              <FolderRows
                folders={folders}
                parentId={null}
                depth={0}
                open={openFolders}
                listings={listings}
                rows={rowContext}
                dragOver={dragFolder}
                onToggle={toggleFolder}
                onShowMore={(folderId, cursor) => void loadFolder(folderId, cursor)}
                onDialog={setFolderDialog}
                onDragFolder={setDragFolder}
                onDropOnFolder={(folder, transfer) => {
                  setDragging(false);
                  setDragFolder(null);
                  void openDrop(transfer, { id: folder.id, name: folder.name });
                }}
              />
            )}
            {/* The record's own loose paper — the documents filed in no
                folder at all (DES-033). A folder's documents are drawn
                inside the folder, by the tree above. */}
            <DocumentRows documents={documents} depth={0} rows={rowContext} />
          </table>
        </div>
      )}
      {/* Under the table's own rows and inside the section's card, so
          the control reads as part of the list (DES-031). */}
      {nextCursor !== null && (
        <div className="flex items-center justify-between gap-3 border-t border-border-default px-4 py-3">
          {pageError ? (
            <p role="alert" className="text-xs text-status-danger-fg">
              {pageError}
            </p>
          ) : (
            <span />
          )}
          <Button variant="secondary" disabled={busy} onClick={() => void showMore()}>
            <FormattedMessage id="documents.more" defaultMessage="Show more" />
          </Button>
        </div>
      )}
      {/* What the press did, for a reader who cannot see the rows
          arrive. Focus lands on the first of them, so this says how many
          followed it (DES-031). */}
      <p aria-live="polite" className="sr-only">
        {appended && (
          <FormattedMessage
            id="documents.moreAdded"
            defaultMessage="{count, plural, one {# more document} other {# more documents}}. {total} shown."
            values={{ count: appended.count, total: documents.length }}
          />
        )}
      </p>
      {composer && (
        <UploadDialog
          record={record}
          document={composer.document}
          seedKind={composer.kind}
          supportingOnly={supportingUploads && frozen}
          onClose={() => setComposer(null)}
          onBatch={(files) => {
            // More than one file is a batch, wherever it came from
            // (DOC-011). The composer's own fields are a round's — one
            // note about one change — and a batch is not a round, so it
            // hands over rather than growing a second shape.
            //
            // A directory picker's files carry the folder each one sat
            // at; a plain multi-select's carry none, and land at the
            // record root. Either way the batch is the same batch, which
            // is what makes the picker folder drop's pointer-free twin
            // (DES-033 §7). No empty directory comes through a picker:
            // a file input carries files, and a directory holding none
            // produces none.
            setComposer(null);
            setBatch({
              files,
              emptyFolders: [],
              unreadable: [],
              destination: null,
              source: "picker",
            });
          }}
          onSaved={(document) => {
            if (composer.document) replace(document);
            else prepend(document);
            setComposer(null);
          }}
        />
      )}
      {batch && (
        <BatchDialog
          record={record}
          files={batch.files}
          emptyFolders={batch.emptyFolders}
          unreadable={batch.unreadable}
          destination={batch.destination}
          source={batch.source}
          // Every listing on screen, read again — the record root and
          // each open folder — with every cached listing the refresh
          // did not re-read evicted. A batch is a write over the
          // record's whole paper: it may have taken the primary
          // designation (CTR-014), and it has certainly moved the
          // count.
          onLanded={applyPaper}
          onClose={() => setBatch(null)}
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
      {filing && record.entityType !== "knowledge_item" && (
        <MoveDocumentDialog
          recordType={record.entityType}
          document={filing}
          folders={folders}
          busy={busy}
          onClose={() => setFiling(null)}
          onConfirm={(folderId) => fileDocument(filing, folderId)}
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
      {(folderDialog?.mode === "create" || folderDialog?.mode === "rename") && (
        <FolderNameDialog
          folder={folderDialog.mode === "rename" ? folderDialog.folder : null}
          parent={folderDialog.mode === "create" ? folderDialog.parent : null}
          busy={busy}
          onClose={() => setFolderDialog(null)}
          onConfirm={async (name) => {
            const parent = folderDialog.mode === "create" ? folderDialog.parent : null;
            const refusal = await writeFolders(() =>
              folderDialog.mode === "create"
                ? createRecordFolder(record, {
                    name,
                    ...(parent ? { parentId: parent.id } : {}),
                  })
                : updateContractFolder(folderDialog.folder.id, { name }),
            );
            // A folder made inside a closed one opens it. The person
            // just named the thing; a write that landed and left the
            // table looking exactly as it did reads as a write that did
            // not — and a parent that had no children until now had no
            // chevron for them to press either.
            if (refusal === null && parent) {
              setOpenFolders((current) => new Set(current).add(parent.id));
            }
            return refusal;
          }}
        />
      )}
      {folderDialog?.mode === "move" && (
        <MoveFolderDialog
          recordType={record.entityType}
          folder={folderDialog.folder}
          folders={folders}
          busy={busy}
          onClose={() => setFolderDialog(null)}
          onConfirm={(parentId) =>
            writeFolders(() => updateContractFolder(folderDialog.folder.id, { parentId }))
          }
        />
      )}
      {folderDialog?.mode === "delete" && (
        <DeleteFolderDialog
          recordType={record.entityType}
          folder={folderDialog.folder}
          folders={folders}
          busy={busy}
          onClose={() => setFolderDialog(null)}
          onConfirm={() =>
            writeFolders(
              () => deleteContractFolder(folderDialog.folder.id),
              // The dissolve re-files this folder's documents into its
              // parent, so the listings on screen are read again after
              // it — and this one has stopped existing.
              folderDialog.folder.id,
            )
          }
        />
      )}
    </section>
  );
}

/**
 * The document rows of one listing (M11/2, DES-033).
 *
 * One row group per document, because one document is one chain: its
 * current version leads, and the rounds it supersedes belong to it and
 * to nothing else.
 *
 * Drawn at the record root and inside every open folder, which is the
 * whole reason it is a component: a filed document opens, previews,
 * versions, and is erased exactly as an unfiled one, and two copies of
 * this markup would be two places for that to stop being true. `depth`
 * is the only difference between the two — 18px a level, drawn as a
 * spacer at the head of the Name cell.
 */
function DocumentRows({
  documents,
  depth,
  rows,
}: Readonly<{
  documents: readonly ContractDocument[];
  /** How far in this listing sits. 0 is the record root's own paper. */
  depth: number;
  rows: RowContext;
}>) {
  return (
    <>
      {documents.map((document) => {
        const chain = chainOf(document);
        // A document with no version is a broken record, not an
        // empty one, so it is left undrawn rather than drawn
        // without a file.
        if (!chain) return null;
        const isOpen = rows.opened.has(document.id);
        return (
          <tbody key={document.id}>
            <tr
              // Focusable only while it is the landing row: a
              // section of fifty tab stops nobody asked for is
              // worse than none (DES-031).
              ref={document.id === rows.appended?.from ? rows.landing : undefined}
              tabIndex={document.id === rows.appended?.from ? -1 : undefined}
              className="border-t border-border-default"
            >
              <td className="px-4 py-2.5">
                <span className="flex items-start gap-1">
                  {depth > 0 && (
                    <span
                      aria-hidden="true"
                      className="shrink-0"
                      style={{ width: depth * FOLDER_INDENT }}
                    />
                  )}
                  {chain.superseded.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-expanded={isOpen}
                      onClick={() => rows.onToggle(document.id)}
                      aria-label={rows.intl.formatMessage(
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
                  <FileText size={16} aria-hidden="true" className="mt-1 shrink-0 text-muted" />
                  <span className="flex min-w-0 flex-col">
                    {/* The name line takes the toggle's own height, so
                        the name and its marks sit on the same band as
                        the chevron and the pills in the other columns.
                        Without it the shorter text line hugs the top of
                        the taller row and reads a couple of pixels
                        high. */}
                    <span className="flex min-h-6 items-center gap-1.5">
                      {/* A long file name truncates to one line
                          rather than pushing the row's height
                          around; the full name is still there on
                          hover and for a screen reader, which
                          reads the element's own text either way. */}
                      <OpenVersion
                        document={document}
                        version={chain.current}
                        label={document.title}
                        reading={rows.reading}
                        onRead={rows.onRead}
                        className="min-w-0 flex-1 truncate text-base font-medium"
                      />
                      {/* DES-009 Tier 1, beside a document's name
                          rather than a record's: this file is
                          narrowed to the contract's named team
                          (DD-014). It is a mark on a row the
                          reader can already see — a reader
                          outside the audience is sent no row, so
                          nothing here is ever a placeholder. */}
                      {document.isConfidential && <ConfidentialMarker className="shrink-0" />}
                      {/* The instrument the contract is (CTR-014).
                          Marked on the row rather than in a caption
                          over the list, because a caption cannot say
                          which of six documents it means. The quiet
                          chip is the count badge's own pair: a
                          designation is a structural fact, not a
                          status. */}
                      {document.isPrimary && (
                        <span className="shrink-0 rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
                          <FormattedMessage id="documents.primary" defaultMessage="Primary" />
                        </span>
                      )}
                      {/* Off the list and out of the count
                          (DOC-010), drawn only in the archived
                          view — the same pill the contracts list
                          marks an archived record with, because
                          it is the same fact one level down. */}
                      {document.archivedAt !== null && (
                        <span className="shrink-0 rounded-pill bg-badge-count-bg px-2 py-0.5 text-xs font-medium text-badge-count-fg">
                          <FormattedMessage id="documents.archivedPill" defaultMessage="Archived" />
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
                          <FormattedMessage id="documents.notePrefix" defaultMessage="Note:" />{" "}
                        </span>
                        {chain.current.note}
                      </span>
                    )}
                  </span>
                </span>
              </td>
              <KindCell document={document} version={chain.current} rows={rows} />
              <VersionCell version={chain.current} intl={rows.intl} />
              <ModifiedCell version={chain.current} />
              <UploaderCell version={chain.current} intl={rows.intl} />
              {rows.showActionColumn && (
                <td className="px-2 py-2.5">
                  <span className="flex items-center justify-end gap-1">
                    {(!rows.frozen ||
                      (rows.supportingUploads &&
                        document.archivedAt === null &&
                        (!rows.designations || !document.isPrimary))) && (
                      <DocumentActions
                        document={document}
                        version={chain.current}
                        designations={rows.designations}
                        executedDesignations={rows.executedDesignations}
                        folders={rows.folders}
                        setPrimaryCopy={rows.setPrimaryCopy}
                        supportingOnly={rows.frozen}
                        busy={rows.busy}
                        canErase={rows.canErase}
                        canFlag={rows.canFlag(document)}
                        intl={rows.intl}
                        onMakePrimary={() => rows.onMakePrimary(document)}
                        onAddVersion={() => rows.onAddVersion(document)}
                        onEditDetails={() => rows.onEditDetails(document)}
                        onMoveToFolder={() => rows.onMoveToFolder(document)}
                        onSetConfidential={(next) => rows.onSetConfidential(document, next)}
                        onArchive={() => rows.onArchive(document, true)}
                        onRestore={() => rows.onArchive(document, false)}
                        onDelete={() => rows.onDelete(document)}
                        onToggleExecuted={() => rows.onPin(document, chain.current)}
                      />
                    )}
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
                      {depth > 0 && (
                        <span
                          aria-hidden="true"
                          className="shrink-0"
                          style={{ width: depth * FOLDER_INDENT }}
                        />
                      )}
                      <FileText size={16} aria-hidden="true" className="mt-1 shrink-0 text-muted" />
                      <span className="flex min-w-0 flex-col">
                        <OpenVersion
                          document={document}
                          version={version}
                          label={version.originalFilename}
                          reading={rows.reading}
                          onRead={rows.onRead}
                          className="min-w-0 truncate text-base"
                        />
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
                  <KindCell document={document} version={version} rows={rows} />
                  <VersionCell version={version} intl={rows.intl} />
                  <ModifiedCell version={version} />
                  <UploaderCell version={version} intl={rows.intl} />
                  {rows.showActionColumn && (
                    <td className="px-2 py-2.5">
                      {/* A superseded round takes the pin as
                          readily as the current one for Member+.
                          Supporting upload permission adds a new round
                          from the document row and never administers an
                          existing round. */}
                      <span className="flex items-center justify-end gap-1">
                        {!rows.frozen &&
                          rows.executedDesignations &&
                          document.archivedAt === null && (
                            <VersionPinMenu
                              document={document}
                              version={version}
                              busy={rows.busy}
                              intl={rows.intl}
                              onToggle={rows.onPin}
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
    </>
  );
}

/**
 * One level of the folder tree, everything open under it, and the
 * documents filed in each open folder (DES-033).
 *
 * Recursive rather than flattened, because the indentation is what says
 * where a folder sits and a flat list would have to carry the depth
 * beside every row anyway. Only an open folder draws its contents, so a
 * heavy record stays a short table until somebody opens one.
 *
 * **Child folders first, then documents**, which is the same rule the
 * record root follows and the way a file manager lists a directory. Both
 * sit one level in from the folder that holds them.
 *
 * Each folder is its own row group, because a document row group already
 * is one: a `tbody` inside a `tbody` is not a table.
 */
function FolderRows({
  folders,
  parentId,
  depth,
  open,
  listings,
  rows,
  dragOver,
  onToggle,
  onShowMore,
  onDialog,
  onDragFolder,
  onDropOnFolder,
}: Readonly<{
  folders: readonly ContractFolder[];
  /** The folder whose children this level draws, or null at the record
   * root. */
  parentId: string | null;
  /** How far in this level sits. 0 is the record root's own folders. */
  depth: number;
  open: ReadonlySet<string>;
  /** What each opened folder holds. A folder that has never been opened
   * is not in here. */
  listings: ReadonlyMap<string, FolderListing>;
  rows: RowContext;
  /** The folder a file drag is currently over, or none. One row lights
   * up at a time: the drop lands in exactly one folder, and two lit rows
   * would promise otherwise (DES-033 §7). */
  dragOver: string | null;
  onToggle: (folderId: string) => void;
  onShowMore: (folderId: string, cursor: string) => void;
  onDialog: (dialog: FolderDialog) => void;
  onDragFolder: (folderId: string | null) => void;
  /** A drop that landed on this row rather than on the section. What it
   * carries is filed into this folder, and a tree it carries is
   * recreated inside it (DOC-011). */
  onDropOnFolder: (folder: ContractFolder, transfer: DataTransfer | null) => void;
}>) {
  return (
    <>
      {childrenOf(folders, parentId).map((folder) => {
        const isOpen = open.has(folder.id);
        const listing = listings.get(folder.id);
        return (
          <Fragment key={folder.id}>
            <tbody>
              <tr
                className={cn(
                  "border-t border-border-default",
                  // The row that will take the drop is the row that says
                  // so (DES-033 §7). The section's own outline stays on
                  // as well: the drop is still on the section, filed one
                  // level in.
                  dragOver === folder.id && "outline outline-2 -outline-offset-2 outline-link",
                )}
                // A frozen record takes no drop, here as on the section:
                // an archived record's paper is frozen and a Contributor
                // is offered no control anywhere else on the row either.
                onDragOver={(event) => {
                  if (rows.frozen || !dragCarriesFiles(event.dataTransfer)) return;
                  // Without this the section's own handler answers, and
                  // the files would land at the record root instead of
                  // in this folder.
                  event.stopPropagation();
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  onDragFolder(folder.id);
                }}
                onDragLeave={(event) => {
                  // Crossing between the row's own children is not
                  // leaving it.
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  onDragFolder(null);
                }}
                onDrop={(event) => {
                  if (rows.frozen) return;
                  event.stopPropagation();
                  event.preventDefault();
                  onDropOnFolder(folder, event.dataTransfer);
                }}
              >
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-1">
                    {/* 18px a level, drawn as a spacer at the head of the
                        cell rather than as padding on the row: one rule
                        for both row kinds, and nothing positioned by
                        eye. */}
                    {depth > 0 && (
                      <span
                        aria-hidden="true"
                        className="shrink-0"
                        style={{ width: depth * FOLDER_INDENT }}
                      />
                    )}
                    {/* Every folder takes the chevron, full or empty
                        (M13/3). A folder that draws "Empty" may be a
                        folder whose contents this viewer cannot see, so
                        drawing the control only on the ones with
                        something in it would be the surface telling the
                        two apart — which is exactly what DD-014 bars. */}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-expanded={isOpen}
                      onClick={() => onToggle(folder.id)}
                      aria-label={rows.intl.formatMessage(
                        {
                          id: "documents.folder.toggle",
                          defaultMessage: "{open, select, true {Collapse} other {Expand}} {name}",
                        },
                        { open: isOpen, name: folder.name },
                      )}
                    >
                      {isOpen ? (
                        <ChevronDown size={16} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={16} aria-hidden="true" />
                      )}
                    </Button>
                    {isOpen ? (
                      <FolderOpen size={16} aria-hidden="true" className="shrink-0 text-muted" />
                    ) : (
                      <Folder size={16} aria-hidden="true" className="shrink-0 text-muted" />
                    )}
                    <span className="min-w-0 truncate text-base font-semibold">{folder.name}</span>
                    {/* How much is filed here, scoped to this reader
                        (DES-033). The seam counts it through the one
                        predicate every document read passes through, so
                        the number can never announce a document the
                        listing left out. Its zero reads "Empty", and
                        nothing on the surface tells an empty folder from
                        one whose contents this viewer may not see — that
                        ambiguity is DD-014's promise held at the pixel
                        level. */}
                    <span className="shrink-0 text-xs text-muted">
                      <FormattedMessage
                        id="documents.folder.count"
                        defaultMessage="{count, plural, =0 {Empty} one {# document} other {# documents}}"
                        values={{ count: folder.documentCount }}
                      />
                    </span>
                  </span>
                </td>
                {/* A folder has no kind, no version and no modified
                    date, so those cells are empty rather than filled
                    with em dashes. */}
                <td className="px-4 py-2.5" />
                <td className="px-4 py-2.5" />
                <td className="px-4 py-2.5" />
                <td className="px-4 py-2.5" />
                {rows.showActionColumn && (
                  <td className="px-2 py-2.5">
                    {!rows.frozen && (
                      <span className="flex items-center justify-end gap-1">
                        <FolderActions
                          folder={folder}
                          busy={rows.busy}
                          intl={rows.intl}
                          onDialog={onDialog}
                        />
                      </span>
                    )}
                  </td>
                )}
              </tr>
            </tbody>
            {isOpen && (
              <>
                <FolderRows
                  folders={folders}
                  parentId={folder.id}
                  depth={depth + 1}
                  open={open}
                  listings={listings}
                  rows={rows}
                  dragOver={dragOver}
                  onToggle={onToggle}
                  onShowMore={onShowMore}
                  onDialog={onDialog}
                  onDragFolder={onDragFolder}
                  onDropOnFolder={onDropOnFolder}
                />
                <DocumentRows documents={listing?.documents ?? []} depth={depth + 1} rows={rows} />
                <FolderListingFoot
                  folder={folder}
                  depth={depth + 1}
                  listing={listing}
                  rows={rows}
                  onShowMore={onShowMore}
                />
              </>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * What an open folder says under its documents: that they are still
 * arriving, that they did not, or that there are more (DES-031,
 * DES-033).
 *
 * The paging foot applies **within** the folder rather than across the
 * record, because the cursor it carries is a position in this folder's
 * own listing. A heavy folder pages without moving anything around it.
 *
 * The skeleton rows are drawn at the opened folder's depth, so the tree
 * around them stays readable while its contents arrive.
 */
function FolderListingFoot({
  folder,
  depth,
  listing,
  rows,
  onShowMore,
}: Readonly<{
  folder: ContractFolder;
  depth: number;
  /** What the folder holds, or nothing at all while its first read is
   * still on its way out. */
  listing: FolderListing | undefined;
  rows: RowContext;
  onShowMore: (folderId: string, cursor: string) => void;
}>) {
  /** Every column of the table, so a foot spans the row it sits in. The
   * actions column is absent for a viewer who may not act. */
  const columns = rows.frozen ? 5 : 6;
  const loading = listing === undefined || listing.loading;
  if (!loading && listing.error === null && listing.nextCursor === null) return null;

  return (
    <tbody>
      {loading &&
        Array.from({ length: FOLDER_SKELETON_ROWS }, (_, index) => (
          <tr key={index} className="border-t border-border-default">
            <td className="px-4 py-2.5" colSpan={columns}>
              <span className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="shrink-0"
                  style={{ width: depth * FOLDER_INDENT }}
                />
                {/* One bar, not a fake row of cells: it says "something
                    is coming here" and promises nothing about what. */}
                <span
                  aria-hidden="true"
                  className="h-4 w-64 animate-pulse rounded-chip bg-control"
                />
              </span>
            </td>
          </tr>
        ))}
      {loading && (
        // Said once for the whole folder, to a reader who cannot see the
        // bars move.
        <tr className="sr-only">
          <td colSpan={columns}>
            <span aria-live="polite">
              <FormattedMessage
                id="documents.folder.loading"
                defaultMessage="Loading the documents in {name}"
                values={{ name: folder.name }}
              />
            </span>
          </td>
        </tr>
      )}
      {!loading && listing.error !== null && (
        <tr className="border-t border-border-default">
          <td className="px-4 py-2.5" colSpan={columns}>
            <span className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="shrink-0"
                style={{ width: depth * FOLDER_INDENT }}
              />
              <span role="alert" className="text-xs text-status-danger-fg">
                {listing.error}
              </span>
            </span>
          </td>
        </tr>
      )}
      {!loading && listing.nextCursor !== null && (
        <tr className="border-t border-border-default">
          <td className="px-4 py-2.5" colSpan={columns}>
            <span className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="shrink-0"
                style={{ width: depth * FOLDER_INDENT }}
              />
              <Button
                variant="secondary"
                disabled={rows.busy}
                onClick={() => onShowMore(folder.id, listing.nextCursor!)}
              >
                <FormattedMessage
                  id="documents.folder.more"
                  defaultMessage="Show more in {name}"
                  values={{ name: folder.name }}
                />
              </Button>
            </span>
          </td>
        </tr>
      )}
    </tbody>
  );
}

/**
 * Everything a viewer may do to one folder, in one overflow menu
 * (DES-025's pattern, as the document row already follows it).
 *
 * Four verbs, and each opens a dialog: renaming and making one inside
 * collect a name, moving collects a destination, and dissolving asks for
 * a confirmation that says where the contents go. None of them commits
 * from the menu, because none of them has everything it needs by the
 * time the item is pressed.
 */
function FolderActions({
  folder,
  busy,
  intl,
  onDialog,
}: Readonly<{
  folder: ContractFolder;
  busy: boolean;
  intl: IntlShape;
  onDialog: (dialog: FolderDialog) => void;
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={intl.formatMessage(
            { id: "documents.folder.actionsFor", defaultMessage: "Actions for the {name} folder" },
            { name: folder.name },
          )}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onDialog({ mode: "rename", folder })}>
          <Pencil size={16} aria-hidden="true" />
          <FormattedMessage {...FOLDER_ACTION_LABEL.rename} />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDialog({ mode: "move", folder })}>
          <FolderInput size={16} aria-hidden="true" />
          <FormattedMessage {...FOLDER_ACTION_LABEL.move} />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDialog({ mode: "create", parent: folder })}>
          <FolderPlus size={16} aria-hidden="true" />
          <FormattedMessage {...FOLDER_ACTION_LABEL.newInside} />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDialog({ mode: "delete", folder })}>
          <Trash2 size={16} aria-hidden="true" />
          <FormattedMessage {...FOLDER_ACTION_LABEL.delete} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One name, for a folder being made or a folder being renamed.
 *
 * One dialog for both, because it is one form: a folder carries a name
 * and nothing else. Where it lands is the difference, and that is
 * settled before the dialog opens — by the toolbar for the record root,
 * and by the row's own menu for a folder inside another.
 */
function FolderNameDialog({
  folder,
  parent,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  /** The folder being renamed, or null when one is being made. */
  folder: ContractFolder | null;
  /** The folder the new one is being made inside, or null at the record
   * root. Ignored on a rename. */
  parent: ContractFolder | null;
  busy: boolean;
  onClose: () => void;
  /** Answers with the refusal to show, or `null` when the write
   * landed. */
  onConfirm: (name: string) => Promise<string | null>;
}>) {
  const intl = useIntl();
  const [name, setName] = useState(folder?.name ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    // One write at a time, for the composer's reason: a form has more
    // than one way to submit itself.
    if (busy) return;
    const named = name.trim();
    if (named.length === 0) {
      setError(
        intl.formatMessage({
          id: "documents.folder.nameRequired",
          defaultMessage: "Give the folder a name.",
        }),
      );
      return;
    }
    setError(null);
    setError(await onConfirm(named));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          {folder ? (
            <FormattedMessage id="documents.folder.renameTitle" defaultMessage="Rename folder" />
          ) : parent ? (
            <FormattedMessage
              id="documents.folder.createInsideTitle"
              defaultMessage="New folder in {name}"
              values={{ name: parent.name }}
            />
          ) : (
            <FormattedMessage id="documents.folder.createTitle" defaultMessage="New folder" />
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
            <Label htmlFor="folder-name">
              <FormattedMessage id="documents.folder.name" defaultMessage="Name" />
            </Label>
            <Input
              id="folder-name"
              value={name}
              // The viewer opened this dialog to type one thing, so the
              // caret belongs in the box they opened it for. This is a
              // mount inside a click handler, not a page load.
              autoFocus
              autoComplete="off"
              // The seam's own ceiling, which refuses a longer name
              // rather than shortening it.
              maxLength={MAX_FOLDER_NAME_LENGTH}
              onChange={(event) => {
                setName(event.target.value);
                if (event.target.value.trim().length > 0) setError(null);
              }}
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
              <FormattedMessage id="documents.folder.save" defaultMessage="Save" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Where a folder goes (DOC-006).
 *
 * A select over the record's other folders, plus the record root — a
 * tree the drop cannot reach is still reachable from a keyboard, which
 * is the M4 contract on this surface. The folder itself and everything
 * under it are not offered, because the seam refuses a move that would
 * close a cycle and a control that cannot succeed is worse than none.
 *
 * Each destination is named by its whole path, because a bare "2026"
 * says nothing when two groupings each have one.
 */
function MoveFolderDialog({
  recordType,
  folder,
  folders,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  recordType: DocumentRecord["entityType"];
  folder: ContractFolder;
  folders: readonly ContractFolder[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (parentId: string | null) => Promise<string | null>;
}>) {
  const intl = useIntl();
  /** The record root is the empty value, because it is the absence of a
   * parent rather than a folder with an id. */
  const [parentId, setParentId] = useState(folder.parentId ?? "");
  const [error, setError] = useState<string | null>(null);
  const destinations = movableInto(folders, folder.id);
  /** What sits between two names of a destination's path. A mark a
   * reader reads, so it is a message rather than a literal in the
   * joiner (DES-013); the spacing around it is the joiner's. */
  const separator = intl.formatMessage({
    id: "documents.folder.pathSeparator",
    defaultMessage: "/",
  });

  async function submit() {
    if (busy) return;
    setError(null);
    setError(await onConfirm(parentId === "" ? null : parentId));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage
            id="documents.folder.moveTitle"
            defaultMessage="Move {name}"
            values={{ name: folder.name }}
          />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="folder-parent">
              <FormattedMessage id="documents.folder.moveInto" defaultMessage="Move into" />
            </Label>
            <select
              id="folder-parent"
              value={parentId}
              className={CONTROL_CLASS}
              onChange={(event) => setParentId(event.target.value)}
            >
              <option value="">{intl.formatMessage(RECORD_COPY[recordType].recordRoot)}</option>
              {destinations.map((option) => (
                <option key={option.id} value={option.id}>
                  {pathOf(folders, option, separator)}
                </option>
              ))}
            </select>
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
              <FormattedMessage {...FOLDER_ACTION_LABEL.move} />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Where one document is filed (DOC-006, DES-033).
 *
 * A select over the record's folders plus the record root, which is the
 * pointer-free twin of the drop M13/4 will add: every capability of the
 * drop is reachable from a keyboard, which is the M4 contract on this
 * surface.
 *
 * Every folder is a destination — a document may be filed anywhere on
 * its own record, and there is no cycle to avoid the way there is when a
 * folder itself moves. Each one is named by its whole path, because a
 * bare "2026" says nothing when two groupings each have one.
 */
function MoveDocumentDialog({
  recordType,
  document,
  folders,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  recordType: DocumentRecord["entityType"];
  document: ContractDocument;
  folders: readonly ContractFolder[];
  busy: boolean;
  onClose: () => void;
  /** Answers with the refusal to show, or `null` when the write
   * landed. */
  onConfirm: (folderId: string | null) => Promise<string | null>;
}>) {
  const intl = useIntl();
  /** The record root is the empty value, because it is the absence of a
   * folder rather than a folder with an id. */
  const [folderId, setFolderId] = useState(document.folderId ?? "");
  const [error, setError] = useState<string | null>(null);
  /** What sits between two names of a destination's path — a mark a
   * reader reads, so it is a message rather than a literal (DES-013). */
  const separator = intl.formatMessage({
    id: "documents.folder.pathSeparator",
    defaultMessage: "/",
  });

  async function submit() {
    if (busy) return;
    setError(null);
    setError(await onConfirm(folderId === "" ? null : folderId));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage
            id="documents.move.title"
            defaultMessage="Move {title}"
            values={{ title: document.title }}
          />
        </DialogTitle>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-folder">
              <FormattedMessage id="documents.move.into" defaultMessage="File in" />
            </Label>
            <select
              id="document-folder"
              value={folderId}
              className={CONTROL_CLASS}
              onChange={(event) => setFolderId(event.target.value)}
            >
              <option value="">{intl.formatMessage(RECORD_COPY[recordType].recordRoot)}</option>
              {folders.map((option) => (
                <option key={option.id} value={option.id}>
                  {pathOf(folders, option, separator)}
                </option>
              ))}
            </select>
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
              <FormattedMessage {...FOLDER_ACTION_LABEL.move} />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The folder delete, and what it does not do (DOC-006, DES-033).
 *
 * One click and no typed name, unlike DOC-010's erasure: nothing is
 * destroyed here. The child folders are re-filed into this folder's
 * parent — the record root when it has none — so the dialog states where
 * the contents go and then offers the verb. A typed confirmation would
 * be ceremony out of all proportion to a grouping that can be made again
 * in two seconds.
 */
function DeleteFolderDialog({
  recordType,
  folder,
  folders,
  busy,
  onClose,
  onConfirm,
}: Readonly<{
  recordType: DocumentRecord["entityType"];
  folder: ContractFolder;
  folders: readonly ContractFolder[];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<string | null>;
}>) {
  const [error, setError] = useState<string | null>(null);
  const parent =
    folder.parentId === null ? null : folders.find((row) => row.id === folder.parentId);

  async function submit() {
    if (busy) return;
    setError(null);
    setError(await onConfirm());
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>
          <FormattedMessage
            id="documents.folder.deleteTitle"
            defaultMessage="Delete the {name} folder?"
            values={{ name: folder.name }}
          />
        </DialogTitle>
        <p className="mt-4 text-base text-primary">
          {parent ? (
            <FormattedMessage
              id="documents.folder.deleteIntoParent"
              defaultMessage="Anything in it moves into {parent}. Nothing is deleted."
              values={{ parent: parent.name }}
            />
          ) : (
            <FormattedMessage {...RECORD_COPY[recordType].deleteIntoRoot} />
          )}
        </p>
        {error && (
          <p role="alert" className="mt-2.5 text-xs text-status-danger-fg">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
          </Button>
          <Button type="button" variant="danger" disabled={busy} onClick={() => void submit()}>
            <FormattedMessage {...FOLDER_ACTION_LABEL.delete} />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The name of one version, and what pressing it does (M12/2).
 *
 * **A file that reads in the app opens there; a file that does not is
 * saved.** The name is one affordance either way, because "open this"
 * is one intention and a reader should not have to know which family
 * their file is in before they can act on it. Which it does is read off
 * the family the server routed the version to (DOC-004) — this
 * component holds no list of file types.
 *
 * A version that previews is a button, and one that does not is a
 * download link. That difference is not cosmetic: a link that opened a
 * panel would break every expectation a link carries, and a button that
 * downloaded would lose the right-click, the middle-click, and the
 * `download` attribute that names the saved file.
 *
 * The version being read is marked `aria-current`, so a chain with a
 * round open says which round that is.
 */
function OpenVersion({
  document,
  version,
  label,
  reading,
  onRead,
  className,
}: Readonly<{
  document: ContractDocument;
  version: DocumentVersion;
  /** What the row calls this file — the document's title on the current
   * round, the file's own name on a superseded one. */
  label: string;
  reading: string | null;
  onRead: (
    document: ContractDocument,
    version: DocumentVersion,
    trigger: HTMLElement | null,
  ) => void;
  className?: string;
}>) {
  const shared =
    "rounded-chip text-start text-primary hover:text-link hover:underline " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link";

  if (!isPreviewable(version)) {
    return (
      <a
        href={documentDownloadHref(document.id, version.id)}
        // `download` asks the browser to save rather than navigate; the
        // response says the same thing in its own headers, so a browser
        // that ignores the attribute still saves the file.
        download={version.originalFilename}
        // The row's own name may be truncated to one line (a long file
        // name would otherwise push the row's height around); the
        // native tooltip is what still answers "what is this called"
        // without a second, JS-driven tooltip component for one string.
        title={label}
        className={cn(shared, className)}
      >
        {label}
      </a>
    );
  }

  return (
    <button
      type="button"
      aria-current={reading === version.id ? "true" : undefined}
      onClick={(event) => onRead(document, version, event.currentTarget)}
      title={label}
      className={cn(shared, reading === version.id && "underline", className)}
    >
      {label}
    </button>
  );
}

/** What each menu item says, in the words DES-015 asks for: a verb, in
 * sentence case, and no phrase where a word will do. */
/**
 * The copy that names the owning record, keyed by record type. Written
 * out as descriptors rather than picked by a ternary inside the `id`
 * prop, because the message extractor reads ids statically and would
 * drop every key it cannot see (the i18n drift routine then deletes
 * them from `en-US.json`).
 */
const RECORD_COPY = {
  contract: {
    empty: defineMessage({
      id: "documents.empty",
      defaultMessage: "No documents on this contract yet.",
    }),
    recordRoot: defineMessage({
      id: "documents.folder.recordRoot",
      defaultMessage: "The contract itself",
    }),
    deleteIntoRoot: defineMessage({
      id: "documents.folder.deleteIntoRoot",
      defaultMessage: "Anything in it moves onto the contract itself. Nothing is deleted.",
    }),
  },
  matter: {
    empty: defineMessage({
      id: "matters.documents.empty",
      defaultMessage: "No documents on this matter yet.",
    }),
    recordRoot: defineMessage({
      id: "matters.documents.folder.recordRoot",
      defaultMessage: "The matter itself",
    }),
    deleteIntoRoot: defineMessage({
      id: "matters.documents.folder.deleteIntoRoot",
      defaultMessage: "Anything in it moves onto the matter itself. Nothing is deleted.",
    }),
  },
  entity: {
    empty: defineMessage({
      id: "entities.documents.empty",
      defaultMessage: "No documents on this Entity yet.",
    }),
    recordRoot: defineMessage({
      id: "entities.documents.folder.recordRoot",
      defaultMessage: "The Entity itself",
    }),
    deleteIntoRoot: defineMessage({
      id: "entities.documents.folder.deleteIntoRoot",
      defaultMessage: "Anything in it moves onto the Entity itself. Nothing is deleted.",
    }),
  },
  knowledge_item: {
    empty: defineMessage({
      id: "knowledge.documents.empty",
      defaultMessage: "No documents on this Knowledge Item yet.",
    }),
    recordRoot: defineMessage({
      id: "knowledge.documents.recordRoot",
      defaultMessage: "The Knowledge Item itself",
    }),
    deleteIntoRoot: defineMessage({
      id: "knowledge.documents.deleteIntoRoot",
      defaultMessage: "Nothing is deleted.",
    }),
  },
} as const;

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
  moveToFolder: defineMessage({
    id: "documents.action.moveToFolder",
    defaultMessage: "Move to folder",
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
  markExecuted: defineMessage({
    id: "documents.action.markExecuted",
    defaultMessage: "Mark as executed copy",
  }),
  unmarkExecuted: defineMessage({
    id: "documents.action.unmarkExecuted",
    defaultMessage: "Unmark as executed copy",
  }),
} as const;

/** What a folder's own menu says (DES-033). Its own set rather than
 * shared arms, because a folder is dissolved where a document is erased
 * — the same word, two different acts — and one label that served both
 * would be one word standing for two promises. */
const FOLDER_ACTION_LABEL = {
  rename: defineMessage({ id: "documents.folder.action.rename", defaultMessage: "Rename" }),
  move: defineMessage({ id: "documents.folder.action.move", defaultMessage: "Move" }),
  newInside: defineMessage({
    id: "documents.folder.action.newInside",
    defaultMessage: "New folder inside",
  }),
  delete: defineMessage({ id: "documents.folder.action.delete", defaultMessage: "Delete" }),
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
  version,
  designations,
  executedDesignations,
  folders,
  setPrimaryCopy,
  supportingOnly,
  busy,
  canErase,
  canFlag,
  intl,
  onMakePrimary,
  onAddVersion,
  onEditDetails,
  onMoveToFolder,
  onSetConfidential,
  onArchive,
  onRestore,
  onDelete,
  onToggleExecuted,
}: Readonly<{
  document: ContractDocument;
  /** The current version, whose executed pin this menu also offers
   * (CTR-014). A superseded round gets its own menu — see
   * `VersionPinMenu` — because it has no document-level act to sit
   * beside. */
  version: DocumentVersion;
  designations: boolean;
  executedDesignations: boolean;
  folders: boolean;
  setPrimaryCopy: boolean;
  /** Draw only DD-015's append action; every designation and
   * administration act remains absent. */
  supportingOnly: boolean;
  busy: boolean;
  canErase: boolean;
  /** Whether this viewer is one of DD-014's three actors for this
   * document. The item is absent for everybody else, not disabled. */
  canFlag: boolean;
  intl: IntlShape;
  onMakePrimary: () => void;
  onAddVersion: () => void;
  onEditDetails: () => void;
  onMoveToFolder: () => void;
  onSetConfidential: (confidential: boolean) => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onToggleExecuted: () => void;
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
        {supportingOnly ? (
          <DropdownMenuItem onSelect={onAddVersion}>
            <FilePlus2 size={16} aria-hidden="true" />
            <FormattedMessage {...ACTION_LABEL.addVersion} />
          </DropdownMenuItem>
        ) : (
          <>
            {!archived && (
              <>
                {/* Absent on the row that already holds the designation —
                the Primary mark beside the name is what says why. There
                is no clear: a record with paper on it has an
                instrument, so the designation moves or it stays. */}
                {designations && !document.isPrimary && (
                  <DropdownMenuItem onSelect={onMakePrimary}>
                    <Star size={16} aria-hidden="true" />
                    {setPrimaryCopy ? (
                      <FormattedMessage
                        id="knowledge.documents.action.setPrimary"
                        defaultMessage="Set as primary"
                      />
                    ) : (
                      <FormattedMessage {...ACTION_LABEL.makePrimary} />
                    )}
                  </DropdownMenuItem>
                )}
                {/* The other of CTR-014's two designations: which version
                is the signed copy, as opposed to which document is the
                instrument. A distinct verb from Make primary, so the
                two never read as one choice. */}
                {executedDesignations && (
                  <DropdownMenuItem onSelect={onToggleExecuted}>
                    <Pin size={16} aria-hidden="true" />
                    <FormattedMessage
                      {...(version.isExecuted
                        ? ACTION_LABEL.unmarkExecuted
                        : ACTION_LABEL.markExecuted)}
                    />
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
                {/* Filing, and the keyboard twin of the drop M13/4 will add
                (DES-033): a document is filed from a control, never only
                by dragging it. Offered on every document, because moving
                one back out to the record root is the same act. */}
                {folders && (
                  <DropdownMenuItem onSelect={onMoveToFolder}>
                    <FolderInput size={16} aria-hidden="true" />
                    <FormattedMessage {...ACTION_LABEL.moveToFolder} />
                  </DropdownMenuItem>
                )}
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
          </>
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

function KindCell({
  document,
  version,
  rows,
}: Readonly<{
  document: ContractDocument;
  version: DocumentVersion;
  rows: RowContext;
}>) {
  const pill = `whitespace-nowrap rounded-pill px-2 py-0.5 text-xs font-medium ${DOCUMENT_KIND_PILL[version.kind]}`;
  return (
    <td className="px-4 py-2.5">
      {/* The pill sits in a flex line rather than a text line, so it
          centres on the row instead of on a baseline the cell has no
          text to share. */}
      <span className="flex items-center">
        {rows.frozen || document.archivedAt !== null || version.kind === "generated_redline" ? (
          <span className={pill}>{documentKindLabel(rows.intl, version.kind)}</span>
        ) : (
          <select
            aria-label={rows.intl.formatMessage(
              {
                id: "documents.versionKindLabel",
                defaultMessage: "Kind of version {number} of {title}",
              },
              { number: version.versionNumber, title: document.title },
            )}
            className={`${pill} min-h-6 cursor-pointer border-0`}
            value={version.kind}
            disabled={rows.busy}
            onChange={(event) => {
              // Narrowed against the list the options are drawn from,
              // not asserted: the DOM hands back a string.
              const picked = DOCUMENT_VERSION_KINDS.find((kind) => kind === event.target.value);
              if (picked) rows.onKindChange(document, version, picked);
            }}
          >
            {DOCUMENT_VERSION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {documentKindLabel(rows.intl, kind)}
              </option>
            ))}
          </select>
        )}
      </span>
    </td>
  );
}

/**
 * The version's number, and the signed copy (CTR-014), if this is it.
 *
 * No "Current" mark: `chainOf` (lib/documents.ts) defines the row this
 * cell sits on as the version the API already flagged current — every
 * head row is current by construction, every superseded row never is,
 * so the mark could only ever repeat what the row's own position (above
 * or under "Show earlier versions") already says. The Executed mark is
 * the API's own, so the section cannot disagree with the record about
 * which round is the signed copy; it wears the same quiet treatment as
 * the version chip because a coloured Executed here would argue with
 * the Executed *kind* pill in the previous column, which is a different
 * fact wearing the same word.
 */
function VersionCell({ version, intl }: Readonly<{ version: DocumentVersion; intl: IntlShape }>) {
  return (
    <td className="px-4 py-2.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-chip bg-badge-count-bg px-1.5 py-px text-xs font-medium text-badge-count-fg">
          {intl.formatMessage(
            { id: "documents.versionNumber", defaultMessage: "v{number}" },
            { number: version.versionNumber },
          )}
        </span>
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
 * The executed pin's own menu, for a superseded round (CTR-014).
 *
 * A superseded round has no document-level act — no add version, no
 * move, no archive — so it earns no document menu of its own. The
 * pin is the one question that still applies to it, and it applies to
 * this version alone, so it gets a one-item menu of its own rather
 * than folding into the current row's `DocumentActions`, which speaks
 * for a different version.
 */
function VersionPinMenu({
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
  onToggle: (document: ContractDocument, version: DocumentVersion) => void;
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={intl.formatMessage(
            {
              id: "documents.actionsForVersion",
              defaultMessage: "Actions for version {number} of {title}",
            },
            { number: version.versionNumber, title: document.title },
          )}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onToggle(document, version)}>
          <Pin size={16} aria-hidden="true" />
          <FormattedMessage
            {...(version.isExecuted ? ACTION_LABEL.unmarkExecuted : ACTION_LABEL.markExecuted)}
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModifiedCell({ version }: Readonly<{ version: DocumentVersion }>) {
  return <td className="px-4 py-2.5 text-sm text-muted">{formatShortDate(version.createdAt)}</td>;
}

function UploaderCell({ version, intl }: Readonly<{ version: DocumentVersion; intl: IntlShape }>) {
  return (
    <td className="px-2 py-2.5">
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
  record,
  document,
  seedKind,
  supportingOnly,
  onClose,
  onBatch,
  onSaved,
}: Readonly<{
  record: DocumentRecord;
  /** The document being added to, or undefined for a new one. */
  document: ContractDocument | undefined;
  /** What the kind picker starts on. Only a renewal routed here to be
   * papered as an amendment sets it (M16/5); every other way in starts
   * on the draft the negotiation usually opens with. It is a seed and
   * not a lock — the person may pick another kind before uploading. */
  seedKind: HandSetDocumentVersionKind | undefined;
  /** A Contributor may use this one-file supporting upload action, but
   * not the folder picker that recreates and administers a tree. */
  supportingOnly: boolean;
  onClose: () => void;
  /** Hand several chosen files to the batch confirmation (M13/4,
   * M13/5). This is the drop's pointer-free twin: the picker is where a
   * keyboard reaches bulk intake, so it has to reach the same dialog —
   * and the directory picker beside it is folder drop's twin, handing
   * over the same shape with a path on each file. */
  onBatch: (files: DroppedFile[]) => void;
  onSaved: (document: ContractDocument) => void;
}>) {
  const intl = useIntl();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<HandSetDocumentVersionKind>(seedKind ?? "draft_ours");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The file input is the real control; the button beside it is what a
   * person sees, because a bare file input cannot be styled to the
   * system. */
  const picker = useRef<HTMLInputElement>(null);
  /** And the directory picker beside it, which is folder drop's
   * pointer-free twin (DES-033 §7). Its own input, because
   * `webkitdirectory` is set on the element rather than passed to the
   * dialog it opens — one input cannot offer both. */
  const directoryPicker = useRef<HTMLInputElement>(null);

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
      : await uploadRecordDocument(record, draft);
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
                // Many files at once on a new document (DOC-011); one on
                // a chain, because a version is one file and picking
                // three for one round is a question with no answer.
                multiple={document === undefined}
                // Any file type (DOC-004): the seam accepts whatever the
                // counterparty sent, so the picker offers no filter.
                onChange={(event) => {
                  const chosen = [...(event.target.files ?? [])];
                  if (chosen.length > 1) {
                    // Picked flat, so every file lands at the record
                    // root — the batch's shape is the drop's, with an
                    // empty path on each row.
                    onBatch(chosen.map((one) => ({ file: one, path: [] })));
                    return;
                  }
                  const one = chosen[0] ?? null;
                  if (one) setError(null);
                  setFile(one);
                }}
              />
              {/* Folder drop's pointer-free twin (DES-033 §7). The
                  browser puts the path each file sat at on the file
                  itself, so the structure survives a pick exactly as it
                  survives a drop — one file or a hundred, a directory is
                  always a batch, because what was picked is a structure
                  and the composer's own fields are one round's. */}
              {document === undefined && !supportingOnly && (
                <input
                  ref={directoryPicker}
                  id="document-directory"
                  type="file"
                  className="sr-only"
                  tabIndex={-1}
                  multiple
                  // Named for itself. It is out of the tab order and the
                  // button beside it is what a person reaches, but the
                  // input is still the control the pick lands on, and an
                  // unnamed one says nothing about which field it fills.
                  aria-label={intl.formatMessage({
                    id: "documents.composer.folder",
                    defaultMessage: "Folder",
                  })}
                  // React does not know this attribute, and the DOM does.
                  {...{ webkitdirectory: "" }}
                  onChange={(event) => {
                    const chosen = [...(event.target.files ?? [])];
                    if (chosen.length > 0) onBatch(filesFromDirectoryPicker(chosen));
                  }}
                />
              )}
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
                {document === undefined ? (
                  <FormattedMessage
                    id="documents.composer.chooseMany"
                    defaultMessage="Choose files"
                  />
                ) : (
                  <FormattedMessage id="documents.composer.choose" defaultMessage="Choose file" />
                )}
              </Button>
              {document === undefined && !supportingOnly && (
                <Button
                  type="button"
                  variant="secondary"
                  id="document-directory-choose"
                  aria-labelledby="document-file-label document-directory-choose"
                  onClick={() => directoryPicker.current?.click()}
                >
                  <FolderPlus size={16} aria-hidden="true" />
                  <FormattedMessage
                    id="documents.composer.chooseFolder"
                    defaultMessage="Choose folder"
                  />
                </Button>
              )}
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
              onChange={(event) => {
                const picked = DOCUMENT_VERSION_KINDS.find(
                  (option) => option === event.target.value,
                );
                if (picked) setKind(picked);
              }}
            >
              {DOCUMENT_VERSION_KINDS.map((option) => (
                <option key={option} value={option}>
                  {documentKindLabel(intl, option)}
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
