// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The upgrade backfill sweep (M12/6).
 *
 * An install that upgrades from M11 has paper on the record that nothing
 * has ever read. Those versions were uploaded before the derivation
 * tables existed, so they carry no row saying anything is owed, and no
 * upload will ever happen for them again. This file is what applies the
 * milestone to them: on boot, the worker walks the versions, works out
 * what each one is still owed, and asks the pipeline for it. Nobody
 * re-uploads anything (story 23).
 *
 * Four rules shape it.
 *
 * **It asks; it never derives.** The sweep sends the same two jobs an
 * upload sends, to the same two queues, and the same handlers do the
 * work. There is no second code path for old paper, so a backfilled
 * version gets exactly what a freshly uploaded one gets.
 *
 * **A missing row and a pending row are the same fact: work owed.** A
 * version that predates M12 has no row. A version whose queue send was
 * lost has a `pending` row. So does a version whose job expired against
 * a wedged worker on its last attempt — the handler never ran its catch,
 * so nothing was written. The sweep cannot tell these apart and does not
 * need to: all three want to be asked again.
 *
 * **A derivation that gave up is settled, and the sweep leaves it
 * alone.** A `failed` row is the outcome of a job that ran and decided
 * no retry would read the same bytes differently. Enqueuing it on every
 * boot would convert the same file for ever and never answer anything
 * new. This is the one state the sweep will not re-ask for.
 *
 * **Asking twice is free, so the sweep does not try to be clever about
 * it.** pg-boss's `short` policy collapses a second request for a
 * version whose job is still waiting, and both handlers stop early when
 * the derivation is already there. Two workers booting together, or one
 * worker booting while an upload is in flight, therefore cost one job
 * between them — which is what makes this safe to run at every boot.
 */

import {
  asc,
  documentVersionRenditions,
  documentVersions,
  documentVersionText,
  eq,
  gt,
  type Db,
  type DerivationState,
} from "@openlaw/db";
import { reasonOf } from "./derivations.js";
import { needsDisplayRendition } from "./display-conversion.js";
import type { JobQueue } from "./jobs.js";
import type { PipelineLogger } from "./logger.js";
import { extractsText } from "./text-extraction.js";

/**
 * How many versions are read at a time.
 *
 * The sweep reads the whole version table, because which family a file
 * belongs to is decided from its declared type and its filename
 * (DOC-004) and no database can answer that. Reading it in pages keeps
 * one boot on an install with a large back catalogue from holding a
 * result set — and each row is three short columns and two states.
 */
export const BACKFILL_PAGE_SIZE = 500;

/**
 * How many requests in a row may be refused before the sweep gives up on
 * the queue.
 *
 * A queue that refuses several requests back to back is down, not busy,
 * and walking the rest of a back catalogue to be told the same thing
 * costs a round trip per version — on a queue that is timing out rather
 * than refusing, that is minutes of a boot spent learning nothing. The
 * bound is small because the recovery is free: every derivation row
 * still says what is owed, so the next boot asks again.
 */
export const BACKFILL_REFUSAL_LIMIT = 5;

/** What the sweep needs, and nothing more: the versions, and somewhere
 * to say what it did. It derives nothing, so it needs neither the
 * storage adapter nor the doc engine. */
export interface BackfillDeps {
  db: Db;
  log: PipelineLogger;
}

/** What a caller may vary about one sweep. */
export interface BackfillOptions {
  /** Versions read at a time. Defaults to {@link BACKFILL_PAGE_SIZE}. */
  pageSize?: number;
  /**
   * Stops the sweep between pages and between versions.
   *
   * A container is stopped by a signal, and a sweep over a large back
   * catalogue must not be what keeps the process alive past its grace
   * period. Whatever it did not reach is picked up by the next boot,
   * because the sweep reads the record rather than a cursor it kept.
   */
  signal?: AbortSignal;
}

/** What one sweep did, for the operator's log. */
export interface BackfillSummary {
  /** Versions looked at. */
  scanned: number;
  /** Text extractions asked for (DOC-005). */
  textExtraction: number;
  /** Display conversions asked for (DOC-004). */
  displayConversion: number;
  /** Requests the queue refused. The derivation rows still say what is
   * owed, so the next boot asks again. */
  notEnqueued: number;
  /** Whether the sweep was stopped before it reached the end — by a
   * shutdown, or by a queue that would not take anything. */
  stopped: boolean;
}

/** One version, as the sweep needs it described. */
export interface SweptVersion {
  mimeType: string;
  originalFilename: string;
  /** Where its extracted text has got to, or `null` when no row was
   * ever written — a version that predates the table. */
  textState: DerivationState | null;
  /** The same for its display rendition. */
  renditionState: DerivationState | null;
}

