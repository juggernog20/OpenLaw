// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Workspace search and recent activity (DD-029, TECH-035). Legal Users read
 * Legal Only, Working Team and Full Thread activity on reachable records.
 * Confidential Document events require the named audience; references to
 * unreachable Contracts and Matters are redacted by the shared activity rules.
 */
import { z } from "zod";
import {
  activityLog,
  and,
  autoDocs,
  contracts,
  entities,
  eq,
  gte,
  inArray,
  isNull,
  knowledgeItems,
  matters,
  matterTeam,
  requests,
  sql,
  users,
  type Db,
} from "@openlaw/db";
import {
  flatSearch,
  searchScopes,
  SEARCH_KINDS,
  SearchRowSchema,
} from "../modules/search/service.js";
import { portalKnowledgeScope } from "../modules/knowledge/service.js";
import { ActivityEntrySchema } from "../modules/activity/routes.js";
import {
  confidentialDocumentEntryScope,
  contractNamedAudienceScope,
  contractTeamScope,
} from "../lib/contract-access.js";
import { matterTeamScope } from "../lib/matter-access.js";
import { entityReachScope } from "../lib/entity-access.js";
import { redactUnreachedReferences } from "../lib/activity-redaction.js";
import type { AuthenticatedUser } from "../auth/user.js";
import type { ToolDefinition } from "./tool.js";
import { bounded, boundedPage, pageInput } from "./results.js";

export const readTool = {
  kind: "read",
  legalUser: "on",
  businessUser: "on",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    idempotentHint: true,
  },
} as const;
const searchInput = z
  .object({
    query: z.string().trim().min(1).max(200),
    kind: z.enum(SEARCH_KINDS).optional(),
    ...pageInput,
    // The search service caps its cursor at 64 characters; a longer one must fail as invalid arguments.
    cursor: z.string().min(1).max(64).optional(),
  })
  .strict();
const activityInput = z.object({ since: z.iso.datetime({ offset: true }), ...pageInput }).strict();

