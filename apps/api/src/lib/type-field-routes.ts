// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The per-type field attachment machinery (#85: one machinery, every
 * type editor): list in per-type order, attach with a per-mount scope
 * rule, the per-attachment required flag, reorder, and detach,
 * instantiated per module — contract types (CTR-016) and matter types
 * (MTR-011) mount the same routes with their own join tables, scope
 * rules, and audit actions. Detaching deletes the join row only: the
 * catalog definition and any stored values survive by rule (MTR-014).
 * The required flag is stored and editable here; the record module
 * enforces it, at creation and at re-type. Contracts do from #112;
 * matters do when their record lands (M22).
 * Everything sits behind SET-002's single role gate — Administrators
 * only — and every mutation appends to the activity log (DD-017)
 * inside the same transaction.
 *
 * **The scope rule is per mount, and it may be per row.** A mount
 * whose rule is one line for every type states it once, as the two
 * type editors do. A mount whose rule depends on the type itself —
 * request types read their target (INT-002) — passes a function, which
 * the attach route resolves against the row it has already locked.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  contractTypeFields,
  eq,
  fields,
  FIELD_MODULE_SCOPES,
  FIELD_TYPES,
  isNotNull,
  isNull,
  matterTypeFields,
  type Executor,
  type Field,
  type FieldModuleScope,
  type Transaction,
} from "@openlaw/db";
import { requireRole } from "../auth/guards.js";
import { recordActivity, type TypeFieldActionPrefix } from "./activity.js";
import { httpError, problemResponse } from "./problem.js";
import type { TaxonomyRow, TaxonomyTable } from "./taxonomy-routes.js";

/** The join tables are one shape by construction (`typeFieldColumns`). */
export type TypeFieldsTable = typeof contractTypeFields | typeof matterTypeFields;
export type TypeFieldRow = TypeFieldsTable["$inferSelect"];

/**
 * What may attach to a type, and what to say when something else
 * tries: the CTR-016 scope rule and its siblings, in one value.
 */
export interface TypeFieldScopeRule {
  /** The field scopes this rule allows — the catalog's own vocabulary,
   * so a mount cannot name a scope no field can carry. */
  scopes: readonly [FieldModuleScope, ...FieldModuleScope[]];
  /** The refusal line when a field's scope is outside them. */
  refusal: string;
}

export interface TypeFieldRoutesConfig {
  typesTable: TaxonomyTable;
  joinTable: TypeFieldsTable;
  /** URL segment of the owning taxonomy, e.g. `contract-types`. */
  path: string;
  /** OpenAPI tag — the owning taxonomy's. */
  tag: string;
  /** operationId infix, e.g. `ContractType` → `attachContractTypeField`. */
  idInfix: string;
  /** Prose vocabulary, e.g. `contract type`. */
  noun: string;
  /**
   * The scope rule for this mount (CTR-016 / MTR-011 / INT-002).
   *
   * One rule serves every type of the mount, unless the rule is the
   * type's own business: a function is resolved against the locked type
   * row on every attach, so a row whose state changes between requests
   * is judged by the rule its current state asks for.
   */
  scopeRule: TypeFieldScopeRule | ((type: TaxonomyRow) => TypeFieldScopeRule);
  /** The attach summary's scope fragment, e.g. `contract-scoped and
   * global fields only (CTR-016)`. It is the mount's static
   * description: a rule that is a function of the row has no one line
   * the OpenAPI document could state, so the mount says what its rule
   * reads instead. */
  scopeSummary: string;
  /** DD-017 action prefix, e.g. `contract_type_field`. */
  actionPrefix: TypeFieldActionPrefix;
  /** The milestone that will hard-enforce `isRequired`, for a module
   * whose record does not exist yet (M22 for matters). Omitted once it
   * does: contracts enforce the flag from #112, at creation and at
   * re-type, so their summary states the rule rather than promising it. */
  requiredMilestone?: string;
}

/**
 * The routes, mounted per module: `typeFieldRoutes(config)` is a
 * Fastify plugin serving `/{path}/:id/fields` — the type editor's
 * Attached fields card.
 */
