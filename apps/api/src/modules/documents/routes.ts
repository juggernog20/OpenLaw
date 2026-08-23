// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A contract's paper (M11/2, M11/3, M11/4, M11/5) — the first path in
 * the codebase that puts a file anywhere: upload a draft, append the
 * next revision, read the chain, download any version of it, keep the
 * record's metadata legible without touching the files, say which
 * document is the instrument and which of its versions is signed, and
 * take a document off the record either way DOC-010 gives.
 *
 * **Two tables, one logical record** (DOC-001). A `documents` row is the
 * thing the contract links to; the bytes live in `document_versions`,
 * numbered 1..n and immutable.
 *
 * **Two designations, each answering one question** (CTR-014). The
 * primary document says which document *is* the contract; everything
 * else on the record is a loose attachment beside it. The executed pin
 * says which version of a document is the signed one. The first sits on
 * the contract, so at most one document holds it and the rule is the
 * column's shape rather than a check. A Contributor's supporting upload
 * never takes an empty designation; the next Member+ upload does. The
 * second sits on the document
 * and is explicit: a version tagged `executed` is what its uploader
 * called that round, and the pin is what the team decided — the two are
 * never inferred from one another.
 *
 * **Only a version's kind is correctable.** One PATCH updates that one
 * column. It cannot move the bytes, number, note, author, place in the
 * chain, or executed pin. There is no per-version DELETE (CTR-014).
 *
 * **The next version number is assigned under the owning contract's row
 * lock.** Two people uploading a revision at the same moment serialize
 * behind that lock and take consecutive numbers, so the chain has
 * neither a collision nor a gap. The unique index on (document,
 * number) stands behind it as the database's own last word.
 *
 * **Access is inherited, never held here** (DOC-008, DD-014). There is
 * no document team. Every read and every write first answers the owning
 * contract's reach question with `contractTeamScope`, the same predicate
 * the contract record, its comments, and its feed are read through, so
 * a viewer who cannot reach the contract is answered exactly as they are
 * for a contract that does not exist — on the list, on the download, and
 * on the upload alike. One predicate is what keeps those four answers
 * from drifting apart.
 *
 * **The per-document Confidential flag composes in front of that, and
 * does not replace it** (M11/6, DD-014). A viewer must pass both gates:
 * the contract's, and then the document's. `documentAudienceScope`
 * narrows one sensitive file to the contract's named team, the
 * contract's Owner, and Administrators, even on a contract that is open
 * to everyone. It rides beside the contract scope in every read here, so
 * a document outside a viewer's audience is absent from the list, absent
 * from the count the list is taken from, and answered 404 on the
 * download and on every mutation — the same answer a document that was
 * never uploaded gives. **Nothing renders a locked placeholder**, here
 * or on the web: a placeholder is a statement that the file exists.
 *
 * Setting and clearing the flag is a narrower act than reaching the
 * document. Three actors may do it — an Administrator, the person who
 * uploaded the document, and the owning contract's Owner — and a viewer
 * who reaches the document but is none of them is refused plainly, the
 * way the contract's own flag refuses them.
 *
 * **A Contributor on the team reads, downloads, and supplies supporting
 * paper** (DD-015, CTR-021). They may create a root-level supporting
 * Document and append a Version to a non-primary supporting chain. Every
 * designation and administration act remains Member+, and reach still
 * comes only from the owning record's live team predicate.
 *
 * **The blob is written before the row commits** (DOC-012). The upload
 * streams straight through the storage adapter — never buffered whole in
 * memory, never staged on disk — while the same pass counts the bytes
 * and computes the SHA-256. A transaction that then fails leaves an
 * orphaned blob, which is harmless and accepted in v1: keys are minted
 * from ids and never reused, so nothing later can collide with it.
 *
 * **Any file type is accepted** (DOC-004). The declared MIME type is
 * recorded as a hint for M12's rendering and is never a decision: the
 * download always goes out as an attachment, with sniffing turned off.
 *
 * **Downloads stream through the API** behind the session and the same
 * access predicate. There are no presigned URLs — one authentication
 * path, and the local filesystem driver has no other way anyway.
 *
 * **An email reads as a message, not as a blob** (DOC-004, M12/5). An
 * uploaded MSG or EML is parsed in process — no doc engine, no
 * conversion, and nothing derived is stored — and answered as headers, a
 * sanitized body, and a list of the files that came with it. Each of
 * those files has its own download and its own preview, and both sit
 * behind the same two predicates the version does: an attachment is not
 * a side door past the contract gate or the confidentiality flag.
 *
 * **What a preview streams is not always what was uploaded** (DOC-004,
 * M12/4). A PDF and a raster image are drawn as they are. A Word
 * document and a PowerPoint deck are drawn from the PDF rendition the
 * pipeline converted them to, because no browser draws a DOCX — and
 * that conversion is what carries the tracked changes and the comments
 * DOC-004 promises are visible. The download is untouched by any of it:
 * it always answers the bytes a person uploaded. The rendition read says
 * where the conversion has got to, so the panel can show a preparing
 * state and poll; both new reads sit behind the same two predicates
 * every other document read does, so rendering opens no side door.
 *
 * **Two removals, for two different problems** (DOC-010). Archive is the
 * soft delete and it answers the wrong upload: anyone who can reach and
 * write the record archives a document, it leaves the list and the
 * count, and nothing is destroyed — restore is one write, so a wrong
 * archive is a two-second fix. Hard delete is the lawful-erasure answer:
 * Administrator-only, whole-document, typed confirmation, and it takes
 * the version rows and the stored blobs with it. There is no per-version
 * delete, because a chain you can cut pieces out of is not negotiation
 * history.
 *
 * **The activity and audit entries survive the erasure and name what was
 * deleted.** Entries hang off the owning contract, never off the
 * document, and every one of them carries the document's title in its
 * payload — so the record still says which file was uploaded, revised,
 * and finally destroyed after there is no row left to read a name from.
 *
 * **Every mutation writes its own activity action** on the owning
 * contract (DD-017): creating a document, adding a version to one,
 * editing what the record says, naming the instrument, pinning or
 * clearing the signed copy, and the two removals are eight different
 * things that happened, so the feed narrates eight different sentences
 * rather than one generic edit.
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import {
  and,
  asc,
  contracts,
  desc,
  documentFolders,
  documents,
  documentVersionRenditions,
  documentVersions,
  documentVersionText,
  DOCUMENT_VERSION_KINDS,
  HAND_SET_DOCUMENT_VERSION_KINDS,
  eq,
  inArray,
  isNotNull,
  isNull,
  matters,
  or,
  sql,
  TEXT_SOURCES,
  users,
  type Executor,
  type HandSetDocumentVersionKind,
  type SQL,
  type Transaction,
} from "@openlaw/db";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import {
  contractTeamScope,
  documentAudienceScope,
  NO_CONTRACT,
  reachedContract,
  type ReachedContract,
} from "../../lib/contract-access.js";
import { matterTeamScope, NO_MATTER, reachedMatter } from "../../lib/matter-access.js";
import {
  EmailUnreadableError,
  isEmail,
  parseStoredEmail,
  type EmailAttachment,
  type ParsedEmail,
} from "../../lib/email/parse.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import {
  conversionFormatOf,
  previewContentType,
  RENDER_FAMILIES,
  renderFamilyOf,
  RENDITION_CONTENT_TYPE,
} from "../../lib/render-family.js";
import {
  asUploadRefusal as asSharedUploadRefusal,
  attachmentDisposition,
  inlineDisposition,
  MAX_FILENAME_LENGTH,
  refuseOversize as refuseSharedOversize,
  uploadFilename,
  withStoredBlob,
} from "../../lib/uploads.js";
// A folder named by a filing, or by a folder-filtered read (M13/3).
// Both the check and its refusal are imported rather than restated: a
// folder on another contract answers exactly as one that was never
// created (DOC-006), and this module asked that question its own way
// until #254 — a second implementation is a second chance for the two
// answers to differ.
// And the folder rules a dropped path is held to (M13/5, DOC-011). The
// find-or-create is imported for the same reason: it decides a segment
// against its siblings by the very comparison that refuses a duplicate,
// and a second copy of that comparison here would be a way for a path
// differing only in case to make a folder the create route would have
// refused.
import {
  findOrCreateFolderPath,
  folderOnRecord,
  folderPathSegments,
  MAX_FOLDER_PATH_LENGTH,
  NO_FOLDER,
  type FolderDestination,
} from "./folders.js";
import {
  insertDocumentVersion,
  nextVersionNumber,
  requestDerivations,
  updateDocumentVersionKind,
  versionStorageKey,
} from "../../lib/document-versions.js";
import { needsDisplayRendition } from "../../pipeline/display-conversion.js";
import { extractsText } from "../../pipeline/text-extraction.js";

/** The contract read floor (CTR-021), which is the document floor too:
 * a Contributor reads and downloads the paper on a contract they are
 * on. The role alone opens nothing — the reach predicate narrows it to
 * the records they hold a `contract_team` row on. */
const requireDocumentReader = requireRole("administrator", "legal_team_member", "contributor");

/** Supporting uploads are the one Document write Contributors receive in
 * M23. Reach still comes from the owning record's live team predicate; the
 * route-level role floor alone grants nothing. */
const requireSupportingUploader = requireRole("administrator", "legal_team_member", "contributor");

/** Every Document administration action keeps the Member+ floor. */
const requireMember = requireRole("administrator", "legal_team_member");

/** Hard deletion is the Administrator's alone (DOC-010). It is the only
 * act in this module that destroys anything, and it is refused for
 * every other role plainly — a viewer who reaches the record already
 * knows the document is there, so a 404 would read as a bug. */
const requireAdministrator = requireRole("administrator");

/** A document on a contract this viewer cannot reach answers exactly as
 * `NO_CONTRACT` has the record itself answer. Its own id says nothing
 * about which record it belongs to, so a refusal here would be the leak
 * the 404 exists to prevent. */
const NO_DOCUMENT = "No document exists with this reference.";

/** CTR-003's reference, as every contract route takes it. */
const NumberParams = z.object({ number: z.coerce.number().int().positive() });

/** An opaque text primary key, bounded rather than shaped — no route in
 * this API asserts a UUID pattern, and a well-formed id for a record the
 * viewer cannot reach answers 404 anyway. */
const MAX_RECORD_ID_LENGTH = 64;

const RecordIdSchema = z.string().min(1).max(MAX_RECORD_ID_LENGTH);

const DocumentParams = z.object({ documentId: RecordIdSchema });

const VersionParams = z.object({
  documentId: RecordIdSchema,
  versionId: RecordIdSchema,
});

/**
 * One file inside a rendered email, addressed by where it sits in the
 * message (M12/5).
 *
 * The position is the identity because the thing it indexes into cannot
 * change: a version's bytes are immutable (DOC-001), so parsing the same
 * blob always produces the same list in the same order. There is no row
 * to give an attachment an id of its own, and inventing one would mean
 * storing a parse the panel can redo in milliseconds.
 *
 * Bounded, and the bound is an inclusive position rather than a count: a
 * position this far into a message names no attachment on any of them,
 * and answering it would cost a blob read and a parse before the list
 * could say so.
 */
const MAX_ATTACHMENT_INDEX = 1000;

const AttachmentParams = z.object({
  documentId: RecordIdSchema,
  versionId: RecordIdSchema,
  attachmentIndex: z.coerce.number().int().nonnegative().max(MAX_ATTACHMENT_INDEX),
});

/** What changed in this round, in one line — capped where the record's
 * other short free text is. */
const MAX_NOTE_LENGTH = 2000;

/**
 * The longest media type worth storing. RFC 6838 caps each half of a
 * type at 127 characters, and parameters take the rest; anything past
 * this is not a declaration a client meant.
 */
const MAX_MIME_TYPE_LENGTH = 255;

/**
 * The shape of a media type: `type/subtype`, then any number of
 * `; parameter=value`, all of it drawn from the RFC 9110 token charset.
 *
 * This checks the shape of the declaration, never the file. Any *type*
 * is still accepted (DOC-004) — the value is a client-supplied hint,
 * stored unverified and never acted on.
 */
const MIME_TYPE_PATTERN = /^[!#$%&'*+.^_`|~\w-]+\/[!#$%&'*+.^_`|~\w-]+(?:\s*;[ -~]*)?$/;

const KindSchema = z.enum(DOCUMENT_VERSION_KINDS);
const HandSetKindSchema = z.enum(HAND_SET_DOCUMENT_VERSION_KINDS);

/** The uploader, as every person on a record is drawn (DES-018). */
const PersonSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});

const VersionSchema = z.object({
  id: z.string(),
  /** 1..n; the highest is the current version (DOC-001). */
  versionNumber: z.int().positive(),
  kind: KindSchema,
  /** What the uploader said about this round; NULL when they said
   * nothing. */
  note: z.string().nullable(),
  /** The name the file arrived under, and the name a download offers
   * back. */
  originalFilename: z.string(),
  /** What the upload declared it was — a rendering hint (DOC-004),
   * never a decision. */
  mimeType: z.string(),
  /**
   * Which of DOC-004's families this file belongs to, and therefore
   * which surface the doc panel opens for it (M12/2).
   *
   * Routed on the server from the declared type and the filename, so
   * the panel holds no copy of that table and a family added later
   * reaches every client at once. `pdf` and `image` render in the panel
   * today; `word`, `presentation`, and `email` show a download card
   * until M12/3 and M12/4 flip them; `other` is download-only for good.
   *
   * It is a hint about how to draw the file and never a statement about
   * what the bytes are. The preview read decides for itself what to
   * call them, from the same table.
   */
  renderFamily: z.enum(RENDER_FAMILIES),
  /** Counted by the server as the bytes streamed past. */
  byteSize: z.int().nonnegative(),
  /** Lowercase hex SHA-256, computed over the same pass. */
  checksumSha256: z.string(),
  uploadedBy: PersonSchema,
  createdAt: z.iso.datetime({ offset: true }),
  /**
   * Which one of the chain is current — the highest version number
   * (DOC-001), and the answer to "which file matters now".
   *
   * Said here rather than left to be inferred from the ordering. A
   * client that read the chain and took the last row would be right
   * only for as long as the order holds, and the pin is the one fact
   * the whole view is built around, so the server states it.
   */
  isCurrent: z.boolean(),
  /**
   * Whether this is the version the team pinned as the signed one
   * (CTR-014). At most one version of a document carries it, and most
   * documents carry it on none.
   *
   * Not the same question as `kind === "executed"`, and deliberately not
   * derived from it: the kind is what the uploader called that round,
   * and the pin is what the team decided is the executed copy. M15's
   * e-signature return will set the pin on a file nobody tagged
   * (CTR-013), and a chain can hold two rounds both called `executed`
   * with only one of them signed.
   */
  isExecuted: z.boolean(),
});

const DocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** What the record is, in the team's own words (DOC-007). */
  description: z.string().nullable(),
  /**
   * Whether this document is the contract's instrument (CTR-014).
   * At most one document on a contract carries it. The first Member+
   * upload takes an empty designation; a Contributor's supporting
   * upload never does. From there the designation moves. Every other
   * document on the record is a loose attachment beside the primary chain.
   */
  isPrimary: z.boolean(),
  /**
   * The whole chain, in order 1..n, exactly one row of it current
   * (DOC-001). Superseded versions stay in it and stay downloadable:
   * the chain is the negotiation history, so reconstructing what was on
   * the table in round two is reading round two's row.
   */
  versions: z.array(VersionSchema),
  /**
   * When this document was archived — DOC-010's soft delete — or NULL
   * while it is on the record's list and in its count.
   *
   * Stated rather than left to be inferred from which list the row came
   * back in: the archived view draws live and archived rows together,
   * and it has to be able to tell them apart without counting on the
   * order they arrived in.
   */
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  /**
   * DD-014's per-document flag: whether this one file is narrowed to
   * the contract's named team, its Owner, and Administrators — even
   * when the contract itself is open.
   *
   * It is only ever `true` for a viewer who is inside that audience,
   * because a viewer outside it never receives the row at all. It is
   * therefore a mark on a document the reader can see, never a
   * placeholder for one they cannot.
   */
  isConfidential: z.boolean(),
  /**
   * Which folder on the owning record this document is filed in, or NULL
   * at the record root (DOC-006, M13/3).
   *
   * Stated on the row rather than inferred from which listing it came
   * back in: the unfiltered list draws filed and unfiled documents
   * together, and the Move control has to know where the document is
   * before it can offer somewhere else.
   *
   * A folder carries no audience of its own, so this leaks nothing: the
   * name behind the id is visible to everybody who reaches the record.
   */
  folderId: z.string().nullable(),
  createdBy: PersonSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

const DocumentsEnvelope = z.object({
  documents: z.array(DocumentSchema),
  /** Pass back as `cursor` for the next page. NULL when this page is the
   * end of the record's paper (CTR-024). A write answers the first page
   * and its cursor, so a section that had paged further starts again
   * from the top — the list it is given is the list it draws. */
  nextCursor: z.string().nullable(),
});
const DocumentEnvelope = z.object({ document: DocumentSchema });

/**
 * What the extracted-text read can say (DOC-005, M12/3).
 *
 * Four answers, and the fourth is why this is a state rather than a
 * status code. `pending`, `ready`, and `failed` are the derivation's own
 * three states. `unsupported` is the file that will never have text — an
 * image, a spreadsheet — and it is said plainly so a caller stops asking
 * rather than polling for something that is not coming.
 *
 * None of them is `404`. A missing document has one answer here and it
 * is the silent-omission one (DD-014), so a state and an absence must
 * never be the same response.
 */
const TEXT_STATES = ["pending", "ready", "failed", "unsupported"] as const;

const ExtractedTextSchema = z.object({
  state: z.enum(TEXT_STATES),
  /**
   * Where the text came from (DOC-005): a PDF's own text layer, or OCR
   * over pictures of pages. NULL unless the state is `ready`.
   *
   * Stated because the two are not equally trustworthy — OCR text is a
   * machine's reading of a photograph — and a surface that quotes it
   * should be able to say so.
   */
  source: z.enum(TEXT_SOURCES).nullable(),
  /**
   * The words. NULL unless the state is `ready`; an empty string is a
   * different answer and a legitimate one, because a blank page was read
   * successfully and had nothing on it.
   *
   * It is an index, never a rendering (DOC-005). What a reader sees is
   * always the original file the preview streams.
   */
  text: z.string().nullable(),
  /** When the derivation last moved, so a poller can tell a job that is
   * working from one that is wedged. NULL for a file that has no
   * derivation at all. */
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
});

const ExtractedTextEnvelope = z.object({ text: ExtractedTextSchema });

/**
 * What the display-rendition read can say (DOC-004, M12/4).
 *
 * The same four answers the extracted-text read gives, and for the same
 * reason. `pending`, `ready`, and `failed` are the conversion's own three
 * states, so the panel can show a preparing state and poll until the
 * preview lands. `unsupported` is the file that needs no conversion at
 * all — a PDF, an image, a spreadsheet — and it is said plainly so a
 * caller stops asking.
 *
 * None of them is `404`. A document the reader cannot reach has one
 * answer here and it is the silent-omission one (DD-014).
 */
const RENDITION_STATES = ["pending", "ready", "failed", "unsupported"] as const;

const RenditionSchema = z.object({
  state: z.enum(RENDITION_STATES),
  /** When the conversion last moved, so a poller can tell a job that is
   * working from one that is wedged. NULL for a file that has no
   * conversion at all. */
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
});

const RenditionEnvelope = z.object({ rendition: RenditionSchema });

/**
 * What the email read answers (DOC-004, M12/5).
 *
 * An uploaded MSG or EML reads as a message rather than as a blob: who
 * sent it, who it went to, when, what it said, and what came with it.
 * Every field is what the parser found, and the parser is handed bytes
 * nobody in this system wrote — so every one of them is nullable, and
 * none of them is trusted.
 */
const EmailAddressSchema = z.object({
  /** The display name, or NULL when the message carried only an
   * address. */
  name: z.string().nullable(),
  /** The address, or NULL when the message named somebody it could not
   * resolve — an Exchange directory entry with no SMTP form. */
  address: z.string().nullable(),
});

const EmailAttachmentSchema = z.object({
  /**
   * Where the file sits in the message, counted from zero, and the id
   * every attachment address uses.
   *
   * A version's bytes are immutable (DOC-001), so the same parse always
   * lists the same files in the same order and this number always names
   * the same file.
   */
  index: z.int().nonnegative(),
  /** What the message called it, or a name the parser made when it
   * called it nothing — a download has to offer some name. */
  filename: z.string(),
  /** What the message declared it was. A rendering hint (DOC-004), never
   * a decision: the attachment preview sets its own type from the same
   * routing table every other preview uses. */
  mimeType: z.string(),
  byteSize: z.int().nonnegative(),
  /**
   * Which of DOC-004's families this attachment belongs to, routed on
   * the server exactly as a stored version's is.
   *
   * It is what tells the panel whether opening this file keeps a reader
   * in the app: a PDF and a raster image open on the panel's own
   * surfaces, and everything else is a download.
   */
  renderFamily: z.enum(RENDER_FAMILIES),
  /**
   * Whether the body referred to this file rather than presenting it —
   * a signature logo, a screenshot pasted into the message.
   *
   * Listed either way, because the sanitized body draws no images at
   * all and an inline attachment nobody listed would be unreachable.
   */
  isInline: z.boolean(),
});

const EmailSchema = z.object({
  subject: z.string().nullable(),
  from: EmailAddressSchema.nullable(),
  to: z.array(EmailAddressSchema),
  cc: z.array(EmailAddressSchema),
  bcc: z.array(EmailAddressSchema),
  /** When it was sent. NULL when the message carried no readable date —
   * a broken `Date` header is not a broken message. */
  date: z.iso.datetime({ offset: true }).nullable(),
  /**
   * The HTML body, **sanitized on the server** — never the sender's own
   * markup (DOC-004). NULL when the message had no HTML body.
   *
   * Scripts, frames, styles, and images are gone: nothing in it runs and
   * nothing in it loads, so a tracking pixel cannot report that a lawyer
   * opened a disclosed email. An attached image is in the list below,
   * where it is downloadable and — if it is a raster image — openable in
   * the panel.
   */
  html: z.string().nullable(),
  /** The plain-text body as the message carried it, or NULL when it
   * carried only HTML. */
  text: z.string().nullable(),
  attachments: z.array(EmailAttachmentSchema),
});

const EmailEnvelope = z.object({ email: EmailSchema });

/** What the record is called, and what it says about itself (DOC-007).
 * The title is bounded where the contract's own is; the description is
 * the same free text at the same ceiling. */
const TitleSchema = z.string().trim().min(1).max(200);
const DescriptionSchema = z.string().trim().max(10_000);

/**
 * The metadata edit — the two things about a document that are editable
 * at all. Both are optional, because DES-017 commits one field at a
 * time; a body carrying neither changes nothing and is answered with the
 * row as it stands.
 */
const MetadataPatch = z.object({
  title: TitleSchema.optional(),
  description: DescriptionSchema.nullable().optional(),
  /**
   * DD-014's per-document flag, set or cleared. It rides the per-field
   * PATCH as the contract's own flag does, and for the same two
   * reasons: it is one field of the record, and it has an actor set
   * narrower than the route's, so it keeps its own audit verb rather
   * than joining the changed map.
   */
  isConfidential: z.boolean().optional(),
  /**
   * Where this document is filed (DOC-006, M13/3): a folder on the
   * document's own record, or `null` for the record root.
   *
   * `null` and omitting the field are two different requests, exactly as
   * they are on a folder's own move: one takes the document out of
   * whatever folder it is in, the other leaves it where it is.
   *
   * It rides the per-field PATCH rather than taking a route of its own,
   * because filing is one field of the document. It keeps its own audit
   * verb for the confidential flag's reason: a move is an act somebody
   * did, not one key inside an edit.
   */
  folderId: RecordIdSchema.nullable().optional(),
});

/** CTR-014's one correctable field. Strict so a caller cannot send a
 * note or any other version fact and have it ignored in silence. */
const VersionKindPatch = z.strictObject({ kind: HandSetKindSchema });

/**
 * DOC-010's typed confirmation, as the seam takes it: the Administrator
 * sends back the title of the document they are destroying.
 *
 * It is a server rule rather than a dialog's manners. The dialog can be
 * skipped — this route is one `DELETE` away from any tool that holds an
 * Administrator's cookie — and the whole point of the ceremony is that
 * nothing this irreversible happens without the actor naming its
 * subject. Comparison is exact after trimming: a near-miss is refused
 * rather than accepted, because "close enough" is not a thing to say
 * about an erasure.
 *
 * Bounded by the filename's ceiling, not the title patch's. A title is
 * seeded from the uploaded filename, which may run to
 * `MAX_FILENAME_LENGTH` — longer than `TitleSchema` allows a rename to
 * set. The confirmation must be able to say every title a document can
 * actually hold, or a long-named document could never be erased at all.
 */
const HardDeleteBody = z.object({
  confirmTitle: z.string().trim().min(1).max(MAX_FILENAME_LENGTH),
});

/** What a hard delete answers: the whole record's paper, as it stands
 * with the document gone. The list, because the erasure may also have
 * left the record without an instrument. */
const HardDeleteResponse = DocumentsEnvelope;

/** Whether a read wants the archived rows beside the live ones — the
 * same query the contracts list and the registry take. */
const ArchivedQuery = z.object({
  includeArchived: z.enum(["true", "false"]).optional(),
});

/**
 * How many documents one read answers (CTR-024).
 *
 * Server-fixed, matching the contract list. It counts **documents**, not
 * versions: a document's chain rides with it whole, because a chain
 * split across two pages is not a negotiation history. A chain long
 * enough to matter on its own is a bound of its own, and this is not it.
 */
const PAGE_SIZE = 50;

/** A cursor is a document id, and nothing longer is worth reading. */
const CursorSchema = z.string().min(1).max(64);

/**
 * The listing context the record root is asked for by name (M13/3).
 *
 * A folder filter has three answers — every document on the record, the
 * documents in one folder, and the documents filed nowhere — and the
 * third has no id to be addressed by. So it is addressed by a word, and
 * the word is safe to reserve: every id in this API is a uuidv7, so no
 * folder can ever be called this.
 */
const ROOT_FOLDER = "root";

/**
 * Which listing this read is about (DOC-006, DES-031).
 *
 * Omitted is the record's whole paper, which is what the list has always
 * answered. `root` is the documents filed in no folder, which is what
 * the tree draws beneath its folder rows. Anything else is a folder's
 * own id, and the paging foot then applies within that folder rather
 * than across the record — a heavy folder pages on its own.
 */
const FolderQuery = z.object({
  folder: z.union([z.literal(ROOT_FOLDER), CursorSchema]).optional(),
});

/**
 * What both multipart uploads carry, described for the OpenAPI document
 * only.
 *
 * The parser hands the request over as a stream rather than as a parsed
 * body, so there is nothing for a validator to run against here and the
 * schema accepts anything. The parts are checked one at a time in the
 * handler, as they arrive — which is the only way to refuse an
 * oversized file without first storing it. The metadata below states
 * what the form carries so the generated client and the API docs are
 * not silent about it.
 */
const UPLOAD_FIELDS = {
  file: {
    type: "string",
    format: "binary",
    description: "The file itself. Any type is accepted (DOC-004).",
  },
  kind: {
    type: "string",
    enum: [...HAND_SET_DOCUMENT_VERSION_KINDS],
    description:
      "What this version is in the negotiation (CTR-014). Defaults to " +
      "`draft_ours`. Must be sent before the file part.",
  },
  note: {
    type: "string",
    maxLength: MAX_NOTE_LENGTH,
    description:
      "What changed in this round, kept beside the file. Must be sent " + "before the file part.",
  },
} as const;

/**
 * Appending a round to an existing chain (DOC-001).
 *
 * No destination: a version lands where its document is already filed,
 * and a folder field here would be a second answer to a question the
 * document has already answered. The handler reads none, so the document
 * says none.
 */
const VersionUploadForm = z.any().meta({
  type: "object",
  properties: { ...UPLOAD_FIELDS },
  required: ["file"],
});

/**
 * Creating a document, which is the one upload that decides where the
 * file is filed (DOC-006, DOC-011).
 */
const CreateUploadForm = z.any().meta({
  type: "object",
  properties: {
    ...UPLOAD_FIELDS,
    folderId: {
      type: "string",
      maxLength: MAX_RECORD_ID_LENGTH,
      description:
        "Where the file is filed: a folder already on this record " +
        "(DOC-006), or omitted for the record root. Must be sent before " +
        "the file part.",
    },
    folderPath: {
      type: "string",
      maxLength: MAX_FOLDER_PATH_LENGTH,
      description:
        "A relative folder path, `/` separated, find-or-created beneath " +
        "`folderId` before the document is filed into its last segment " +
        "(DOC-011). Must be sent before the file part.",
    },
  },
  required: ["file"],
});

/** A stored blob, as the download route needs it described. */
const DownloadSchema = z.any().meta({ type: "string", format: "binary" });

/** One form field the upload accepts, as the parser reports it before
 * the file part arrives. */
function fieldValue(fields: Record<string, unknown>, name: string): string | undefined {
  const entry = fields[name];
  if (!entry || typeof entry !== "object") return undefined;
  const part = entry as { type?: unknown; value?: unknown };
  return part.type === "field" && typeof part.value === "string" ? part.value : undefined;
}

