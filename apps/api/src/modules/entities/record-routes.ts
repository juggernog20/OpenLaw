// SPDX-License-Identifier: AGPL-3.0-only

/** Officers and registrations on the Entity record (ENT-001/ENT-002). */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  desc,
  entityOfficers,
  entityRegistrations,
  eq,
  ENTITY_REGISTRATION_STATUSES,
  isNull,
  officerRoles,
  sql,
  users,
  type EntityOfficer,
  type EntityRegistration,
  type Transaction,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { NO_ENTITY, reachedEntity, type LockedEntity } from "../../lib/entity-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const requireMember = requireRole("administrator", "legal_team_member");
const IdParams = z.object({ id: z.string().min(1).max(64) });
const ChildParams = IdParams.extend({ childId: z.string().min(1).max(64) });
const NameSchema = z.string().trim().min(1).max(200);
const OptionalTextSchema = z.string().trim().max(200).nullable();

const OfficerSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  name: z.string(),
  officerRoleId: z.string(),
  officerRoleName: z.string(),
  appointedOn: z.iso.date().nullable(),
  resignedOn: z.iso.date().nullable(),
  user: z
    .object({
      id: z.string(),
      displayName: z.string(),
      image: z.string().nullable(),
      archived: z.boolean(),
    })
    .nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const RegistrationSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  jurisdiction: z.string(),
  registrationNumber: z.string().nullable(),
  registeredAgent: z.string().nullable(),
  status: z.enum(ENTITY_REGISTRATION_STATUSES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

type OfficerProjection = z.infer<typeof OfficerSchema>;

function toRegistration(row: EntityRegistration) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function selectOfficer(db: Transaction | Parameters<typeof selectOfficers>[0], id: string) {
  const [row] = await selectOfficers(db).where(eq(entityOfficers.id, id)).limit(1);
  return row ?? null;
}

function selectOfficers(db: Parameters<typeof reachedEntity>[0]) {
  return db
    .select({
      id: entityOfficers.id,
      entityId: entityOfficers.entityId,
      name: entityOfficers.name,
      officerRoleId: entityOfficers.officerRoleId,
      officerRoleName: officerRoles.displayName,
      appointedOn: entityOfficers.appointedOn,
      resignedOn: entityOfficers.resignedOn,
      userId: users.id,
      userDisplayName: users.displayName,
      userImage: users.image,
      userArchivedAt: users.archivedAt,
      createdAt: entityOfficers.createdAt,
      updatedAt: entityOfficers.updatedAt,
    })
    .from(entityOfficers)
    .innerJoin(officerRoles, eq(entityOfficers.officerRoleId, officerRoles.id))
    .leftJoin(users, eq(entityOfficers.userId, users.id));
}

function toOfficer(row: Awaited<ReturnType<typeof selectOfficer>>): OfficerProjection {
  if (!row) throw new Error("An officer projection requires a row.");
  return {
    id: row.id,
    entityId: row.entityId,
    name: row.name,
    officerRoleId: row.officerRoleId,
    officerRoleName: row.officerRoleName,
    appointedOn: row.appointedOn,
    resignedOn: row.resignedOn,
    user: row.userId
      ? {
          id: row.userId,
          displayName: row.userDisplayName!,
          image: row.userImage,
          archived: row.userArchivedAt !== null,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertEditable(entity: LockedEntity) {
  if (entity.archivedAt) {
    throw httpError(409, "This entity is archived. Restore it before editing.");
  }
}

async function officerRole(tx: Transaction, id: string, requireLive = true) {
  const [role] = await tx
    .select({
      id: officerRoles.id,
      displayName: officerRoles.displayName,
      archivedAt: officerRoles.archivedAt,
    })
    .from(officerRoles)
    .where(eq(officerRoles.id, id))
    .limit(1)
    .for("update");
  if (!role || (requireLive && role.archivedAt)) {
    throw httpError(400, "The officer role must be a live role.");
  }
  return role;
}

async function liveUser(tx: Transaction, id: string | null) {
  if (id === null) return null;
  const [person] = await tx
    .select({ id: users.id, displayName: users.displayName, archivedAt: users.archivedAt })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
    .for("update");
  if (!person || person.archivedAt) throw httpError(400, "The linked user must be a live person.");
  return person;
}

function assertOfficerDates(appointedOn: string | null, resignedOn: string | null) {
  if (appointedOn && resignedOn && resignedOn < appointedOn) {
    throw httpError(400, "The resignation date cannot be before the appointment date.");
  }
}

async function lockedEntity(
  tx: Transaction,
  user: Parameters<typeof reachedEntity>[1],
  id: string,
) {
  const entity = await reachedEntity(tx, user, id, { lock: true });
  if (!entity) throw httpError(404, NO_ENTITY);
  assertEditable(entity);
  return entity;
}

export const entityRecordChildRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/entities/:id/officers",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listEntityOfficers",
        tags: ["entities"],
        params: IdParams,
        querystring: z.object({ includeFormer: z.enum(["true", "false"]).optional() }),
        response: { 200: z.object({ officers: z.array(OfficerSchema) }), default: problemResponse },
      },
    },
    async (request) => {
      const entity = await reachedEntity(app.db, request.user, request.params.id);
      if (!entity) throw httpError(404, NO_ENTITY);
      const rows = await selectOfficers(app.db)
        .where(
          and(
            eq(entityOfficers.entityId, entity.id),
            request.query.includeFormer === "true" ? undefined : isNull(entityOfficers.resignedOn),
          ),
        )
        .orderBy(
          asc(sql`case when ${entityOfficers.resignedOn} is null then 0 else 1 end`),
          desc(entityOfficers.appointedOn),
          desc(entityOfficers.createdAt),
        );
      return { officers: rows.map((row) => toOfficer(row)) };
    },
  );

  app.post(
    "/entities/:id/officers",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createEntityOfficer",
        tags: ["entities"],
        params: IdParams,
        body: z.strictObject({
          name: NameSchema,
          officerRoleId: z.string(),
          appointedOn: z.iso.date().nullable().optional(),
          resignedOn: z.iso.date().nullable().optional(),
          userId: z.string().nullable().optional(),
        }),
        response: { 201: z.object({ officer: OfficerSchema }), default: problemResponse },
      },
    },
    async (request, reply) => {
      const id = await app.db.transaction(async (tx) => {
        const entity = await lockedEntity(tx, request.user, request.params.id);
        const role = await officerRole(tx, request.body.officerRoleId);
        const person = await liveUser(tx, request.body.userId ?? null);
        const appointedOn = request.body.appointedOn ?? null;
        const resignedOn = request.body.resignedOn ?? null;
        assertOfficerDates(appointedOn, resignedOn);
        const [created] = await tx
          .insert(entityOfficers)
          .values({
            entityId: entity.id,
            name: request.body.name.trim(),
            officerRoleId: role.id,
            appointedOn,
            resignedOn,
            userId: person?.id ?? null,
          })
          .returning({ id: entityOfficers.id });
        await recordActivity(tx, {
          entityType: "entity",
          entityId: entity.id,
          actorId: request.user.id,
          action: "entity_officer.created",
          visibility: "legal_only",
          payload: {
            legalName: entity.legalName,
            officerName: request.body.name.trim(),
            role: role.displayName,
            appointedOn,
            resignedOn,
            userName: person?.displayName ?? null,
          },
        });
        return created!.id;
      });
      const officer = await selectOfficer(app.db, id);
      return reply.status(201).send({ officer: toOfficer(officer) });
    },
  );

  app.patch(
    "/entities/:id/officers/:childId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateEntityOfficer",
        tags: ["entities"],
        params: ChildParams,
        body: z.strictObject({
          name: NameSchema.optional(),
          officerRoleId: z.string().optional(),
          appointedOn: z.iso.date().nullable().optional(),
          resignedOn: z.iso.date().nullable().optional(),
          userId: z.string().nullable().optional(),
        }),
        response: { 200: z.object({ officer: OfficerSchema }), default: problemResponse },
      },
    },
    async (request) => {
      const id = await app.db.transaction(async (tx) => {
        const entity = await lockedEntity(tx, request.user, request.params.id);
        const [target] = await tx
          .select()
          .from(entityOfficers)
          .where(
            and(
              eq(entityOfficers.id, request.params.childId),
              eq(entityOfficers.entityId, entity.id),
            ),
          )
          .limit(1)
          .for("update");
        if (!target) throw httpError(404, "No officer exists with this id under this entity.");
        const patch: Partial<EntityOfficer> = {};
        const changed: Record<string, { from: unknown; to: unknown }> = {};
        if (request.body.name !== undefined && request.body.name.trim() !== target.name) {
          patch.name = request.body.name.trim();
          changed.name = { from: target.name, to: patch.name };
        }
        if (
          request.body.officerRoleId !== undefined &&
          request.body.officerRoleId !== target.officerRoleId
        ) {
          const current = await officerRole(tx, target.officerRoleId, false);
          const next = await officerRole(tx, request.body.officerRoleId);
          patch.officerRoleId = next.id;
          changed.role = { from: current.displayName, to: next.displayName };
        }
        if (
          request.body.appointedOn !== undefined &&
          request.body.appointedOn !== target.appointedOn
        ) {
          patch.appointedOn = request.body.appointedOn;
          changed.appointedOn = { from: target.appointedOn, to: request.body.appointedOn };
        }
        if (
          request.body.resignedOn !== undefined &&
          request.body.resignedOn !== target.resignedOn
        ) {
          patch.resignedOn = request.body.resignedOn;
          changed.resignedOn = { from: target.resignedOn, to: request.body.resignedOn };
        }
        if (request.body.userId !== undefined && request.body.userId !== target.userId) {
          const next = await liveUser(tx, request.body.userId);
          patch.userId = next?.id ?? null;
          changed.user = { from: target.userId, to: next?.id ?? null };
        }
        assertOfficerDates(
          patch.appointedOn === undefined ? target.appointedOn : patch.appointedOn,
          patch.resignedOn === undefined ? target.resignedOn : patch.resignedOn,
        );
        if (Object.keys(patch).length > 0) {
          await tx
            .update(entityOfficers)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(entityOfficers.id, target.id));
          await recordActivity(tx, {
            entityType: "entity",
            entityId: entity.id,
            actorId: request.user.id,
            action: "entity_officer.updated",
            visibility: "legal_only",
            payload: {
              legalName: entity.legalName,
              officerName: patch.name ?? target.name,
              changed,
            },
          });
        }
        return target.id;
      });
      return { officer: toOfficer(await selectOfficer(app.db, id)) };
    },
  );

  app.delete(
    "/entities/:id/officers/:childId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "deleteEntityOfficer",
        tags: ["entities"],
        params: ChildParams,
        response: { 204: z.void(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        const entity = await lockedEntity(tx, request.user, request.params.id);
        const [target] = await tx
          .select({ officer: entityOfficers, roleName: officerRoles.displayName })
          .from(entityOfficers)
          .innerJoin(officerRoles, eq(entityOfficers.officerRoleId, officerRoles.id))
          .where(
            and(
              eq(entityOfficers.id, request.params.childId),
              eq(entityOfficers.entityId, entity.id),
            ),
          )
          .limit(1)
          .for("update", { of: entityOfficers });
        if (!target) throw httpError(404, "No officer exists with this id under this entity.");
        await tx.delete(entityOfficers).where(eq(entityOfficers.id, target.officer.id));
        await recordActivity(tx, {
          entityType: "entity",
          entityId: entity.id,
          actorId: request.user.id,
          action: "entity_officer.deleted",
          visibility: "legal_only",
          payload: {
            legalName: entity.legalName,
            officerName: target.officer.name,
            role: target.roleName,
          },
        });
      });
      return reply.status(204).send();
    },
  );

  app.get(
    "/entities/:id/registrations",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listEntityRegistrations",
        tags: ["entities"],
        params: IdParams,
        response: {
          200: z.object({ registrations: z.array(RegistrationSchema) }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const entity = await reachedEntity(app.db, request.user, request.params.id);
      if (!entity) throw httpError(404, NO_ENTITY);
      const rows = await app.db
        .select()
        .from(entityRegistrations)
        .where(eq(entityRegistrations.entityId, entity.id))
        .orderBy(
          asc(sql`lower(${entityRegistrations.jurisdiction})`),
          asc(entityRegistrations.createdAt),
        );
      return { registrations: rows.map(toRegistration) };
    },
  );

  app.post(
    "/entities/:id/registrations",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createEntityRegistration",
        tags: ["entities"],
        params: IdParams,
        body: z.strictObject({
          jurisdiction: NameSchema,
          registrationNumber: OptionalTextSchema.optional(),
          registeredAgent: OptionalTextSchema.optional(),
          status: z.enum(ENTITY_REGISTRATION_STATUSES).optional(),
        }),
        response: { 201: z.object({ registration: RegistrationSchema }), default: problemResponse },
      },
    },
    async (request, reply) => {
      const row = await app.db.transaction(async (tx) => {
        const entity = await lockedEntity(tx, request.user, request.params.id);
        const [created] = await tx
          .insert(entityRegistrations)
          .values({
            entityId: entity.id,
            jurisdiction: request.body.jurisdiction.trim(),
            registrationNumber: request.body.registrationNumber?.trim() || null,
            registeredAgent: request.body.registeredAgent?.trim() || null,
            status: request.body.status ?? "active",
          })
          .returning();
        await recordActivity(tx, {
          entityType: "entity",
          entityId: entity.id,
          actorId: request.user.id,
          action: "entity_registration.created",
          visibility: "legal_only",
          payload: {
            legalName: entity.legalName,
            jurisdiction: created!.jurisdiction,
            registrationNumber: created!.registrationNumber,
            registeredAgent: created!.registeredAgent,
            status: created!.status,
          },
        });
        return created!;
      });
      return reply.status(201).send({ registration: toRegistration(row) });
    },
  );

  app.patch(
    "/entities/:id/registrations/:childId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateEntityRegistration",
        tags: ["entities"],
        params: ChildParams,
        body: z.strictObject({
          jurisdiction: NameSchema.optional(),
          registrationNumber: OptionalTextSchema.optional(),
          registeredAgent: OptionalTextSchema.optional(),
          status: z.enum(ENTITY_REGISTRATION_STATUSES).optional(),
        }),
        response: { 200: z.object({ registration: RegistrationSchema }), default: problemResponse },
      },
    },
    async (request) => {
      const row = await app.db.transaction(async (tx) => {
        const entity = await lockedEntity(tx, request.user, request.params.id);
        const [target] = await tx
          .select()
          .from(entityRegistrations)
          .where(
            and(
              eq(entityRegistrations.id, request.params.childId),
              eq(entityRegistrations.entityId, entity.id),
            ),
          )
          .limit(1)
          .for("update");
        if (!target) throw httpError(404, "No registration exists with this id under this entity.");
        const patch: Partial<EntityRegistration> = {};
        const changed: Record<string, { from: unknown; to: unknown }> = {};
        for (const key of ["registrationNumber", "registeredAgent"] as const) {
          if (request.body[key] === undefined) continue;
          const next = request.body[key]?.trim() || null;
          if (next !== target[key]) {
            patch[key] = next;
            changed[key] = { from: target[key], to: next };
          }
        }
        if (
          request.body.jurisdiction !== undefined &&
          request.body.jurisdiction.trim() !== target.jurisdiction
        ) {
          patch.jurisdiction = request.body.jurisdiction.trim();
          changed.jurisdiction = { from: target.jurisdiction, to: patch.jurisdiction };
        }
        if (request.body.status !== undefined && request.body.status !== target.status) {
          patch.status = request.body.status;
          changed.status = { from: target.status, to: patch.status };
        }
        if (Object.keys(patch).length === 0) return target;
        const [updated] = await tx
          .update(entityRegistrations)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(entityRegistrations.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "entity",
          entityId: entity.id,
          actorId: request.user.id,
          action: "entity_registration.updated",
          visibility: "legal_only",
          payload: { legalName: entity.legalName, jurisdiction: updated!.jurisdiction, changed },
        });
        return updated!;
      });
      return { registration: toRegistration(row) };
    },
  );

  app.delete(
    "/entities/:id/registrations/:childId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "deleteEntityRegistration",
        tags: ["entities"],
        params: ChildParams,
        response: { 204: z.void(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        const entity = await lockedEntity(tx, request.user, request.params.id);
        const [target] = await tx
          .select()
          .from(entityRegistrations)
          .where(
            and(
              eq(entityRegistrations.id, request.params.childId),
              eq(entityRegistrations.entityId, entity.id),
            ),
          )
          .limit(1)
          .for("update");
        if (!target) throw httpError(404, "No registration exists with this id under this entity.");
        await tx.delete(entityRegistrations).where(eq(entityRegistrations.id, target.id));
        await recordActivity(tx, {
          entityType: "entity",
          entityId: entity.id,
          actorId: request.user.id,
          action: "entity_registration.deleted",
          visibility: "legal_only",
          payload: {
            legalName: entity.legalName,
            jurisdiction: target.jurisdiction,
            registrationNumber: target.registrationNumber,
          },
        });
      });
      return reply.status(204).send();
    },
  );
};
