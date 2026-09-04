// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The executed copy, filed and pinned (M15/5, CTR-013, CTR-014).
 *
 * This is the second half of the milestone's sentence. Somebody signs
 * on the provider's ceremony, the `signed` transition commits, and this
 * job brings the signed PDF back: it appends the file to the primary
 * document's chain as a new round of kind `executed`, sets the executed
 * pin on it, narrates both, and — when the record is still at the
 * signature stage — advances the contract's status to active. Nobody
 * downloads anything, and nobody remembers four manual steps.
 *
 * Five rules shape it.
 *
 * **The pin is set explicitly, never inferred from the kind.** The
 * documents schema says why in its own words: a chain can hold two
 * rounds both called `executed`, and the pin names one of them. So the
 * kind is what the round *is* and the pin is a separate write, exactly
 * as the by-hand pin route has done since M11.
 *
 * **The round is appended through the one version write path.** It is
 * `lib/document-versions.ts`, shared with the upload route, under the
 * owning contract's row lock — so the number is assigned the same way,
 * the chain stays 1..n with no gaps, and the pipeline is owed the same
 * derivations as for a file a person uploaded.
 *
 * **The status advance is conditional, and it never regresses.** From
 * the signature stage the contract moves to the first live status by
 * display order that maps to `active` (CTR-001's stages, CTR-013's
 * promise), narrated as its own entry with **no actor** — the
 * integration speaking, not a person. From any other stage the paper
 * still files, the pin is still set, the completion is still narrated,
 * and the status is left exactly where it is: the integration never
 * drags a draft forward and never pulls a finished record back. The
 * move starts at `signature`, which is already past `approval`, so it
 * cannot cross CTR-012's soft gate — `crossesApprovalGate` answers
 * false for it, and there is nothing here to override.
 *
 * **Failure follows the M12 derived-artifact pattern.** The envelope's
 * `executed_fetch` runs `pending | ready | failed`; a terminal failure
 * is recorded on it and never retried; a transient one is retried until
 * the queue's bound runs out and then recorded the same way. The record
 * then says plainly that the copy did not land, and the manual
 * hand-off — upload the PDF, pin it — is the answer, exactly as it is
 * for an install with no connector at all.
 *
 * **A lost job is recovered at boot.** {@link runExecutedCopySweep} is
 * M12/6's sweep for these rows: every signed envelope still `pending`
 * is asked for again. That is what makes the enqueue after the
 * transition allowed to fail quietly — the row is the record of the
 * work owed, and the queue send only wakes a worker.
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
  and,
  asc,
  contractEnvelopes,
  contracts,
  contractStatuses,
  documents,
  documentVersions,
  eq,
  gt,
  isNull,
  type Db,
} from "@openlaw/db";
import { uuidv7 } from "uuidv7";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../lib/activity.js";
import {
  insertDocumentVersion,
  nextVersionNumber,
  requestDerivations,
  versionStorageKey,
} from "../lib/document-versions.js";
import type { Notifier, NotifyingTransaction } from "../lib/notifications/notifier.js";
import { isTerminalSigningError, SigningConfigError } from "../lib/signing/provider.js";
import type { SigningResolver } from "../lib/signing/resolver.js";
import type { StorageAdapter } from "../lib/storage/adapter.js";
import { DEFAULT_MAX_UPLOAD_MB, MEGABYTE } from "../lib/uploads.js";
import { isTerminalFailure, reasonOf } from "./derivations.js";
import type { JobQueue } from "./jobs.js";
import type { PipelineLogger } from "./logger.js";

/** What the executed-copy job is built from. The doc engine is not part
 * of it: nothing here converts or reads anything — the provider answers
 * a finished PDF, and the job files it. */
