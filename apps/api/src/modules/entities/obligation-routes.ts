// SPDX-License-Identifier: AGPL-3.0-only

/** Entity obligations, Mark filed, and the unified compliance calendar (ENT-006). */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  entities,
  entityObligations,
  entityRegistrations,
  eq,
  inArray,
  isNull,
  matters,
  sql,
  users,
  type EntityObligation,
  type Transaction,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { shiftMonths } from "../../lib/contract-term.js";
import {
  entityReachScope,
  NO_ENTITY,
  reachedEntity,
  type LockedEntity,
} from "../../lib/entity-access.js";
import { matterTeamScope } from "../../lib/matter-access.js";
import { localMoment } from "../../lib/notifications/local-day.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const requireMember = requireRole("administrator", "legal_team_member");
const MEMBER_PLUS = ["administrator", "legal_team_member"] as const;
const IdParams = z.object({ id: z.string().min(1).max(64) });
const ChildParams = IdParams.extend({ childId: z.string().min(1).max(64) });
const LabelSchema = z.string().trim().min(1).max(200);
const NullableId = z.string().min(1).max(64).nullable();
const NullableNote = z.string().trim().max(2_000).nullable();
const Recurrence = z.number().int().min(1).max(1_200).nullable();

const RegistrationSummary = z.object({
  id: z.string(),
  jurisdiction: z.string(),
  registrationNumber: z.string().nullable(),
});
const AssigneeSummary = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
});
const MatterSummary = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
});
const ObligationSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  label: z.string(),
  registration: RegistrationSummary.nullable(),
  recurrenceMonths: z.number().int().nullable(),
  nextDueOn: z.iso.date(),
  assignee: AssigneeSummary.nullable(),
  note: z.string().nullable(),
  matter: MatterSummary.nullable(),
  completedOn: z.iso.date().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const CalendarObligationSchema = ObligationSchema.extend({
  entity: z.object({ id: z.string(), legalName: z.string() }),
  overdue: z.boolean(),
});

const CreateBody = z.strictObject({
  label: LabelSchema,
  registrationId: NullableId.optional(),
  recurrenceMonths: Recurrence.optional(),
  nextDueOn: z.iso.date(),
  assigneeId: NullableId.optional(),
  note: NullableNote.optional(),
  matterId: NullableId.optional(),
});
const UpdateBody = z.strictObject({
  label: LabelSchema.optional(),
  registrationId: NullableId.optional(),
  recurrenceMonths: Recurrence.optional(),
  nextDueOn: z.iso.date().optional(),
  assigneeId: NullableId.optional(),
  note: NullableNote.optional(),
  matterId: NullableId.optional(),
});

function obligationProjection(db: Transaction | Parameters<typeof reachedEntity>[0]) {
  return db
    .select({
      obligation: entityObligations,
      entityLegalName: entities.legalName,
      registrationJurisdiction: entityRegistrations.jurisdiction,
      registrationNumber: entityRegistrations.registrationNumber,
      assigneeDisplayName: users.displayName,
      assigneeImage: users.image,
      matterNumber: matters.number,
      matterTitle: matters.title,
    })
    .from(entityObligations)
    .innerJoin(entities, eq(entityObligations.entityId, entities.id))
    .leftJoin(entityRegistrations, eq(entityObligations.registrationId, entityRegistrations.id))
    .leftJoin(users, eq(entityObligations.assigneeId, users.id))
    .leftJoin(matters, eq(entityObligations.matterId, matters.id));
}

type Projected = Awaited<ReturnType<typeof obligationProjection>>[number];

function toObligation(row: Projected) {
  const obligation = row.obligation;
  return {
    id: obligation.id,
    entityId: obligation.entityId,
    label: obligation.label,
    registration: obligation.registrationId
      ? {
          id: obligation.registrationId,
          jurisdiction: row.registrationJurisdiction!,
          registrationNumber: row.registrationNumber,
        }
      : null,
    recurrenceMonths: obligation.recurrenceMonths,
    nextDueOn: obligation.nextDueOn,
    assignee: obligation.assigneeId
      ? {
          id: obligation.assigneeId,
          displayName: row.assigneeDisplayName!,
          image: row.assigneeImage,
        }
      : null,
    note: obligation.note,
    matter: obligation.matterId
      ? {
          id: obligation.matterId,
          number: row.matterNumber!,
          title: row.matterTitle!,
        }
      : null,
    completedOn: obligation.completedOn,
    createdAt: obligation.createdAt.toISOString(),
    updatedAt: obligation.updatedAt.toISOString(),
  };
}

