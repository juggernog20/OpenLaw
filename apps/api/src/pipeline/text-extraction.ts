// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Extracting one version's text (DOC-005) — the pipeline's first real
 * job.
 *
 * A Legal Team Member uploads a scanned contract and, without doing
 * anything else, its words become available. That is the whole of what
 * this file makes true, and everything in it follows from three rules.
 *
 * **The original is what renders.** The engine's OCR pass produces a
 * searchable PDF on the way and it is thrown away, here as in the
 * sidecar. What is kept is text, and the bytes a person uploaded stay
 * the only thing the panel ever draws (DOC-005). Nothing in this file
 * writes a blob.
 *
 * **The route is decided by what the file answers, not by what it says
 * it is.** A PDF's native text layer is read first. A PDF that is only
 * pictures of pages answers with nothing, and that nothing — not a MIME
 * type, not a filename — is the signal to OCR it. A scan and a
 * born-digital contract are the same media type and the same extension,
 * so any decision taken before opening the file would be a guess.
 *
 * **A failure stops at the derivation.** The version row, its stored
 * blob, and its download are untouched whatever happens here; a version
 * whose extraction failed is a version with no text, not a broken
 * upload. Transient failures — a wedged LibreOffice, a restarting
 * sidecar — are retried; terminal ones are not, because a retry converts
 * the same bytes again.
 */

import type { Readable } from "node:stream";
import { documentVersions, documentVersionText, eq, type Db, type TextSource } from "@openlaw/db";
import {
  DocEngineError,
  SourceUnreadableError,
  UnsupportedFormatError,
  type DocEngine,
} from "../lib/doc-engine/engine.js";
import {
  BlobNotFoundError,
  InvalidBlobRefError,
  StorageError,
  type StorageAdapter,
} from "../lib/storage/adapter.js";
import { renderFamilyOf } from "../lib/render-family.js";
import type { PipelineLogger } from "./logger.js";

/** Everything a derivation handler needs to do its work. The same four
 * things the API is built from, minus the HTTP. */
export interface DerivationDeps {
  db: Db;
  storage: StorageAdapter;
  docEngine: DocEngine;
  log: PipelineLogger;
}

/** The database, or a transaction on it — the upload writes its pending
 * row inside one. */
type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * How many letters and digits a PDF's own text layer must carry before
 * it is taken as the document's text.
 *
 * DOC-005 says an image-only PDF is OCR'd, and "image-only" is not a
 * flag a PDF carries — it is what extraction answers. Zero is the
 * ordinary answer for a scan, but not the only one: a scanner stamps a
 * page number or a date into a text layer over the picture, and a file
 * whose only words are "Page 1 of 12" is a scan by every meaning that
 * matters here.
 *
 * The line is drawn low, and being wrong about it is cheap in exactly
 * one direction. Treating a very short native document as a scan costs
 * one OCR pass and still answers the same words, because the engine's
 * OCR rasterises whatever text layer it finds rather than refusing a
 * file that has one. Treating a scan as native costs the document its
 * searchability for good, which is the failure DOC-005 exists to
 * prevent.
 */
export const MIN_NATIVE_TEXT_CHARACTERS = 16;

/** Letters and digits only: the whitespace, rules, and stray punctuation
 * a scan's text layer collects say nothing about whether the words are
 * there. */