export interface ExecutedCopyDeps {
  db: Db;
  /**
   * The notification seam (NOT-001), which owns the transaction this
   * job files in.
   *
   * Filing an executed copy is two things the record's people are owed
   * (NOT-002 group 2): a new round landed on the chain, and the record
   * moved off the signature stage. Both are raised **with no actor** —
   * the integration filed the paper, and there is no person to leave
   * out.
   */
  notifier: Notifier;
  storage: StorageAdapter;
  log: PipelineLogger;
  /** The connector, read live per call (CTR-013's mailer-resolver
   * pattern), so a key an Administrator rotated a second ago is the key
   * this fetch uses. */
  resolveSigningProvider: SigningResolver;
  /** Where the appended round's own derivations are asked for, after
   * this job's transaction commits. */
  jobs: JobQueue;
  /** The executed-pin trigger. This normally skips here because the
   * appended Version's text starts pending; its derivation calls the
   * same scheduler again when that text becomes ready. */
  onExecutedVersionPinned?: (versionId: string) => Promise<void>;
  /**
   * The biggest executed copy this install will file, in bytes.
   *
   * The same ceiling the upload route enforces, asked here for the same
   * reason: a file arriving over the network goes to the store a chunk
   * at a time, and a stream nobody is counting fills a self-hoster's
   * disk. The provider is a third party, so its answer is no more
   * trusted than a person's upload — and the download runs on the
   * worker, where nobody is watching it happen.
   *
   * Optional, defaulting to the same `MAX_UPLOAD_MB` default: a process
   * that does not set it gets a working ceiling rather than none.
   */
  maxUploadBytes?: number;
}

/** One executed-copy job, as the retry policy needs it described —
 * pg-boss's own counters, the shape the M12 handlers take. */
export interface ExecutedCopyAttempt {
  envelopeId: string;
  retryCount: number;
  retryLimit: number;
}

/**
 * The record cannot take this envelope's executed copy, and no retry
 * will change that.
 *
 * It is the job's own terminal failure, beside the provider's: an
 * envelope whose contract has no chain to file against — every document
 * on the record lawfully erased (DOC-010) — is unfilable, and asking
 * the provider for the same PDF again would only produce the same
 * nowhere to put it.
 */
export class ExecutedCopyUnfilableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutedCopyUnfilableError";
  }
}

/**
 * Whether a failure is settled or worth another try.
 *
 * The M12 decision, widened by the signing seam's own split. The
 * provider's terminal errors are terminal here — refused credentials, a
 * refused request, an envelope it does not hold, a delivery that does
 * not verify — because a retry sends the same credentials and asks the
 * same question. Everything else is the moment's: an unreachable
 * provider, a timeout, a database blip, and any error nobody has
 * classified yet.
 *
 * Unknown errors count as transient for M12's reason: retrying
 * something permanent wastes a few attempts and then records the
 * failure anyway, while giving up on something temporary loses the
 * executed copy until somebody notices.
 */
export function isTerminalFetchFailure(error: unknown): boolean {
  if (error instanceof ExecutedCopyUnfilableError) return true;
  if (isTerminalSigningError(error)) return true;
  // The storage failures M12 already calls settled — a blob reference
  // that will not parse, bytes that are not there — plus the doc
  // engine's, which cannot arise here and cost nothing to name once.
  return isTerminalFailure(error);
}

/** The stage the advance runs from (CTR-001). Any other stage means
 * somebody has already moved the record, or never got it here. */
const SIGNATURE_STAGE = "signature";

/** The stage the advance runs to (CTR-001, CTR-013). */
const ACTIVE_STAGE = "active";

/** What the executed copy is called on the chain. The signers saw a
 * file name; what comes back is the same paper, signed, so the name
 * says that rather than inventing one. */
export function executedCopyFilename(sentFilename: string | null): string {
  const stem = (sentFilename ?? "contract").replace(/\.[^./\\]+$/, "").trim();
  return `${stem.length > 0 ? stem : "contract"} (executed).pdf`;
}

/** One envelope, as this job needs it described. */
interface OwedFetch {
  envelopeId: string;
  contractId: string;
  provider: string;
  providerEnvelopeId: string;
  sentBy: string;
  /** The chain the send left from, or NULL once that round has been
   * erased (DOC-010). */
  sentVersionId: string | null;
  sentFilename: string | null;
  sentDocumentId: string | null;
  /** CTR-014's instrument, the fallback when the sent round is gone. */
  primaryDocumentId: string | null;
}

/**
 * The envelope this job is about, or `null` when there is nothing owed.
 *
 * Absent, not signed, and already settled are all the same answer to
 * the caller: this job has no work. A replayed delivery, a second
 * worker, and the boot sweep racing a live enqueue all land here.
 */
