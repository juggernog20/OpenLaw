// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What the API accepts as an uploaded file, and how it hands one back.
 *
 * The facts here are the ones no single upload route owns: the size
 * ceiling, which the multipart parser enforces and the error handler
 * explains; the filename bound; the parser's own rejections turned into
 * copy a person can act on; and the `Content-Disposition` header, which
 * only the download routes write but which none of them should get
 * wrong.
 *
 * **Two routes take uploads and both read these rules from here.** A
 * document version is one (M11/2, DOC-001) and a Request's attachment is
 * the other (M20/6, INT-002). What differs between them is what is
 * stored beside the bytes, not what the API accepts — so a person told
 * a 300-character name is too long on a contract must be told the same
 * thing on the portal.
 */

import type { StorageAdapter } from "./storage/adapter.js";
import { httpError, type HttpError } from "./problem.js";

/** Bytes in one mebibyte — the unit `MAX_UPLOAD_MB` is stated in. */
export const MEGABYTE = 1024 * 1024;

/**
 * The ceiling when `MAX_UPLOAD_MB` is unset. Generous enough for the
 * scanned, signed, hundred-page agreements that arrive as legacy paper
 * (DOC-005), and small enough that one request cannot occupy a
 * self-hoster's disk by accident.
 */
export const DEFAULT_MAX_UPLOAD_MB = 100;

/**
 * Reads the ceiling out of the environment, in whole mebibytes.
 *
 * An unset, empty, or unreadable value falls back to the default rather
 * than refusing to boot: a typo in one optional variable must not take
 * an install down, and the default is a working answer. A value at or
 * below zero is a typo too — there is no deployment that means "accept
 * no files" by setting a number.
 */
export function maxUploadBytes(value: string | undefined): number {
  const megabytes = Number(value);
  // Bounded at both ends. A number so large that its byte count leaves
  // the safe-integer range is a typo like any other — and a ceiling that
  // cannot be compared against a byte count is no ceiling at all.
  const usable =
    Number.isSafeInteger(megabytes) &&
    megabytes > 0 &&
    megabytes * MEGABYTE <= Number.MAX_SAFE_INTEGER;
  return (usable ? megabytes : DEFAULT_MAX_UPLOAD_MB) * MEGABYTE;
}

/** The longest filename the common filesystems carry. */
export const MAX_FILENAME_LENGTH = 255;

/**
 * The refusal an upload over the ceiling earns, with the ceiling named.
 *
 * Named rather than left as a mystery timeout: an uploader who is over
 * the limit can act on a number and cannot act on a stall.
 */
export function refuseOversize(ceiling: number): HttpError {
  const limitMb = Math.round(ceiling / MEGABYTE);
  return httpError(
    413,
    limitMb >= 1
      ? `That file is over the ${limitMb} MB upload limit.`
      : `That file is over the ${ceiling} byte upload limit.`,
  );
}

/**
 * The multipart parser's own rejections, turned into copy a person can
 * act on. Anything else is passed through as it came.
 */
export function asUploadRefusal(error: unknown, ceiling: number, maxFiles = 1): unknown {
  switch (errorCode(error)) {
    case "FST_REQ_FILE_TOO_LARGE":
      return refuseOversize(ceiling);
    case "FST_FILES_LIMIT":
      return httpError(
        413,
        maxFiles === 1
          ? "Upload one file at a time."
          : `Upload at most ${maxFiles} files at a time.`,
      );
    case "FST_FIELDS_LIMIT":
    case "FST_PARTS_LIMIT":
      return httpError(413, "That upload carries more form fields than this endpoint accepts.");
    case "FST_INVALID_MULTIPART_CONTENT_TYPE":
      return httpError(415, "Send the file as multipart/form-data.");
    case "FST_MP_PREMATURE_CLOSE":
      return httpError(400, "The upload ended before the file was complete. Try again.");
    default:
      return error;
  }
}

/**
 * The name an uploaded part arrived under, checked and trimmed.
 *
 * A part with no `filename` at all is still a file part when it declares
 * `application/octet-stream`, so the name is treated as absent rather
 * than assumed present. A name over the bound is refused rather than
 * shortened: cutting the end off a filename takes its extension with it,
 * which is the part a later download reads.
 */
