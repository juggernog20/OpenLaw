// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The storage adapter (DOC-009, TECH-014): one narrow interface over
 * immutable blobs, with a driver behind it.
 *
 * The interface has three operations — put a blob, get a blob as a
 * stream, delete a blob — and nothing else. It stays narrow and
 * stream-based on purpose. A later driver such as SharePoint speaks
 * Microsoft Graph with token auth and has no bucket semantics, so the
 * interface carries no S3-shaped concepts: no bucket, no presigned URL,
 * no multipart part numbers. Anything a driver cannot honour is not in
 * here.
 *
 * Two rules hold for every driver:
 *
 * - **Blobs are immutable.** A written blob is never changed. A
 *   correction is a new blob under a new key.
 * - **Keys are never reused.** A deleted key is not written again. This
 *   is what makes an orphaned blob (written, then the database commit
 *   failed) harmless.
 */

import type { Readable } from "node:stream";

/** Base class of every failure this interface defines. */
export class StorageError extends Error {}

/** The reference names no stored blob. */
export class BlobNotFoundError extends StorageError {
  constructor(ref: string) {
    super(`No blob is stored at ${ref}.`);
    this.name = "BlobNotFoundError";
  }
}

/** The key is already written, and blobs are immutable. */
export class BlobExistsError extends StorageError {
  constructor(ref: string) {
    super(`A blob is already stored at ${ref}; blobs are immutable and keys are never reused.`);
    this.name = "BlobExistsError";
  }
}

/** The key or the reference is malformed, or it names another driver. */
export class InvalidBlobRefError extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBlobRefError";
  }
}

/**
 * A stored reference is driver-prefixed per TECH-014: `<driver>:<key>`.
 * The prefix tells a deployment where the blob lives, so a stack that
 * has moved drivers can still read what the old one wrote.
 */
export const BLOB_REF_SEPARATOR = ":";

/** Driver names are lowercase and short — they live in every stored row. */
const DRIVER_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Keys are slash-separated segments of `A-Z a-z 0-9 . _ -`, each segment
 * starting with a letter or a digit. The charset is deliberately smaller
 * than any one driver needs: it is safe as a path under the local
 * filesystem driver, safe as an object name under S3, and it cannot hold
 * the reference separator, so a reference always splits at its first
 * colon. `.` and `..` cannot appear as segments, so a key can never
 * escape the root it is resolved under.
 */
const KEY_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A key long enough for any layout we mint, short enough to index. */
const MAX_KEY_LENGTH = 512;

/** Whether `key` satisfies the key rules above. */
export function isValidBlobKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  return key.split("/").every((segment) => KEY_SEGMENT_PATTERN.test(segment));
}

/** Throws {@link InvalidBlobRefError} unless `key` satisfies the key rules. */
export function assertValidBlobKey(key: string): void {
  if (!isValidBlobKey(key)) {
    throw new InvalidBlobRefError(`${JSON.stringify(key)} is not a valid blob key.`);
  }
}

/** Builds the stored reference for a key under a driver. */
export function formatBlobRef(driver: string, key: string): string {
  assertValidBlobKey(key);
  if (!DRIVER_PATTERN.test(driver)) {
    throw new InvalidBlobRefError(`${JSON.stringify(driver)} is not a valid driver name.`);
  }
  return `${driver}${BLOB_REF_SEPARATOR}${key}`;
}

/**
 * Reads the key out of a reference, checking that it names `driver`.
 *
 * A reference for another driver is rejected rather than guessed at: a
 * deployment that has changed drivers must not silently read an `s3:`
 * row off the local disk.
 */
export function parseBlobRef(ref: string, driver: string): string {
  const separator = ref.indexOf(BLOB_REF_SEPARATOR);
  if (separator < 0) {
    throw new InvalidBlobRefError(
      `${JSON.stringify(ref)} is not a blob reference; the form is <driver>:<key>.`,
    );
  }
  const refDriver = ref.slice(0, separator);
  const key = ref.slice(separator + 1);
  if (refDriver !== driver) {
    throw new InvalidBlobRefError(
      `${JSON.stringify(ref)} names the ${JSON.stringify(refDriver)} driver, not ${JSON.stringify(driver)}.`,
    );
  }
  assertValidBlobKey(key);
  return key;
}

/**
 * The one storage seam. Injected into the app factory beside the
 * database and the mailer; application code only ever sees this type.
 */
export interface StorageAdapter {
  /** The driver name that prefixes every reference this adapter writes. */
  readonly driver: string;

  /**
   * Writes an immutable blob at `key` and answers its stored reference.
   *
   * Rejects with {@link BlobExistsError} when the key is already
   * written, leaving the stored blob untouched, and with
   * {@link InvalidBlobRefError} when the key is malformed. A blob is
   * readable only once the write has finished: a failed write leaves
   * nothing behind at the key.
   */
  put(key: string, body: Readable): Promise<string>;

  /**
   * Opens a stored blob for reading.
   *
   * Rejects with {@link BlobNotFoundError} when the reference names no
   * stored blob, and with {@link InvalidBlobRefError} when the
   * reference is malformed or names another driver.
   */
  get(ref: string): Promise<Readable>;

  /**
   * Removes a stored blob. Deleting a reference that names no stored
   * blob is not an error — hard deletion (DOC-010) must be repeatable
   * after a partial failure, and an orphaned blob may already be gone.
   *
   * Rejects with {@link InvalidBlobRefError} when the reference is
   * malformed or names another driver.
   */
  delete(ref: string): Promise<void>;
}
