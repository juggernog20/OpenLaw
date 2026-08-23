// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The thread follows the work (CMT-001, DD-017, #422): the step of a
 * conversion that moves the conversation off the ask and onto the
 * record, so legal answers in exactly one place from then on.
 *
 * CMT-001 caught the fork before it was built. A Request is a comment
 * target, and a conversion makes a second record about the same work —
 * leave the rows where they are and the conversation splits between the
 * shell and the record, with legal answering in two places and neither
 * one holding all of it. So the rows move.
 *
 * **The move is one `UPDATE` of the entity pair, and the tier column is
 * not in it.** A Legal Only note stays Legal Only on the record; a Full
 * Thread reply stays Full Thread. That is the whole of "tiers
 * preserved", and it is a property of what the write does not touch
 * rather than of a mapping it applies — a comment's tier is immutable
 * after posting (CMT-005), and re-parenting is not a posting.
 *
 * **The watermarks move with the address, and only where they cannot
 * clobber a real read state** (CMT-009). A `comment_last_read` row says
 * where one reader had got to in one record's conversation. Leaving
 * those rows on the Request's pair after the comments left it would
 * hand every reader an unread count that starts from nothing, and their
 * badge would announce as news what they read yesterday. So each row is
 * re-keyed onto the record's pair — unless that reader already holds one
 * there, in which case theirs is a real place in a real conversation and
 * the Request's stale one must not overwrite it. Then the Request's rows
 * go, because the pair they name is not a comment target any more.
 *
 * It is the **address** rather than the rows they follow, so a Request
 * whose thread was empty still has its watermarks re-keyed. That is one
 * rule instead of two: once the back-link is written, nothing reads a
 * watermark on the Request's pair again, and a row nobody can read is
 * litter whether or not there were comments beside it.
 *
 * **The activity entries stay where they were written.** A
 * `comment.posted` entry on the Request records what somebody did on the
 * Request, and the log is append-only (DD-017) — rewriting the entity
 * of a row already appended is the one thing that table does not do. So
 * the Request's feed goes on saying what was said there, and the move
 * itself is a new entry rather than a correction of the old ones.
 *
 * **The Request keeps nothing and loses nothing else.** It is still the
 * requester's window (INT-002): its values, its paper, and its banner
 * are untouched, and the portal's thread arm now reads the record's
 * conversation through the back-link this same transaction wrote
 * (CMT-001, the `request` audience arm). Nothing here reads a status
 * either — what makes a Request stop being a comment target is the
 * back-link, and the back-link is written by the act that moves these
 * rows.
 *
 * **Nothing is copied and nothing is re-keyed.** The paper is promoted
 * because an attachment and a document are different things (INT-002);
 * a comment on a Request and a comment on a contract are the same row
 * under one machinery (CMT-001), so this is a move rather than a
 * promotion, and the ids, the authors, the mentions, the revisions, and
 * the two tombstones all travel by staying exactly where they are.
 */

import { and, comments, commentLastRead, eq } from "@openlaw/db";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import type { NotifyingTransaction } from "../../lib/notifications/notifier.js";
import type { ConversionRecordReference } from "./record-reference.js";

/** One re-parent, as the conversion describes it. */
export interface ThreadMove {
  requestId: string;
  /** INT-002's R-###, for the entry this write appends. */
  requestNumber: number;
  target: ConversionRecordReference;
  /** The triager converting. The move is their act, like every other
   * write this conversion makes. */
  actorId: string;
}

/**
 * Moves one Request's thread onto the record, inside the conversion's
 * own transaction.
 *
 * Runs under the Request's row lock, which the disposition already holds
 * — the conversation this moves is the conversation the Request held
 * when it was held. The other half of that sentence is the `request`
 * audience arm's: every thread write resolves through it, and its
 * resolve holds the same row in share mode. A comment racing this
 * conversion therefore lands before the move and is carried by it, or
 * waits and is answered the record's pair — never a row left on a pair
 * nothing reads again.
 *
 * **A Request with nothing said on it narrates nothing.** An empty
 * thread is an ordinary state of a complete Request (INT-002), and a
 * sentence about moving nothing would put a line on the record about
 * something that did not happen — the promotion's rule about empty
 * paper, said about empty conversation. The watermark clean-up above
 * still runs, because that follows the address rather than the rows.
 */
export async function moveThread(tx: NotifyingTransaction, move: ThreadMove): Promise<void> {
  const moved = await tx
    .update(comments)
    .set({ entityType: move.target.module, entityId: move.target.id })
    .where(and(eq(comments.entityType, "request"), eq(comments.entityId, move.requestId)))
    // Enough to know whether anything moved. The bodies are not read and
    // the count is not narrated (DD-016): how many comments a Request
    // held is how much was said at every tier, and the entry below is
    // one a Contributor reads.
    .returning({ id: comments.id });

  // Each reader's place in the conversation, re-keyed onto the record.
  // The set is one row per person who ever opened this Request's thread,
  // which on a 2–10 person team is a handful, so it is read and written
  // rather than pushed into one statement nobody can read back.
  const onRequest = and(
    eq(commentLastRead.entityType, "request"),
    eq(commentLastRead.entityId, move.requestId),
  );
  const watermarks = await tx
    .select({ userId: commentLastRead.userId, readAt: commentLastRead.readAt })
    .from(commentLastRead)
    .where(onRequest);
  if (watermarks.length > 0) {
    await tx
      .insert(commentLastRead)
      .values(
        watermarks.map((row) => ({
          userId: row.userId,
          entityType: move.target.module,
          entityId: move.target.id,
          readAt: row.readAt,
        })),
      )
      // The rule that keeps the move honest: a reader already holding a
      // place in *this record's* conversation keeps it. Theirs is a real
      // read state about real comments, and the Request's is about a
      // thread that has just arrived underneath it — overwriting one
      // with the other would make somebody's badge lie in whichever
      // direction the two happened to differ.
      .onConflictDoNothing({
        target: [commentLastRead.userId, commentLastRead.entityType, commentLastRead.entityId],
      });
    // And the Request's own rows go: the pair they name holds no
    // comments now, so what they would answer is a place in a
    // conversation that is not there. A reader whose record row was kept
    // above keeps it — the conflict rule decided that, and this delete
    // does not reopen the question.
    await tx.delete(commentLastRead).where(onRequest);
  }

  // DD-017, on the record the conversation left — and only where there
  // was one. A Request nobody said anything on narrates nothing: the
  // watermarks above moved because the address moved, but a sentence
  // about a conversation that was never had would report on something
  // that did not happen.
  if (moved.length === 0) return;
  // A reader of the Request who wonders where the thread went is the one
  // this sentence is for, and C-### is where it went. The record's own
  // feed already says it was created from R-###, so it is one entry
  // rather than two.
  await recordActivity(tx, {
    entityType: "request",
    entityId: move.requestId,
    actorId: move.actorId,
    action: "request.thread_moved",
    visibility: RECORD_ACTIVITY_TIER,
    payload: { number: move.requestNumber, contractNumber: move.target.number },
  });
}
