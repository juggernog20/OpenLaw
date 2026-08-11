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
  eq,
  fields,
  FIELD_TAGS,
  FIELD_TYPES,
  inArray,
  isNull,
  type Field,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

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
   * number. Nothing holds values or attaches fields this milestone. */
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

/**
 * Nothing holds field values or attaches fields to types yet — the
 * attachment joins land with #84 (contract types) and the later module
 * milestones. Until then every field's live-usage count is zero.
 */
const IN_USE_COUNT = 0;

/**
 * The CTR-016 narrowing guard: a global field narrows back to a module
 * scope only while no *other* module attaches it. The matter, entity,
 * and request attachment joins do not exist yet (M19/M22/M27), so no
 * cross-module attachment can exist — those milestones replace this
 * constant with real counts over their join tables.
 */
const CROSS_MODULE_ATTACHMENT_COUNT = 0;

function toRow(row: Field) {
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
    inUseCount: IN_USE_COUNT,
  };
}

/** `"Renewal term"` → `renewal_term`; anything left empty becomes `field`. */
function slugBaseOf(displayName: string): string {
  const base = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "field";
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
  type Tx = Parameters<Parameters<typeof app.db.transaction>[0]>[0];

  /** Locks and returns one row, or 404s — every :id mutation starts here. */
  async function lockedField(tx: Tx, id: string): Promise<Field> {
    const [row] = await tx.select().from(fields).where(eq(fields.id, id)).limit(1).for("update");
    if (!row) throw httpError(404, "No field exists with this id.");
    return row;
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
      return { fields: rows.map(toRow) };
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
        const taken = new Set(existing.map((candidate) => candidate.slug));
        const base = slugBaseOf(displayName);
        let slug = base;
        for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}_${suffix}`;

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
      return reply.status(201).send({ field: toRow(row) });
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
      return { field: toRow(row) };
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
          "safe (values stay keyed by slug); narrowing back is refused " +
          "while another module attaches the field",
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
        const narrowing = target.moduleScope === "global";
        if (narrowing && CROSS_MODULE_ATTACHMENT_COUNT > 0) {
          throw httpError(
            409,
            `${target.displayName} is attached outside the contract module — ` +
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
          action: narrowing ? "field.narrowed" : "field.promoted",
          visibility: "admin_only",
          payload: { slug: target.slug, from: target.moduleScope, to: moduleScope },
        });
        return updated!;
      });
      return { field: toRow(row) };
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
            inUseCount: IN_USE_COUNT,
          },
        });
        return updated!;
      });
      return { field: toRow(row) };
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
      return { field: toRow(row) };
    },
  );
};
