// SPDX-License-Identifier: AGPL-3.0-only

/** SET-011 records the Business User first run; SET-010 keeps its Department write audited. */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { eq, users, type Executor } from "@openlaw/db";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { departmentOptions, lockedDepartment } from "../departments/references.js";
import { setUserDepartment } from "../users/department.js";

const StateSchema = z.object({
  completedAt: z.iso.datetime().nullable(),
  departmentId: z.string().nullable(),
  departments: z.array(z.object({ id: z.string(), displayName: z.string() })),
});

async function lockedUser(tx: Executor, id: string) {
  const [user] = await tx
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      departmentId: users.departmentId,
      completedAt: users.portalOnboardingCompletedAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .for("update");
  if (!user || user.role !== "business_user")
    throw httpError(403, "The Portal first run is for Business Users.");
  return user;
}

export const portalOnboardingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/portal/onboarding",
    {
      preHandler: requireRole("business_user"),
      schema: {
        operationId: "getPortalOnboarding",
        tags: ["portal"],
        response: { 200: StateSchema, default: problemResponse },
      },
    },
    async (request) => {
      const [user] = await app.db
        .select({
          departmentId: users.departmentId,
          completedAt: users.portalOnboardingCompletedAt,
        })
        .from(users)
        .where(eq(users.id, request.user.id));
      if (!user) throw httpError(401, "Authentication required.");
      return {
        ...user,
        completedAt: user.completedAt?.toISOString() ?? null,
        departments: await departmentOptions(app.db),
      };
    },
  );

  app.patch(
    "/portal/onboarding/department",
    {
      preHandler: requireRole("business_user"),
      schema: {
        operationId: "setPortalOnboardingDepartment",
        tags: ["portal"],
        body: z.strictObject({ departmentId: z.string().min(1) }),
        response: { 200: z.object({ departmentId: z.string() }), default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const user = await lockedUser(tx, request.user.id);
        if (user.completedAt)
          throw httpError(
            409,
            "Your first run is complete. Ask an Administrator to change your Department.",
          );
        await lockedDepartment(tx, request.body.departmentId);
        await setUserDepartment(tx, user, request.body.departmentId, request.user.id);
        return { departmentId: request.body.departmentId };
      }),
  );

  app.post(
    "/portal/onboarding/complete",
    {
      preHandler: requireRole("business_user"),
      schema: {
        operationId: "completePortalOnboarding",
        tags: ["portal"],
        response: { 200: z.object({ completedAt: z.iso.datetime() }), default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const user = await lockedUser(tx, request.user.id);
        if (user.completedAt) return { completedAt: user.completedAt.toISOString() };
        const options = await departmentOptions(tx);
        if (options.length) {
          if (
            !user.departmentId ||
            !options.some((department) => department.id === user.departmentId)
          ) {
            throw httpError(400, "Choose a live Department before finishing your first run.");
          }
          await lockedDepartment(tx, user.departmentId);
        }
        const completedAt = new Date();
        await tx
          .update(users)
          .set({ portalOnboardingCompletedAt: completedAt, updatedAt: completedAt })
          .where(eq(users.id, user.id));
        return { completedAt: completedAt.toISOString() };
      }),
  );
};
