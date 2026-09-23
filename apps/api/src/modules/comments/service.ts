// SPDX-License-Identifier: AGPL-3.0-only

import type { Db } from "@openlaw/db";
import {
  and,
  asc,
  COMMENT_VISIBILITIES,
  commentAttachments,
  commentMentions,
  comments,
  desc,
  documents,
  documentVersions,
  eq,
  inArray,
  sql,
  users,
  type Executor,
  type SQL,
} from "@openlaw/db";
import { z } from "zod";
import { type AuthenticatedUser } from "../../auth/guards.js";
import { documentAudienceScope } from "../../lib/contract-access.js";
import { COMMENT_ENTITY_TYPES, reachedThread, type CommentEntityType } from "./audience.js";
/**
 * What a comment can hang off, as the API accepts it — the entity types
 * that have an arm in `audience.ts`, drawn from that list so the schema
 * and the arms cannot drift. The table's CHECK admits the wider `matter |
 * contract | document | request`, matching the `activity_log` precedent.
 */
export const CommentEntityTypeSchema = z.enum(COMMENT_ENTITY_TYPES);

/**
 * The record's id. Bounded rather than shaped: every id in this API is
 * an opaque text primary key, and no route asserts a UUID pattern, so
 * this one must not either — the bound is here to refuse junk before it
 * reaches a query, not to rule on what an id looks like. A well-formed
 * id for a record the viewer cannot reach still answers 404.
 */
export const RECORD_ID_MAX_LENGTH = 64;
export const RecordIdSchema = z.string().min(1).max(RECORD_ID_MAX_LENGTH);

export const VisibilitySchema = z.enum(COMMENT_VISIBILITIES);

/** The author as every comment row draws them — the same person shape
 * the record's roster uses, so one face renders one way (DES-018). */
const AuthorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});

/** One mentioned person, as a posted comment carries them. The name is
 * re-read from the users table rather than frozen into the row, so a
 * chip renders whoever that person is now. */
export const MentionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

/** One attachment as it travels inside a live comment. The storage
 * reference never leaves the API. */
export const CommentAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  /** The one destination this file became, or NULL until it is filed. */
  filed: z
    .object({
      documentId: z.string(),
      documentTitle: z.string(),
      versionId: z.string(),
      versionNumber: z.int().positive(),
    })
    .optional(),
});

export const CommentSchema = z.object({
  id: z.string(),
  entityType: CommentEntityTypeSchema,
  entityId: z.string(),
  author: AuthorSchema,
  /** What the comment says now. **Empty once the text is gone** — a soft
   * delete moves it to `comment_revisions` and a redact purges it from
   * there too, so the tombstone carries no body to leak. */
  body: z.string(),
  visibility: VisibilitySchema,
  /** Who the comment addresses (CMT-007), alphabetical. Empty for a
   * comment that names nobody, and emptied by a redact along with the
   * text it named them in. */
  mentions: z.array(MentionSchema),
  /** Omitted for a paperless comment, preserving the existing JSON
   * shape. Also omitted from both tombstones. */
  attachments: z.array(CommentAttachmentSchema).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  /** NULL until the author changes the text; a time draws the "edited"
   * marker, so a reader can tell the text moved since they read it. */
  editedAt: z.iso.datetime({ offset: true }).nullable(),
  /** NULL while the comment stands; a time draws the author's own
   * tombstone, which holds the comment's place in the thread. */
  deletedAt: z.iso.datetime({ offset: true }).nullable(),
  /** NULL until an Administrator removes the text; a time draws the
   * other tombstone. The two are different acts by different people, so
   * the row says which one happened. */
  redactedAt: z.iso.datetime({ offset: true }).nullable(),
});

/** The reference the thread is keyed by — one record, named by type and
 * id rather than by a contract's CTR-003 number, because the panel that
 * reads it is entity-generic. */
export const EntityRefQuery = z.object({
  entityType: CommentEntityTypeSchema,
  entityId: RecordIdSchema,
});

