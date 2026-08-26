// SPDX-License-Identifier: AGPL-3.0-only

/** Admin-managed named Matter creation templates (MTR-013). */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  eq,
  isNull,
  matterTemplates,
  matterTypes,
  type Executor,
  type MatterTemplate,
  type Transaction,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
const NameSchema = z.string().trim().min(1).max(100);
const DescriptionSchema = z.string().trim().max(500);
const TitlePrefixSchema = z.string().trim().max(100);

const MatterTemplateSchema = z.object({
  id: z.string(),
  matterTypeId: z.string(),
  matterTypeName: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  defaultPriority: SeveritySchema.nullable(),
  defaultRisk: SeveritySchema.nullable(),
  titlePrefix: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  taskCount: z.number().int(),
  keyDateCount: z.number().int(),
  customFieldCount: z.number().int(),
});

const MatterTemplateEnvelope = z.object({ matterTemplate: MatterTemplateSchema });
const MatterTemplateListEnvelope = z.object({
  matterTemplates: z.array(MatterTemplateSchema),
});

function rowJson(row: MatterTemplate, matterTypeName: string) {
  return {
    id: row.id,
    matterTypeId: row.matterTypeId,
    matterTypeName,
    name: row.name,
    description: row.description,
    defaultPriority: row.defaultPriority,
    defaultRisk: row.defaultRisk,
    titlePrefix: row.titlePrefix,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    taskCount: 0,
    keyDateCount: 0,
    customFieldCount: Object.keys(row.defaultCustomFields ?? {}).length,
  };
}

