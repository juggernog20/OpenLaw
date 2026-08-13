// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The contract-status taxonomy routes (CTR-001, #82): the second
 * list-editor pane's machinery — list, add with a stage picked at
 * creation, rename, reorder, archive, restore, and hard delete. The
 * stage is immutable after creation: rename takes a strict body, so a
 * request carrying `stage` is refused rather than silently stripped.
 * Archive and delete enforce the CTR-001 floor — every stage keeps at
 * least one unarchived status — and never offer reassignment: structural
 * minimums block instead (SET-003, CTR-020). From #113 that block is
 * live on both counts: a status still held by contracts refuses with the
 * real number, and the Administrator moves those contracts themselves.
 * The `draft`, `active`, and `expired`
 * seed rows are system-protected here, not just in the UI. Everything
 * sits behind SET-002's single role gate — Administrators only — and
 * every mutation appends to the activity log (DD-017) inside the same
 * transaction.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  contracts,
  contractStatuses,
  CONTRACT_STAGES,
  count,
  eq,
  inArray,
  isNull,
  type ContractStatus,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity, type ActivityWriter } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { recordNounPhrase } from "../../lib/taxonomy-routes.js";

const StageSchema = z.enum(CONTRACT_STAGES);

const ContractStatusSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  stage: StageSchema,
  displayOrder: z.number().int(),
  isSystemDefault: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  /** The SET-003 guard number: every contract holding this status,
   * archived contracts included (CTR-020). */
  inUseCount: z.number().int(),
});

const ContractStatusEnvelope = z.object({ contractStatus: ContractStatusSchema });
const ContractStatusListEnvelope = z.object({ contractStatuses: z.array(ContractStatusSchema) });

const DisplayNameSchema = z.string().trim().min(1).max(100);

/** The CTR-001 system-protected seeds: no archive, no hard delete. */
const PROTECTED_SLUGS = new Set(["draft", "active", "expired"]);

function toRow(row: ContractStatus, counts: Map<string, number>) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    stage: row.stage,
    displayOrder: row.displayOrder,
    isSystemDefault: row.isSystemDefault,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    inUseCount: counts.get(row.id) ?? 0,
  };
}

/** "3 contracts" / "1 contract" — the guard refusal's count phrase. */
const inUsePhrase = recordNounPhrase({ singular: "contract", plural: "contracts" });

/** `"On hold"` → `on_hold`; anything left empty becomes `status`. */
function slugBaseOf(displayName: string): string {
  const base = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "status";
}