/**
 * How many comments one read answers (CTR-024).
 *
 * Server-fixed, so no client can turn one request into a whole-thread
 * scan. 50 matches the contract list rather than the activity feed's 25:
 * a thread is read in one sitting, and a page that ends mid-conversation
 * more often is worse than a page that is a little long.
 *
 * The page is the **newest** 50, answered oldest-first inside itself, so
 * the panel opens on the conversation as it stands. Paging walks
 * backwards through the thread, which is the direction a reader goes
 * when they want more of it.
 */
const PAGE_SIZE = 50;

/** A cursor is a comment id, and nothing longer is worth reading. */
const CursorSchema = z.string().min(1).max(64);

/**
 * The keyset boundary: every comment strictly older than one of them,
 * in the order the thread is read back (CTR-024).
 *
 * `(created_at, id)` is the pair the audit log and the record feed both
 * use, and the id breaks a same-instant tie — uuidv7 is time-ordered, so
 * that order is still the order things were said in.
 *
 * The boundary's own position is read from the table rather than taken
 * from the client, and it is read **under the same scope the page is
 * read under**: a cursor naming a comment in a tier this viewer is not
 * in the room for resolves to NULL, the comparison answers nothing, and
 * they get an empty page. A boundary that resolved outside the tier
 * filter would let a cursor confirm that a Legal Only comment exists,
 * which is the one thing DD-016 will not have leak.
 */
function olderThan(commentId: string, scope: SQL | undefined): SQL {
  return sql`(${comments.createdAt}, ${comments.id}) < (
    select ${comments.createdAt}, ${comments.id}
    from ${comments}
    where ${and(eq(comments.id, commentId), scope)}
  )`;
}

/** The one comment projection, joined to its author. Callers add the
 * scope; the list adds the order too. */
export const selectComments = (db: Executor) =>
  db
    .select({
      id: comments.id,
      entityType: comments.entityType,
      entityId: comments.entityId,
      body: comments.body,
      visibility: comments.visibility,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
      deletedAt: comments.deletedAt,
      redactedAt: comments.redactedAt,
      author: {
        id: users.id,
        displayName: users.displayName,
        image: users.image,
        archivedAt: users.archivedAt,
      },
    })
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id));

export type ThreadRow = Awaited<ReturnType<typeof selectComments>>[number];

/** Derived from the response schema, so the projection and what the
 * route promises cannot drift apart. */
type Mention = z.infer<typeof MentionSchema>;
type Attachment = z.infer<typeof CommentAttachmentSchema>;

/**
 * Who each of these comments addresses, in one read. The list is a
 * table, not a substring of the body, so this is a join rather than a
 * parse — that is the whole reason `comment_mentions` exists.
 */
export async function mentionsOf(
  db: Executor,
  commentIds: readonly string[],
): Promise<Map<string, Mention[]>> {
  const byComment = new Map<string, Mention[]>();
  if (commentIds.length === 0) return byComment;
  const rows = await db
    .select({
      commentId: commentMentions.commentId,
      id: users.id,
      displayName: users.displayName,
    })
    .from(commentMentions)
    .innerJoin(users, eq(commentMentions.userId, users.id))
    .where(inArray(commentMentions.commentId, [...commentIds]))
    .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id));
  for (const row of rows) {
    const list = byComment.get(row.commentId);
    if (list) list.push({ id: row.id, displayName: row.displayName });
    else byComment.set(row.commentId, [{ id: row.id, displayName: row.displayName }]);
  }
  return byComment;
}

/** The paper carried by a page of comments, grouped without exposing
 * storage references.
 *
 * The filed marker obeys the Document's own audience (DD-014), not the
 * comment's. A Business User hears a Full Thread comment but reaches no
 * Document, and a Member off the team does not reach a Confidential
 * one; for them the row reads as plain paper, because a Document this
 * viewer may not see never leaves the database. */
