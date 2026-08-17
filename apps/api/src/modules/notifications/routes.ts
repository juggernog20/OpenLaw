// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The bell, as the API answers it (NOT-001, NOT-005).
 *
 * Two reads and two writes. **The list** is this person's items, newest
 * first, paged. **The count** is their unread badge, which NOT-005 caps
 * at "9+" for display — the cap is the badge's, not the number's, so
 * this answers the count and the surface decides how to draw it.
 *
 * The two writes are NOT-005's whole read model. **Marking a page read**
 * is what opening the centre does: there is no per-item read ceremony,
 * so the only thing that makes an item read is having been shown it.
 * **Marking everything read** is the affordance that zeroes the badge
 * after a holiday. Both answer the unread count that remains, for the
 * reason `POST /comments/read` does: the badge takes the server's
 * number rather than assuming its own write cleared it.
 *
 * **Every route here is the signed-in person's, and only theirs.** There
 * is no user parameter and no way to ask for — or to write on — somebody
 * else's bell: a notification is addressed to one person, and the
 * address is the whole scope. An id naming another person's item is not
 * refused, because a refusal would answer the question "does this id
 * exist"; it simply matches nothing.
 *
 * **All four re-apply the confidentiality predicate** (DD-014, M10). An item
 * written while a record was open is an item about a record that may
 * since have been walled off, and the answer is M10's: it leaves the
 * list *and* the count, silently. Not a tombstone, not a gap, and not a
 * number that says something was left out — the filter is in the query,
 * so the omitted row never leaves the database. The row itself stays
 * where it is; opening the wall again brings the item back, because
 * nothing was destroyed to hide it.
 *
 * **The list pages the way every feed in this API pages**: keyset on
 * `(created_at, id)`, a server-fixed page size, and a cursor that is one
 * item's id. A cursor naming no row in *this* person's scope answers an
 * empty page rather than an error — the same property the activity feed
 * relies on, and here it is what stops a cursor being a way to ask
 * whether an item exists.
 *
 * **There is no total**, for the reason the record feed has none: a
 * count over rows the viewer cannot see would announce them. The unread
 * count is a different number — it is computed over the rows they *can*
 * see, through the same predicate.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, count, desc, eq, inArray, isNull, notifications, sql } from "@openlaw/db";
import type { Executor } from "@openlaw/db";
import { requireAuth } from "../../auth/guards.js";
import type { AuthenticatedUser } from "../../auth/user.js";
import { notificationScope } from "../../lib/notifications/audience.js";
import { problemResponse } from "../../lib/problem.js";

/**
 * How many items one request answers. A server constant rather than a
 * client parameter, as every paged read in this API has it: the point of
 * paging is that no request returns the whole bell, and a limit the
 * client picks is a limit the client can decline to pick.
 */
const PAGE_SIZE = 25;

/** One item's id, as a cursor. Bounded rather than shaped, like every
 * id in this API. */
const RecordIdSchema = z.string().min(1).max(64);

/** What both writes answer: the badge that remains (NOT-005). */
const UnreadEnvelope = z.object({ unread: z.number().int().nonnegative() });

/**
 * The badge, over exactly the rows the list would answer with.
 *
 * One function, asked by the count route and by both writes, so the
 * number a write hands back can never disagree with the number a poll
 * would read a moment later.
 */
async function unreadCount(db: Executor, user: AuthenticatedUser): Promise<number> {
  const [row] = await db
    .select({ unread: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, user.id),
        isNull(notifications.readAt),
        // The same predicate the list composes. One rule, so the badge
        // can never promise an item the centre will not draw.
        notificationScope(db, user),
      ),
    );
  return row?.unread ?? 0;
}

