// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Converting one version for display (DOC-004) — the pipeline's second
 * job, and the milestone's first sentence.
 *
 * A Legal Team Member uploads a Word draft and reads it in the app,
 * tracked changes and comments visible, without downloading it. A
 * browser cannot draw a DOCX, so the doc engine converts it to a PDF and
 * the panel draws that. PowerPoint rides the same path.
 *
 * Four rules shape this file.
 *
 * **The rendition is for display; the original is the record.** The
 * converted PDF is a second file beside the version, never a replacement
 * for it. The download still answers the bytes that were uploaded, the
 * checksum on the chain still describes those bytes, and a rendition can
 * be thrown away and made again from the original at any time
 * (DOC-001, DOC-005).
 *
 * **The blob is written before the row, and the row is what makes it
 * real.** The key is minted fresh for every attempt, because a stored
 * key is never written twice (DOC-012) — so a retry converts again into
 * a new key rather than colliding with what the failed attempt left. A
 * blob whose row could not be written is deleted on the way out, so the
 * ordinary failure leaves nothing behind at all.
 *
 * **The text comes from the rendition, at the end of the same job.**
 * There is one extraction path in this system and it is over PDF
 * (DOC-005), so a Word document's words are read from the PDF it was
 * converted to rather than by a second reader that understands DOCX.
 * This is the only moment anything knows the rendition exists, which is
 * why the reading happens here rather than in a job of its own.
 *
 * **A failure stops at the derivations.** The version row, its stored
 * blob, and its download are untouched whatever happens here. A terminal
 * conversion failure closes the rendition **and** the text, because a
 * text that was only ever going to come out of that rendition is not
 * coming either — and a caller polling for it deserves an answer rather
 * than a wait with no end.
 */

import { Readable } from "node:stream";
import { uuidv7 } from "uuidv7";
import { documentVersionRenditions, documentVersions, eq, type Executor } from "@openlaw/db";
import { conversionFormatOf } from "../lib/render-family.js";
import {
  errorCode,
  FOREIGN_KEY_VIOLATION,
  isTerminalFailure,
  reasonOf,
  type DerivationDeps,
  type JobAttempt,
} from "./derivations.js";
import {
  readPdfTextLayer,
  textDerivationState,
  textIsReady,
  writeTextDerivation,
} from "./text-extraction.js";

/**
 * Whether this version needs a display rendition before the panel can
 * draw it (DOC-004).
 *
 * The same question as "does the routing table name a format the engine
 * converts this from", asked in the domain's words. Word documents and
 * PowerPoint decks answer yes; PDFs and images are drawn as they are,
 * and everything else is download-only.
 */
export function needsDisplayRendition(mimeType: string, filename: string): boolean {
  return conversionFormatOf(mimeType, filename) !== null;
}

/**
 * Records that one version's display rendition is owed.
 *
 * Called inside the upload's own transaction, exactly as the text row
 * is: a rolled-back upload leaves no conversion behind, and a committed
 * one always says a conversion is due. The queue send that follows the
 * commit only wakes a worker — this row is what makes the work durable
 * if that send is lost, and what M12/6's sweep reads.
 */
export function recordRenditionOwed(tx: Executor, versionId: string): Promise<unknown> {
  return tx
    .insert(documentVersionRenditions)
    .values({ versionId, state: "pending" })
    .onConflictDoNothing();
}

/** One rendition row, as this file and the preview read need it. */
interface RenditionRow {
  state: "pending" | "ready" | "failed";
  fileRef: string | null;
}

/** This version's rendition as it stands, or `undefined` when none is
 * recorded. */
async function renditionOf(
  deps: DerivationDeps,
  versionId: string,
): Promise<RenditionRow | undefined> {
  const [row] = await deps.db
    .select({
      state: documentVersionRenditions.state,
      fileRef: documentVersionRenditions.fileRef,
    })
    .from(documentVersionRenditions)
    .where(eq(documentVersionRenditions.versionId, versionId))
    .limit(1);
  return row;
}

/**
 * Writes a rendition's outcome, tolerating a version that was erased
 * while the job ran, and says whether it was recorded.
 *
 * Hard delete (DOC-010) can land between reading the version and writing
 * its rendition. The foreign key catches that, and there is nothing to
 * record when the row it pointed at is gone — so the violation is an
 * answer rather than a failure. The caller is told, because a rendition
 * that was not recorded has a blob nobody will ever reference.
 */
