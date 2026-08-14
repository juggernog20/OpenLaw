// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The documents vocabulary the contract record's Documents section
 * reads: the row shape the API answers, the address a download is
 * fetched from, and the one upload call.
 *
 * The upload does not go through the generated client. `openapi-fetch`
 * types a `format: binary` field as a string, and the thing being sent
 * is a `File` — so the call is a plain same-origin `fetch` with a
 * `FormData` body, which is also what carries the session cookie and
 * lets the browser write the multipart boundary. Everything else on
 * this page still goes through the typed client.
 */

import type { paths } from "@openlaw/api-client";

/** The API's answer for one contract's paper, aliased to the generated
 * schema so an API change surfaces as a compile error here rather than
 * as a runtime surprise on the record page. */
type ListResponse =
  paths["/api/v1/contracts/{number}/documents"]["get"]["responses"]["200"]["content"]["application/json"];

/** One document on a record, with the version that is current. */
export type ContractDocument = ListResponse["documents"][number];

/** One immutable file snapshot (DOC-001). */
export type DocumentVersion = ContractDocument["currentVersion"];

/** What a version is in the negotiation (CTR-014). */
export type DocumentVersionKind = DocumentVersion["kind"];

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

/** What an upload answers: the created document, or why not. */
export type UploadOutcome =
  { ok: true; document: ContractDocument } | { ok: false; detail?: string };

/**
 * Sends one file to a contract, creating a document with version 1.
 *
 * The kind and the note are not collected here: the M11/2 control is
 * the file and nothing else, and the seam defaults the kind to
 * `draft_ours`. When the composer for them lands (M11/3) they go into
 * this form **before** the file part, which is the order the seam reads
 * them in.
 */
export async function uploadContractDocument(
  contractNumber: number,
  file: File,
): Promise<UploadOutcome> {
  const form = new FormData();
  form.append("file", file, file.name);
  try {
    const response = await fetch(`/api/v1/contracts/${contractNumber}/documents`, {
      method: "POST",
      body: form,
    });
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

/** One field off a parsed JSON body, without asserting its shape. */
function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null
    ? (Object.getOwnPropertyDescriptor(body, name)?.value as unknown)
    : undefined;
}

/**
 * The created document out of an upload's answer, or `undefined`.
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
