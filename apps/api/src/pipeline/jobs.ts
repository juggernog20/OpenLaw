// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The background pipeline's seam (TECH-007).
 *
 * The pipeline is one queue on the database we already run — pg-boss on
 * Postgres, no Redis — and the worker container is the same application
 * image started with a different command. What the API sees of it is
 * this file: a queue it can ask for work, named in the domain's words
 * rather than in pg-boss's.
 *
 * **Asking is not doing.** Every method here answers as soon as the
 * request is recorded. Nothing an upload does waits for a derivation,
 * because an upload must complete at the speed it did in M11 (story 11).
 *
 * **Asking is also not the record of the work.** The derivation's own
 * row is (see `document_version_text`), and it is written inside the
 * upload's transaction. A queue send that is lost — the process dies
 * between the commit and the send — leaves a pending row that M12/6's
 * backfill sweep picks up. That is why the methods here are allowed to
 * fail quietly and the row is not.
 */

/** Every queue the pipeline runs, by its pg-boss name. */
export const JOB_QUEUES = {
  /**
   * One version's text extraction (DOC-005). OCR is a branch inside it
   * and not a queue of its own: whether a scan needs reading as pictures
   * is decided from what the native text layer answers, which is only
   * knowable once the job has started.
   */
  textExtraction: "document.text-extraction",
} as const;

/** What the text-extraction queue carries. */
export interface TextExtractionJob {
  /** The version whose text is owed. Nothing else: every other fact is
   * read live, so a job that waited in the queue while the document was
   * renamed or erased still acts on what is true now. */
  versionId: string;
}

/**
 * The one pipeline seam. Injected into the app factory beside the
 * database, the mailer, storage, and the doc engine; application code
 * only ever sees this type and never learns that pg-boss is behind it.
 */
export interface JobQueue {
  /**
   * Asks for one version's text to be extracted (DOC-005).
   *
   * Resolves once the request is recorded, never once the text exists.
   * It rejects only when the queue itself could not be reached — and a
   * caller on an upload path must not fail the upload for that, because
   * the derivation row it already committed is what makes the work
   * recoverable.
   */
  requestTextExtraction(versionId: string): Promise<void>;
}

/**
 * Stand-in for a process that builds the app but never runs it: any
 * request fails loudly instead of being dropped.
 *
 * The OpenAPI emitter registers every route against a database nobody
 * connects to, and two suites assert route wiring the same way. None of
 * them uploads a file, so none of them ever asks this for anything —
 * and a change that made one of them upload should say so rather than
 * pass while the derivation it asked for went nowhere.
 *
 * It is the mailer's `createUnconfiguredMailer` pattern, for the same
 * reason: a stand-in that silently succeeds is how a real deployment
 * ends up quietly doing nothing.
 */
export function createUnconfiguredJobQueue(): JobQueue {
  return {
    requestTextExtraction() {
      return Promise.reject(
        new Error("No job queue is configured in this process; nothing can be enqueued."),
      );
    },
  };
}
