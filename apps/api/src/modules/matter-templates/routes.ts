// SPDX-License-Identifier: AGPL-3.0-only

/** Admin-managed named Matter creation templates (MTR-013). */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  eq,
  fields,
  inArray,
  isNull,
  MATTER_TEMPLATE_ASSIGNEE_ROLES,
  matterTypeFields,
  matterTemplateKeyDates,
  matterTemplateTasks,
  matterTemplates,
  matterTypes,
  type Executor,
  type MatterTemplate,
  type MatterTemplateKeyDate,
  type MatterTemplateTask,
  type Transaction,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import {
  applyCustomFields,
  CustomFieldsInput,
  CustomFieldsSchema,
  selectAttachedFields,
} from "../../lib/custom-fields.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
const NameSchema = z.string().trim().min(1).max(100);
const DescriptionSchema = z.string().trim().max(500);
const TitlePrefixSchema = z.string().trim().max(100);
const AssigneeRoleSchema = z.enum(MATTER_TEMPLATE_ASSIGNEE_ROLES);
const OffsetSchema = z.number().int().min(0).max(3650);
const TemplateTaskInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  dueOffsetDays: OffsetSchema.nullable(),
  assigneeRole: AssigneeRoleSchema,
});
const TemplateKeyDateInputSchema = z.strictObject({
  label: z.string().trim().min(1).max(200),
  offsetDays: OffsetSchema,
  note: z.string().trim().max(2000).nullable(),
});

const NAME_TAKEN = "A template of this Matter type is already called that.";
const RESTORE_NAME_TAKEN =
  "A live template of this Matter type is already called that. Rename that one first, then restore this one.";

/**
 * Postgres's unique-violation code. `matter_templates_name_idx` is the
 * authority on a duplicate name rather than a read-then-write check, the
 * same way the approver-groups routes handle theirs: two creates racing
 * would both find the name free and both insert it.
 */
const UNIQUE_VIOLATION = "23505";
const NAME_INDEX = "matter_templates_name_idx";

/** A duplicate name arrives as a unique violation and reads as a 409, not a 500. */
function asNameConflict(error: unknown, detail: string): never {
  const cause = (error as { cause?: { code?: string; constraint?: string } } | null)?.cause;
  if (cause?.code === UNIQUE_VIOLATION && cause.constraint === NAME_INDEX) {
    throw httpError(409, detail);
  }
  throw error;
}

const MatterTemplateTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  dueOffsetDays: z.number().int().nullable(),
  assigneeRole: AssigneeRoleSchema,
  displayOrder: z.number().int(),
});

const MatterTemplateKeyDateSchema = z.object({
  id: z.string(),
  label: z.string(),
  offsetDays: z.number().int(),
  note: z.string().nullable(),
  displayOrder: z.number().int(),
});

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
  tasks: z.array(MatterTemplateTaskSchema),
  keyDates: z.array(MatterTemplateKeyDateSchema),
  taskCount: z.number().int(),
  keyDateCount: z.number().int(),
  customFieldCount: z.number().int(),
  defaultCustomFields: CustomFieldsSchema,
  staleCustomFieldSlugs: z.array(z.string()),
});

const MatterTemplateEnvelope = z.object({ matterTemplate: MatterTemplateSchema });
const MatterTemplateListEnvelope = z.object({
  matterTemplates: z.array(MatterTemplateSchema),
});

function taskJson(row: MatterTemplateTask) {
  return {
    id: row.id,
    title: row.title,
    dueOffsetDays: row.dueOffsetDays,
    assigneeRole: row.assigneeRole,
    displayOrder: row.displayOrder,
  };
}

function keyDateJson(row: MatterTemplateKeyDate) {
  return {
    id: row.id,
    label: row.label,
    offsetDays: row.offsetDays,
    note: row.note,
    displayOrder: row.displayOrder,
  };
}