export const contractStatusesRoutes: FastifyPluginAsyncZod = async (app) => {
  type Tx = Parameters<Parameters<typeof app.db.transaction>[0]>[0];

  /**
   * The SET-003 guard numbers: how many contracts hold each status
   * (#113). Archived contracts count, the same rule the type guard
   * follows (ENT-009) — the counted set and the set the
   * `contracts.status_id` FK protects on hard delete are one set, and a
   * restored contract must never come back holding an archived status.
   */
  async function usageCounts(db: ActivityWriter, ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select({ statusId: contracts.statusId, inUse: count() })
      .from(contracts)
      .where(inArray(contracts.statusId, ids))
      .groupBy(contracts.statusId);
    return new Map(rows.map((row) => [row.statusId, row.inUse]));
  }

  /** One row as its envelope value, with its live count. */
  async function rowJson(row: ContractStatus) {
    return toRow(row, await usageCounts(app.db, [row.id]));
  }

  /** Locks and returns one row, or 404s — every :id mutation starts here. */
  async function lockedStatus(tx: Tx, id: string): Promise<ContractStatus> {
    const [row] = await tx
      .select()
      .from(contractStatuses)
      .where(eq(contractStatuses.id, id))
      .limit(1)
      .for("update");
    if (!row) throw httpError(404, "No contract status exists with this id.");
    return row;
  }

  /**
   * The CTR-001 floor: would removing `target` from the live list leave
   * its stage with no unarchived status? Locks every live row of the
   * stage, so two concurrent removals of a stage's last two statuses
   * serialize instead of both passing the check.
   */
  async function breaksStageFloor(tx: Tx, target: ContractStatus): Promise<boolean> {
    const liveInStage = await tx
      .select({ id: contractStatuses.id })
      .from(contractStatuses)
      .where(and(eq(contractStatuses.stage, target.stage), isNull(contractStatuses.archivedAt)))
      .for("update");
    return !liveInStage.some((row) => row.id !== target.id);
  }

  app.get(
    "/contract-statuses",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listContractStatuses",
        summary:
          "The contract-status taxonomy in display order (CTR-001), each " +
          "row carrying its fixed stage; archived rows only with " +
          "includeArchived=true",
        tags: ["contract-statuses"],
        querystring: z.object({ includeArchived: z.enum(["true", "false"]).optional() }),
        response: { 200: ContractStatusListEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const rows = await app.db
        .select()
        .from(contractStatuses)
        .where(
          request.query.includeArchived === "true"
            ? undefined
            : isNull(contractStatuses.archivedAt),
        )
        .orderBy(asc(contractStatuses.displayOrder), asc(contractStatuses.createdAt));
      const counts = await usageCounts(
        app.db,
        rows.map((row) => row.id),
      );
      return { contractStatuses: rows.map((row) => toRow(row, counts)) };
    },
  );

  app.post(
    "/contract-statuses",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "createContractStatus",
        summary:
          "Add a contract status: the stage is picked here, once, and is " +
          "immutable after creation, like the derived slug; the row " +
          "appends to the display order",
        tags: ["contract-statuses"],
        body: z.object({ displayName: DisplayNameSchema, stage: StageSchema }),
        response: { 201: ContractStatusEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const displayName = request.body.displayName.trim();
      const { stage } = request.body;
      const row = await app.db.transaction(async (tx) => {
        // Slug and order derive from the full row set — archived rows
        // still hold their slugs (restore brings them back) and their
        // display orders, so both scans include them.
        const existing = await tx
          .select({ slug: contractStatuses.slug, displayOrder: contractStatuses.displayOrder })
          .from(contractStatuses)
          .for("update");
        const taken = new Set(existing.map((candidate) => candidate.slug));
        const base = slugBaseOf(displayName);
        let slug = base;
        for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}_${suffix}`;
        const displayOrder =
          existing.reduce((top, candidate) => Math.max(top, candidate.displayOrder), 0) + 1;

        const [created] = await tx
          .insert(contractStatuses)
          .values({ slug, displayName, stage, displayOrder })
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_status.created",
          visibility: "admin_only",
          payload: { slug, displayName, stage },
        });
        return created!;
      });
      return reply.status(201).send({ contractStatus: await rowJson(row) });
    },
  );

  app.patch(
    "/contract-statuses/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "renameContractStatus",
        summary:
          "Rename a contract status's display name (DES-017 in-place " +
          "rename); the slug and the stage never change — a body carrying " +
          "`stage` is refused, and even protected rows may rename",
        tags: ["contract-statuses"],
        params: z.object({ id: z.string() }),
        // Strict: stage immutability is an explicit refusal, not a
        // silently stripped key a client could mistake for success.
        body: z.strictObject({ displayName: DisplayNameSchema }),
        response: { 200: ContractStatusEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const displayName = request.body.displayName.trim();
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedStatus(tx, request.params.id);
        // Renaming to the current name changes nothing — answer with the
        // row and write no misleading from==to audit entry.
        if (target.displayName === displayName) return target;
        const [updated] = await tx
          .update(contractStatuses)
          .set({ displayName })
          .where(eq(contractStatuses.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_status.renamed",
          visibility: "admin_only",
          payload: { slug: target.slug, from: target.displayName, to: displayName },
        });
        return updated!;
      });
      return { contractStatus: await rowJson(row) };
    },
  );

  app.put(
    "/contract-statuses/order",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "reorderContractStatuses",
        summary:
          "Apply a full permutation of the live rows (SET-003 immediate " +
          "apply); display orders renumber from 1, archived rows keep theirs",
        tags: ["contract-statuses"],
        body: z.object({ ids: z.array(z.string()).min(1) }),
        response: { 200: ContractStatusListEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { ids } = request.body;
      const rows = await app.db.transaction(async (tx) => {
        const live = await tx
          .select()
          .from(contractStatuses)
          .where(isNull(contractStatuses.archivedAt))
          .orderBy(asc(contractStatuses.displayOrder), asc(contractStatuses.createdAt))
          .for("update");
        const liveById = new Map(live.map((row) => [row.id, row]));
        const isPermutation =
          ids.length === live.length &&
          new Set(ids).size === ids.length &&
          ids.every((id) => liveById.has(id));
        if (!isPermutation) {
          throw httpError(400, "The order must list every live contract status exactly once.");
        }
        if (ids.every((id, index) => live[index]!.id === id)) return live;

        const reordered: ContractStatus[] = [];
        for (const [index, id] of ids.entries()) {
          const current = liveById.get(id)!;
          if (current.displayOrder === index + 1) {
            reordered.push(current);
            continue;
          }
          const [updated] = await tx
            .update(contractStatuses)
            .set({ displayOrder: index + 1 })
            .where(eq(contractStatuses.id, id))
            .returning();
          reordered.push(updated!);
        }
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_status.reordered",
          visibility: "admin_only",
          payload: { order: reordered.map((row) => row.slug) },
        });
        return reordered;
      });
      const counts = await usageCounts(
        app.db,
        rows.map((row) => row.id),
      );
      return { contractStatuses: rows.map((row) => toRow(row, counts)) };
    },
  );

  app.post(
    "/contract-statuses/:id/archive",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "archiveContractStatus",
        summary:
          "Archive a contract status (SET-003): it leaves pickers and the " +
          "default list; nothing is deleted. A status still held by " +
          "contracts refuses with the count (CTR-020 — statuses block, " +
          "they never reassign), as does the last unarchived status of a " +
          "stage (CTR-001 floor) and the protected `draft`, `active`, and " +
          "`expired` rows",
        tags: ["contract-statuses"],
        params: z.object({ id: z.string() }),
        response: { 200: ContractStatusEnvelope, default: problemResponse },
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
        if (target.archivedAt) throw httpError(409, "This contract status is already archived.");
        if (await breaksStageFloor(tx, target)) {
          throw httpError(
            409,
            `${target.displayName} is the last unarchived status in its stage — ` +
              "every stage keeps at least one. Add another status to the stage first.",
          );
        }
        // The SET-003 guard, read under the target's row lock — the
        // record's status PATCH locks the same row before it writes, so
        // a status change can't slip between the count and the archive.
        // Statuses block instead of reassigning (CTR-020): the
        // Administrator moves the contracts, because which status each
        // one belongs on is a judgement no bulk move can make.
        const inUseCount = (await usageCounts(tx, [target.id])).get(target.id) ?? 0;
        if (inUseCount > 0) {
          throw httpError(
            409,
            `${target.displayName} is the status of ${inUsePhrase(inUseCount)}. ` +
              "Move them to another status first.",
          );
        }

        const [updated] = await tx
          .update(contractStatuses)
          .set({ archivedAt: new Date() })
          .where(eq(contractStatuses.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_status.archived",
          visibility: "admin_only",
          payload: {
            slug: target.slug,
            displayName: target.displayName,
            stage: target.stage,
            // Always zero here — an in-use status refuses above. It is
            // written anyway so the M9 viewer reads one payload shape
            // for every archive entry, whichever taxonomy wrote it.
            inUseCount,
          },
        });
        return updated!;
      });
      return { contractStatus: await rowJson(row) };
    },
  );

  app.post(
    "/contract-statuses/:id/restore",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "restoreContractStatus",
        summary:
          "Restore an archived contract status (SET-003's recovery story) " +
          "to the end of the display order; its stage rides along unchanged",
        tags: ["contract-statuses"],
        params: z.object({ id: z.string() }),
        response: { 200: ContractStatusEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const row = await app.db.transaction(async (tx) => {
        const target = await lockedStatus(tx, request.params.id);
        if (!target.archivedAt) throw httpError(409, "This contract status is not archived.");
        const live = await tx
          .select({ displayOrder: contractStatuses.displayOrder })
          .from(contractStatuses)
          .where(isNull(contractStatuses.archivedAt))
          .for("update");
        const displayOrder =
          live.reduce((top, candidate) => Math.max(top, candidate.displayOrder), 0) + 1;
        const [updated] = await tx
          .update(contractStatuses)
          .set({ archivedAt: null, displayOrder })
          .where(eq(contractStatuses.id, target.id))
          .returning();
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_status.restored",
          visibility: "admin_only",
          payload: { slug: target.slug, displayName: target.displayName },
        });
        return updated!;
      });
      return { contractStatus: await rowJson(row) };
    },
  );

  app.delete(
    "/contract-statuses/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "deleteContractStatus",
        summary:
          "Hard-delete a contract status; the protected `draft`, " +
          "`active`, and `expired` rows refuse (CTR-001), as does the " +
          "last unarchived status of a stage and a status still held by " +
          "contracts",
        tags: ["contract-statuses"],
        params: z.object({ id: z.string() }),
        // z.undefined() = a bodyless 204; z.null() would advertise a
        // JSON null payload to OpenAPI clients.
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
        // An archived row is already outside the live set, so deleting
        // it can't break the floor; a live row must leave a stage-mate.
        if (!target.archivedAt && (await breaksStageFloor(tx, target))) {
          throw httpError(
            409,
            `${target.displayName} is the last unarchived status in its stage — ` +
              "every stage keeps at least one. Add another status to the stage first.",
          );
        }
        // An in-use status refuses cleanly — the contracts' FK would
        // refuse anyway, as a bare 500. Move the contracts first.
        const inUseCount = (await usageCounts(tx, [target.id])).get(target.id) ?? 0;
        if (inUseCount > 0) {
          throw httpError(
            409,
            `${target.displayName} is the status of ${inUsePhrase(inUseCount)} and ` +
              "can't be deleted. Move them to another status first.",
          );
        }
        await tx.delete(contractStatuses).where(eq(contractStatuses.id, target.id));
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "contract_status.deleted",
          visibility: "admin_only",
          payload: { slug: target.slug, displayName: target.displayName, stage: target.stage },
        });
      });
      return reply.status(204).send();
    },
  );
};
