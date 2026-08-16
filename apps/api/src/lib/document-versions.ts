// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one write path that puts a round on a document's chain (DOC-001).
 *
 * It started as a closure inside the documents module, because an
 * upload was the only act that ever appended a version. M15/5 gives it
 * a second caller: the executed copy the signing integration fetches
 * back is a round on the same chain, written the same way (CTR-014). So
 * the write moved here, and both callers use it — a second append path
 * would be a second answer to "what does a version row look like", and
 * the two would drift.
 *
 * Three rules travel with it.
 *
 * **The number is assigned under the owning contract's row lock.** The
 * chain runs 1..n with no gaps, so the next number is a step up from a
 * number that is really there rather than a count of rows — and two
 * writers reading the high-water mark at the same moment would both
 * read the same one. {@link nextVersionNumber} therefore says in its
 * own name what its caller has to be holding. The unique index on
 * (`document_id`, `version_number`) is the database's own last word
 * behind it.
 *
 * **What the pipeline owes the round is written in the same
 * transaction.** A rolled-back append asks for nothing; a committed one
 * always leaves the request on the record. The queue send that follows
 * the commit only wakes a worker, and a lost send leaves a `pending`
 * row for the M12/6 sweep rather than a version nobody will ever read.
 *
 * **The row is immutable.** There is one INSERT into
 * `document_versions` in this repository and it is here — no UPDATE and
 * no DELETE anywhere beside it (DOC-001).
 */

import { desc, documentVersions, eq, type Db, type DocumentVersionKind } from "@openlaw/db";
import { needsDisplayRendition, recordRenditionOwed } from "../pipeline/display-conversion.js";
import type { JobQueue } from "../pipeline/jobs.js";
import { extractsText, recordTextOwed } from "../pipeline/text-extraction.js";

/** The database, or a transaction on it — every append here runs inside
 * one. */
export type VersionWriter = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Somewhere to say that a queue could not be reached. The pipeline's
 * own logger shape, so a route's Fastify log and the worker's console
 * logger both fit without an adapter. */
export interface QueueLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

/** Where one version's blob lives (DOC-012): minted from the two ids,
 * never from a filename, so no name a person chose can shape a storage
 * key. */
export function versionStorageKey(documentId: string, versionId: string): string {
  return `documents/${documentId}/${versionId}`;
}

/**
 * The number the next round on this chain takes.
 *
 * **Call it under the owning contract's row lock.** Without one, two
 * writers read the same high-water mark and the second INSERT is
 * refused by the unique index — which is the right failure, but it is a
 * failure the lock makes impossible rather than one worth recovering
 * from.
 */
export async function nextVersionNumber(tx: VersionWriter, documentId: string): Promise<number> {
  const [high] = await tx
    .select({ versionNumber: documentVersions.versionNumber })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.versionNumber))
    .limit(1);
  // A document always has version 1, so this is a step up from a number
  // that is really there rather than a count of rows.
  return (high?.versionNumber ?? 0) + 1;
}

/** One round, as the chain stores it. */
export interface AppendedVersion {
  documentId: string;
  versionId: string;
  versionNumber: number;
  fileRef: string;
  kind: DocumentVersionKind;
  /** What changed in this round, or NULL when nobody wrote one. */
  note: string | null;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  /** Who the round is recorded against. The integration has no account
   * of its own, so a round it files is recorded against the person who
   * sent the envelope — the nearest human act behind the file. */
  createdBy: string;
}

/**
 * Writes one round onto a chain, and records what the pipeline owes it.
 *
 * Runs inside the caller's transaction, under the owning contract's row
 * lock — see the module note for why both.
 */
export async function insertDocumentVersion(
  tx: VersionWriter,
  row: Readonly<AppendedVersion>,
): Promise<void> {
  await tx.insert(documentVersions).values({
    id: row.versionId,
    documentId: row.documentId,
    versionNumber: row.versionNumber,
    fileRef: row.fileRef,
    kind: row.kind,
    note: row.note,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    createdBy: row.createdBy,
  });
  // Only a file that has text to read gets a row. An image or a
  // spreadsheet gets none, and the text read says so plainly rather
  // than leaving a caller polling for an answer that is not coming.
  if (extractsText(row.mimeType, row.originalFilename)) {
    await recordTextOwed(tx, row.versionId);
  }
  // And a display rendition for a file a browser cannot draw (DOC-004).
  if (needsDisplayRendition(row.mimeType, row.originalFilename)) {
    await recordRenditionOwed(tx, row.versionId);
  }
}

/** How long a caller waits for the queue to take a request before it
 * carries on without it. The bound is the point: the queue is an
 * interface, so what is behind it might one day hang rather than
 * refuse, and no write path may be delayed by its pipeline. */
const QUEUE_ASK_TIMEOUT_MS = 2000;

/**
 * Wakes the pipeline for whatever a freshly appended round is owed —
 * its text (DOC-005), or its display rendition (DOC-004).
 *
 * **One job per version, chosen by family.** A PDF's text is read
 * straight off the file, so it asks for extraction. A Word document and
 * a PowerPoint deck have to be converted before anything can read them,
 * so they ask for conversion — and the conversion job reads the
 * rendition's text at the end of its own work, which is why nothing
 * asks for both. Everything else asks for nothing.
 *
 * **Call it after the transaction has committed, never inside it.** A
 * rolled-back append asks for nothing, because there was no commit to
 * ask after; and a queue that cannot be reached never fails the write
 * and never holds it up. The refusal is logged, the `pending` rows are
 * already committed, and M12/6's sweep is what picks it up.
 */
export async function requestDerivations(
  jobs: JobQueue,
  log: QueueLogger,
  version: Readonly<{ versionId: string; mimeType: string; originalFilename: string }>,
): Promise<void> {
  const converts = needsDisplayRendition(version.mimeType, version.originalFilename);
  if (!converts && !extractsText(version.mimeType, version.originalFilename)) return;
  let timer: NodeJS.Timeout | undefined;
  const asked = converts
    ? jobs.requestDisplayConversion(version.versionId)
    : jobs.requestTextExtraction(version.versionId);
  // Whichever side loses settles later, unobserved — both get a handler
  // up front so neither becomes an unhandled rejection.
  asked.catch(() => {});
  const bound = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("the queue did not answer in time")),
      QUEUE_ASK_TIMEOUT_MS,
    );
    timer.unref();
  });
  bound.catch(() => {});
  try {
    await Promise.race([asked, bound]);
  } catch (error) {
    log.error(
      { err: error, versionId: version.versionId },
      "could not ask the pipeline for a version's derivations",
    );
  } finally {
    clearTimeout(timer);
  }
}
