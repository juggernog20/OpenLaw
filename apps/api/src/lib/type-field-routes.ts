// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The per-type field attachment machinery (#85: one machinery, every
 * type editor): list in per-type order, attach with a per-mount scope
 * rule, the per-attachment required flag, reorder, and detach,
 * instantiated per module — contract types (CTR-016), matter types
 * (MTR-011), and request types (INT-002) mount the same routes with
 * their own join tables, scope rules, and audit actions. Detaching
 * deletes the join row only: the catalog definition and any stored
 * values survive by rule (MTR-014). The required flag is stored and
 * editable here; the module that collects the value enforces it.
 * Contracts do from #112, Matters from M22, and the portal when a
 * requester submits (M20). Everything sits behind SET-002's single role gate —
 * Administrators only — and every mutation appends to the activity log
 * (DD-017) inside the same transaction.
 *
 * **The scope rule is per mount, and it may be per row.** A mount
 * whose rule is one line for every type states it once, as the two
 * type editors do. A mount whose rule depends on the type itself —
 * request types read their target (INT-002) — passes a function, which
 * the attach route resolves against the row it has already locked. Such
 * a mount names its own row type, so the rule reads the mount's own
 * columns rather than the shared taxonomy shape.
 *
 * **The rule on the required flag is per mount too**
 * (`TypeFieldRequiredRule`). The flag is written here, but what a
 * required field costs belongs to the surface that collects the value:
 * a `user` or `entity` field is ordinary on a contract type and
 * unanswerable on a request form (#400), so the request-type mount
 * states the refusal and the other two state nothing. A blanket rule on
 * this route would refuse staff a picker that has rows.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  eq,
  fields,
  FIELD_MODULE_SCOPES,
  FIELD_TYPES,
  isNotNull,
  isNull,
  type Executor,
  type Field,
  type FieldModuleScope,
  type FieldType,
  type Transaction,
} from "@openlaw/db";
import { requireRole } from "../auth/guards.js";
import { recordActivity, type TypeFieldActionPrefix } from "./activity.js";
import { httpError, problemResponse } from "./problem.js";
import type { TaxonomyRow, TaxonomyTable } from "./taxonomy-routes.js";

import type { TypeFieldsTable } from "./type-fields.js";
export type { TypeFieldsTable } from "./type-fields.js";
export type TypeFieldRow = TypeFieldsTable["$inferSelect"];

/**
 * What may attach to a type, and what to say when something else
 * tries: the CTR-016 scope rule and its siblings, in one value.
 */
export interface TypeFieldScopeRule {
  /** The field scopes this rule allows — the catalog's own vocabulary,
   * so a mount cannot name a scope no field can carry. */
  scopes: readonly [FieldModuleScope, ...FieldModuleScope[]];
  /** Slugs refused even inside those scopes: built-in attributes the
   * record carries as columns (CTR-025), which no type may attach again. */
  excludedSlugs?: readonly string[];
  /** The refusal line when a field's scope is outside them. */
  refusal: string;
}

/**
 * Which attachments a mount may never mark required, and what to say
 * when one is (INT-002, #400).
 *
 * **It is per mount, like the scope rule, and for the same reason.**
 * The flag is written through one shared route, but what a required
 * field costs is the collecting module's own business: staff pick a
 * user or an entity on a contract from a list that has rows, so that
 * mount states no rule at all. The portal draws those two controls
 * empty on purpose (DD-013, DD-016), so a required one there is a form
 * nobody can submit — and the request-type mount refuses it here rather
 * than letting a requester meet it.
 *
 * A mount that omits the rule may require any field it may attach.
 */
export interface TypeFieldRequiredRule {
  /** The field types this mount refuses to mark required. */
  fieldTypes: readonly [FieldType, ...FieldType[]];
  /** The refusal, which names the field an Administrator just picked
   * (SET-003: a guard refuses and explains, it does not act quietly). */
  refusal: (displayName: string) => string;
  /** The OpenAPI fragment stating the rule on both routes that write
   * the flag. A mount with no rule states nothing. */
  summary: string;
}

/**
 * What a companion attach on the mount's target type answered (INT-002,
 * 2026-09-19): which type it reached and whether this call put the
 * field on it. `attached: false` means the target already had it, which
 * is the outcome the caller wanted and so is not a refusal.
 */
export interface TargetAttachment {
  module: "contract" | "matter";
  typeId: string;
  typeDisplayName: string;
  attached: boolean;
}

/**
 * A mount whose types point at another module's type may attach the
 * same field there in the same transaction (INT-002, 2026-09-19).
 * Request types are the one mount with a target, so they are the one
 * mount that states this rule; the body gains `alsoAttachToTarget` and
 * the envelope gains `alsoAttachedTo` only where the rule is stated.
 *
 * The rule runs after the mount's own attach has been written and under
 * the same locks, so a refusal inside it rolls the form attach back
 * with it: the Administrator asked for both, and gets both or neither.
 */
