// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract-type taxonomy routes (CTR-002, #81): the machinery behind
 * the first list-editor pane — list, add, rename, reorder, archive with
 * the SET-003 guard, restore, and hard delete. Everything sits behind
 * SET-002's single role gate — Administrators only — and every mutation
 * appends to the activity log (DD-017) inside the same transaction. The
 * `other` row is system-protected here, not just in the UI: archive and
 * delete refuse it regardless of what a client sends.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { asc, contractTypes, eq, isNull, type ContractType } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { HttpError, httpError, problemResponse } from "../../lib/problem.js";

const ContractTypeSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  displayOrder: z.number().int(),
  isSystemDefault: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  /** Live contracts on this type — the SET-003 guard number. */
  inUseCount: z.number().int(),
});

const ContractTypeEnvelope = z.object({ contractType: ContractTypeSchema });
const ContractTypeListEnvelope = z.object({ contractTypes: z.array(ContractTypeSchema) });

const DisplayNameSchema = z.string().trim().min(1).max(100);
const DescriptionSchema = z.string().trim().max(500);

/**
 * No contracts exist until M8, so every type's live-usage count is zero.
 * M8 replaces this with a real count over `contracts.contract_type_id`,
 * which also arms the SET-003 rule that an in-use archive requires a
 * reassignment target.
 */
const IN_USE_COUNT = 0;

function toRow(row: ContractType) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    description: row.description,
    displayOrder: row.displayOrder,
    isSystemDefault: row.isSystemDefault,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    inUseCount: IN_USE_COUNT,
  };
}

/** `"Real Estate"` → `real_estate`; anything left empty becomes `type`. */
function slugBaseOf(displayName: string): string {
  const base = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "type";
}

