// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The documents vocabulary the contract record's Documents section
 * reads: the row shape the API answers, the chain split into the version
 * that matters now and the ones it supersedes, the address a download is
 * fetched from, and the calls the section makes — the two uploads, the
 * metadata edit, the two CTR-014 designations, and DOC-010's two
 * removals.
 *
 * The two uploads do not go through the generated client.
 * `openapi-fetch` types a `format: binary` field as a string, and the
 * thing being sent is a `File` — so those calls are plain same-origin
 * `fetch`es with a `FormData` body, which is also what carries the
 * session cookie and lets the browser write the multipart boundary. The
 * metadata edit is ordinary JSON and goes through the typed client, like
 * everything else on this page.
 */

import type { paths } from "@openlaw/api-client";
import type { DocumentOwner } from "@openlaw/shared";
import type { IntlShape } from "react-intl";
import { api } from "./api";
// The separator a folder path is written with on the wire, taken from
// the module that reads a dropped tree rather than written again here:
// the string the walk joins on and the string the seam splits on have
// to be one string.
import { PATH_SEPARATOR as FOLDER_PATH_SEPARATOR } from "./batch-upload";
import { problem, type Problem } from "./problem";

/** The API's answer for one contract's paper, aliased to the generated
 * schema so an API change surfaces as a compile error here rather than
 * as a runtime surprise on the record page. */
type ListResponse =
  paths["/api/v1/contracts/{number}/documents"]["get"]["responses"]["200"]["content"]["application/json"];

/** One document on a record, with its whole version chain. */
export type ContractDocument = ListResponse["documents"][number];

/** One row in M26's flat repository. */
type RepositoryResponse =
  paths["/api/v1/documents"]["get"]["responses"]["200"]["content"]["application/json"];
export type RepositoryDocument = RepositoryResponse["documents"][number];

type RepositoryOptionsResponse =
  paths["/api/v1/documents/options"]["get"]["responses"]["200"]["content"]["application/json"];
export type DocumentRepositoryOptions = RepositoryOptionsResponse;

export async function readDocumentOptions(): Promise<
  { ok: true; options: DocumentRepositoryOptions } | ({ ok: false } & Problem)
> {
  const result = await api.GET("/api/v1/documents/options").catch(() => undefined);
  return result?.data
    ? { ok: true, options: result.data }
    : { ok: false, ...(await problem(result)) };
}

export const DOCUMENT_REPOSITORY_FORMATS = [
  "pdf",
  "word",
  "powerpoint",
  "image",
  "email",
  "other",
] as const;
export type DocumentRepositoryFormat = (typeof DOCUMENT_REPOSITORY_FORMATS)[number];

export const DOCUMENT_REPOSITORY_KINDS = [
  "draft_ours",
  "draft_theirs",
  "redline_theirs",
  "redline_ours",
  "executed",
  "amendment",
  "generated_redline",
] as const;

export const DOCUMENT_REPOSITORY_SORT_KEYS = [
  "title",
  "owner",
  "kind",
  "format",
  "size",
  "uploader",
  "uploaded",
] as const;

export interface DocumentRepositoryFilters {
  owner: "" | DocumentOwner;
  record: string;
  folder: string;
  format: "" | DocumentRepositoryFormat;
  kind: "" | DocumentVersionKind;
  counterparty: string;
  uploader: string;
  uploadedFrom: string;
  uploadedTo: string;
  includeArchived: boolean;
}

export function documentRepositoryFilters(
  filters: Record<string, boolean | string>,
): DocumentRepositoryFilters {
  const owner = filters.owner;
  const format = filters.format;
  const kind = filters.kind;
  return {
    owner:
      owner === "contract" || owner === "matter" || owner === "entity" || owner === "knowledge_item"
        ? owner
        : "",
    record: typeof filters.record === "string" ? filters.record : "",
    folder: typeof filters.folder === "string" ? filters.folder : "",
    format: DOCUMENT_REPOSITORY_FORMATS.some((candidate) => candidate === format)
      ? (format as DocumentRepositoryFormat)
      : "",
    kind: DOCUMENT_REPOSITORY_KINDS.some((candidate) => candidate === kind)
      ? (kind as DocumentVersionKind)
      : "",
    counterparty: typeof filters.counterparty === "string" ? filters.counterparty : "",
    uploader: typeof filters.uploader === "string" ? filters.uploader : "",
    uploadedFrom: typeof filters.uploadedFrom === "string" ? filters.uploadedFrom : "",
    uploadedTo: typeof filters.uploadedTo === "string" ? filters.uploadedTo : "",
    includeArchived: filters.includeArchived === true,
  };
}

