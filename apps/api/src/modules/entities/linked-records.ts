// SPDX-License-Identifier: AGPL-3.0-only

/** Entity record roll-ups. Each target composes its own live reach predicate. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, contracts, count, eq, fields, matters, sql, CONTRACT_STAGES } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { contractTeamScope } from "../../lib/contract-access.js";
import { NO_ENTITY, reachedEntity } from "../../lib/entity-access.js";
import { matterTeamScope } from "../../lib/matter-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

import { ContractListQuery, ContractRowSchema } from "../contracts/record.js";
import { listContracts } from "../contracts/service.js";
import { MatterListQuery, MatterRowSchema } from "../matters/record.js";
import { listMatters } from "../matters/service.js";

const requireReader = requireRole("administrator", "legal_team_member");
const Params = z.object({ id: z.string().min(1).max(64) });
const Common = {
  restricted: z.literal(false),
  id: z.string(),
  number: z.int().positive(),
  title: z.string(),
  statusName: z.string(),
  isConfidential: z.boolean(),
  archived: z.boolean(),
};
const ContractRow = ContractRowSchema.extend({
  kind: z.literal("contract"),
  ...Common,
  statusCategory: z.enum(CONTRACT_STAGES),
});
const MatterRow = MatterRowSchema.extend({
  kind: z.literal("matter"),
  ...Common,
  statusCategory: z.enum(["open", "closed"]),
});
const ContractsEnvelope = z.object({
  records: z.array(ContractRow),
  total: z.int(),
  nextCursor: z.string().nullable(),
});
const MattersEnvelope = z.object({
  records: z.array(MatterRow),
  total: z.int(),
  nextCursor: z.string().nullable(),
});
const CountsEnvelope = z.object({
  contracts: z.int().nonnegative(),
  matters: z.int().nonnegative(),
});

const matterNamesEntity = (entityId: string) => sql`exists (
  select 1
  from ${fields}
  where ${fields.fieldType} = 'entity'
    and ${matters.customFields} ->> ${fields.slug} = ${entityId}
)`;

export const entityLinkedRecordsRoutes: FastifyPluginAsyncZod = async (app) => {
  async function assertEntity(id: string, user: Parameters<typeof reachedEntity>[1]) {
    const entity = await reachedEntity(app.db, user, id);
    if (!entity) throw httpError(404, NO_ENTITY);
    return entity;
  }

  app.get(
    "/entities/:id/contracts",
    {
      preHandler: requireReader,
      schema: {
        operationId: "listEntityContracts",
        summary: "Contracts signed by this Entity that the viewer independently reaches.",
        tags: ["entities"],
        params: Params,
        querystring: ContractListQuery,
        response: { 200: ContractsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const entity = await assertEntity(request.params.id, request.user);
      const page = await listContracts(
        app.db,
        request.user,
        {
          includeArchived: "true",
          includeEnded: "true",
          ...request.query,
        },
        eq(contracts.entityId, entity.id),
      );
      return {
        total: page.total,
        nextCursor: page.nextCursor,
        records: page.contracts.map((row) => ({
          ...row,
          kind: "contract" as const,
          restricted: false as const,
          statusCategory: row.stage,
          archived: row.archivedAt !== null,
        })),
      };
    },
  );

  app.get(
    "/entities/:id/matters",
    {
      preHandler: requireReader,
      schema: {
        operationId: "listEntityMatters",
        summary: "Matters naming this Entity in an attached Entity field that the viewer reaches.",
        tags: ["entities"],
        params: Params,
        querystring: MatterListQuery,
        response: { 200: MattersEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const entity = await assertEntity(request.params.id, request.user);
      const page = await listMatters(
        app.db,
        request.user,
        {
          includeArchived: "true",
          includeClosed: "true",
          ...request.query,
        },
        matterNamesEntity(entity.id),
      );
      return {
        total: page.total,
        nextCursor: page.nextCursor,
        records: page.matters.map((row) => ({
          ...row,
          kind: "matter" as const,
          restricted: false as const,
          archived: row.archivedAt !== null,
        })),
      };
    },
  );

  app.get(
    "/entities/:id/linked-record-counts",
    {
      preHandler: requireReader,
      schema: {
        operationId: "readEntityLinkedRecordCounts",
        summary: "Viewer-scoped Contract and Matter counts for Entity tab labels.",
        tags: ["entities"],
        params: Params,
        response: { 200: CountsEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const entity = await assertEntity(request.params.id, request.user);
      const [[contractCount], [matterCount]] = await Promise.all([
        app.db
          .select({ value: count() })
          .from(contracts)
          .where(and(eq(contracts.entityId, entity.id), contractTeamScope(app.db, request.user))),
        app.db
          .select({ value: count() })
          .from(matters)
          .where(and(matterNamesEntity(entity.id), matterTeamScope(app.db, request.user))),
      ]);
      return { contracts: contractCount!.value, matters: matterCount!.value };
    },
  );
};
