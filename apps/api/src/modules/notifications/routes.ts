// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The bell and its preferences, as the API answers them (NOT-001,
 * NOT-005).
 *
 * **There are two bells and one of everything else.** NOT-001 puts one
 * notification system on two rendering surfaces: the staff notification
 * centre at `/notifications`, and the portal bell at
 * `/portal/notifications`. They are the same four routes registered
 * twice — one implementation, one read model, one paging rule — and what
 * differs between the mounts is which rows they may answer with
 * (`NotificationSurface`). A second mount rather than a parameter on one,
 * for the reason the portal's configuration reads are their own mount
 * (the INT-001 M20/3 addendum): the address says which surface is
 * asking, so neither route ever means two things.
 *
 * **The preferences pair is mounted once and serves both**, because a
 * preference is one person's whichever bell they are looking at. The
 * model is the model, and which of NOT-002's five groups a surface draws
 * is the surface's business.
 *
 * Two reads and two writes for each bell, and a read/write pair for the
 * preferences behind them. **The list** is this person's items, newest
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
 * **The preferences pair is the pane behind the bell** (inventory row
 * ST3): what each of NOT-002's five groups does for this person, and a
 * save of one group on one channel. The write is an override on a table
 * the fan-out already reads, so a saved toggle changes the very next
 * event with nothing else wired to it.
 *
 * **Every route here is the signed-in person's, and only theirs.** There
 * is no user parameter and no way to ask for — or to write on — somebody
 * else's bell or somebody else's preferences: both are addressed to one
 * person, and the address is the whole scope. An id naming another
 * person's item is not refused, because a refusal would answer the
 * question "does this id exist"; it simply matches nothing.
 *
 * **All four re-apply the surface's own reach predicate** (DD-014,
 * DD-013, M10). On the staff mount that is the confidentiality wall: an
 * item written while a record was open is an item about a record that
 * may since have been walled off, and the answer is M10's: it leaves the
 * list *and* the count, silently. Not a tombstone, not a gap, and not a
 * number that says something was left out — the filter is in the query,
 * so the omitted row never leaves the database. The row itself stays
 * where it is; opening the wall again brings the item back, because
 * nothing was destroyed to hide it. On the portal mount it is the pair
 * of facts a Request can still change — still live, still this person's
 * — and it fails the same way, silently.
 *
 * **The predicate is also what keeps the two bells apart.** A staff
 * mark-all-read cannot reach a group-5 row, because a group-5 row is not
 * in the staff predicate at all; the portal's cannot reach a contract
 * row for the mirror reason. A person who is both a Member+ and a
 * Requester has two bells with two badges, and neither one reads the
 * other.
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
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  notifications,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_GROUPS,
  sql,
} from "@openlaw/db";
import type { Executor } from "@openlaw/db";
import { requireAuth } from "../../auth/guards.js";
import type { AuthenticatedUser } from "../../auth/user.js";
import { recordActivity } from "../../lib/activity.js";
import { notificationScope, type NotificationSurface } from "../../lib/notifications/audience.js";
import { myChannelChoices, saveChannelChoice } from "../../lib/notifications/preferences.js";
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
async function unreadCount(
  db: Executor,
  user: AuthenticatedUser,
  surface: NotificationSurface,
): Promise<number> {
  const [row] = await db
    .select({ unread: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, user.id),
        isNull(notifications.readAt),
        // The same predicate the list composes, on the same surface. One
        // rule, so the badge can never promise an item the centre will
        // not draw — and never count an item that belongs to the other
        // bell.
        notificationScope(db, user, surface),
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
  /** What the item is about: `contract` on the staff mount, `request`
   * on the portal one. Never both in one answer — the mount's own
   * predicate is what makes that true. */
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

/**
 * One event group's answer for one person, per channel (NOT-001/002).
 *
 * The **effective** answer, not the stored one: the table holds
 * overrides, so a group with no row reads as its default and the pane
 * has no way — and no need — to tell the two apart. `in_app` is the
 * bell, `email` is the mail; a person with the bell off for a group
 * hears nothing from it at all, because the row the email hangs off is
 * the bell row.
 */
const PreferenceSchema = z.object({
  eventGroup: z.enum(NOTIFICATION_EVENT_GROUPS),
  inApp: z.boolean(),
  email: z.boolean(),
});

/** All five groups, in NOT-002's order. The read and the write answer
 * the same envelope, so a save needs no second request to be sure of
 * what it left behind. */
const PreferencesEnvelope = z.object({ groups: z.array(PreferenceSchema) });

/**
 * One bell, as a mount: where it sits, which rows it may answer with,
 * and what its four routes are called.
 *
 * The two mounts below are the whole of the difference between the staff
 * notification centre and the portal bell. Everything else — the paging,
 * the read model, the envelopes, the "no user parameter" rule — is the
 * one implementation in {@link bellRoutes}.
 */
interface BellMount {
  /** Which rows this mount may answer with (NOT-001). */
  surface: NotificationSurface;
  /** Where the four routes sit, under the shared `/api/v1` prefix. */
  path: "/notifications" | "/portal/notifications";
  /** The four operationIds, which are the generated client's own method
   * names and so have to be distinct across the two mounts. */
  operationIds: { list: string; count: string; read: string; readAll: string };
  /** The four summaries. Written out per mount rather than templated:
   * what each says about scope is genuinely different, and a summary is
   * the one place a reader of the API learns which bell they are on. */
  summaries: { list: string; count: string; read: string; readAll: string };
}

/** The staff notification centre (NOT-001, NOT-005, M18/2). */
const STAFF_BELL: BellMount = {
  surface: "staff",
  path: "/notifications",
  operationIds: {
    list: "listNotifications",
    count: "unreadNotificationCount",
    read: "markNotificationsRead",
    readAll: "markAllNotificationsRead",
  },
  summaries: {
    list:
      "The signed-in person's staff notifications, newest first " +
      "(NOT-001). There is no way to ask for anybody else's: a " +
      "notification is addressed to one person and the address is the " +
      "whole scope. This is the **staff** notification centre, so it " +
      "answers items about contracts and never a Requester's group-5 " +
      "items — those are the portal bell's, at " +
      "`/portal/notifications`. An item about a record the reader can " +
      "no longer reach — a contract walled off after the item was " +
      "written (DD-014) — is silently omitted: no row, no gap, and no " +
      "number that says something was left out. Paged from a " +
      "server-fixed page size: pass the previous page's `nextCursor` to " +
      "read further back. A cursor naming nothing in this person's bell " +
      "answers an empty page rather than an error",
    count:
      "How many unread staff notifications the signed-in person has " +
      "(NOT-005) — the number behind the top-nav badge. It is the whole " +
      "count, not the capped one: NOT-005's '9+' is how the badge draws " +
      "it, and the cap belongs to the surface. It is computed over " +
      "exactly the items the list would answer with, through the same " +
      "confidentiality predicate, so an item about a since-walled-off " +
      "record leaves the count as silently as it leaves the list",
    read:
      "Mark the named items read — what opening the notification " +
      "centre does with the page it just drew (NOT-005). There is no " +
      "per-item read ceremony, so being shown an item is the only thing " +
      "that reads it. One page's worth of ids at a time, because the " +
      "centre draws a page at a time. Ids that are not this person's, " +
      "are already read, are about a record they can no longer reach, " +
      "or belong to their portal bell match nothing and are not refused " +
      "— a refusal would answer whether an id exists. Answers the " +
      "unread count that remains: normally what the page did not cover, " +
      "plus whatever landed while it was being read",
    readAll:
      "Mark every unread staff item read — the affordance that zeroes " +
      "the badge after a holiday (NOT-005). It covers exactly what the " +
      "badge counts, so an item about a record the reader can no longer " +
      "reach is left alone: it is already outside the count, and " +
      "clearing it would be a write on a record they cannot see. A " +
      "group-5 item on the same person's portal bell is left alone too, " +
      "for the stronger reason that it is not on this surface at all. " +
      "Answers the unread count that remains, which is zero unless " +
      "something landed while the request was in flight",
  },
};

/** The portal bell (NOT-001, NOT-005, INT-001, M20/9). */
const PORTAL_BELL: BellMount = {
  surface: "portal",
  path: "/portal/notifications",
  operationIds: {
    list: "listPortalNotifications",
    count: "unreadPortalNotificationCount",
    read: "markPortalNotificationsRead",
    readAll: "markAllPortalNotificationsRead",
  },
  summaries: {
    list:
      "The signed-in person's portal notifications, newest first " +
      "(NOT-001, INT-001) — NOT-002's group 5, about their own " +
      "Requests. The gate is a session and nothing else, the portal's " +
      "own rule: Member+ staff submit Requests too, and on this surface " +
      "they are a Requester like anybody else. There is no way to ask " +
      "for anybody else's, and no way to reach a contract item from " +
      "here — that is the staff notification centre, at " +
      "`/notifications`. An item about a Request the reader is no " +
      "longer the Requester of, or one that has since been archived, is " +
      "silently omitted: no row, no gap, and no number that says " +
      "something was left out. Paged from a server-fixed page size: " +
      "pass the previous page's `nextCursor` to read further back. A " +
      "cursor naming nothing in this person's bell answers an empty " +
      "page rather than an error",
    count:
      "How many unread portal notifications the signed-in person has " +
      "(NOT-005) — the number behind the portal bell's badge. It is the " +
      "whole count, not the capped one: '9+' is how the badge draws it, " +
      "and the cap belongs to the surface. It is computed over exactly " +
      "the items the list would answer with, through the same " +
      "predicate, so an item about an archived Request leaves the count " +
      "as silently as it leaves the list",
    read:
      "Mark the named portal items read — what opening the portal bell " +
      "does with the page it just drew (NOT-005). There is no per-item " +
      "read ceremony, so being shown an item is the only thing that " +
      "reads it. One page's worth of ids at a time, because the panel " +
      "draws a page at a time. Ids that are not this person's, are " +
      "already read, are about a Request they can no longer reach, or " +
      "belong to their staff notification centre match nothing and are " +
      "not refused — a refusal would answer whether an id exists. " +
      "Answers the unread count that remains",
    readAll:
      "Mark every unread portal item read — the affordance that zeroes " +
      "the portal badge (NOT-005). It covers exactly what the badge " +
      "counts, so an item about an archived Request is left alone, and " +
      "so is a staff item on the same person's notification centre: it " +
      "is not on this surface at all. Answers the unread count that " +
      "remains, which is zero unless something landed while the request " +
      "was in flight",
  },
};

/**
 * One bell's four routes, over one surface's rows.
 *
 * A factory rather than a plugin, because the two mounts differ by
 * exactly the three things {@link BellMount} names and by nothing else.
 * The read model, the keyset, the page size, and the "no user parameter"
 * rule are written once here, so a change to any of them reaches both
 * bells or neither.
 */
function bellRoutes(mount: BellMount): FastifyPluginAsyncZod {
  const { surface } = mount;
  return async (app) => {
    app.get(
      mount.path,
      {
        preHandler: requireAuth,
        schema: {
          operationId: mount.operationIds.list,
          summary: mount.summaries.list,
          tags: ["notifications"],
          querystring: z.object({
            /** The previous page's `nextCursor`. Omit for the first
             * page. */
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
        // this one — and one that names no row here leaves the
        // comparison NULL, which answers an empty page.
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
          .where(and(mine, notificationScope(app.db, request.user, surface), before))
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
      `${mount.path}/unread-count`,
      {
        preHandler: requireAuth,
        schema: {
          operationId: mount.operationIds.count,
          summary: mount.summaries.count,
          tags: ["notifications"],
          response: { 200: UnreadEnvelope, default: problemResponse },
        },
      },
      async (request) => ({ unread: await unreadCount(app.db, request.user, surface) }),
    );

    app.post(
      `${mount.path}/read`,
      {
        preHandler: requireAuth,
        schema: {
          operationId: mount.operationIds.read,
          summary: mount.summaries.read,
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
        // One transaction, so the count is read on the snapshot the
        // write landed on rather than on whatever the next connection
        // sees.
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
                // The surface's predicate applies to the write as it
                // applies to the reads. An item the reader can no longer
                // be shown is an item they cannot have read, so it stays
                // unread — and invisible, so nothing counts it either.
                // The same clause is what keeps this bell's write off
                // the other bell's rows.
                notificationScope(tx, request.user, surface),
              ),
            );
          return { unread: await unreadCount(tx, request.user, surface) };
        }),
    );

    app.post(
      `${mount.path}/read-all`,
      {
        preHandler: requireAuth,
        schema: {
          operationId: mount.operationIds.readAll,
          summary: mount.summaries.readAll,
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
                notificationScope(tx, request.user, surface),
              ),
            );
          return { unread: await unreadCount(tx, request.user, surface) };
        }),
    );
  };
}

/**
 * The portal bell (M20/9), mounted at `/portal/notifications`.
 *
 * Its own registration rather than a branch inside the staff one: the
 * address is what says which surface is asking, and the two mounts
 * answer disjoint sets of rows.
 */
export const portalNotificationsRoutes = bellRoutes(PORTAL_BELL);

/**
 * The staff notification centre and the preferences pair behind both
 * bells.
 */
export const notificationsRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(bellRoutes(STAFF_BELL));

  app.get(
    "/me/notification-preferences",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "getMyNotificationPreferences",
        summary:
          "What the signed-in person gets on each of NOT-002's five " +
          "event groups, per channel. It is the **effective** answer — " +
          "their own saved rows over the group's defaults — because the " +
          "table holds overrides rather than a grid, and a person who " +
          "has never opened the pane has no rows at all. Every group is " +
          "answered, whether or not anything in it has ever fired: an " +
          "opinion can be held about a group before its first event " +
          "exists. Which of the five a surface draws " +
          "is the surface's business — the staff pane draws four and " +
          "the portal pane draws `requester_events` alone. There is no " +
          "user parameter — a preference is one person's, and the " +
          "signed-in person is the whole scope",
        tags: ["notifications"],
        response: { 200: PreferencesEnvelope, default: problemResponse },
      },
    },
    async (request) => ({ groups: await myChannelChoices(app.db, request.user.id) }),
  );

  app.patch(
    "/me/notification-preferences",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "updateMyNotificationPreferences",
        summary:
          "Save one channel's answer for one event group, for the " +
          "signed-in person (NOT-001). One pair per request, because a " +
          "toggle is what the pane saves and it saves the moment it is " +
          "flipped (SET-003 immediate apply). The write lands in " +
          "`notification_preferences` as an override, so the very next " +
          "event honours it with no other wiring — and turning email " +
          "off leaves the group's bell items flowing, which is the " +
          "point of the two channels being separate rows. A save back " +
          "to the group's own default **removes** the override rather " +
          "than storing one that agrees with it: the table holds " +
          "disagreements, and the effective answer is identical either " +
          "way. Recorded in the activity log like every settings " +
          "mutation. Answers the whole grid back, so the pane can never " +
          "drift from what the fan-out will honour",
        tags: ["notifications"],
        body: z.strictObject({
          eventGroup: z.enum(NOTIFICATION_EVENT_GROUPS),
          channel: z.enum(NOTIFICATION_CHANNELS),
          enabled: z.boolean(),
        }),
        response: { 200: PreferencesEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      // The row and its narration commit together (SET-003/DD-017):
      // every settings change is recorded, or it does not land. The
      // grid is read back on the same snapshot, so the answer is what
      // the write actually left behind.
      await app.db.transaction(async (tx) => {
        const { eventGroup, channel, enabled } = request.body;
        await saveChannelChoice(tx, request.user.id, eventGroup, channel, enabled);
        // Narrated on every write, not only on a change of effect. The
        // table records that somebody expressed an opinion, and
        // re-affirming one against a default that may later move is a
        // real act — there is no stored "before" for it to be compared
        // with, because a person with no row has a default and not a
        // value.
        await recordActivity(tx, {
          entityType: "user",
          entityId: request.user.id,
          actorId: request.user.id,
          action: "user.notification_preference_changed",
          visibility: "admin_only",
          payload: { eventGroup, channel, enabled },
        });
        return { groups: await myChannelChoices(tx, request.user.id) };
      }),
  );
};
