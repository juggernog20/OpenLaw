// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The per-type field attachments (CTR-016, #84): the machinery behind
 * the type editor's Attached fields card — list in per-type order,
 * attach with the scope rule (contract-scoped and global fields only;
 * other modules' scopes are refused), the per-attachment required flag,
 * reorder, and detach. Detaching deletes the join row only: the catalog
 * definition and any stored values survive by rule (MTR-014). The
 * required flag is stored and editable here; its hard enforcement at
 * record creation arrives with the contract record milestone (M8).
 * Everything sits behind SET-002's single role gate — Administrators
 * only — and every mutation appends to the activity log (DD-017) inside
 * the same transaction.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  contractTypeFields,
  contractTypes,
  eq,
  fields,
  FIELD_TYPES,
  isNull,
  type ContractType,
  type ContractTypeField,
  type Field,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

/** The CTR-016 scope rule for this module's types. */
const ATTACHABLE_SCOPE_LIST = ["contract", "global"] as const;

/** One attachment, joined to the catalog columns the editor renders. */
const AttachedFieldSchema = z.object({
  fieldId: z.string(),
  slug: z.string(),
  displayName: z.string(),
  fieldType: z.enum(FIELD_TYPES),
  moduleScope: z.enum(ATTACHABLE_SCOPE_LIST),
  displayOrder: z.number().int(),
  isRequired: z.boolean(),
});

const AttachedFieldEnvelope = z.object({ attachedField: AttachedFieldSchema });
const AttachedFieldListEnvelope = z.object({ attachedFields: z.array(AttachedFieldSchema) });

const ATTACHABLE_SCOPES = new Set<string>(ATTACHABLE_SCOPE_LIST);

function toRow(join: ContractTypeField, field: Field) {
  return {
    fieldId: field.id,
    slug: field.slug,
    displayName: field.displayName,
    fieldType: field.fieldType,
    moduleScope: field.moduleScope as (typeof ATTACHABLE_SCOPE_LIST)[number],
    displayOrder: join.displayOrder,
    isRequired: join.isRequired,
  };
}

export const attachedFieldsRoutes: FastifyPluginAsyncZod = async (app) => {
  type Tx = Parameters<Parameters<typeof app.db.transaction>[0]>[0];

  /** Locks and returns the type, or 404s — every mutation starts here. */
  async function lockedType(tx: Tx, id: string): Promise<ContractType> {
    const [row] = await tx
      .select()
      .from(contractTypes)
      .where(eq(contractTypes.id, id))
      .limit(1)
      .for("update");
    if (!row) throw httpError(404, "No contract type exists with this id.");
    return row;
  }

  /**
   * One type's attachments joined to their live fields, in per-type
   * order. Attachments to archived fields persist (restore brings them
   * back) but never render — archived means hidden everywhere.
   */
  function liveAttachments(dbOrTx: Tx | typeof app.db, typeId: string) {
    return dbOrTx
      .select({ join: contractTypeFields, field: fields })
      .from(contractTypeFields)
      .innerJoin(fields, eq(contractTypeFields.fieldId, fields.id))
      .where(and(eq(contractTypeFields.contractTypeId, typeId), isNull(fields.archivedAt)))
      .orderBy(asc(contractTypeFields.displayOrder), asc(contractTypeFields.createdAt));
  }

  app.get(
    "/contract-types/:id/fields",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listAttachedFields",
        summary:
          "One contract type's attached fields in per-type order " +
          "(CTR-016) — the type editor's Attached fields card",
        tags: ["contract-types"],
        params: z.object({ id: z.string() }),
        response: { 200: AttachedFieldListEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const [type] = await app.db
        .select({ id: contractTypes.id })
        .from(contractTypes)
        .where(eq(contractTypes.id, request.params.id))
        .limit(1);
      if (!type) throw httpError(404, "No contract type exists with this id.");
      const rows = await liveAttachments(app.db, type.id);
      return { attachedFields: rows.map(({ join, field }) => toRow(join, field)) };
    },
  );

  app.post(
    "/contract-types/:id/fields",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "attachField",
        summary:
          "Attach a catalog field to a contract type: contract-scoped " +
          "and global fields only (CTR-016), appended to the per-type " +
          "order, optional from the start unless isRequired says otherwise",
        tags: ["contract-types"],
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
        if (!ATTACHABLE_SCOPES.has(field.moduleScope)) {
          throw httpError(400, "Only contract-scoped and global fields attach to contract types.");
        }
        if (field.archivedAt) {
          throw httpError(409, `${field.displayName} is archived — restore it first.`);
        }

        // The order appends after every existing attachment, including
        // ones whose fields are archived — their orders are still taken.
        const existing = await tx
          .select({
            fieldId: contractTypeFields.fieldId,
            displayOrder: contractTypeFields.displayOrder,
          })
          .from(contractTypeFields)
          .where(eq(contractTypeFields.contractTypeId, type.id))
          .for("update");
        if (existing.some((candidate) => candidate.fieldId === field.id)) {
          throw httpError(409, `${field.displayName} is already attached to this type.`);
        }
        const displayOrder =
          existing.reduce((top, candidate) => Math.max(top, candidate.displayOrder), 0) + 1;

        const [created] = await tx
          .insert(contractTypeFields)
          .values({ contractTypeId: type.id, fieldId: field.id, displayOrder, isRequired })
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_type_field.attached",
          visibility: "admin_only",
          payload: { typeSlug: type.slug, fieldSlug: field.slug, isRequired },
        });
        return toRow(created!, field);
      });
      return reply.status(201).send({ attachedField: row });
    },
  );

  app.patch(
    "/contract-types/:id/fields/:fieldId",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "setAttachedFieldRequired",
        summary:
          "Set an attachment's required flag: per attachment, so a " +
          "field can be required for NDAs and optional elsewhere " +
          "(CTR-016); hard enforcement arrives with contract records (M8)",
        tags: ["contract-types"],
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
          of: contractTypeFields,
        });
        const target = attachments.find(({ join }) => join.fieldId === request.params.fieldId);
        if (!target) throw httpError(404, "This field is not attached to this type.");
        // Setting the current value changes nothing — answer with the
        // row and write no misleading audit entry.
        if (target.join.isRequired === isRequired) return toRow(target.join, target.field);
        const [updated] = await tx
          .update(contractTypeFields)
          .set({ isRequired })
          .where(
            and(
              eq(contractTypeFields.contractTypeId, type.id),
              eq(contractTypeFields.fieldId, target.field.id),
            ),
          )
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_type_field.required_changed",
          visibility: "admin_only",
          payload: { typeSlug: type.slug, fieldSlug: target.field.slug, isRequired },
        });
        return toRow(updated!, target.field);
      });
      return { attachedField: row };
    },
  );

  app.put(
    "/contract-types/:id/fields/order",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "reorderAttachedFields",
        summary:
          "Apply a full permutation of one type's attached fields " +
          "(SET-003 immediate apply); per-type orders renumber from 1",
        tags: ["contract-types"],
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
          of: contractTypeFields,
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
            .update(contractTypeFields)
            .set({ displayOrder: index + 1 })
            .where(
              and(
                eq(contractTypeFields.contractTypeId, type.id),
                eq(contractTypeFields.fieldId, fieldId),
              ),
            )
            .returning();
          reordered.push(toRow(updated!, current.field));
        }
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_type_field.reordered",
          visibility: "admin_only",
          payload: { typeSlug: type.slug, order: reordered.map((row) => row.slug) },
        });
        return reordered;
      });
      return { attachedFields: rows };
    },
  );

  app.delete(
    "/contract-types/:id/fields/:fieldId",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "detachField",
        summary:
          "Detach a field from a contract type: the join row goes, the " +
          "catalog definition and stored values stay (MTR-014)",
        tags: ["contract-types"],
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
          .delete(contractTypeFields)
          .where(
            and(
              eq(contractTypeFields.contractTypeId, type.id),
              eq(contractTypeFields.fieldId, request.params.fieldId),
            ),
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
          action: "contract_type_field.detached",
          visibility: "admin_only",
          payload: { typeSlug: type.slug, fieldSlug: field!.slug },
        });
      });
      return reply.status(204).send();
    },
  );
};
