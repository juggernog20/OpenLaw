// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Auth guards (TECH-008) — the preHandler primitives every protected
 * route composes. The role is read live from users on every request
 * (never trusted from a cookie), so demotion and archival take effect
 * immediately (DD-013).
 */

import { eq, users, type UserRole } from "@openlaw/db";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import { httpError } from "../lib/problem.js";
import type { AuthenticatedSession, AuthenticatedUser } from "./user.js";

/** Re-exported so every importer keeps asking the guard module for the
 * shape it guards. The declarations live one file over, where a process
 * with no Fastify instance can reach them — see `auth/user.ts`. */
export type { AuthenticatedSession, AuthenticatedUser } from "./user.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by requireAuth/requireRole; absent on unguarded routes. */
    user: AuthenticatedUser;
    /** Set by requireAuth/requireRole; absent on unguarded routes. */
    session: AuthenticatedSession;
  }
}

/** The users columns the guard loads on every request. The avatar is
 * deliberately absent: it can be a data: URI of up to ~1.4 MB, and only
 * /me returns it — every other guarded request would haul it out of the
 * database for nothing. */
const guardColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  role: users.role,
  theme: users.theme,
  timezone: users.timezone,
} as const;

/** The users columns behind the API-facing user shape — one projection
 * shared by every query that returns a user to a client. */
export const userColumns = {
  ...guardColumns,
  image: users.image,
} as const;

export async function requireAuth(request: FastifyRequest): Promise<void> {
  const session = await request.server.auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (!session) throw httpError(401, "Authentication required.");

  const rows = await request.server.db
    .select({ ...guardColumns, archivedAt: users.archivedAt })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  const user = rows[0];
  if (user?.archivedAt !== null) throw httpError(401, "Authentication required.");

  request.user = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    theme: user.theme,
    timezone: user.timezone,
  };
  request.session = {
    id: session.session.id,
    expiresAt: session.session.expiresAt,
  };
}

/**
 * **The one sentence a role refusal is worded in.**
 *
 * It is exported because a guard is not the only place a role can refuse:
 * a route mounted for several kinds of record answers the role question
 * per record type, behind its own seam, and that refusal must read
 * exactly as this one. A second copy is a second sentence somebody can
 * reword, and the reword is what tells a caller the two paths differ.
 */
export const NO_PERMISSION = "You do not have permission to perform this action.";

export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest): Promise<void> => {
    await requireAuth(request);
    if (!roles.includes(request.user.role)) {
      throw httpError(403, NO_PERMISSION);
    }
  };
}
