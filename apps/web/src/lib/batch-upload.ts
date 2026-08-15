// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The bulk intake batch (M13/4, DOC-011, DES-033).
 *
 * **A batch is N ordinary uploads, never one bulk call.** Every file
 * becomes a new document at version 1 through the upload route a single
 * file already goes through, so the primary designation (CTR-014), the
 * activity entry (DD-017), and the derivations (DOC-005) are the same
 * facts a single upload leaves behind. Nothing on the server knows a
 * batch happened, which is the point: there is one upload path to keep
 * correct.
 *
 * **The batch is driven by the client, bounded, and honest about
 * failure.** A pool of a few workers takes files off the front of the
 * list, each file carries its own state, and a refusal costs that file
 * and nothing else. A file that already landed is never sent again, so
 * a retry cannot put the same document on the record twice.
 *
 * This module holds the two pieces that are not React: what a drop
 * carries, and how many uploads run at once.
 */

/**
 * How many uploads run at once.
 *
 * Three, because the point of a bound is that a 200-file import does
 * not open 200 connections at the browser's mercy, and the number that
 * saturates a link is small. It is a constant rather than a setting:
 * nobody has asked to tune it, and a tuned batch is a batch whose
 * failures depend on a number nobody remembers choosing.
 */
export const BATCH_CONCURRENCY = 3;

/** Where one file is in the batch (DES-033 §11). */
export type BatchState = "queued" | "uploading" | "done" | "failed";

/**
 * One file of a batch, as the dialog draws it and the pool sends it.
 *
 * The row is the unit of everything: one upload, one state, one
 * failure, one retry. **This is also where M13/5 adds the destination**
 * — a folder path taken off the dropped directory tree — because a
 * per-file field is what the pool already carries per file, and the
 * only other change is the form the send builds.
 */
export interface BatchRow {
  /** Stable within one batch: the row's key, and the handle a retry is
   * addressed to. */
  id: string;
  file: File;
  state: BatchState;
  /** Why it failed, in the seam's own words when the seam sent any. */
  reason: string | null;
  /** Whether a retry could change the answer (DES-033 §11). A file over
   * the deployment's size ceiling is refused again by the same seam, so
   * it is offered none. */
  retryable: boolean;
}

/** The batch a set of chosen or dropped files starts as: every file
 * queued, nothing sent. */
export function batchOf(files: readonly File[]): BatchRow[] {
  return files.map((file, index) => ({
    id: `batch-${index}`,
    file,
    state: "queued",
    reason: null,
    retryable: true,
  }));
}

/**
 * The plain files a drop carries.
 *
 * `items` is preferred over `files` because it is the list that can
 * answer what an entry *is*: a dropped directory appears there as an
 * entry that is not a file, and M13/4 has no folders in it, so a
 * directory is left alone rather than half-read. **M13/5 walks those
 * same entries** with the directory-entry API, which is why the reading
 * goes through this one function rather than through `dataTransfer.files`
 * at the drop handler.
 *
 * Everything is optional-guarded because a drop event is shaped by the
 * browser, not by us, and a `DataTransfer` without `items` is a real
 * shape rather than a broken one.
 */
export function filesFromDrop(transfer: DataTransfer | null | undefined): File[] {
  if (!transfer) return [];
  const items = transfer.items ? [...transfer.items] : [];
  if (items.length === 0) return transfer.files ? [...transfer.files] : [];
  const files: File[] = [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    // A directory is not a file, and recreating one is M13/5's job. The
    // call is guarded because a synthetic item need not carry it.
    const entry = item.webkitGetAsEntry?.();
    if (entry && !entry.isFile) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

/** Whether a drag is carrying files at all, so the section lights up
 * for a file drag and stays still for a text selection being dragged
 * across it. */
export function dragCarriesFiles(transfer: DataTransfer | null | undefined): boolean {
  return transfer ? [...(transfer.types ?? [])].includes("Files") : false;
}

/**
 * Runs `work` over every job, with at most `limit` of them in flight.
 *
 * A fixed pool of workers pulling off one shared cursor, rather than
 * chunks of `limit` run one after another: a chunk waits for its
 * slowest member before the next one starts, so one 40 MB file in a
 * chunk of three leaves two workers idle. Here a worker that finishes
 * takes the next file immediately.
 *
 * `work` is expected to record its own failures. One that throws anyway
 * costs its own job and nothing else — a rejection let out of a worker
 * would reject the whole pool and strand every job still queued, which
 * is the one thing the pool exists to prevent.
 */
export async function runBounded<T>(
  jobs: readonly T[],
  limit: number,
  work: (job: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, jobs.length)) }, async () => {
    for (;;) {
      const index = next++;
      // The end of the list is the only reason to stop. A job whose
      // value happens to be `undefined` is still a job, and retiring
      // the worker on it would drop everything behind it.
      if (index >= jobs.length) return;
      try {
        await work(jobs[index]!);
      } catch {
        // Recorded by `work`, or not at all. Either way the pool goes
        // on to the next file.
      }
    }
  });
  await Promise.all(workers);
}
