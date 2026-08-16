// SPDX-License-Identifier: AGPL-3.0-only

/**
 * User management (SET-005): the list behind the Users pane, and the
 * people-management mutations — in-place role edits, guarded archive,
 * unarchive, and per-user session revocation — as our own typed Admin
 * routes (better-auth's admin surface stays closed per TECH-008).
 * Invite mutations stay with the auth module.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  accounts,
  and,
  asc,
  eq,
  isNull,
  sessions,
  users,
  USER_ROLES,
  type Transaction,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { INVITABLE_ROLES } from "../auth/routes.js";

/** Derived per read, never stored: the row's state on the Users pane. */
const USER_STATUSES = ["active", "invited", "archived"] as const;

const UserRowSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(USER_ROLES),
  status: z.enum(USER_STATUSES),
  /** NULL = has never signed in — which for staff means a pending invite. */
  lastActiveAt: z.iso.datetime().nullable(),
});

const UserRowEnvelope = z.object({ user: UserRowSchema });

/** The users columns every route here reads and returns. */
const userRowColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  role: users.role,
  archivedAt: users.archivedAt,
  lastActiveAt: users.lastActiveAt,
} as const;

interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: (typeof USER_ROLES)[number];
  archivedAt: Date | null;
  lastActiveAt: Date | null;
}

/**
 * "Invited" is reserved for staff without an account row — activation
 * writes one (credential or SSO subject). Business Users also lack
 * account rows (magic-link JIT provisioning never creates one), but they
 * were never invited: they exist because they signed in.
 */
function statusOf(row: UserRecord, activated: boolean) {
  if (row.archivedAt) return "archived" as const;
  if (!activated && (INVITABLE_ROLES as readonly string[]).includes(row.role)) {
    return "invited" as const;
  }
  return "active" as const;
}

function toUserRow(row: UserRecord, activated: boolean) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: statusOf(row, activated),
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
  };
}

