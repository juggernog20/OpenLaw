// SPDX-License-Identifier: AGPL-3.0-only

/**
 * App-level auth routes (TECH-008). Only surfaces where OpenLaw's
 * authorization model diverges from better-auth live here; browser
 * auth flows are better-auth's own handler under /api/auth/*.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { fromNodeHeaders } from "better-auth/node";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import { ADVISORY_LOCK, eq, tryWithAdvisoryLock, users, USER_ROLES } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { requireAuth, userColumns } from "../../auth/guards.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: z.enum(USER_ROLES),
});

const SessionSchema = z.object({
  id: z.string(),
  expiresAt: z.iso.datetime(),
});

/** Translates a better-auth APIError into our problem envelope. */
function relayAuthError(error: unknown): never {
  if (isAPIError(error)) {
    throw httpError(error.statusCode >= 400 ? error.statusCode : 500, error.message);
  }
  throw error;
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/me",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "getMe",
        summary: "The signed-in user, with their live role and session",
        tags: ["auth"],
        response: {
          200: z.object({ user: UserSchema, session: SessionSchema }),
          default: problemResponse,
        },
      },
    },
    async (request) => ({
      user: request.user,
      session: {
        id: request.session.id,
        expiresAt: request.session.expiresAt.toISOString(),
      },
    }),
  );

  app.get(
    "/auth/setup",
    {
      schema: {
        operationId: "getSetupStatus",
        summary: "Whether first-run setup (initial Administrator) is still required",
        tags: ["auth"],
        response: { 200: z.object({ needsSetup: z.boolean() }), default: problemResponse },
      },
    },
    async () => {
      const anyUser = await app.db.select({ id: users.id }).from(users).limit(1);
      return { needsSetup: anyUser.length === 0 };
    },
  );

  app.post(
    "/auth/setup",
    {
      schema: {
        operationId: "runSetup",
        summary: "First-run setup: create the initial Administrator",
        tags: ["auth"],
        body: z.object({
          email: z.email(),
          displayName: z.string().min(1),
          password: z.string().min(8),
        }),
        response: { 201: z.object({ user: UserSchema }), default: problemResponse },
      },
    },
    async (request, reply) => {
      const { email, displayName, password } = request.body;

      // "No user exists yet" only holds if nobody else can create one while
      // we act on it. An advisory lock makes the check and the create one
      // critical section across every API process, so exactly one caller
      // becomes the Administrator and the losers never create a user they
      // would then have to delete. Setup happens once, so a caller that
      // cannot take the lock has already lost: it answers 409 rather than
      // parking a connection behind the winner.
      const outcome = await tryWithAdvisoryLock(app.db, ADVISORY_LOCK.firstRunSetup, async () => {
        const anyUser = await app.db.select({ id: users.id }).from(users).limit(1);
        if (anyUser.length > 0) throw httpError(409, "Setup has already been completed.");

        const created = await provisionUser(app.auth, { email, displayName, password });
        const [row] = await app.db
          .update(users)
          .set({ role: "administrator" })
          .where(eq(users.id, created.id))
          .returning(userColumns);
        return row;
      });
      if (!outcome.acquired) throw httpError(409, "Setup has already been completed.");
      const admin = outcome.result;
      if (!admin) throw httpError(500, "Setup could not create the initial Administrator.");

      // Sign in to mint the session the way every later login does; the
      // account already exists, so this cannot resurrect public sign-up.
      let setCookies: string[];
      try {
        const { headers } = await app.auth.api.signInEmail({
          returnHeaders: true,
          body: { email, password },
          headers: fromNodeHeaders(request.headers),
        });
        setCookies = headers.getSetCookie();
      } catch (error) {
        relayAuthError(error);
      }

      for (const cookie of setCookies) void reply.header("set-cookie", cookie);
      return reply.status(201).send({ user: admin });
    },
  );
};
