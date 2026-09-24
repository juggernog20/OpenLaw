// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Comment writes and thread permissions (CMT-001, CMT-007, DD-017).
 * postThreadComment resolves access, tiers and mentions for REST and MCP.
 * postComment accepts an already checked audience, also used by Request
 * dispositions. The comment, activity and notifications commit together.
 */

import { z } from "zod";
import { httpError } from "../../lib/problem.js";
import { selectComments, mentionsOf, attachmentsOf, toComment } from "./service.js";
import {
  eq,
  commentAttachments,
  comments,
  commentMentions,
  type CommentVisibility,
} from "@openlaw/db";
import { MAX_COMMENT_BODY_LENGTH } from "@openlaw/shared";
import type { AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import type { Notifier, NotifyingTransaction } from "../../lib/notifications/notifier.js";
import {
  reachedThread,
  mentionCandidates,
  type EntityRef,
  notifyCommentPosted,
  commentActivityRef,
  type CommentAudience,
} from "./audience.js";

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
    ...(await commentActivityRef(tx, audience)),
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

/** Resolve and check the thread in the same transaction as the comment write. */
export async function postThreadComment(
  notifier: Notifier,
  user: AuthenticatedUser,
  input: EntityRef & { body: string; visibility?: CommentVisibility; mentions?: string[] },
  options: { id?: string; attachments?: NewComment["attachments"] } = {},
) {
  const body = CommentBodySchema.parse(input.body);
  const named = [...new Set(input.mentions ?? [])];
  const { id, attachments: storedAttachments = [] } = options;
  return notifier.notifying(async (tx) => {
    // Read on the same snapshot the rows are written on: a grant
    // dropped between the check and the insert must not authorize a
    // post onto a record the author no longer reaches. A refusal
    // thrown here rolls the transaction back and keeps its status.
    const audience = await reachedThread(tx, user, input);
    const visibility =
      input.visibility ??
      (["legal_only", "working_team", "full_thread"] as const).find((tier) =>
        audience.tiers.includes(tier),
      )!;
    // The composer offers a Contributor two segments; this is the
    // refusal that holds when the request does not come from it.
    if (!audience.tiers.includes(visibility)) {
      throw httpError(403, "You cannot post a comment at that visibility tier.");
    }

    // Checked on that same snapshot: a grant dropped before the
    // insert must not leave a mention nobody can hear.
    if (named.length > 0) {
      const candidates = await mentionCandidates(tx, audience, named);
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      // Somebody no tier on this record reaches is not addressable
      // here at all. Mentioning a person does not grant them the
      // record; whatever the arm's audience rule asks for does.
      if (named.some((id) => !byId.has(id))) {
        throw httpError(400, "That is not a person you can mention on this record.");
      }
      // The load-bearing refusal (CMT-007). The client's
      // confirmation offers the promotion; this is what holds when
      // the request did not come from it.
      const unreachable = named
        .map((id) => byId.get(id)!)
        .filter((candidate) => !candidate.tiers.includes(visibility));
      if (unreachable.length > 0) {
        const names = unreachable.map((candidate) => candidate.displayName).join(", ");
        throw httpError(
          403,
          `${names} cannot see a comment at that visibility tier. Widen the audience or take the mention out.`,
        );
      }
    }

    // The write itself, its `comment_mentions` rows, its activity
    // entry, and whatever the arm raises are all one act, and
    // `post.ts` is where that act lives — the Resolve disposition
    // says its closing reply through the same call (INT-007).
    const commentId = await postComment(tx, notifier, {
      id,
      audience,
      author: user,
      body,
      visibility,
      mentions: named,
      attachments: storedAttachments,
    });
    // Read back through the same projection the thread uses, so the
    // row the poster gets is the row they will see on the next load.
    const [posted] = await selectComments(tx).where(eq(comments.id, commentId));
    const [mentions, attachments] = await Promise.all([
      mentionsOf(tx, [commentId]),
      attachmentsOf(tx, user, [commentId]),
    ]);
    return toComment(posted!, mentions.get(commentId), attachments.get(commentId));
  });
}