async function projectedObligation(db: Parameters<typeof obligationProjection>[0], id: string) {
  const [row] = await obligationProjection(db).where(eq(entityObligations.id, id)).limit(1);
  if (!row) throw new Error("An obligation projection requires its row.");
  return toObligation(row);
}

function assertEditable(entity: LockedEntity) {
  if (entity.archivedAt)
    throw httpError(409, "This entity is archived. Restore it before editing.");
}

async function lockEntity(
  tx: Transaction,
  requestUser: Parameters<typeof reachedEntity>[1],
  id: string,
) {
  const entity = await reachedEntity(tx, requestUser, id, { lock: true });
  if (!entity) throw httpError(404, NO_ENTITY);
  assertEditable(entity);
  return entity;
}

async function assertRegistration(
  tx: Transaction,
  entityId: string,
  registrationId: string | null,
) {
  if (registrationId === null) return;
  const [row] = await tx
    .select({ id: entityRegistrations.id })
    .from(entityRegistrations)
    .where(
      and(eq(entityRegistrations.id, registrationId), eq(entityRegistrations.entityId, entityId)),
    )
    .limit(1)
    .for("update");
  if (!row) throw httpError(400, "The registration must belong to this entity.");
}

async function assertAssignee(tx: Transaction, assigneeId: string | null) {
  if (assigneeId === null) return;
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, assigneeId),
        isNull(users.archivedAt),
        inArray(users.role, [...MEMBER_PLUS]),
      ),
    )
    .limit(1)
    .for("update");
  if (!row) throw httpError(400, "The assignee must be a live Legal Team Member or Administrator.");
}

async function assertMatter(
  tx: Transaction,
  user: Parameters<typeof matterTeamScope>[1],
  matterId: string | null,
) {
  if (matterId === null) return;
  const [row] = await tx
    .select({ id: matters.id })
    .from(matters)
    .where(and(eq(matters.id, matterId), isNull(matters.archivedAt), matterTeamScope(tx, user)))
    .limit(1)
    .for("update");
  if (!row) throw httpError(400, "The Matter must be live and reachable.");
}

function changedFields(target: EntityObligation, body: z.infer<typeof UpdateBody>) {
  const patch: Partial<EntityObligation> = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const normalized = {
    ...body,
    ...(body.label !== undefined ? { label: body.label.trim() } : {}),
    ...(body.note !== undefined ? { note: body.note?.trim() || null } : {}),
  };
  for (const key of [
    "label",
    "registrationId",
    "recurrenceMonths",
    "nextDueOn",
    "assigneeId",
    "note",
    "matterId",
  ] as const) {
    const value = normalized[key];
    if (value !== undefined && value !== target[key]) {
      (patch as Record<string, unknown>)[key] = value;
      changed[key] = { from: target[key], to: value };
    }
  }
  return { patch, changed };
}

