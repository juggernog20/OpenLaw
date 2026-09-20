// SPDX-License-Identifier: AGPL-3.0-only
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
  constructor(readonly retryAfterSeconds?: number) {
    super("The push relay did not accept the notification.");
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

async function send(deps: NotificationPushDeps, notificationId: string): Promise<void> {
  // Resolve before locking the bell row: the resolver owns the org settings lock.
  const vapidDetails = await deps.resolveVapid();
  await deps.db
    .transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(notifications)
        .where(eq(notifications.id, notificationId))
        .for("update");
      if (!row || !row.pushOwed || row.pushedAt || row.pushSkippedAt) return;
      const settle = (sent: boolean) =>
        tx
          .update(notifications)
          .set(sent ? { pushedAt: new Date() } : { pushSkippedAt: new Date() })
          .where(eq(notifications.id, row.id));
      const [user] = await tx
        .select()
        .from(users)
        .where(and(eq(users.id, row.userId), isNull(users.archivedAt)));
      if (!user) {
        await settle(false);
        return;
      }
      let surface: NotificationSurface | undefined;
      for (const candidate of NOTIFICATION_SURFACES) {
        const [visible] = await tx
          .select({ id: notifications.id })
          .from(notifications)
          .where(and(eq(notifications.id, row.id), notificationScope(tx, user, candidate)));
        if (visible) {
          surface = candidate;
          break;
        }
      }
      if (!surface) {
        await settle(false);
        return;
      }
      const subscriptions = await tx
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
      const body = JSON.stringify({ notificationId: row.id, surface });
      let sent = false;
      let failed = false;
      let retryAfter: number | undefined;
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
          } catch (error) {
            if (
              error instanceof webPush.WebPushError &&
              (error.statusCode === 404 || error.statusCode === 410)
            ) {
              await tx
                .delete(pushSubscriptions)
                .where(
                  and(
                    eq(pushSubscriptions.id, subscription.id),
                    eq(pushSubscriptions.sessionId, subscription.sessionId),
                  ),
                );
              return;
            }
            failed = true;
            if (error instanceof webPush.WebPushError && error.statusCode === 429) {
              const seconds = retryAfterSeconds(error.headers["retry-after"]);
              if (seconds !== undefined) retryAfter = Math.max(retryAfter ?? 0, seconds);
            }
          }
        }),
      );
      // Commit dead-endpoint pruning even when another endpoint needs a retry.
      if (failed) return { failure: new PushDeliveryError(retryAfter) };
      await settle(sent);
      return undefined;
    })
    .then((result) => {
      if (result?.failure) throw result.failure;
    });
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
    await deps.db
      .update(notifications)
      .set({ pushSkippedAt: new Date() })
      .where(
        and(
          eq(notifications.id, attempt.notificationId),
          eq(notifications.pushOwed, true),
          isNull(notifications.pushedAt),
          isNull(notifications.pushSkippedAt),
        ),
      );
    deps.log.error(
      { notificationId: attempt.notificationId, attempts: attempt.retryCount + 1 },
      "sending a notification push failed and will not be retried",
    );
  }
}
