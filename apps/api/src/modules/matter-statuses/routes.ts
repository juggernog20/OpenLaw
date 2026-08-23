// SPDX-License-Identifier: AGPL-3.0-only

/** Administrator CRUD for the configurable matter-status taxonomy (MTR-002). */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  MATTER_STATUS_CATEGORIES,
  matters,
  matterStatuses,
  type Executor,
  type MatterStatus,
  type Transaction,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { HttpError, httpError, problemResponse } from "../../lib/problem.js";
import { freeSlug } from "../../lib/slug.js";
import { recordNounPhrase } from "../../lib/taxonomy-routes.js";

const CategorySchema = z.enum(MATTER_STATUS_CATEGORIES);
const DisplayNameSchema = z.string().trim().min(1).max(100);
const PROTECTED_SLUGS = new Set(["open", "closed"]);

const MatterStatusSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  category: CategorySchema,
  displayOrder: z.number().int(),
  isSystemDefault: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  inUseCount: z.number().int(),
});
const MatterStatusEnvelope = z.object({ matterStatus: MatterStatusSchema });
const MatterStatusListEnvelope = z.object({ matterStatuses: z.array(MatterStatusSchema) });
const inUsePhrase = recordNounPhrase({ singular: "matter", plural: "matters" });

function toRow(row: MatterStatus, counts: Map<string, number>) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    category: row.category,
    displayOrder: row.displayOrder,
    isSystemDefault: row.isSystemDefault,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    inUseCount: counts.get(row.id) ?? 0,
  };
}