export function documentRecordReference(
  reference: string,
  owner?: DocumentOwner,
): DocumentRecord | null {
  const match = /^([CM])-([1-9]\d*)$/.exec(reference);
  if (!match?.[2]) {
    // The API's rule: a value shaped like a numbered reference must be
    // one; anything else is an opaque id — an Entity's, or a Knowledge
    // Item's when the caller says the owner is one.
    return reference.length > 0 && reference.length <= 64 && !/^[CM]-/.test(reference)
      ? { entityType: owner === "knowledge_item" ? "knowledge_item" : "entity", id: reference }
      : null;
  }
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number) || number > 2_147_483_647) return null;
  return { entityType: match[1] === "C" ? "contract" : "matter", number };
}

export function documentOwnerReference(owner: {
  kind: DocumentOwner;
  number: number | null;
  reference: string;
}): string {
  switch (owner.kind) {
    case "contract":
      return `C-${String(owner.number!)}`;
    case "matter":
      return `M-${String(owner.number!)}`;
    case "entity":
    case "knowledge_item":
      return owner.reference;
  }
}

/** The M25 landing address reused by repository rows. */
export function documentLandingPath(document: RepositoryDocument): string {
  const owner = document.owner;
  let root: string;
  switch (owner.kind) {
    case "contract":
      root = "/contracts";
      break;
    case "matter":
      root = "/matters";
      break;
    case "entity":
      return `/entities/${encodeURIComponent(owner.id)}/documents?doc=${encodeURIComponent(document.id)}&version=${encodeURIComponent(document.currentVersion.id)}`;
    case "knowledge_item":
      return `/knowledge/${encodeURIComponent(owner.id)}?doc=${encodeURIComponent(document.id)}&version=${encodeURIComponent(document.currentVersion.id)}`;
  }
  return `${root}/${String(owner.number)}/documents?doc=${encodeURIComponent(document.id)}&version=${encodeURIComponent(document.currentVersion.id)}`;
}

/** The record whose paper the shared Documents section is drawing. */
export type DocumentRecord =
  | { entityType: "contract" | "matter"; number: number }
  | { entityType: "entity" | "knowledge_item"; id: string };

/**
 * The listing context that is the record root — the documents filed in
 * no folder (DOC-006, M13/3).
 *
 * The filter has three answers and one of them has no id to be addressed
 * by, so the record root is addressed by a word. The seam reserves it:
 * every id in the API is a uuidv7, so no folder can be called this.
 */
export const FOLDER_ROOT = "root";

/** One immutable file snapshot (DOC-001). */
export type DocumentVersion = ContractDocument["versions"][number];

/** What a version is in the negotiation (CTR-014). */
export type DocumentVersionKind = DocumentVersion["kind"];

/** DES-066's kind families, shared by record paper and the repository. */
export const DOCUMENT_KIND_PILL: Record<DocumentVersionKind, string> = {
  draft_ours: "bg-status-info-bg text-status-info-fg",
  redline_ours: "bg-status-info-bg text-status-info-fg",
  draft_theirs: "bg-status-warning-bg text-status-warning-fg",
  redline_theirs: "bg-status-warning-bg text-status-warning-fg",
  executed: "bg-status-success-bg text-status-success-fg",
  amendment: "bg-status-neutral-bg text-status-neutral-fg",
  generated_redline: "bg-status-neutral-bg text-status-neutral-fg",
};