/** The job that would deliver what a version is still owed. */
export type OwedDerivation = "text-extraction" | "display-conversion";

/** Whether this derivation is still owed. A row that was never written
 * and a row nobody finished are the same fact here. */
function owed(state: DerivationState | null): boolean {
  return state === null || state === "pending";
}

/**
 * Which job, if any, this version is still owed.
 *
 * **One job per version, chosen by family** — the rule the upload path
 * follows, applied to paper nobody is uploading. A Word document or a
 * PowerPoint deck asks for conversion, and that job reads the
 * rendition's text at the end of its own work, so it covers both of that
 * version's derivations. Everything else that yields text asks for
 * extraction. An image and the download-only long tail ask for nothing,
 * because nothing is coming for them and a job would only refuse.
 *
 * A conversion that gave up closes the version for good, its text
 * included: the text was only ever going to be read out of that
 * rendition, so a text row still marked owed beside a `failed` rendition
 * is not a reason to convert the same bytes again.
 */
export function derivationOwedBy(version: SweptVersion): OwedDerivation | null {
  if (needsDisplayRendition(version.mimeType, version.originalFilename)) {
    if (version.renditionState === "failed") return null;
    return owed(version.renditionState) || owed(version.textState) ? "display-conversion" : null;
  }
  if (!extractsText(version.mimeType, version.originalFilename)) return null;
  return owed(version.textState) ? "text-extraction" : null;
}

/**
 * Asks the pipeline for everything the install is still owed.
 *
 * Answers what it did rather than throwing: a sweep is best effort by
 * nature, and a boot must not fail because one request was refused. The
 * derivation rows are the record of work owed, so anything this sweep
 * missed is still owed at the next boot.
 */
export async function runBackfillSweep(
  deps: BackfillDeps,
  jobs: JobQueue,
  options: BackfillOptions = {},
): Promise<BackfillSummary> {
  const pageSize = options.pageSize ?? BACKFILL_PAGE_SIZE;
  const summary: BackfillSummary = {
    scanned: 0,
    textExtraction: 0,
    displayConversion: 0,
    notEnqueued: 0,
    stopped: false,
  };
  // Keyset paging on the version id, which is a uuidv7 and so sorts by
  // the moment it was minted. An offset would re-read rows as the table
  // grows underneath a long sweep; a cursor holds no connection open
  // between pages.
  let after: string | undefined;
  // The queue being unreachable would otherwise write one line per
  // version. The count in the summary is what says how wide it went.
  let reported = false;
  // Refusals back to back, which is what a queue that is down looks
  // like. Reset by anything the queue takes.
  let refusals = 0;

  for (;;) {
    if (options.signal?.aborted) {
      summary.stopped = true;
      return summary;
    }
    const page = await deps.db
      .select({
        id: documentVersions.id,
        mimeType: documentVersions.mimeType,
        originalFilename: documentVersions.originalFilename,
        textState: documentVersionText.state,
        renditionState: documentVersionRenditions.state,
      })
      .from(documentVersions)
      .leftJoin(documentVersionText, eq(documentVersionText.versionId, documentVersions.id))
      .leftJoin(
        documentVersionRenditions,
        eq(documentVersionRenditions.versionId, documentVersions.id),
      )
      .where(after === undefined ? undefined : gt(documentVersions.id, after))
      .orderBy(asc(documentVersions.id))
      .limit(pageSize);
    if (page.length === 0) return summary;

    for (const version of page) {
      if (options.signal?.aborted) {
        summary.stopped = true;
        return summary;
      }
      summary.scanned += 1;
      const wanted = derivationOwedBy(version);
      if (wanted === null) continue;
      try {
        if (wanted === "display-conversion") {
          await jobs.requestDisplayConversion(version.id);
          summary.displayConversion += 1;
        } else {
          await jobs.requestTextExtraction(version.id);
          summary.textExtraction += 1;
        }
        refusals = 0;
      } catch (error) {
        summary.notEnqueued += 1;
        refusals += 1;
        if (!reported) {
          reported = true;
          deps.log.warn(
            { versionId: version.id, wanted, reason: reasonOf(error) },
            "the backfill sweep could not reach the job queue",
          );
        }
        if (refusals >= BACKFILL_REFUSAL_LIMIT) {
          summary.stopped = true;
          return summary;
        }
      }
    }

    after = page[page.length - 1]!.id;
    // A short page is the last one. Asking for another would cost a
    // round trip to be told the same thing.
    if (page.length < pageSize) return summary;
  }
}
