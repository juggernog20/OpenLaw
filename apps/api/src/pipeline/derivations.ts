// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What every derivation job shares (TECH-007).
 *
 * The pipeline runs two jobs over an uploaded version — read its text
 * (DOC-005), and convert it for display (DOC-004) — and they are
 * different work with different products. What they hold in common is
 * the shape of a background job that derives something from stored
 * bytes, and that is all this file is:
 *
 * - the four things a handler is built from,
 * - the one decision it has to make about a failure,
 * - opening a stored blob without leaking a handle,
 * - and naming what went wrong for the operator's log.
 *
 * Nothing here knows about text or about renditions. A third derivation
 * would use this file unchanged.
 */

import type { Readable } from "node:stream";
import type { Db } from "@openlaw/db";
import {
  DocEngineError,
  SourceUnreadableError,
  UnsupportedFormatError,
} from "../lib/doc-engine/engine.js";
import type { DocEngine } from "../lib/doc-engine/engine.js";
import { EmailUnreadableError } from "../lib/email/parse.js";
import {
  BlobNotFoundError,
  InvalidBlobRefError,
  StorageError,
  type StorageAdapter,
} from "../lib/storage/adapter.js";
import { CHARACTER_NOT_IN_REPERTOIRE, isDrizzleQueryError, loggable } from "../logging.js";
import type { PipelineLogger } from "./logger.js";

/** Everything a derivation handler needs to do its work. The same four
 * things the API is built from, minus the HTTP. */
export interface DerivationDeps {
  db: Db;
  storage: StorageAdapter;
  docEngine: DocEngine;
  log: PipelineLogger;
}

/** One job, as the retry policy needs it described. pg-boss's own
 * counters, which is why a handler asks for job metadata. */
export interface JobAttempt {
  versionId: string;
  retryCount: number;
  retryLimit: number;
}

/**
 * Whether a failure is the file's fault or the moment's.
 *
 * A derivation job has exactly one decision to make about an error, and
 * it is this one: mark the derivation failed, or try again. Bytes that
 * are not the document they claim to be, and a format no engine reads,
 * are what they are — a retry reads the same bytes and fails the same
 * way. Everything else is treated as the moment's: a timeout, an
 * unreachable sidecar, a database blip, and any error nobody has
 * classified yet.
 *
 * Unknown errors count as transient on purpose. Retrying something
 * permanent wastes a few attempts and then records the failure anyway;
 * giving up on something temporary loses a document's text — or its
 * preview — until somebody notices.
 */
export function isTerminalFailure(error: unknown): boolean {
  if (error instanceof UnsupportedFormatError) return true;
  if (error instanceof SourceUnreadableError) return true;
  // The same fact for the one derivation the engine has no part in
  // (M12/5): bytes that are not the email they claim to be, or more
  // bytes than the in-process parser will open, are what they are.
  if (error instanceof EmailUnreadableError) return true;
  // The stored blob is missing, or its reference is malformed. Neither
  // heals: no retry puts bytes back, and no retry makes a bad reference
  // parse. Named one by one rather than by their base class, because a
  // store that answered oddly for a moment is also a `StorageError` and
  // that one is worth trying again.
  if (error instanceof BlobNotFoundError) return true;
  if (error instanceof InvalidBlobRefError) return true;
  // Postgres refused the text itself (22021): a byte the encoding does
  // not hold, which for extracted text is U+0000. The writer strips it
  // before every write, so this is a last line. A retry would send the
  // same bytes and meet the same refusal.
  if (errorCode(error) === CHARACTER_NOT_IN_REPERTOIRE) return true;
  return false;
}

/** Postgres' foreign-key violation, as pg reports it. */
export const FOREIGN_KEY_VIOLATION = "23503";

/**
 * The error code a driver puts on its own rejections.
 *
 * drizzle-orm wraps every failed query in a DrizzleQueryError and keeps
 * the driver's error as its `cause`, so the code is read through the
 * chain: the error's own first, then each cause in turn.
 */
export function errorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current && (current as { code: unknown }).code !== undefined) {
      return String((current as { code: unknown }).code);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Opens a stored blob, hands it to `read`, and closes it whatever
 * happens.
 *
 * An engine that reads a stream to the end leaves nothing to close, and
 * destroying a finished stream does nothing. An engine that refuses part
 * way through — a timeout, a sidecar that went away — leaves it open,
 * and on the local driver that is a file handle the process holds until
 * it notices. A pipeline that fails a few times an hour must not leak
 * one each time.
 */
export async function withBlob<T>(
  deps: DerivationDeps,
  fileRef: string,
  read: (blob: Readable) => Promise<T>,
): Promise<T> {
  const blob = await deps.storage.get(fileRef);
  try {
    return await read(blob);
  } finally {
    blob.destroy();
  }
}

/**
 * What went wrong, in one line, for the operator's log.
 *
 * A failed query answers its Postgres code and nothing of its text. Its
 * message is the SQL and every bind parameter, and for a text write
 * that is the Document Version's whole text (TECH-029).
 */
export function reasonOf(error: unknown): string {
  if (isDrizzleQueryError(error)) return loggable(error).message;
  if (error instanceof DocEngineError || error instanceof StorageError) {
    return `${error.name}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * A failure as pg-boss may store it.
 *
 * pg-boss serialises what a handler throws into `pgboss.job.output`,
 * own fields and all. A DrizzleQueryError carries the SQL text and the
 * bind parameters as fields, so a failed text write would persist the
 * document's text in the queue table on every retry. What reaches the
 * table is a plain Error with the one-line reason and nothing else.
 */
export function plainFailure(error: unknown): Error {
  return new Error(reasonOf(error));
}