export const matterStatusesRoutes: FastifyPluginAsyncZod = async (app) => {
  async function usageCounts(db: Executor, ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({ statusId: matters.statusId, inUse: count() })
      .from(matters)
      .where(inArray(matters.statusId, ids))
      .groupBy(matters.statusId);
    return new Map(rows.map((row) => [row.statusId, row.inUse]));
  }

  async function rowJson(row: MatterStatus) {
    return toRow(row, await usageCounts(app.db, [row.id]));
  }

  async function lockedStatus(tx: Transaction, id: string): Promise<MatterStatus> {
    const [row] = await tx
      .select()
      .from(matterStatuses)
      .where(eq(matterStatuses.id, id))
      .limit(1)
      .for("update");
    if (!row) throw httpError(404, "No matter status exists with this id.");
    return row;
  }

  async function breaksCategoryFloor(tx: Transaction, target: MatterStatus): Promise<boolean> {
    const live = await tx
      .select({ id: matterStatuses.id })
      .from(matterStatuses)
      .where(and(eq(matterStatuses.category, target.category), isNull(matterStatuses.archivedAt)))
      .for("update");
    return !live.some((row) => row.id !== target.id);
  }

  app.get(
    "/matter-statuses",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listMatterStatuses",
        summary: "List configurable matter statuses in display order (MTR-002)",
        tags: ["matter-statuses"],
        querystring: z.object({ includeArchived: z.enum(["true", "false"]).optional() }),
        response: { 200: MatterStatusListEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const rows = await app.db
        .select()
        .from(matterStatuses)
        .where(
          request.query.includeArchived === "true" ? undefined : isNull(matterStatuses.archivedAt),
        )
        .orderBy(asc(matterStatuses.displayOrder), asc(matterStatuses.createdAt));
      const counts = await usageCounts(
        app.db,
        rows.map((row) => row.id),
      );
      return { matterStatuses: rows.map((row) => toRow(row, counts)) };
    },
  );

  app.post(
    "/matter-statuses",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "createMatterStatus",
        summary: "Add a matter status with an immutable open or closed category",
        tags: ["matter-statuses"],
        body: z.object({ displayName: DisplayNameSchema, category: CategorySchema }),
        response: { 201: MatterStatusEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const displayName = request.body.displayName.trim();
      const { category } = request.body;
      const row = await app.db.transaction(async (tx) => {
        const existing = await tx
          .select({ slug: matterStatuses.slug, displayOrder: matterStatuses.displayOrder })
          .from(matterStatuses)
          .for("update");
        const taken = new Set(existing.map((candidate) => candidate.slug));
        const slug = freeSlug(displayName, "status", taken);
        const displayOrder =
          existing.reduce((top, candidate) => Math.max(top, candidate.displayOrder), 0) + 1;
        const [created] = await tx
          .insert(matterStatuses)
          .values({ slug, displayName, category, displayOrder })
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "matter_status.created",
          visibility: "admin_only",
          payload: { slug, displayName, category },
        });
        return created!;
      });
      return reply.status(201).send({ matterStatus: await rowJson(row) });
    },
  );

  app.patch(
    "/matter-statuses/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "renameMatterStatus",
        summary: "Rename a matter status; its slug and category are immutable",
        tags: ["matter-statuses"],
        params: z.object({ id: z.string() }),
        body: z.strictObject({ displayName: DisplayNameSchema }),
        response: { 200: MatterStatusEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const displayName = request.body.displayName.trim();
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedStatus(tx, request.params.id);
        if (target.displayName === displayName) return target;
        const [updated] = await tx
          .update(matterStatuses)
          .set({ displayName })
          .where(eq(matterStatuses.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "matter_status.renamed",
          visibility: "admin_only",
          payload: { slug: target.slug, from: target.displayName, to: displayName },
        });
        return updated!;
      });
      return { matterStatus: await rowJson(row) };
    },
  );

  app.put(
    "/matter-statuses/order",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "reorderMatterStatuses",
        summary: "Apply a full permutation of live matter statuses",
        tags: ["matter-statuses"],
        body: z.object({ ids: z.array(z.string()).min(1) }),
        response: { 200: MatterStatusListEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const rows = await app.db.transaction(async (tx) => {
        const live = await tx
          .select()
          .from(matterStatuses)
          .where(isNull(matterStatuses.archivedAt))
          .orderBy(asc(matterStatuses.displayOrder), asc(matterStatuses.createdAt))
          .for("update");
        const byId = new Map(live.map((row) => [row.id, row]));
        const { ids } = request.body;
        if (
          ids.length !== live.length ||
          new Set(ids).size !== ids.length ||
          !ids.every((id) => byId.has(id))
        ) {
          throw httpError(400, "The order must list every live matter status exactly once.");
        }
        const reordered: MatterStatus[] = [];
        for (const [index, id] of ids.entries()) {
          const current = byId.get(id)!;
          if (current.displayOrder === index + 1) reordered.push(current);
          else {
            const [updated] = await tx
              .update(matterStatuses)
              .set({ displayOrder: index + 1 })
              .where(eq(matterStatuses.id, id))
              .returning();
            reordered.push(updated!);
          }
        }
        if (!ids.every((id, index) => live[index]!.id === id)) {
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "matter_status.reordered",
            visibility: "admin_only",
            payload: { order: reordered.map((row) => row.slug) },
          });
        }
        return reordered;
      });
      const counts = await usageCounts(
        app.db,
        rows.map((row) => row.id),
      );
      return { matterStatuses: rows.map((row) => toRow(row, counts)) };
    },
  );

  app.post(
    "/matter-statuses/:id/archive",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "archiveMatterStatus",
        summary: "Archive a matter status, reassigning matters that currently use it",
        tags: ["matter-statuses"],
        params: z.object({ id: z.string() }),
        body: z.strictObject({ reassignToId: z.string().optional() }),
        response: { 200: MatterStatusEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedStatus(tx, request.params.id);
        if (PROTECTED_SLUGS.has(target.slug)) {
          throw httpError(
            409,
            `The ${target.displayName} status is system-protected and can't be archived.`,
          );
        }
        if (target.archivedAt) throw httpError(409, "This matter status is already archived.");
        if (await breaksCategoryFloor(tx, target)) {
          throw httpError(
            409,
            `${target.displayName} is the last unarchived status in its category — ` +
              "every category keeps at least one. Add another status to the category first.",
          );
        }
        // A supplied target is validated whether or not it ends up used.
        // The count can move between the pane's read and this request,
        // so an unneeded target is ignored, not refused — the same rule
        // the shared taxonomy guard applies.
        let reassignment: MatterStatus | null = null;
        if (request.body.reassignToId) {
          reassignment = await lockedStatus(tx, request.body.reassignToId).catch((error) => {
            if (error instanceof HttpError && error.statusCode === 404) return null;
            throw error;
          });
          if (
            !reassignment ||
            reassignment.id === target.id ||
            reassignment.archivedAt ||
            reassignment.category !== target.category
          ) {
            throw httpError(
              400,
              "The reassignment target must be another live status in the same category.",
            );
          }
        }
        const inUseCount = (await usageCounts(tx, [target.id])).get(target.id) ?? 0;
        if (inUseCount > 0) {
          if (!reassignment) {
            throw httpError(
              409,
              `${target.displayName} is the status of ${inUsePhrase(inUseCount)}. ` +
                "Choose another status for them first.",
            );
          }
          const moved = await tx
            .update(matters)
            .set({ statusId: reassignment.id })
            .where(eq(matters.statusId, target.id))
            .returning({ id: matters.id, number: matters.number, title: matters.title });
          await recordActivity(
            tx,
            moved.map((matter) => ({
              entityType: "matter" as const,
              entityId: matter.id,
              actorId: request.user.id,
              action: "matter.status_reassigned" as const,
              visibility: RECORD_ACTIVITY_TIER,
              payload: {
                number: matter.number,
                title: matter.title,
                from: target.displayName,
                to: reassignment!.displayName,
              },
            })),
          );
        } else {
          reassignment = null;
        }
        const [updated] = await tx
          .update(matterStatuses)
          .set({ archivedAt: new Date() })
          .where(eq(matterStatuses.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "matter_status.archived",
          visibility: "admin_only",
          payload: {
            slug: target.slug,
            displayName: target.displayName,
            category: target.category,
            inUseCount,
            reassignedTo: reassignment?.displayName ?? null,
          },
        });
        return updated!;
      });
      return { matterStatus: await rowJson(row) };
    },
  );

  app.post(
    "/matter-statuses/:id/restore",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "restoreMatterStatus",
        summary: "Restore an archived matter status at the end of the display order",
        tags: ["matter-statuses"],
        params: z.object({ id: z.string() }),
        response: { 200: MatterStatusEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedStatus(tx, request.params.id);
        if (!target.archivedAt) throw httpError(409, "This matter status is not archived.");
        const live = await tx
          .select({ displayOrder: matterStatuses.displayOrder })
          .from(matterStatuses)
          .where(isNull(matterStatuses.archivedAt))
          .for("update");
        const displayOrder =
          live.reduce((top, candidate) => Math.max(top, candidate.displayOrder), 0) + 1;
        const [updated] = await tx
          .update(matterStatuses)
          .set({ archivedAt: null, displayOrder })
          .where(eq(matterStatuses.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "matter_status.restored",
          visibility: "admin_only",
          payload: { slug: target.slug, displayName: target.displayName },
        });
        return updated!;
      });
      return { matterStatus: await rowJson(row) };
    },
  );

  app.delete(
    "/matter-statuses/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "deleteMatterStatus",
        summary: "Delete an unused matter status while preserving category minimums",
        tags: ["matter-statuses"],
        params: z.object({ id: z.string() }),
        response: { 204: z.undefined(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        const target = await lockedStatus(tx, request.params.id);
        if (PROTECTED_SLUGS.has(target.slug)) {
          throw httpError(
            409,
            `The ${target.displayName} status is system-protected and can't be deleted.`,
          );
        }
        if (!target.archivedAt && (await breaksCategoryFloor(tx, target))) {
          throw httpError(
            409,
            `${target.displayName} is the last unarchived status in its category — ` +
              "every category keeps at least one. Add another status to the category first.",
          );
        }
        const inUseCount = (await usageCounts(tx, [target.id])).get(target.id) ?? 0;
        if (inUseCount > 0) {
          throw httpError(
            409,
            `${target.displayName} is the status of ${inUsePhrase(inUseCount)} and can't be deleted.`,
          );
        }
        await tx.delete(matterStatuses).where(eq(matterStatuses.id, target.id));
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "matter_status.deleted",
          visibility: "admin_only",
          payload: {
            slug: target.slug,
            displayName: target.displayName,
            category: target.category,
          },
        });
      });
      return reply.status(204).send();
    },
  );
};
