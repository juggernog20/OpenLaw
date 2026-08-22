// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The comment thread (M9/2, M9/4) — reading it, posting into it, and the
 * three ways to correct what was said.
 *
 * The routes are keyed by an entity reference rather than by a record's
 * own address, because the thread is one machinery across matters,
 * contracts, documents, and requests (CMT-001). Matters (M22) and
 * documents (M11) mount these same routes; the entity vocabulary the
 * table admits is the full four, and the API accepts the types that have
 * an arm in `audience.ts` — `contract` and `request` today, and matters
 * and documents when those records exist.
 *
 * The thread is flat and chronological (CMT-002). There is no nesting
 * and no `parent_comment_id`: a conversation between a handful of people
 * is read top to bottom.
 *
 * It **is** paged, from the newest end (CTR-024). A read answers the
 * last 50 comments, in the order they were said, and `nextCursor` walks
 * backwards into the older thread — so the panel opens on the
 * conversation as it stands and a thread that has run for two years does
 * not arrive in one response. The bound is the server's: no client can
 * ask for more.
 *
 * **Every read is filtered at query time** (DD-016). What the viewer may
 * not hear never leaves the database, so the thread carries no
 * placeholder, no gap, and no count of what was left out. There is no
 * total in the envelope either — the client counts the rows it was given,
 * which is the only number that cannot leak.
 *
 * **The audience is the one gate, and it is resolved in `audience.ts`.**
 * It answers which record this viewer reaches and which DD-016 tiers they
 * are in the room for, and `null` for anything else. Which rule produced
 * that answer is the arm's business, not this file's: nothing below reads
 * a `contract_team` row, a Confidential flag, or a contract id. Every
 * filter, count, and write keys on the `entityType` and `entityId` the
 * audience came back with.
 *
 * Both the read and the write take it, so a Contributor is refused the
 * Legal Only tier by the same fact that hides Legal Only comments from
 * them — the client's own composer offering two segments is a
 * convenience, never the enforcement.
 *
 * **The tier is immutable after posting** (CMT-005). The edit route
 * takes a body and nothing else, and the body schema is strict, so no
 * request can reach the column: a comment in the wrong room is deleted
 * and reposted.
 *
 * **Three corrections, three owners** (M9/4). An edit is the author's,
 * and so is a soft delete; each writes the prior body to
 * `comment_revisions` and leaves the row in the thread. A hard redact is
 * an Administrator's, and it clears the body and every revision row, so
 * text posted into the wrong record is gone rather than only hidden.
 * `comment_revisions` is where the prior text lives precisely so that a
 * redact can purge it (CMT-006) — the activity log never could.
 *
 * Every path appends its own activity entry at the comment's own tier,
 * in the same transaction, so a Legal Only comment leaves no trace in
 * anyone else's feed. Every entry carries ids only — no comment text
 * ever enters an activity payload, because the log is append-only
 * (DD-017) and a hard redact has to be able to remove what was said
 * (CMT-006).
 *
 * Whether an archived record still takes comments is the arm's to say.
 * An archived contract does: archiving is a soft delete for mistakes and
 * imports (CONTEXT.md) that freezes the record's fields, and the
 * conversation about why it was archived is not one of them. An archived
 * Request answers 404 instead, exactly as its detail read does.
 *
 * **The unread count is the thread's own filter, counted** (M9/5,
 * CMT-009). It runs over the same tiers the thread is read at, so a
 * comment the viewer is not in the room for contributes nothing — a
 * count is a leak like any other, and a badge that said "3" where the
 * thread shows two would announce the Legal Only comment it left out.
 * Opening the panel moves the viewer's watermark in `comment_last_read`,
 * and the badge clears.
 *
 * **Mentions are a list, not prose** (M9/3, CMT-007). A post names the
 * people it addresses by id, and each one becomes a `comment_mentions`
 * row. Tier promotion reads that list here, and the M18 notification
 * fan-out reads it later; neither re-parses a body. The seam refuses a
 * comment whose mentions outrun its tier, whatever the client sent — the
 * composer's confirmation explains the promotion, it does not enforce it.
 */

import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { uuidv7 } from "uuidv7";
import {
  and,
  asc,
  commentAttachments,
  commentLastRead,
  commentMentions,
  commentRevisions,
  comments,
  COMMENT_VISIBILITIES,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  sql,
  users,
  type CommentVisibility,
  type Executor,
  type SQL,
  type Transaction,
} from "@openlaw/db";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import {
  asUploadRefusal,
  attachmentDisposition,
  refuseOversize,
  uploadFilename,
  withStoredBlobs,
} from "../../lib/uploads.js";
import {
  commentAudience,
  commentEntityType,
  mentionCandidates,
  reachedThread,
  COMMENT_ENTITY_TYPES,
  COMMENT_READER_ROLES,
  type CommentAudience,
  type CommentEntityType,
} from "./audience.js";
import { CommentBodySchema, postComment } from "./post.js";

