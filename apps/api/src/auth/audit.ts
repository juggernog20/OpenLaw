// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DD-017 audit entries for the self-service profile mutations that ride
 * better-auth's own routes (SET-006): display name, avatar, password,
 * TOTP enrolment/disable, and other-session revocation. The typed routes
 * commit their audit entry inside the mutation's transaction; these
 * mutations happen inside better-auth, so the closest we can couple is
 * an after hook on the same request — it sees the endpoint's outcome and
 * skips failures. A failed append here loses one audit row rather than
 * failing a mutation that has already landed; that trade is logged.
 */

import { createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import type { Db } from "@openlaw/db";
import { recordActivity, type ActivityEntry } from "../lib/activity.js";

/** The pre-mutation user snapshot the session middlewares stash on the
 * request context — better-auth resolves it before the handler runs, so
 * its values are the "old" side of every audit payload. */
interface SessionUser {
  id: string;
  name: string;
  image?: string | null;
  twoFactorEnabled?: boolean | null;
}

function entriesFor(ctx: {
  path: string;
  body?: unknown;
  sessionUser: SessionUser;
}): Array<Pick<ActivityEntry, "action" | "payload">> {
  const user = ctx.sessionUser;
  switch (ctx.path) {
    case "/update-user": {
      const body = (ctx.body ?? {}) as { name?: unknown; image?: unknown };
      const entries: Array<Pick<ActivityEntry, "action" | "payload">> = [];
      if (typeof body.name === "string" && body.name !== user.name) {
        entries.push({
          action: "user.display_name_changed",
          payload: { field: "display_name", old: user.name, new: body.name },
        });
      }
      // Presence-only, like the org logo: a data: URI in the payload
      // would bloat every later audit query with the encoded image.
      if ((typeof body.image === "string" || body.image === null) && body.image !== user.image) {
        entries.push({
          action: "user.avatar_changed",
          payload: {
            field: "avatar",
            old: user.image == null ? null : "[image]",
            new: body.image === null ? null : "[image]",
          },
        });
      }
      return entries;
    }
    case "/change-password":
      return [{ action: "user.password_changed" }];
    case "/revoke-other-sessions":
      return [{ action: "user.other_sessions_revoked" }];
    case "/two-factor/disable":
      // The endpoint updates the flag unconditionally; only a true→false
      // transition is an event worth recording.
      return user.twoFactorEnabled ? [{ action: "user.two_factor_disabled" }] : [];
    case "/two-factor/verify-totp":
      // Reached only with a session (see the hook below), i.e. the
      // enrolment-completion verify — a sign-in challenge carries no
      // session cookie. Covers first enrolment and re-enrolment alike.
      return [{ action: "user.two_factor_enrolled" }];
    default:
      return [];
  }
}

const AUDITED_PATHS = new Set([
  "/update-user",
  "/change-password",
  "/revoke-other-sessions",
  "/two-factor/disable",
  "/two-factor/verify-totp",
]);

export function createProfileAuditHook(db: Db) {
  return createAuthMiddleware(async (ctx) => {
    if (!AUDITED_PATHS.has(ctx.path)) return;
    // After hooks also run on failure, with the APIError as the returned
    // value — only a successful mutation gets an audit entry.
    if (ctx.context.returned === undefined || isAPIError(ctx.context.returned)) return;
    // The audited endpoints resolve the session before their handler
    // runs, so this is the pre-mutation user. /two-factor/verify-totp is
    // sessionless during a sign-in challenge; resolving null there is
    // what filters challenges out.
    const session = ctx.context.session ?? (await getSessionFromCtx(ctx));
    if (!session) return;
    const sessionUser = session.user as SessionUser;

    for (const entry of entriesFor({ path: ctx.path, body: ctx.body, sessionUser })) {
      try {
        await recordActivity(db, {
          entityType: "user",
          entityId: sessionUser.id,
          actorId: sessionUser.id,
          visibility: "admin_only",
          ...entry,
        });
      } catch (error) {
        ctx.context.logger.error("Failed to append a profile audit entry", {
          action: entry.action,
          error,
        });
      }
    }
  });
}