export interface TypeFieldTargetAttachRule<TRow extends TaxonomyRow = TaxonomyRow> {
  /** The attach summary's fragment, e.g. `the request type's default
   * destination type (INT-002)`. */
  summary: string;
  /** Lock and validate the confirmed destination before locking the shared Field. */
  lock(
    tx: Transaction,
    type: TRow,
    expected: { module: "contract" | "matter"; typeId: string },
  ): Promise<void>;
  run(tx: Transaction, type: TRow, field: Field, actorId: string): Promise<TargetAttachment>;
}

/**
 * The mount's own type row.
 *
 * The machinery reads the shared taxonomy columns and nothing else, so
 * it selects a {@link TaxonomyRow}. A mount whose scope rule reads one
 * of its **own** columns — request types read `target_module`
 * (INT-002) — names its row here, and the rule is handed that row
 * rather than the shared shape. It is the `TaxonomyTypesPane<Row>`
 * precedent (#354) on the API side: the mount owns its table, so the
 * mount is the one place that may say what its rows carry.
 */
export interface TypeFieldRoutesConfig<TRow extends TaxonomyRow = TaxonomyRow> {
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
  scopeRule: TypeFieldScopeRule | ((type: TRow) => TypeFieldScopeRule);
  /** The attach summary's scope fragment, e.g. `contract-scoped and
   * Contract and Matter fields (CTR-016)`. It is the mount's static
   * description: a rule that is a function of the row has no one line
   * the OpenAPI document could state, so the mount says what its rule
   * reads instead. */
  scopeSummary: string;
  /**
   * What this mount may never mark required (INT-002's `user` and
   * `entity` rule, #400). Omitted by a mount whose collecting surface
   * can answer every field type it attaches — the two staff-side type
   * editors omit it.
   */
  requiredRule?: TypeFieldRequiredRule;
  /** DD-017 action prefix, e.g. `contract_type_field`. */
  actionPrefix: TypeFieldActionPrefix;
  /**
   * The companion attach on the type's target (INT-002, 2026-09-19).
   * Omitted by a mount whose types point nowhere — the two record-side
   * type editors omit it.
   */
  targetAttach?: TypeFieldTargetAttachRule<TRow>;
  /** The milestone that will hard-enforce `isRequired`, for a module
   * whose record does not exist yet. Omitted once it does, so the route
   * summary states the live rule rather than promising it. */
  requiredMilestone?: string;
}

/**
 * Locks one type's attachments and answers the order a new one takes:
 * one past the highest, archived fields' rows included, because their
 * orders are still taken. `null` when the field is already on the type,
 * which each caller reads as its own outcome — the attach route refuses
 * it, the companion attach on a target type treats it as already done.
 */
export async function appendedOrder(
  tx: Transaction,
  joinTable: TypeFieldsTable,
  typeId: string,
  fieldId: string,
): Promise<number | null> {
  const existing = await tx
    .select({ fieldId: joinTable.fieldId, displayOrder: joinTable.displayOrder })
    .from(joinTable)
    .where(eq(joinTable.typeId, typeId))
    .for("update");
  if (existing.some((candidate) => candidate.fieldId === fieldId)) return null;
  return existing.reduce((top, candidate) => Math.max(top, candidate.displayOrder), 0) + 1;
}

/**
 * The routes, mounted per module: `typeFieldRoutes(config)` is a
 * Fastify plugin serving `/{path}/:id/fields` — the type editor's
 * Attached fields card.
 */