async function writeRendition(
  deps: DerivationDeps,
  versionId: string,
  row: { state: "ready" | "failed"; fileRef: string | null; byteSize: number | null },
): Promise<boolean> {
  try {
    await deps.db
      .insert(documentVersionRenditions)
      .values({ versionId, ...row })
      .onConflictDoUpdate({
        target: documentVersionRenditions.versionId,
        set: {
          state: row.state,
          fileRef: row.fileRef,
          byteSize: row.byteSize,
          updatedAt: new Date(),
        },
      });
    return true;
  } catch (error) {
    if (errorCode(error) !== FOREIGN_KEY_VIOLATION) throw error;
    deps.log.info(
      { versionId },
      "document version was deleted before its display rendition was recorded",
    );
    return false;
  }
}

/** Where one version's display rendition is stored (DOC-012).
 *
 * Minted from the version's id, so an operator reading the store can see
 * what a blob belongs to, and given a fresh tail on every attempt,
 * because a key that has been written is never written again. A retry
 * therefore converts into a new key rather than colliding with the blob
 * a failed attempt left behind. */
function renditionKey(versionId: string): string {
  return `renditions/${versionId}/${uuidv7()}`;
}

/** Removes a blob nothing will ever reference, best effort. Failing to
 * tidy up is not worth failing a job that otherwise succeeded — the blob
 * is an orphan either way, and DOC-012 makes an orphan harmless. */
async function forget(deps: DerivationDeps, fileRef: string): Promise<void> {
  try {
    await deps.storage.delete(fileRef);
  } catch (error) {
    deps.log.warn(
      { fileRef, reason: reasonOf(error) },
      "could not remove an unreferenced display rendition",
    );
  }
}

/**
 * Converts one version's file to a PDF, stores it, and records it.
 *
 * The source blob is held open across the whole conversion and closed
 * afterwards whatever happened: the engine reads it as it produces the
 * answer, and a stream nobody closes holds a file handle until the
 * process notices.
 */
async function convertAndStore(
  deps: DerivationDeps,
  versionId: string,
  sourceRef: string,
  format: string,
): Promise<string | null> {
  const source = await deps.storage.get(sourceRef);
  let fileRef: string;
  let byteSize = 0;
  try {
    const pdf = await deps.docEngine.convertToPdf(source, format);
    // Counted on the way past, in one pass, exactly as the upload counts
    // what a person sent. It is what the preview's `content-length` is
    // set from — the storage adapter answers a reference, never a size.
    async function* metered(bytes: AsyncIterable<Buffer | string>): AsyncGenerator<Buffer> {
      for await (const chunk of bytes) {
        // A stream in binary mode yields buffers, which are passed
        // straight through — copying every chunk of a hundred-page
        // rendition to count it would double the work for nothing. A
        // driver that yields strings is converted rather than trusted.
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        byteSize += buffer.byteLength;
        yield buffer;
      }
    }
    fileRef = await deps.storage.put(renditionKey(versionId), Readable.from(metered(pdf)));
  } finally {
    source.destroy();
  }

  try {
    const recorded = await writeRendition(deps, versionId, { state: "ready", fileRef, byteSize });
    if (!recorded) {
      // The version was erased mid-job. Nothing references this blob and
      // nothing ever will.
      await forget(deps, fileRef);
      return null;
    }
  } catch (error) {
    // The row could not be written for a reason that is not an erasure.
    // The job will be retried and will convert into a fresh key, so this
    // blob is already unreferenced.
    await forget(deps, fileRef);
    throw error;
  }

  deps.log.info({ versionId, format, byteSize }, "converted a document version for display");
  return fileRef;
}

/**
 * Makes one version's display rendition and reads its text.
 *
 * Throws whatever failed, classified by the caller. It never touches the
 * version row, and it never replaces the stored original.
 */
