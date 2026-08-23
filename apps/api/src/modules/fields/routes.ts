// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Fields catalog routes (CTR-016, #83): the shared custom-field
 * catalog behind the third list-editor pane — list scoped to contract
 * and global fields, create across the nine field types, rename and
 * describe, the options list on select types, the contract-scope-only
 * AI prompt (CTR-008), scope moves (promotion to global; narrowing back
 * only while no other module attaches the field), archive and restore.
 * `slug` and `field_type` are immutable after creation: the update route
 * takes a strict body, so a request carrying either is refused rather
 * than silently stripped. There is no hard delete — stored values are
 * keyed by slug and retained by rule (MTR-014), so archive is the only
 * removal. Everything sits behind SET-002's single role gate —
 * Administrators only — and every mutation appends to the activity log
 * (DD-017) inside the same transaction.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  contracts,
  contractTypeFields,
  count,
  eq,
  fields,
  FIELD_TAGS,
  FIELD_TYPES,
  inArray,
  isNull,
  matterTypeFields,
  sql,
  type Executor,
  type Field,
  type Transaction,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { freeSlug } from "../../lib/slug.js";

/**
 * The scopes this pane's catalog holds and its picker offers (CTR-016):
 * `matter` and `entity` join with their milestones (M22, M27), which
 * bring the per-module views along.
 */
const OPEN_SCOPES = ["contract", "global"] as const;

const ScopeSchema = z.enum(OPEN_SCOPES);
const FieldTypeSchema = z.enum(FIELD_TYPES);
const FieldTagSchema = z.enum(FIELD_TAGS);

const FieldSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  moduleScope: ScopeSchema,
  fieldType: FieldTypeSchema,
  options: z.array(z.string()).nullable(),
  fieldTag: FieldTagSchema,
  aiPrompt: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  /** Records holding a value plus type attachments — the SET-003 guard
   * number. Contract-type attachments count since #84 and matter-type
   * attachments since #85; contracts holding a value count since #112,
   * and matters join with M22. */
  inUseCount: z.number().int(),
});

const FieldEnvelope = z.object({ field: FieldSchema });
const FieldListEnvelope = z.object({ fields: z.array(FieldSchema) });

const DisplayNameSchema = z.string().trim().min(1).max(100);
const DescriptionSchema = z.string().trim().max(500);
const AiPromptSchema = z.string().trim().max(2000);
/** Option labels: non-empty, deduplicated, in display order. */
const OptionsSchema = z.array(z.string().trim().min(1).max(100)).min(1).max(100);

/** The select types — the only ones that carry an options list. */
const SELECT_TYPES = new Set<string>(["single_select", "multi_select"]);

function toRow(row: Field, inUseCount: number) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    description: row.description,
    moduleScope: row.moduleScope as (typeof OPEN_SCOPES)[number],
    fieldType: row.fieldType,
    options: row.options ?? null,
    fieldTag: row.fieldTag,
    aiPrompt: row.aiPrompt,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    inUseCount,
  };
}

/** Options must be present on select types, absent elsewhere, unique. */
function checkOptions(fieldType: string, options: string[] | undefined): string[] | null {
  if (!SELECT_TYPES.has(fieldType)) {
    if (options !== undefined) {
      throw httpError(400, "Only single-select and multi-select fields carry an options list.");
    }
    return null;
  }
  if (options === undefined) {
    throw httpError(400, "Select fields need an options list with at least one option.");
  }
  if (new Set(options).size !== options.length) {
    throw httpError(400, "Options must be unique.");
  }
  return options;
}