export const usersRoutes: FastifyPluginAsyncZod = async (app) => {
  async function activated(userId: string): Promise<boolean> {
    const rows = await app.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.userId, userId))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Locks every non-archived Administrator row (in id order, so two
   * guarded mutations always queue on the same first row) and returns
   * them — the last-Administrator floor counts against this set while
   * holding it, so two concurrent demotions cannot both slip past the
   * check. A demotion racing an archive of the other Administrator can
   * still deadlock on the target-vs-set lock order; Postgres resolves it
   * by aborting one, which at a 2–10 person scale is a rarity worth less
   * than the extra machinery of a two-phase read.
   */
  function lockedAdmins(tx: Transaction) {
    return tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "administrator"), isNull(users.archivedAt)))
      .orderBy(asc(users.id))
      .for("update");
  }

  app.get(
    "/users",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listUsers",
        summary:
          "Every user with role, status, and last-active (SET-005); " +
          "pending invites appear as rows with status `invited`",
        tags: ["users"],
        response: {
          200: z.object({ users: z.array(UserRowSchema) }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const rows = await app.db
        .select(userRowColumns)
        .from(users)
        .orderBy(asc(users.createdAt), asc(users.id));
      const activatedIds = new Set(
        (await app.db.selectDistinct({ userId: accounts.userId }).from(accounts)).map(
          (account) => account.userId,
        ),
      );
      return { users: rows.map((row) => toUserRow(row, activatedIds.has(row.id))) };
    },
  );

  app.patch(
    "/users/:userId/role",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "updateUserRole",
        summary:
          "Change a user's role in place (SET-005); effective on the " +
          "target's next request — the guard chain reads the role live",
        tags: ["users"],
        params: z.object({ userId: z.string() }),
        body: z.object({ role: z.enum(USER_ROLES) }),
        response: { 200: UserRowEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { role } = request.body;
      const row = await app.db.transaction(async (tx) => {
        const [target] = await tx
          .select(userRowColumns)
          .from(users)
          .where(eq(users.id, request.params.userId))
          .limit(1)
          .for("update");
        if (!target) throw httpError(404, "No user exists with this id.");
        // Setting the role a user already has changes nothing — answer
        // with the row and write no misleading from==to audit entry.
        if (target.role === role) return target;
        // The floor only counts Administrators who could act: an archived
        // one holds no keys, so demoting them moves nothing.
        if (target.role === "administrator" && !target.archivedAt) {
          const admins = await lockedAdmins(tx);
          if (admins.length <= 1) {
            throw httpError(409, "You cannot demote the last Administrator.");
          }
        }
        const [updated] = await tx
          .update(users)
          .set({ role })
          .where(eq(users.id, target.id))
          .returning(userRowColumns);
        await recordActivity(tx, {
          entityType: "user",
          entityId: target.id,
          actorId: request.user.id,
          action: "user.role_changed",
          visibility: "admin_only",
          payload: { email: target.email, from: target.role, to: role },
        });
        return updated!;
      });
      return { user: toUserRow(row, await activated(row.id)) };
    },
  );

  app.post(
    "/users/:userId/archive",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "archiveUser",
        summary:
          "Archive a user (SET-005): sign-in is blocked and every live " +
          "session is revoked in the same operation",
        tags: ["users"],
        params: z.object({ userId: z.string() }),
        response: { 200: UserRowEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const row = await app.db.transaction(async (tx) => {
        const [target] = await tx
          .select(userRowColumns)
          .from(users)
          .where(eq(users.id, request.params.userId))
          .limit(1)
          .for("update");
        if (!target) throw httpError(404, "No user exists with this id.");
        if (target.archivedAt) throw httpError(409, "This user is already archived.");
        // The floor speaks before the self rule: archiving yourself as
        // the last Administrator is refused for the reason that matters.
        if (target.role === "administrator") {
          const admins = await lockedAdmins(tx);
          if (admins.length <= 1) {
            throw httpError(409, "You cannot archive the last Administrator.");
          }
        }
        if (target.id === request.user.id) {
          throw httpError(409, "You cannot archive yourself.");
        }
        const [updated] = await tx
          .update(users)
          .set({ archivedAt: new Date() })
          .where(eq(users.id, target.id))
          .returning(userRowColumns);
        // Immediate revocation is the point of archiving (SET-005): the
        // departing person must not keep working until a session expires.
        // Sign-in stays blocked at the door by the session-create hook.
        await tx.delete(sessions).where(eq(sessions.userId, target.id));
        await recordActivity(tx, {
          entityType: "user",
          entityId: target.id,
          actorId: request.user.id,
          action: "user.archived",
          visibility: "admin_only",
          payload: { email: target.email, role: target.role },
        });
        return updated!;
      });
      return { user: toUserRow(row, await activated(row.id)) };
    },
  );

  app.post(
    "/users/:userId/unarchive",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "unarchiveUser",
        summary:
          "Restore an archived user (SET-003's recovery story): sign-in " +
          "works again; the sessions archive revoked stay revoked",
        tags: ["users"],
        params: z.object({ userId: z.string() }),
        response: { 200: UserRowEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const row = await app.db.transaction(async (tx) => {
        const [target] = await tx
          .select(userRowColumns)
          .from(users)
          .where(eq(users.id, request.params.userId))
          .limit(1)
          .for("update");
        if (!target) throw httpError(404, "No user exists with this id.");
        if (!target.archivedAt) throw httpError(409, "This user is not archived.");
        const [updated] = await tx
          .update(users)
          .set({ archivedAt: null })
          .where(eq(users.id, target.id))
          .returning(userRowColumns);
        await recordActivity(tx, {
          entityType: "user",
          entityId: target.id,
          actorId: request.user.id,
          action: "user.unarchived",
          visibility: "admin_only",
          payload: { email: target.email, role: target.role },
        });
        return updated!;
      });
      return { user: toUserRow(row, await activated(row.id)) };
    },
  );

  app.post(
    "/users/:userId/revoke-sessions",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "revokeUserSessions",
        summary:
          "Revoke every live session of a user (SET-005's lost-laptop " +
          "case); the account itself is untouched",
        tags: ["users"],
        params: z.object({ userId: z.string() }),
        // z.undefined() = a bodyless 204; z.null() would advertise a
        // JSON null payload to OpenAPI clients.
        response: { 204: z.undefined(), default: problemResponse },
      },
    },
    async (request, reply) => {
      // Deliberately no self guard: an Administrator whose own laptop is
      // the lost one revokes their own sessions and is signed out
      // everywhere — including the device they asked from. That is the
      // operation doing its job, not a mistake to prevent.
      await app.db.transaction(async (tx) => {
        const [target] = await tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(eq(users.id, request.params.userId))
          .limit(1);
        if (!target) throw httpError(404, "No user exists with this id.");
        const revoked = await tx
          .delete(sessions)
          .where(eq(sessions.userId, target.id))
          .returning({ id: sessions.id });
        await recordActivity(tx, {
          entityType: "user",
          entityId: target.id,
          actorId: request.user.id,
          action: "user.sessions_revoked",
          visibility: "admin_only",
          payload: { email: target.email, sessions: revoked.length },
        });
      });
      return reply.status(204).send();
    },
  );
};