export function typeFieldRoutes(config: TypeFieldRoutesConfig): FastifyPluginAsyncZod {
  const { typesTable, joinTable, path, noun, scopeRule } = config;

  /**
   * The rule for one type: the mount's constant, or the mount's
   * function read against the row the route has locked. Nothing is
   * memoized — a row re-pointed between two requests is judged by the
   * rule it carries now, not the one it carried then.
   */
  const scopeRuleFor: (type: TaxonomyRow) => TypeFieldScopeRule =
    typeof scopeRule === "function" ? scopeRule : () => scopeRule;
  /**
   * The scopes an attachment of this mount may carry, for the response
   * schema's `moduleScope`. A constant rule is its own answer, so a
   * mount that passes one declares exactly what it always has. A rule
   * read off the row has no single static answer, so the mount declares
   * the whole field-scope vocabulary rather than a narrower one that
   * some row could contradict.
   */
  const declaredScopes = typeof scopeRule === "function" ? FIELD_MODULE_SCOPES : scopeRule.scopes;

  /** One attachment, joined to the catalog columns the editor renders. */
  const AttachedFieldSchema = z.object({
    fieldId: z.string(),
    slug: z.string(),
    displayName: z.string(),
    fieldType: z.enum(FIELD_TYPES),
    moduleScope: z.enum(declaredScopes),
    displayOrder: z.number().int(),
    isRequired: z.boolean(),
  });
  const AttachedFieldEnvelope = z.object({ attachedField: AttachedFieldSchema });
  const AttachedFieldListEnvelope = z.object({ attachedFields: z.array(AttachedFieldSchema) });

  function toRow(join: TypeFieldRow, field: Field) {
    return {
      fieldId: field.id,
      slug: field.slug,
      displayName: field.displayName,
      fieldType: field.fieldType,
      moduleScope: field.moduleScope,
      displayOrder: join.displayOrder,
      isRequired: join.isRequired,
    };
  }

  return async (app) => {
    /** Locks and returns the type, or 404s — every mutation starts here. */
    async function lockedType(tx: Transaction, id: string): Promise<TaxonomyRow> {
      const [row] = await tx
        .select()
        .from(typesTable)
        .where(eq(typesTable.id, id))
        .limit(1)
        .for("update");
      if (!row) throw httpError(404, `No ${noun} exists with this id.`);
      return row;
    }

    /**
     * One type's attachments joined to their live fields, in per-type
     * order. Attachments to archived fields persist (restore brings them
     * back) but never render — archived means hidden everywhere.
     */
    function liveAttachments(dbOrTx: Executor, typeId: string) {
      return dbOrTx
        .select({ join: joinTable, field: fields })
        .from(joinTable)
        .innerJoin(fields, eq(joinTable.fieldId, fields.id))
        .where(and(eq(joinTable.typeId, typeId), isNull(fields.archivedAt)))
        .orderBy(asc(joinTable.displayOrder), asc(joinTable.createdAt));
    }

    app.get(
      `/${path}/:id/fields`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `list${config.idInfix}Fields`,
          summary:
            `One ${noun}'s attached fields in per-type order ` +
            "— the type editor's Attached fields card",
          tags: [config.tag],
          params: z.object({ id: z.string() }),
          response: { 200: AttachedFieldListEnvelope, default: problemResponse },
        },
      },
      async (request) => {
        const [type] = await app.db
          .select({ id: typesTable.id })
          .from(typesTable)
          .where(eq(typesTable.id, request.params.id))
          .limit(1);
        if (!type) throw httpError(404, `No ${noun} exists with this id.`);
        const rows = await liveAttachments(app.db, type.id);
        return { attachedFields: rows.map(({ join, field }) => toRow(join, field)) };
      },
    );

    app.post(
      `/${path}/:id/fields`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `attach${config.idInfix}Field`,
          summary:
            `Attach a catalog field to a ${noun}: ${config.scopeSummary}, ` +
            "appended to the per-type order, optional from the start " +
            "unless isRequired says otherwise",
          tags: [config.tag],
          params: z.object({ id: z.string() }),
          body: z.object({ fieldId: z.string(), isRequired: z.boolean().optional() }),
          response: { 201: AttachedFieldEnvelope, default: problemResponse },
        },
      },
      async (request, reply) => {
        const isRequired = request.body.isRequired ?? false;
        const row = await app.db.transaction(async (tx) => {
          const type = await lockedType(tx, request.params.id);
          const [field] = await tx
            .select()
            .from(fields)
            .where(eq(fields.id, request.body.fieldId))
            .limit(1)
            .for("update");
          if (!field) throw httpError(404, "No field exists with this id.");
          // The rule is resolved here, under the type's own lock: what
          // it reads off the row cannot change while this attach runs.
          const rule = scopeRuleFor(type);
          if (!rule.scopes.includes(field.moduleScope)) {
            throw httpError(400, rule.refusal);
          }
          if (field.archivedAt) {
            throw httpError(409, `${field.displayName} is archived — restore it first.`);
          }

          // The order appends after every existing attachment, including
          // ones whose fields are archived — their orders are still taken.
          const existing = await tx
            .select({ fieldId: joinTable.fieldId, displayOrder: joinTable.displayOrder })
            .from(joinTable)
            .where(eq(joinTable.typeId, type.id))
            .for("update");
          if (existing.some((candidate) => candidate.fieldId === field.id)) {
            throw httpError(409, `${field.displayName} is already attached to this type.`);
          }
          const displayOrder =
            existing.reduce((top, candidate) => Math.max(top, candidate.displayOrder), 0) + 1;

          const [created] = await tx
            .insert(joinTable)
            .values({ typeId: type.id, fieldId: field.id, displayOrder, isRequired })
            .returning();
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: `${config.actionPrefix}.attached`,
            visibility: "admin_only",
            payload: { typeSlug: type.slug, fieldSlug: field.slug, isRequired },
          });
          return toRow(created!, field);
        });
        return reply.status(201).send({ attachedField: row });
      },
    );

    app.patch(
      `/${path}/:id/fields/:fieldId`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `set${config.idInfix}FieldRequired`,
          summary:
            "Set an attachment's required flag: per attachment, so a " +
            "field can be required for one type and optional elsewhere; " +
            (config.requiredMilestone
              ? `hard enforcement arrives with the record milestone (${config.requiredMilestone})`
              : "hard-enforced when a record is created on this type and " +
                "when one is re-typed onto it (MTR-014)"),
          tags: [config.tag],
          params: z.object({ id: z.string(), fieldId: z.string() }),
          body: z.object({ isRequired: z.boolean() }),
          response: { 200: AttachedFieldEnvelope, default: problemResponse },
        },
      },
      async (request) => {
        const { isRequired } = request.body;
        const row = await app.db.transaction(async (tx) => {
          const type = await lockedType(tx, request.params.id);
          const attachments = await liveAttachments(tx, type.id).for("update", {
            of: joinTable,
          });
          const target = attachments.find(({ join }) => join.fieldId === request.params.fieldId);
          if (!target) throw httpError(404, "This field is not attached to this type.");
          // Setting the current value changes nothing — answer with the
          // row and write no misleading audit entry.
          if (target.join.isRequired === isRequired) return toRow(target.join, target.field);
          const [updated] = await tx
            .update(joinTable)
            .set({ isRequired })
            .where(and(eq(joinTable.typeId, type.id), eq(joinTable.fieldId, target.field.id)))
            .returning();
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: `${config.actionPrefix}.required_changed`,
            visibility: "admin_only",
            payload: { typeSlug: type.slug, fieldSlug: target.field.slug, isRequired },
          });
          return toRow(updated!, target.field);
        });
        return { attachedField: row };
      },
    );

    app.put(
      `/${path}/:id/fields/order`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `reorder${config.idInfix}Fields`,
          summary:
            "Apply a full permutation of one type's attached fields " +
            "(SET-003 immediate apply); per-type orders renumber from 1",
          tags: [config.tag],
          params: z.object({ id: z.string() }),
          body: z.object({ fieldIds: z.array(z.string()).min(1) }),
          response: { 200: AttachedFieldListEnvelope, default: problemResponse },
        },
      },
      async (request) => {
        const { fieldIds } = request.body;
        const rows = await app.db.transaction(async (tx) => {
          const type = await lockedType(tx, request.params.id);
          const attachments = await liveAttachments(tx, type.id).for("update", {
            of: joinTable,
          });
          const byFieldId = new Map(attachments.map((row) => [row.join.fieldId, row]));
          const isPermutation =
            fieldIds.length === attachments.length &&
            new Set(fieldIds).size === fieldIds.length &&
            fieldIds.every((fieldId) => byFieldId.has(fieldId));
          if (!isPermutation) {
            throw httpError(400, "The order must list every attached field exactly once.");
          }
          if (fieldIds.every((fieldId, index) => attachments[index]!.join.fieldId === fieldId)) {
            return attachments.map(({ join, field }) => toRow(join, field));
          }

          const reordered: ReturnType<typeof toRow>[] = [];
          for (const [index, fieldId] of fieldIds.entries()) {
            const current = byFieldId.get(fieldId)!;
            if (current.join.displayOrder === index + 1) {
              reordered.push(toRow(current.join, current.field));
              continue;
            }
            const [updated] = await tx
              .update(joinTable)
              .set({ displayOrder: index + 1 })
              .where(and(eq(joinTable.typeId, type.id), eq(joinTable.fieldId, fieldId)))
              .returning();
            reordered.push(toRow(updated!, current.field));
          }
          // Attachments whose fields are archived are hidden, not gone —
          // renumber them behind the new live order so their old numbers
          // can't collide with it, and a restored field rejoins its
          // attachments at the end of the list (the DES-020 restore
          // position), never the front.
          const hidden = await tx
            .select({ fieldId: joinTable.fieldId, displayOrder: joinTable.displayOrder })
            .from(joinTable)
            .innerJoin(fields, eq(joinTable.fieldId, fields.id))
            .where(and(eq(joinTable.typeId, type.id), isNotNull(fields.archivedAt)))
            .orderBy(asc(joinTable.displayOrder), asc(joinTable.createdAt))
            .for("update", { of: joinTable });
          for (const [index, row] of hidden.entries()) {
            const displayOrder = fieldIds.length + index + 1;
            if (row.displayOrder === displayOrder) continue;
            await tx
              .update(joinTable)
              .set({ displayOrder })
              .where(and(eq(joinTable.typeId, type.id), eq(joinTable.fieldId, row.fieldId)));
          }
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: `${config.actionPrefix}.reordered`,
            visibility: "admin_only",
            payload: { typeSlug: type.slug, order: reordered.map((row) => row.slug) },
          });
          return reordered;
        });
        return { attachedFields: rows };
      },
    );

    app.delete(
      `/${path}/:id/fields/:fieldId`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `detach${config.idInfix}Field`,
          summary:
            `Detach a field from a ${noun}: the join row goes, the ` +
            "catalog definition and stored values stay (MTR-014)",
          tags: [config.tag],
          params: z.object({ id: z.string(), fieldId: z.string() }),
          // z.undefined() = a bodyless 204; z.null() would advertise a
          // JSON null payload to OpenAPI clients.
          response: { 204: z.undefined(), default: problemResponse },
        },
      },
      async (request, reply) => {
        await app.db.transaction(async (tx) => {
          const type = await lockedType(tx, request.params.id);
          const [detached] = await tx
            .delete(joinTable)
            .where(
              and(eq(joinTable.typeId, type.id), eq(joinTable.fieldId, request.params.fieldId)),
            )
            .returning();
          if (!detached) throw httpError(404, "This field is not attached to this type.");
          const [field] = await tx
            .select({ slug: fields.slug })
            .from(fields)
            .where(eq(fields.id, detached.fieldId))
            .limit(1);
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: `${config.actionPrefix}.detached`,
            visibility: "admin_only",
            payload: { typeSlug: type.slug, fieldSlug: field!.slug },
          });
        });
        return reply.status(204).send();
      },
    );
  };
}
