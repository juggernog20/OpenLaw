// SPDX-License-Identifier: AGPL-3.0-only

/** SET-010 Department management and staff pickers. Archive retains references, so reassignment is refused. */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { contracts, count, departments, inArray, matters, requests, users } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { taxonomyRoutes } from "../../lib/taxonomy-routes.js";
import { departmentOptions } from "./references.js";

export const departmentsRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(
    taxonomyRoutes({
      table: departments,
      path: "departments",
      tag: "departments",
      idSingular: "Department",
      idPlural: "Departments",
      keySingular: "department",
      keyPlural: "departments",
      noun: "Department",
      decision: "SET-010",
      actionPrefix: "department",
      recordNoun: { singular: "reference", plural: "references" },
      archiveKeepsReferences: true,
      usage: {
        async counts(db, ids) {
          if (!ids.length) return new Map();
          const rows = await Promise.all([
            db
              .select({ id: users.departmentId, count: count() })
              .from(users)
              .where(inArray(users.departmentId, ids))
              .groupBy(users.departmentId),
            db
              .select({ id: contracts.owningDepartmentId, count: count() })
              .from(contracts)
              .where(inArray(contracts.owningDepartmentId, ids))
              .groupBy(contracts.owningDepartmentId),
            ...[matters, requests].map((table) =>
              db
                .select({ id: table.departmentId, count: count() })
                .from(table)
                .where(inArray(table.departmentId, ids))
                .groupBy(table.departmentId),
            ),
          ]);
          const counts = new Map<string, number>();
          for (const row of rows.flat())
            if (row.id) counts.set(row.id, (counts.get(row.id) ?? 0) + row.count);
          return counts;
        },
        async reassign() {
          throw httpError(400, "Archiving a Department keeps its references.");
        },
      },
    }),
  );
  app.get(
    "/departments/options",
    {
      preHandler: requireRole("administrator", "legal_team_member"),
      schema: {
        operationId: "departmentOptions",
        summary: "Live Departments for staff pickers",
        tags: ["departments"],
        response: {
          200: z.object({
            departments: z.array(z.object({ id: z.string(), displayName: z.string() })),
          }),
          default: problemResponse,
        },
      },
    },
    async () => ({ departments: await departmentOptions(app.db) }),
  );
};
