// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The background pipeline's seam (TECH-007).
 *
 * The pipeline runs on the database we already run — pg-boss on
 * Postgres, no Redis — and the worker container is the same application
 * image started with a different command. What the API sees of it is
 * this file: work it can ask for, named in the domain's words rather
 * than in pg-boss's.
 *
 * **One method per thing the domain asks for**, never a generic
 * `enqueue(name, payload)`. A route names what it wants and never learns
 * what is behind it, and a queue that is added shows up here as a
 * method rather than as a string a caller had to know.
 *
 * **Asking is not doing.** Every method here answers as soon as the
 * request is recorded. Nothing an upload does waits for a derivation,
 * because an upload must complete at the speed it did in M11 (story 11).
 *
 * **Asking is also not the record of the work.** The derivation's own
 * row is (see `document_version_text` and `document_version_rendition`),
 * and it is written inside the upload's transaction. A queue send that
 * is lost — the process dies between the commit and the send — leaves a
 * pending row that M12/6's backfill sweep picks up. That is why the
 * methods here are allowed to fail quietly and the row is not.
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
  /**
   * One version's display conversion (DOC-004, M12/4): a Word document
   * or a PowerPoint deck becomes the PDF rendition the panel draws.
   *
   * It is a queue of its own rather than a branch inside extraction,
   * because it is a different piece of work with a different product:
   * extraction answers text and writes no blob, conversion writes a blob
   * the panel then reads. The converted file's text is read at the end
   * of the same job — one extraction path, over PDF — because the
   * rendition is what it must be read from, and nothing else in the
   * system knows the rendition exists at that moment.
   */
  displayConversion: "document.display-conversion",
  /**
   * The backfill sweep (M12/6), on a schedule rather than at boot alone.
   *
   * It carries no payload: the sweep asks the derivation rows what is
   * owed, and those rows are the only input it has ever had. It is a
   * queue rather than a timer in the worker because pg-boss already
   * holds the clock, and because an install running two workers should
   * sweep once rather than twice.
   */
  backfillSweep: "document.backfill-sweep",
  /**
   * One signed envelope's executed copy (CTR-013, CTR-014, M15/5): the
   * provider holds the signed PDF, and this is the job that brings it
   * back onto the record's own chain.
   *
   * It is a derivation in every way that matters here — a background
   * job that produces an artifact from bytes somebody else holds, with
   * a `pending | ready | failed` state on the row that asked for it —
   * so it follows M12's pattern rather than inventing a second one. It
   * is a queue of its own because it is different work with a different
   * product, and because it fails for different reasons: a provider
   * that will not answer is not a document engine that will not
   * convert.
   */
  executedCopyFetch: "envelope.executed-copy-fetch",
  /**
   * The reconciliation sweep (M15/6), on the same schedule the backfill
   * sweep is on and for one extra reason.
   *
   * It carries no payload: the sweep asks the envelope rows which ones
   * are still out, and those rows are the only input it has ever had.
   * It is a queue rather than a timer in the worker because pg-boss
   * holds the clock — and because this one **repeats**. The two boot
   * sweeps ask for work the rows already say is owed, so a second
   * replica finds nothing; this one asks a third party the same
   * question every round, so a second replica doubled the requests
   * against the endpoint DocuSign rate-limits hardest.
   */
  reconciliationSweep: "envelope.reconciliation-sweep",
} as const;

/** What the text-extraction queue carries. */
export interface TextExtractionJob {
  /** The version whose text is owed. Nothing else: every other fact is
   * read live, so a job that waited in the queue while the document was
   * renamed or erased still acts on what is true now. */
  versionId: string;
}

/** What the display-conversion queue carries — the same one fact, for
 * the same reason. */
export interface DisplayConversionJob {
  versionId: string;
}

/** What the executed-copy queue carries: the envelope, and nothing
 * else. Which contract it is on, which document it files against, and
 * whether it is still owed are all read live when the job runs — so a
 * job that waited in the queue acts on what is true now. */
export interface ExecutedCopyFetchJob {
  envelopeId: string;
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

  /**
   * Asks for one version's display rendition to be converted (DOC-004).
   *
   * Resolves and rejects on exactly the terms above, and for the same
   * reason: the rendition row the upload already committed is what makes
   * the work recoverable, so no upload path may fail for a queue that
   * could not be reached.
   */
  requestDisplayConversion(versionId: string): Promise<void>;

  /**
   * Asks for one signed envelope's executed copy to be fetched and
   * filed (CTR-014, M15/5).
   *
   * Asked **after** the `signed` transition has committed, because the
   * transition owns its own transaction and there is no hook inside it.
   * The envelope's `executed_fetch` state is what makes the work
   * durable, so a request the queue refuses is not lost — the boot
   * sweep reads that state and asks again.
   */
  requestExecutedCopyFetch(envelopeId: string): Promise<void>;
}

/**
 * How long a request path waits for the queue to take an ask before it
 * carries on without it. The bound is the point: the queue is an
 * interface, so what is behind it might one day hang rather than
 * refuse, and no write path may be delayed by its pipeline — an upload
 * is owed its 201, and a webhook delivery is owed its 204, whatever the
 * queue is doing.
 */
export const QUEUE_ASK_TIMEOUT_MS = 2000;

/**
 * Waits for one queue ask, but only this long.
 *
 * Throws the ask's own refusal, or a timeout after
 * {@link QUEUE_ASK_TIMEOUT_MS} — the caller logs either and carries on,
 * because the committed rows are the durable record of the work and a
 * boot sweep re-asks from them. The ask itself keeps running
 * unobserved; whichever side loses the race settles later with a
 * handler already attached, so neither becomes an unhandled rejection.
 */
export async function boundedQueueAsk(asked: Promise<void>): Promise<void> {
  asked.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
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
  } finally {
    clearTimeout(timer);
  }
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
  const refuse = () =>
    Promise.reject(
      new Error("No job queue is configured in this process; nothing can be enqueued."),
    );
  return {
    requestTextExtraction: refuse,
    requestDisplayConversion: refuse,
    requestExecutedCopyFetch: refuse,
  };
}