/** One Version kind, in the negotiation's own words. */
export function documentKindLabel(intl: IntlShape, kind: DocumentVersionKind): string {
  return intl.formatMessage(
    {
      id: "documents.kind",
      defaultMessage:
        "{kind, select, draft_ours {Draft · ours} draft_theirs {Draft · theirs} " +
        "redline_theirs {Redline · theirs} redline_ours {Redline · ours} " +
        "executed {Executed} amendment {Amendment} " +
        "generated_redline {Generated redline} other {Unknown}}",
    },
    { kind },
  );
}

/**
 * Which of DOC-004's families a file belongs to, as the API routes it.
 *
 * Routed on the server from the declared type and the filename, so
 * nothing here holds a copy of that table: the panel switches on the
 * family it is handed and a family added later arrives without a client
 * change.
 */
export type RenderFamily = DocumentVersion["renderFamily"];

/**
 * The families the doc panel renders in place today (M12/2, M12/4,
 * M12/5).
 *
 * Word and PowerPoint are in it because DOC-004 promises they read in
 * the app: they do not draw in a browser, so the pipeline converts each
 * one to a PDF and the panel draws that — tracked changes and comments
 * included. Email is in it because an uploaded MSG or EML is parsed on
 * the server and drawn as a message. The long tail never is, and gets
 * the honest download card DOC-004 asks for, never a broken preview.
 *
 * A conversion that has not landed yet — or one that failed — is a state
 * inside the panel, not a reason to keep the row a download link. What
 * this list answers is "does this file read in the app at all".
 */
export const PREVIEWABLE_FAMILIES = [
  "pdf",
  "image",
  "word",
  "presentation",
  "email",
] as const satisfies readonly RenderFamily[];

/** Whether this version opens in the panel or offers its download. */
export function isPreviewable(version: DocumentVersion): boolean {
  return (PREVIEWABLE_FAMILIES as readonly RenderFamily[]).includes(version.renderFamily);
}

/**
 * The families whose preview is a converted PDF rather than the stored
 * file (DOC-004, M12/4).
 *
 * The panel polls the rendition read for these and draws nothing until
 * it says ready. Everything else in {@link PREVIEWABLE_FAMILIES} is
 * drawn straight from the stored bytes.
 */
export const CONVERTED_FAMILIES = [
  "word",
  "presentation",
] as const satisfies readonly RenderFamily[];

/** Whether this version has to be converted before the panel can draw
 * it. */
export function isConverted(version: DocumentVersion): boolean {
  return (CONVERTED_FAMILIES as readonly RenderFamily[]).includes(version.renderFamily);
}

/** Where one version's display conversion has got to (M12/4). */
export type RenditionState =
  paths["/api/v1/documents/{documentId}/versions/{versionId}/rendition"]["get"]["responses"]["200"]["content"]["application/json"]["rendition"]["state"];

/**
 * One poll's outcome: what the server said, or that it said nothing.
 *
 * `unreachable` is deliberately not one of the four states. A dropped
 * request and a refusal are not facts about the conversion, and folding
 * either into `pending` would have a caller poll for ever at an address
 * that is never going to answer.
 */
export type RenditionPoll = RenditionState | "unreachable";

/**
 * Asks how far one version's display conversion has got (DOC-004).
 *
 * The panel polls this while it shows its preparing state; live push is
 * M30's job.
 */
export async function readRenditionState(
  documentId: string,
  versionId: string,
): Promise<RenditionPoll> {
  try {
    const { data } = await api.GET(
      "/api/v1/documents/{documentId}/versions/{versionId}/rendition",
      {
        params: { path: { documentId, versionId } },
      },
    );
    return data?.rendition.state ?? "unreachable";
  } catch {
    // No answer at all — a dropped connection. Reported as itself, and
    // the caller decides how many of these are worth waiting through.
    return "unreachable";
  }
}

/** The six CTR-014 kinds, in the order a negotiation walks them — the
 * order the composer offers and the order the chain usually reads in.
 *
 * `draft_theirs` sits beside `draft_ours` rather than beside the
 * redlines, because the two drafts are the two ways a negotiation can
 * open (#326): whichever side's paper it is, the round starts there and
 * the markups follow. */