function rowJson(
  row: MatterTemplate,
  matterTypeName: string,
  tasks: MatterTemplateTask[],
  keyDates: MatterTemplateKeyDate[],
  attachedSlugs: ReadonlySet<string>,
) {
  const defaultCustomFields = row.defaultCustomFields ?? {};
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
    tasks: tasks.map(taskJson),
    keyDates: keyDates.map(keyDateJson),
    taskCount: tasks.length,
    keyDateCount: keyDates.length,
    customFieldCount: Object.keys(defaultCustomFields).length,
    defaultCustomFields,
    staleCustomFieldSlugs: Object.keys(defaultCustomFields)
      .filter((slug) => !attachedSlugs.has(slug))
      .sort(),
  };
}

export const matterTemplatesRoutes: FastifyPluginAsyncZod = async (app) => {
  async function contentOf(db: Executor, templates: MatterTemplate[]) {
    const tasksByTemplate = new Map<string, MatterTemplateTask[]>();
    const keyDatesByTemplate = new Map<string, MatterTemplateKeyDate[]>();
    const attachedSlugsByType = new Map<string, Set<string>>();
    if (templates.length === 0) {
      return { tasksByTemplate, keyDatesByTemplate, attachedSlugsByType };
    }
    const ids = templates.map((template) => template.id);
    const typeIds = [...new Set(templates.map((template) => template.matterTypeId))];
    const [tasks, keyDates, attachments] = await Promise.all([
      db
        .select()
        .from(matterTemplateTasks)
        .where(inArray(matterTemplateTasks.matterTemplateId, ids))
        .orderBy(
          asc(matterTemplateTasks.matterTemplateId),
          asc(matterTemplateTasks.displayOrder),
          asc(matterTemplateTasks.id),
        ),
      db
        .select()
        .from(matterTemplateKeyDates)
        .where(inArray(matterTemplateKeyDates.matterTemplateId, ids))
        .orderBy(
          asc(matterTemplateKeyDates.matterTemplateId),
          asc(matterTemplateKeyDates.displayOrder),
          asc(matterTemplateKeyDates.id),
        ),
      db
        .select({ typeId: matterTypeFields.typeId, slug: fields.slug })
        .from(matterTypeFields)
        .innerJoin(fields, eq(fields.id, matterTypeFields.fieldId))
        .where(and(inArray(matterTypeFields.typeId, typeIds), isNull(fields.archivedAt))),
    ]);
    for (const task of tasks) {
      const rows = tasksByTemplate.get(task.matterTemplateId) ?? [];
      rows.push(task);
      tasksByTemplate.set(task.matterTemplateId, rows);
    }
    for (const keyDate of keyDates) {
      const rows = keyDatesByTemplate.get(keyDate.matterTemplateId) ?? [];
      rows.push(keyDate);
      keyDatesByTemplate.set(keyDate.matterTemplateId, rows);
    }
    for (const attachment of attachments) {
      const slugs = attachedSlugsByType.get(attachment.typeId) ?? new Set<string>();
      slugs.add(attachment.slug);
      attachedSlugsByType.set(attachment.typeId, slugs);
    }
    return { tasksByTemplate, keyDatesByTemplate, attachedSlugsByType };
  }

  async function rowWithContent(row: MatterTemplate, matterTypeName: string) {
    const content = await contentOf(app.db, [row]);
    return rowJson(
      row,
      matterTypeName,
      content.tasksByTemplate.get(row.id) ?? [],
      content.keyDatesByTemplate.get(row.id) ?? [],
      content.attachedSlugsByType.get(row.matterTypeId) ?? new Set(),
    );
  }

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
      const content = await contentOf(
        app.db,
        rows.map(({ template }) => template),
      );
      return {
        matterTemplates: rows.map(({ template, matterTypeName }) =>
          rowJson(
            template,
            matterTypeName,
            content.tasksByTemplate.get(template.id) ?? [],
            content.keyDatesByTemplate.get(template.id) ?? [],
            content.attachedSlugsByType.get(template.matterTypeId) ?? new Set(),
          ),
        ),
      };
    },
  );

  app.get(
    "/matter-templates/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getMatterTemplate",
        summary: "Read one Matter template and its ordered content by id",
        tags: ["matter-templates"],
        params: z.object({ id: z.string() }),
        response: { 200: MatterTemplateEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const [result] = await app.db
        .select({ template: matterTemplates, matterTypeName: matterTypes.displayName })
        .from(matterTemplates)
        .innerJoin(matterTypes, eq(matterTypes.id, matterTemplates.matterTypeId))
        .where(eq(matterTemplates.id, request.params.id))
        .limit(1);
      if (!result) throw httpError(404, "No Matter template exists with this id.");
      return {
        matterTemplate: await rowWithContent(result.template, result.matterTypeName),
      };
    },
  );

  app.post(
    "/matter-templates",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "createMatterTemplate",
        summary:
          "Create a named Matter template for one live Matter type; 409 if a live " +
          "template of that type already carries the name, compared case-insensitively",
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
      const result = await app.db
        .transaction(async (tx) => {
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
        })
        .catch((error: unknown) => asNameConflict(error, NAME_TAKEN));
      return reply
        .status(201)
        .send({ matterTemplate: await rowWithContent(result.row, result.matterTypeName) });
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
      const result = await app.db
        .transaction(async (tx) => {
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
        })
        .catch((error: unknown) => asNameConflict(error, NAME_TAKEN));
      return { matterTemplate: await rowWithContent(result.row, result.matterTypeName) };
    },
  );

  app.put(
    "/matter-templates/:id/custom-fields",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "setMatterTemplateCustomFields",
        summary:
          "Replace the defaults for fields currently attached to the template's Matter type; " +
          "detached defaults remain stored and are reported as stale",
        tags: ["matter-templates"],
        params: z.object({ id: z.string() }),
        body: z.strictObject({ defaultCustomFields: CustomFieldsInput }),
        response: { 200: MatterTemplateEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const result = await app.db.transaction(async (tx) => {
        const target = await lockedTemplate(tx, request.params.id);
        const attached = await selectAttachedFields(tx, matterTypeFields, target.matterTypeId);
        const submitted = request.body.defaultCustomFields;
        const replacement = Object.fromEntries(
          attached.map((field) => [
            field.slug,
            Object.hasOwn(submitted, field.slug) ? submitted[field.slug]! : null,
          ]),
        );
        // Pass submitted keys through too. `applyCustomFields` is the Matter-create
        // coercion path and therefore owns both type refusals and unattached-slug refusals.
        const incoming = { ...replacement, ...submitted };
        const before = target.defaultCustomFields ?? {};
        const applied = await applyCustomFields(tx, attached, before, incoming);
        if (Object.keys(applied.changed).length === 0) {
          return { row: target, matterTypeName: await typeName(tx, target.matterTypeId) };
        }
        const [updated] = await tx
          .update(matterTemplates)
          .set({ defaultCustomFields: applied.values })
          .where(eq(matterTemplates.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "matter_template.updated",
          visibility: "admin_only",
          payload: {
            displayName: target.name,
            changed: { defaultCustomFields: { from: before, to: applied.values } },
          },
        });
        return { row: updated!, matterTypeName: await typeName(tx, target.matterTypeId) };
      });
      return { matterTemplate: await rowWithContent(result.row, result.matterTypeName) };
    },
  );

  app.put(
    "/matter-templates/:id/tasks",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "setMatterTemplateTasks",
        summary:
          "Replace a Matter template's ordered task list; offsets are whole days from " +
          "Matter creation and assignment targets are roles, never named users",
        tags: ["matter-templates"],
        params: z.object({ id: z.string() }),
        body: z.strictObject({ tasks: z.array(TemplateTaskInputSchema).max(100) }),
        response: { 200: MatterTemplateEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const wanted = request.body.tasks.map((task, index) => ({
        title: task.title.trim(),
        dueOffsetDays: task.dueOffsetDays,
        assigneeRole: task.assigneeRole,
        displayOrder: index + 1,
      }));
      const result = await app.db.transaction(async (tx) => {
        const target = await lockedTemplate(tx, request.params.id);
        const current = await tx
          .select()
          .from(matterTemplateTasks)
          .where(eq(matterTemplateTasks.matterTemplateId, target.id))
          .orderBy(asc(matterTemplateTasks.displayOrder), asc(matterTemplateTasks.id))
          .for("update");
        const before = current.map(({ title, dueOffsetDays, assigneeRole, displayOrder }) => ({
          title,
          dueOffsetDays,
          assigneeRole,
          displayOrder,
        }));
        if (JSON.stringify(before) === JSON.stringify(wanted)) {
          return { row: target, matterTypeName: await typeName(tx, target.matterTypeId) };
        }
        await tx
          .delete(matterTemplateTasks)
          .where(eq(matterTemplateTasks.matterTemplateId, target.id));
        if (wanted.length > 0) {
          await tx.insert(matterTemplateTasks).values(
            wanted.map((task) => ({
              matterTemplateId: target.id,
              ...task,
            })),
          );
        }
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "matter_template.updated",
          visibility: "admin_only",
          payload: { displayName: target.name, changed: { tasks: { from: before, to: wanted } } },
        });
        return { row: target, matterTypeName: await typeName(tx, target.matterTypeId) };
      });
      return { matterTemplate: await rowWithContent(result.row, result.matterTypeName) };
    },
  );

  app.put(
    "/matter-templates/:id/key-dates",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "setMatterTemplateKeyDates",
        summary:
          "Replace a Matter template's ordered relative Key dates; each offset is a " +
          "whole day from Matter creation",
        tags: ["matter-templates"],
        params: z.object({ id: z.string() }),
        body: z.strictObject({ keyDates: z.array(TemplateKeyDateInputSchema).max(100) }),
        response: { 200: MatterTemplateEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const wanted = request.body.keyDates.map((keyDate, index) => ({
        label: keyDate.label.trim(),
        offsetDays: keyDate.offsetDays,
        note: keyDate.note?.trim() || null,
        displayOrder: index + 1,
      }));
      const result = await app.db.transaction(async (tx) => {
        const target = await lockedTemplate(tx, request.params.id);
        const current = await tx
          .select()
          .from(matterTemplateKeyDates)
          .where(eq(matterTemplateKeyDates.matterTemplateId, target.id))
          .orderBy(asc(matterTemplateKeyDates.displayOrder), asc(matterTemplateKeyDates.id))
          .for("update");
        const before = current.map(({ label, offsetDays, note, displayOrder }) => ({
          label,
          offsetDays,
          note,
          displayOrder,
        }));
        if (JSON.stringify(before) === JSON.stringify(wanted)) {
          return { row: target, matterTypeName: await typeName(tx, target.matterTypeId) };
        }
        await tx
          .delete(matterTemplateKeyDates)
          .where(eq(matterTemplateKeyDates.matterTemplateId, target.id));
        if (wanted.length > 0) {
          await tx.insert(matterTemplateKeyDates).values(
            wanted.map((keyDate) => ({
              matterTemplateId: target.id,
              ...keyDate,
            })),
          );
        }
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "matter_template.updated",
          visibility: "admin_only",
          payload: {
            displayName: target.name,
            changed: { keyDates: { from: before, to: wanted } },
          },
        });
        return { row: target, matterTypeName: await typeName(tx, target.matterTypeId) };
      });
      return { matterTemplate: await rowWithContent(result.row, result.matterTypeName) };
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
      return { matterTemplate: await rowWithContent(result.row, result.matterTypeName) };
    },
  );

  app.post(
    "/matter-templates/:id/restore",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "restoreMatterTemplate",
        summary:
          "Restore an archived Matter template with its definition intact; 409 when a " +
          "live template of the type has taken its name since",
        tags: ["matter-templates"],
        params: z.object({ id: z.string() }),
        response: { 200: MatterTemplateEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const result = await app.db
        .transaction(async (tx) => {
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
        })
        .catch((error: unknown) => asNameConflict(error, RESTORE_NAME_TAKEN));
      return { matterTemplate: await rowWithContent(result.row, result.matterTypeName) };
    },
  );
};