export function typeFieldRoutes<TRow extends TaxonomyRow = TaxonomyRow>(
  config: TypeFieldRoutesConfig<TRow>,
): FastifyPluginAsyncZod {
  const { typesTable, joinTable, path, noun, scopeRule, requiredRule, targetAttach } = config;

  /**
   * The refusal for marking this field required on this mount, or
   * `undefined` when the mount allows it. Read on both doors: the
   * attach that arrives with the flag already set, and the PATCH that
   * sets it afterwards.
   */
  function requiredRefusal(field: Field): string | undefined {
    if (!requiredRule?.fieldTypes.includes(field.fieldType)) return undefined;
    return requiredRule.refusal(field.displayName);
  }

  /**
   * The rule for one type: the mount's constant, or the mount's
   * function read against the row the route has locked. Nothing is
   * memoized — a row re-pointed between two requests is judged by the
   * rule it carries now, not the one it carried then.
   *
   * The cast is the one place the mount's row type is erased: the
   * machinery selects the whole row off the mount's own table, so what
   * comes back carries the mount's columns whatever the shared shape
   * says. It is the same erasure the taxonomy factory makes for
   * `projectRow`.
   */
  const scopeRuleFor: (type: TaxonomyRow) => TypeFieldScopeRule =
    typeof scopeRule === "function" ? (type) => scopeRule(type as TRow) : () => scopeRule;
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
    builtInKey: z.string().nullable().optional(),
    slug: z.string(),
    displayName: z.string(),
    fieldType: z.enum(FIELD_TYPES),
    moduleScope: z.enum(declaredScopes),
    displayOrder: z.number().int(),
    isRequired: z.boolean(),
  });
  const TargetAttachmentSchema = z.object({
    module: z.enum(["contract", "matter"]),
    typeId: z.string(),
    typeDisplayName: z.string(),
    attached: z.boolean(),
  });
  const ExpectedTargetSchema = z.object({
    module: z.enum(["contract", "matter"]),
    typeId: z.string(),
  });
  const AttachBodySchema = z.object({
    fieldId: z.string(),
    isRequired: z.boolean().optional(),
    ...(targetAttach
      ? {
          alsoAttachToTarget: z.boolean().optional(),
          expectedTarget: ExpectedTargetSchema.optional(),
        }
      : {}),
  });
  const AttachedFieldEnvelope = z.object({ attachedField: AttachedFieldSchema });
  /** The attach route's own envelope: the row, plus the target's side
   * where the mount states a companion rule. The PATCH keeps the plain
   * envelope, because a required-flag change reaches no target. */
  const AttachEnvelope = z.object({
    attachedField: AttachedFieldSchema,
    ...(targetAttach ? { alsoAttachedTo: TargetAttachmentSchema.nullable() } : {}),
  });
  const AttachedFieldListEnvelope = z.object({ attachedFields: z.array(AttachedFieldSchema) });

  function toRow(join: TypeFieldRow, field: Field) {
    return {
      fieldId: field.id,
      ...(field.builtInKey ? { builtInKey: field.builtInKey } : {}),
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
            "unless isRequired says otherwise" +
            (requiredRule ? `; ${requiredRule.summary}` : "") +
            (targetAttach
              ? `; alsoAttachToTarget attaches the same field to ${targetAttach.summary} in the same transaction`
              : ""),
          tags: [config.tag],
          params: z.object({ id: z.string() }),
          body: AttachBodySchema,
          response: { 201: AttachEnvelope, default: problemResponse },
        },
      },
      async (request, reply) => {
        const isRequired = request.body.isRequired ?? false;
        const alsoAttachToTarget =
          "alsoAttachToTarget" in request.body && request.body.alsoAttachToTarget === true;
        const { row, alsoAttachedTo } = await app.db.transaction(async (tx) => {
          const type = await lockedType(tx, request.params.id);
          if (targetAttach && alsoAttachToTarget) {
            const expected =
              "expectedTarget" in request.body ? request.body.expectedTarget : undefined;
            const confirmed = ExpectedTargetSchema.safeParse(expected);
            if (!confirmed.success)
              throw httpError(400, "Confirm the destination type before attaching to both.");
            await targetAttach.lock(tx, type as TRow, confirmed.data);
          }
          const [field] = await tx
            .select()
            .from(fields)
            .where(eq(fields.id, request.body.fieldId))
            .limit(1)
            .for("update");
          if (!field) throw httpError(404, "No field exists with this id.");
          // The rule is resolved here, under the type's own lock: what
          // it reads off the row cannot change while this attach runs.
          if (field.builtInKey && path !== "request-types") {
            throw httpError(
              400,
              "Default fields are already part of records and can only be attached to intake forms.",
            );
          }
          const rule = scopeRuleFor(type);
          if (
            !rule.scopes.includes(field.moduleScope) ||
            rule.excludedSlugs?.includes(field.slug)
          ) {
            throw httpError(400, rule.refusal);
          }
          if (field.archivedAt) {
            throw httpError(409, `${field.displayName} is archived — restore it first.`);
          }
          // The second door on the required flag: an attach may carry
          // it, so the rule is read here as well as on the PATCH.
          if (isRequired) {
            const refusal = requiredRefusal(field);
            if (refusal) throw httpError(400, refusal);
          }

          // The order appends after every existing attachment, including
          // ones whose fields are archived — their orders are still taken.
          const displayOrder = await appendedOrder(tx, joinTable, type.id, field.id);
          if (displayOrder === null) {
            throw httpError(409, `${field.displayName} is already attached to this type.`);
          }

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
          // The companion attach runs last, under the same locks, so a
          // refusal in it takes the form attach down with it.
          const alsoAttachedTo =
            targetAttach && alsoAttachToTarget
              ? await targetAttach.run(tx, type as TRow, field, request.user.id)
              : null;
          return { row: toRow(created!, field), alsoAttachedTo };
        });
        return reply
          .status(201)
          .send({ attachedField: row, ...(targetAttach ? { alsoAttachedTo } : {}) });
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
            (requiredRule ? `${requiredRule.summary}; ` : "") +
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
          // The rule cuts one way, and it is read before the no-op
          // check: asking for a state this mount forbids is refused
          // even by a row that already holds it, and clearing the flag
          // is always allowed — that is the repair.
          if (isRequired) {
            const refusal = requiredRefusal(target.field);
            if (refusal) throw httpError(400, refusal);
          }
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
