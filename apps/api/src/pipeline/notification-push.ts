// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Delivers owed device pushes through the TECH-007 worker queue.
 * NOT-001's bell row owns the debt; its live visibility predicate selects the bell.
 * The payload carries only the row id and that bell's name.
 *
 * The shape is the email handler's: read the row, decide, send, then
 * settle with a guarded write. No lock is held on the bell row while
 * the relay is on the line, so a reader marking the row read never
 * waits behind a slow relay. A wake-up that arrives twice finds the row
 * settled and stops.
 */
import {
  and,
  eq,
  gt,
  isNull,
  notifications,
  pushSubscriptions,
  sessions,
  users,
  type Db,
} from "@openlaw/db";
import webPush from "web-push";
import {
  NOTIFICATION_SURFACES,
  notificationScope,
  type NotificationSurface,
} from "../lib/notifications/audience.js";
import type { VapidResolver } from "../lib/notifications/vapid.js";
import { reasonOf } from "./derivations.js";
import type { PipelineLogger } from "./logger.js";

export interface NotificationPushDeps {
  db: Db;
  resolveVapid: VapidResolver;
  log: PipelineLogger;
}
export interface NotificationPushAttempt {
  notificationId: string;
  retryCount: number;
  retryLimit: number;
}

/** Only safe transport facts may reach pg-boss or the log, never endpoint tokens or keys. */
export class PushDeliveryError extends Error {
  constructor(
    readonly retryAfterSeconds?: number,
    readonly statusCode?: number,
  ) {
    super(
      statusCode === undefined
        ? "The push relay did not accept the notification."
        : `The push relay answered ${statusCode}.`,
    );
  }
}

export function retryAfterSeconds(
  value: string | string[] | undefined,
  now = Date.now(),
): number | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  if (!text) return undefined;
  const seconds = /^\d+$/.test(text) ? Number(text) : (Date.parse(text) - now) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

/** Marks the push settled, whichever way it went. Guarded on "still owed
 * and still unanswered", so a stamp that landed meanwhile is not undone. */
async function settle(db: Db, notificationId: string, sent: boolean): Promise<void> {
  await db
    .update(notifications)
    .set(sent ? { pushedAt: new Date() } : { pushSkippedAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.pushOwed, true),
        isNull(notifications.pushedAt),
        isNull(notifications.pushSkippedAt),
      ),
    );
}

async function send(deps: NotificationPushDeps, notificationId: string): Promise<void> {
  const [row] = await deps.db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId))
    .limit(1);
  if (!row || !row.pushOwed || row.pushedAt || row.pushSkippedAt) return;
  const [user] = await deps.db
    .select()
    .from(users)
    .where(and(eq(users.id, row.userId), isNull(users.archivedAt)));
  if (!user) {
    await settle(deps.db, row.id, false);
    return;
  }
  let surface: NotificationSurface | undefined;
  for (const candidate of NOTIFICATION_SURFACES) {
    const [visible] = await deps.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.id, row.id), notificationScope(deps.db, user, candidate)));
    if (visible) {
      surface = candidate;
      break;
    }
  }
  if (!surface) {
    await settle(deps.db, row.id, false);
    return;
  }
  const subscriptions = await deps.db
    .select({ subscription: pushSubscriptions })
    .from(pushSubscriptions)
    .innerJoin(
      sessions,
      and(
        eq(sessions.id, pushSubscriptions.sessionId),
        eq(sessions.userId, pushSubscriptions.userId),
      ),
    )
    .where(and(eq(pushSubscriptions.userId, user.id), gt(sessions.expiresAt, new Date())));
  if (subscriptions.length === 0) {
    await settle(deps.db, row.id, false);
    return;
  }
  // The pair is read per send (TECH-011's read-on-every-decision), so a
  // key restored after a bad boot applies to the very next push.
  const vapidDetails = await deps.resolveVapid();
  const body = JSON.stringify({ notificationId: row.id, surface });
  let sent = false;
  let failure: PushDeliveryError | undefined;
  // A user has at most ten subscriptions. Parallel sends keep the socket bound inside the job lease.
  await Promise.all(
    subscriptions.map(async ({ subscription }) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          { vapidDetails, TTL: 86400, urgency: "normal", timeout: 20_000 },
        );
        sent = true;
        return;
      } catch (error) {
        const status = error instanceof webPush.WebPushError ? error.statusCode : undefined;
        if (status === 404 || status === 410) {
          // The endpoint is gone. Prune it even when another one needs a retry.
          await deps.db
            .delete(pushSubscriptions)
            .where(
              and(
                eq(pushSubscriptions.id, subscription.id),
                eq(pushSubscriptions.sessionId, subscription.sessionId),
              ),
            );
          return;
        }
        const retryAfter =
          status === 429 && error instanceof webPush.WebPushError
            ? retryAfterSeconds(error.headers["retry-after"])
            : undefined;
        const longest = Math.max(failure?.retryAfterSeconds ?? -1, retryAfter ?? -1);
        failure = new PushDeliveryError(
          longest < 0 ? undefined : longest,
          status ?? failure?.statusCode,
        );
      }
    }),
  );
  if (failure) throw failure;
  await settle(deps.db, row.id, sent);
}

export async function handleNotificationPush(
  deps: NotificationPushDeps,
  attempt: NotificationPushAttempt,
): Promise<void> {
  try {
    await send(deps, attempt.notificationId);
  } catch (error) {
    if (attempt.retryCount < attempt.retryLimit) {
      throw error instanceof PushDeliveryError ? error : new PushDeliveryError();
    }
    await settle(deps.db, attempt.notificationId, false);
    deps.log.error(
      {
        notificationId: attempt.notificationId,
        attempts: attempt.retryCount + 1,
        reason: reasonOf(error),
      },
      "sending a notification push failed and will not be retried",
    );
  }
}
