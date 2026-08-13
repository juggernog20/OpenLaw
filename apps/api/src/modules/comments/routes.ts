// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The comment thread (M9/2) — reading it and posting into it.
 *
 * The routes are keyed by an entity reference rather than by a record's
 * own address, because the thread is one machinery across matters,
 * contracts, documents, and requests (CMT-001). Matters (M22) and
 * documents (M11) mount these same routes; the entity vocabulary the
 * table admits is the full four, and the API accepts `contract` alone
 * until the other records exist.
 *
 * The thread is flat and chronological (CMT-002). There is no nesting,
 * no `parent_comment_id`, and no paging: a short conversation between a
 * handful of people is read top to bottom.
 *
 * **Every read is filtered at query time** (DD-016). What the viewer may
 * not hear never leaves the database, so the thread carries no
 * placeholder, no gap, and no count of what was left out. There is no
 * total in the envelope either — the client counts the rows it was given,
 * which is the only number that cannot leak.
 *
 * `contractAudience` is the one gate. It answers which contract this
 * viewer reaches (CTR-021) and which DD-016 tiers they are in the room
 * for, and `null` for anything else. Both the read and the write take
 * it, so a Contributor is refused the Legal Only tier by the same fact
 * that hides Legal Only comments from them — the client's own composer
 * offering two segments is a convenience, never the enforcement.
 *
 * **The tier is immutable after posting** (CMT-005). There is no update
 * route on this module at all, so no request body can reach one: a
 * comment in the wrong room is deleted and reposted.
 *
 * Posting appends a `comment.posted` activity entry at the comment's own
 * tier, in the same transaction, so a Legal Only comment leaves no trace
 * in anyone else's feed. The entry carries ids only — no comment text
 * ever enters an activity payload, because the log is append-only
 * (DD-017) and a hard redact has to be able to remove what was said
 * (CMT-006).
 *
 * An archived record still takes comments. Archiving is a soft delete
 * for mistakes and imports (CONTEXT.md) and it freezes the record's
 * fields; the conversation about why it was archived is not one of them.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, comments, COMMENT_VISIBILITIES, eq, inArray, users } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { contractAudience } from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

/**
 * The contract read floor (CTR-021), which is the comment floor too: a
 * Contributor takes part in the conversation on a contract they are on.
 * The role alone opens no thread — `contractAudience` narrows it to the
 * records they hold a `contract_team` row on. Business Users are refused
 * on every contract surface in M9.
 */
const requireCommentReader = requireRole("administrator", "legal_team_member", "contributor");

/**
 * What a comment can hang off, as the API accepts it. The table's CHECK
 * admits `matter | contract | document | request`, matching the
 * `activity_log` precedent; only contracts are reachable until the other
 * records land.
 */
const CommentEntityType = z.enum(["contract"]);

/**
 * The record's id. Bounded rather than shaped: every id in this API is
 * an opaque text primary key, and no route asserts a UUID pattern, so
 * this one must not either — the bound is here to refuse junk before it
 * reaches a query, not to rule on what an id looks like. A well-formed
 * id for a record the viewer cannot reach still answers 404.
 */
const RecordIdSchema = z.string().min(1).max(64);

/** Plain text, capped where every other free-text field is capped.
 * Rich text, attachments, and reactions are deliberately out. */
const CommentBodySchema = z.string().trim().min(1).max(10_000);

const VisibilitySchema = z.enum(COMMENT_VISIBILITIES);

/** The author as every comment row draws them — the same person shape
 * the record's roster uses, so one face renders one way (DES-018). */
const AuthorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});

const CommentSchema = z.object({
  id: z.string(),
  entityType: CommentEntityType,
  entityId: z.string(),
  author: AuthorSchema,
  body: z.string(),
  visibility: VisibilitySchema,
  createdAt: z.iso.datetime({ offset: true }),
});

/** The reference the thread is keyed by — one record, named by type and
 * id rather than by a contract's CTR-003 number, because the panel that
 * reads it is entity-generic. */