export const contractTypesRoutes: FastifyPluginAsyncZod = async (app) => {
  type Tx = Parameters<Parameters<typeof app.db.transaction>[0]>[0];

  /** Locks and returns one row, or 404s — every :id mutation starts here. */
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

  app.get(
    "/contract-types",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listContractTypes",
        summary:
          "The contract-type taxonomy in display order (CTR-002); " +
          "archived rows only with includeArchived=true",
        tags: ["contract-types"],
        querystring: z.object({ includeArchived: z.enum(["true", "false"]).optional() }),
        response: { 200: ContractTypeListEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const rows = await app.db
        .select()
        .from(contractTypes)
        .where(
          request.query.includeArchived === "true" ? undefined : isNull(contractTypes.archivedAt),
        )
        .orderBy(asc(contractTypes.displayOrder), asc(contractTypes.createdAt));
      return { contractTypes: rows.map(toRow) };
    },
  );

  app.get(
    "/contract-types/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getContractType",
        summary: "One contract type — the read behind the type editor (#84)",
        tags: ["contract-types"],
        params: z.object({ id: z.string() }),
        response: { 200: ContractTypeEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const [row] = await app.db
        .select()
        .from(contractTypes)
        .where(eq(contractTypes.id, request.params.id))
        .limit(1);
      if (!row) throw httpError(404, "No contract type exists with this id.");
      return { contractType: toRow(row) };
    },
  );

  app.post(
    "/contract-types",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "createContractType",
        summary:
          "Add a contract type: the slug is derived here, once, and is " +
          "immutable after creation; the row appends to the display order",
        tags: ["contract-types"],
        body: z.object({ displayName: DisplayNameSchema }),
        response: { 201: ContractTypeEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const displayName = request.body.displayName.trim();
      const row = await app.db.transaction(async (tx) => {
        // Slug and order derive from the full row set — archived rows
        // still hold their slugs (restore brings them back) and their
        // display orders, so both scans include them.
        const existing = await tx
          .select({ slug: contractTypes.slug, displayOrder: contractTypes.displayOrder })
          .from(contractTypes)
          .for("update");
        const taken = new Set(existing.map((candidate) => candidate.slug));
        const base = slugBaseOf(displayName);
        let slug = base;
        for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}_${suffix}`;
        const displayOrder =
          existing.reduce((top, candidate) => Math.max(top, candidate.displayOrder), 0) + 1;

        const [created] = await tx
          .insert(contractTypes)
          .values({ slug, displayName, displayOrder })
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_type.created",
          visibility: "admin_only",
          payload: { slug, displayName },
        });
        return created!;
      });
      return reply.status(201).send({ contractType: toRow(row) });
    },
  );

  app.patch(
    "/contract-types/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "updateContractType",
        summary:
          "Rename a contract type's display name (DES-017 in-place " +
          "rename) or edit its description (#84); the slug never " +
          "changes, and even `other` may rename",
        tags: ["contract-types"],
        params: z.object({ id: z.string() }),
        // Strict: slug immutability is an explicit refusal, not a strip.
        body: z.strictObject({
          displayName: DisplayNameSchema.optional(),
          description: DescriptionSchema.nullable().optional(),
        }),
        response: { 200: ContractTypeEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const body = request.body;
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedType(tx, request.params.id);

        const patch: Partial<ContractType> = {};
        const displayName = body.displayName?.trim();
        if (displayName !== undefined && displayName !== target.displayName) {
          patch.displayName = displayName;
        }
        const description =
          body.description !== undefined ? body.description?.trim() || null : undefined;
        if (description !== undefined && description !== target.description) {
          patch.description = description;
        }
        // Nothing changed: answer with the row and write no misleading
        // from==to audit entry.
        if (Object.keys(patch).length === 0) return target;

        const [updated] = await tx
          .update(contractTypes)
          .set(patch)
          .where(eq(contractTypes.id, target.id))
          .returning();
        // A rename stays its own audit verb — the M9 viewer narrates
        // "renamed" rather than a generic edit; other columns share one
        // `updated` entry with the fields-route changed map.
        if (patch.displayName !== undefined) {
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "contract_type.renamed",
            visibility: "admin_only",
            payload: { slug: target.slug, from: target.displayName, to: patch.displayName },
          });
        }
        if (patch.description !== undefined) {
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "contract_type.updated",
            visibility: "admin_only",
            payload: {
              slug: target.slug,
              changed: { description: { from: target.description, to: patch.description } },
            },
          });
        }
        return updated!;
      });
      return { contractType: toRow(row) };
    },
  );

  app.put(
    "/contract-types/order",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "reorderContractTypes",
        summary:
          "Apply a full permutation of the live rows (SET-003 immediate " +
          "apply); display orders renumber from 1, archived rows keep theirs",
        tags: ["contract-types"],
        body: z.object({ ids: z.array(z.string()).min(1) }),
        response: { 200: ContractTypeListEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { ids } = request.body;
      const rows = await app.db.transaction(async (tx) => {
        const live = await tx
          .select()
          .from(contractTypes)
          .where(isNull(contractTypes.archivedAt))
          .orderBy(asc(contractTypes.displayOrder), asc(contractTypes.createdAt))
          .for("update");
        const liveById = new Map(live.map((row) => [row.id, row]));
        const isPermutation =
          ids.length === live.length &&
          new Set(ids).size === ids.length &&
          ids.every((id) => liveById.has(id));
        if (!isPermutation) {
          throw httpError(400, "The order must list every live contract type exactly once.");
        }
        if (ids.every((id, index) => live[index]!.id === id)) return live;

        const reordered: ContractType[] = [];
        for (const [index, id] of ids.entries()) {
          const current = liveById.get(id)!;
          if (current.displayOrder === index + 1) {
            reordered.push(current);
            continue;
          }
          const [updated] = await tx
            .update(contractTypes)
            .set({ displayOrder: index + 1 })
            .where(eq(contractTypes.id, id))
            .returning();
          reordered.push(updated!);
        }
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_type.reordered",
          visibility: "admin_only",
          payload: { order: reordered.map((row) => row.slug) },
        });
        return reordered;
      });
      return { contractTypes: rows.map(toRow) };
    },
  );

  app.post(
    "/contract-types/:id/archive",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "archiveContractType",
        summary:
          "Archive a contract type (SET-003 guarded): it leaves pickers " +
          "and the default list; nothing is deleted; `other` refuses",
        tags: ["contract-types"],
        params: z.object({ id: z.string() }),
        body: z.object({ reassignToId: z.string().optional() }),
        response: { 200: ContractTypeEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { reassignToId } = request.body;
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedType(tx, request.params.id);
        if (target.slug === "other") {
          throw httpError(409, "The Other type is system-protected and can't be archived.");
        }
        if (target.archivedAt) throw httpError(409, "This contract type is already archived.");

        let reassignTo: ContractType | undefined;
        if (reassignToId !== undefined) {
          if (reassignToId === target.id) {
            throw httpError(400, "A type can't take reassignments from itself.");
          }
          // Only the 404 becomes "no target" — a connection failure or
          // timeout must surface as itself, not as a 400 refusal.
          reassignTo = await lockedType(tx, reassignToId).catch((error: unknown) => {
            if (error instanceof HttpError && error.statusCode === 404) return undefined;
            throw error;
          });
          if (!reassignTo || reassignTo.archivedAt) {
            throw httpError(400, "The reassignment target must be a live contract type.");
          }
          // Nothing to move until contracts exist (M8); accepting and
          // validating the target now keeps the request shape stable.
        }

        const [updated] = await tx
          .update(contractTypes)
          .set({ archivedAt: new Date() })
          .where(eq(contractTypes.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_type.archived",
          visibility: "admin_only",
          payload: {
            slug: target.slug,
            displayName: target.displayName,
            inUseCount: IN_USE_COUNT,
            reassignedTo: reassignTo?.slug ?? null,
          },
        });
        return updated!;
      });
      return { contractType: toRow(row) };
    },
  );

  app.post(
    "/contract-types/:id/restore",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "restoreContractType",
        summary:
          "Restore an archived contract type (SET-003's recovery story) " +
          "to the end of the display order",
        tags: ["contract-types"],
        params: z.object({ id: z.string() }),
        response: { 200: ContractTypeEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedType(tx, request.params.id);
        if (!target.archivedAt) throw httpError(409, "This contract type is not archived.");
        const live = await tx
          .select({ displayOrder: contractTypes.displayOrder })
          .from(contractTypes)
          .where(isNull(contractTypes.archivedAt))
          .for("update");
        const displayOrder =
          live.reduce((top, candidate) => Math.max(top, candidate.displayOrder), 0) + 1;
        const [updated] = await tx
          .update(contractTypes)
          .set({ archivedAt: null, displayOrder })
          .where(eq(contractTypes.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_type.restored",
          visibility: "admin_only",
          payload: { slug: target.slug, displayName: target.displayName },
        });
        return updated!;
      });
      return { contractType: toRow(row) };
    },
  );

  app.delete(
    "/contract-types/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "deleteContractType",
        summary:
          "Hard-delete a contract type; `other` refuses (CTR-002), and " +
          "once contracts exist (M8) an in-use type will refuse too",
        tags: ["contract-types"],
        params: z.object({ id: z.string() }),
        // z.undefined() = a bodyless 204; z.null() would advertise a
        // JSON null payload to OpenAPI clients.
        response: { 204: z.undefined(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        const target = await lockedType(tx, request.params.id);
        if (target.slug === "other") {
          throw httpError(409, "The Other type is system-protected and can't be deleted.");
        }
        await tx.delete(contractTypes).where(eq(contractTypes.id, target.id));
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_type.deleted",
          visibility: "admin_only",
          payload: { slug: target.slug, displayName: target.displayName },
        });
      });
      return reply.status(204).send();
    },
  );
};