export const documentsRoutes: FastifyPluginAsyncZod = async (app) => {
  /** One document this viewer reaches, as the routes here need it. */
  interface ReachedDocument {
    id: string;
    title: string;
    description: string | null;
    contractId: string | null;
    matterId: string | null;
    ownerType: "contract" | "matter";
    ownerId: string;
    /** The owning contract's SET-003 soft delete (CTR-021). */
    ownerArchivedAt: Date | null;
    /** This document's own DOC-010 soft delete, which is a different
     * fact from the contract's above: one hides a file, the other
     * freezes the whole record. */
    archivedAt: Date | null;
    /** Which version of *this* document is pinned as signed, or NULL
     * (CTR-014). */
    executedVersionId: string | null;
    /** Which document the owning contract calls its instrument, which
     * may be this one or another (CTR-014). */
    primaryDocumentId: string | null;
    /** DD-014's per-document flag, as it stands on this row. */
    isConfidential: boolean;
    /** Which folder on the owning record this document is filed in, or
     * NULL at the record root (DOC-006). */
    folderId: string | null;
    /** That folder's name, or NULL when the document sits at the record
     * root. Read here so a filing's activity entry can name the folder
     * the document came out of — an id would not draw a sentence once
     * the folder is renamed or gone. */
    folderName: string | null;
    /** Who uploaded it — one of the three actors who may decide its
     * audience (DD-014, CTR-022). */
    createdBy: string;
    /** The owning contract's Owner (CTR-004), who is another. */
    ownerManagerId: string | null;
  }

  /**
   * One document this viewer reaches, by its own id, or `null`.
   *
   * The owning contract is joined in and **both** scopes ride beside the
   * id, so a document on a contract the viewer cannot reach — and a
   * confidential document on a contract they can — are each
   * indistinguishable from one that was never created (DOC-008,
   * DD-014). A document's id says nothing about which record it is on,
   * so refusing it any other way would be the leak the 404 prevents.
   *
   * `lock` holds the **contract** row — not the document row. That is
   * the lock every write on a contract's paper serializes behind, so a
   * version number assigned under it cannot be assigned twice.
   */
  async function reachedDocument(
    db: Executor,
    user: AuthenticatedUser,
    documentId: string,
    lock = false,
  ): Promise<ReachedDocument | null> {
    const query = db
      .select({
        id: documents.id,
        title: documents.title,
        description: documents.description,
        contractId: documents.contractId,
        matterId: documents.matterId,
        contractArchivedAt: contracts.archivedAt,
        matterArchivedAt: matters.archivedAt,
        archivedAt: documents.archivedAt,
        executedVersionId: documents.executedVersionId,
        primaryDocumentId: contracts.primaryDocumentId,
        isConfidential: documents.isConfidential,
        folderId: documents.folderId,
        folderName: documentFolders.name,
        createdBy: documents.createdBy,
        contractManagerId: contracts.managerId,
        matterManagerId: matters.managerId,
      })
      .from(documents)
      .leftJoin(contracts, eq(documents.contractId, contracts.id))
      .leftJoin(matters, eq(documents.matterId, matters.id))
      // Left, because most documents sit at the record root and an inner
      // join would answer none of them.
      .leftJoin(documentFolders, eq(documents.folderId, documentFolders.id))
      .where(
        and(
          eq(documents.id, documentId),
          or(
            and(isNotNull(documents.contractId), contractTeamScope(db, user)),
            and(isNotNull(documents.matterId), matterTeamScope(db, user)),
          ),
          documentAudienceScope(db, user),
        ),
      )
      .limit(1);
    let [row] = await query;
    if (!row) return null;
    if (lock) {
      if (row.contractId) {
        await db
          .select({ id: contracts.id })
          .from(contracts)
          .where(eq(contracts.id, row.contractId))
          .for("update", { of: contracts });
      } else if (row.matterId) {
        await db
          .select({ id: matters.id })
          .from(matters)
          .where(eq(matters.id, row.matterId))
          .for("update", { of: matters });
      }
      [row] = await query;
      if (!row) return null;
    }
    const contractOwned = row.contractId !== null;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      contractId: row.contractId,
      matterId: row.matterId,
      ownerType: contractOwned ? "contract" : "matter",
      ownerId: (row.contractId ?? row.matterId)!,
      ownerArchivedAt: contractOwned ? row.contractArchivedAt : row.matterArchivedAt,
      archivedAt: row.archivedAt,
      executedVersionId: row.executedVersionId,
      primaryDocumentId: contractOwned ? row.primaryDocumentId : null,
      isConfidential: row.isConfidential,
      folderId: row.folderId,
      folderName: row.folderName,
      createdBy: row.createdBy,
      ownerManagerId: contractOwned ? row.contractManagerId : row.matterManagerId,
    };
  }

  /** The one document projection, joined to its creator. The chain is
   * read beside it. Callers add the scope. */
  const selectDocuments = (db: Executor) =>
    db
      .select({
        id: documents.id,
        title: documents.title,
        description: documents.description,
        contractId: documents.contractId,
        matterId: documents.matterId,
        /** CTR-014's pin, read here so the chain below can mark the row
         * it names without a second query. */
        executedVersionId: documents.executedVersionId,
        /** DOC-010's soft delete, so the archived view can mark the rows
         * that are off the record's list rather than guess at them. */
        archivedAt: documents.archivedAt,
        /** DD-014's per-document flag, so a reader who is inside the
         * audience can see which file is narrowed. Only rows this
         * viewer already reaches get here. */
        isConfidential: documents.isConfidential,
        /** DOC-006's grouping, so the row says where it is filed rather
         * than leaving it to be inferred from which listing answered
         * it (M13/3). */
        folderId: documents.folderId,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        createdBy: {
          id: users.id,
          displayName: users.displayName,
          image: users.image,
          archivedAt: users.archivedAt,
        },
      })
      .from(documents)
      .innerJoin(users, eq(documents.createdBy, users.id));

  /** One version row's columns, named once so the plain read and the
   * current-version read cannot answer two different shapes. */
  const versionColumns = {
    id: documentVersions.id,
    documentId: documentVersions.documentId,
    versionNumber: documentVersions.versionNumber,
    kind: documentVersions.kind,
    note: documentVersions.note,
    originalFilename: documentVersions.originalFilename,
    mimeType: documentVersions.mimeType,
    byteSize: documentVersions.byteSize,
    checksumSha256: documentVersions.checksumSha256,
    createdAt: documentVersions.createdAt,
    uploadedBy: {
      id: users.id,
      displayName: users.displayName,
      image: users.image,
      archivedAt: users.archivedAt,
    },
  };

  /** One version row with the person who uploaded it. */
  const selectVersions = (db: Executor) =>
    db
      .select(versionColumns)
      .from(documentVersions)
      .innerJoin(users, eq(documentVersions.createdBy, users.id));

  type DocumentRow = Awaited<ReturnType<typeof selectDocuments>>[number];
  type VersionRow = Awaited<ReturnType<typeof selectVersions>>[number];

  function toPerson(person: DocumentRow["createdBy"]) {
    return {
      id: person.id,
      displayName: person.displayName,
      image: person.image,
      archived: person.archivedAt !== null,
    };
  }

  function toVersion(row: VersionRow, isCurrent: boolean, isExecuted: boolean) {
    return {
      id: row.id,
      versionNumber: row.versionNumber,
      kind: row.kind,
      note: row.note,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      renderFamily: renderFamilyOf(row.mimeType, row.originalFilename),
      byteSize: row.byteSize,
      checksumSha256: row.checksumSha256,
      uploadedBy: toPerson(row.uploadedBy),
      createdAt: row.createdAt.toISOString(),
      isCurrent,
      isExecuted,
    };
  }

  /**
   * One document with its chain, ordered 1..n, and both CTR-014
   * designations stated on it.
   *
   * The chain arrives in version order, so the current version is its
   * last row — that is what "current is the highest version number"
   * means (DOC-001). Current and executed are two different marks and
   * are computed from two different facts: the first from the ordering,
   * the second from the document's own `executed_version_id`. A chain
   * may carry both on one row, on two rows, or on neither.
   *
   * `primaryDocumentId` is the owning contract's column, passed in
   * rather than read here: it is one fact about the record, and reading
   * it once per document would ask the same question as many times as
   * the record has paper.
   */
  function toDocument(
    row: DocumentRow,
    chain: readonly VersionRow[],
    primaryDocumentId: string | null,
  ) {
    const last = chain.length - 1;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      isPrimary: row.id === primaryDocumentId,
      versions: chain.map((version, index) =>
        toVersion(version, index === last, version.id === row.executedVersionId),
      ),
      archivedAt: row.archivedAt?.toISOString() ?? null,
      isConfidential: row.isConfidential,
      folderId: row.folderId,
      createdBy: toPerson(row.createdBy),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * The whole chain of each of these documents, in one read, each in
   * version order.
   *
   * One read for every document on the record rather than one per
   * document: the record page draws them all, and a query per row is
   * how a section with six documents on it becomes seven round trips.
   *
   * A document always has at least one version — the upload writes both
   * rows in one transaction — so a document with no rows here would be a
   * broken record, and it is left out of the answer rather than drawn
   * without a file.
   */
  async function chainsOf(
    db: Executor,
    documentIds: readonly string[],
  ): Promise<Map<string, VersionRow[]>> {
    if (documentIds.length === 0) return new Map();
    const rows = await selectVersions(db)
      .where(inArray(documentVersions.documentId, [...documentIds]))
      // 1..n within each document, which is the order the chain reads
      // in and the order the pin is taken from.
      .orderBy(asc(documentVersions.documentId), asc(documentVersions.versionNumber));
    const chains = new Map<string, VersionRow[]>();
    for (const row of rows) {
      const chain = chains.get(row.documentId);
      if (chain) chain.push(row);
      else chains.set(row.documentId, [row]);
    }
    return chains;
  }

  /** One document with its chain, read back through the projection the
   * list answers with, so what a write returns is what the next load
   * will draw. */
  async function documentWithChain(
    db: Executor,
    documentId: string,
    primaryDocumentId: string | null,
  ) {
    const [row] = await selectDocuments(db).where(eq(documents.id, documentId));
    const chain = (await chainsOf(db, [documentId])).get(documentId);
    // Both are written in one transaction, so neither can be missing
    // for a document this code just wrote or edited.
    return toDocument(row!, chain!, primaryDocumentId);
  }

  /**
   * All the paper on one contract, newest first, each document with its
   * whole chain.
   *
   * Shared by the list read, by the primary designation, and by the hard
   * delete — the three answers that are about the record's paper as a
   * whole rather than about one document. The designation changes two
   * rows at once, and an erasure can leave the record without an
   * instrument, so both answer the whole list and the caller replaces
   * what it holds rather than working out for itself which other row
   * moved.
   *
   * **Archived documents are left out unless they are asked for**
   * (DOC-010). That is the soft delete: the row is still there, the
   * chain is still there, and the blobs are still there — it is off the
   * list and out of the count until somebody restores it.
   *
   * **A confidential document this viewer is outside the audience of is
   * left out of every one of those answers** (DD-014), and there is no
   * query parameter that asks for it. The record's section count is
   * taken from this list, so a document left out here is out of the
   * count too — which is the whole of what "silently omitted, not shown
   * as a placeholder" means for a number.
   */
  async function paperOf(
    db: Executor,
    user: AuthenticatedUser,
    // The two facts a listing turns on, and no more: a caller that has
    // just written a document holds them without re-reading the record.
    owner: { id: string; primaryDocumentId: string | null },
    includeArchived = false,
    cursor?: string,
    folder?: string,
    ownerType: "contract" | "matter" = "contract",
  ) {
    const scope = and(
      ownerType === "contract"
        ? eq(documents.contractId, owner.id)
        : eq(documents.matterId, owner.id),
      includeArchived ? undefined : isNull(documents.archivedAt),
      // The listing context (M13/3). Omitted is the record's whole
      // paper. It sits in the same WHERE clause as the audience scope
      // and for the same reason: the limit below has to cut rows that
      // are already in this listing, or a folder's page would be as
      // short as the documents from elsewhere that fell in the window.
      folder === undefined
        ? undefined
        : folder === ROOT_FOLDER
          ? isNull(documents.folderId)
          : eq(documents.folderId, folder),
      // The per-document audience is in the WHERE clause, so the limit
      // below cuts rows this viewer can already see. A read that limited
      // first and filtered after would answer pages that shrink by
      // however many walled documents sat in the window, and a page
      // length that varies with what is hidden is the existence leak
      // DD-014 exists to close (CTR-024).
      documentAudienceScope(db, user),
    );
    const rows = await selectDocuments(db)
      .where(and(scope, cursor === undefined ? undefined : olderThan(cursor, scope)))
      // Newest first, as the record's Documents section reads. The id
      // breaks a same-instant tie: uuidv7 is time-ordered, so that
      // order is still the upload order.
      .orderBy(desc(documents.createdAt), desc(documents.id))
      // One past the page, which is how the answer knows whether there
      // is more without counting anything.
      .limit(PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const chains = await chainsOf(
      db,
      page.map((row) => row.id),
    );
    return {
      documents: page.flatMap((row) => {
        const chain = chains.get(row.id);
        return chain ? [toDocument(row, chain, owner.primaryDocumentId)] : [];
      }),
      // Only when a further row was actually read. A cursor on the last
      // page would send the client for an empty one.
      nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * The keyset boundary: every document strictly older than one of them,
   * in the order the section reads (CTR-024).
   *
   * The boundary's own position is read from the table rather than taken
   * from the client, and it is read **under the same scope the page is
   * read under** — the contract, the archived filter, and DD-014's
   * per-document audience. A cursor naming a walled document this viewer
   * is outside resolves to NULL and answers an empty page, so a cursor
   * cannot confirm that a document they were told nothing about is
   * there.
   */
  function olderThan(documentId: string, scope: SQL | undefined): SQL {
    return sql`(${documents.createdAt}, ${documents.id}) < (
      select ${documents.createdAt}, ${documents.id}
      from ${documents}
      where ${and(eq(documents.id, documentId), scope)}
    )`;
  }

  app.get(
    "/contracts/:number/documents",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "listContractDocuments",
        summary:
          "The paper on one contract (DOC-008), newest first, each with " +
          "its whole version chain in order 1..n and one version of it " +
          "marked current. At most one document is marked primary — the " +
          "instrument the contract is — and any version the team has " +
          "pinned as the signed copy is marked executed. A contract " +
          "holds as many documents as it " +
          "needs: a loose attachment such as a schedule or a " +
          "certificate is its own document with its own chain, beside " +
          "the main instrument rather than inside its history " +
          "(CTR-014). Access is inherited from the " +
          "contract and nothing else: a Contributor on the team reads " +
          "the list, and anyone who cannot reach the contract — a " +
          "Contributor who is not on it, a Legal Team Member outside a " +
          "confidential record's audience — is answered 404, exactly as " +
          "for a contract that does not exist. Archived documents " +
          "(DOC-010) are left out; includeArchived=true draws them " +
          "beside the live ones, which is where restoring one is " +
          "offered. folder narrows the read to one listing (DOC-006): a " +
          "folder's own id answers what is filed in that folder, `root` " +
          "answers the documents filed in no folder, and omitting it " +
          "answers the record's whole paper. Paging applies within " +
          "whichever listing was asked for, so a heavy folder pages on " +
          "its own. A folder on another contract, or one that never " +
          "existed, answers 404 — exactly as a folder that was never " +
          "created, because a folder's id says nothing about which " +
          "record it is on",
        tags: ["documents"],
        params: NumberParams,
        querystring: ArchivedQuery.extend(FolderQuery.shape).extend({
          /** The previous page's `nextCursor`. Omit for the first page. */
          cursor: CursorSchema.optional(),
        }),
        response: { 200: DocumentsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      const { folder } = request.query;
      // A folder is addressed by its own id, which says nothing about
      // which record it is on — so it is checked against this contract
      // before it is filtered on. Skipping the check would make the
      // list route a way to ask whether a folder id exists somewhere.
      if (folder !== undefined && folder !== ROOT_FOLDER) {
        await folderOnRecord(app.db, contract.id, folder);
      }
      // An archived record still reads: archiving is a soft delete for
      // mistakes and imports, and restore has to be reachable.
      return await paperOf(
        app.db,
        request.user,
        contract,
        request.query.includeArchived === "true",
        request.query.cursor,
        folder,
      );
    },
  );

  app.get(
    "/matters/:number/documents",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "listMatterDocuments",
        summary:
          "The paper on one matter, newest first, with each document's complete version chain. " +
          "Access is inherited from the matter and a confidential document narrows to its team, " +
          "Matter Manager, and Administrators. Administrators, Legal Team Members, and Contributors " +
          "may read matter paper. Primary and executed designations are contract concepts.",
        tags: ["documents"],
        params: NumberParams,
        querystring: ArchivedQuery.extend(FolderQuery.shape).extend({
          cursor: CursorSchema.optional(),
        }),
        response: { 200: DocumentsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const matter = await reachedMatter(app.db, request.user, request.params.number);
      if (!matter) throw httpError(404, NO_MATTER);
      const { folder } = request.query;
      if (folder !== undefined && folder !== ROOT_FOLDER) {
        await folderOnRecord(app.db, { type: "matter", id: matter.id }, folder);
      }
      return paperOf(
        app.db,
        request.user,
        { id: matter.id, primaryDocumentId: null },
        request.query.includeArchived === "true",
        request.query.cursor,
        folder,
        "matter",
      );
    },
  );

  app.post(
    "/contracts/:number/documents",
    {
      preHandler: requireSupportingUploader,
      schema: {
        operationId: "uploadContractDocument",
        summary:
          "Upload a file to a contract, creating a document with version " +
          "1 (DOC-001). Any file type is accepted (DOC-004); the ceiling " +
          "is the deployment's MAX_UPLOAD_MB, and a file over it is " +
          "refused rather than stored. The version row records the " +
          "original filename, the declared MIME type, the byte size the " +
          "server counted, and the SHA-256 it computed while streaming. " +
          "The blob is written through the storage adapter before the " +
          "rows commit (DOC-012). The first document uploaded to a " +
          "contract becomes its primary document — the instrument the " +
          "contract is (CTR-014) — and every one after it is a loose " +
          "attachment until somebody moves the designation. Appends " +
          "document.created on the owning " +
          "contract, and document.primary_set beside it when the " +
          "designation was taken (DD-017). A Contributor on the live team " +
          "may create supporting paper at the record root; their upload " +
          "never takes the primary designation and may not create or choose " +
          "a folder. The document is otherwise filed where " +
          "the form says (DOC-006, DOC-011): folderId is a folder " +
          "already on this record, folderPath is a relative chain " +
          "find-or-created beneath it segment by segment, and sending " +
          "neither files the document at the record root. The chain is " +
          "resolved under the owning contract's row lock — the same one " +
          "that serialises version numbers — so uploads racing on one " +
          "path converge on a single folder rather than manufacturing " +
          "one each. A folder a drop creates on its way past writes no " +
          "activity of its own; the document.created entry names the " +
          "folder its file landed in (DD-017). A path that misuses the " +
          "separator or would nest past the tree's ceiling is refused " +
          "for that one file, and a batch's other files are untouched. " +
          "The kind, note, folderId and folderPath fields " +
          "must be sent " +
          "before the file part. An archived contract takes no new " +
          "paper until it is restored. A contract the uploader cannot " +
          "reach answers 404, exactly as one that does not exist",
        tags: ["documents"],
        consumes: ["multipart/form-data"],
        params: NumberParams,
        body: CreateUploadForm,
        response: { 201: DocumentEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      // Asked before a single byte is read: refusing after the upload
      // has been stored would mean storing a file for somebody who may
      // not put one there. Both refusals are made again below, on the
      // snapshot the rows are written on — the reach answer is the one
      // that must not go stale, and the frozen answer rides with it.
      assertOpen(await reachedContract(app.db, request.user, request.params.number));

      // Both ids are minted here, because the storage key is built from
      // them and the blob is written before the rows exist (DOC-012).
      const documentId = uuidv7();
      const versionId = uuidv7();
      const file = await receiveUpload(request, versionStorageKey(documentId, versionId), true);

      // The blob is written before the rows (DOC-012), so a transaction
      // that refuses leaves it behind. **A folder destination made that
      // a routine outcome rather than a rare one**: a drop of a legacy
      // book can carry a path that is too deep or names a folder on
      // another record, and a batch refused a file at a time would
      // otherwise leave one orphan blob per refused file. So the write
      // is wrapped: the key is removed and the refusal is rethrown
      // untouched, because what the caller is owed is the reason, not
      // the cleanup. The key is never written again — the retry mints
      // its own.
      // The seam's transaction rather than the database's: paper landing
      // on a record is ambient movement on it (NOT-002 group 2), and the
      // bell rows for it belong inside the same commit as the rows they
      // are about.
      const created = await withStoredFile(request, file, () => {
        if (request.user.role === "contributor" && file.destination) {
          throw httpError(
            403,
            "Contributors may upload supporting Documents at the record root only.",
          );
        }
        return app.notifier.notifying(async (tx) => {
          // The contract row is held for the write, and reach is asked
          // again on the same snapshot: a team row dropped between the
          // first check and the insert must not leave a file on a record
          // the uploader no longer reaches.
          const locked = await reachedContract(tx, request.user, request.params.number, {
            lock: true,
          });
          assertOpen(locked);

          // Under that same lock, which is what makes a folder drop
          // converge (DOC-011): a chain the form named is found or made
          // segment by segment, and a second upload racing on the same
          // path waits here and then finds what the first one wrote.
          const folder = file.destination
            ? await findOrCreateFolderPath(tx, locked, file.destination)
            : null;

          await tx.insert(documents).values({
            id: documentId,
            folderId: folder?.id ?? null,
            // Seeded from the filename: the record has to be called
            // something, and what the uploader recognises is the name
            // they chose on their own machine. It is renameable from
            // there (DOC-007), and renaming leaves the file's own name
            // alone.
            title: file.filename,
            contractId: locked.id,
            createdBy: request.user.id,
          });
          await insertVersion(tx, {
            documentId,
            versionId,
            versionNumber: 1,
            file,
            by: request.user,
          });
          // On the owning contract, at the tier every record action rides
          // (DD-017). The title is in the payload on purpose: hard
          // deletion (DOC-010) removes the rows, and the entry has to
          // still name what was deleted.
          await recordActivity(tx, {
            entityType: "contract",
            entityId: locked.id,
            actorId: request.user.id,
            action: "document.created",
            visibility: RECORD_ACTIVITY_TIER,
            // The destination rides in the payload **by name** (DD-017),
            // beside the title and for the same reason: this entry is the
            // drop's whole story — a folder it find-or-created wrote none
            // of its own — and it has to still say where the file landed
            // after that folder is renamed or dissolved.
            payload: {
              documentId,
              versionId,
              title: file.filename,
              folderName: folder?.name ?? null,
              ...(request.user.role === "contributor" ? { actorRole: "contributor" as const } : {}),
            },
          });

          // The first Member+ upload on a record with no instrument takes
          // the designation (CTR-014). A Contributor's paper is supporting
          // by definition, including when the record has no instrument yet.
          // The next Member+ upload may then take the still-empty pin.
          // The first document on a record is otherwise the instrument.
          // Nobody asked for it, which is exactly why it gets its own
          // entry rather than being left implied by the upload above — the
          // counterparty promotion is logged for the same reason, and a
          // record born confidential is too. The contract row is held, so
          // two first uploads at once cannot both read NULL here.
          const primaryDocumentId =
            locked.primaryDocumentId ?? (request.user.role === "contributor" ? null : documentId);
          if (locked.primaryDocumentId === null && request.user.role !== "contributor") {
            await tx
              .update(contracts)
              .set({ primaryDocumentId: documentId })
              .where(eq(contracts.id, locked.id));
            await recordActivity(tx, {
              entityType: "contract",
              entityId: locked.id,
              actorId: request.user.id,
              action: "document.primary_set",
              visibility: RECORD_ACTIVITY_TIER,
              // `from`/`to` as the counterparty promotion writes them, so
              // the M9 viewer narrates the move with one shared helper. The
              // first upload takes the designation from nobody.
              payload: {
                documentId,
                title: file.filename,
                fromDocumentId: null,
                from: null,
                to: file.filename,
              },
            });
          }

          // The team hears that the paper moved (NOT-002 group 2): bell
          // on, no email owed under the default. A document is born with
          // the flag clear, so this one always goes as far as the record
          // does — the flag is asked anyway, because the rule belongs to
          // the event rather than to what today's write path happens to
          // set.
          await app.notifier.documentAdded(tx, {
            contractId: locked.id,
            actorId: request.user.id,
            actorName: request.user.displayName,
            documentId,
            documentTitle: file.filename,
            isConfidential: false,
          });

          // Read back through the list's own projection, so the row the
          // uploader gets is the row the next load will draw.
          return documentWithChain(tx, documentId, primaryDocumentId);
        });
      });

      await askForDerivations(versionId, file);
      return reply.status(201).send({ document: created });
    },
  );

  app.post(
    "/matters/:number/documents",
    {
      preHandler: requireSupportingUploader,
      schema: {
        operationId: "uploadMatterDocument",
        summary:
          "Upload a file to a matter, creating a document with version 1. The upload may name " +
          "an existing matter folder or a folder path to recreate. Matter paper has no primary " +
          "document or executed-version designation. A Contributor on the live Matter team may " +
          "upload supporting paper at the record root but may not choose or create a folder.",
        tags: ["documents"],
        consumes: ["multipart/form-data"],
        params: NumberParams,
        body: CreateUploadForm,
        response: { 201: DocumentEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      assertOpenMatter(await reachedMatter(app.db, request.user, request.params.number));

      const documentId = uuidv7();
      const versionId = uuidv7();
      const file = await receiveUpload(request, versionStorageKey(documentId, versionId), true);
      const created = await withStoredFile(request, file, () => {
        if (request.user.role === "contributor" && file.destination) {
          throw httpError(
            403,
            "Contributors may upload supporting Documents at the record root only.",
          );
        }
        return app.db.transaction(async (tx) => {
          const locked = await reachedMatter(tx, request.user, request.params.number, {
            lock: true,
          });
          assertOpenMatter(locked);
          const folder = file.destination
            ? await findOrCreateFolderPath(tx, locked, file.destination)
            : null;

          await tx.insert(documents).values({
            id: documentId,
            folderId: folder?.id ?? null,
            title: file.filename,
            matterId: locked.id,
            createdBy: request.user.id,
          });
          await insertVersion(tx, {
            documentId,
            versionId,
            versionNumber: 1,
            file,
            by: request.user,
          });
          await recordActivity(tx, {
            entityType: "matter",
            entityId: locked.id,
            actorId: request.user.id,
            action: "document.created",
            visibility: RECORD_ACTIVITY_TIER,
            payload: {
              documentId,
              versionId,
              title: file.filename,
              folderName: folder?.name ?? null,
              ...(request.user.role === "contributor" ? { actorRole: "contributor" as const } : {}),
            },
          });
          return documentWithChain(tx, documentId, null);
        });
      });

      await askForDerivations(versionId, file);
      return reply.status(201).send({ document: created });
    },
  );

  app.post(
    "/documents/:documentId/versions",
    {
      preHandler: requireSupportingUploader,
      schema: {
        operationId: "uploadDocumentVersion",
        summary:
          "Append the next version to an existing document (DOC-001). " +
          "The number is assigned under the owning record's row lock, " +
          "so two revisions uploaded at the same moment take consecutive " +
          "numbers rather than colliding, and the chain runs 1..n with " +
          "no gaps. The version carries one of the six hand-set CTR-014 kinds " +
          "and, when the uploader wrote one, a short note saying what " +
          "changed in this round. Nothing about the versions already in " +
          "the chain is touched: a file correction is another version, " +
          "while the kind has its own one-column PATCH. Appends " +
          "document.version_added on the owning " +
          "record (DD-017). A Contributor on that record's live team " +
          "may append only to a non-primary supporting chain; Matter paper " +
          "has no primary chain. The kind and note fields must be sent " +
          "before the file part. An archived owning record takes no new paper " +
          "until it is restored. A document on a contract the uploader " +
          "cannot reach answers 404, exactly as one that does not exist",
        tags: ["documents"],
        consumes: ["multipart/form-data"],
        params: DocumentParams,
        body: VersionUploadForm,
        response: { 201: DocumentEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { documentId } = request.params;
      // Before a byte is read, for the reason the create path gives.
      const reached = await reachedDocument(app.db, request.user, documentId);
      assertOpenDocument(reached);
      if (
        request.user.role === "contributor" &&
        reached.ownerType === "contract" &&
        reached.primaryDocumentId === reached.id
      ) {
        throw httpError(
          403,
          "Contributors cannot append a Version to the primary Contract Document.",
        );
      }

      const versionId = uuidv7();
      const file = await receiveUpload(request, versionStorageKey(documentId, versionId));

      // The seam's transaction, for the create path's reason: a new
      // round on a chain is ambient movement on the record (NOT-002
      // group 2). The storage wrapper removes the fresh blob if the
      // locked reach/freeze/primary answer changed while it streamed.
      const updated = await withStoredFile(request, file, () =>
        app.notifier.notifying(async (tx) => {
          // The owning contract's row is held here, and this is the lock
          // the version number is assigned under: two uploaders reading
          // the chain's high-water mark at the same moment would both see
          // the same number, so the second one waits here until the first
          // has committed its row and then reads the number it wrote.
          const locked = await reachedDocument(tx, request.user, documentId, true);
          assertOpenDocument(locked);
          if (
            request.user.role === "contributor" &&
            locked.ownerType === "contract" &&
            locked.primaryDocumentId === locked.id
          ) {
            throw httpError(
              403,
              "Contributors cannot append a Version to the primary Contract Document.",
            );
          }

          const versionNumber = await nextVersionNumber(tx, documentId);

          await insertVersion(tx, { documentId, versionId, versionNumber, file, by: request.user });
          // The document's own row is touched so that "when did this
          // document last change" answers with the new round rather than
          // with the day it was created.
          await tx
            .update(documents)
            .set({ updatedAt: new Date() })
            .where(eq(documents.id, documentId));
          await recordActivity(tx, {
            entityType: locked.ownerType,
            entityId: locked.ownerId,
            actorId: request.user.id,
            action: "document.version_added",
            visibility: RECORD_ACTIVITY_TIER,
            payload: {
              documentId,
              versionId,
              title: locked.title,
              versionNumber,
              kind: file.kind,
              ...(request.user.role === "contributor" ? { actorRole: "contributor" as const } : {}),
            },
          });
          // The team hears that the paper moved (NOT-002 group 2). This is
          // the door where the document flag bites: a round appended to a
          // confidential document goes exactly as far as that document
          // does (DD-014, DOC-008).
          if (locked.contractId) {
            await app.notifier.documentVersionAdded(tx, {
              contractId: locked.contractId,
              actorId: request.user.id,
              actorName: request.user.displayName,
              documentId,
              documentTitle: locked.title,
              isConfidential: locked.isConfidential,
              versionId,
              versionNumber,
            });
          }
          return documentWithChain(tx, documentId, locked.primaryDocumentId);
        }),
      );

      await askForDerivations(versionId, file);
      return reply.status(201).send({ document: updated });
    },
  );

  app.patch(
    "/documents/:documentId/versions/:versionId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateDocumentVersionKind",
        summary:
          "Correct one version's kind (CTR-014). This is the only " +
          "per-version update. It changes only the kind: the bytes, " +
          "number, note, author, order, and executed pin stay where " +
          "they are. The target must be one of the six hand-set kinds. " +
          "A generated redline cannot be corrected or selected because " +
          "its kind records how the file was made. Appends " +
          "document.version_kind_changed on the owning contract with " +
          "the kind before and after (DD-017). Member+ may correct a " +
          "kind; a Contributor who reaches the record is refused 403",
        tags: ["documents"],
        params: VersionParams,
        body: VersionKindPatch,
        response: { 200: DocumentEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { documentId, versionId } = request.params;
      const { kind } = request.body;
      return {
        document: await app.db.transaction(async (tx) => {
          const target = await reachedDocument(tx, request.user, documentId, true);
          assertOpenDocument(target);

          const [version] = await tx
            .select({
              id: documentVersions.id,
              versionNumber: documentVersions.versionNumber,
              kind: documentVersions.kind,
            })
            .from(documentVersions)
            .where(
              and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId)),
            )
            .limit(1);
          if (!version) throw httpError(404, "That version is not part of this document.");
          if (version.kind === "generated_redline") {
            throw httpError(409, "A generated redline's kind records how it was made.");
          }
          if (version.kind === kind) {
            throw httpError(409, "That version already has this kind.");
          }

          await updateDocumentVersionKind(tx, documentId, versionId, kind);
          await recordActivity(tx, {
            entityType: target.ownerType,
            entityId: target.ownerId,
            actorId: request.user.id,
            action: "document.version_kind_changed",
            visibility: RECORD_ACTIVITY_TIER,
            payload: {
              documentId,
              versionId,
              title: target.title,
              versionNumber: version.versionNumber,
              from: version.kind,
              to: kind,
            },
          });

          return documentWithChain(tx, documentId, target.primaryDocumentId);
        }),
      };
    },
  );

  app.patch(
    "/documents/:documentId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateDocument",
        summary:
          "Rename a document or edit its description (DOC-007), one " +
          "field per request as DES-017 commits them. The stored files " +
          "are untouched by either: a version's own filename is what it " +
          "arrived as and stays that, and a download still offers it " +
          "back. Appends document.updated on the owning contract " +
          "(DD-017), naming what changed. isConfidential is the third " +
          "field, and it is not one of those two: it sets or clears " +
          "DD-014's per-document flag, which narrows this one file to " +
          "the contract's named team, its Owner, and Administrators, " +
          "even on an open contract. It has an actor set narrower than " +
          "the route's — an Administrator, the person who uploaded the " +
          "document, and the contract's Owner — and anybody else who " +
          "reaches the document is refused 403 rather than 404, because " +
          "they can already see it. Each set and each clear appends its " +
          "own action, document.confidentiality_set or " +
          "document.confidentiality_cleared. folderId is the fourth, and " +
          "it files the document (DOC-006): a folder on this document's " +
          "own record, or null for the record root, with null and " +
          "omitting the field two different requests. A folder on " +
          "another contract answers 404, exactly as one that was never " +
          "created, because a folder's id says nothing about which " +
          "record it is on. Each move appends document.filed, carrying " +
          "both folders by name so the entry outlives a rename. An archived contract takes " +
          "no " +
          "edit until it is restored. A document on a contract the " +
          "editor cannot reach — and a confidential document they are " +
          "outside the audience of — answers 404, exactly as one that " +
          "does not exist",
        tags: ["documents"],
        params: DocumentParams,
        body: MetadataPatch,
        response: { 200: DocumentEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { documentId } = request.params;
      const body = request.body;

      return {
        document: await app.db.transaction(async (tx) => {
          const target = await reachedDocument(tx, request.user, documentId, true);
          // Reach first, so the flag's own refusal below cannot answer
          // for a document this viewer may not see.
          assertReachedDocument(target);
          // Then the flag's narrower actor set, and it is asked before
          // the two freezes: a viewer who may not decide the audience
          // should not learn from a 409 that the write was otherwise
          // theirs to make. It is M10's ordering, one level down.
          if (body.isConfidential !== undefined) {
            await assertMayFlagConfidential(tx, target, request.user);
          }
          assertOpenDocument(target);

          const patch: {
            title?: string;
            description?: string | null;
            isConfidential?: boolean;
            folderId?: string | null;
          } = {};
          /** The DD-017 changed map — old and new per edited field,
           * feeding the M9 viewer's narration. */
          const changed: Record<string, { from: unknown; to: unknown }> = {};

          if (body.title !== undefined && body.title !== target.title) {
            patch.title = body.title;
            changed.title = { from: target.title, to: body.title };
          }
          if (body.description !== undefined) {
            // Blank normalizes to NULL; null clears deliberately.
            const next = body.description || null;
            if (next !== target.description) {
              patch.description = next;
              changed.description = { from: target.description, to: next };
            }
          }

          // The flag keeps its own audit verb for DD-014's reason: the
          // walling-off of a file has to be accountable in its own
          // right, so it is a slug an Administrator can filter on
          // rather than one key inside an edit. It rides the same
          // UPDATE and stays out of the changed map.
          let confidentialityChange: boolean | undefined;
          if (body.isConfidential !== undefined && body.isConfidential !== target.isConfidential) {
            patch.isConfidential = body.isConfidential;
            confidentialityChange = body.isConfidential;
          }

          // Where the document is filed (DOC-006, M13/3). Sending null
          // takes it out to the record root; omitting the field leaves
          // it where it is — two different requests, exactly as on a
          // folder's own move.
          //
          // The destination is resolved against **this document's own
          // contract**, which is the shared-owner invariant: a folder on
          // another record is not found, and is answered exactly as one
          // that was never created. It rides the same UPDATE and stays
          // out of the changed map, for the confidential flag's reason —
          // filing is an act somebody did, not one key inside an edit.
          let filing: { to: string | null; from: string | null } | undefined;
          if (body.folderId !== undefined && body.folderId !== target.folderId) {
            const destination =
              body.folderId === null
                ? null
                : await folderOnRecord(
                    tx,
                    { type: target.ownerType, id: target.ownerId },
                    body.folderId,
                  );
            patch.folderId = destination?.id ?? null;
            filing = {
              to: destination?.name ?? null,
              from: target.folderName,
            };
          }

          // Nothing changed: answer with the row and write no
          // misleading from==to entry.
          if (Object.keys(patch).length > 0) {
            await tx.update(documents).set(patch).where(eq(documents.id, documentId));
          }
          if (Object.keys(changed).length > 0) {
            await recordActivity(tx, {
              entityType: target.ownerType,
              entityId: target.ownerId,
              actorId: request.user.id,
              action: "document.updated",
              visibility: RECORD_ACTIVITY_TIER,
              // The title as it stands after the edit, so the entry
              // still names the document after DOC-010's hard delete
              // has taken the row.
              payload: { documentId, title: patch.title ?? target.title, changed },
            });
          }
          if (confidentialityChange !== undefined) {
            // One write, two DD-017 surfaces, as the contract's own
            // flag does it: the team's feed narrates it at the
            // record-action tier, and the Administrator's audit log
            // holds it with actor and timestamp.
            //
            // The entry names the document, and it is written on the
            // owning contract like every other entry here — so setting
            // the flag is itself an entry the feed then hides from
            // anybody the flag has just walled out.
            await recordActivity(tx, {
              entityType: target.ownerType,
              entityId: target.ownerId,
              actorId: request.user.id,
              action: confidentialityChange
                ? "document.confidentiality_set"
                : "document.confidentiality_cleared",
              visibility: RECORD_ACTIVITY_TIER,
              payload: { documentId, title: patch.title ?? target.title },
            });
          }
          if (filing) {
            // One entry per filing (DD-017), at the record tier. Both
            // folders are carried **by name**: a folder is renamed and
            // dissolved freely, and the entry has to still say where the
            // document went a week after the row stopped saying it. A
            // null on either side is the record root, which has no name
            // because it is not a folder.
            await recordActivity(tx, {
              entityType: target.ownerType,
              entityId: target.ownerId,
              actorId: request.user.id,
              action: "document.filed",
              visibility: RECORD_ACTIVITY_TIER,
              payload: {
                documentId,
                title: patch.title ?? target.title,
                folderName: filing.to,
                previousFolderName: filing.from,
              },
            });
          }

          return documentWithChain(tx, documentId, target.primaryDocumentId);
        }),
      };
    },
  );

  app.post(
    "/documents/:documentId/primary",
    {
      preHandler: requireMember,
      schema: {
        operationId: "setPrimaryContractDocument",
        summary:
          "Name this document the contract's primary document — the " +
          "instrument the contract is (CTR-014). Everything else on the " +
          "record reads as a loose attachment beside it. The first " +
          "document uploaded already holds the designation, so this is " +
          "the reassignment: it moves to another document on the same " +
          "contract, or it stays where it is. There is no route to " +
          "clear it, because a record with paper on it has an " +
          "instrument. Exactly one document holds the designation at " +
          "any moment — it is one column on the contract, not a flag " +
          "on each document. Appends document.primary_set on the " +
          "owning contract (DD-017). An Administrator or a Legal Team " +
          "Member who reaches the contract may move it; a Contributor " +
          "on the team reads the record and is refused 403, because " +
          "their write grid arrives with M23 (DD-015). An archived " +
          "contract keeps the " +
          "designation it has until it is restored. A document on a " +
          "contract the actor cannot reach answers 404, exactly as one " +
          "that does not exist",
        tags: ["documents"],
        params: DocumentParams,
        // The whole record's paper, because this is the one write that
        // changes two documents at once: the one that takes the
        // designation and the one that loses it.
        response: { 200: DocumentsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { documentId } = request.params;
      // The whole envelope out of the transaction: the answer is the
      // record's first page and its cursor, so a section that had paged
      // further down starts again from the top (CTR-024).
      return await app.db.transaction(async (tx) => {
        // The contract row is held, which is what makes "exactly one"
        // true under two people clicking at once: the second waits
        // and then writes over what the first left.
        const target = await reachedDocument(tx, request.user, documentId, true);
        assertOpenDocument(target);
        assertContractDocument(target);
        if (target.primaryDocumentId === documentId) {
          throw httpError(409, "That document is already the contract's primary document.");
        }

        // The document the designation is leaving, named for the
        // entry. Read before the write, and it may be absent: a
        // record whose paper was all hard-deleted (DOC-010) has no
        // primary until the next upload.
        const previous = target.primaryDocumentId
          ? ((
              await tx
                .select({ title: documents.title })
                .from(documents)
                .where(eq(documents.id, target.primaryDocumentId))
                .limit(1)
            )[0] ?? null)
          : null;

        await tx
          .update(contracts)
          .set({ primaryDocumentId: documentId })
          .where(eq(contracts.id, target.contractId));
        await recordActivity(tx, {
          entityType: "contract",
          entityId: target.contractId,
          actorId: request.user.id,
          action: "document.primary_set",
          visibility: RECORD_ACTIVITY_TIER,
          // Both titles, because hard deletion (DOC-010) takes the
          // rows and the entry has to keep saying which document the
          // instrument moved from and which it moved to.
          payload: {
            documentId,
            title: target.title,
            fromDocumentId: target.primaryDocumentId,
            from: previous?.title ?? null,
            to: target.title,
          },
        });

        return paperOf(tx, request.user, {
          id: target.contractId,
          primaryDocumentId: documentId,
        });
      });
    },
  );

  app.post(
    "/documents/:documentId/executed-version",
    {
      preHandler: requireMember,
      schema: {
        operationId: "setExecutedDocumentVersion",
        summary:
          "Pin one version of this document as the signed copy " +
          "(CTR-014) — the file previews, exports, and AI analysis " +
          "target by default. The pin is explicit and is never read off " +
          "a version's kind: a round tagged `executed` is what its " +
          "uploader called it, and pinning is what the team decided. " +
          "Any version can be pinned, current or superseded, and " +
          "pinning one takes the pin off whichever version held it. A " +
          "version of another document is refused: the pinned row must " +
          "be a version of this one (DOC-001). Appends " +
          "document.executed_set on the owning contract (DD-017). An " +
          "Administrator or a Legal Team Member who reaches the " +
          "contract may pin; a Contributor on the team reads the record " +
          "and is refused 403 (DD-015). An " +
          "archived contract takes no pin until it is restored. A " +
          "document on a contract the actor cannot reach answers 404, " +
          "exactly as one that does not exist",
        tags: ["documents"],
        params: DocumentParams,
        body: z.object({ versionId: RecordIdSchema }),
        response: { 200: DocumentEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { documentId } = request.params;
      const { versionId } = request.body;
      return {
        document: await app.db.transaction(async (tx) => {
          const target = await reachedDocument(tx, request.user, documentId, true);
          assertOpenDocument(target);
          assertContractDocument(target);

          // DOC-001's same-document invariant, enforced at write time
          // and enforced by the read itself: the version is looked up
          // by its own id **and** this document's, inside the locked
          // transaction that then writes it. A version of another
          // document is not found here, so there is no path from a
          // mismatched pair to a stored row.
          const [version] = await tx
            .select({
              id: documentVersions.id,
              versionNumber: documentVersions.versionNumber,
            })
            .from(documentVersions)
            .where(
              and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId)),
            )
            .limit(1);
          if (!version) throw httpError(404, "That version is not part of this document.");
          if (target.executedVersionId === version.id) {
            throw httpError(409, "That version is already this document's executed copy.");
          }

          await tx
            .update(documents)
            .set({ executedVersionId: version.id })
            .where(eq(documents.id, documentId));
          await recordActivity(tx, {
            entityType: target.ownerType,
            entityId: target.ownerId,
            actorId: request.user.id,
            action: "document.executed_set",
            visibility: RECORD_ACTIVITY_TIER,
            payload: {
              documentId,
              title: target.title,
              versionId: version.id,
              versionNumber: version.versionNumber,
            },
          });

          return documentWithChain(tx, documentId, target.primaryDocumentId);
        }),
      };
    },
  );

  app.delete(
    "/documents/:documentId/executed-version",
    {
      preHandler: requireMember,
      schema: {
        operationId: "clearExecutedDocumentVersion",
        summary:
          "Take the executed pin off this document (CTR-014). Every " +
          "version is left exactly as it was — the pin is one column on " +
          "the document, and clearing it says the record has no signed " +
          "copy, never that a file changed or went away. Appends " +
          "document.executed_cleared on the owning contract (DD-017). " +
          "An Administrator or a Legal Team Member who reaches the " +
          "contract may clear it; a Contributor on the team reads the " +
          "record and is refused 403 (DD-015). " +
          "An archived contract keeps its pin until it is restored. A " +
          "document on a contract the actor cannot reach answers 404, " +
          "exactly as one that does not exist",
        tags: ["documents"],
        params: DocumentParams,
        response: { 200: DocumentEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { documentId } = request.params;
      return {
        document: await app.db.transaction(async (tx) => {
          const target = await reachedDocument(tx, request.user, documentId, true);
          assertOpenDocument(target);
          assertContractDocument(target);
          const pinned = target.executedVersionId;
          if (!pinned) throw httpError(409, "This document has no executed copy to clear.");

          // The number is read for the entry, not for the write: the
          // feed says which version stopped being the signed one, and a
          // bare id would make that sentence unreadable.
          const [version] = await tx
            .select({ versionNumber: documentVersions.versionNumber })
            .from(documentVersions)
            .where(eq(documentVersions.id, pinned))
            .limit(1);

          // One column, set to NULL. No version row is touched here,
          // and there is no statement in this handler that could touch
          // one (DOC-001).
          await tx
            .update(documents)
            .set({ executedVersionId: null })
            .where(eq(documents.id, documentId));
          await recordActivity(tx, {
            entityType: target.ownerType,
            entityId: target.ownerId,
            actorId: request.user.id,
            action: "document.executed_cleared",
            visibility: RECORD_ACTIVITY_TIER,
            payload: {
              documentId,
              title: target.title,
              versionId: pinned,
              versionNumber: version?.versionNumber ?? null,
            },
          });

          return documentWithChain(tx, documentId, target.primaryDocumentId);
        }),
      };
    },
  );

  app.post(
    "/documents/:documentId/archive",
    {
      preHandler: requireMember,
      schema: {
        operationId: "archiveDocument",
        summary:
          "Archive a document (DOC-010's soft delete, for the wrong " +
          "upload): it leaves the record's document list and its count, " +
          "and nothing is destroyed. The row stays, the whole version " +
          "chain stays, and every stored file stays — restoring it puts " +
          "it back, so a wrong archive is a two-second fix. It is not " +
          "the erasure path: that is the Administrator's hard delete, " +
          "which leaves no row at all. Appends document.archived on the " +
          "owning contract (DD-017). An Administrator or a Legal Team " +
          "Member who reaches the contract may archive; a Contributor " +
          "on the team reads the record and is refused 403, because " +
          "their write grid arrives with M23 (DD-015). An archived " +
          "contract keeps its paper as it stands until it is restored. " +
          "A document on a contract the actor cannot reach answers 404, " +
          "exactly as one that does not exist",
        tags: ["documents"],
        params: DocumentParams,
        response: { 200: DocumentEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { documentId } = request.params;
      return {
        document: await app.db.transaction(async (tx) => {
          const target = await reachedDocument(tx, request.user, documentId, true);
          // Not `assertOpenDocument`: the already-archived case is its
          // own answer below, and it has to be told apart from a
          // document somebody is trying to edit while it is hidden.
          assertReachedDocument(target);
          assertLiveOwner(target);
          if (target.archivedAt) throw httpError(409, "This document is already archived.");

          await tx
            .update(documents)
            .set({ archivedAt: new Date() })
            .where(eq(documents.id, documentId));
          await recordActivity(tx, {
            entityType: target.ownerType,
            entityId: target.ownerId,
            actorId: request.user.id,
            action: "document.archived",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { documentId, title: target.title },
          });

          return documentWithChain(tx, documentId, target.primaryDocumentId);
        }),
      };
    },
  );

  app.post(
    "/documents/:documentId/restore",
    {
      preHandler: requireMember,
      schema: {
        operationId: "restoreDocument",
        summary:
          "Restore an archived document (DOC-010): it rejoins the " +
          "record's document list and its count exactly as it was. " +
          "Nothing had to be rebuilt, because archiving destroyed " +
          "nothing — the chain, the notes, and the two CTR-014 " +
          "designations come back with it. Appends document.restored on " +
          "the owning contract (DD-017). An Administrator or a Legal " +
          "Team Member who reaches the contract may restore; a " +
          "Contributor on the team is refused 403 (DD-015). An archived " +
          "contract is restored first, because a frozen record takes no " +
          "change to its paper. A document on a contract the actor " +
          "cannot reach answers 404, exactly as one that does not exist",
        tags: ["documents"],
        params: DocumentParams,
        response: { 200: DocumentEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { documentId } = request.params;
      return {
        document: await app.db.transaction(async (tx) => {
          const target = await reachedDocument(tx, request.user, documentId, true);
          assertReachedDocument(target);
          assertLiveOwner(target);
          if (!target.archivedAt) throw httpError(409, "This document is not archived.");

          await tx.update(documents).set({ archivedAt: null }).where(eq(documents.id, documentId));
          await recordActivity(tx, {
            entityType: target.ownerType,
            entityId: target.ownerId,
            actorId: request.user.id,
            action: "document.restored",
            visibility: RECORD_ACTIVITY_TIER,
            payload: { documentId, title: target.title },
          });

          return documentWithChain(tx, documentId, target.primaryDocumentId);
        }),
      };
    },
  );

  app.delete(
    "/documents/:documentId",
    {
      preHandler: requireAdministrator,
      schema: {
        operationId: "hardDeleteDocument",
        summary:
          "Destroy a whole document — the lawful-erasure answer " +
          "(DOC-010). It removes the document row, every version row " +
          "under it, every stored blob those versions name, and " +
          "everything the pipeline derived from them: the extracted " +
          "text and the display renditions, rows and blobs alike. It " +
          "is whole-document by design: there " +
          "is no route that deletes one version, because a chain " +
          "somebody can cut pieces out of is not negotiation history " +
          "(DOC-001), so the whole document goes or nothing does. It " +
          "takes a typed confirmation: confirmTitle must be the " +
          "document's own title, exactly. It is the Administrator's " +
          "alone; every other role is refused 403, a Contributor and a " +
          "Legal Team Member alike. The activity and audit entries " +
          "written before it survive it and still name what was " +
          "deleted, and the erasure appends document.hard_deleted " +
          "beside them (DD-017) — the record stays accountable after " +
          "the files are gone. It reaches an archived contract too, " +
          "because erasure is compelled from outside the record and a " +
          "frozen record is not a place to hide from it. A document on " +
          "a contract the Administrator cannot reach answers 404",
        tags: ["documents"],
        params: DocumentParams,
        body: HardDeleteBody,
        // The whole record's paper, because the erasure may have taken
        // the instrument with it: `contracts.primary_document_id` is
        // SET NULL, so the row that was Primary is gone and no other
        // row took the mark.
        response: { 200: HardDeleteResponse, default: problemResponse },
      },
    },
    async (request) => {
      const { documentId } = request.params;
      const { confirmTitle } = request.body;
      // The whole envelope out of the transaction, for the primary
      // write's reason: the answer is the record's first page and its
      // cursor (CTR-024).
      return await app.db.transaction(async (tx) => {
        // The contract row is held for the whole erasure, so nothing
        // can append a version to a document that is being destroyed.
        const target = await reachedDocument(tx, request.user, documentId, true);
        // Reach and nothing else: an archived document is erasable
        // without being restored first, and so is one on an archived
        // contract.
        assertReachedDocument(target);
        if (confirmTitle.trim() !== target.title.trim()) {
          throw httpError(400, "Type the document's name exactly to delete it.");
        }

        // Read before anything is destroyed: the blobs cannot be
        // found once the rows are gone, and the entry has to be able
        // to say how much paper this took with it.
        const chain = await tx
          .select({ fileRef: documentVersions.fileRef })
          .from(documentVersions)
          .where(eq(documentVersions.documentId, documentId));

        // And what the machine derived (DOC-004, M12/4). A display
        // rendition is a second blob beside its version, and no database
        // cascade can reach a storage driver — so it is read here and
        // deleted below with the rest. Lawful erasure erases everything,
        // including the PDF a converter made of a Word draft.
        const renditions = await tx
          .select({ fileRef: documentVersionRenditions.fileRef })
          .from(documentVersionRenditions)
          .innerJoin(documentVersions, eq(documentVersionRenditions.versionId, documentVersions.id))
          .where(
            and(
              eq(documentVersions.documentId, documentId),
              isNotNull(documentVersionRenditions.fileRef),
            ),
          );

        // The entry is written first and it hangs off the owning
        // contract, never off the document (DOC-008), so nothing
        // cascades it away with the row it describes. It names the
        // title because in a moment there will be no row to read a
        // name from — which is the whole reason every other entry in
        // this module carries the title too.
        await recordActivity(tx, {
          entityType: target.ownerType,
          entityId: target.ownerId,
          actorId: request.user.id,
          action: "document.hard_deleted",
          visibility: RECORD_ACTIVITY_TIER,
          payload: { documentId, title: target.title, versionCount: chain.length },
        });

        // The rows: the document, its whole chain behind the cascade,
        // and behind that chain everything the pipeline derived — the
        // extracted text and the rendition rows, each keyed by a version
        // id and each cascading with it (DOC-005, DOC-004).
        // `contracts.primary_document_id` and
        // `documents.executed_version_id` are both SET NULL, so a
        // record whose instrument was erased has no instrument rather
        // than a dangling one.
        await tx.delete(documents).where(eq(documents.id, documentId));

        // **What this delete deliberately does not reach: comment
        // threads** (CMT-010's 2026-08-21 addendum, [#390]).
        //
        // `comments` is keyed by an `entity_type`/`entity_id` pair with
        // no foreign key, so no cascade could reach it and none is
        // written here. That is correct today for one reason and one
        // only: **there is no such thing as a document comment yet.**
        // The table's CHECK admits `document`, but the API's arm list
        // (`COMMENT_ENTITY_TYPES` in `modules/comments/audience.ts`) is
        // `contract` and `request`, and a type with no arm cannot be
        // asked for. No row can exist with `entity_type = 'document'`,
        // so this delete cannot orphan one.
        //
        // When CMT-001's anchored document comments land — the `anchor`
        // column and a `document` arm — this line starts destroying the
        // only record of a thread's subject while leaving the thread
        // behind. **Decide the semantics then, in the same change that
        // adds the arm:** sweep the thread with the document, tombstone
        // it, or reattach it to the owning contract. Do not let a
        // `document` arm reach the arm list without answering this.
        // DOC-010 is lawful erasure, so "leave the rows and let a
        // reader see nothing" is not one of the three answers.

        // The blobs, inside the transaction and before the commit
        // (DOC-012). Order is the whole argument, and the trade is
        // between two bad failures rather than between a bad one and
        // a clean one.
        //
        // Deleting after the commit would leave files on disk with no
        // row left to name them — an erasure that reports success, is
        // not one, and has nothing left to retry from. That is the
        // failure with no way back.
        //
        // Deleting here fails the other way. If the loop destroys the
        // blobs behind versions 1..k and then fails on k+1, the
        // rollback restores **every** row, including the k whose
        // bytes are already gone. The record then names files that no
        // longer exist and their downloads fail. That state is ugly
        // and it is recoverable: the erasure is still on the table,
        // and running it again converges, because deleting a key that
        // is already gone succeeds — which is exactly what DOC-012
        // defines that behaviour for. This window is accepted and
        // recorded in DOC-010; it is not a guarantee that the record
        // still holds every file it names.
        //
        // The renditions go the same way and in the same loop, because
        // they are the same problem: a derived blob left on disk after
        // an erasure reported success is an erasure that did not
        // happen. They go first, so a failure part way through has
        // destroyed derived copies rather than originals — a rendition
        // can be made again from its source, and a source cannot be
        // made again from anything.
        const blobs = [
          ...renditions.flatMap((row) => (row.fileRef === null ? [] : [row.fileRef])),
          ...chain.map((version) => version.fileRef),
        ];
        for (const fileRef of blobs) await app.storage.delete(fileRef);

        return paperOf(
          tx,
          request.user,
          {
            id: target.ownerId,
            // Derived rather than re-read: `contracts.primary_document_id`
            // is SET NULL, so the record has no instrument exactly when
            // the erased document held the designation.
            primaryDocumentId:
              target.primaryDocumentId === documentId ? null : target.primaryDocumentId,
          },
          false,
          undefined,
          undefined,
          target.ownerType,
        );
      });
    },
  );

  app.get(
    "/documents/:documentId/versions/:versionId/download",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "downloadDocumentVersion",
        summary:
          "Stream one version's file back, as an attachment. Every open " +
          "is a download in M11 — in-app rendering is M12 — and there " +
          "are no presigned URLs: the bytes come through the API behind " +
          "the session and the owning contract's access predicate. A " +
          "Contributor on the team downloads; anyone who cannot reach " +
          "the contract is answered 404, exactly as for a document that " +
          "does not exist",
        tags: ["documents"],
        // The bytes go out under the type the upload declared, so the
        // document says the widest thing that is always true rather
        // than a type it would sometimes be wrong about.
        produces: ["application/octet-stream"],
        params: VersionParams,
        response: {
          200: DownloadSchema,
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const row = await reachedVersion(request.user, request.params);

      const body = await app.storage.get(row.fileRef);
      return (
        reply
          // The declared type, which the upload did not verify — so the
          // response also says the browser must not go looking for a
          // better one, and must not render this in place.
          .header("content-type", row.mimeType)
          .header("content-length", String(row.byteSize))
          .header("content-disposition", attachmentDisposition(row.originalFilename))
          .header("x-content-type-options", "nosniff")
          // A stored blob never changes (DOC-012), and its reference is
          // minted once — but who may read it does change, so this is
          // private to the browser that asked.
          .header("cache-control", "private, max-age=0, must-revalidate")
          .send(body)
      );
    },
  );

  app.get(
    "/documents/:documentId/versions/:versionId/preview",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "previewDocumentVersion",
        summary:
          "Stream one version's file back for display in place — what " +
          "the doc panel reads (M12/2, DOC-004). It is the download's " +
          "twin and differs in exactly two headers: the disposition is " +
          "inline, and the content type is the server's own rather than " +
          "the one the upload declared. The type is routed from that " +
          "declaration and the filename together — a hint, never a " +
          "security decision — so a file that lies about itself can " +
          "change which card the panel draws and can never change what " +
          "the browser is told to do with it. A Word document and a " +
          "PowerPoint deck stream the PDF rendition the pipeline " +
          "converted them to (M12/4, DOC-004) rather than their own " +
          "bytes, so the tracked changes and comments a conversion " +
          "carries are what a reader sees; while that conversion is " +
          "still running the answer is 409, and the rendition read is " +
          "what a client polls. A family with no in-app " +
          "preview is refused 415 and the panel offers the download " +
          "instead: PDFs and raster images render today, and SVG does " +
          "not, because an inline SVG is a script. Any version in the " +
          "chain previews, superseded rounds included. It sits behind " +
          "the same two predicates every document read does: a " +
          "Contributor on the team previews what they may download, and " +
          "anyone who cannot reach the contract — or is outside a " +
          "confidential document's audience — is answered 404, exactly " +
          "as for a document that was never uploaded",
        tags: ["documents"],
        // The whole fixed set the routing table can choose from — a
        // response is one of these or it is a problem document. Unlike
        // the download's single octet-stream, this list is knowable,
        // because the server picks the type rather than echoing one.
        produces: [
          "application/pdf",
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp",
          "image/bmp",
          "image/avif",
        ],
        params: VersionParams,
        response: {
          200: DownloadSchema,
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const row = await reachedVersion(request.user, request.params);

      // Which bytes this file previews as, and what to call them. Both
      // are chosen from the routing table and never echoed from the row.
      // This is the whole of what "a hint, never a security decision"
      // buys: the uploader's string reaches the routing and never the
      // header.
      const served = conversionFormatOf(row.mimeType, row.originalFilename)
        ? await renditionToServe(request.params.versionId, row)
        : {
            contentType: previewContentType(row.mimeType, row.originalFilename),
            fileRef: row.fileRef,
            byteSize: row.byteSize,
            filename: row.originalFilename,
          };
      if (!served.contentType) {
        // Plainly, not as a 404. The reader can already see the
        // document — they were handed its row — so hiding here would
        // hide nothing and would make an honest "this does not preview"
        // read as a bug.
        throw httpError(415, "This file type has no in-app preview. Download it instead.");
      }

      const body = await app.storage.get(served.fileRef);
      return (
        reply
          .header("content-type", served.contentType)
          .header("content-length", String(served.byteSize))
          // The uploaded file's own name, and `.pdf` on the end of it
          // when what is going out is a rendition. A reader who saves
          // what the panel is showing them gets a name they recognise
          // that also says what the bytes are — and the rendition's
          // storage key stays ours, never theirs to see.
          .header("content-disposition", inlineDisposition(served.filename))
          // Belt and braces on a server-set type: the browser must use
          // the type it was given rather than sniffing the bytes for a
          // more interesting one.
          .header("x-content-type-options", "nosniff")
          // The panel fetches these bytes and draws them itself, so
          // nothing here needs to run. A browser navigated straight at
          // this address gets an inert document: no scripts, no
          // subresources, no same-origin reach.
          .header("content-security-policy", "default-src 'none'; sandbox")
          .header("cache-control", "private, max-age=0, must-revalidate")
          .send(body)
      );
    },
  );

  app.get(
    "/documents/:documentId/versions/:versionId/text",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "readDocumentVersionText",
        summary:
          "Read one version's extracted text (M12/3, DOC-005). Every " +
          "uploaded PDF has its text read in the background: a native " +
          "text layer is taken as it is, and a PDF that is only " +
          "pictures of pages is read with OCR. The original is always " +
          "what the preview serves — this text is an index, never a " +
          "displayed conversion, and no OCR'd file is stored. The " +
          "answer is a state, never a status code: pending while the " +
          "job is owed, ready with the words, failed when the job gave " +
          "up, and unsupported for a file that will never have text, " +
          "so a caller polls until it lands and stops when it will not. " +
          "It sits behind the same two predicates every document read " +
          "does: a Contributor on the team reads what they may " +
          "download, and anyone who cannot reach the contract — or is " +
          "outside a confidential document's audience — is answered " +
          "404, exactly as for a document that was never uploaded",
        tags: ["documents"],
        params: VersionParams,
        response: { 200: ExtractedTextEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      // The same read the preview and the download make, so the three
      // cannot drift into three answers. A version this viewer cannot
      // reach is a 404 from here, before anything is said about text.
      const version = await reachedVersion(request.user, request.params);

      // As the two byte reads set it, and for both of their reasons. Who
      // may read a document changes, so this is private to the browser
      // that asked; and a client polls this address, so a cached answer
      // would have it poll a stale one for ever.
      void reply.header("cache-control", "private, max-age=0, must-revalidate");

      const [row] = await app.db
        .select({
          state: documentVersionText.state,
          source: documentVersionText.source,
          text: documentVersionText.text,
          updatedAt: documentVersionText.updatedAt,
        })
        .from(documentVersionText)
        .where(eq(documentVersionText.versionId, request.params.versionId))
        .limit(1);

      if (!row) {
        // No derivation, for one of two reasons. Either this file has no
        // text to read — an image, a spreadsheet — or it predates the
        // pipeline and M12/6's sweep has not reached it yet. The first
        // is the honest answer for a reader; the second reads as pending
        // because that is what it is.
        return {
          text: {
            state: extractsText(version.mimeType, version.originalFilename)
              ? ("pending" as const)
              : ("unsupported" as const),
            source: null,
            text: null,
            updatedAt: null,
          },
        };
      }

      return {
        text: {
          state: row.state,
          source: row.source,
          text: row.text,
          updatedAt: row.updatedAt.toISOString(),
        },
      };
    },
  );

  app.get(
    "/documents/:documentId/versions/:versionId/rendition",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "readDocumentVersionRendition",
        summary:
          "Say whether this version's display rendition is ready to " +
          "preview (M12/4, DOC-004). A Word document and a PowerPoint " +
          "deck do not draw in a browser, so the pipeline converts each " +
          "one to a PDF in the background and the panel draws that — " +
          "tracked changes and comments included. This is the state of " +
          "that conversion, and it is what the panel polls while it " +
          "shows its preparing state; live push is M30's job. The " +
          "answer is a state, never a status code: pending while the " +
          "job is owed, ready once the preview address will stream it, " +
          "failed when the job gave up, and unsupported for a file that " +
          "needs no conversion at all — a PDF, an image, a spreadsheet. " +
          "A version whose conversion failed is offered its download " +
          "instead; the upload itself is never blocked or failed by " +
          "its pipeline. It sits behind the same two predicates every " +
          "document read does: a Contributor on the team reads what " +
          "they may download, and anyone who cannot reach the contract " +
          "— or is outside a confidential document's audience — is " +
          "answered 404, exactly as for a document that was never " +
          "uploaded",
        tags: ["documents"],
        params: VersionParams,
        response: { 200: RenditionEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      // The same read the preview, the download, and the text read make,
      // so the four cannot drift into four answers. A version this
      // viewer cannot reach is a 404 from here, before anything is said
      // about a conversion.
      const version = await reachedVersion(request.user, request.params);

      // As every other read on a version sets it, and for both of their
      // reasons. Who may read a document changes, so this is private to
      // the browser that asked; and a client polls this address, so a
      // cached answer would have it poll a stale one for ever.
      void reply.header("cache-control", "private, max-age=0, must-revalidate");

      if (!needsDisplayRendition(version.mimeType, version.originalFilename)) {
        // Nothing is being converted and nothing ever will be. Said
        // plainly, so a caller stops asking rather than polling for
        // something that is not coming.
        return { rendition: { state: "unsupported" as const, updatedAt: null } };
      }

      const [row] = await app.db
        .select({
          state: documentVersionRenditions.state,
          updatedAt: documentVersionRenditions.updatedAt,
        })
        .from(documentVersionRenditions)
        .where(eq(documentVersionRenditions.versionId, request.params.versionId))
        .limit(1);

      // No row, for one of two reasons. Either the version predates the
      // pipeline and M12/6's sweep has not reached it yet, or the queue
      // send was lost — and both read as pending, because that is what
      // they are.
      if (!row) return { rendition: { state: "pending" as const, updatedAt: null } };
      return { rendition: { state: row.state, updatedAt: row.updatedAt.toISOString() } };
    },
  );

  app.get(
    "/documents/:documentId/versions/:versionId/email",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "readDocumentVersionEmail",
        summary:
          "Read one uploaded email as a message (M12/5, DOC-004): its " +
          "headers, its body, and the files that came with it. A MSG or " +
          "an EML is parsed in process by a Node library — no doc " +
          "engine, no conversion, and nothing stored — so the answer is " +
          "the message as the file holds it, read fresh on every call. " +
          "The HTML body is sanitized here, on the server, before it is " +
          "handed out: nothing in it runs and nothing in it loads, so a " +
          "tracking pixel cannot report that a lawyer opened a disclosed " +
          "email. Attachments are listed with the family each one would " +
          "render as, and each is reachable at its own address. A file " +
          "that is not an email is refused 415, and one whose bytes " +
          "cannot be read as the email they claim to be is refused 422 " +
          "with the download offered. It sits behind the same two " +
          "predicates every document read does: a Contributor on the " +
          "team reads what they may download, and anyone who cannot " +
          "reach the contract — or is outside a confidential document's " +
          "audience — is answered 404, exactly as for a document that " +
          "was never uploaded",
        tags: ["documents"],
        params: VersionParams,
        response: { 200: EmailEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const email = await reachedEmail(request.user, request.params);

      // As every other read on a version sets it. Who may read a
      // document changes, so this answer is private to the browser that
      // asked for it.
      void reply.header("cache-control", "private, max-age=0, must-revalidate");

      return {
        email: {
          subject: email.subject,
          from: email.from,
          to: email.to,
          cc: email.cc,
          bcc: email.bcc,
          date: email.date,
          // Already sanitized by the parser, which is the only thing
          // that ever holds the sender's own markup.
          html: email.html,
          text: email.text,
          attachments: email.attachments.map((attachment) => ({
            index: attachment.index,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            byteSize: attachment.byteSize,
            // Routed from the attachment's own declared type and name,
            // through the same table a stored version goes through — so
            // the panel holds no second copy of it and an attachment
            // that lies about itself changes a card and never a header.
            renderFamily: renderFamilyOf(attachment.mimeType, attachment.filename),
            isInline: attachment.isInline,
          })),
        },
      };
    },
  );

  app.get(
    "/documents/:documentId/versions/:versionId/attachments/:attachmentIndex/download",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "downloadEmailAttachment",
        summary:
          "Stream one file out of a rendered email, as an attachment " +
          "(M12/5, DOC-004). The index is the file's position in the " +
          "message, which is a stable name for it because the version's " +
          "bytes are immutable (DOC-001). Unlike a version's own " +
          "download, this never echoes a declared type: a version's " +
          "type was bounded and shape-checked when it was uploaded, and " +
          "this one came out of the middle of a file nobody checked at " +
          "all — so the bytes go out as `application/octet-stream`, " +
          "with the attachment disposition and sniffing off. An " +
          "attachment is not a side door: it sits behind the same two " +
          "predicates its version does, so anyone who cannot reach the " +
          "contract — or is outside a confidential document's audience " +
          "— is answered 404, exactly as for a document that was never " +
          "uploaded",
        tags: ["documents"],
        produces: ["application/octet-stream"],
        params: AttachmentParams,
        response: { 200: DownloadSchema, default: problemResponse },
      },
    },
    async (request, reply) => {
      const attachment = await reachedAttachment(request.user, request.params);
      return (
        reply
          // Never the type the message declared. The disposition below
          // makes this a download whatever the type says, and a type
          // this server did not choose is not one it will repeat.
          .header("content-type", "application/octet-stream")
          .header("content-length", String(attachment.byteSize))
          .header("content-disposition", attachmentDisposition(attachment.filename))
          .header("x-content-type-options", "nosniff")
          .header("cache-control", "private, max-age=0, must-revalidate")
          .send(attachment.content)
      );
    },
  );

  app.get(
    "/documents/:documentId/versions/:versionId/attachments/:attachmentIndex/preview",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "previewEmailAttachment",
        summary:
          "Stream one file out of a rendered email for display in place " +
          "(M12/5, DOC-004), so a PDF or a photographed page attached to " +
          "a message opens in the panel rather than in a Downloads " +
          "folder. It is the attachment download's twin and differs in " +
          "the same two headers a version's preview differs in: the " +
          "disposition is inline, and the content type is chosen from " +
          "the routing table rather than echoed from the message. An " +
          "attachment outside the render set is refused 415 and the " +
          "panel offers its download instead — there is no conversion " +
          "path for an attachment, so a Word file inside an email " +
          "downloads. It sits behind the same two predicates its version " +
          "does: anyone who cannot reach the contract, or is outside a " +
          "confidential document's audience, is answered 404",
        tags: ["documents"],
        produces: [
          "application/pdf",
          "image/png",
          "image/jpeg",
          "image/gif",
          "image/webp",
          "image/bmp",
          "image/avif",
        ],
        params: AttachmentParams,
        response: { 200: DownloadSchema, default: problemResponse },
      },
    },
    async (request, reply) => {
      const attachment = await reachedAttachment(request.user, request.params);
      const contentType = previewContentType(attachment.mimeType, attachment.filename);
      if (!contentType) {
        // Plainly, not as a 404, for the version preview's own reason:
        // the reader was already handed this attachment's row, so hiding
        // here would hide nothing.
        throw httpError(415, "This attachment has no in-app preview. Download it instead.");
      }
      return (
        reply
          .header("content-type", contentType)
          .header("content-length", String(attachment.byteSize))
          .header("content-disposition", inlineDisposition(attachment.filename))
          .header("x-content-type-options", "nosniff")
          // The panel fetches these bytes and draws them itself. A
          // browser navigated straight at this address gets an inert
          // document: no scripts, no subresources, no same-origin reach.
          .header("content-security-policy", "default-src 'none'; sandbox")
          .header("cache-control", "private, max-age=0, must-revalidate")
          .send(attachment.content)
      );
    },
  );

  /**
   * One uploaded email this viewer reaches, parsed (M12/5).
   *
   * Reach is answered first and in exactly the same words every other
   * document read answers it in, so an email opens no side door past the
   * contract gate or the confidentiality flag (DOC-008, DD-014). Only
   * then is anything said about the file.
   *
   * The parse happens on every call rather than once at upload. An email
   * has no rendition and no derived row: the bytes are immutable, the
   * parse is deterministic, and reading a message is milliseconds of
   * work in this process — so there is nothing to store, nothing to
   * poll, and no state that could disagree with the file.
   *
   * The cost is named rather than cached away: opening an attachment
   * reads the whole message again. It is bounded on both sides — the
   * parser refuses anything past `MAX_PARSEABLE_EMAIL_BYTES`, and every
   * call here has already passed the same session and the same two
   * predicates a download passes — so what it buys, a surface with no
   * derived state to invalidate, is worth more than the read it repeats.
   * A cache is the answer if a profile ever says otherwise, and nothing
   * above this function would have to change for it.
   */
  async function reachedEmail(
    user: AuthenticatedUser,
    params: Readonly<{ documentId: string; versionId: string }>,
  ): Promise<ParsedEmail> {
    const version = await reachedVersion(user, params);
    if (!isEmail(version.mimeType, version.originalFilename)) {
      throw httpError(415, "This file is not an email.");
    }
    const blob = await app.storage.get(version.fileRef);
    try {
      return await parseStoredEmail(blob, version.mimeType, version.originalFilename);
    } catch (error) {
      if (error instanceof EmailUnreadableError) {
        // The bytes are not the email they said they were, or there are
        // more of them than this parser will open. Neither is an access
        // answer and neither heals, so it is said plainly with the
        // download offered — DOC-004's honest card, in a status code.
        throw httpError(422, "This email could not be read. Download it instead.");
      }
      throw error;
    } finally {
      // An email is parsed to the end, so there is usually nothing left
      // to close — but a parse that refused part way through leaves the
      // stream open, and on the local driver that is a file handle this
      // process holds until it notices. A close that fails must not
      // replace the answer above: tidying up is never the news.
      try {
        blob.destroy();
      } catch (error) {
        app.log.warn({ err: error, versionId: params.versionId }, "could not close an email");
      }
    }
  }

  /** One file inside one reachable email, or the refusal it earned. */
  async function reachedAttachment(
    user: AuthenticatedUser,
    params: Readonly<{ documentId: string; versionId: string; attachmentIndex: number }>,
  ): Promise<EmailAttachment & { content: Buffer }> {
    const email = await reachedEmail(user, params);
    const attachment = email.attachments[params.attachmentIndex];
    // An index past the end of the list is a 404, and it is the only
    // 404 here that is about the attachment rather than about reach.
    // Nothing is hidden by it: the reader can see the list it is not on.
    if (!attachment) throw httpError(404, "No attachment exists at that position.");
    if (attachment.content === null) {
      // The message named this file and the container could not give up
      // its bytes. It is on the list — losing it would have shifted
      // every attachment after it onto somebody else's address — and it
      // is the one entry that cannot be served. Said as the unreadable
      // email is said, because it is the same fact one file down.
      throw httpError(
        422,
        "This attachment could not be read out of the message. Download the email instead.",
      );
    }
    return { ...attachment, content: attachment.content };
  }

  /** What the preview streams for one version, and what to call it. */
  interface ServedPreview {
    contentType: string | null;
    fileRef: string;
    byteSize: number;
    filename: string;
  }

  /**
   * The display rendition the preview streams for a converted family
   * (M12/4, DOC-004), or the refusal its state has earned.
   *
   * A conversion that is still running is a 409 rather than a 415: the
   * two say different things, and only one of them is worth polling. The
   * panel does not usually arrive here in that state — it polls the
   * rendition read and opens this address once it says ready — but a
   * browser pointed straight at it must be told which of the two it has
   * hit.
   *
   * A conversion that failed is a 415 with the download offered, which
   * is DOC-004's honest card in the words of a status code: a LibreOffice
   * failure costs one click, not a support ticket.
   */
  async function renditionToServe(
    versionId: string,
    version: ReachedVersion,
  ): Promise<ServedPreview> {
    const [row] = await app.db
      .select({
        state: documentVersionRenditions.state,
        fileRef: documentVersionRenditions.fileRef,
        byteSize: documentVersionRenditions.byteSize,
      })
      .from(documentVersionRenditions)
      .where(eq(documentVersionRenditions.versionId, versionId))
      .limit(1);

    if (row?.state === "ready" && row.fileRef !== null && row.byteSize !== null) {
      return {
        contentType: RENDITION_CONTENT_TYPE,
        fileRef: row.fileRef,
        byteSize: row.byteSize,
        filename: `${version.originalFilename}.pdf`,
      };
    }
    if (row?.state === "failed") {
      throw httpError(
        415,
        "This file could not be converted for reading in the app. Download it instead.",
      );
    }
    // Pending, or no row at all — a version that predates the pipeline,
    // or one whose queue send was lost. Both are "not yet", and both are
    // worth asking about again.
    throw httpError(409, "This file is still being prepared for reading. Try again in a moment.");
  }

  /** One stored version, as the two byte reads need it described. */
  interface ReachedVersion {
    fileRef: string;
    originalFilename: string;
    mimeType: string;
    byteSize: number;
  }

  /**
   * One version this viewer reaches, by its own id and its document's,
   * or a 404.
   *
   * Shared by the download, the preview, and the extracted-text read,
   * because they ask one question and must not drift into three
   * answers. Document, owning
   * contract, and both scopes ride in one read: a version on a contract
   * the viewer cannot reach, and a version of a confidential document
   * they are outside the audience of, are each answered exactly as one
   * that was never uploaded (DOC-008, DD-014). Rendering opens no side
   * door past the contract gate.
   */
  async function reachedVersion(
    user: AuthenticatedUser,
    params: Readonly<{ documentId: string; versionId: string }>,
  ): Promise<ReachedVersion> {
    const [row] = await app.db
      .select({
        fileRef: documentVersions.fileRef,
        originalFilename: documentVersions.originalFilename,
        mimeType: documentVersions.mimeType,
        byteSize: documentVersions.byteSize,
      })
      .from(documentVersions)
      .innerJoin(documents, eq(documentVersions.documentId, documents.id))
      .leftJoin(contracts, eq(documents.contractId, contracts.id))
      .leftJoin(matters, eq(documents.matterId, matters.id))
      .where(
        and(
          eq(documentVersions.id, params.versionId),
          eq(documentVersions.documentId, params.documentId),
          or(
            and(isNotNull(documents.contractId), contractTeamScope(app.db, user)),
            and(isNotNull(documents.matterId), matterTeamScope(app.db, user)),
          ),
          documentAudienceScope(app.db, user),
        ),
      )
      .limit(1);
    if (!row) throw httpError(404, NO_DOCUMENT);
    return row;
  }

  /** One uploaded file, once its bytes are stored and described. */
  interface StoredUpload {
    filename: string;
    mimeType: string;
    kind: HandSetDocumentVersionKind;
    note: string | null;
    /**
     * Where the file is to be filed (DOC-006, DOC-011), or null for the
     * record root.
     *
     * Read off the form and checked for shape here, before a byte is
     * stored; the folder itself is resolved under the contract's row
     * lock in the handler, because that is where it can be created
     * without two racing uploads making two of it.
     */
    destination: FolderDestination | null;
    fileRef: string;
    byteSize: number;
    checksumSha256: string;
  }

  /**
   * Takes one multipart upload off the request, stores its bytes through
   * the adapter, and answers what arrived.
   *
   * Shared by the two upload paths — creating a document and appending
   * to one — because the file half of both is the same act, and the
   * refusals have to be too: a person who is told a 300-character name
   * is too long on their first upload must be told the same thing on
   * their fourth.
   *
   * The bytes are streamed straight through: never buffered whole in
   * memory, never staged on disk, hashed and counted on the same pass.
   *
   * `filed` says whether this path takes a folder destination. Creating
   * a document does (DOC-011); appending a round to an existing chain
   * does not, because a version lands where its document is already
   * filed and a destination there would be a second answer to a question
   * the document has already answered.
   */
  async function receiveUpload(
    request: FastifyRequest,
    key: string,
    filed = false,
  ): Promise<StoredUpload> {
    const part = await request.file().catch((error: unknown) => {
      throw asSharedUploadRefusal(error, app.maxUploadBytes);
    });
    if (!part) throw httpError(400, "Attach a file to upload.");

    // Read before the file is consumed. The parser reports the fields
    // it has already seen, and the file part ends the ones it can
    // report — which is why the form has to put them first.
    const rawKind = fieldValue(part.fields, "kind");
    const rawNote = fieldValue(part.fields, "note");
    // Checked here rather than after the bytes are stored, so a batch
    // whose paths are malformed is refused a file at a time without
    // having written any of them. The folder is *resolved* later, under
    // the contract's row lock: that is the only place it can be created
    // without two racing uploads making two of it.
    const destination = filed ? folderDestination(part.fields) : null;
    const kind: HandSetDocumentVersionKind = rawKind
      ? (HandSetKindSchema.safeParse(rawKind).data ?? refuseKind())
      : "draft_ours";
    // Refused rather than shortened. A note is what the uploader wrote
    // about this round, and silently keeping the first 2000 characters
    // of it would put words on the record that nobody chose to stop
    // at — the composer bounds its own control, so a note this long is
    // a client that ignored the bound and is told so.
    const trimmedNote = rawNote?.trim() ?? "";
    if (trimmedNote.length > MAX_NOTE_LENGTH) {
      throw httpError(400, `Shorten the note to ${MAX_NOTE_LENGTH} characters or fewer.`);
    }
    const note = trimmedNote || null;

    // Checked where every upload route checks it, so the two paths
    // cannot come to differ about what a usable filename is.
    const filename = uploadFilename(part.filename);
    // Client-supplied and unverified, so it is stored as a hint and
    // never acted on. An upload that declares nothing is stored as
    // the type that means "bytes".
    //
    // Bounded and shape-checked before it is stored, because this value
    // is written to a row and then echoed into the download's
    // `content-type` on every open. A declaration that is not a media
    // type is treated as no declaration at all rather than refused: the
    // bytes are what the uploader came to store, and the hint is the
    // one field here that nothing downstream may trust anyway.
    const declared = part.mimetype.trim();
    const mimeType =
      declared.length > 0 &&
      declared.length <= MAX_MIME_TYPE_LENGTH &&
      MIME_TYPE_PATTERN.test(declared)
        ? declared
        : "application/octet-stream";

    const digest = createHash("sha256");
    let byteSize = 0;
    // One pass: the bytes are hashed and counted on their way to the
    // driver, so nothing is read twice and nothing is held whole in
    // memory. An error on the source — a cut-off upload, the size
    // limit tripping — is thrown out of the iterator, so `put`
    // rejects and the driver leaves nothing at the key.
    async function* metered(source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        digest.update(chunk);
        byteSize += chunk.length;
        yield chunk;
      }
    }

    let fileRef: string;
    try {
      fileRef = await app.storage.put(key, Readable.from(metered(part.file)));
    } catch (error) {
      throw asSharedUploadRefusal(error, app.maxUploadBytes);
    }
    // The ceiling, enforced. The parser stops the stream at the limit
    // and marks it truncated rather than throwing at whoever is
    // reading it, so what reached the driver is the first N bytes of a
    // longer file — a silent corruption if it were kept. It is deleted
    // here rather than left as an orphan, because this is the one case
    // where the writer knows the blob is worthless. The key is not
    // written again (DOC-012): the retry mints its own.
    if (part.file.truncated) {
      await app.storage.delete(fileRef).catch((error: unknown) => {
        request.log.warn({ err: error, fileRef }, "could not remove a truncated upload");
      });
      throw refuseOversize();
    }

    return {
      filename,
      mimeType,
      kind,
      note,
      destination,
      fileRef,
      byteSize,
      checksumSha256: digest.digest("hex"),
    };
  }

  /**
   * Runs the write that follows a stored upload, and takes the blob away
   * if it does not commit (DOC-012) — the shared rule, named here for
   * the file this module holds.
   *
   * Every refusal after the bytes reach the driver leaves a blob nothing
   * points at. Most of them are rare — reach revoked between two reads,
   * the record archived under the uploader. **A folder destination is
   * not**: a dropped path can be too deep, or name a folder on another
   * record, and a batch refused a file at a time would leave one orphan
   * per refused file.
   */
  async function withStoredFile<T>(
    request: FastifyRequest,
    file: StoredUpload,
    write: () => Promise<T>,
  ): Promise<T> {
    return await withStoredBlob(app.storage, request.log, file.fileRef, write);
  }

  /**
   * Where an upload says it is to be filed (M13/5, DOC-011), or null for
   * the record root.
   *
   * The two fields compose rather than exclude each other, because the
   * drop can carry both: `folderId` is the row the gesture landed on,
   * and `folderPath` is the chain to recreate beneath it. Dropping a
   * tree onto a folder row is exactly that pair.
   *
   * Only the shape is decided here. Whether the folder is on this record
   * — and whether the chain fits under the ceiling once it is placed —
   * is decided under the row lock, where the answer cannot go stale.
   */
  function folderDestination(fields: Record<string, unknown>): FolderDestination | null {
    const rawFolderId = fieldValue(fields, "folderId")?.trim() ?? "";
    const rawPath = fieldValue(fields, "folderPath") ?? "";
    // Bounded before either is read as anything but text. An id longer
    // than any id could be names no folder, and is answered exactly as
    // one that was never created rather than as a length complaint.
    if (rawFolderId.length > MAX_RECORD_ID_LENGTH) {
      throw httpError(404, NO_FOLDER);
    }
    if (rawPath.length > MAX_FOLDER_PATH_LENGTH) {
      throw httpError(400, `A folder path can be at most ${MAX_FOLDER_PATH_LENGTH} characters.`);
    }
    const path = folderPathSegments(rawPath);
    if (rawFolderId.length === 0 && path.length === 0) return null;
    return { folderId: rawFolderId.length === 0 ? null : rawFolderId, path };
  }

  /** One row in the chain, written from what arrived. The write itself
   * is `lib/document-versions.ts` — shared with the signing
   * integration's executed-copy append (M15/5), because a round filed
   * by a person and a round filed by the integration are the same row
   * (DOC-001). This is only the upload's half of the translation. */
  function insertVersion(
    tx: Transaction,
    row: Readonly<{
      documentId: string;
      versionId: string;
      versionNumber: number;
      file: StoredUpload;
      by: AuthenticatedUser;
    }>,
  ) {
    return insertDocumentVersion(tx, {
      documentId: row.documentId,
      versionId: row.versionId,
      versionNumber: row.versionNumber,
      fileRef: row.file.fileRef,
      kind: row.file.kind,
      note: row.file.note,
      originalFilename: row.file.filename,
      mimeType: row.file.mimeType,
      byteSize: row.file.byteSize,
      checksumSha256: row.file.checksumSha256,
      createdBy: row.by.id,
    });
  }

  /**
   * Wakes the pipeline for whatever a freshly uploaded version is owed —
   * its text (DOC-005), or its display rendition (DOC-004).
   *
   * The ask itself is `lib/document-versions.ts`, shared with the
   * signing integration's executed-copy append (M15/5). This is only
   * the upload's half of the translation, and the rule it carries is
   * the upload's: called **after** the transaction has committed, so a
   * rolled-back upload asks for nothing and a queue that cannot be
   * reached never fails the upload and never holds it up. The person
   * who uploaded is owed a 201 — a pipeline that is down is not their
   * problem (story 11).
   */
  function askForDerivations(versionId: string, file: StoredUpload): Promise<void> {
    return requestDerivations(app.jobs, app.log, {
      versionId,
      mimeType: file.mimeType,
      originalFilename: file.filename,
    });
  }

  /** The one refusal a bad `kind` earns, thrown rather than returned so
   * the expression above stays one line. */
  function refuseKind(): never {
    throw httpError(400, "That is not a version kind this record accepts.");
  }

  /**
   * The two refusals every upload shares, in the order they have to be
   * asked in.
   *
   * Reach first: a 409 on a record the uploader cannot reach would tell
   * them it is there. Then the freeze — an archived contract reads as
   * facts until it is restored (CTR-021), and putting new paper on it is
   * a change to the record, not a conversation about it.
   */
  function assertOpen<T extends ReachedContract>(contract: T | null): asserts contract is T {
    if (!contract) throw httpError(404, NO_CONTRACT);
    if (contract.archivedAt) {
      throw httpError(409, "This contract is archived. Restore it before uploading.");
    }
  }

  function assertOpenMatter<T extends Awaited<ReturnType<typeof reachedMatter>>>(
    matter: T | null,
  ): asserts matter is T {
    if (!matter) throw httpError(404, NO_MATTER);
    if (matter.archivedAt) {
      throw httpError(409, "This matter is archived. Restore it before uploading.");
    }
  }

  /**
   * The refusals a write addressed at a document shares, in the order
   * they have to be asked in.
   *
   * Reach first, for the reason above. Then the contract's freeze. Then
   * the document's own archive (DOC-010): an archived document is off
   * the record's list, so adding a round to it or renaming it would be
   * work done on something nobody can see. Restoring it and erasing it
   * are the two things that may still reach it, and neither comes
   * through here.
   */
  function assertOpenDocument(
    document: ReachedDocument | null,
  ): asserts document is ReachedDocument {
    assertReachedDocument(document);
    assertLiveOwner(document);
    if (document.archivedAt) {
      throw httpError(409, "This document is archived. Restore it before changing it.");
    }
  }

  /**
   * The two refusals behind the per-document Confidential flag
   * (DD-014, CTR-022, DOC-008), decided by the shared access module and
   * turned into HTTP here.
   *
   * A viewer who reaches the document but is none of the three actors
   * is refused plainly: they can already see the file, so a 404 would
   * hide nothing and would only make a real permission boundary read as
   * a bug. The refusal says who may, and says nothing about the
   * document that the reader cannot see for themselves.
   *
   * A viewer outside the document's audience never arrives here — the
   * read that produced this row already applied the same predicate, in
   * the same words a document that does not exist is refused in. The
   * module still answers that case and this still turns it into that
   * 404: the whole question has one home, and a caller that read half
   * the answer would be one refactor away from a leak.
   */
  async function assertMayFlagConfidential(
    _tx: Transaction,
    document: ReachedDocument,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (
      user.role !== "administrator" &&
      document.createdBy !== user.id &&
      document.ownerManagerId !== user.id
    ) {
      throw httpError(
        403,
        "Only an Administrator, the person who uploaded this document, or " +
          `the ${document.ownerType === "contract" ? "contract's Owner" : "Matter Manager"} can change this.`,
      );
    }
  }

  /** Reach and nothing else, for the two writes an archived document
   * still takes: restoring it, and erasing it. */
  function assertReachedDocument(
    document: ReachedDocument | null,
  ): asserts document is ReachedDocument {
    if (!document) throw httpError(404, NO_DOCUMENT);
  }

  /** The primary and executed designations are contract concepts
   * (M22/7). A document the viewer can read but that a matter owns is
   * refused in the open: a 404 here would hide nothing and would read
   * as a bug. */
  function assertContractDocument(
    document: ReachedDocument,
  ): asserts document is ReachedDocument & { contractId: string; ownerType: "contract" } {
    if (document.ownerType !== "contract" || document.contractId === null) {
      throw httpError(
        409,
        "Matter paper has no primary document or executed copy. Those are contract designations.",
      );
    }
  }

  /** The owning contract's freeze, on its own. Archive and restore ask
   * for this one without the archived-document check above, because
   * whether the document is archived is the very thing they are
   * changing — and they must tell "already archived" apart from "on a
   * frozen record" rather than answering both with one sentence. */
  function assertLiveOwner(document: ReachedDocument): void {
    if (document.ownerArchivedAt) {
      const noun = document.ownerType === "contract" ? "contract" : "matter";
      throw httpError(409, `This ${noun} is archived. Restore it before changing its paper.`);
    }
  }

  /**
   * The parser's own rejections and the size refusal, both read from the
   * shared upload rules so this route and the portal's attachment upload
   * answer an oversize file with one sentence.
   */
  function refuseOversize() {
    return refuseSharedOversize(app.maxUploadBytes);
  }
};
