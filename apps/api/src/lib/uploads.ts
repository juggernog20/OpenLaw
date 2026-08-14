// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What the API accepts as an uploaded file, and how it hands one back.
 *
 * Two facts live here because two layers need them and neither owns the
 * other: the size ceiling, which the multipart parser enforces and the
 * error handler explains, and the `Content-Disposition` header, which
 * only the download route writes but which no route should get wrong.
 */

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
  const ascii = filename
    // Anything outside printable ASCII, plus the two characters that
    // would end the quoted string early.
    .replaceAll(/[^\u0020-\u007E]/g, "_")
    .replaceAll(/["\\]/g, "_")
    .trim();
  const fallback = ascii.length > 0 ? ascii : "download";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987(filename)}`;
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