function activityScope(db: Db, user: AuthenticatedUser) {
  const openDocument = confidentialDocumentEntryScope({ seesConfidentialDocuments: false })!;
  const contract = sql`exists (select 1 from ${contracts} where ${contracts.id} = ${activityLog.entityId} and ${contractTeamScope(db, user)} and (${contractNamedAudienceScope(db, user)} or ${openDocument}))`;
  // Matter Confidential Documents use the same named team or Manager audience.
  const matter = sql`exists (select 1 from ${matters} where ${matters.id} = ${activityLog.entityId} and ${matterTeamScope(db, user)} and (${matters.managerId} = ${user.id} or exists (select 1 from ${matterTeam} where ${matterTeam.matterId} = ${matters.id} and ${matterTeam.userId} = ${user.id}) or ${openDocument}))`;
  return and(
    inArray(activityLog.visibility, ["legal_only", "working_team", "full_thread"]),
    sql`((${activityLog.entityType} = 'contract' and ${contract}) or
      (${activityLog.entityType} = 'matter' and ${matter}) or
      (${activityLog.entityType} = 'request' and exists (select 1 from ${requests} where ${requests.id} = ${activityLog.entityId} and ${isNull(requests.archivedAt)})) or
      (${activityLog.entityType} = 'entity' and exists (select 1 from ${entities} where ${entities.id} = ${activityLog.entityId} and ${entityReachScope(db, user)})) or
      (${activityLog.entityType} = 'knowledge_item' and ${activityLog.visibility} = 'legal_only' and exists (select 1 from ${knowledgeItems} where ${knowledgeItems.id} = ${activityLog.entityId})) or
      (${activityLog.entityType} = 'auto_doc' and ${activityLog.visibility} = 'legal_only' and exists (select 1 from ${autoDocs} where ${autoDocs.id} = ${activityLog.entityId})))`,
    sql`(${activityLog.action} <> 'auto_doc.filed' or
      (${activityLog.payload}->>'targetKind' = 'contract' and exists (select 1 from ${contracts} where ${contracts.number}::text = ${activityLog.payload}->>'targetNumber' and ${contractTeamScope(db, user)})) or
      (${activityLog.payload}->>'targetKind' = 'matter' and exists (select 1 from ${matters} where ${matters.number}::text = ${activityLog.payload}->>'targetNumber' and ${matterTeamScope(db, user)})))`,
  );
}
export const workspaceTools: readonly ToolDefinition[] = [
  {
    ...readTool,
    toolset: "workspace",
    name: "openlaw_search",
    title: "Search OpenLaw",
    description:
      "Search reachable records by words or reference. kind may be contract, matter, document, entity, counterparty, request or knowledge_item. Business Users get their Portal records, own Requests and published portal-readable Knowledge Items. Continue with nextCursor and unchanged filters.",
    inputSchema: searchInput,
    outputSchema: z.object({
      results: z.array(SearchRowSchema),
      nextCursor: z.string().nullable(),
    }),
    run: async (input, { db, user }) => {
      const { query, kind, cursor, limit } = searchInput.parse(input);
      const scopes = searchScopes(db, user);
      if (user.role === "business_user") {
        scopes.request = and(isNull(requests.archivedAt), eq(requests.requesterId, user.id))!;
        scopes.knowledge_item = portalKnowledgeScope(db, user);
      }
      const result = await flatSearch(db, user, query, { kind, cursor, limit }, scopes);
      const page = boundedPage(result.results, limit, (r) => r.id, result.nextCursor);
      return bounded({ results: page.items, nextCursor: page.nextCursor });
    },
  },
  {
    ...readTool,
    businessUser: "off",
    toolset: "workspace",
    name: "openlaw_activity_recent",
    title: "Read recent activity",
    description:
      "Read activity since an ISO date and time across reachable Contracts, Matters, Requests, Entities, Knowledge Items and Auto-Docs at your visibility tiers. Legal Users only. Newest first; continue with nextCursor and the same since value.",
    inputSchema: activityInput,
    outputSchema: z.object({
      entries: z.array(
        ActivityEntrySchema.extend({ entityType: z.string(), entityId: z.string() }),
      ),
      nextCursor: z.string().nullable(),
    }),
    run: async (input, { db, user }) => {
      const { since, cursor, limit } = activityInput.parse(input);
      const scope = and(activityScope(db, user), gte(activityLog.createdAt, new Date(since)));
      let before;
      if (cursor) {
        const [boundary] = await db
          .select({ id: activityLog.id })
          .from(activityLog)
          .where(and(scope, eq(activityLog.id, cursor)))
          .limit(1);
        if (!boundary) return { entries: [], nextCursor: null };
        before = sql`(${activityLog.createdAt}, ${activityLog.id}) < (select b.created_at, b.id from ${activityLog} b where b.id = ${boundary.id})`;
      }
      const rows = await db
        .select({
          id: activityLog.id,
          entityId: activityLog.entityId,
          entityType: activityLog.entityType,
          action: activityLog.action,
          visibility: activityLog.visibility,
          createdAt: activityLog.createdAt,
          payload: activityLog.payload,
          actor: {
            id: users.id,
            displayName: users.displayName,
            image: users.image,
            archivedAt: users.archivedAt,
          },
        })
        .from(activityLog)
        .leftJoin(users, eq(users.id, activityLog.actorId))
        .where(and(scope, before))
        .orderBy(sql`${activityLog.createdAt} desc`, sql`${activityLog.id} desc`)
        .limit(limit + 1);
      const redacted = await redactUnreachedReferences(db, user, rows);
      const page = boundedPage(
        redacted.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          actor: row.actor?.id
            ? {
                id: row.actor.id,
                displayName: row.actor.displayName,
                image: row.actor.image,
                archived: row.actor.archivedAt !== null,
              }
            : null,
        })),
        limit,
        (row) => row.id,
      );
      return bounded({ entries: page.items, nextCursor: page.nextCursor });
    },
  },
];