export async function attachmentsOf(
  db: Executor,
  user: AuthenticatedUser,
  commentIds: readonly string[],
): Promise<Map<string, Attachment[]>> {
  const byComment = new Map<string, Attachment[]>();
  if (commentIds.length === 0) return byComment;
  const rows = await db
    .select({
      commentId: commentAttachments.commentId,
      id: commentAttachments.id,
      filename: commentAttachments.filename,
      filedDocumentId: commentAttachments.filedDocumentId,
      filedDocumentTitle: documents.title,
      filedVersionId: commentAttachments.filedVersionId,
      filedVersionNumber: documentVersions.versionNumber,
    })
    .from(commentAttachments)
    .leftJoin(
      documents,
      and(eq(commentAttachments.filedDocumentId, documents.id), documentAudienceScope(db, user)),
    )
    .leftJoin(
      documentVersions,
      and(
        eq(commentAttachments.filedVersionId, documentVersions.id),
        eq(documentVersions.documentId, documents.id),
      ),
    )
    .where(inArray(commentAttachments.commentId, [...commentIds]))
    .orderBy(asc(commentAttachments.createdAt), asc(commentAttachments.id));
  for (const row of rows) {
    const list = byComment.get(row.commentId);
    const filed =
      row.filedDocumentId !== null &&
      row.filedDocumentTitle !== null &&
      row.filedVersionId !== null &&
      row.filedVersionNumber !== null
        ? {
            documentId: row.filedDocumentId,
            documentTitle: row.filedDocumentTitle,
            versionId: row.filedVersionId,
            versionNumber: row.filedVersionNumber,
          }
        : null;
    const attachment = {
      id: row.id,
      filename: row.filename,
      ...(filed ? { filed } : {}),
    };
    if (list) list.push(attachment);
    else byComment.set(row.commentId, [attachment]);
  }
  return byComment;
}

export function toComment(
  row: ThreadRow,
  mentions: readonly Mention[] = [],
  attachments: readonly Attachment[] = [],
) {
  const carriesPaper = row.deletedAt === null && row.redactedAt === null && attachments.length > 0;
  return {
    id: row.id,
    // Narrowed for the response schema: the column admits four types,
    // and only a type with an arm can have reached this far.
    entityType: row.entityType as CommentEntityType,
    entityId: row.entityId,
    author: {
      id: row.author.id,
      displayName: row.author.displayName,
      image: row.author.image,
      archived: row.author.archivedAt !== null,
    },
    body: row.body,
    visibility: row.visibility,
    mentions: [...mentions],
    ...(carriesPaper ? { attachments: [...attachments] } : {}),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    redactedAt: row.redactedAt?.toISOString() ?? null,
  };
}

export const CommentListQuery = EntityRefQuery.extend({
  /** The previous page's `nextCursor`. Omit for the newest page. */
  cursor: CursorSchema.optional(),
  visibility: VisibilitySchema.optional(),
});
export async function listComments(
  db: Db,
  user: AuthenticatedUser,
  input: z.input<typeof CommentListQuery>,
) {
  const query = CommentListQuery.parse(input);
  const audience = await reachedThread(db, user, query);
  const scope = and(
    eq(comments.entityType, audience.entityType),
    eq(comments.entityId, audience.entityId),
    // The tier filter is in the WHERE clause, so the limit below
    // cuts rows this viewer is already in the room for. A read that
    // limited first and filtered after would answer pages that
    // shrink by however many Legal Only comments sat in the window,
    // and a page length that varies with what is hidden is the leak
    // DD-016 exists to close (CTR-024).
    inArray(comments.visibility, [...audience.tiers]),
    query.visibility ? eq(comments.visibility, query.visibility) : undefined,
  );
  const rows = await selectComments(db)
    .where(and(scope, query.cursor === undefined ? undefined : olderThan(query.cursor, scope)))
    // Read from the newest end, because that is the end a reader
    // opens the panel on. The id breaks a same-instant tie: uuidv7
    // is time-ordered, so that order is still the posting order.
    // One past the page, which is how the answer knows whether
    // there is more without counting anything.
    .orderBy(desc(comments.createdAt), desc(comments.id))
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const ids = page.map((row) => row.id);
  const [mentions, attachments] = await Promise.all([
    mentionsOf(db, ids),
    attachmentsOf(db, user, ids),
  ]);
  return {
    // Turned back into the order a conversation is read in
    // (CMT-002). The page is a window on the thread, not a feed:
    // what the reader sees inside it runs oldest to newest exactly
    // as it always has.
    comments: page
      .slice()
      .reverse()
      .map((row) => toComment(row, mentions.get(row.id), attachments.get(row.id))),
    // The oldest row of this page is the boundary for the page
    // before it, and only when a further row was actually read.
    nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
  };
}