export async function convertVersionForDisplay(
  deps: DerivationDeps,
  versionId: string,
): Promise<boolean> {
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
    // owed for a version that no longer exists, and its derivation rows
    // went with it.
    deps.log.info({ versionId }, "no document version to convert for display");
    return false;
  }

  const format = conversionFormatOf(version.mimeType, version.originalFilename);
  if (format === null) {
    deps.log.warn({ versionId }, "no display conversion path for this file");
    // As the extraction job does with a stray text row: a row that
    // should not exist is closed rather than left pending, because a
    // pending row is enqueued again by every sweep for ever. Where there
    // is no row, none is made — the read answers `unsupported` from that
    // absence.
    if (await renditionOf(deps, versionId)) {
      await writeRendition(deps, versionId, { state: "failed", fileRef: null, byteSize: null });
    }
    // And the text row with it, for the same reason and one more. The
    // extraction job leaves a Word document's text `pending` on purpose
    // and defers to this job, so a routing table that no longer maps
    // this version to a format strands that row: nothing else closes it,
    // and `derivationOwedBy` asks for nothing on a version that neither
    // converts nor extracts, so no sweep ever comes back for it. A
    // `ready` row is left alone, exactly as a failure leaves it, and
    // where there is no row none is made.
    const text = await textDerivationState(deps, versionId);
    if (text !== null && text !== "ready") {
      await writeTextDerivation(deps, versionId, { state: "failed", source: null, text: null });
    }
    return false;
  }

  // A rendition that is already there is not made again. It is what
  // makes the job idempotent, which is what lets the M12/6 sweep enqueue
  // freely and a retry after a partial failure converge. A failed row is
  // not skipped: something asking again is how a failure gets another
  // go.
  const existing = await renditionOf(deps, versionId);
  const fileRef =
    existing?.state === "ready" && existing.fileRef
      ? existing.fileRef
      : await convertAndStore(deps, versionId, version.fileRef, format);
  // The version was erased while this ran. Nothing is owed for it.
  if (fileRef === null) return false;

  // And now its words, out of the rendition — one extraction path, over
  // PDF (DOC-005). Skipped when the text is already there, so a retry
  // that only failed at this step does not read the same PDF twice.
  if (await textIsReady(deps, versionId)) return false;
  const text = await readPdfTextLayer(deps, fileRef);
  await writeTextDerivation(deps, versionId, { state: "ready", source: "rendition", text });
  deps.log.info(
    { versionId, source: "rendition", characters: text.length },
    "extracted a document version's text",
  );
  return true;
}

/**
 * Closes both derivations a failed conversion leaves owed.
 *
 * The rendition, because it will not arrive. The text too, because it
 * was only ever going to be read out of that rendition — a text row left
 * `pending` here would have the panel and the text read poll for
 * something nobody is coming with. Each is left alone if it is already
 * `ready`: a job that converted successfully and then failed to read the
 * PDF must not un-say the preview it delivered.
 */
async function failDerivations(deps: DerivationDeps, versionId: string): Promise<void> {
  const rendition = await renditionOf(deps, versionId);
  if (rendition?.state !== "ready") {
    await writeRendition(deps, versionId, { state: "failed", fileRef: null, byteSize: null });
  }
  if (!(await textIsReady(deps, versionId))) {
    await writeTextDerivation(deps, versionId, { state: "failed", source: null, text: null });
  }
}

/**
 * Runs one display-conversion job and decides what its failure means.
 *
 * Returning means the job is done with — either the rendition is there
 * or the derivations are marked failed and no retry would change that.
 * Throwing hands the job back to pg-boss, which retries it until its
 * bound runs out.
 */
export async function handleDisplayConversion(
  deps: DerivationDeps,
  attempt: JobAttempt,
  onTextReady?: (versionId: string) => Promise<void>,
): Promise<void> {
  let becameReady = false;
  try {
    becameReady = await convertVersionForDisplay(deps, attempt.versionId);
  } catch (error) {
    const terminal = isTerminalFailure(error);
    const exhausted = attempt.retryCount >= attempt.retryLimit;
    if (terminal || exhausted) {
      await failDerivations(deps, attempt.versionId);
      deps.log.error(
        {
          versionId: attempt.versionId,
          terminal,
          attempts: attempt.retryCount + 1,
          reason: reasonOf(error),
        },
        "display conversion failed",
      );
    }
    // A terminal failure is settled: the derivations say so, and handing
    // the job back would only convert the same bytes again. Everything
    // else goes back to the queue, so the operator's job list shows the
    // failure whether or not a retry is left.
    if (!terminal) throw error;
  }
  // The text is on the record by now. The analysis ask runs outside the
  // block above, so a fault in it cannot mark ready derivations as
  // failed or send this job back for bytes it already read (#664).
  if (becameReady) {
    try {
      await onTextReady?.(attempt.versionId);
    } catch (error) {
      deps.log.warn(
        { versionId: attempt.versionId, reason: reasonOf(error) },
        "could not request automatic analysis for ready text",
      );
    }
  }
}