const NotificationSchema = z.object({
  id: z.string(),
  /**
   * The catalog slug (NOT-002), as plain text rather than as an enum.
   *
   * The write side's vocabulary is closed; the read side's cannot be,
   * for `activity_log.action`'s reason — a row written by a build that
   * no longer exists is still in the table and still has to come out,
   * and a closed enum here would have the response serializer throw on
   * it first.
   */
  eventType: z.string(),
  /** What the item is about. Only `contract` is written in M18. */
  entityType: z.string(),
  entityId: z.string(),
  /**
   * What the surface renders the item from, snapshotted when it fired.
   * Untyped by design: each slug carries its own shape, and the
   * renderer reads it defensively — the activity feed's own contract.
   */
  payload: z.record(z.string(), z.unknown()),
  /** NULL while unread. Opening the centre is what sets it (NOT-005). */
  readAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const notificationsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/notifications",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listNotifications",
        summary:
          "The signed-in person's notifications, newest first (NOT-001). " +
          "There is no way to ask for anybody else's: a notification is " +
          "addressed to one person and the address is the whole scope. " +
          "An item about a record the reader can no longer reach — a " +
          "contract walled off after the item was written (DD-014) — is " +
          "silently omitted: no row, no gap, and no number that says " +
          "something was left out. Paged from a server-fixed page size: " +
          "pass the previous page's `nextCursor` to read further back. " +
          "A cursor naming nothing in this person's bell answers an " +
          "empty page rather than an error",
        tags: ["notifications"],
        querystring: z.object({
          /** The previous page's `nextCursor`. Omit for the first page. */
          cursor: RecordIdSchema.optional(),
        }),
        response: {
          200: z.object({
            notifications: z.array(NotificationSchema),
            /** Pass back as `cursor` for the next page. NULL when this
             * page is the end of the bell. */
            nextCursor: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const mine = eq(notifications.userId, request.user.id);
      // Keyset, on the pair the bell is ordered by, with the cursor
      // row's own position read from the table rather than taken from
      // the client. The lookup carries this person's own scope, so a
      // cursor from somebody else's bell cannot set the boundary of
      // this one — and one that names no row here leaves the comparison
      // NULL, which answers an empty page.
      const before = request.query.cursor
        ? sql`(${notifications.createdAt}, ${notifications.id}) < (
            select ${notifications.createdAt}, ${notifications.id}
            from ${notifications}
            where ${notifications.id} = ${request.query.cursor}
              and ${notifications.userId} = ${request.user.id}
          )`
        : undefined;

      const rows = await app.db
        .select({
          id: notifications.id,
          eventType: notifications.eventType,
          entityType: notifications.entityType,
          entityId: notifications.entityId,
          payload: notifications.payload,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(and(mine, notificationScope(app.db, request.user), before))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        // One past the page, which is how the answer knows whether
        // there is more without counting anything.
        .limit(PAGE_SIZE + 1);

      const page = rows.slice(0, PAGE_SIZE);
      return {
        notifications: page.map((row) => ({
          id: row.id,
          eventType: row.eventType,
          entityType: row.entityType,
          entityId: row.entityId,
          payload: row.payload,
          readAt: row.readAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
        // Only when a further row was actually read. A cursor on the
        // last page would send the client for an empty one.
        nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.get(
    "/notifications/unread-count",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "unreadNotificationCount",
        summary:
          "How many unread notifications the signed-in person has " +
          "(NOT-005) — the number behind the top-nav badge. It is the " +
          "whole count, not the capped one: NOT-005's '9+' is how the " +
          "badge draws it, and the cap belongs to the surface. It is " +
          "computed over exactly the items the list would answer with, " +
          "through the same confidentiality predicate, so an item about " +
          "a since-walled-off record leaves the count as silently as it " +
          "leaves the list",
        tags: ["notifications"],
        response: { 200: UnreadEnvelope, default: problemResponse },
      },
    },
    async (request) => ({ unread: await unreadCount(app.db, request.user) }),
  );

  app.post(
    "/notifications/read",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "markNotificationsRead",
        summary:
          "Mark the named items read — what opening the notification " +
          "centre does with the page it just drew (NOT-005). There is " +
          "no per-item read ceremony, so being shown an item is the " +
          "only thing that reads it. One page's worth of ids at a time, " +
          "because the centre draws a page at a time. Ids that are not " +
          "this person's, are already read, or are about a record they " +
          "can no longer reach match nothing and are not refused — a " +
          "refusal would answer whether an id exists. Answers the " +
          "unread count that remains: normally what the page did not " +
          "cover, plus whatever landed while it was being read",
        tags: ["notifications"],
        body: z.strictObject({
          /** The ids of the items just drawn. One page's worth is the
           * bound, because that is the unit the centre reads in. */
          ids: z.array(RecordIdSchema).min(1).max(PAGE_SIZE),
        }),
        response: { 200: UnreadEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      // One transaction, so the count is read on the snapshot the write
      // landed on rather than on whatever the next connection sees.
      await app.db.transaction(async (tx) => {
        await tx
          .update(notifications)
          .set({ readAt: sql`now()` })
          .where(
            and(
              inArray(notifications.id, request.body.ids),
              eq(notifications.userId, request.user.id),
              // Already-read items keep the stamp they got the first
              // time. "When was this read" is a fact about the first
              // sighting, and a second page draw must not move it.
              isNull(notifications.readAt),
              // The wall applies to the write as it applies to the
              // reads. An item the reader can no longer be shown is an
              // item they cannot have read, so it stays unread — and
              // invisible, so nothing counts it either.
              notificationScope(tx, request.user),
            ),
          );
        return { unread: await unreadCount(tx, request.user) };
      }),
  );

  app.post(
    "/notifications/read-all",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "markAllNotificationsRead",
        summary:
          "Mark every unread item read — the affordance that zeroes the " +
          "badge after a holiday (NOT-005). It covers exactly what the " +
          "badge counts, so an item about a record the reader can no " +
          "longer reach is left alone: it is already outside the count, " +
          "and clearing it would be a write on a record they cannot " +
          "see. Answers the unread count that remains, which is zero " +
          "unless something landed while the request was in flight",
        tags: ["notifications"],
        response: { 200: UnreadEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      await app.db.transaction(async (tx) => {
        await tx
          .update(notifications)
          .set({ readAt: sql`now()` })
          .where(
            and(
              eq(notifications.userId, request.user.id),
              isNull(notifications.readAt),
              notificationScope(tx, request.user),
            ),
          );
        return { unread: await unreadCount(tx, request.user) };
      }),
  );
};
