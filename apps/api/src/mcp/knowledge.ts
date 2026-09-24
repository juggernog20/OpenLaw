// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import { and, eq, isNull, knowledgeItems } from "@openlaw/db";
import { flatSearch, searchScopes, SearchRowSchema } from "../modules/search/service.js";
import { getKnowledgeItem, portalKnowledgeScope } from "../modules/knowledge/service.js";
import { getPortalKnowledge } from "../modules/portal/routes.js";
import { listKnowledgeItemDocuments } from "../modules/documents/service.js";
import { bounded, boundedPage, pageInput, serviceResult } from "./results.js";
import { recordOutput } from "./documents.js";
import { readTool } from "./workspace.js";
import { ToolError, type ToolDefinition } from "./tool.js";
const searchInput = z.object({
  query: z.string().trim().min(1).max(200),
  ...pageInput,
  cursor: z.string().min(1).max(64).optional(),
});
const getInput = z.object({
  id: z.string().uuid(),
  ...pageInput,
  cursor: z.string().min(1).max(64).optional(),
});
export const knowledgeTools: readonly ToolDefinition[] = [
  {
    ...readTool,
    toolset: "knowledge",
    name: "openlaw_knowledge_search",
    title: "Search published Knowledge",
    description:
      "Search the words in published Knowledge Items using OpenLaw text search. Business Users get only portal-readable Items. Continue with nextCursor and the same query.",
    inputSchema: searchInput,
    outputSchema: z.object({
      results: z.array(SearchRowSchema),
      nextCursor: z.string().nullable(),
    }),
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const args = searchInput.parse(input);
        const scopes = searchScopes(db, user);
        scopes.knowledge_item =
          user.role === "business_user"
            ? portalKnowledgeScope(db, user)
            : and(isNull(knowledgeItems.archivedAt), eq(knowledgeItems.state, "published"))!;
        const result = await flatSearch(
          db,
          user,
          args.query,
          { kind: "knowledge_item", cursor: args.cursor, limit: args.limit },
          scopes,
        );
        const page = boundedPage(result.results, args.limit, (r) => r.id, result.nextCursor);
        return bounded({ results: page.items, nextCursor: page.nextCursor });
      }),
  },
  {
    ...readTool,
    toolset: "knowledge",
    name: "openlaw_knowledge_get",
    title: "Read a Knowledge Item",
    description:
      "Read a published Knowledge Item and its Documents. Business Users get the Portal article and current Document Versions only. Continue Documents with nextCursor and unchanged id.",
    inputSchema: getInput,
    outputSchema: z.object({
      knowledgeItem: recordOutput,
      documents: z.array(recordOutput),
      nextCursor: z.string().nullable(),
    }),
    run: async (input, { db, user }) =>
      serviceResult(async () => {
        const args = getInput.parse(input);
        let item;
        let paper;
        if (user.role === "business_user") {
          const portal = (await getPortalKnowledge(db, user, args.id)).knowledgeItem;
          const { documents, ...rest } = portal;
          item = rest;
          const index = args.cursor ? documents.findIndex((d) => d.id === args.cursor) : -1;
          paper = {
            documents: args.cursor && index < 0 ? [] : documents.slice(index + 1),
            nextCursor: null,
          };
        } else {
          item = (await getKnowledgeItem(db, user, args.id)).knowledgeItem;
          if (item.state !== "published" || item.archivedAt)
            throw new ToolError("not_found", "No published Knowledge Item exists with this id.");
          paper = await listKnowledgeItemDocuments(db, user, args.id, { cursor: args.cursor });
        }
        const page = boundedPage<Record<string, unknown> & { id: string }>(
          paper.documents,
          args.limit,
          (d) => d.id,
          paper.nextCursor,
        );
        return bounded({ knowledgeItem: item, documents: page.items, nextCursor: page.nextCursor });
      }),
  },
];
