// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record activity feed (M9/6, DD-017) — the first read surface over
 * `activity_log`, which has been filling up since M5 with nobody able to
 * open it.
 *
 * The route is keyed by an entity reference rather than by a record's
 * own address, exactly as the comment thread is: the panel that reads it
 * is entity-generic, and matters (M22) and documents (M11) mount the
 * same component. The `activity_log` entity vocabulary is already the
 * full seven; the API accepts `contract` alone until the other records
 * exist.
 *
 * **The feed is filtered at query time by the same predicate the thread
 * uses** (DD-016, DD-017). `contractAudience` is the one gate: it
 * answers which contract this viewer reaches (CTR-021) and which tiers
 * they are in the room for, and `null` for anything else. A comment
 * entry rides the comment's own tier (CMT-006), so a Legal Only comment
 * leaves no trace in a Contributor's feed — not a row, not a gap, not a
 * number. There is no total in the envelope for that reason, as there is
 * none on the thread.
 *
 * `admin_only` never reaches a record feed, and no code here excludes it
 * on purpose. `readableTiers` answers the three DD-016 tiers and nothing
 * else, so settings, user administration, and security entries are out
 * by the same fact that puts Legal Only out of a Contributor's reach.
 * The Administrator's audit log (M9/7) is the surface for those, and it
 * reads the table without an entity scope.
 *
 * **The feed pages, from the start.** A contract that runs for two years
 * has a long log behind it, and its record still has to open quickly —
 * this is the unbounded list of #125 not repeated. The page size is a
 * server constant, not a client parameter, following the counterparty
 * search's precedent: a client cannot ask for the whole history because
 * there is no way to ask.
 *
 * The cursor is one entry's id and nothing else. Paging is keyset on
 * `(created_at, id)`, which is the order the feed reads in and the
 * leading columns of `activity_log_entity_idx`. A cursor naming a row
 * that is not there answers an empty page rather than an error: the log
 * is append-only, so that can only mean the client held a cursor from a
 * different table state, and an empty page is the truthful answer.
 *
 * **Read-only, and only read.** Nothing in this module writes. DD-017
 * forbids `UPDATE` and `DELETE` on `activity_log` in application code,
 * and opening a read surface is not an excuse to add the first one.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { activityLog, and, COMMENT_VISIBILITIES, desc, eq, inArray, sql, users } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { contractAudience } from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

/**
 * The contract read floor (CTR-021), which is the feed floor too: a
 * Contributor on a contract's team reads that record's narrative.
 * `contractAudience` narrows the role to the records they hold a
 * `contract_team` row on. Business Users are refused on every contract
 * surface in M9.
 */
const requireFeedReader = requireRole("administrator", "legal_team_member", "contributor");

/**
 * How many entries one request answers. A server constant rather than a
 * client parameter, as the counterparty search's cap is: the point of
 * paging here is that no request returns the whole history, and a limit
 * the client picks is a limit the client can decline to pick.
 */
const PAGE_SIZE = 25;

/**
 * What the feed hangs off, as the API accepts it. The table's CHECK
 * admits the full seven; only contracts are reachable until the other
 * records land.
 */
const ActivityEntityType = z.enum(["contract"]);

/** The record's id. Bounded rather than shaped, as every id in this API
 * is: an opaque text primary key, with no UUID pattern asserted
 * anywhere. A well-formed id for a record the viewer cannot reach still
 * answers 404. */
const RecordIdSchema = z.string().min(1).max(64);

/** The actor as every entry draws them — the same person shape the
 * comment thread and the record's roster use, so one face renders one
 * way (DES-018). */
const ActorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});

const ActivityEntrySchema = z.object({
  id: z.string(),
  /**
   * The action slug, as plain text rather than as an enum.
   *
   * The write side's vocabulary is closed on purpose — a mistyped slug
   * would be a permanently unqueryable row. The read side's cannot be.
   * The log is append-only and nothing prunes it, so a slug written by
   * a version of this application that no longer exists is still in the
   * table and still has to come out. The narration layer renders an
   * unrecognised slug plainly instead of throwing, and a closed enum
   * here would have the response serializer throw first.
   */
  action: z.string(),
  /** The DD-016 tier this entry rides. `admin_only` cannot appear: no
   * record feed reads it. */
  visibility: z.enum(COMMENT_VISIBILITIES),
  /** Who acted. NULL for a system-emitted event with no human actor. */
  actor: ActorSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  /**
   * The action's own data — old and new values for an edit, the names
   * on a team change, the id of a comment. Untyped by design: each slug
   * carries its own shape, the shapes are as old as the rows, and the
   * narration layer reads them defensively. No comment text is ever in
   * here (CMT-006).
   */
  payload: z.record(z.string(), z.unknown()),
});