const EntityRefQuery = z.object({
  entityType: CommentEntityType,
  entityId: RecordIdSchema,
});

/** A record a viewer cannot reach reads exactly as one that does not
 * exist. A refusal would tell them it is there. */
const NO_RECORD = "No record exists with this reference.";

export const commentsRoutes: FastifyPluginAsyncZod = async (app) => {
  type Tx = Parameters<Parameters<typeof app.db.transaction>[0]>[0];
  type Executor = typeof app.db | Tx;

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

  function toComment(row: ThreadRow) {
    return {
      id: row.id,
      // Narrowed for the response schema: the column admits four types,
      // and only contracts can have reached this far.
      entityType: row.entityType as "contract",
      entityId: row.entityId,
      author: {
        id: row.author.id,
        displayName: row.author.displayName,
        image: row.author.image,
        archived: row.author.archivedAt !== null,
      },
      body: row.body,
      visibility: row.visibility,
      createdAt: row.createdAt.toISOString(),
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
          "answers 404, exactly as one that does not exist",
        tags: ["comments"],
        querystring: EntityRefQuery,
        response: {
          200: z.object({ comments: z.array(CommentSchema) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const audience = await contractAudience(app.db, request.user, request.query.entityId);
      if (!audience) throw httpError(404, NO_RECORD);
      const rows = await selectComments(app.db)
        .where(
          and(
            eq(comments.entityType, request.query.entityType),
            eq(comments.entityId, audience.contractId),
            inArray(comments.visibility, [...audience.tiers]),
          ),
        )
        // Oldest first, as a conversation is read. The id breaks a
        // same-instant tie: uuidv7 is time-ordered, so that order is
        // still the posting order.
        .orderBy(asc(comments.createdAt), asc(comments.id));
      return { comments: rows.map(toComment) };
    },
  );

  app.post(
    "/comments",
    {
      preHandler: requireCommentReader,
      schema: {
        operationId: "postComment",
        summary:
          "Post a comment on a record at one of the DD-016 tiers. The " +
          "seam refuses a tier the poster is not in the room for, so a " +
          "Contributor cannot post Legal Only whatever the client sends. " +
          "The tier is immutable afterwards (CMT-005) — there is no " +
          "route that changes it. Appends a comment.posted activity " +
          "entry at the comment's own tier, in the same transaction",
        tags: ["comments"],
        body: z.strictObject({
          entityType: CommentEntityType,
          entityId: RecordIdSchema,
          body: CommentBodySchema,
          visibility: VisibilitySchema,
        }),
        response: {
          201: z.object({ comment: CommentSchema }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const { entityType, entityId, body, visibility } = request.body;
      const audience = await contractAudience(app.db, request.user, entityId);
      if (!audience) throw httpError(404, NO_RECORD);
      // The composer offers a Contributor two segments; this is the
      // refusal that holds when the request does not come from it.
      if (!audience.tiers.includes(visibility)) {
        throw httpError(403, "You cannot post a comment at that visibility tier.");
      }

      const row = await app.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(comments)
          .values({
            entityType,
            entityId: audience.contractId,
            authorId: request.user.id,
            body,
            visibility,
          })
          .returning({ id: comments.id });
        // The entry rides the comment's own tier, so it is hidden from
        // exactly the people the comment is hidden from. Ids only: the
        // log is append-only, and text in a payload could never be
        // redacted out of it.
        await recordActivity(tx, {
          entityType,
          entityId: audience.contractId,
          actorId: request.user.id,
          action: "comment.posted",
          visibility,
          payload: { commentId: created!.id },
        });
        // Read back through the same projection the thread uses, so the
        // row the poster gets is the row they will see on the next load.
        const [posted] = await selectComments(tx).where(eq(comments.id, created!.id));
        return posted!;
      });

      return reply.status(201).send({ comment: toComment(row) });
    },
  );
};
