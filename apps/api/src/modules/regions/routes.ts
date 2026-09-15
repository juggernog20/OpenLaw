// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { contracts, matters, count, inArray, regions } from "@openlaw/db";
import { taxonomyRoutes } from "../../lib/taxonomy-routes.js";
import { httpError } from "../../lib/problem.js";

export const regionsRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(
    taxonomyRoutes({
      table: regions,
      path: "regions",
      tag: "regions",
      idSingular: "Region",
      idPlural: "Regions",
      keySingular: "region",
      keyPlural: "regions",
      noun: "Region",
      decision: "SET-012",
      actionPrefix: "region",
      recordNoun: { singular: "reference", plural: "references" },
      archiveKeepsReferences: true,
      alphabetical: true,
      uniqueNames: true,
      usage: {
        async counts(db, ids) {
          if (!ids.length) return new Map();
          const choices = await db.select().from(regions).where(inArray(regions.id, ids));
          const rows = await Promise.all(
            [contracts, matters].map((table) =>
              db
                .select({ name: table.region, count: count() })
                .from(table)
                .where(
                  inArray(
                    table.region,
                    choices.map((row) => row.displayName),
                  ),
                )
                .groupBy(table.region),
            ),
          );
          const counts = new Map<string | null, number>();
          for (const row of rows.flat())
            counts.set(row.name, (counts.get(row.name) ?? 0) + row.count);
          return new Map(choices.map((row) => [row.id, counts.get(row.displayName) ?? 0]));
        },
        async reassign() {
          throw httpError(400, "Archiving a Region keeps its references.");
        },
      },
    }),
  );
};