async function owedFetch(deps: ExecutedCopyDeps, envelopeId: string): Promise<OwedFetch | null> {
  const [row] = await deps.db
    .select({
      envelopeId: contractEnvelopes.id,
      contractId: contractEnvelopes.contractId,
      provider: contractEnvelopes.provider,
      providerEnvelopeId: contractEnvelopes.providerEnvelopeId,
      status: contractEnvelopes.status,
      executedFetch: contractEnvelopes.executedFetch,
      sentBy: contractEnvelopes.sentBy,
      sentVersionId: contractEnvelopes.documentVersionId,
      sentFilename: documentVersions.originalFilename,
      sentDocumentId: documentVersions.documentId,
      primaryDocumentId: contracts.primaryDocumentId,
    })
    .from(contractEnvelopes)
    .innerJoin(contracts, eq(contractEnvelopes.contractId, contracts.id))
    // Left: the round that went out is set to NULL when it is erased,
    // and an inner join would then hide the envelope from its own job.
    .leftJoin(documentVersions, eq(contractEnvelopes.documentVersionId, documentVersions.id))
    .where(eq(contractEnvelopes.id, envelopeId))
    .limit(1);
  if (!row) return null;
  if (row.status !== "signed" || row.executedFetch !== "pending") return null;
  return row;
}

/**
 * Downloads one envelope's executed PDF and files it on the record.
 *
 * Throws whatever failed, classified by the caller. Returns quietly
 * when there was nothing owed.
 */
