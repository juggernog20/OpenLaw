// SPDX-License-Identifier: AGPL-3.0-only

import {
  and,
  comments,
  commentMentions,
  eq,
  isNull,
  users,
  type Db,
  type CommentVisibility,
} from "@openlaw/db";
import type { EmailRecord } from "../email-layout.js";

export const COMMENT_EMAIL_EVENTS: ReadonlySet<string> = new Set([
  "comment.mentioned",
  "comment.posted",
  "request.replied",
]);
const TIERS: Record<CommentVisibility, NonNullable<EmailRecord["comment"]>["tier"]> = {
  legal_only: "Legal Only",
  working_team: "Working Team",
  full_thread: "Full Thread",
};

/** CMT-006: the notification keeps only the id; words are read for this send. */
export async function readEmailComment(
  db: Db,
  commentId: string,
  recipientId: string,
): Promise<EmailRecord["comment"]> {
  const [comment] = await db
    .select({ body: comments.body, visibility: comments.visibility, author: users.displayName })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(and(eq(comments.id, commentId), isNull(comments.deletedAt), isNull(comments.redactedAt)))
    .limit(1);
  if (!comment) return undefined;
  const mentions = await db
    .select({ id: users.id, name: users.displayName })
    .from(commentMentions)
    .innerJoin(users, eq(users.id, commentMentions.userId))
    .where(eq(commentMentions.commentId, commentId));
  return {
    author: comment.author,
    tier: TIERS[comment.visibility],
    ...commentExcerpt(comment.body, mentions, recipientId),
  };
}

/** Count Unicode characters before escaping HTML. A single long word is cut at the limit. */
export function commentExcerpt(
  body: string,
  mentions: readonly { id: string; name: string }[],
  recipientId: string,
): Pick<NonNullable<EmailRecord["comment"]>, "words" | "cut"> {
  const characters = Array.from(body);
  const cut = characters.length > 280;
  let text = body;
  if (cut) {
    let end = 280;
    while (end > 0 && !/\s/u.test(characters[end]!)) end -= 1;
    text = characters
      .slice(0, end || 280)
      .join("")
      .trimEnd();
  }
  const names = [...new Set(mentions.map((person) => person.name))]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!names.length) return { words: [{ text }], cut };
  const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(@(?:${names.map(escape).join("|")}))`, "gu");
  const ownName = mentions.find((person) => person.id === recipientId)?.name;
  return {
    words: text
      .split(pattern)
      .map((part, index) => ({ text: part, mention: index % 2 === 1 && part === `@${ownName}` })),
    cut,
  };
}
