// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-006: the Inbox derives its unassigned queue from live generated Contracts. */
import {
  and,
  asc,
  autoDocGenerations,
  autoDocs,
  contracts,
  eq,
  gt,
  isNotNull,
  isNull,
  sql,
  users,
} from "@openlaw/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { contractTeamScope, reachesLockedContract } from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { legalOwnerChoices, requireLegalOwner } from "../auto-docs/assignment.js";

const requireMember = requireRole("administrator", "legal_team_member");
const Row = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
  createdAt: z.iso.datetime(),
  autoDoc: z.object({ id: z.string(), name: z.string() }).nullable(),
  generator: z.object({ id: z.string(), displayName: z.string(), email: z.string() }).nullable(),
});
const PAGE_SIZE = 50;
export const unassignedContractsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/inbox/unassigned-contracts",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listUnassignedContracts",
        tags: ["inbox"],
        querystring: z.object({ cursor: z.coerce.number().int().positive().optional() }),
        response: {
          200: z.object({
            total: z.number().int(),
            contracts: z.array(Row),
            nextCursor: z.number().int().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) =>
      app.db.transaction(
        async (tx) => {
          const scope = and(
            isNull(contracts.archivedAt),
            isNull(contracts.managerId),
            isNotNull(contracts.createdByGenerationId),
            contractTeamScope(tx, request.user),
          );
          const [count] = await tx
            .select({ total: sql<number>`count(*)::int` })
            .from(contracts)
            .where(scope);
          const rows = await tx
            .select({
              id: contracts.id,
              number: contracts.number,
              title: contracts.title,
              createdAt: contracts.createdAt,
              autoDoc: { id: autoDocs.id, name: autoDocs.name },
              generator: { id: users.id, displayName: users.displayName, email: users.email },
            })
            .from(contracts)
            .leftJoin(
              autoDocGenerations,
              eq(autoDocGenerations.id, contracts.createdByGenerationId),
            )
            .leftJoin(autoDocs, eq(autoDocs.id, autoDocGenerations.autoDocId))
            .leftJoin(users, eq(users.id, autoDocGenerations.generatedBy))
            .where(
              and(
                scope,
                request.query.cursor ? gt(contracts.number, request.query.cursor) : undefined,
              ),
            )
            .orderBy(asc(contracts.number))
            .limit(PAGE_SIZE + 1);
          const page = rows.slice(0, PAGE_SIZE);
          return {
            total: count!.total,
            contracts: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
            nextCursor: rows.length > PAGE_SIZE ? page.at(-1)!.number : null,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      ),
  );

  app.get(
    "/inbox/unassigned-contracts/assignees",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listUnassignedContractAssignees",
        tags: ["inbox"],
        response: {
          200: z.object({
            people: z.array(
              z.object({ id: z.string(), displayName: z.string(), email: z.string() }),
            ),
          }),
          default: problemResponse,
        },
      },
    },
    async () => ({ people: await legalOwnerChoices(app.db) }),
  );

  for (const action of ["claim", "assign"] as const) {
    app.post(
      `/inbox/unassigned-contracts/:number/${action}`,
      {
        preHandler: requireMember,
        schema: {
          operationId: action === "claim" ? "claimUnassignedContract" : "assignUnassignedContract",
          tags: ["inbox"],
          params: z.object({ number: z.coerce.number().int().positive() }),
          body:
            action === "claim"
              ? z.strictObject({})
              : z.strictObject({ legalOwnerId: z.string().min(1) }),
          response: {
            200: z.object({ id: z.string(), number: z.number().int(), title: z.string() }),
            default: problemResponse,
          },
        },
      },
      async (request) =>
        app.notifier.notifying(async (tx) => {
          const [row] = await tx
            .select()
            .from(contracts)
            .where(
              and(
                eq(contracts.number, request.params.number),
                isNull(contracts.archivedAt),
                contractTeamScope(tx, request.user),
              ),
            )
            .for("update");
          if (
            !row ||
            !row.createdByGenerationId ||
            !(await reachesLockedContract(tx, request.user, row))
          )
            throw httpError(404, "No generated Contract is available with this number.");
          if (row.managerId) throw httpError(409, "This Contract already has a Legal Owner.");
          const owner = await requireLegalOwner(
            tx,
            "legalOwnerId" in request.body ? request.body.legalOwnerId : request.user.id,
          );
          await tx
            .update(contracts)
            .set({ managerId: owner.id, updatedAt: new Date() })
            .where(eq(contracts.id, row.id));
          await recordActivity(tx, {
            entityType: "contract",
            entityId: row.id,
            actorId: request.user.id,
            action: "contract.updated",
            visibility: RECORD_ACTIVITY_TIER,
            payload: {
              number: row.number,
              title: row.title,
              changed: { owner: { from: null, to: owner.displayName } },
            },
          });
          await app.notifier.ownerAssigned(tx, {
            contractId: row.id,
            contractNumber: row.number,
            contractTitle: row.title,
            actorId: request.user.id,
            actorName: request.user.displayName,
            ownerId: owner.id,
          });
          return { id: row.id, number: row.number, title: row.title };
        }),
    );
  }
};
