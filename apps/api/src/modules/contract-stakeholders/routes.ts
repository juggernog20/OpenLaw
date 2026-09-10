// SPDX-License-Identifier: AGPL-3.0-only

/** DD-021 stakeholder links grant Portal access independently of ownership.
 * Member+ alone maintains these grants; Contributors cannot change the audience. */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, contractStakeholders, eq, users, type Executor } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { reachedContract, NO_CONTRACT } from "../../lib/contract-access.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const Params = z.object({ number: z.coerce.number().int().positive() });
const Person = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});
const Envelope = z.object({ stakeholders: z.array(Person) });
const ACCESS_SUMMARY =
  "Administrator or Legal Team Member only; Contributor and Business User refused. Unreachable Contracts return 404. ";
const member = requireRole("administrator", "legal_team_member");

async function list(db: Executor, contractId: string) {
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      image: users.image,
      archivedAt: users.archivedAt,
    })
    .from(contractStakeholders)
    .innerJoin(users, eq(contractStakeholders.userId, users.id))
    .where(eq(contractStakeholders.contractId, contractId))
    .orderBy(asc(users.displayName), asc(users.id));
  return rows.map(({ archivedAt, ...person }) => ({ ...person, archived: archivedAt !== null }));
}

export const contractStakeholderRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/contracts/:number/stakeholders",
    {
      preHandler: member,
      schema: {
        operationId: "listContractStakeholders",
        summary: ACCESS_SUMMARY + "List explicit stakeholders, including on archived Contracts.",
        tags: ["contracts"],
        params: Params,
        response: { 200: Envelope, default: problemResponse },
      },
    },
    async (request) => {
      const contract = await reachedContract(app.db, request.user, request.params.number);
      if (!contract) throw httpError(404, NO_CONTRACT);
      return { stakeholders: await list(app.db, contract.id) };
    },
  );

  app.post(
    "/contracts/:number/stakeholders",
    {
      preHandler: member,
      schema: {
        operationId: "addContractStakeholder",
        summary: ACCESS_SUMMARY + "Add a live person; archived Contracts return 409.",
        tags: ["contracts"],
        params: Params,
        body: z.strictObject({ userId: z.string().min(1) }),
        response: { 201: Envelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const stakeholders = await app.db.transaction(async (tx) => {
        const contract = await reachedContract(tx, request.user, request.params.number, {
          lock: true,
        });
        if (!contract) throw httpError(404, NO_CONTRACT);
        if (contract.archivedAt)
          throw httpError(409, "Restore this Contract before changing stakeholders.");
        const [person] = await tx
          .select({ id: users.id, archivedAt: users.archivedAt })
          .from(users)
          .where(eq(users.id, request.body.userId))
          .for("update");
        if (!person || person.archivedAt)
          throw httpError(400, "A stakeholder must be a live person.");
        const before = await list(tx, contract.id);
        const inserted = await tx
          .insert(contractStakeholders)
          .values({ contractId: contract.id, userId: person.id })
          .onConflictDoNothing()
          .returning();
        if (inserted.length === 0) throw httpError(409, "This person is already a stakeholder.");
        const after = await list(tx, contract.id);
        await recordActivity(tx, {
          entityType: "contract",
          entityId: contract.id,
          actorId: request.user.id,
          action: "contract.updated",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: contract.number,
            title: contract.title,
            changed: {
              stakeholders: {
                from: before.map((row) => row.displayName),
                to: after.map((row) => row.displayName),
              },
            },
          },
        });
        return after;
      });
      return reply.status(201).send({ stakeholders });
    },
  );

  app.delete(
    "/contracts/:number/stakeholders/:userId",
    {
      preHandler: member,
      schema: {
        operationId: "removeContractStakeholder",
        summary: ACCESS_SUMMARY + "Remove an explicit stakeholder; archived Contracts return 409.",
        tags: ["contracts"],
        params: Params.extend({ userId: z.string().min(1) }),
        response: { 200: Envelope, default: problemResponse },
      },
    },
    async (request) => {
      return app.db.transaction(async (tx) => {
        const contract = await reachedContract(tx, request.user, request.params.number, {
          lock: true,
        });
        if (!contract) throw httpError(404, NO_CONTRACT);
        if (contract.archivedAt)
          throw httpError(409, "Restore this Contract before changing stakeholders.");
        const before = await list(tx, contract.id);
        const removed = await tx
          .delete(contractStakeholders)
          .where(
            and(
              eq(contractStakeholders.contractId, contract.id),
              eq(contractStakeholders.userId, request.params.userId),
            ),
          )
          .returning();
        if (removed.length === 0) throw httpError(404, "No stakeholder exists with this id.");
        const after = await list(tx, contract.id);
        await recordActivity(tx, {
          entityType: "contract",
          entityId: contract.id,
          actorId: request.user.id,
          action: "contract.updated",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            number: contract.number,
            title: contract.title,
            changed: {
              stakeholders: {
                from: before.map((row) => row.displayName),
                to: after.map((row) => row.displayName),
              },
            },
          },
        });
        return { stakeholders: after };
      });
    },
  );
};
