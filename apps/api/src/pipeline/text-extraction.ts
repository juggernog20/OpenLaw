// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Extracting one version's text (DOC-005) — the pipeline's first real
 * job.
 *
 * A Legal Team Member uploads a scanned contract and, without doing
 * anything else, its words become available. That is the whole of what
 * this file makes true, and everything in it follows from four rules.
 *
 * **The original is what renders.** The engine's OCR pass produces a
 * searchable PDF on the way and it is thrown away, here as in the
 * sidecar. What is kept is text, and the bytes a person uploaded stay
 * the only thing the panel ever draws for a PDF (DOC-005). Nothing in
 * this file writes a blob.
 *
 * **The route is decided by what the file answers, not by what it says
 * it is.** A PDF's native text layer is read first. A PDF that is only
 * pictures of pages answers with nothing, and that nothing — not a MIME
 * type, not a filename — is the signal to OCR it. A scan and a
 * born-digital contract are the same media type and the same extension,
 * so any decision taken before opening the file would be a guess.
 *
 * **There is one extraction path, and it is over PDF.** A Word document
 * and a PowerPoint deck have text too, and it is read from the display
 * rendition the conversion job made of them (M12/4) — never by a second
 * reader per office format. So this handler reads PDFs, and the
 * conversion job calls {@link readPdfTextLayer} at the end of its own
 * work. Both write the same row, through the same writer.
 *
 * **An email is the one file read without the engine** (M12/5,
 * TECH-010). A MSG or an EML is parsed in process by a Node library, and
 * its body is its text — no conversion, no OCR, and no round trip to the
 * sidecar. It is a branch in this handler rather than a queue of its
 * own, for the reason OCR is: it is the same job, answering text, and
 * writing the same row through the same writer.
 *
 * **A failure stops at the derivation.** The version row, its stored
 * blob, and its download are untouched whatever happens here; a version
 * whose extraction failed is a version with no text, not a broken
 * upload. Transient failures — a wedged LibreOffice, a restarting
 * sidecar — are retried; terminal ones are not, because a retry converts
 * the same bytes again.
 */

import {
  documentVersions,
  documentVersionText,
  eq,
  type Executor,
  type TextSource,
} from "@openlaw/db";
import { emailBodyText, isEmail, parseStoredEmail } from "../lib/email/parse.js";
import { conversionFormatOf, renderFamilyOf } from "../lib/render-family.js";
import {
  errorCode,
  FOREIGN_KEY_VIOLATION,
  isTerminalFailure,
  reasonOf,
  withBlob,
  type DerivationDeps,
  type JobAttempt,
} from "./derivations.js";

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

/**
 * Letters and digits only, counted no further than the line needs.
 *
 * The whitespace, rules, and stray punctuation a scan's text layer
 * collects say nothing about whether the words are there. The count
 * stops at {@link MIN_NATIVE_TEXT_CHARACTERS}, because that is the only
 * question asked of it and the alternative is expensive: a born-digital
 * deed carries millions of word characters, and matching them all would
 * build an array of that many one-character strings in the worker to
 * decide one bit. The log line below reads this count too, and only on
 * the branch where it came back under the line, so what it prints is
 * never the capped value.
 */
function wordCharacters(text: string): number {
  const wordCharacter = /[\p{L}\p{N}]/u;
  let counted = 0;
  for (const character of text) {
    if (!wordCharacter.test(character)) continue;
    counted += 1;
    if (counted >= MIN_NATIVE_TEXT_CHARACTERS) return counted;
  }
  return counted;
}

/**
 * Whether a PDF's own text layer is the document's text, or whether this
 * is a picture of a page that has to be read (DOC-005).
 */
export function hasUsableTextLayer(text: string): boolean {
  return wordCharacters(text) >= MIN_NATIVE_TEXT_CHARACTERS;
}

/**
 * Whether the pipeline will ever produce text for this version.
 *
 * Four families answer yes. PDFs are read directly, here. Word
 * documents and PowerPoint decks are read from the PDF rendition the
 * conversion job makes of them (M12/4), so their text is owed from the
 * moment they are uploaded even though this handler never touches them.
 * An email's body is its text, parsed in process here (M12/5). Images
 * yield no text in v1 (DOC-005 is image-only PDFs, not photographs), and
 * the long tail is download-only for good.
 *
 * A version this answers `false` for gets no derivation row, and the
 * text read says so plainly rather than leaving a caller polling for
 * something that is never coming.
 */
