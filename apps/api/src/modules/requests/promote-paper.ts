// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The paper follows (INT-002, DOC-008, #421): the step of a conversion
 * that turns the files a requester attached into real paper on the
 * record their ask became.
 *
 * A Request is not a document owner (DOC-008), so what travels with an
 * ask is a `request_attachments` row and a blob — no version chain, no
 * folder, nothing to edit. Conversion is where that becomes a document,
 * and these are the rules it obeys.
 *
 * **A drop is N ordinary documents** (the M13 batch doctrine). Three
 * attachments become three documents, each at version 1, each filed at
 * the record root, each with its own `document.created` naming where it
 * landed. There is no batch row and no batch event, because a batch is
 * not a thing a record holds — files are.
 *
 * **Promotion copies and never takes away.** The `request_attachments`
 * rows and their blobs stay exactly where they are, so the requester's
 * portal detail goes on listing and downloading the paper they
 * submitted after the conversion, unchanged. The Request survives as
 * their window (INT-002); paper it could no longer open would be a
 * window onto nothing.
 *
 * **The bytes are copied through the storage seam to a key minted from
 * the new ids** (DOC-012). Never a moved blob — the attachment's key
 * belongs to the attachment — and never a key minted from a filename,
 * so no name a person chose can shape where the bytes live. The copy is
 * one pass: the bytes are hashed, counted, and read for their head on
 * their way to the driver, exactly as an upload meters a file.
 *
 * **The facts a document needs are read off the blob** (the INT-002
 * M20/6 addendum). An attachment declares no media type, no byte count,
 * and no checksum, because nothing on that side of conversion reads
 * one. So all three come from the bytes themselves: the count and the
 * SHA-256 from the pass, and the media type from the head
 * (`lib/media-type.ts`). Nothing here trusts a claim, because there is
 * no claim to trust.
 *
 * **The promoted rounds are ordinary rounds.** They go on the one
 * version write path (`lib/document-versions.ts`), so the pipeline is
 * owed a text extraction or a display rendition on exactly the terms an
 * uploaded file is owed one, and the ask happens after the transaction
 * commits like every other. A promoted version owes nothing to its
 * origin and is owed nothing for it.
 *
 * **The first document on a record is the instrument** (CTR-014). The
 * upload route's rule is mechanical — whatever lands first takes the
 * designation, and it is movable afterwards — and a promotion is not
 * the place to make an exception to it. A conversion that left the
 * designation empty would hand it instead to whatever somebody uploaded
 * by hand next, which is a worse answer and a stranger one.
 *
 * **The kind is `draft_ours`.** A requester is one of our own people, so
 * their paper is our side's (CTR-014) — and it is the same default the
 * upload route applies to a file that names no kind.
 *
 * **Zero attachments promotes nothing and says nothing.** No document,
 * no entry, no event. A Request that carried no paper is a complete
 * Request (INT-002), and narrating an empty promotion would put a
 * sentence on the record about something that did not happen.
 *
 * **A conversion that does not commit leaves no blobs behind** (DOC-012,
 * the upload path's rule). The bytes reach the driver before the rows
 * exist and a transaction can still refuse afterwards, so
 * {@link withPromotedPaper} remembers every key it **minted** — before
 * the driver is asked for it, so a write that rejects over an object the
 * store kept is still a key the cleanup can reach — and takes them away
 * when its caller's act does not commit. The keys are never written
 * again: a retry mints its own.
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { asc, contracts, documents, eq, requestAttachments } from "@openlaw/db";
import { uuidv7 } from "uuidv7";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import {
  insertDocumentVersion,
  requestDerivations,
  versionStorageKey,
  type QueueLogger,
} from "../../lib/document-versions.js";
import { mediaTypeOfBlob, MEDIA_TYPE_HEAD_BYTES } from "../../lib/media-type.js";
import type { Notifier, NotifyingTransaction } from "../../lib/notifications/notifier.js";
import { formatBlobRef, type StorageAdapter } from "../../lib/storage/adapter.js";
import type { CleanupLogger } from "../../lib/uploads.js";
import type { JobQueue } from "../../pipeline/jobs.js";

/** The record one promotion files onto, as this write needs it
 * described: the newborn contract, and whether anything holds its
 * instrument designation yet (CTR-014). */
export interface PromotionTarget {
  contractId: string;
  primaryDocumentId: string | null;
}

/** One promotion, as the caller of {@link withPromotedPaper} describes
 * it. */
export interface PromotionInput {
  /** The ask whose attachments are being promoted. */
  requestId: string;
  target: PromotionTarget;
  /** The triager converting. Every row this write leaves is recorded
   * against them: they are the nearest human act behind the file on
   * this record, exactly as the envelope's sender is behind an executed
   * copy. */
  actorId: string;
  actorName: string;
}

/** What one promoted round is owed after the commit. */
interface PromotedVersion {
  versionId: string;
  mimeType: string;
  originalFilename: string;
}

/** Everything one promotion wrote, kept so the two things that happen
 * after it — the cleanup on a refusal, the derivations on a commit —
 * have something to work from. */
interface PromotedPaper {
  /** Every blob key minted, in the order it was minted — recorded
   * before the driver is asked for it, so a rejected write still leaves
   * a key the cleanup can reach. */
  blobs: string[];
  /** Every round appended. */
  versions: PromotedVersion[];
}

/** What a promotion is run against. */
export interface PromotionDeps {
  storage: StorageAdapter;
  /** The notification seam (NOT-001), for the one event a promoted
   * document raises. */
  notifier: Notifier;
  jobs: JobQueue;
  log: CleanupLogger & QueueLogger;
}

/**
 * Promotes one Request's attachments onto the record, inside the
 * caller's transaction.
 *
 * Handed to {@link withPromotedPaper}'s callback rather than exported,
 * so there is no way to run a promotion without the cleanup and the
 * derivations that belong to it.
 */
export type PromotePaper = (tx: NotifyingTransaction, input: PromotionInput) => Promise<void>;

/**
 * Runs an act that may promote paper, and owns the two things that
 * happen around it.
 *
 * **Before the commit**: nothing. The promotion is a write inside
 * `run`'s own transaction, so it rolls back with everything else that
 * act wrote — no contract, no documents, no half-converted Request.
 *
 * **When `run` refuses**: every blob the promotion had already written
 * is removed (DOC-012). The bytes reach the driver before the rows
 * exist, so a refusal after that point would otherwise leave one orphan
 * per file copied. A cleanup that itself fails is logged and swallowed:
 * the caller is owed the reason their conversion was refused, and a
 * failed cleanup is an operational fact rather than an answer to them.
 *
 * **When `run` commits**: each promoted round is asked for its
 * derivations (DOC-004, DOC-005), after the transaction rather than
 * inside it — the upload path's rule, for the upload path's reason. A
 * queue that cannot be reached never fails the conversion; the `pending`
 * rows are already committed and M12/6's sweep is what picks them up.
 */
export async function withPromotedPaper<T>(
  deps: PromotionDeps,
  run: (promote: PromotePaper) => Promise<T>,
): Promise<T> {
  const paper: PromotedPaper = { blobs: [], versions: [] };
  let answer: T;
  try {
    answer = await run((tx, input) => promotePaper(deps, tx, input, paper));
  } catch (error) {
    for (const fileRef of paper.blobs) {
      await deps.storage.delete(fileRef).catch((cleanup: unknown) => {
        deps.log.warn(
          { err: cleanup, fileRef },
          "could not remove the blob of a promotion that did not commit",
        );
      });
    }
    throw error;
  }
  for (const version of paper.versions) {
    await requestDerivations(deps.jobs, deps.log, version);
  }
  return answer;
}

/**
 * One Request's attachments, promoted onto the record.
 *
 * Read inside the transaction, under the Request's own row lock, which
 * the disposition already holds: the paper this conversion promotes has
 * to be the paper the Request held when it was held.
 */
async function promotePaper(
  deps: PromotionDeps,
  tx: NotifyingTransaction,
  input: PromotionInput,
  paper: PromotedPaper,
): Promise<void> {
  const attachments = await tx
    .select({
      fileRef: requestAttachments.fileRef,
      filename: requestAttachments.filename,
    })
    .from(requestAttachments)
    .where(eq(requestAttachments.requestId, input.requestId))
    // Oldest first — the order the requester picked the files in, which
    // is the order the portal lists them in and therefore the order the
    // record reads them in. It also decides which one takes the
    // instrument designation, so it has to be an order rather than
    // whatever the planner returns.
    .orderBy(asc(requestAttachments.createdAt), asc(requestAttachments.id));

  let primaryDocumentId = input.target.primaryDocumentId;
  for (const attachment of attachments) {
    // Both ids are minted here, because the storage key is built from
    // them and the blob is written before the rows exist (DOC-012).
    const documentId = uuidv7();
    const versionId = uuidv7();
    const key = versionStorageKey(documentId, versionId);
    // Remembered **before** the driver is asked, never after it answers.
    // A put that rejects is not always a put that wrote nothing: the S3
    // driver's conditional-conflict arm refuses over an object the store
    // kept, and any driver can lose its answer once the bytes have
    // landed. A key nobody remembered is a key {@link withPromotedPaper}
    // cannot take away, which is the one thing this module promises.
    // Recording it first costs nothing, because deleting a key that was
    // never written is a no-op the storage contract guarantees.
    paper.blobs.push(formatBlobRef(deps.storage.driver, key));
    const copied = await copyBlob(deps.storage, attachment.fileRef, {
      key,
      filename: attachment.filename,
    });

    await tx.insert(documents).values({
      id: documentId,
      // The record root (DOC-011). A Request has no folders to carry, so
      // there is no destination to translate and nothing to guess at.
      folderId: null,
      // Seeded from the filename, as an upload's is: the record has to
      // be called something, and what a reader recognises is the name
      // the file arrived under. Renameable from there (DOC-007).
      title: attachment.filename,
      contractId: input.target.contractId,
      createdBy: input.actorId,
    });
    await insertDocumentVersion(tx, {
      documentId,
      versionId,
      versionNumber: 1,
      fileRef: copied.fileRef,
      kind: "draft_ours",
      // A version note is what somebody wrote about a round. Nobody
      // wrote one here, and inventing a sentence about the conversion
      // would put words on the chain that no person chose.
      note: null,
      originalFilename: attachment.filename,
      mimeType: copied.mimeType,
      byteSize: copied.byteSize,
      checksumSha256: copied.checksumSha256,
      createdBy: input.actorId,
    });
    // One entry per file, naming its destination (DD-017, the M13 batch
    // doctrine) — the same entry an upload writes, with the same
    // payload, so the record's feed reads one way whatever put the paper
    // there. `folderName` is null because the record root is where every
    // promotion files.
    await recordActivity(tx, {
      entityType: "contract",
      entityId: input.target.contractId,
      actorId: input.actorId,
      action: "document.created",
      visibility: RECORD_ACTIVITY_TIER,
      payload: {
        documentId,
        versionId,
        title: attachment.filename,
        folderName: null,
      },
    });

    // CTR-014's designation, taken by whatever lands first — the upload
    // route's rule, applied where the first thing to land is a
    // promotion. A record born by conversion is an ordinary record, and
    // an ordinary record's first document is its instrument.
    if (primaryDocumentId === null) {
      primaryDocumentId = documentId;
      await tx
        .update(contracts)
        .set({ primaryDocumentId: documentId })
        .where(eq(contracts.id, input.target.contractId));
      await recordActivity(tx, {
        entityType: "contract",
        entityId: input.target.contractId,
        actorId: input.actorId,
        action: "document.primary_set",
        visibility: RECORD_ACTIVITY_TIER,
        // The upload route's payload, so the M9 viewer narrates the two
        // moves with one helper. The first file takes the designation
        // from nobody.
        payload: {
          documentId,
          title: attachment.filename,
          fromDocumentId: null,
          from: null,
          to: attachment.filename,
        },
      });
    }

    // The record's people hear that paper landed (NOT-002 group 2). At
    // a conversion that audience is the record's roster, which is the
    // triager who is converting and nobody else — and group 2 excludes
    // the actor, so this raises no rows today. It is raised anyway,
    // because the rule belongs to the event rather than to what a
    // newborn record's team happens to hold. The flag is the
    // *document's* own (DOC-008), not the record's: this write just
    // made the row, and a document is born with the flag clear — the
    // upload route says the same thing about the same insert.
    await deps.notifier.documentAdded(tx, {
      contractId: input.target.contractId,
      actorId: input.actorId,
      actorName: input.actorName,
      documentId,
      documentTitle: attachment.filename,
      isConfidential: false,
    });

    paper.versions.push({
      versionId,
      mimeType: copied.mimeType,
      originalFilename: attachment.filename,
    });
  }
}

/** One copied blob, as the rows that follow it need it described. */
interface CopiedBlob {
  fileRef: string;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
}

/**
 * Copies one stored blob to a new key, reading its facts on the way
 * past.
 *
 * One pass, nothing held whole in memory: the bytes are hashed, counted,
 * and their head kept as they stream from the source reference to the
 * new key. The source is destroyed whatever happens, for the reason the
 * pipeline's own fetch gives — a store that refuses part way through
 * would otherwise leave a handle open.
 */
async function copyBlob(
  storage: StorageAdapter,
  from: string,
  to: Readonly<{ key: string; filename: string }>,
): Promise<CopiedBlob> {
  const source = await storage.get(from);
  const digest = createHash("sha256");
  let byteSize = 0;
  const head: Buffer[] = [];
  let headBytes = 0;
  async function* metered(stream: AsyncIterable<Buffer>) {
    for await (const chunk of stream) {
      digest.update(chunk);
      byteSize += chunk.length;
      if (headBytes < MEDIA_TYPE_HEAD_BYTES) {
        const wanted = chunk.subarray(0, MEDIA_TYPE_HEAD_BYTES - headBytes);
        head.push(wanted);
        headBytes += wanted.length;
      }
      yield chunk;
    }
  }
  try {
    const fileRef = await storage.put(to.key, Readable.from(metered(source)));
    return {
      fileRef,
      mimeType: mediaTypeOfBlob(Buffer.concat(head), to.filename),
      byteSize,
      checksumSha256: digest.digest("hex"),
    };
  } finally {
    source.destroy();
  }
}
