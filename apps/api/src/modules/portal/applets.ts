// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  activityLog,
  and,
  asc,
  contracts,
  contractTeam,
  contractTypeFields,
  desc,
  entities,
  eq,
  inArray,
  isNull,
  matters,
  matterTeam,
  matterTypeFields,
  requests,
  sql,
  users,
} from "@openlaw/db";
import { requireAuth } from "../../auth/guards.js";
import { selectAttachedFields } from "../../lib/custom-fields.js";
import { portalRecordScope } from "../../lib/portal-record-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { ActivityEntrySchema } from "../activity/routes.js";

const Person = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});
const PersonColumns = {
  id: users.id,
  displayName: users.displayName,
  image: users.image,
  archived: sql<boolean>`${users.archivedAt} is not null`,
};
const PAGE_SIZE = 25;
const COMMENT_ACTIONS = ["comment.posted", "comment.edited", "comment.deleted", "comment.redacted"];

/** Portal reads never inherit the staff viewer's wider audience (DES-079). */
export const portalAppletRoutes: FastifyPluginAsyncZod = async (app) => {
  for (const module of ["contract", "matter"] as const) {
    const table = module === "contract" ? contracts : matters;
    const team = module === "contract" ? contractTeam : matterTeam;
    const teamRecordId = module === "contract" ? contractTeam.contractId : matterTeam.matterId;
    app.get(
      `/portal/${module}s/:number/team`,
      {
        preHandler: requireAuth,
        schema: {
          operationId: `readPortal${module === "contract" ? "Contract" : "Matter"}Team`,
          tags: ["portal"],
          params: z.object({ number: z.coerce.number().int().positive() }),
          response: {
            200: z.object({
              team: z.array(Person),
              manager: Person.nullable(),
              businessOwner: Person.nullable(),
              creator: Person.nullable(),
            }),
            default: problemResponse,
          },
        },
      },
      async (request, reply) => {
        reply.header("cache-control", "private, no-store");
        const [record] = await app.db
          .select({
            id: table.id,
            managerId: table.managerId,
            businessOwnerId: table.businessOwnerId,
            createdBy: table.createdBy,
          })
          .from(table)
          .where(
            and(
              eq(table.number, request.params.number),
              portalRecordScope(app.db, request.user, module),
            ),
          )
          .limit(1);
        if (!record) throw httpError(404, "No record exists with this reference.");
        const [members, owners] = await Promise.all([
          app.db
            .select(PersonColumns)
            .from(team)
            .innerJoin(users, eq(users.id, team.userId))
            .where(eq(teamRecordId, record.id))
            .orderBy(asc(users.displayName), asc(users.id)),
          app.db
            .select(PersonColumns)
            .from(users)
            .where(
              inArray(
                users.id,
                [record.managerId, record.businessOwnerId, record.createdBy].filter(
                  (id) => id !== null,
                ),
              ),
            ),
        ]);
        const person = (id: string | null) => owners.find((owner) => owner.id === id) ?? null;
        return {
          team: members,
          manager: person(record.managerId),
          businessOwner: person(record.businessOwnerId),
          creator: person(record.createdBy),
        };
      },
    );
  }

  app.get(
    "/portal/activity",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listPortalActivity",
        tags: ["portal"],
        summary:
          "Full Thread history for a reached Portal record. Other tiers leave no entries or counts.",
        querystring: z.object({
          entityType: z.enum(["contract", "matter", "request"]),
          entityId: z.string().min(1).max(64),
          cursor: z.string().min(1).max(64).optional(),
        }),
        response: {
          200: z.object({
            entries: z.array(ActivityEntrySchema),
            nextCursor: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      const { entityType, entityId, cursor } = request.query;
      const keys = [
        "description",
        ...(entityType === "contract"
          ? ["value", "effectiveDate", "owningDepartment", "region"]
          : []),
      ];
      const entityKeys: string[] = [];
      if (entityType === "request") {
        const [record] = await app.db
          .select({ id: requests.id })
          .from(requests)
          .where(
            and(
              eq(requests.id, entityId),
              eq(requests.requesterId, request.user.id),
              isNull(requests.archivedAt),
              isNull(requests.convertedContractId),
              isNull(requests.convertedMatterId),
            ),
          )
          .limit(1);
        if (!record) throw httpError(404, "No record exists with this reference.");
      } else {
        const table = entityType === "contract" ? contracts : matters;
        const [record] = await app.db
          .select({
            typeId: entityType === "contract" ? contracts.contractTypeId : matters.matterTypeId,
          })
          .from(table)
          .where(and(eq(table.id, entityId), portalRecordScope(app.db, request.user, entityType)))
          .limit(1);
        if (!record) throw httpError(404, "No record exists with this reference.");
        const fields = await selectAttachedFields(
          app.db,
          entityType === "contract" ? contractTypeFields : matterTypeFields,
          record.typeId,
        );
        for (const field of fields) {
          if (field.fieldTag !== "business") continue;
          keys.push(`field.${field.slug}`);
          if (field.fieldType === "entity") entityKeys.push(`field.${field.slug}`);
        }
      }

      // Field tags and reference access can change after an append. Apply today's
      // projection before paging, so a now-private change leaves no row or cursor.
      const changed = sql`coalesce((select jsonb_object_agg(change.key,
      jsonb_build_object('from', change.value->'from', 'to', change.value->'to'))
      from jsonb_each(case when jsonb_typeof(${activityLog.payload}->'changed') = 'object'
        then ${activityLog.payload}->'changed' else '{}'::jsonb end) change
      where change.key = any(${sql.param(keys)}::text[])
        and jsonb_typeof(change.value) = 'object'
        and (not (change.key = any(${sql.param(entityKeys)}::text[])) or not exists (
          select 1 from jsonb_each(change.value) ref
          where ref.key in ('from', 'to') and ref.value <> 'null'::jsonb
            and not exists (select 1 from ${entities} where ${entities.id} = ref.value #>> '{}'
              and not ${entities.isConfidential} and ${entities.archivedAt} is null)
        ))), '{}'::jsonb)`;
      const scope = and(
        eq(activityLog.entityType, entityType),
        eq(activityLog.entityId, entityId),
        eq(activityLog.visibility, "full_thread"),
        sql`(${inArray(activityLog.action, COMMENT_ACTIONS)} or
        (${activityLog.action} = ${`${entityType}.updated`} and ${entityType} <> 'request' and ${changed} <> '{}'::jsonb))`,
      );
      const before = cursor
        ? sql`(${activityLog.createdAt}, ${activityLog.id}) < (
      select ${activityLog.createdAt}, ${activityLog.id} from ${activityLog}
      where ${activityLog.id} = ${cursor} and ${scope})`
        : undefined;
      const rows = await app.db
        .select({
          id: activityLog.id,
          action: activityLog.action,
          createdAt: activityLog.createdAt,
          actor: PersonColumns,
          // Unknown action families are closed by the scope above. In particular,
          // no raw Document, AI, Task, or internal comment payload reaches Portal.
          payload: sql<Record<string, unknown>>`case when ${activityLog.action} like 'comment.%'
        then jsonb_build_object('commentId', ${activityLog.payload}->'commentId')
        else jsonb_build_object('changed', ${changed}) end`,
        })
        .from(activityLog)
        .leftJoin(users, eq(users.id, activityLog.actorId))
        .where(and(scope, before))
        .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
        .limit(PAGE_SIZE + 1);
      const page = rows.slice(0, PAGE_SIZE);
      return {
        entries: page.map((row) => ({
          ...row,
          actor: row.actor?.id ? row.actor : null,
          visibility: "full_thread" as const,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor: rows.length > PAGE_SIZE ? page.at(-1)!.id : null,
      };
    },
  );
};