function wordCharacters(text: string): number {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

/**
 * Whether a PDF's own text layer is the document's text, or whether this
 * is a picture of a page that has to be read (DOC-005).
 */
export function hasUsableTextLayer(text: string): boolean {
  return wordCharacters(text) >= MIN_NATIVE_TEXT_CHARACTERS;
}

/**
 * Whether this version gets its text extracted at all.
 *
 * M12/3 reads PDFs. Word and PowerPoint are read from the display
 * rendition M12/4 converts — one extraction path, over PDF — and email
 * bodies are parsed in process in M12/5. Images yield no text in v1
 * (DOC-005 is image-only PDFs, not photographs), and the long tail is
 * download-only for good.
 *
 * A version this answers `false` for gets no derivation row, and the
 * text read says so plainly rather than leaving a caller polling for
 * something that is never coming.
 */
export function extractsText(mimeType: string, filename: string): boolean {
  return renderFamilyOf(mimeType, filename) === "pdf";
}

/**
 * Records that one version's text is owed.
 *
 * Called inside the upload's own transaction, which is the whole point:
 * a rolled-back upload leaves no derivation behind, and a committed one
 * always leaves one. The queue send that follows the commit only wakes a
 * worker — this row is what makes the work durable if that send is lost
 * (M12/6's sweep reads it).
 */
export function recordTextOwed(tx: Executor, versionId: string): Promise<unknown> {
  return tx
    .insert(documentVersionText)
    .values({ versionId, state: "pending" })
    .onConflictDoNothing();
}

/**
 * Whether a failure is the file's fault or the moment's.
 *
 * The pipeline has exactly one decision to make about an error, and it
 * is this one: mark the derivation failed, or try again. Bytes that are
 * not the document they claim to be, and a format no engine reads, are
 * what they are — a retry reads the same bytes and fails the same way.
 * Everything else is treated as the moment's: a timeout, an unreachable
 * sidecar, a database blip, and any error nobody has classified yet.
 *
 * Unknown errors count as transient on purpose. Retrying something
 * permanent wastes a few attempts and then records the failure anyway;
 * giving up on something temporary loses a document's text until
 * somebody notices.
 */
export function isTerminalFailure(error: unknown): boolean {
  if (error instanceof UnsupportedFormatError) return true;
  if (error instanceof SourceUnreadableError) return true;
  // The stored blob is missing, or its reference is malformed. Neither
  // heals: no retry puts bytes back, and no retry makes a bad reference
  // parse. Named one by one rather than by their base class, because a
  // store that answered oddly for a moment is also a `StorageError` and
  // that one is worth trying again.
  if (error instanceof BlobNotFoundError) return true;
  if (error instanceof InvalidBlobRefError) return true;
  return false;
}

/** Postgres' foreign-key violation, as pg reports it. */
const FOREIGN_KEY_VIOLATION = "23503";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/**
 * Writes a derivation's outcome, tolerating a version that was erased
 * while the job ran.
 *
 * Hard delete (DOC-010) can land between reading the version and writing
 * its text. The foreign key is what catches that, and there is nothing
 * to record when the row it pointed at is gone — so the violation is the
 * answer rather than a failure.
 */
async function writeDerivation(
  deps: DerivationDeps,
  versionId: string,
  row: { state: "ready" | "failed"; source: TextSource | null; text: string | null },
): Promise<void> {
  try {
    await deps.db
      .insert(documentVersionText)
      .values({ versionId, ...row })
      .onConflictDoUpdate({
        target: documentVersionText.versionId,
        set: { state: row.state, source: row.source, text: row.text, updatedAt: new Date() },
      });
  } catch (error) {
    if (errorCode(error) !== FOREIGN_KEY_VIOLATION) throw error;
    deps.log.info({ versionId }, "document version was deleted before its text was recorded");
  }
}

/** One version, as extraction needs it described. */
interface VersionRow {
  fileRef: string;
  mimeType: string;
  originalFilename: string;
}

/**
 * Reads one version's text and records it.
 *
 * Throws whatever failed, classified by the caller. It never touches the
 * version row, and it never writes a blob.
 */
export async function extractVersionText(deps: DerivationDeps, versionId: string): Promise<void> {
  const [version] = await deps.db
    .select({
      fileRef: documentVersions.fileRef,
      mimeType: documentVersions.mimeType,
      originalFilename: documentVersions.originalFilename,
    })
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId))
    .limit(1);
  if (!version) {
    // Hard-deleted (DOC-010) between the enqueue and now. Nothing is
    // owed for a version that no longer exists, and its derivation row
    // went with it.
    deps.log.info({ versionId }, "no document version to extract text from");
    return;
  }

  // Text that is already there is not read again. It makes the job
  // idempotent, which is what lets the M12/6 sweep enqueue freely and a
  // retry after a partial failure converge. A failed row is not skipped:
  // something asking again is exactly how a failure gets another go.
  const [existing] = await deps.db
    .select({ state: documentVersionText.state })
    .from(documentVersionText)
    .where(eq(documentVersionText.versionId, versionId))
    .limit(1);
  if (existing?.state === "ready") return;

  if (!extractsText(version.mimeType, version.originalFilename)) {
    deps.log.warn({ versionId }, "no text extraction path for this file");
    // A row should not exist for a file with nothing to read — the
    // upload writes one only for a family that yields text. If one is
    // there anyway, leaving it `pending` would have every sweep enqueue
    // it again for ever, so it is closed. Where there is no row, none is
    // made: the read answers `unsupported` from that absence, and a
    // `failed` row would turn "this file will never have text" into
    // "something went wrong".
    if (existing)
      await writeDerivation(deps, versionId, { state: "failed", source: null, text: null });
    return;
  }

  const { text, source } = await readPdfText(deps, versionId, version);
  await writeDerivation(deps, versionId, { state: "ready", source, text });
  deps.log.info(
    { versionId, source, characters: text.length },
    "extracted a document version's text",
  );
}

