// SPDX-License-Identifier: AGPL-3.0-only

/** CTR-026: the Administrator's ordered People card. The Type lock also serializes creation. */
import {
  and,
  asc,
  contractTypeDefaultPeople as defaults,
  contractTypes,
  eq,
  sql,
  users,
  USER_ROLES,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const Params = z.object({ id: z.string() });
const Person = z.object({
  id: z.string(),
  displayName: z.string(),
  role: z.enum(USER_ROLES),
  archived: z.boolean(),
  displayOrder: z.number().int(),
});
const Envelope = z.object({ people: z.array(Person) });
const requireAdmin = requireRole("administrator");
function people(db: Executor, id: string) {
  return db
    .select({
      id: users.id,
      displayName: users.displayName,
      role: users.role,
      archived: sql<boolean>`${users.archivedAt} is not null`,
      displayOrder: defaults.displayOrder,
    })
    .from(defaults)
    .innerJoin(users, eq(users.id, defaults.userId))
    .where(eq(defaults.contractTypeId, id))
    .orderBy(asc(defaults.displayOrder), asc(defaults.userId));
}
async function typeRow(db: Executor, id: string, edit = true) {
  const query = db.select().from(contractTypes).where(eq(contractTypes.id, id));
  const [row] = edit ? await query.for("update") : await query;
  if (!row) throw httpError(404, "No contract type exists with this id.");
  if (edit && row.archivedAt)
    throw httpError(409, "Restore this contract type before changing its default people.");
  return row;
}
async function audit(
  tx: Transaction,
  type: { id: string; slug: string },
  actorId: string,
  before: string[],
  after: string[],
) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  await recordActivity(tx, {
    entityType: "system",
    actorId,
    action: "contract_type.updated",
    visibility: "admin_only",
    payload: { slug: type.slug, changed: { defaultPeople: { from: before, to: after } } },
  });
}

export const defaultPeopleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/contract-types/:id/people",
    {
      preHandler: requireAdmin,
      schema: {
        operationId: "listContractTypeDefaultPeople",
        summary: "Administrator reads ordered default people, including archived users.",
        tags: ["contract-types"],
        params: Params,
        response: { 200: Envelope, default: problemResponse },
      },
    },
    async (request) => {
      await typeRow(app.db, request.params.id, false);
      return { people: await people(app.db, request.params.id) };
    },
  );
  app.post(
    "/contract-types/:id/people",
    {
      preHandler: requireAdmin,
      schema: {
        operationId: "addContractTypeDefaultPerson",
        summary:
          "Administrator adds a live default person. Returns 409 for an archived Contract Type or a duplicate person.",
        tags: ["contract-types"],
        params: Params,
        body: z.strictObject({ userId: z.string().min(1) }),
        response: { 201: Envelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const result = await app.db.transaction(async (tx) => {
        const type = await typeRow(tx, request.params.id);
        const [person] = await tx
          .select()
          .from(users)
          .where(eq(users.id, request.body.userId))
          .for("update");
        if (!person || person.archivedAt) throw httpError(400, "Choose an active person.");
        const before = await people(tx, type.id);
        if (before.some((p) => p.id === person.id))
          throw httpError(409, "This person is already a default person.");
        await tx.insert(defaults).values({
          contractTypeId: type.id,
          userId: person.id,
          displayOrder: Math.max(-1, ...before.map((p) => p.displayOrder)) + 1,
        });
        const after = await people(tx, type.id);
        await audit(
          tx,
          type,
          request.user.id,
          before.map((p) => p.id),
          after.map((p) => p.id),
        );
        return { people: after };
      });
      return reply.status(201).send(result);
    },
  );
  app.delete(
    "/contract-types/:id/people/:userId",
    {
      preHandler: requireAdmin,
      schema: {
        operationId: "removeContractTypeDefaultPerson",
        summary:
          "Administrator removes a default person. Returns 409 for an archived Contract Type.",
        tags: ["contract-types"],
        params: Params.extend({ userId: z.string() }),
        response: { 200: Envelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const type = await typeRow(tx, request.params.id);
        const before = await people(tx, type.id);
        if (!before.some((p) => p.id === request.params.userId))
          throw httpError(404, "This person is not a default person.");
        await tx
          .delete(defaults)
          .where(
            and(eq(defaults.contractTypeId, type.id), eq(defaults.userId, request.params.userId)),
          );
        const after = await people(tx, type.id);
        await audit(
          tx,
          type,
          request.user.id,
          before.map((p) => p.id),
          after.map((p) => p.id),
        );
        return { people: after };
      }),
  );
  app.put(
    "/contract-types/:id/people/order",
    {
      preHandler: requireAdmin,
      schema: {
        operationId: "reorderContractTypeDefaultPeople",
        summary:
          "Administrator reorders every default person. Returns 409 for an archived Contract Type.",
        tags: ["contract-types"],
        params: Params,
        body: z.strictObject({ userIds: z.array(z.string()) }),
        response: { 200: Envelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const type = await typeRow(tx, request.params.id);
        const before = await people(tx, type.id);
        const order = request.body.userIds;
        if (
          new Set(order).size !== order.length ||
          order.length !== before.length ||
          before.some((p) => !order.includes(p.id))
        )
          throw httpError(400, "Name every default person exactly once.");
        for (const [displayOrder, userId] of order.entries())
          await tx
            .update(defaults)
            .set({ displayOrder })
            .where(and(eq(defaults.contractTypeId, type.id), eq(defaults.userId, userId)));
        await audit(
          tx,
          type,
          request.user.id,
          before.map((p) => p.id),
          order,
        );
        return { people: await people(tx, type.id) };
      }),
  );
};