export const DOCUMENT_VERSION_KINDS = [
  "draft_ours",
  "draft_theirs",
  "redline_theirs",
  "redline_ours",
  "amendment",
  "executed",
] as const satisfies readonly DocumentVersionKind[];
export type HandSetDocumentVersionKind = (typeof DOCUMENT_VERSION_KINDS)[number];

/**
 * One document's chain, split the way the section draws it: the version
 * that matters now, and the rounds it supersedes newest first.
 *
 * `current` is the row the API marked, not the last one in the array —
 * the pin is the server's answer to "which file matters now" (DOC-001),
 * and reading it rather than re-deriving it means the section cannot
 * disagree with the record.
 *
 * A document always has at least one version, so `undefined` here means
 * a broken record rather than an empty one, and the caller draws nothing
 * for it.
 */
export function chainOf(
  document: ContractDocument,
): { current: DocumentVersion; superseded: DocumentVersion[] } | undefined {
  const current = document.versions.find((version) => version.isCurrent);
  if (!current) return undefined;
  return {
    current,
    // Newest first: the round before this one is the one a reader
    // reaches for, and it should not be at the bottom of a long chain.
    superseded: document.versions.filter((version) => version.id !== current.id).reverse(),
  };
}

/**
 * Where one version's bytes are read from.
 *
 * A plain URL, not a client call: every open is a download in M11, and
 * a download is what a link does. The session cookie rides a same-origin
 * navigation on its own, so the anchor needs no header of its own — and
 * there is no presigned URL to build (DOC-012).
 */
export function documentDownloadHref(documentId: string, versionId: string): string {
  return `${versionUrl(documentId, versionId)}/download`;
}

/**
 * Where the doc panel reads one version's bytes from (M12/2).
 *
 * The download's twin, and the difference is all on the server: the
 * response comes back inline, under a type the server chose from the
 * file's family rather than from what the upload declared. The session
 * cookie rides a same-origin request on its own, here as on the
 * download, and there is still no presigned URL (DOC-012).
 */
export function documentPreviewHref(documentId: string, versionId: string): string {
  return `${versionUrl(documentId, versionId)}/preview`;
}

/** Where one version lives, which every read on it hangs off. */
function versionUrl(documentId: string, versionId: string): string {
  return `/api/v1/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}`;
}

/** One uploaded email, parsed (M12/5, DOC-004). */
export type ParsedEmail =
  paths["/api/v1/documents/{documentId}/versions/{versionId}/email"]["get"]["responses"]["200"]["content"]["application/json"]["email"];

/** One file that came with a message. */
export type EmailAttachment = ParsedEmail["attachments"][number];

/**
 * What the email read answered, or that it answered nothing.
 *
 * `unreadable` is every way the message did not arrive: the server
 * refused it, the connection dropped, or the bytes are not the email
 * they claimed to be. The panel says the same thing for all of them —
 * this is not going to appear, and the download is here — because that
 * is what they are to somebody standing in front of it.
 */
export type EmailOutcome = { ok: true; email: ParsedEmail } | { ok: false };

/**
 * Reads one uploaded email as a message (DOC-004).
 *
 * The body comes back sanitized: the server is where the sender's markup
 * is cut down, so no client can render the raw form by forgetting a
 * step.
 */