export async function fileExecutedCopy(deps: ExecutedCopyDeps, envelopeId: string): Promise<void> {
  const owed = await owedFetch(deps, envelopeId);
  if (!owed) return;

  // The chain the send left from is where the executed copy belongs
  // (CTR-013): the paper that went out and the paper that came back are
  // two rounds of one negotiation. The record's instrument is the
  // fallback for the one case that can take the first answer away — the
  // sent round lawfully erased (DOC-010) — because the record still
  // wants its signed copy, and CTR-014 already names the instrument.
  const documentId = owed.sentDocumentId ?? owed.primaryDocumentId;
  if (!documentId) {
    throw new ExecutedCopyUnfilableError(
      "This contract has no document chain to file an executed copy on.",
    );
  }

  const signing = await deps.resolveSigningProvider();
  if (!signing) {
    // Settled rather than retried: an install with no connector row
    // resolves to nothing every time, and the record saying the copy
    // did not land is what sends somebody to the manual hand-off.
    throw new SigningConfigError(
      "This install has no signing connector, so no executed copy can be fetched.",
    );
  }
  if (signing.provider !== owed.provider) {
    throw new SigningConfigError(
      `This envelope was sent through ${owed.provider}, and the configured connector is ` +
        `${signing.provider}.`,
    );
  }

  const versionId = uuidv7();
  const filename = executedCopyFilename(owed.sentFilename);
  const stored = await storeExecutedCopy(deps, {
    providerEnvelopeId: owed.providerEnvelopeId,
    documentId,
    versionId,
    fetch: () => signing.fetchExecutedDocument(owed.providerEnvelopeId),
  });

  // Whether the bytes ended up on a row. Every path that leaves without
  // writing one — a record that went, a copy another worker already
  // filed, a transaction that raised — has to take the blob away with
  // it (DOC-012), and this is what tells them apart from the path that
  // kept it.
  let filed = false;
  try {
    await deps.notifier.notifying(async (tx) => {
      // The owning contract's row, held for everything below it. It is
      // the lock the version number is assigned under — the upload
      // path's lock, so an upload and this job racing on one chain take
      // consecutive numbers rather than colliding — and it is what
      // makes the status advance a decision rather than a guess.
      const [contract] = await tx
        .select({
          id: contracts.id,
          number: contracts.number,
          title: contracts.title,
          statusId: contracts.statusId,
        })
        .from(contracts)
        .where(eq(contracts.id, owed.contractId))
        .limit(1)
        .for("update");
      if (!contract) return;

      // Read again under the lock, because "still owed" is what this
      // job is allowed to act on. Two workers holding the same job, or
      // a boot sweep racing a live enqueue, meet here and the second
      // one leaves without writing a second round.
      const [envelope] = await tx
        .select({ executedFetch: contractEnvelopes.executedFetch })
        .from(contractEnvelopes)
        .where(eq(contractEnvelopes.id, owed.envelopeId))
        .limit(1);
      if (envelope?.executedFetch !== "pending") return;

      const [document] = await tx
        .select({ title: documents.title, isConfidential: documents.isConfidential })
        .from(documents)
        .where(and(eq(documents.id, documentId), eq(documents.contractId, owed.contractId)))
        .limit(1);
      if (!document) {
        throw new ExecutedCopyUnfilableError(
          "The document this envelope was sent from is no longer on the record.",
        );
      }

      const versionNumber = await nextVersionNumber(tx, documentId);
      await insertDocumentVersion(tx, {
        documentId,
        versionId,
        versionNumber,
        fileRef: stored.fileRef,
        // What the round **is** (CTR-014). The pin below is a separate
        // write, and this value is never read as one.
        kind: "executed",
        source: "uploaded",
        comparedFromVersionId: null,
        comparedToVersionId: null,
        note: null,
        originalFilename: filename,
        // The provider answers a PDF. Declared rather than sniffed, as
        // everywhere else: it is a rendering hint (DOC-004).
        mimeType: "application/pdf",
        byteSize: stored.byteSize,
        checksumSha256: stored.checksumSha256,
        // The integration holds no account. The nearest human act
        // behind this file is the send, so the round is recorded
        // against the person who sent the envelope.
        createdBy: owed.sentBy,
      });
      // CTR-014's pin, set **explicitly** on the version this round
      // filed — never read off the kind above it. The same write bumps
      // `updated_at`, so "when did this document last change" answers
      // with the round that just landed.
      await tx
        .update(documents)
        .set({ executedVersionId: versionId, updatedAt: new Date() })
        .where(eq(documents.id, documentId));
      // And the envelope keeps its own answer to "which file did **I**
      // produce" — the row draws it, and the pin can be moved by hand
      // afterwards without the row starting to draw somebody else's.
      await tx
        .update(contractEnvelopes)
        .set({ executedFetch: "ready", executedVersionId: versionId })
        .where(eq(contractEnvelopes.id, owed.envelopeId));

      // Two entries, because two things happened, and both with no
      // actor: an entry with no actor is how the feed says the
      // integration spoke rather than a person (DD-017).
      await recordActivity(tx, {
        entityType: "contract",
        entityId: owed.contractId,
        action: "document.version_added",
        visibility: RECORD_ACTIVITY_TIER,
        payload: {
          documentId,
          versionId,
          title: document.title,
          versionNumber,
          kind: "executed",
        },
      });
      await recordActivity(tx, {
        entityType: "contract",
        entityId: owed.contractId,
        action: "document.executed_set",
        visibility: RECORD_ACTIVITY_TIER,
        payload: { documentId, title: document.title, versionId, versionNumber },
      });

      // Two events beside the two entries, and both actorless: the
      // whole team hears that the signed copy landed, and nobody is
      // excluded because nobody did it (CTR-013). The document's own
      // flag rides along, so a round filed onto a confidential document
      // goes exactly as far as that document does (DOC-008).
      await deps.notifier.documentVersionAdded(tx, {
        contractId: owed.contractId,
        actorId: null,
        actorName: null,
        documentId,
        documentTitle: document.title,
        isConfidential: document.isConfidential,
        versionId,
        versionNumber,
      });

      filed = true;
      await advanceFromSignature(deps.notifier, tx, contract);
    });
  } catch (error) {
    await discardStoredCopy(deps, owed.envelopeId, stored.fileRef);
    throw error;
  }
  // The transaction committed without writing a round: the record went,
  // or somebody else's job filed the copy first. The bytes are then an
  // orphan nothing will ever point at.
  if (!filed) {
    await discardStoredCopy(deps, owed.envelopeId, stored.fileRef);
    return;
  }

  deps.log.info(
    { envelopeId: owed.envelopeId, documentId, versionId, bytes: stored.byteSize },
    "filed an envelope's executed copy and pinned it",
  );
  // After the commit, never inside it — the transaction is closed, and
  // a queue that cannot be reached must not undo a round that is
  // already on the record. The `pending` derivation rows this append
  // committed are what M12/6's sweep reads.
  await requestDerivations(deps.jobs, deps.log, {
    versionId,
    mimeType: "application/pdf",
    originalFilename: filename,
  });
  // Analysis is not durable until its run row exists. It must not starve
  // the derivation requests above if an injected callback misbehaves.
  try {
    await deps.onExecutedVersionPinned?.(versionId);
  } catch (error) {
    deps.log.warn(
      { envelopeId: owed.envelopeId, versionId, reason: reasonOf(error) },
      "could not request automatic analysis for a filed executed copy",
    );
  }
}

