// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DD-017 audit entries for the self-service profile mutations that ride
 * better-auth's own routes (SET-006): display name, avatar, password,
 * TOTP enrolment and disable, and other-session revocation. The typed
 * routes commit their audit entry inside the mutation's transaction.
 * These mutations happen inside better-auth, so the closest coupling is
 * an after hook on the same request. The hook sees the endpoint's
 * outcome and skips failures. A failed append here loses one audit row
 * rather than failing a mutation that has already landed. That trade is
 * logged.
 */

import { createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import type { Db } from "@openlaw/db";
import { recordActivity, type ActivityEntry } from "../lib/activity.js";

/** The pre-mutation user snapshot the session middlewares stash on the
 * request context. better-auth resolves it before the handler runs, so
 * its values are the "old" side of every audit payload. */
interface SessionUser {
  id: string;
  name: string;
  image?: string | null;
  twoFactorEnabled?: boolean | null;
}

/**
 * The six verbs this hook writes, and nothing else. Named rather than
 * left as the whole activity vocabulary so the module's scope reads in
 * one place, and so the compiler narrows ProfileAuditEntry to these six
 * payload shapes.
 */
type ProfileAuditAction =
  | "user.display_name_changed"
  | "user.avatar_changed"
  | "user.password_changed"
  | "user.other_sessions_revoked"
  | "user.two_factor_disabled"
  | "user.two_factor_enrolled";

/** One whole entry, ready to append. Each action has its own payload
 * shape, and the ActivityEntry union pairs them. Building action and
 * payload separately would redo that pairing by hand. */
type ProfileAuditEntry = Extract<ActivityEntry, { action: ProfileAuditAction }>;

function entriesFor(ctx: {
  path: string;
  body?: unknown;
  sessionUser: SessionUser;
}): ProfileAuditEntry[] {
  const user = ctx.sessionUser;
  /** Who every entry here is about, and at which tier. The subject and
   * the actor are the same person: these are the mutations somebody
   * makes to their own profile (SET-006). */
  const about = {
    entityType: "user",
    entityId: user.id,
    actorId: user.id,
    visibility: "admin_only",
  } as const;
  switch (ctx.path) {
    case "/update-user": {
      const body = (ctx.body ?? {}) as { name?: unknown; image?: unknown };
      const entries: ProfileAuditEntry[] = [];
      if (typeof body.name === "string" && body.name !== user.name) {
        entries.push({
          ...about,
          action: "user.display_name_changed",
          payload: { field: "display_name", old: user.name, new: body.name },
        });
      }
      // Presence-only, like the org logo: a data: URI in the payload
      // would bloat every later audit query with the encoded image.
      // The stored value can be absent (undefined) or cleared (null);
      // both mean "no avatar", so clearing a missing avatar is a no-op.
      const oldImage = user.image ?? null;
      if ((typeof body.image === "string" || body.image === null) && body.image !== oldImage) {
        entries.push({
          ...about,
          action: "user.avatar_changed",
          payload: {
            field: "avatar",
            old: oldImage === null ? null : "[image]",
            new: body.image === null ? null : "[image]",
          },
        });
      }
      return entries;
    }
    case "/change-password":
      return [{ ...about, action: "user.password_changed" }];
    case "/revoke-other-sessions":
      return [{ ...about, action: "user.other_sessions_revoked" }];
    case "/two-factor/disable":
      // The endpoint clears the flag unconditionally. Only a true to false
      // transition is an event worth recording.
      return user.twoFactorEnabled ? [{ ...about, action: "user.two_factor_disabled" }] : [];
    case "/two-factor/verify-totp":
      // Reached only with a session (see the hook below), so this is the
      // enrolment-completion verify. A sign-in challenge carries no
      // session cookie. Covers first enrolment and re-enrolment alike.
      return [{ ...about, action: "user.two_factor_enrolled" }];
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
    // value. Only a successful mutation gets an audit entry.
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
        await recordActivity(db, entry);
      } catch (error) {
        ctx.context.logger.error("Failed to append a profile audit entry", {
          action: entry.action,
          error,
        });
      }
    }
  });
}