export async function readEmail(documentId: string, versionId: string): Promise<EmailOutcome> {
  try {
    const { data } = await api.GET("/api/v1/documents/{documentId}/versions/{versionId}/email", {
      params: { path: { documentId, versionId } },
    });
    return data ? { ok: true, email: data.email } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Where one of a rendered email's attachments is downloaded from.
 *
 * A plain URL, exactly as a version's own download is: the session
 * cookie rides a same-origin navigation on its own, and there is no
 * presigned URL to build (DOC-012).
 */
export function emailAttachmentDownloadHref(
  documentId: string,
  versionId: string,
  index: number,
): string {
  return `${attachmentUrl(documentId, versionId, index)}/download`;
}

/**
 * Where the panel reads one attachment's bytes from, when the
 * attachment is itself something the panel can draw (M12/5).
 *
 * The download's twin, and the difference is all on the server: the
 * response comes back inline under a type the server chose from the
 * file's family rather than from what the message declared.
 */
export function emailAttachmentPreviewHref(
  documentId: string,
  versionId: string,
  index: number,
): string {
  return `${attachmentUrl(documentId, versionId, index)}/preview`;
}

/** Whether opening this attachment keeps a reader in the app, or hands
 * them a download (DOC-004). There is no conversion path for an
 * attachment, so only the families that draw from their own bytes
 * open. */
export function isPreviewableAttachment(attachment: EmailAttachment): boolean {
  return attachment.renderFamily === "pdf" || attachment.renderFamily === "image";
}

/** Where one attachment lives, which both of its byte reads hang off. */
function attachmentUrl(documentId: string, versionId: string, index: number): string {
  return `${versionUrl(documentId, versionId)}/attachments/${encodeURIComponent(String(index))}`;
}

/** What the composer collects beside the file itself: what this version
 * is in the negotiation, and what changed in this round. */
export interface UploadDraft {
  file: File;
  kind: HandSetDocumentVersionKind;
  /** Empty when the uploader wrote nothing — the seam stores NULL. */
  note: string;
}

/**
 * A new document's draft, which is the one upload that says where the
 * file is filed (DOC-006, DOC-011).
 *
 * `folderId` is the folder the gesture landed on and `path` is the chain
 * to recreate beneath it, so dropping a tree onto a folder row is the
 * two together. The seam find-or-creates the chain under the owning
 * contract's row lock, which is what makes several files carrying one
 * path converge on one folder.
 *
 * Its own type rather than an optional field on {@link UploadDraft},
 * because appending a round takes no destination at all: a version lands
 * where its document is already filed, and a field the version route
 * would ignore is a field a caller can be wrong about in silence.
 */
export interface DocumentUploadDraft extends UploadDraft {
  destination?: Readonly<{ folderId?: string | null; path?: readonly string[] }>;
}

/**
 * What an upload answers: the document as it now stands, or why not.
 *
 * A refusal carries the seam's own status beside its sentence, because
 * the batch has to tell one refusal from another: a file over the
 * deployment's size ceiling is refused again by the same seam, so it is
 * offered no retry, and everything else is (DES-033 §11). A connection
 * that dropped carries no status at all.
 */
export type UploadOutcome = { ok: true; document: ContractDocument } | ({ ok: false } & Problem);

/**
 * Sends one file to a contract, creating a document with version 1.
 *
 * The kind and the note are written into the form **before** the file
 * part, which is the order the seam reads them in: the parser reports
 * the fields it has already seen, and the file part ends the ones it can
 * report.
 */
export function uploadContractDocument(
  contractNumber: number,
  draft: DocumentUploadDraft,
): Promise<UploadOutcome> {
  return send(`/api/v1/contracts/${contractNumber}/documents`, draft);
}

export function uploadRecordDocument(
  record: DocumentRecord,
  draft: DocumentUploadDraft,
): Promise<UploadOutcome> {
  switch (record.entityType) {
    case "contract":
      return uploadContractDocument(record.number, draft);
    case "matter":
      return send(`/api/v1/matters/${record.number}/documents`, draft);
    case "entity":
      return send(`/api/v1/entities/${encodeURIComponent(record.id)}/documents`, draft);
    case "knowledge_item":
      return send(`/api/v1/knowledge/${encodeURIComponent(record.id)}/documents`, draft);
  }
}

/**
 * Appends the next version to a document (DOC-001).
 *
 * The number is the server's to assign — it takes it under the owning
 * contract's row lock — so nothing here counts the chain or guesses at
 * what comes next.
 */
export function uploadDocumentVersion(
  documentId: string,
  draft: UploadDraft,
): Promise<UploadOutcome> {
  return send(`/api/v1/documents/${encodeURIComponent(documentId)}/versions`, draft);
}

/**
 * Corrects the kind attached to one round (CTR-014). The seam changes
 * no other version field and leaves the executed pin alone.
 */
export async function updateDocumentVersionKind(
  documentId: string,
  versionId: string,
  kind: HandSetDocumentVersionKind,
): Promise<UploadOutcome> {
  const result = await api
    .PATCH("/api/v1/documents/{documentId}/versions/{versionId}", {
      params: { path: { documentId, versionId } },
      body: { kind },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, document: result.data.document }
    : { ok: false, ...(await problem(result)) };
}

/** The one multipart POST both uploads are. A destination rides with it
 * only when the caller had one to give. */
async function send(url: string, draft: DocumentUploadDraft): Promise<UploadOutcome> {
  const form = new FormData();
  form.append("kind", draft.kind);
  if (draft.note.trim().length > 0) form.append("note", draft.note.trim());
  // Before the file part, as the kind and the note are: the parser
  // reports the fields it has already seen, and the file part ends the
  // ones it can report. An empty destination is left off entirely — the
  // absence is what the record root is.
  if (draft.destination?.folderId) form.append("folderId", draft.destination.folderId);
  if (draft.destination?.path?.length) {
    form.append("folderPath", draft.destination.path.join(FOLDER_PATH_SEPARATOR));
  }
  form.append("file", draft.file, draft.file.name);
  try {
    const response = await fetch(url, { method: "POST", body: form });
    if (!response.ok) {
      return { ok: false, ...(await problem(response)) };
    }
    const malformed = await problem(response);
    const document = documentIn(await response.json());
    // A 201 whose body is not a document is not a success this caller
    // can render — it would put a row on the list with nothing in it.
    return document ? { ok: true, document } : { ok: false, ...malformed };
  } catch {
    // A dropped connection reads as an upload that did not happen,
    // which is what it is. The caller says so in its own words.
    return { ok: false, ...(await problem(undefined)) };
  }
}

/**
 * Renames a document, edits its description (DOC-007), or sets and
 * clears DD-014's per-document Confidential flag — one field per call as
 * DES-017 commits them. The stored files are untouched by any of them: a
 * version keeps the filename it arrived under.
 *
 * The flag is the one field with an actor set narrower than the route's
 * (CTR-022): an Administrator, the person who uploaded the document, and
 * the contract's Owner. The seam refuses anybody else with a plain 403,
 * which the section reports where it reports every other refusal.
 */
export async function updateDocument(
  documentId: string,
  patch: Readonly<{
    title?: string;
    description?: string | null;
    isConfidential?: boolean;
    /** Where the document is filed (DOC-006, M13/3): a folder on its own
     * record, or `null` for the record root. Omitting the field moves
     * nothing — `null` and absent are two different requests. */
    folderId?: string | null;
  }>,
): Promise<UploadOutcome> {
  const result = await api
    .PATCH("/api/v1/documents/{documentId}", {
      params: { path: { documentId } },
      body: patch,
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, document: result.data.document }
    : { ok: false, ...(await problem(result)) };
}

/** What a read or a write over the whole record's paper answers: one
 * page of the list as it now stands, where the next one starts, or why
 * not. A write answers the **first** page (CTR-024), so a section that
 * had paged further down starts again from the top. */
export type PaperOutcome =
  | { ok: true; documents: ContractDocument[]; nextCursor: string | null }
  | ({ ok: false } & Problem);

/**
 * Names one document the contract's instrument (CTR-014).
 *
 * It answers the record's whole paper rather than the one document,
 * because the designation moving changes two rows: the one that takes
 * it and the one that loses it. The caller replaces the list it holds
 * instead of working out for itself which other row moved.
 */
export async function setPrimaryDocument(documentId: string): Promise<PaperOutcome> {
  const result = await api
    .POST("/api/v1/documents/{documentId}/primary", {
      params: { path: { documentId } },
    })
    .catch(() => undefined);
  return result?.data
    ? {
        ok: true,
        documents: result.data.documents,
        nextCursor: result.data.nextCursor,
      }
    : { ok: false, ...(await problem(result)) };
}

/**
 * Pins one version as the document's signed copy (CTR-014).
 *
 * Explicit, and never read off the version's kind: a round tagged
 * `executed` is what its uploader called it, and pinning is what the
 * team decided. The seam refuses a version of another document.
 */
export async function setExecutedVersion(
  documentId: string,
  versionId: string,
): Promise<UploadOutcome> {
  const result = await api
    .POST("/api/v1/documents/{documentId}/executed-version", {
      params: { path: { documentId } },
      body: { versionId },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, document: result.data.document }
    : { ok: false, ...(await problem(result)) };
}

/** Takes the executed pin off a document. Every version is left as it
 * was — the pin is one column on the document, not a fact about a
 * file. */
export async function clearExecutedVersion(documentId: string): Promise<UploadOutcome> {
  const result = await api
    .DELETE("/api/v1/documents/{documentId}/executed-version", {
      params: { path: { documentId } },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, document: result.data.document }
    : { ok: false, ...(await problem(result)) };
}

/**
 * Reads one listing of one contract's paper.
 *
 * The record page loads the record root with everything else, so this is
 * the re-read the archived view needs, the read a folder makes when it
 * is opened, and the read a "Show more" makes inside either.
 *
 * `folder` is which listing (DOC-006, M13/3): {@link FOLDER_ROOT} for
 * the documents filed nowhere, a folder's own id for what is filed in
 * it, or omitted for the record's whole paper. The cursor is a position
 * **inside** whichever listing was asked for, so paging never crosses
 * from one folder into another (DES-031).
 */
export async function readContractDocuments(
  contractNumber: number,
  includeArchived: boolean,
  cursor?: string,
  folder?: string,
): Promise<PaperOutcome> {
  const result = await api
    .GET("/api/v1/contracts/{number}/documents", {
      params: {
        path: { number: contractNumber },
        query: {
          ...(includeArchived ? { includeArchived: "true" as const } : {}),
          ...(cursor ? { cursor } : {}),
          ...(folder ? { folder } : {}),
        },
      },
    })
    .catch(() => undefined);
  return result?.data
    ? {
        ok: true,
        documents: result.data.documents,
        nextCursor: result.data.nextCursor,
      }
    : { ok: false, ...(await problem(result)) };
}

export async function readRecordDocuments(
  record: DocumentRecord,
  includeArchived: boolean,
  cursor?: string,
  folder?: string,
): Promise<PaperOutcome> {
  switch (record.entityType) {
    case "contract":
      return readContractDocuments(record.number, includeArchived, cursor, folder);
    case "matter": {
      const result = await api
        .GET("/api/v1/matters/{number}/documents", {
          params: {
            path: { number: record.number },
            query: {
              ...(includeArchived ? { includeArchived: "true" as const } : {}),
              ...(cursor ? { cursor } : {}),
              ...(folder ? { folder } : {}),
            },
          },
        })
        .catch(() => undefined);
      return result?.data
        ? {
            ok: true,
            documents: result.data.documents,
            nextCursor: result.data.nextCursor,
          }
        : { ok: false, ...(await problem(result)) };
    }
    case "entity": {
      const result = await api
        .GET("/api/v1/entities/{id}/documents", {
          params: {
            path: { id: record.id },
            query: {
              ...(includeArchived ? { includeArchived: "true" as const } : {}),
              ...(cursor ? { cursor } : {}),
              ...(folder ? { folder } : {}),
            },
          },
        })
        .catch(() => undefined);
      return result?.data
        ? { ok: true, documents: result.data.documents, nextCursor: result.data.nextCursor }
        : { ok: false, ...(await problem(result)) };
    }
    case "knowledge_item": {
      const result = await api
        .GET("/api/v1/knowledge/{id}/documents", {
          params: {
            path: { id: record.id },
            query: {
              ...(includeArchived ? { includeArchived: "true" as const } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
        })
        .catch(() => undefined);
      return result?.data
        ? { ok: true, documents: result.data.documents, nextCursor: result.data.nextCursor }
        : { ok: false, ...(await problem(result)) };
    }
  }
}

/** A search landing that can seed the doc panel without teaching the
 * record loader where folders put their Documents. */
export interface DocumentLanding {
  document: ContractDocument;
  versionId: string;
}

/** The complete search landing address, only meaningful on a Documents tab. */
export function documentLandingParams(
  request: Request,
  tab: string | undefined,
): { documentId: string; versionId: string; findQuery: string | null } | null {
  if (tab !== "documents") return null;
  const query = new URL(request.url).searchParams;
  const documentId = query.get("doc")?.trim();
  const versionId = query.get("version")?.trim();
  const findQuery = query.get("find")?.trim() || null;
  return documentId && versionId ? { documentId, versionId, findQuery } : null;
}

/**
 * Resolves one Document and Version from the owning record's whole-paper
 * listing. Search can point at an older Version and at a Document filed
 * in any folder, so the root-only page loaded for the Documents tab is
 * not enough. A missing, hidden, or unreachable target is deliberately
 * the same quiet absence: the record page itself still opens.
 */
export async function readDocumentLanding(
  record: DocumentRecord,
  documentId: string,
  versionId: string,
): Promise<DocumentLanding | null> {
  let cursor: string | undefined;
  const seen = new Set<string>();

  try {
    for (let page = 0; page < 1000; page += 1) {
      const result = await readRecordDocuments(record, false, cursor);
      if (!result.ok) return null;
      const document = result.documents.find((candidate) => candidate.id === documentId);
      if (document) {
        return document.versions.some((version) => version.id === versionId)
          ? { document, versionId }
          : null;
      }
      if (result.nextCursor === null || seen.has(result.nextCursor)) return null;
      seen.add(result.nextCursor);
      cursor = result.nextCursor;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Archives a document (DOC-010's soft delete), the answer to the wrong
 * upload.
 *
 * It destroys nothing: the row, the whole chain, and every stored file
 * stay exactly where they were, so restoring it is the undo and there is
 * nothing to warn anybody about.
 */
export async function archiveDocument(documentId: string): Promise<UploadOutcome> {
  const result = await api
    .POST("/api/v1/documents/{documentId}/archive", {
      params: { path: { documentId } },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, document: result.data.document }
    : { ok: false, ...(await problem(result)) };
}

/** Puts an archived document back on the record's list and in its
 * count, exactly as it was. */
export async function restoreDocument(documentId: string): Promise<UploadOutcome> {
  const result = await api
    .POST("/api/v1/documents/{documentId}/restore", {
      params: { path: { documentId } },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, document: result.data.document }
    : { ok: false, ...(await problem(result)) };
}

/**
 * Destroys a whole document — the Administrator's lawful-erasure path
 * (DOC-010).
 *
 * `confirmTitle` is DOC-010's typed confirmation, and the seam checks it
 * rather than trusting the dialog: it must be the document's own title,
 * exactly. It answers the record's whole paper, because the erasure may
 * also have taken the instrument, and no other row inherits that mark.
 */
export async function hardDeleteDocument(
  documentId: string,
  confirmTitle: string,
): Promise<PaperOutcome> {
  const result = await api
    .DELETE("/api/v1/documents/{documentId}", {
      params: { path: { documentId } },
      body: { confirmTitle },
    })
    .catch(() => undefined);
  return result?.data
    ? {
        ok: true,
        documents: result.data.documents,
        nextCursor: result.data.nextCursor,
      }
    : { ok: false, ...(await problem(result)) };
}

/** One field off a parsed JSON body, without asserting its shape. */
function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null
    ? (Object.getOwnPropertyDescriptor(body, name)?.value as unknown)
    : undefined;
}

/**
 * The document out of an upload's answer, or `undefined`.
 *
 * The typed client validates nothing at runtime and neither does this —
 * what it does is refuse to *assert*. The one field the caller acts on
 * before anything renders is the id, so that is the field checked; the
 * rest is the API's own response schema, which the seam enforces.
 */
function documentIn(body: unknown): ContractDocument | undefined {
  const document = field(body, "document");
  return typeof field(document, "id") === "string" ? (document as ContractDocument) : undefined;
}
