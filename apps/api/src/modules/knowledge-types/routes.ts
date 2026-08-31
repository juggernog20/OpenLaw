// SPDX-License-Identifier: AGPL-3.0-only

/** KNW-001 Knowledge types, the sixth configured taxonomy mount (TECH-023). */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { asc, isNull, knowledgeTypes } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { problemResponse } from "../../lib/problem.js";
import { taxonomyRoutes } from "../../lib/taxonomy-routes.js";
import { knowledgeTypeUsage } from "./usage.js";

export const knowledgeTypesRoutes = taxonomyRoutes({
  table: knowledgeTypes,
  path: "knowledge/types",
  tag: "knowledge-types",
  idSingular: "KnowledgeType",
  idPlural: "KnowledgeTypes",
  keySingular: "knowledgeType",
  keyPlural: "knowledgeTypes",
  noun: "knowledge type",
  decision: "KNW-001",
  actionPrefix: "knowledge_type",
  recordNoun: { singular: "knowledge item", plural: "knowledge items" },
  usage: knowledgeTypeUsage,
});

const KnowledgeTypeOptionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
});

/**
 * ENT-008's consuming-surface rule: Member+ authors get only live picker
 * values; the settings taxonomy above remains Administrator-only.
 */
export const knowledgeTypeOptionsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/knowledge/type-options",
    {
      preHandler: requireRole("administrator", "legal_team_member"),
      schema: {
        operationId: "listKnowledgeTypeOptions",
        summary:
          "The live Knowledge types in display order for Member+ authoring; " +
          "the /knowledge/types settings taxonomy remains Administrator-only",
        tags: ["knowledge"],
        response: {
          200: z.object({ knowledgeTypes: z.array(KnowledgeTypeOptionSchema) }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const rows = await app.db
        .select({
          id: knowledgeTypes.id,
          slug: knowledgeTypes.slug,
          displayName: knowledgeTypes.displayName,
        })
        .from(knowledgeTypes)
        .where(isNull(knowledgeTypes.archivedAt))
        .orderBy(asc(knowledgeTypes.displayOrder), asc(knowledgeTypes.createdAt));
      return { knowledgeTypes: rows };
    },
  );
};