export function uploadFilename(raw: string | undefined): string {
  const filename = (raw ?? "").trim();
  if (filename.length === 0) throw httpError(400, "The uploaded file has no name.");
  if (filename.length > MAX_FILENAME_LENGTH) {
    throw httpError(
      400,
      `Rename the file to ${MAX_FILENAME_LENGTH} characters or fewer before uploading it.`,
    );
  }
  return filename;
}

/** Somewhere to say that a blob could not be cleaned up — the pipeline's
 * own logger shape, so a route's Fastify log fits without an adapter. */
export interface CleanupLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

/**
 * Runs the write that follows a stored upload, and takes the blob away
 * if it does not commit (DOC-012).
 *
 * The bytes reach the driver before the rows exist, so every refusal
 * after that point leaves a blob nothing points at. A failed cleanup is
 * logged and swallowed: the caller is owed the reason their upload was
 * refused, and a cleanup that itself failed is an operational fact
 * rather than an answer to them. The key is never written again — a
 * retry mints its own.
 */
export async function withStoredBlob<T>(
  storage: Pick<StorageAdapter, "delete">,
  log: CleanupLogger,
  fileRef: string,
  write: () => Promise<T>,
): Promise<T> {
  return withStoredBlobs(storage, log, [fileRef], write);
}

/** The multi-file form of {@link withStoredBlob}. Every blob written by
 * one refused comment post is removed; cleanup continues after an
 * individual delete fails so one bad key cannot strand the rest. */
export async function withStoredBlobs<T>(
  storage: Pick<StorageAdapter, "delete">,
  log: CleanupLogger,
  fileRefs: readonly string[],
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    await Promise.all(
      fileRefs.map((fileRef) =>
        storage.delete(fileRef).catch((cleanup: unknown) => {
          log.warn(
            { err: cleanup, fileRef },
            "could not remove the blob of an upload that did not commit",
          );
        }),
      ),
    );
    throw error;
  }
}

/** The error code a Fastify plugin puts on its own rejections. */
function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/**
 * The `Content-Disposition` value that offers `filename` as a download.
 *
 * A stored filename is whatever the uploader's machine called it, so it
 * is never pasted into a header as-is. Two things are written:
 *
 * - a plain `filename=` in quotes, stripped back to printable ASCII with
 *   quotes and backslashes removed, for clients that read only that; and
 * - RFC 5987's `filename*=UTF-8''…`, percent-encoded, which every
 *   current browser prefers and which carries the real name.
 *
 * Control characters — a carriage return above all — are removed rather
 * than encoded in the plain form. A header value cannot hold a newline
 * without becoming two headers.
 */
export function attachmentDisposition(filename: string): string {
  return disposition("attachment", filename);
}

/**
 * The `Content-Disposition` value that offers `filename` for display in
 * place — what a preview answers (M12/2).
 *
 * The name is written the same way, and for the same reasons: a browser
 * that offers the response as a download anyway must still offer it
 * under the name the file arrived with.
 *
 * `inline` is not a claim that the bytes are safe to render. What makes
 * the preview safe is the type beside it, which is chosen from a table
 * of families rather than echoed from the upload, and `nosniff`, which
 * stops the browser looking for a better one (DOC-004).
 */
export function inlineDisposition(filename: string): string {
  return disposition("inline", filename);
}

/** One disposition header, written the same way for both types. */
function disposition(type: "attachment" | "inline", filename: string): string {
  const ascii = filename
    // Anything outside printable ASCII, plus the two characters that
    // would end the quoted string early.
    .replaceAll(/[^\u0020-\u007E]/g, "_")
    .replaceAll(/["\\]/g, "_")
    .trim();
  const fallback = ascii.length > 0 ? ascii : "download";
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987(filename)}`;
}

/**
 * RFC 5987 `ext-value` encoding: `encodeURIComponent` leaves a handful
 * of characters the grammar's `attr-char` set does not admit, so they
 * are percent-encoded here too.
 */
function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replaceAll(
    /['()*]/g,
    (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase(),
  );
}