export const entityObligationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/entities/calendar",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listEntityCalendar",
        tags: ["entities"],
        querystring: z
          .object({
            entity: z.string().min(1).max(64).optional(),
            assignee: z.string().min(1).max(64).optional(),
            from: z.iso.date().optional(),
            to: z.iso.date().optional(),
            includeCompleted: z.enum(["true", "false"]).optional(),
          })
          .refine((query) => !query.from || !query.to || query.from <= query.to, {
            message: "The from date must be on or before the to date.",
          }),
        response: {
          200: z.object({ obligations: z.array(CalendarObligationSchema) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const today = localMoment(new Date(), request.user.timezone).date;
      const overdueRank = sql<number>`case when ${entityObligations.completedOn} is null and ${entityObligations.nextDueOn} < ${today} then 0 else 1 end`;
      const rows = await obligationProjection(app.db)
        .where(
          and(
            isNull(entities.archivedAt),
            entityReachScope(app.db, request.user),
            request.query.entity ? eq(entityObligations.entityId, request.query.entity) : undefined,
            request.query.assignee === "unassigned"
              ? isNull(entityObligations.assigneeId)
              : request.query.assignee
                ? eq(entityObligations.assigneeId, request.query.assignee)
                : undefined,
            request.query.from
              ? sql`${entityObligations.nextDueOn} >= ${request.query.from}`
              : undefined,
            request.query.to
              ? sql`${entityObligations.nextDueOn} <= ${request.query.to}`
              : undefined,
            request.query.includeCompleted === "true"
              ? undefined
              : isNull(entityObligations.completedOn),
          ),
        )
        .orderBy(overdueRank, asc(entityObligations.nextDueOn), asc(entityObligations.id));
      return {
        obligations: rows.map((row) => ({
          ...toObligation(row),
          entity: { id: row.obligation.entityId, legalName: row.entityLegalName },
          overdue: row.obligation.completedOn === null && row.obligation.nextDueOn < today,
        })),
      };
    },
  );

  app.get(
    "/entities/obligation-options",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listEntityObligationOptions",
        tags: ["entities"],
        response: {
          200: z.object({
            users: z.array(AssigneeSummary),
            matters: z.array(MatterSummary),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const [people, matterRows] = await Promise.all([
        app.db
          .select({ id: users.id, displayName: users.displayName, image: users.image })
          .from(users)
          .where(and(isNull(users.archivedAt), inArray(users.role, [...MEMBER_PLUS])))
          .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id)),
        app.db
          .select({ id: matters.id, number: matters.number, title: matters.title })
          .from(matters)
          .where(and(isNull(matters.archivedAt), matterTeamScope(app.db, request.user)))
          .orderBy(asc(matters.number)),
      ]);
      return { users: people, matters: matterRows };
    },
  );

  app.get(
    "/entities/:id/obligations",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listEntityObligations",
        tags: ["entities"],
        params: IdParams,
        response: {
          200: z.object({ obligations: z.array(ObligationSchema) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const entity = await reachedEntity(app.db, request.user, request.params.id);
      if (!entity) throw httpError(404, NO_ENTITY);
      const rows = await obligationProjection(app.db)
        .where(eq(entityObligations.entityId, entity.id))
        .orderBy(asc(entityObligations.nextDueOn), asc(entityObligations.id));
      return { obligations: rows.map(toObligation) };
    },
  );

  app.post(
    "/entities/:id/obligations",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createEntityObligation",
        tags: ["entities"],
        params: IdParams,
        body: CreateBody,
        response: { 201: z.object({ obligation: ObligationSchema }), default: problemResponse },
      },
    },
    async (request, reply) => {
      const id = await app.db.transaction(async (tx) => {
        const entity = await lockEntity(tx, request.user, request.params.id);
        const registrationId = request.body.registrationId ?? null;
        const assigneeId = request.body.assigneeId ?? null;
        const matterId = request.body.matterId ?? null;
        await assertRegistration(tx, entity.id, registrationId);
        await assertAssignee(tx, assigneeId);
        await assertMatter(tx, request.user, matterId);
        const [created] = await tx
          .insert(entityObligations)
          .values({
            entityId: entity.id,
            label: request.body.label.trim(),
            registrationId,
            recurrenceMonths: request.body.recurrenceMonths ?? null,
            nextDueOn: request.body.nextDueOn,
            assigneeId,
            note: request.body.note?.trim() || null,
            matterId,
          })
          .returning({ id: entityObligations.id });
        await recordActivity(tx, {
          entityType: "entity",
          entityId: entity.id,
          actorId: request.user.id,
          action: "entity_obligation.created",
          visibility: "legal_only",
          payload: {
            legalName: entity.legalName,
            obligationId: created!.id,
            label: request.body.label.trim(),
            nextDueOn: request.body.nextDueOn,
          },
        });
        return created!.id;
      });
      return reply.status(201).send({ obligation: await projectedObligation(app.db, id) });
    },
  );

  app.patch(
    "/entities/:id/obligations/:childId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateEntityObligation",
        tags: ["entities"],
        params: ChildParams,
        body: UpdateBody,
        response: { 200: z.object({ obligation: ObligationSchema }), default: problemResponse },
      },
    },
    async (request) => {
      const id = await app.db.transaction(async (tx) => {
        const entity = await lockEntity(tx, request.user, request.params.id);
        const [target] = await tx
          .select()
          .from(entityObligations)
          .where(
            and(
              eq(entityObligations.id, request.params.childId),
              eq(entityObligations.entityId, entity.id),
            ),
          )
          .limit(1)
          .for("update");
        if (!target) throw httpError(404, "No obligation exists with this id under this entity.");
        const { patch, changed } = changedFields(target, request.body);
        if (request.body.registrationId !== undefined)
          await assertRegistration(tx, entity.id, request.body.registrationId);
        if (request.body.assigneeId !== undefined)
          await assertAssignee(tx, request.body.assigneeId);
        if (request.body.matterId !== undefined)
          await assertMatter(tx, request.user, request.body.matterId);
        if (Object.keys(patch).length === 0) return target.id;
        await tx
          .update(entityObligations)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(entityObligations.id, target.id));
        await recordActivity(tx, {
          entityType: "entity",
          entityId: entity.id,
          actorId: request.user.id,
          action: "entity_obligation.updated",
          visibility: "legal_only",
          payload: {
            legalName: entity.legalName,
            obligationId: target.id,
            label: patch.label ?? target.label,
            changed,
          },
        });
        return target.id;
      });
      return { obligation: await projectedObligation(app.db, id) };
    },
  );

  app.delete(
    "/entities/:id/obligations/:childId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "deleteEntityObligation",
        tags: ["entities"],
        params: ChildParams,
        response: { 204: z.void(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        const entity = await lockEntity(tx, request.user, request.params.id);
        const [target] = await tx
          .select()
          .from(entityObligations)
          .where(
            and(
              eq(entityObligations.id, request.params.childId),
              eq(entityObligations.entityId, entity.id),
            ),
          )
          .limit(1)
          .for("update");
        if (!target) throw httpError(404, "No obligation exists with this id under this entity.");
        await tx.delete(entityObligations).where(eq(entityObligations.id, target.id));
        await recordActivity(tx, {
          entityType: "entity",
          entityId: entity.id,
          actorId: request.user.id,
          action: "entity_obligation.deleted",
          visibility: "legal_only",
          payload: {
            legalName: entity.legalName,
            obligationId: target.id,
            label: target.label,
            nextDueOn: target.nextDueOn,
          },
        });
      });
      return reply.status(204).send();
    },
  );

  app.post(
    "/entities/:id/obligations/:childId/file",
    {
      preHandler: requireMember,
      schema: {
        operationId: "fileEntityObligation",
        tags: ["entities"],
        params: ChildParams,
        body: z.strictObject({ filedOn: z.iso.date().optional() }),
        response: { 200: z.object({ obligation: ObligationSchema }), default: problemResponse },
      },
    },
    async (request) => {
      const id = await app.db.transaction(async (tx) => {
        const entity = await lockEntity(tx, request.user, request.params.id);
        const [target] = await tx
          .select()
          .from(entityObligations)
          .where(
            and(
              eq(entityObligations.id, request.params.childId),
              eq(entityObligations.entityId, entity.id),
            ),
          )
          .limit(1)
          .for("update");
        if (!target) throw httpError(404, "No obligation exists with this id under this entity.");
        if (target.completedOn) throw httpError(409, "This one-off obligation is already filed.");
        const filedOn = request.body.filedOn ?? localMoment(new Date(), request.user.timezone).date;
        let nextDueOn: string | null = null;
        let completedOn: string | null = null;
        if (target.recurrenceMonths === null) {
          completedOn = filedOn;
          await tx
            .update(entityObligations)
            .set({ completedOn, updatedAt: new Date() })
            .where(eq(entityObligations.id, target.id));
        } else {
          nextDueOn = shiftMonths(target.nextDueOn, target.recurrenceMonths);
          while (nextDueOn <= filedOn) {
            nextDueOn = shiftMonths(nextDueOn, target.recurrenceMonths);
          }
          await tx
            .update(entityObligations)
            .set({ nextDueOn, updatedAt: new Date() })
            .where(eq(entityObligations.id, target.id));
        }
        await recordActivity(tx, {
          entityType: "entity",
          entityId: entity.id,
          actorId: request.user.id,
          action: "entity_obligation.filed",
          visibility: "legal_only",
          payload: {
            legalName: entity.legalName,
            obligationId: target.id,
            label: target.label,
            cycleDate: filedOn,
            previousDueOn: target.nextDueOn,
            nextDueOn,
            completedOn,
          },
        });
        return target.id;
      });
      return { obligation: await projectedObligation(app.db, id) };
    },
  );
};
