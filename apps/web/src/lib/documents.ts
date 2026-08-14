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
import { api } from "./api";
import { problemDetail } from "./messages";

/** The API's answer for one contract's paper, aliased to the generated
 * schema so an API change surfaces as a compile error here rather than
 * as a runtime surprise on the record page. */
type ListResponse =
  paths["/api/v1/contracts/{number}/documents"]["get"]["responses"]["200"]["content"]["application/json"];

/** One document on a record, with its whole version chain. */
export type ContractDocument = ListResponse["documents"][number];

/** One immutable file snapshot (DOC-001). */
export type DocumentVersion = ContractDocument["versions"][number];

/** What a version is in the negotiation (CTR-014). */
export type DocumentVersionKind = DocumentVersion["kind"];

/** The five CTR-014 kinds, in the order a negotiation walks them — the
 * order the composer offers and the order the chain usually reads in. */
export const DOCUMENT_VERSION_KINDS = [
  "draft_ours",
  "redline_theirs",
  "redline_ours",
  "amendment",
  "executed",
] as const satisfies readonly DocumentVersionKind[];

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
  return `/api/v1/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/download`;
}

/** What the composer collects beside the file itself: what this version
 * is in the negotiation, and what changed in this round. */
export interface UploadDraft {
  file: File;
  kind: DocumentVersionKind;
  /** Empty when the uploader wrote nothing — the seam stores NULL. */
  note: string;
}

/** What an upload answers: the document as it now stands, or why not. */
export type UploadOutcome =
  { ok: true; document: ContractDocument } | { ok: false; detail?: string };

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
  draft: UploadDraft,
): Promise<UploadOutcome> {
  return send(`/api/v1/contracts/${contractNumber}/documents`, draft);
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

/** The one multipart POST both uploads are. */
async function send(url: string, draft: UploadDraft): Promise<UploadOutcome> {
  const form = new FormData();
  form.append("kind", draft.kind);
  if (draft.note.trim().length > 0) form.append("note", draft.note.trim());
  form.append("file", draft.file, draft.file.name);
  try {
    const response = await fetch(url, { method: "POST", body: form });
    if (!response.ok) return { ok: false, detail: await problemDetailOf(response) };
    const document = documentIn(await response.json());
    // A 201 whose body is not a document is not a success this caller
    // can render — it would put a row on the list with nothing in it.
    return document ? { ok: true, document } : { ok: false };
  } catch {
    // A dropped connection reads as an upload that did not happen,
    // which is what it is. The caller says so in its own words.
    return { ok: false };
  }
}

/**
 * Renames a document or edits its description (DOC-007), one field per
 * call as DES-017 commits them. The stored files are untouched: a
 * version keeps the filename it arrived under.
 */
export async function updateDocument(
  documentId: string,
  patch: Readonly<{ title?: string; description?: string | null }>,
): Promise<UploadOutcome> {
  const { data, error } = await api.PATCH("/api/v1/documents/{documentId}", {
    params: { path: { documentId } },
    body: patch,
  });
  return data ? { ok: true, document: data.document } : { ok: false, detail: problemDetail(error) };
}

/** What a write over the whole record's paper answers: the list as it
 * now stands, or why not. */
export type PaperOutcome =
  { ok: true; documents: ContractDocument[] } | { ok: false; detail?: string };

/**
 * Names one document the contract's instrument (CTR-014).
 *
 * It answers the record's whole paper rather than the one document,
 * because the designation moving changes two rows: the one that takes
 * it and the one that loses it. The caller replaces the list it holds
 * instead of working out for itself which other row moved.
 */
export async function setPrimaryDocument(documentId: string): Promise<PaperOutcome> {
  const { data, error } = await api.POST("/api/v1/documents/{documentId}/primary", {
    params: { path: { documentId } },
  });
  return data
    ? { ok: true, documents: data.documents }
    : { ok: false, detail: problemDetail(error) };
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
  const { data, error } = await api.POST("/api/v1/documents/{documentId}/executed-version", {
    params: { path: { documentId } },
    body: { versionId },
  });
  return data ? { ok: true, document: data.document } : { ok: false, detail: problemDetail(error) };
}

/** Takes the executed pin off a document. Every version is left as it
 * was — the pin is one column on the document, not a fact about a
 * file. */
export async function clearExecutedVersion(documentId: string): Promise<UploadOutcome> {
  const { data, error } = await api.DELETE("/api/v1/documents/{documentId}/executed-version", {
    params: { path: { documentId } },
  });
  return data ? { ok: true, document: data.document } : { ok: false, detail: problemDetail(error) };
}

/**
 * Reads one contract's paper.
 *
 * The record page loads the live list with everything else, so this is
 * the re-read the archived view needs: the archived rows only exist
 * server-side, and coming back to the live view should not trust a
 * stale list either.
 */
export async function readContractDocuments(
  contractNumber: number,
  includeArchived: boolean,
): Promise<PaperOutcome> {
  const { data, error } = await api.GET("/api/v1/contracts/{number}/documents", {
    params: {
      path: { number: contractNumber },
      query: includeArchived ? { includeArchived: "true" } : {},
    },
  });
  return data
    ? { ok: true, documents: data.documents }
    : { ok: false, detail: problemDetail(error) };
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
  const { data, error } = await api.POST("/api/v1/documents/{documentId}/archive", {
    params: { path: { documentId } },
  });
  return data ? { ok: true, document: data.document } : { ok: false, detail: problemDetail(error) };
}

/** Puts an archived document back on the record's list and in its
 * count, exactly as it was. */
export async function restoreDocument(documentId: string): Promise<UploadOutcome> {
  const { data, error } = await api.POST("/api/v1/documents/{documentId}/restore", {
    params: { path: { documentId } },
  });
  return data ? { ok: true, document: data.document } : { ok: false, detail: problemDetail(error) };
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
  const { data, error } = await api.DELETE("/api/v1/documents/{documentId}", {
    params: { path: { documentId } },
    body: { confirmTitle },
  });
  return data
    ? { ok: true, documents: data.documents }
    : { ok: false, detail: problemDetail(error) };
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

/** The RFC 9457 `detail` off a refusal, when the refusal carried one. */
async function problemDetailOf(response: Response): Promise<string | undefined> {
  try {
    const detail = field(await response.json(), "detail");
    return typeof detail === "string" && detail.length > 0 ? detail : undefined;
  } catch {
    return undefined;
  }
}
