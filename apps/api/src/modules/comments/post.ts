// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Writing one comment onto one thread (CMT-001, CMT-007, DD-017).
 *
 * `POST /comments` is not the only act that says something on a thread.
 * INT-007's Resolve closes a Request with an optional Full Thread
 * closing reply, and that reply is an ordinary comment: it lands on the
 * thread, it narrates, and it raises whatever a comment on that kind of
 * record raises. A second copy of the insert would be a second place for
 * the entry or the event to be forgotten, so the write is here and both
 * callers take it.
 *
 * **What this module owns is the write, not the permission.** The caller
 * has already resolved the audience (`audience.ts`) and decided that
 * this author may post at this tier — the composer route checks the tier
 * against the viewer's rooms and checks every mention against
 * CMT-007, and a disposition route knows its own tier is Full Thread and
 * names nobody. Handing this function an audience is what says the check
 * happened: there is no way to call it with an id a client sent.
 *
 * **Everything it writes is in the caller's transaction.** The comment
 * row, the `comment_mentions` rows, the activity entry, and the events
 * commit together or not at all, which is what makes one press produce
 * one comment, one entry, and one bell row.
 */

import { z } from "zod";
import { commentAttachments, comments, commentMentions, type CommentVisibility } from "@openlaw/db";
import { MAX_COMMENT_BODY_LENGTH } from "@openlaw/shared";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import type { Notifier, NotifyingTransaction } from "../../lib/notifications/notifier.js";
import { notifyCommentPosted, type CommentAudience } from "./audience.js";

/** Plain text, capped where every other free-text field is capped.
 * Rich text and reactions are deliberately out; CMT-011 paper travels
 * beside this body rather than changing its format.
 *
 * Shared rather than restated, because a Request's closing reply is an
 * ordinary comment and two ceilings for one column would let one route
 * keep taking text another has stopped taking. The number itself lives
 * in `@openlaw/shared`, so the boxes that collect a comment restate the
 * same bound as `maxLength`. */
export const CommentBodySchema = z.string().trim().min(1).max(MAX_COMMENT_BODY_LENGTH);

export interface NewComment {
  /** Pre-minted when attachments need storage keys before the row exists. */
  id?: string;
  /** The thread, and the standing that admitted this author to it. Both
   * the record's id and the tiers come from the arm that resolved it,
   * never from the wire. */
  audience: CommentAudience;
  author: AuthenticatedUser;
  body: string;
  /** The DD-016 tier the comment is said at, immutable afterwards
   * (CMT-005). The caller has already checked that the author is in this
   * room and that every person named hears it. */
  visibility: CommentVisibility;
  /** Who the comment addresses, by id, deduplicated. Omit where it names
   * nobody. */
  mentions?: readonly string[];
  /** Blobs already written through the storage seam. Their rows commit
   * with the comment, mentions, activity, and events. */
  attachments?: readonly {
    id: string;
    fileRef: string;
    filename: string;
  }[];
}

/**
 * Posts one comment and everything it raises, and answers its id.
 *
 * The activity entry rides the comment's own tier, so it is hidden from
 * exactly the people the comment is hidden from, and it carries ids only
 * — the log is append-only (DD-017), and text in a payload could never
 * be redacted out of it (CMT-008).
 *
 * The notification is raised after the `comment_mentions` rows are
 * written, in this same transaction, so the seam behind {@link Notifier}
 * reads who was addressed out of the table rather than out of a body.
 * What a comment raises is the arm's to say (NOT-002): a contract
 * comment rings the record's roster, and a Request's rings the
 * Requester.
 */
export async function postComment(
  tx: NotifyingTransaction,
  notifier: Notifier,
  comment: NewComment,
): Promise<string> {
  const { audience, author, body, visibility } = comment;
  const mentioned = comment.mentions ?? [];
  const [created] = await tx
    .insert(comments)
    .values({
      id: comment.id,
      entityType: audience.entityType,
      entityId: audience.entityId,
      authorId: author.id,
      body,
      visibility,
    })
    .returning({ id: comments.id });
  const commentId = created!.id;
  if (comment.attachments && comment.attachments.length > 0) {
    await tx.insert(commentAttachments).values(
      comment.attachments.map((attachment) => ({
        ...attachment,
        commentId,
        uploadedBy: author.id,
      })),
    );
  }
  if (mentioned.length > 0) {
    await tx.insert(commentMentions).values(mentioned.map((userId) => ({ commentId, userId })));
  }
  await recordActivity(tx, {
    entityType: audience.entityType,
    entityId: audience.entityId,
    actorId: author.id,
    action: "comment.posted",
    visibility,
    payload: { commentId },
  });
  await notifyCommentPosted(tx, notifier, {
    audience,
    actorId: author.id,
    actorName: author.displayName,
    commentId,
    visibility,
    mentioned,
  });
  return commentId;
}