export const matterTemplatesRoutes: FastifyPluginAsyncZod = async (app) => {
  async function lockedTemplate(tx: Transaction, id: string): Promise<MatterTemplate> {
    const [row] = await tx
      .select()
      .from(matterTemplates)
      .where(eq(matterTemplates.id, id))
      .limit(1)
      .for("update");
    if (!row) throw httpError(404, "No Matter template exists with this id.");
    return row;
  }

  async function typeName(db: Executor, id: string): Promise<string> {
    const [row] = await db
      .select({ displayName: matterTypes.displayName })
      .from(matterTypes)
      .where(eq(matterTypes.id, id))
      .limit(1);
    if (!row) throw httpError(404, "No Matter type exists with this id.");
    return row.displayName;
  }

  app.get(
    "/matter-templates",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listMatterTemplates",
        summary:
          "List named Matter creation templates in type and name order; " +
          "optionally filter to one Matter type and include archived rows",
        tags: ["matter-templates"],
        querystring: z.object({
          matterTypeId: z.string().optional(),
          includeArchived: z.enum(["true", "false"]).optional(),
        }),
        response: { 200: MatterTemplateListEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const filters = [
        request.query.matterTypeId
          ? eq(matterTemplates.matterTypeId, request.query.matterTypeId)
          : undefined,
        request.query.includeArchived === "true" ? undefined : isNull(matterTemplates.archivedAt),
      ].filter((filter) => filter !== undefined);
      const rows = await app.db
        .select({ template: matterTemplates, matterTypeName: matterTypes.displayName })
        .from(matterTemplates)
        .innerJoin(matterTypes, eq(matterTypes.id, matterTemplates.matterTypeId))
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(
          asc(matterTypes.displayOrder),
          asc(matterTemplates.name),
          asc(matterTemplates.createdAt),
        );
      return {
        matterTemplates: rows.map(({ template, matterTypeName }) =>
          rowJson(template, matterTypeName),
        ),
      };
    },
  );

  app.post(
    "/matter-templates",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "createMatterTemplate",
        summary: "Create a named Matter template for one live Matter type",
        tags: ["matter-templates"],
        body: z.object({
          matterTypeId: z.string(),
          name: NameSchema,
          description: DescriptionSchema.optional(),
          defaultPriority: SeveritySchema.nullable().optional(),
          defaultRisk: SeveritySchema.nullable().optional(),
          titlePrefix: TitlePrefixSchema.optional(),
        }),
        response: { 201: MatterTemplateEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const result = await app.db.transaction(async (tx) => {
        const [matterType] = await tx
          .select()
          .from(matterTypes)
          .where(eq(matterTypes.id, body.matterTypeId))
          .limit(1)
          .for("update");
        if (!matterType) throw httpError(404, "No Matter type exists with this id.");
        if (matterType.archivedAt) {
          throw httpError(409, "An archived Matter type cannot receive a new template.");
        }
        const [created] = await tx
          .insert(matterTemplates)
          .values({
            matterTypeId: matterType.id,
            name: body.name.trim(),
            description: body.description?.trim() || null,
            defaultPriority: body.defaultPriority ?? null,
            defaultRisk: body.defaultRisk ?? null,
            titlePrefix: body.titlePrefix?.trim() || null,
          })
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "matter_template.created",
          visibility: "admin_only",
          payload: { displayName: created!.name, matterTypeName: matterType.displayName },
        });
        return { row: created!, matterTypeName: matterType.displayName };
      });
      return reply.status(201).send({ matterTemplate: rowJson(result.row, result.matterTypeName) });
    },
  );

  app.patch(
    "/matter-templates/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "updateMatterTemplate",
        summary: "Update a Matter template's name, description, priority, risk, or title prefix",
        tags: ["matter-templates"],
        params: z.object({ id: z.string() }),
        body: z
          .strictObject({
            name: NameSchema.optional(),
            description: DescriptionSchema.nullable().optional(),
            defaultPriority: SeveritySchema.nullable().optional(),
            defaultRisk: SeveritySchema.nullable().optional(),
            titlePrefix: TitlePrefixSchema.nullable().optional(),
          })
          .refine((body) => Object.keys(body).length > 0, "Send at least one template field."),
        response: { 200: MatterTemplateEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const result = await app.db.transaction(async (tx) => {
        const target = await lockedTemplate(tx, request.params.id);
        const values = {
          ...(request.body.name !== undefined ? { name: request.body.name.trim() } : {}),
          ...(request.body.description !== undefined
            ? { description: request.body.description?.trim() || null }
            : {}),
          ...(request.body.defaultPriority !== undefined
            ? { defaultPriority: request.body.defaultPriority }
            : {}),
          ...(request.body.defaultRisk !== undefined
            ? { defaultRisk: request.body.defaultRisk }
            : {}),
          ...(request.body.titlePrefix !== undefined
            ? { titlePrefix: request.body.titlePrefix?.trim() || null }
            : {}),
        };
        const changed = Object.fromEntries(
          Object.entries(values)
            .filter(([key, value]) => value !== target[key as keyof MatterTemplate])
            .map(([key, value]) => [
              key,
              { from: target[key as keyof MatterTemplate] ?? null, to: value ?? null },
            ]),
        );
        if (Object.keys(changed).length === 0) {
          return { row: target, matterTypeName: await typeName(tx, target.matterTypeId) };
        }
        const [updated] = await tx
          .update(matterTemplates)
          .set(values)
          .where(eq(matterTemplates.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "matter_template.updated",
          visibility: "admin_only",
          payload: { displayName: updated!.name, changed },
        });
        return { row: updated!, matterTypeName: await typeName(tx, target.matterTypeId) };
      });
      return { matterTemplate: rowJson(result.row, result.matterTypeName) };
    },
  );

  app.post(
    "/matter-templates/:id/archive",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "archiveMatterTemplate",
        summary: "Archive a Matter template so it leaves the live settings and creation sets",
        tags: ["matter-templates"],
        params: z.object({ id: z.string() }),
        response: { 200: MatterTemplateEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const result = await app.db.transaction(async (tx) => {
        const target = await lockedTemplate(tx, request.params.id);
        if (target.archivedAt) throw httpError(409, "This Matter template is already archived.");
        const [updated] = await tx
          .update(matterTemplates)
          .set({ archivedAt: new Date() })
          .where(eq(matterTemplates.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "matter_template.archived",
          visibility: "admin_only",
          payload: { displayName: target.name },
        });
        return { row: updated!, matterTypeName: await typeName(tx, target.matterTypeId) };
      });
      return { matterTemplate: rowJson(result.row, result.matterTypeName) };
    },
  );

  app.post(
    "/matter-templates/:id/restore",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "restoreMatterTemplate",
        summary: "Restore an archived Matter template with its definition intact",
        tags: ["matter-templates"],
        params: z.object({ id: z.string() }),
        response: { 200: MatterTemplateEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const result = await app.db.transaction(async (tx) => {
        const target = await lockedTemplate(tx, request.params.id);
        if (!target.archivedAt) throw httpError(409, "This Matter template is not archived.");
        const [updated] = await tx
          .update(matterTemplates)
          .set({ archivedAt: null })
          .where(eq(matterTemplates.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "matter_template.restored",
          visibility: "admin_only",
          payload: { displayName: target.name },
        });
        return { row: updated!, matterTypeName: await typeName(tx, target.matterTypeId) };
      });
      return { matterTemplate: rowJson(result.row, result.matterTypeName) };
    },
  );
};
