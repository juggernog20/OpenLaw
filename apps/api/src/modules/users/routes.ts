// SPDX-License-Identifier: AGPL-3.0-only

/**
 * User management reads (SET-005): the list behind the Users pane. One
 * query answers the whole pane — every user with their role, derived
 * status, and last-active stamp; pending invites are ordinary rows.
 * Mutations stay with their owners: invites in the auth module, role
 * edits and archival with their own ticket (#66).
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { accounts, asc, users, USER_ROLES } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { problemResponse } from "../../lib/problem.js";
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

export const usersRoutes: FastifyPluginAsyncZod = async (app) => {
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
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          role: users.role,
          archivedAt: users.archivedAt,
          lastActiveAt: users.lastActiveAt,
        })
        .from(users)
        .orderBy(asc(users.createdAt), asc(users.id));
      const activated = new Set(
        (await app.db.selectDistinct({ userId: accounts.userId }).from(accounts)).map(
          (account) => account.userId,
        ),
      );
      return {
        users: rows.map((row) => ({
          id: row.id,
          email: row.email,
          displayName: row.displayName,
          role: row.role,
          // "Invited" is reserved for staff without an account row —
          // activation writes one (credential or SSO subject). Business
          // Users also lack account rows (magic-link JIT provisioning
          // never creates one), but they were never invited: they exist
          // because they signed in.
          status: row.archivedAt
            ? ("archived" as const)
            : !activated.has(row.id) && (INVITABLE_ROLES as readonly string[]).includes(row.role)
              ? ("invited" as const)
              : ("active" as const),
          lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
        })),
      };
    },
  );
};