/**
 * Takes away an executed copy no row points at (DOC-012).
 *
 * The bytes reach the driver before the rows exist, so every path that
 * ends without a version row leaves a blob behind. A failed delete is
 * logged and swallowed: a caller waiting on a failure is owed the
 * original one, not a cleanup's, and an orphan blob is an operational
 * fact rather than an answer.
 */
async function discardStoredCopy(
  deps: ExecutedCopyDeps,
  envelopeId: string,
  fileRef: string,
): Promise<void> {
  await deps.storage.delete(fileRef).catch((error: unknown) => {
    deps.log.warn(
      { envelopeId, fileRef, reason: reasonOf(error) },
      "could not remove an executed copy that was never filed",
    );
  });
}

/**
 * CTR-013's status advance, taken only from the signature stage.
 *
 * Called under the contract's row lock, so the stage it reads is the
 * stage the UPDATE writes against. It does nothing at all from any
 * other stage — the completion is already filed, pinned, and narrated
 * by the time this runs, and leaving the status alone is the whole
 * decision: the integration never drags a draft forward and never pulls
 * a finished record back.
 *
 * It also does nothing when no live status maps to `active`. Every
 * stage keeps at least one unarchived status by the settings pane's own
 * guardrail, so this is the belt to that braces; a record left at
 * signature is a better answer than a status id nobody could pick.
 */
async function advanceFromSignature(
  notifier: Notifier,
  tx: NotifyingTransaction,
  contract: Readonly<{ id: string; number: number; title: string; statusId: string }>,
): Promise<void> {
  const [current] = await tx
    .select({ displayName: contractStatuses.displayName, stage: contractStatuses.stage })
    .from(contractStatuses)
    .where(eq(contractStatuses.id, contract.statusId))
    .limit(1);
  if (current?.stage !== SIGNATURE_STAGE) return;

  // The first live status by display order that maps to `active`. The
  // order is the settings pane's own, so the status a team put first is
  // the one the integration picks — this reads the record's
  // configuration rather than a slug it was built knowing.
  const [target] = await tx
    .select({ id: contractStatuses.id, displayName: contractStatuses.displayName })
    .from(contractStatuses)
    .where(and(eq(contractStatuses.stage, ACTIVE_STAGE), isNull(contractStatuses.archivedAt)))
    .orderBy(asc(contractStatuses.displayOrder), asc(contractStatuses.createdAt))
    .limit(1);
  if (!target) return;

  await tx.update(contracts).set({ statusId: target.id }).where(eq(contracts.id, contract.id));
  // CTR-012's soft gate is not asked, and it is not an omission: it
  // fires on a move from at-or-before `approval` to after it, and this
  // move starts at `signature`, which is already past the line. There
  // is nothing here for an override to record.
  await recordActivity(tx, {
    entityType: "contract",
    entityId: contract.id,
    // No actor: the integration advanced the record, not a person.
    action: "contract.status_changed",
    visibility: RECORD_ACTIVITY_TIER,
    payload: {
      number: contract.number,
      title: contract.title,
      from: current.displayName,
      to: target.displayName,
      fromStage: SIGNATURE_STAGE,
      toStage: ACTIVE_STAGE,
    },
  });
  // And the record's people hear that it moved (NOT-002 group 2), with
  // no actor for the entry's reason: the integration advanced it.
  await notifier.statusChanged(tx, {
    contractId: contract.id,
    actorId: null,
    actorName: null,
    from: current.displayName,
    to: target.displayName,
    fromStage: SIGNATURE_STAGE,
    toStage: ACTIVE_STAGE,
  });
}