export function extractsText(mimeType: string, filename: string): boolean {
  const family = renderFamilyOf(mimeType, filename);
  return family === "pdf" || family === "word" || family === "presentation" || family === "email";
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
 * Writes a derivation's outcome, tolerating a version that was erased
 * while the job ran.
 *
 * Hard delete (DOC-010) can land between reading the version and writing
 * its text. The foreign key is what catches that, and there is nothing
 * to record when the row it pointed at is gone — so the violation is the
 * answer rather than a failure.
 *
 * Shared with the conversion job, which writes the text it read out of a
 * rendition through this same writer: one row, one shape, one place that
 * knows what a text derivation looks like.
 */
export async function writeTextDerivation(
  deps: DerivationDeps,
  versionId: string,
  row: {
    state: "ready" | "failed";
    source: TextSource | null;
    text: string | null;
    emailSubject?: string | null;
  },
): Promise<void> {
  const emailSubject = row.emailSubject ?? null;
  try {
    await deps.db
      .insert(documentVersionText)
      .values({ versionId, ...row, emailSubject })
      .onConflictDoUpdate({
        target: documentVersionText.versionId,
        set: {
          state: row.state,
          source: row.source,
          text: row.text,
          emailSubject,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    if (errorCode(error) !== FOREIGN_KEY_VIOLATION) throw error;
    deps.log.info({ versionId }, "document version was deleted before its text was recorded");
  }
}

/**
 * What this version's text row says, or `null` when there is none.
 *
 * Absent and `pending` are two different facts and both jobs branch on
 * the difference: a row that should not exist is closed, and where there
 * is no row none is made.
 */
export async function textDerivationState(
  deps: DerivationDeps,
  versionId: string,
): Promise<"pending" | "ready" | "failed" | null> {
  const [existing] = await deps.db
    .select({ state: documentVersionText.state })
    .from(documentVersionText)
    .where(eq(documentVersionText.versionId, versionId))
    .limit(1);
  return existing?.state ?? null;
}

/** Whether this version already has its text, so a job may stop. */
export async function textIsReady(deps: DerivationDeps, versionId: string): Promise<boolean> {
  return (await textDerivationState(deps, versionId)) === "ready";
}

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
export async function extractVersionText(
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
    // owed for a version that no longer exists, and its derivation row
    // went with it.
    deps.log.info({ versionId }, "no document version to extract text from");
    return false;
  }

  // Text that is already there is not read again. It makes the job
  // idempotent, which is what lets the M12/6 sweep enqueue freely and a
  // retry after a partial failure converge. A failed row is not skipped:
  // something asking again is exactly how a failure gets another go.
  if (await textIsReady(deps, versionId)) return false;

  if (!extractsText(version.mimeType, version.originalFilename)) {
    deps.log.warn({ versionId }, "no text extraction path for this file");
    // A row should not exist for a file with nothing to read — the
    // upload writes one only for a family that yields text. If one is
    // there anyway, leaving it `pending` would have every sweep enqueue
    // it again for ever, so it is closed. Where there is no row, none is
    // made: the read answers `unsupported` from that absence, and a
    // `failed` row would turn "this file will never have text" into
    // "something went wrong".
    if (await textDerivationState(deps, versionId))
      await writeTextDerivation(deps, versionId, { state: "failed", source: null, text: null });
    return false;
  }

  if (conversionFormatOf(version.mimeType, version.originalFilename) !== null) {
    // A Word document or a PowerPoint deck. Its text lives in the PDF
    // rendition, and the conversion job reads it there at the end of its
    // own work (M12/4) — one extraction path, over PDF. The row is left
    // `pending`, which is exactly what it is: the text is coming, from
    // the other job.
    deps.log.info(
      { versionId },
      "this version's text comes from its display rendition; leaving it to the conversion job",
    );
    return false;
  }

  const { text, source, emailSubject } = isEmail(version.mimeType, version.originalFilename)
    ? await readEmailBody(deps, version)
    : { ...(await readPdfText(deps, versionId, version)), emailSubject: null };
  await writeTextDerivation(deps, versionId, { state: "ready", source, text, emailSubject });
  deps.log.info(
    { versionId, source, characters: text.length },
    "extracted a document version's text",
  );
  return true;
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
  const native = await readPdfTextLayer(deps, version.fileRef);
  if (hasUsableTextLayer(native)) return { text: native, source: "native_layer" };

  deps.log.info(
    { versionId, nativeCharacters: wordCharacters(native) },
    "no usable text layer; reading the pages with OCR",
  );
  const ocr = await withBlob(deps, version.fileRef, (blob) => deps.docEngine.ocrPdf(blob));
  return { text: ocr, source: "ocr" };
}

/**
 * The email route (DOC-004, M12/5): parse the message and keep its body.
 *
 * Nothing is converted and nothing is stored. The words a sender wrote
 * are already text, so the derivation is a parse and a trim — which is
 * why this is a branch here rather than a job with a queue of its own.
 *
 * The blob is opened through the same helper the PDF route uses, so a
 * parse that refuses part way through leaves no handle behind.
 */
async function readEmailBody(
  deps: DerivationDeps,
  version: VersionRow,
): Promise<{ text: string; source: TextSource; emailSubject: string | null }> {
  const email = await withBlob(deps, version.fileRef, (blob) =>
    parseStoredEmail(blob, version.mimeType, version.originalFilename),
  );
  return { text: emailBodyText(email), source: "email_body", emailSubject: email.subject };
}

/**
 * One stored PDF's own text layer, whatever the PDF is.
 *
 * The one place a PDF is read, so a stored original and a converted
 * rendition go through the same call. The conversion job uses it on the
 * rendition it has just written (M12/4).
 */
export function readPdfTextLayer(deps: DerivationDeps, fileRef: string): Promise<string> {
  return withBlob(deps, fileRef, (blob) => deps.docEngine.extractPdfText(blob));
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
  onTextReady?: (versionId: string) => Promise<void>,
): Promise<void> {
  let becameReady = false;
  try {
    becameReady = await extractVersionText(deps, attempt.versionId);
  } catch (error) {
    const terminal = isTerminalFailure(error);
    const exhausted = attempt.retryCount >= attempt.retryLimit;
    if (terminal || exhausted) {
      await writeTextDerivation(deps, attempt.versionId, {
        state: "failed",
        source: null,
        text: null,
      });
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
  // The text is on the record by now. The analysis ask runs outside the
  // block above, so a fault in it cannot mark ready text as failed or
  // send this job back for bytes it already read (#664).
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