/** A record a viewer cannot reach reads exactly as one that does not
 * exist. A refusal would tell them it is there. */
const NO_RECORD = "No record exists with this reference.";

export const activityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/activity",
    {
      preHandler: requireFeedReader,
      schema: {
        operationId: "listActivity",
        summary:
          "One record's activity feed, newest first (DD-017), filtered " +
          "at query time to the DD-016 tiers the viewer is in the room " +
          "for. A comment entry rides the comment's own tier, so a Legal " +
          "Only comment leaves no trace for anyone who could not read " +
          "it — no row, no gap, and no count. `admin_only` entries never " +
          "appear here; the Administrator's audit log is their surface. " +
          "Paged from a server-fixed page size: pass the previous page's " +
          "`nextCursor` to read further back. A record the viewer cannot " +
          "reach answers 404, exactly as one that does not exist",
        tags: ["activity"],
        querystring: z.object({
          entityType: ActivityEntityType,
          entityId: RecordIdSchema,
          /** The previous page's `nextCursor`. Omit for the first page. */
          cursor: RecordIdSchema.optional(),
        }),
        response: {
          200: z.object({
            entries: z.array(ActivityEntrySchema),
            /** Pass back as `cursor` for the next page. NULL when this
             * page is the end of the feed. */
            nextCursor: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const { entityType, entityId, cursor } = request.query;
      const audience = await contractAudience(app.db, request.user, entityId);
      if (!audience) throw httpError(404, NO_RECORD);

      // Keyset, on the pair the feed is ordered by. The cursor row's own
      // position comes from the table rather than from the client, so a
      // client cannot hand over a timestamp that was never written. The
      // lookup carries the same record scope the page does, so a cursor
      // from another record cannot set this record's boundary — a
      // cursor is a place in one feed, not a timestamp in the table. A
      // cursor naming no row in this feed leaves the comparison NULL,
      // which answers an empty page — the truthful answer for a cursor
      // into a state this feed is not in.
      const before = cursor
        ? sql`(${activityLog.createdAt}, ${activityLog.id}) < (
            select ${activityLog.createdAt}, ${activityLog.id}
            from ${activityLog}
            where ${activityLog.id} = ${cursor}
              and ${activityLog.entityType} = ${entityType}
              and ${activityLog.entityId} = ${audience.contractId}
          )`
        : undefined;

      const rows = await app.db
        .select({
          id: activityLog.id,
          action: activityLog.action,
          visibility: activityLog.visibility,
          createdAt: activityLog.createdAt,
          payload: activityLog.payload,
          actor: {
            id: users.id,
            displayName: users.displayName,
            image: users.image,
            archivedAt: users.archivedAt,
          },
        })
        .from(activityLog)
        // Left, because an entry with no human actor is a real entry.
        .leftJoin(users, eq(activityLog.actorId, users.id))
        .where(
          and(
            eq(activityLog.entityType, entityType),
            eq(activityLog.entityId, audience.contractId),
            inArray(activityLog.visibility, [...audience.tiers]),
            before,
          ),
        )
        // Newest first, as a history is read. The id breaks a
        // same-instant tie: uuidv7 is time-ordered, so that order is
        // still the order things happened in.
        .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
        // One past the page, which is how the answer knows whether there
        // is more without counting anything. A count over the whole feed
        // would be a number computed from rows this viewer never sees.
        .limit(PAGE_SIZE + 1);

      const page = rows.slice(0, PAGE_SIZE);
      return {
        entries: page.map((row) => ({
          id: row.id,
          action: row.action,
          // Narrowed for the response schema: the column admits
          // `admin_only`, and the tier filter above cannot let one
          // through.
          visibility: row.visibility as (typeof COMMENT_VISIBILITIES)[number],
          actor: row.actor?.id
            ? {
                id: row.actor.id,
                displayName: row.actor.displayName,
                image: row.actor.image,
                archived: row.actor.archivedAt !== null,
              }
            : null,
          createdAt: row.createdAt.toISOString(),
          payload: row.payload,
        })),
        // Only when a further row was actually read. A cursor on the
        // last page would send the client for an empty one.
        nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );
};