/** One stored executed copy, as the write that follows it needs it
 * described. */
interface StoredExecutedCopy {
  fileRef: string;
  byteSize: number;
  checksumSha256: string;
}

/**
 * Opens the provider's executed PDF and stores it, hashing and counting
 * on the same pass.
 *
 * The stream is destroyed whatever happens, for the reason `withBlob`
 * gives: a store that refuses part way through leaves a socket open,
 * and a pipeline that fails a few times an hour must not leak one each
 * time.
 */
async function storeExecutedCopy(
  deps: ExecutedCopyDeps,
  input: Readonly<{
    providerEnvelopeId: string;
    documentId: string;
    versionId: string;
    fetch: () => Promise<Readable>;
  }>,
): Promise<StoredExecutedCopy> {
  const source = await input.fetch();
  const ceiling = deps.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_MB * MEGABYTE;
  const digest = createHash("sha256");
  let byteSize = 0;
  // The chunks are passed straight through: hashed, counted, and
  // yielded without a copy, exactly as the upload path meters a file on
  // its way to the driver.
  //
  // The count is also the bound. It is checked as the bytes arrive
  // rather than from a `Content-Length` the provider states, because a
  // stated length is a claim and the chunks are the fact. Overflow is
  // terminal, not transient: the same envelope answers the same file
  // next time, so a retry would download the same too-large PDF again
  // and refuse it again at the same byte. The record then says the
  // fetch failed, and the manual hand-off is the answer — the same
  // answer an install with no connector has.
  async function* metered(stream: AsyncIterable<Buffer>) {
    for await (const chunk of stream) {
      byteSize += chunk.length;
      if (byteSize > ceiling) {
        throw new ExecutedCopyUnfilableError(
          `The executed copy is larger than this install accepts (${String(ceiling)} bytes).`,
        );
      }
      digest.update(chunk);
      yield chunk;
    }
  }
  try {
    const fileRef = await deps.storage.put(
      versionStorageKey(input.documentId, input.versionId),
      Readable.from(metered(source)),
    );
    return { fileRef, byteSize, checksumSha256: digest.digest("hex") };
  } finally {
    source.destroy();
  }
}

/**
 * Records that this envelope's executed copy will not be coming.
 *
 * The M12 shape: the state on the row is the whole record of the
 * outcome, there is no reason column beside it, and the operator's log
 * carries the sentence. Guarded on `pending` so a fetch that succeeded
 * between the failure and this write is not undone.
 */
async function recordFetchFailure(deps: ExecutedCopyDeps, envelopeId: string): Promise<void> {
  await deps.db
    .update(contractEnvelopes)
    .set({ executedFetch: "failed" })
    .where(
      and(eq(contractEnvelopes.id, envelopeId), eq(contractEnvelopes.executedFetch, "pending")),
    );
}

/**
 * Runs one executed-copy job and decides what its failure means.
 *
 * Returning means the job is done with — either the copy is on the
 * record or the envelope says the fetch failed and no retry would
 * change that. Throwing hands the job back to pg-boss, which retries it
 * until its bound runs out.
 */
export async function handleExecutedCopyFetch(
  deps: ExecutedCopyDeps,
  attempt: ExecutedCopyAttempt,
): Promise<void> {
  try {
    await fileExecutedCopy(deps, attempt.envelopeId);
  } catch (error) {
    const terminal = isTerminalFetchFailure(error);
    const exhausted = attempt.retryCount >= attempt.retryLimit;
    if (terminal || exhausted) {
      await recordFetchFailure(deps, attempt.envelopeId);
      deps.log.error(
        {
          envelopeId: attempt.envelopeId,
          terminal,
          attempts: attempt.retryCount + 1,
          reason: reasonOf(error),
        },
        "fetching an envelope's executed copy failed",
      );
    }
    // A terminal failure is settled: the row says so, and handing the
    // job back would only ask the provider the same question again.
    if (!terminal) throw error;
  }
}