export const fieldsRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Locks and returns one row, or 404s — every :id mutation starts here. */
  async function lockedField(tx: Transaction, id: string): Promise<Field> {
    const [row] = await tx.select().from(fields).where(eq(fields.id, id)).limit(1).for("update");
    if (!row) throw httpError(404, "No field exists with this id.");
    return row;
  }

  /** The per-module attachment joins, each owned by its scope: the
   * contract join counts since #84, the matter join since #85; the
   * entity join adds itself here with M27. */
  const MODULE_JOINS = [
    { moduleScope: "contract", joinTable: contractTypeFields },
    { moduleScope: "matter", joinTable: matterTypeFields },
  ] as const;

  /**
   * The SET-003 guard number per field: type attachments across every
   * module join, plus every record that holds a value for the field.
   *
   * Contracts hold values from #112, and they are counted by slug — a
   * record's `custom_fields` is keyed by the field's machine identity,
   * not its id. Archived contracts count: their values are retained
   * exactly like a detached field's, so a restore must not make a
   * number the Administrator already saw go up. Matters join with M22.
   */
  async function attachmentCounts(
    db: Executor,
    catalog: readonly { id: string; slug: string }[],
  ): Promise<Map<string, number>> {
    const tally = new Map<string, number>();
    if (catalog.length === 0) return tally;
    const fieldIds = catalog.map((row) => row.id);
    for (const { joinTable } of MODULE_JOINS) {
      const rows = await db
        .select({ fieldId: joinTable.fieldId, tally: count() })
        .from(joinTable)
        .where(inArray(joinTable.fieldId, fieldIds))
        .groupBy(joinTable.fieldId);
      for (const row of rows) tally.set(row.fieldId, (tally.get(row.fieldId) ?? 0) + row.tally);
    }
    // One query for the whole catalog, not one per field: a record's
    // held slugs are unnested, then counted per slug. `sql.param` binds
    // the slug list as a single text[] — a bare array in the template
    // expands to `($1, $2, …)`, which is a row constructor and not what
    // `ANY` takes.
    const slugToId = new Map(catalog.map((field) => [field.slug, field.id]));
    const slugs = catalog.map((field) => field.slug);
    const held = await db.execute<{ slug: string; tally: string }>(
      sql`
        SELECT slug, COUNT(*) AS tally
        FROM (
          SELECT jsonb_object_keys(${contracts.customFields}) AS slug
          FROM ${contracts}
          WHERE ${contracts.customFields} IS NOT NULL
        ) AS keys
        WHERE slug = ANY(${sql.param(slugs)}::text[])
        GROUP BY slug
      `,
    );
    for (const row of held.rows) {
      const fieldId = slugToId.get(row.slug);
      // COUNT() comes back as a string on a bigint column.
      if (fieldId) tally.set(fieldId, (tally.get(fieldId) ?? 0) + Number(row.tally));
    }
    return tally;
  }

  async function inUseCountOf(db: Executor, field: { id: string; slug: string }): Promise<number> {
    return (await attachmentCounts(db, [field])).get(field.id) ?? 0;
  }

  /**
   * The CTR-016 narrowing guard's number: attachments in modules other
   * than the narrow target's own. Each module's join counts against
   * every other module's narrow, so a global field attached to matter
   * types refuses to narrow to `contract` (and vice versa).
   */
  async function attachmentsOutsideModule(
    db: Executor,
    fieldId: string,
    targetScope: string,
  ): Promise<number> {
    let outside = 0;
    for (const { moduleScope, joinTable } of MODULE_JOINS) {
      if (moduleScope === targetScope) continue;
      const [row] = await db
        .select({ tally: count() })
        .from(joinTable)
        .where(eq(joinTable.fieldId, fieldId));
      outside += row?.tally ?? 0;
    }
    return outside;
  }

  app.get(
    "/fields",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listFields",
        summary:
          "The shared field catalog (CTR-016) scoped to contract and " +
          "global fields, in creation order; archived rows only with " +
          "includeArchived=true",
        tags: ["fields"],
        querystring: z.object({ includeArchived: z.enum(["true", "false"]).optional() }),
        response: { 200: FieldListEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      // The catalog has no display order (fields render in per-type
      // attachment order once #84 lands); the pane lists creation order.
      const scoped = inArray(fields.moduleScope, [...OPEN_SCOPES]);
      const rows = await app.db
        .select()
        .from(fields)
        .where(
          request.query.includeArchived === "true"
            ? scoped
            : and(scoped, isNull(fields.archivedAt)),
        )
        .orderBy(asc(fields.createdAt), asc(fields.id));
      const counts = await attachmentCounts(app.db, rows);
      return { fields: rows.map((row) => toRow(row, counts.get(row.id) ?? 0)) };
    },
  );

  app.post(
    "/fields",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "createField",
        summary:
          "Define a field: the slug derives from the name and the field " +
          "type is picked here, once — both are immutable after creation. " +
          "Select types take their options list; an AI prompt rides on " +
          "contract-scoped fields only (CTR-008)",
        tags: ["fields"],
        body: z.object({
          displayName: DisplayNameSchema,
          description: DescriptionSchema.optional(),
          moduleScope: ScopeSchema,
          fieldType: FieldTypeSchema,
          fieldTag: FieldTagSchema,
          options: OptionsSchema.optional(),
          aiPrompt: AiPromptSchema.optional(),
        }),
        response: { 201: FieldEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { moduleScope, fieldType, fieldTag } = request.body;
      const displayName = request.body.displayName.trim();
      const description = request.body.description?.trim() || null;
      const aiPrompt = request.body.aiPrompt?.trim() || null;
      const options = checkOptions(fieldType, request.body.options);
      if (aiPrompt !== null && moduleScope !== "contract") {
        throw httpError(400, "AI prompts live on contract-scoped fields.");
      }

      const row = await app.db.transaction(async (tx) => {
        // The slug derives from the full row set — archived rows still
        // hold their slugs (restore brings them back), so the scan
        // includes them.
        const existing = await tx.select({ slug: fields.slug }).from(fields).for("update");
        const slug = freeSlug(
          displayName,
          "field",
          new Set(existing.map((candidate) => candidate.slug)),
        );

        const [created] = await tx
          .insert(fields)
          .values({
            slug,
            displayName,
            description,
            moduleScope,
            fieldType,
            options,
            fieldTag,
            aiPrompt,
          })
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "field.created",
          visibility: "admin_only",
          payload: { slug, displayName, moduleScope, fieldType, fieldTag },
        });
        return created!;
      });
      return reply.status(201).send({ field: toRow(row, 0) });
    },
  );

  app.patch(
    "/fields/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "updateField",
        summary:
          "Rename, describe, retag, or edit a field's options and AI " +
          "prompt; the slug and the field type never change, and the " +
          "scope moves through its own route — a body carrying any of " +
          "them is refused, not silently stripped",
        tags: ["fields"],
        params: z.object({ id: z.string() }),
        // Strict: slug/type/scope immutability is an explicit refusal.
        body: z.strictObject({
          displayName: DisplayNameSchema.optional(),
          description: DescriptionSchema.nullable().optional(),
          fieldTag: FieldTagSchema.optional(),
          options: OptionsSchema.optional(),
          aiPrompt: AiPromptSchema.nullable().optional(),
        }),
        response: { 200: FieldEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const body = request.body;
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedField(tx, request.params.id);

        const patch: Partial<Field> = {};
        /** from → to per changed column, for the one audit entry. */
        const changed: Record<string, { from: unknown; to: unknown }> = {};
        const wants = <K extends keyof Field>(key: K, to: Field[K]) => {
          if (JSON.stringify(target[key]) === JSON.stringify(to)) return;
          patch[key] = to;
          changed[key] = { from: target[key], to };
        };

        if (body.displayName !== undefined) wants("displayName", body.displayName.trim());
        if (body.description !== undefined) {
          wants("description", body.description?.trim() || null);
        }
        if (body.fieldTag !== undefined) wants("fieldTag", body.fieldTag);
        if (body.options !== undefined) {
          wants("options", checkOptions(target.fieldType, body.options));
        }
        if (body.aiPrompt !== undefined) {
          const aiPrompt = body.aiPrompt?.trim() || null;
          if (aiPrompt !== null && target.moduleScope !== "contract") {
            throw httpError(400, "AI prompts live on contract-scoped fields.");
          }
          wants("aiPrompt", aiPrompt);
        }

        // Nothing changed: answer with the row and write no audit entry.
        if (Object.keys(patch).length === 0) return target;
        const [updated] = await tx
          .update(fields)
          .set(patch)
          .where(eq(fields.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "field.updated",
          visibility: "admin_only",
          payload: { slug: target.slug, changed },
        });
        return updated!;
      });
      return { field: toRow(row, await inUseCountOf(app.db, row)) };
    },
  );

  app.put(
    "/fields/:id/scope",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "setFieldScope",
        summary:
          "Move a field's scope (CTR-016): promotion to global is always " +
          "safe (values stay keyed by slug); any move into a module is " +
          "refused while another module attaches the field",
        tags: ["fields"],
        params: z.object({ id: z.string() }),
        body: z.object({ moduleScope: ScopeSchema }),
        response: { 200: FieldEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { moduleScope } = request.body;
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedField(tx, request.params.id);
        // Moving to the current scope changes nothing — answer with the
        // row and write no misleading from==to audit entry.
        if (target.moduleScope === moduleScope) return target;
        // Any move into a module is guarded, whatever the current scope:
        // a db-planted matter row moving to `contract` must answer for
        // its matter attachments the same way a global row does. Only
        // promotion to global is unconditionally safe.
        const intoModule = moduleScope !== "global";
        if (intoModule && (await attachmentsOutsideModule(tx, target.id, moduleScope)) > 0) {
          throw httpError(
            409,
            `${target.displayName} is attached outside the ${moduleScope} module — ` +
              "detach it there first, then narrow the scope.",
          );
        }
        const [updated] = await tx
          .update(fields)
          .set({ moduleScope })
          .where(eq(fields.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: intoModule ? "field.narrowed" : "field.promoted",
          visibility: "admin_only",
          payload: { slug: target.slug, from: target.moduleScope, to: moduleScope },
        });
        return updated!;
      });
      return { field: toRow(row, await inUseCountOf(app.db, row)) };
    },
  );

  app.post(
    "/fields/:id/archive",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "archiveField",
        summary:
          "Archive a field (SET-003): it leaves the catalog and every " +
          "form; the definition and all stored values are retained " +
          "(MTR-014) — there is no hard delete",
        tags: ["fields"],
        params: z.object({ id: z.string() }),
        response: { 200: FieldEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedField(tx, request.params.id);
        if (target.archivedAt) throw httpError(409, "This field is already archived.");
        const [updated] = await tx
          .update(fields)
          .set({ archivedAt: new Date() })
          .where(eq(fields.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "field.archived",
          visibility: "admin_only",
          payload: {
            slug: target.slug,
            displayName: target.displayName,
            moduleScope: target.moduleScope,
            inUseCount: await inUseCountOf(tx, target),
          },
        });
        return updated!;
      });
      return { field: toRow(row, await inUseCountOf(app.db, row)) };
    },
  );

  app.post(
    "/fields/:id/restore",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "restoreField",
        summary:
          "Restore an archived field (SET-003's recovery story): it " +
          "rejoins the catalog under its original slug",
        tags: ["fields"],
        params: z.object({ id: z.string() }),
        response: { 200: FieldEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedField(tx, request.params.id);
        if (!target.archivedAt) throw httpError(409, "This field is not archived.");
        const [updated] = await tx
          .update(fields)
          .set({ archivedAt: null })
          .where(eq(fields.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "field.restored",
          visibility: "admin_only",
          payload: { slug: target.slug, displayName: target.displayName },
        });
        return updated!;
      });
      return { field: toRow(row, await inUseCountOf(app.db, row)) };
    },
  );
};