/**
 * The floor for reading any thread: every role that reaches a thread of
 * some entity type (CTR-021 for a contract, and whatever each later arm
 * admits).
 *
 * The union is deliberate, and it is not the whole gate. A role that
 * reaches one kind of record's thread does not thereby reach another's,
 * so the arm's own `readerRoles` refuses per request inside
 * `reachedThread` — in the same words this guard uses. The guard is what
 * keeps a role that reaches no thread at all from ever meeting a handler.
 */
const requireCommentReader = requireRole(...COMMENT_READER_ROLES);

/** The hard redact is an Administrator's alone (CMT-005). The role gate
 * refuses everyone else before the route reads a row. */
const requireAdministrator = requireRole("administrator");

/**
 * What a comment can hang off, as the API accepts it — the entity types
 * that have an arm in `audience.ts`, drawn from that list so the schema
 * and the arms cannot drift. The table's CHECK admits the wider `matter |
 * contract | document | request`, matching the `activity_log` precedent.
 */
const CommentEntityTypeSchema = z.enum(COMMENT_ENTITY_TYPES);

/**
 * The record's id. Bounded rather than shaped: every id in this API is
 * an opaque text primary key, and no route asserts a UUID pattern, so
 * this one must not either — the bound is here to refuse junk before it
 * reaches a query, not to rule on what an id looks like. A well-formed
 * id for a record the viewer cannot reach still answers 404.
 */
const RecordIdSchema = z.string().min(1).max(64);

const VisibilitySchema = z.enum(COMMENT_VISIBILITIES);

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
const MentionSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

/** One attachment as it travels inside a live comment. The storage
 * reference never leaves the API. */
const CommentAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
});

const CommentSchema = z.object({
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

/**
 * The people a post may name. Bounded because an unbounded list is a
 * way to make one insert arbitrarily large; twenty is far past any
 * conversation a 2–10 person legal team holds on one record.
 *
 * Each id is bounded rather than shaped, for `RecordIdSchema`'s reason:
 * every id in this API is an opaque text primary key, and no route
 * asserts a UUID pattern. A well-formed id that names nobody this
 * record can reach is refused below anyway, so shaping the string would
 * add a second, weaker gate in front of the real one.
 */
const MentionsSchema = z.array(z.string().min(1).max(64)).max(20);

/** The JSON body POST /comments has always taken. Multipart parses the
 * same fields through this exact schema after streaming its file parts. */
const CommentPostBodySchema = z.strictObject({
  entityType: CommentEntityTypeSchema,
  entityId: RecordIdSchema,
  body: CommentBodySchema,
  visibility: VisibilitySchema,
  mentions: MentionsSchema.optional(),
});

/** OpenAPI description for the streamed route body. Runtime validation
 * still goes through CommentPostBodySchema; metadata keeps the generated
 * client's established field types while documenting the file parts. */
const CommentPostTransportSchema = z.any().meta({
  type: "object",
  properties: {
    entityType: { type: "string", enum: [...COMMENT_ENTITY_TYPES] },
    entityId: { type: "string", minLength: 1, maxLength: 64 },
    body: { type: "string", minLength: 1, maxLength: 10_000 },
    visibility: { type: "string", enum: [...COMMENT_VISIBILITIES] },
    mentions: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 64 },
    },
    file: {
      type: "array",
      maxItems: 5,
      items: { type: "string", format: "binary" },
      description: "Up to five file parts, all named `file`.",
    },
  },
  required: ["entityType", "entityId", "body", "visibility"],
  additionalProperties: false,
});

/** One comment carries at most five files (CMT-011). */
const MAX_COMMENT_ATTACHMENTS = 5;

/** The reference the thread is keyed by — one record, named by type and
 * id rather than by a contract's CTR-003 number, because the panel that
 * reads it is entity-generic. */