/**
 * The PDF route (DOC-005): read the native text layer, and read the
 * pages as pictures when it comes back with nothing worth keeping.
 *
 * The blob is opened twice rather than buffered once. A stream is
 * consumed by whoever reads it, and holding a whole scanned agreement in
 * memory to save a second read is the trade this pipeline should never
 * make — the OCR branch is the rare path, and the engine is about to
 * spend seconds on it either way.
 */
async function readPdfText(
  deps: DerivationDeps,
  versionId: string,
  version: VersionRow,
): Promise<{ text: string; source: TextSource }> {
  const native = await withBlob(deps, version.fileRef, (blob) =>
    deps.docEngine.extractPdfText(blob),
  );
  if (hasUsableTextLayer(native)) return { text: native, source: "native_layer" };

  deps.log.info(
    { versionId, nativeCharacters: wordCharacters(native) },
    "no usable text layer; reading the pages with OCR",
  );
  const ocr = await withBlob(deps, version.fileRef, (blob) => deps.docEngine.ocrPdf(blob));
  return { text: ocr, source: "ocr" };
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
async function withBlob<T>(
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

/** One job, as the retry policy needs it described. pg-boss's own
 * counters, which is why the handler asks for job metadata. */
export interface JobAttempt {
  versionId: string;
  retryCount: number;
  retryLimit: number;
}

/**
 * Runs one text-extraction job and decides what its failure means.
 *
 * Returning means the job is done with — either the text is there or the
 * derivation is marked failed and no retry would change that. Throwing
 * hands the job back to pg-boss, which retries it until its bound runs
 * out.
 */
export async function handleTextExtraction(
  deps: DerivationDeps,
  attempt: JobAttempt,
): Promise<void> {
  try {
    await extractVersionText(deps, attempt.versionId);
  } catch (error) {
    const terminal = isTerminalFailure(error);
    const exhausted = attempt.retryCount >= attempt.retryLimit;
    if (terminal || exhausted) {
      await writeDerivation(deps, attempt.versionId, { state: "failed", source: null, text: null });
      deps.log.error(
        {
          versionId: attempt.versionId,
          terminal,
          attempts: attempt.retryCount + 1,
          reason: reasonOf(error),
        },
        "text extraction failed",
      );
    }
    // A terminal failure is settled: the derivation says so, and handing
    // the job back would only retry the same bytes. Everything else goes
    // back to the queue, so the operator's job list shows the failure
    // whether or not a retry is left.
    if (!terminal) throw error;
  }
}

/** What went wrong, in one line, for the operator's log. */
function reasonOf(error: unknown): string {
  if (error instanceof DocEngineError || error instanceof StorageError) {
    return `${error.name}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