/**
 * How many envelopes the sweep reads at a time.
 *
 * Smaller than the derivation sweep's page, because the set is smaller
 * by nature: it is the signed envelopes whose copy has not landed, not
 * every version an install holds.
 */
export const EXECUTED_COPY_SWEEP_PAGE_SIZE = 100;

/** How many requests in a row may be refused before the sweep gives up
 * on the queue. The backfill sweep's bound, for its reason: a queue
 * refusing several in a row is down, not busy, and the recovery is free
 * because every row still says what is owed. */
export const EXECUTED_COPY_SWEEP_REFUSAL_LIMIT = 5;

/** What the sweep needs: the rows, and somewhere to say what it did. */
export interface ExecutedCopySweepDeps {
  db: Db;
  log: PipelineLogger;
}

/** What a caller may vary about one sweep. */
export interface ExecutedCopySweepOptions {
  /** Envelopes read at a time. Defaults to
   * {@link EXECUTED_COPY_SWEEP_PAGE_SIZE}. */
  pageSize?: number;
  /** Stops the sweep between pages and between envelopes, so a
   * container being shut down is not held open by it. Whatever it did
   * not reach is picked up by the next boot. */
  signal?: AbortSignal;
}

/** What one sweep did, for the operator's log. */
export interface ExecutedCopySweepSummary {
  /** Envelopes looked at — signed, and still owed a copy. */
  scanned: number;
  /** Fetches asked for. */
  requested: number;
  /** Requests the queue refused. The rows still say what is owed, so
   * the next boot asks again. */
  notEnqueued: number;
  /** Whether the sweep was stopped before it reached the end. */
  stopped: boolean;
}

/**
 * Asks for every executed copy this install is still owed (M15/5,
 * M12/6's pattern).
 *
 * A signed envelope still `pending` is a job that was lost: the process
 * died between the transition's commit and the queue send, or the queue
 * was unreachable when the send was tried. The row is the record of the
 * work, so the sweep re-asks from it — and a `failed` row is settled
 * and left alone, exactly as a failed derivation is.
 *
 * Answers what it did rather than throwing: a boot must not fail
 * because one request was refused.
 */
export async function runExecutedCopySweep(
  deps: ExecutedCopySweepDeps,
  jobs: JobQueue,
  options: ExecutedCopySweepOptions = {},
): Promise<ExecutedCopySweepSummary> {
  const pageSize = options.pageSize ?? EXECUTED_COPY_SWEEP_PAGE_SIZE;
  const summary: ExecutedCopySweepSummary = {
    scanned: 0,
    requested: 0,
    notEnqueued: 0,
    stopped: false,
  };
  // Keyset paging on the envelope id, which is a uuidv7 and so sorts by
  // the moment it was minted. An offset would re-read rows as the set
  // changes underneath a long sweep.
  let after: string | undefined;
  let reported = false;
  let refusals = 0;

  for (;;) {
    if (options.signal?.aborted) {
      summary.stopped = true;
      return summary;
    }
    const page = await deps.db
      .select({ id: contractEnvelopes.id })
      .from(contractEnvelopes)
      .where(
        and(
          eq(contractEnvelopes.status, "signed"),
          eq(contractEnvelopes.executedFetch, "pending"),
          after === undefined ? undefined : gt(contractEnvelopes.id, after),
        ),
      )
      .orderBy(asc(contractEnvelopes.id))
      .limit(pageSize);
    if (page.length === 0) return summary;

    for (const envelope of page) {
      if (options.signal?.aborted) {
        summary.stopped = true;
        return summary;
      }
      summary.scanned += 1;
      try {
        await jobs.requestExecutedCopyFetch(envelope.id);
        summary.requested += 1;
        refusals = 0;
      } catch (error) {
        summary.notEnqueued += 1;
        refusals += 1;
        if (!reported) {
          reported = true;
          deps.log.warn(
            { envelopeId: envelope.id, reason: reasonOf(error) },
            "the executed-copy sweep could not reach the job queue",
          );
        }
        if (refusals >= EXECUTED_COPY_SWEEP_REFUSAL_LIMIT) {
          summary.stopped = true;
          return summary;
        }
      }
    }

    after = page[page.length - 1]!.id;
    // A short page is the last one.
    if (page.length < pageSize) return summary;
  }
}