const EntityRefQuery = z.object({
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

/** And a comment a viewer is not in the room for reads the same way. A
 * 403 on a Legal Only comment would say a Legal Only comment is there,
 * which is the one thing DD-016 will not have leak. */
const NO_COMMENT = "No comment exists with this id.";

export const commentsRoutes: FastifyPluginAsyncZod = async (app) => {
  /** The one comment projection, joined to its author. Callers add the
   * scope; the list adds the order too. */
  const selectComments = (db: Executor) =>
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

  type ThreadRow = Awaited<ReturnType<typeof selectComments>>[number];

  /** Derived from the response schema, so the projection and what the
   * route promises cannot drift apart. */
  type Mention = z.infer<typeof MentionSchema>;
  type Attachment = z.infer<typeof CommentAttachmentSchema>;

  /**
   * Who each of these comments addresses, in one read. The list is a
   * table, not a substring of the body, so this is a join rather than a
   * parse — that is the whole reason `comment_mentions` exists.
   */
  async function mentionsOf(
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
   * storage references. */
  async function attachmentsOf(
    db: Executor,
    commentIds: readonly string[],
  ): Promise<Map<string, Attachment[]>> {
    const byComment = new Map<string, Attachment[]>();
    if (commentIds.length === 0) return byComment;
    const rows = await db
      .select({
        commentId: commentAttachments.commentId,
        id: commentAttachments.id,
        filename: commentAttachments.filename,
      })
      .from(commentAttachments)
      .where(inArray(commentAttachments.commentId, [...commentIds]))
      .orderBy(asc(commentAttachments.createdAt), asc(commentAttachments.id));
    for (const row of rows) {
      const list = byComment.get(row.commentId);
      const attachment = { id: row.id, filename: row.filename };
      if (list) list.push(attachment);
      else byComment.set(row.commentId, [attachment]);
    }
    return byComment;
  }

  function toComment(
    row: ThreadRow,
    mentions: readonly Mention[] = [],
    attachments: readonly Attachment[] = [],
  ) {
    const carriesPaper =
      row.deletedAt === null && row.redactedAt === null && attachments.length > 0;
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

  app.get(
    "/comments",
    {
      preHandler: requireCommentReader,
      schema: {
        operationId: "listComments",
        summary:
          "One record's comment thread, flat and oldest first (CMT-002), " +
          "filtered at query time to the DD-016 tiers the viewer is in " +
          "the room for. A tier they are not in is omitted entirely — no " +
          "placeholder, no gap, and no count. A record they cannot reach " +
          "answers 404, exactly as one that does not exist. Paged from a " +
          "server-fixed page size, newest end first (CTR-024): the page " +
          "reads oldest-first inside itself, and `nextCursor` walks back " +
          "into the older thread",
        tags: ["comments"],
        querystring: EntityRefQuery.extend({
          /** The previous page's `nextCursor`. Omit for the newest page. */
          cursor: CursorSchema.optional(),
        }),
        response: {
          200: z.object({
            comments: z.array(CommentSchema),
            /** Pass back as `cursor` for the page before this one. NULL
             * when this page reaches the start of the thread. */
            nextCursor: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const audience = await reachedThread(app.db, request.user, request.query);
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
      );
      const rows = await selectComments(app.db)
        .where(
          and(
            scope,
            request.query.cursor === undefined ? undefined : olderThan(request.query.cursor, scope),
          ),
        )
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
        mentionsOf(app.db, ids),
        attachmentsOf(app.db, ids),
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
    },
  );

  app.get(
    "/comments/mention-candidates",
    {
      preHandler: requireCommentReader,
      schema: {
        operationId: "listMentionCandidates",
        summary:
          "The people a comment on this record can address (CMT-007), " +
          "each with the DD-016 tiers they hear on it — the @-typeahead's " +
          "list, and what the promotion confirmation reads to work out " +
          "the narrowest tier that includes everyone named. Somebody no " +
          "tier reaches is left out rather than offered and refused. A " +
          "record the viewer cannot reach answers 404",
        tags: ["comments"],
        querystring: EntityRefQuery,
        response: {
          200: z.object({
            candidates: z.array(
              z.object({
                id: z.string(),
                displayName: z.string(),
                image: z.string().nullable(),
                tiers: z.array(VisibilitySchema),
              }),
            ),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const audience = await reachedThread(app.db, request.user, request.query);
      const candidates = await mentionCandidates(app.db, audience);
      return { candidates: candidates.map((row) => ({ ...row, tiers: [...row.tiers] })) };
    },
  );

  /** What both badge routes answer: one number, and nothing that could
   * be subtracted from another one to find what it left out. */
  const UnreadEnvelope = z.object({ unread: z.int().nonnegative() });

  /**
   * How many comments on this record are news to this viewer (CMT-004,
   * CMT-009).
   *
   * Four conditions, and each one is a rule the badge has to keep. The
   * tier predicate, so a comment the viewer is not in the room for
   * contributes nothing — the count is taken over the filtered set,
   * never the raw one, exactly as the thread is read. Not the viewer's
   * own, because their own words are not news. Not a tombstone, by
   * either hand, because a removed comment has nothing left to read.
   * And later than the watermark.
   *
   * **No watermark means everything visible is unread**, not nothing.
   * A reader who has never opened the panel has read none of it, and
   * `-infinity` is that sentence in SQL: every row is later than it.
   */
  async function unreadCount(
    db: Executor,
    user: AuthenticatedUser,
    audience: CommentAudience,
  ): Promise<number> {
    // The viewer's own place in this record's conversation, as a scalar:
    // the primary key names exactly one row, or none at all.
    const watermark = db
      .select({ readAt: commentLastRead.readAt })
      .from(commentLastRead)
      .where(
        and(
          eq(commentLastRead.userId, user.id),
          eq(commentLastRead.entityType, audience.entityType),
          eq(commentLastRead.entityId, audience.entityId),
        ),
      );
    const [row] = await db
      .select({ unread: count() })
      .from(comments)
      .where(
        and(
          eq(comments.entityType, audience.entityType),
          eq(comments.entityId, audience.entityId),
          inArray(comments.visibility, [...audience.tiers]),
          ne(comments.authorId, user.id),
          isNull(comments.deletedAt),
          isNull(comments.redactedAt),
          gt(comments.createdAt, sql`coalesce((${watermark}), '-infinity'::timestamptz)`),
        ),
      );
    return row?.unread ?? 0;
  }

  app.get(
    "/comments/unread",
    {
      preHandler: requireCommentReader,
      schema: {
        operationId: "readUnreadComments",
        summary:
          "How many comments on this record the viewer has not read — " +
          "the chat applet's badge (CMT-004). Counted over the same " +
          "filtered set the thread is read at, so a tier the viewer is " +
          "not in the room for contributes nothing; the viewer's own " +
          "comments and both kinds of tombstone contribute nothing " +
          "either. A viewer who has never opened the panel has every " +
          "comment they can see counted. A record they cannot reach " +
          "answers 404",
        tags: ["comments"],
        querystring: EntityRefQuery,
        response: { 200: UnreadEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const audience = await reachedThread(app.db, request.user, request.query);
      const unread = await unreadCount(app.db, request.user, audience);
      return { unread };
    },
  );

  app.post(
    "/comments/read",
    {
      preHandler: requireCommentReader,
      schema: {
        operationId: "markCommentsRead",
        summary:
          "Mark this record's conversation read up to now, which is what " +
          "opening the chat panel does (CMT-004). Writes the viewer's " +
          "`comment_last_read` watermark and answers the count that " +
          "remains — normally zero, and whatever landed between the read " +
          "and this call otherwise. A record the viewer cannot reach " +
          "answers 404",
        tags: ["comments"],
        body: z.strictObject({
          entityType: CommentEntityTypeSchema,
          entityId: RecordIdSchema,
        }),
        response: { 200: UnreadEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      return await app.db.transaction(async (tx) => {
        // Asked on the same snapshot the write and the count land on, as
        // every other write in this module does: a grant dropped between
        // the check and the write must not leave a watermark on a record
        // the reader no longer reaches. A refusal thrown here rolls the
        // transaction back and keeps its status.
        const audience = await reachedThread(tx, request.user, request.body);
        await tx
          .insert(commentLastRead)
          .values({
            userId: request.user.id,
            entityType: audience.entityType,
            entityId: audience.entityId,
          })
          .onConflictDoUpdate({
            target: [commentLastRead.userId, commentLastRead.entityType, commentLastRead.entityId],
            // The watermark only ever moves forward. Two panels open in
            // two tabs settle on the later of the two rather than on
            // whichever request the database happened to serve last.
            set: { readAt: sql`greatest(${commentLastRead.readAt}, now())` },
          });
        // Counted after the write, on the same snapshot: the badge takes
        // the server's number rather than assuming the write cleared it.
        const unread = await unreadCount(tx, request.user, audience);
        return { unread };
      });
    },
  );

  type CommentPostBody = z.infer<typeof CommentPostBodySchema>;
  type StoredCommentAttachment = {
    id: string;
    fileRef: string;
    filename: string;
  };

  function requireJsonComment(body: unknown): CommentPostBody {
    const parsed = CommentPostBodySchema.safeParse(body);
    if (!parsed.success) {
      const fields = [
        ...new Set(
          parsed.error.issues
            .map((issue) => issue.path.find((part) => typeof part === "string"))
            .filter((field): field is string => field !== undefined),
        ),
      ];
      const fieldDetail = fields.length > 0 ? ` Invalid fields: ${fields.join(", ")}.` : "";
      throw httpError(400, `That comment body is invalid.${fieldDetail}`);
    }
    return parsed.data;
  }

  /**
   * Reads the comment fields and up to five file parts in one pass.
   * Files stream directly into storage. Any parser, filename, or field
   * refusal removes every blob the pass wrote before rethrowing.
   */
  async function receiveMultipartComment(
    request: FastifyRequest,
    commentId: string,
  ): Promise<{ body: CommentPostBody; attachments: StoredCommentAttachment[] }> {
    const fields: Record<string, string> = {};
    const attachments: StoredCommentAttachment[] = [];
    let tooManyFiles = false;
    try {
      const parts = request.parts({
        limits: {
          fileSize: app.maxUploadBytes,
          // The route enforces five below while draining excess parts.
          // Letting Busboy stop on the sixth would destroy the fifth
          // stream while the storage adapter is still consuming it.
          files: 64,
          fields: 8,
          fieldSize: 8192,
          parts: 72,
        },
      });
      for await (const part of parts) {
        if (part.type === "field") {
          if (part.valueTruncated) {
            throw httpError(
              413,
              "That upload carries more form fields than this endpoint accepts.",
            );
          }
          if (Object.hasOwn(fields, part.fieldname)) {
            throw httpError(400, `The ${part.fieldname} field was sent more than once.`);
          }
          fields[part.fieldname] = String(part.value);
          continue;
        }
        if (part.fieldname !== "file") {
          throw httpError(400, "Attach comment files using the `file` field.");
        }
        if (attachments.length >= MAX_COMMENT_ATTACHMENTS) {
          tooManyFiles = true;
          // Keep the parser moving to its clean end. No excess byte is
          // stored, and the whole post is refused after the pass.
          for await (const chunk of part.file) {
            void chunk;
          }
          continue;
        }
        const filename = uploadFilename(part.filename);
        const id = uuidv7();
        const fileRef = await app.storage
          .put(`comment-attachments/${commentId}/${id}`, part.file)
          .catch((error: unknown) => {
            throw asUploadRefusal(error, app.maxUploadBytes, MAX_COMMENT_ATTACHMENTS);
          });
        if (part.file.truncated) {
          await app.storage.delete(fileRef).catch((error: unknown) => {
            request.log.warn({ err: error, fileRef }, "could not remove a truncated upload");
          });
          throw refuseOversize(app.maxUploadBytes);
        }
        attachments.push({ id, fileRef, filename });
      }

      if (tooManyFiles) {
        throw httpError(413, `Upload at most ${MAX_COMMENT_ATTACHMENTS} files at a time.`);
      }

      let mentions: unknown = undefined;
      if (fields.mentions !== undefined) {
        try {
          mentions = JSON.parse(fields.mentions);
        } catch {
          throw httpError(400, "The mentions field must be a JSON array of user ids.");
        }
      }
      const parsed = CommentPostBodySchema.safeParse({ ...fields, mentions });
      if (!parsed.success) throw httpError(400, "That comment form is invalid.");
      return { body: parsed.data, attachments };
    } catch (error) {
      await Promise.all(
        attachments.map((attachment) =>
          app.storage.delete(attachment.fileRef).catch((cleanup: unknown) => {
            request.log.warn(
              { err: cleanup, fileRef: attachment.fileRef },
              "could not remove the blob of a refused comment upload",
            );
          }),
        ),
      );
      throw asUploadRefusal(error, app.maxUploadBytes, MAX_COMMENT_ATTACHMENTS);
    }
  }

  app.post(
    "/comments",
    {
      preHandler: requireCommentReader,
      schema: {
        operationId: "postComment",
        summary:
          "Post a comment on a record at one of the DD-016 tiers. The " +
          "seam refuses a tier the poster is not in the room for, so a " +
          "Contributor cannot post Legal Only whatever the client sends, " +
          "and it refuses a comment whose mentions outrun its tier " +
          "(CMT-007), so the composer's confirmation explains the " +
          "promotion rather than enforcing it. The tier is immutable " +
          "afterwards (CMT-005) — there is no route that changes it. " +
          "Writes one comment_mentions row per person named, and appends " +
          "a comment.posted activity entry at the comment's own tier, " +
          "all in the same transaction. Accepts the existing JSON body " +
          "or multipart/form-data carrying the same fields and up to five " +
          "`file` parts. Stored blobs are removed if any later part or " +
          "transactional write is refused",
        tags: ["comments"],
        consumes: ["application/json", "multipart/form-data"],
        // Multipart is streamed and Fastify supplies an internal body
        // placeholder before the handler runs. Both transports are
        // parsed through CommentPostBodySchema in the handler instead.
        body: CommentPostTransportSchema,
        response: {
          201: z.object({ comment: CommentSchema }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const mintedCommentId = uuidv7();
      const incoming = request.isMultipart()
        ? await receiveMultipartComment(request, mintedCommentId)
        : { body: requireJsonComment(request.body), attachments: [] };
      const { body, visibility } = incoming.body;
      // One person named twice is one person to reach, and the row's
      // compound key says so too.
      const named = [...new Set(incoming.body.mentions ?? [])];

      // The seam's transaction rather than the database's: a comment
      // that names somebody is done *to* them (CMT-007, NOT-002 group
      // 1), and the bell row for it belongs inside the same commit as
      // the `comment_mentions` row it is read from.
      const write = () =>
        app.notifier.notifying(async (tx) => {
          // Read on the same snapshot the rows are written on: a grant
          // dropped between the check and the insert must not authorize a
          // post onto a record the author no longer reaches. A refusal
          // thrown here rolls the transaction back and keeps its status.
          const audience = await reachedThread(tx, request.user, incoming.body);
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
          const commentId = await postComment(tx, app.notifier, {
            id: mintedCommentId,
            audience,
            author: request.user,
            body,
            visibility,
            mentions: named,
            attachments: incoming.attachments,
          });
          // Read back through the same projection the thread uses, so the
          // row the poster gets is the row they will see on the next load.
          const [posted] = await selectComments(tx).where(eq(comments.id, commentId));
          const [mentions, attachments] = await Promise.all([
            mentionsOf(tx, [commentId]),
            attachmentsOf(tx, [commentId]),
          ]);
          return toComment(posted!, mentions.get(commentId), attachments.get(commentId));
        });

      const comment =
        incoming.attachments.length === 0
          ? await write()
          : await withStoredBlobs(
              app.storage,
              request.log,
              incoming.attachments.map((attachment) => attachment.fileRef),
              write,
            );

      return reply.status(201).send({ comment });
    },
  );

  /** The one comment a correction route addresses, named by its own id. */
  const CommentParams = z.object({ commentId: RecordIdSchema });

  /** What every correction answers with: the row as it now stands, read
   * back through the thread's own projection. */
  const CommentEnvelope = z.object({ comment: CommentSchema });

  /** The comment as a correction route needs it before it writes. */
  interface HeldComment {
    id: string;
    entityType: CommentEntityType;
    entityId: string;
    authorId: string;
    body: string;
    visibility: CommentVisibility;
    deletedAt: Date | null;
    redactedAt: Date | null;
  }

  /**
   * One comment, locked for the write that follows, or 404.
   *
   * Reach is the same one gate the thread uses. The viewer must reach
   * the record (CTR-021) **and** be in the room for the comment's tier
   * (DD-016) — a comment they cannot hear does not exist for them, so it
   * answers 404 and not 403. A refusal would say a Legal Only comment is
   * there, which is exactly the leak the tier model exists to prevent.
   *
   * The row is read inside the caller's transaction and locked, so two
   * corrections on one comment take turns rather than each overwriting
   * the other's revision row.
   */
  async function heldComment(
    tx: Transaction,
    user: AuthenticatedUser,
    commentId: string,
  ): Promise<HeldComment> {
    const [row] = await tx
      .select({
        id: comments.id,
        entityType: comments.entityType,
        entityId: comments.entityId,
        authorId: comments.authorId,
        body: comments.body,
        visibility: comments.visibility,
        deletedAt: comments.deletedAt,
        redactedAt: comments.redactedAt,
      })
      .from(comments)
      .where(eq(comments.id, commentId))
      .limit(1)
      .for("update");
    // The column admits types this API has no arm for, so a comment on
    // one of those is a comment this API cannot answer for. It is the
    // only place the raw column meets the seam: everywhere else the
    // entity type arrives already narrowed by a route schema.
    const entityType = row ? commentEntityType(row.entityType) : null;
    if (!row || !entityType) throw httpError(404, NO_COMMENT);
    // Asked on the same snapshot the write lands on, and on the same
    // connection: a grant dropped between the check and the update must
    // not authorize the correction, and a second pool connection taken
    // while this one holds a lock is a way to run the pool dry.
    //
    // The refusal is the comment's, not the record's: a comment the
    // viewer is not in the room for reads as a comment that is not
    // there. So this takes the audience that answers `null` rather than
    // the one that throws the record's own words.
    const audience = await commentAudience(tx, user, { entityType, entityId: row.entityId });
    if (!audience || !audience.tiers.includes(row.visibility)) throw httpError(404, NO_COMMENT);
    return { ...row, entityType };
  }

  /** The comment as it now stands, through the thread's own projection,
   * so a corrected row is the row the next load will draw. */
  async function readBack(tx: Transaction, commentId: string) {
    const [row] = await selectComments(tx).where(eq(comments.id, commentId));
    const [mentions, attachments] = await Promise.all([
      mentionsOf(tx, [commentId]),
      attachmentsOf(tx, [commentId]),
    ]);
    return toComment(row!, mentions.get(commentId), attachments.get(commentId));
  }

  app.get(
    "/comments/:commentId/attachments/:attachmentId",
    {
      preHandler: requireCommentReader,
      schema: {
        operationId: "downloadCommentAttachment",
        summary:
          "Download one live comment attachment through the same audience " +
          "arm and tier that exposed its comment. The entity reference is " +
          "the address the reader used for the thread, so a Requester can " +
          "continue through a converted Request while the stored comment " +
          "hangs from its Contract. A hidden tier, another attachment, and " +
          "either tombstone all answer 404",
        tags: ["comments"],
        params: CommentParams.extend({ attachmentId: RecordIdSchema }),
        querystring: EntityRefQuery,
        produces: ["application/octet-stream"],
        response: { 200: z.any(), default: problemResponse },
      },
    },
    async (request, reply) => {
      const [row] = await app.db
        .select({
          id: commentAttachments.id,
          fileRef: commentAttachments.fileRef,
          filename: commentAttachments.filename,
          commentEntityType: comments.entityType,
          commentEntityId: comments.entityId,
          visibility: comments.visibility,
          deletedAt: comments.deletedAt,
          redactedAt: comments.redactedAt,
        })
        .from(commentAttachments)
        .innerJoin(comments, eq(commentAttachments.commentId, comments.id))
        .where(
          and(
            eq(commentAttachments.id, request.params.attachmentId),
            eq(commentAttachments.commentId, request.params.commentId),
          ),
        )
        .limit(1);
      if (!row || row.deletedAt !== null || row.redactedAt !== null) {
        throw httpError(404, "No comment attachment exists with this id.");
      }
      const audience = await reachedThread(app.db, request.user, request.query);
      if (
        audience.entityType !== row.commentEntityType ||
        audience.entityId !== row.commentEntityId ||
        !audience.tiers.includes(row.visibility)
      ) {
        throw httpError(404, "No comment attachment exists with this id.");
      }

      reply.header("content-type", "application/octet-stream");
      reply.header("content-disposition", attachmentDisposition(row.filename));
      reply.header("x-content-type-options", "nosniff");
      return reply.send(await app.storage.get(row.fileRef));
    },
  );

  app.patch(
    "/comments/:commentId",
    {
      preHandler: requireCommentReader,
      schema: {
        operationId: "editComment",
        summary:
          "Change what a comment says. The author alone may, and an " +
          "Administrator is no exception — a correction to somebody " +
          "else's words is a redact, not an edit. The prior body goes to " +
          "comment_revisions and the row takes an edited marker, so a " +
          "reader can tell the text moved since they read it. The tier is " +
          "immutable (CMT-005): this route takes a body and nothing else. " +
          "A comment already deleted or redacted has no text to change. " +
          "Appends comment.edited at the comment's own tier",
        tags: ["comments"],
        params: CommentParams,
        body: z.strictObject({ body: CommentBodySchema }),
        response: { 200: CommentEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const comment = await app.db.transaction(async (tx) => {
        const held = await heldComment(tx, request.user, request.params.commentId);
        // Author-only, and the role does not widen it. An Administrator
        // may remove what somebody said; they may not put words in
        // their mouth.
        if (held.authorId !== request.user.id) {
          throw httpError(403, "Only the author can edit a comment.");
        }
        if (held.deletedAt !== null || held.redactedAt !== null) {
          throw httpError(409, "This comment has been removed. Its text cannot be changed.");
        }
        // Nothing changed, so nothing is written: an author who saves the
        // text they started with has not edited it, and the marker would
        // say they had.
        if (request.body.body === held.body) return readBack(tx, held.id);

        await tx.insert(commentRevisions).values({ commentId: held.id, body: held.body });
        await tx
          .update(comments)
          .set({ body: request.body.body, editedAt: new Date() })
          .where(eq(comments.id, held.id));
        await recordActivity(tx, {
          entityType: held.entityType,
          entityId: held.entityId,
          actorId: request.user.id,
          action: "comment.edited",
          visibility: held.visibility,
          // Ids only. The prior text is in comment_revisions, where a
          // redact can still reach it (CMT-006).
          payload: { commentId: held.id },
        });
        return readBack(tx, held.id);
      });
      return { comment };
    },
  );

  app.delete(
    "/comments/:commentId",
    {
      preHandler: requireCommentReader,
      schema: {
        operationId: "deleteComment",
        summary:
          "Take a comment back. The author alone may. The delete is soft " +
          "(CMT-005): the row keeps its place as a tombstone so the " +
          "thread around it still reads, and the body moves to " +
          "comment_revisions. Deleting a comment already removed writes " +
          "nothing and answers the row as it stands. Appends " +
          "comment.deleted at the comment's own tier",
        tags: ["comments"],
        params: CommentParams,
        response: { 200: CommentEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const comment = await app.db.transaction(async (tx) => {
        const held = await heldComment(tx, request.user, request.params.commentId);
        if (held.authorId !== request.user.id) {
          throw httpError(403, "Only the author can delete a comment.");
        }
        // Already gone, by either hand. Nothing to move and nothing to
        // say, so the second delete is the first one's answer.
        if (held.deletedAt !== null || held.redactedAt !== null) return readBack(tx, held.id);

        await tx.insert(commentRevisions).values({ commentId: held.id, body: held.body });
        // The body moves rather than being hidden: what the row carries
        // is what every read seam can answer with, so a tombstone that
        // still held the text would be one query from leaking it.
        await tx
          .update(comments)
          .set({ body: "", deletedAt: new Date() })
          .where(eq(comments.id, held.id));
        await recordActivity(tx, {
          entityType: held.entityType,
          entityId: held.entityId,
          actorId: request.user.id,
          action: "comment.deleted",
          visibility: held.visibility,
          payload: { commentId: held.id },
        });
        return readBack(tx, held.id);
      });
      return { comment };
    },
  );

  app.post(
    "/comments/:commentId/redact",
    {
      preHandler: requireAdministrator,
      schema: {
        operationId: "redactComment",
        summary:
          "Remove what a comment said, for good. An Administrator alone " +
          "may (CMT-005), on anybody's comment including their own. It " +
          "clears the body, every comment_revisions row, the list of " +
          "who the text named, and every attachment row and stored blob — " +
          "so paper or text posted into the wrong record is " +
          "gone rather than only hidden. This is the reason prior " +
          "versions live outside the append-only log (CMT-006). The row " +
          "stays as a tombstone, because the thread around it still has " +
          "to read. Appends comment.redacted at the comment's own tier",
        tags: ["comments"],
        params: CommentParams,
        response: { 200: CommentEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const comment = await app.db.transaction(async (tx) => {
        const held = await heldComment(tx, request.user, request.params.commentId);
        if (held.redactedAt !== null) return readBack(tx, held.id);

        // Read the references before clearing the rows. Storage deletion
        // follows DOC-010's recorded ordering: inside the transaction and
        // before commit, so a successful redact cannot strand bytes no
        // row remains to name.
        const paper = await tx
          .select({ fileRef: commentAttachments.fileRef })
          .from(commentAttachments)
          .where(eq(commentAttachments.commentId, held.id));
        for (const attachment of paper) await app.storage.delete(attachment.fileRef);

        // The places the text, its addressees, and its paper live. All
        // are ordinary application data, which is the whole point.
        await tx.delete(commentRevisions).where(eq(commentRevisions.commentId, held.id));
        await tx.delete(commentMentions).where(eq(commentMentions.commentId, held.id));
        await tx.delete(commentAttachments).where(eq(commentAttachments.commentId, held.id));
        await tx
          .update(comments)
          .set({ body: "", redactedAt: new Date() })
          .where(eq(comments.id, held.id));
        await recordActivity(tx, {
          entityType: held.entityType,
          entityId: held.entityId,
          actorId: request.user.id,
          action: "comment.redacted",
          visibility: held.visibility,
          payload: { commentId: held.id },
        });
        return readBack(tx, held.id);
      });
      return { comment };
    },
  );
};
