/* Putting files onto records.
 *
 * One helper per shape of upload, because the multipart parts have to be
 * sent in order: `kind`, `note` and the folder parts are read before the
 * file part, and a form that sends the file first loses them.
 */

import { MEDIA_TYPES, makeDocx, makePdf, makeTxt } from "./files.mjs";

const BUILDERS = { pdf: makePdf, docx: makeDocx, txt: makeTxt };

/** A file part built from generated prose. */
export function documentFile(document, format = "pdf") {
  const build = BUILDERS[format] ?? makePdf;
  const data = build(document.title, document.paragraphs);
  const name = `${document.title
    .replace(/[^A-Za-z0-9 .-]/g, "")
    .slice(0, 80)
    .trim()}.${format}`;
  return new File([data], name, { type: MEDIA_TYPES[format] });
}

function form(file, parts) {
  const body = new FormData();
  for (const [name, value] of Object.entries(parts)) {
    if (value !== undefined && value !== null) body.append(name, String(value));
  }
  body.append("file", file);
  return body;
}

/**
 * Files a new Document on a record. `owner` is the path the record owns
 * its documents at, which differs per module.
 */
export async function uploadDocument(session, ownerPath, document, options = {}) {
  const { format = "pdf", kind, note, folderId, folderPath } = options;
  const { body } = await session.upload(
    ownerPath,
    form(documentFile(document, format), { kind, note, folderId, folderPath }),
  );
  return body.document;
}

/** Appends a Version to a Document already on a record (DOC-001). */
export async function uploadVersion(session, documentId, document, options = {}) {
  const { format = "pdf", kind, note } = options;
  const { body } = await session.upload(
    `/api/v1/documents/${documentId}/versions`,
    form(documentFile(document, format), { kind, note }),
  );
  return body.document;
}

/** The paper that travels with a Request (#380). */
export async function uploadRequestAttachment(session, number, document, format = "pdf") {
  const body = new FormData();
  body.append("file", documentFile(document, format));
  await session.upload(`/api/v1/requests/${number}/attachments`, body);
}

/** A comment with files on it (CMT-011). */
export async function postComment(session, payload, files = []) {
  if (files.length === 0) {
    const { body } = await session.post("/api/v1/comments", payload);
    return body.comment;
  }
  const body = new FormData();
  body.append("entityType", payload.entityType);
  body.append("entityId", payload.entityId);
  body.append("body", payload.body);
  body.append("visibility", payload.visibility);
  // On the multipart path a mention list is one JSON field, not repeated
  // parts: multipart has no arrays, so the route parses the string.
  if (payload.mentions?.length) body.append("mentions", JSON.stringify(payload.mentions));
  for (const file of files) body.append("file", file);
  const { body: answer } = await session.upload("/api/v1/comments", body);
  return answer.comment;
}
