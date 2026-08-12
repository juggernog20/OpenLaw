// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The configurable-taxonomy machinery (#85: one machinery, every type
 * table): list, add, rename, reorder, archive with the SET-003 guard,
 * restore, and hard delete, instantiated per module — contract types
 * (CTR-002), matter types (MTR-001), and entity types (ENT-001) mount
 * the same routes with their own tables, vocabulary, and audit
 * actions. Everything sits behind SET-002's single role gate —
 * Administrators only — and every mutation appends to the activity
 * log (DD-017) inside the same transaction. Each table's `other` row
 * is system-protected here, not just in the UI: archive and delete
 * refuse it regardless of what a client sends. In-use counts are per
 * mount: a module whose record milestone has landed arms `usage`
 * (entities, #100) and gets genuine counts plus the live SET-003
 * guard; the others read zero until theirs does.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { asc, contractTypes, entityTypes, eq, isNull, matterTypes } from "@openlaw/db";
import { requireRole } from "../auth/guards.js";
import { recordActivity, type ActivityWriter, type TaxonomyActionPrefix } from "./activity.js";
import { HttpError, httpError, problemResponse } from "./problem.js";
import { freeSlug } from "./slug.js";

/** The taxonomy tables are one shape by construction (`taxonomyColumns`). */
export type TaxonomyTable = typeof contractTypes | typeof matterTypes | typeof entityTypes;
export type TaxonomyRow = TaxonomyTable["$inferSelect"];

/**
 * The SET-003 live-usage machinery, supplied by a module once its record
 * milestone lands (entities first, #100). `counts` answers the guard
 * number — how many records reference each type. `reassign` moves every
 * referencing record to the target — archived records included, so a
 * later restore never resurrects a reference to an archived type
 * (ENT-009) — and writes each moved record's own DD-017 feed entry.
 * Both run on the caller's executor: the archive route passes its
 * transaction, so the move, the audit rows, and the archive commit or
 * roll back together, serialized by the type-row lock the record
 * routes also take before writing.
 */
export interface TaxonomyUsage {
  counts(db: ActivityWriter, ids: string[]): Promise<Map<string, number>>;
  reassign(
    tx: ActivityWriter,
    move: { from: TaxonomyRow; to: TaxonomyRow; actorId: string },
  ): Promise<number>;
}

export interface TaxonomyRoutesConfig {
  table: TaxonomyTable;
  /** URL segment under /api/v1, e.g. `contract-types`. */
  path: string;
  /** OpenAPI tag, e.g. `contract-types`. */
  tag: string;
  /** operationId fragments, e.g. `ContractType` / `ContractTypes`. */
  idSingular: string;
  idPlural: string;
  /** Response envelope keys, e.g. `contractType` / `contractTypes`. */
  keySingular: string;
  keyPlural: string;
  /** Prose vocabulary, e.g. `contract type`. */
  noun: string;
  /** The decision that fixed this taxonomy (CTR-002 / MTR-001). */
  decision: string;
  /** DD-017 action prefix, e.g. `contract_type`. */
  actionPrefix: TaxonomyActionPrefix;
  /** What uses a type once records exist, both grammatical numbers —
   * the guard refusals pluralize by count. */
  recordNoun: { singular: string; plural: string };
  /** The milestone whose records arm `usage` (M8 / M22); omit once armed. */
  recordsMilestone?: string;
  /** The module's live-usage counter and reassignment mover. Absent
   * until the module's record milestone lands: counts read zero and
   * the SET-003 guard stays dormant — `recordsMilestone` names when. */
  usage?: TaxonomyUsage;
}

const TaxonomyRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  displayOrder: z.number().int(),
  isSystemDefault: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  /** Live records on this type — the SET-003 guard number. */
  inUseCount: z.number().int(),
});

const DisplayNameSchema = z.string().trim().min(1).max(100);
const DescriptionSchema = z.string().trim().max(500);

function toRow(row: TaxonomyRow, counts: Map<string, number>) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    description: row.description,
    displayOrder: row.displayOrder,
    isSystemDefault: row.isSystemDefault,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    inUseCount: counts.get(row.id) ?? 0,
  };
}

/**
 * The routes, mounted per module: `taxonomyRoutes(config)` is a
 * Fastify plugin serving `/{path}` with the full DES-020 behavior set.
 */
export function taxonomyRoutes(config: TaxonomyRoutesConfig): FastifyPluginAsyncZod {
  const { table, path, noun } = config;
  // "a contract type", but "an entity type" — the indefinite article
  // rides the noun into every generated summary.
  const aNoun = `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
  const RowEnvelope = z.object({ [config.keySingular]: TaxonomyRowSchema });
  const ListEnvelope = z.object({ [config.keyPlural]: z.array(TaxonomyRowSchema) });

  return async (app) => {
    type Tx = Parameters<Parameters<typeof app.db.transaction>[0]>[0];

    /** Locks and returns one row, or 404s — every :id mutation starts here. */
    async function lockedType(tx: Tx, id: string): Promise<TaxonomyRow> {
      const [row] = await tx.select().from(table).where(eq(table.id, id)).limit(1).for("update");
      if (!row) throw httpError(404, `No ${noun} exists with this id.`);
      return row;
    }

    /** The SET-003 guard numbers — zero for every id until `usage` arms. */
    async function usageCounts(db: ActivityWriter, ids: string[]): Promise<Map<string, number>> {
      if (!config.usage || ids.length === 0) return new Map();
      return config.usage.counts(db, ids);
    }

    /** One row as its envelope value, with its live count. */
    async function rowJson(row: TaxonomyRow) {
      return toRow(row, await usageCounts(app.db, [row.id]));
    }

    /** "3 entities" / "1 entity" — the guard refusals' count phrase. */
    const inUsePhrase = (count: number) =>
      `${count} ${count === 1 ? config.recordNoun.singular : config.recordNoun.plural}`;

    app.get(
      `/${path}`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `list${config.idPlural}`,
          summary:
            `The ${noun} taxonomy in display order (${config.decision}); ` +
            "archived rows only with includeArchived=true",
          tags: [config.tag],
          querystring: z.object({ includeArchived: z.enum(["true", "false"]).optional() }),
          response: { 200: ListEnvelope, default: problemResponse },
        },
      },
      async (request) => {
        const rows = await app.db
          .select()
          .from(table)
          .where(request.query.includeArchived === "true" ? undefined : isNull(table.archivedAt))
          .orderBy(asc(table.displayOrder), asc(table.createdAt));
        const counts = await usageCounts(
          app.db,
          rows.map((row) => row.id),
        );
        return { [config.keyPlural]: rows.map((row) => toRow(row, counts)) };
      },
    );

    app.get(
      `/${path}/:id`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `get${config.idSingular}`,
          summary: `One ${noun} — the read behind the type editor`,
          tags: [config.tag],
          params: z.object({ id: z.string() }),
          response: { 200: RowEnvelope, default: problemResponse },
        },
      },
      async (request) => {
        const [row] = await app.db
          .select()
          .from(table)
          .where(eq(table.id, request.params.id))
          .limit(1);
        if (!row) throw httpError(404, `No ${noun} exists with this id.`);
        return { [config.keySingular]: await rowJson(row) };
      },
    );

    app.post(
      `/${path}`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `create${config.idSingular}`,
          summary:
            `Add ${aNoun}: the slug is derived here, once, and is ` +
            "immutable after creation; the row appends to the display order",
          tags: [config.tag],
          body: z.object({ displayName: DisplayNameSchema }),
          response: { 201: RowEnvelope, default: problemResponse },
        },
      },
      async (request, reply) => {
        const displayName = request.body.displayName.trim();
        const row = await app.db.transaction(async (tx) => {
          // Slug and order derive from the full row set — archived rows
          // still hold their slugs (restore brings them back) and their
          // display orders, so both scans include them.
          const existing = await tx
            .select({ slug: table.slug, displayOrder: table.displayOrder })
            .from(table)
            .for("update");
          const slug = freeSlug(
            displayName,
            "type",
            new Set(existing.map((candidate) => candidate.slug)),
          );
          const displayOrder =
            existing.reduce((top, candidate) => Math.max(top, candidate.displayOrder), 0) + 1;

          const [created] = await tx
            .insert(table)
            .values({ slug, displayName, displayOrder })
            .returning();
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: `${config.actionPrefix}.created`,
            visibility: "admin_only",
            payload: { slug, displayName },
          });
          return created!;
        });
        return reply.status(201).send({ [config.keySingular]: await rowJson(row) });
      },
    );

    app.patch(
      `/${path}/:id`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `update${config.idSingular}`,
          summary:
            `Rename ${aNoun}'s display name (DES-017 in-place ` +
            "rename) or edit its description; the slug never " +
            "changes, and even `other` may rename",
          tags: [config.tag],
          params: z.object({ id: z.string() }),
          // Strict: slug immutability is an explicit refusal, not a strip.
          body: z.strictObject({
            displayName: DisplayNameSchema.optional(),
            description: DescriptionSchema.nullable().optional(),
          }),
          response: { 200: RowEnvelope, default: problemResponse },
        },
      },
      async (request) => {
        const body = request.body;
        const row = await app.db.transaction(async (tx) => {
          const target = await lockedType(tx, request.params.id);

          const patch: Partial<TaxonomyRow> = {};
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
            .update(table)
            .set(patch)
            .where(eq(table.id, target.id))
            .returning();
          // A rename stays its own audit verb — the M9 viewer narrates
          // "renamed" rather than a generic edit; other columns share one
          // `updated` entry with the fields-route changed map.
          if (patch.displayName !== undefined) {
            await recordActivity(tx, {
              entityType: "system",
              actorId: request.user.id,
              action: `${config.actionPrefix}.renamed`,
              visibility: "admin_only",
              payload: { slug: target.slug, from: target.displayName, to: patch.displayName },
            });
          }
          if (patch.description !== undefined) {
            await recordActivity(tx, {
              entityType: "system",
              actorId: request.user.id,
              action: `${config.actionPrefix}.updated`,
              visibility: "admin_only",
              payload: {
                slug: target.slug,
                changed: { description: { from: target.description, to: patch.description } },
              },
            });
          }
          return updated!;
        });
        return { [config.keySingular]: await rowJson(row) };
      },
    );

    app.put(
      `/${path}/order`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `reorder${config.idPlural}`,
          summary:
            "Apply a full permutation of the live rows (SET-003 immediate " +
            "apply); display orders renumber from 1, archived rows keep theirs",
          tags: [config.tag],
          body: z.object({ ids: z.array(z.string()).min(1) }),
          response: { 200: ListEnvelope, default: problemResponse },
        },
      },
      async (request) => {
        const { ids } = request.body;
        const rows = await app.db.transaction(async (tx) => {
          const live = await tx
            .select()
            .from(table)
            .where(isNull(table.archivedAt))
            .orderBy(asc(table.displayOrder), asc(table.createdAt))
            .for("update");
          const liveById = new Map(live.map((row) => [row.id, row]));
          const isPermutation =
            ids.length === live.length &&
            new Set(ids).size === ids.length &&
            ids.every((id) => liveById.has(id));
          if (!isPermutation) {
            throw httpError(400, `The order must list every live ${noun} exactly once.`);
          }
          if (ids.every((id, index) => live[index]!.id === id)) return live;

          const reordered: TaxonomyRow[] = [];
          for (const [index, id] of ids.entries()) {
            const current = liveById.get(id)!;
            if (current.displayOrder === index + 1) {
              reordered.push(current);
              continue;
            }
            const [updated] = await tx
              .update(table)
              .set({ displayOrder: index + 1 })
              .where(eq(table.id, id))
              .returning();
            reordered.push(updated!);
          }
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: `${config.actionPrefix}.reordered`,
            visibility: "admin_only",
            payload: { order: reordered.map((row) => row.slug) },
          });
          return reordered;
        });
        const counts = await usageCounts(
          app.db,
          rows.map((row) => row.id),
        );
        return { [config.keyPlural]: rows.map((row) => toRow(row, counts)) };
      },
    );

    app.post(
      `/${path}/:id/archive`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `archive${config.idSingular}`,
          summary: config.usage
            ? `Archive ${aNoun} (SET-003 guarded): a type still used by ` +
              `${config.recordNoun.plural} requires a reassignment target, ` +
              `which takes them; nothing is deleted; \`other\` refuses`
            : `Archive ${aNoun} (SET-003 guarded): it leaves pickers ` +
              "and the default list; nothing is deleted; `other` refuses",
          tags: [config.tag],
          params: z.object({ id: z.string() }),
          body: z.object({ reassignToId: z.string().optional() }),
          response: { 200: RowEnvelope, default: problemResponse },
        },
      },
      async (request) => {
        const { reassignToId } = request.body;
        const row = await app.db.transaction(async (tx) => {
          const target = await lockedType(tx, request.params.id);
          if (target.slug === "other") {
            throw httpError(409, "The Other type is system-protected and can't be archived.");
          }
          if (target.archivedAt) throw httpError(409, `This ${noun} is already archived.`);

          let reassignTo: TaxonomyRow | undefined;
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
              throw httpError(400, `The reassignment target must be a live ${noun}.`);
            }
          }

          // The SET-003 guard number, read under the target's row lock —
          // the record routes lock the same row before writing their
          // type column, so the count can't move underneath the guard.
          const inUseCount = (await usageCounts(tx, [target.id])).get(target.id) ?? 0;
          if (inUseCount > 0 && !reassignTo) {
            throw httpError(
              409,
              `This ${noun} is used by ${inUsePhrase(inUseCount)}. ` +
                "Pick a reassignment target to archive it.",
            );
          }
          if (inUseCount > 0 && reassignTo) {
            // Every referencing record moves to the target — archived
            // records included (ENT-009) — each with its own DD-017
            // feed entry, atomically with the archive below.
            await config.usage!.reassign(tx, {
              from: target,
              to: reassignTo,
              actorId: request.user.id,
            });
          }

          const [updated] = await tx
            .update(table)
            .set({ archivedAt: new Date() })
            .where(eq(table.id, target.id))
            .returning();
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: `${config.actionPrefix}.archived`,
            visibility: "admin_only",
            payload: {
              slug: target.slug,
              displayName: target.displayName,
              inUseCount,
              reassignedTo: reassignTo?.slug ?? null,
            },
          });
          return updated!;
        });
        return { [config.keySingular]: await rowJson(row) };
      },
    );

    app.post(
      `/${path}/:id/restore`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `restore${config.idSingular}`,
          summary:
            `Restore an archived ${noun} (SET-003's recovery story) ` +
            "to the end of the display order",
          tags: [config.tag],
          params: z.object({ id: z.string() }),
          response: { 200: RowEnvelope, default: problemResponse },
        },
      },
      async (request) => {
        const row = await app.db.transaction(async (tx) => {
          const target = await lockedType(tx, request.params.id);
          if (!target.archivedAt) throw httpError(409, `This ${noun} is not archived.`);
          const live = await tx
            .select({ displayOrder: table.displayOrder })
            .from(table)
            .where(isNull(table.archivedAt))
            .for("update");
          const displayOrder =
            live.reduce((top, candidate) => Math.max(top, candidate.displayOrder), 0) + 1;
          const [updated] = await tx
            .update(table)
            .set({ archivedAt: null, displayOrder })
            .where(eq(table.id, target.id))
            .returning();
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: `${config.actionPrefix}.restored`,
            visibility: "admin_only",
            payload: { slug: target.slug, displayName: target.displayName },
          });
          return updated!;
        });
        return { [config.keySingular]: await rowJson(row) };
      },
    );

    app.delete(
      `/${path}/:id`,
      {
        preHandler: requireRole("administrator"),
        schema: {
          operationId: `delete${config.idSingular}`,
          summary: config.usage
            ? `Hard-delete ${aNoun}; \`other\` refuses (${config.decision}), ` +
              `and so does a type still used by ${config.recordNoun.plural}`
            : `Hard-delete ${aNoun}; \`other\` refuses (${config.decision}), and ` +
              `once ${config.recordNoun.plural} exist (${config.recordsMilestone}) an in-use type will refuse too`,
          tags: [config.tag],
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
          // An in-use type refuses cleanly — the records' FK would refuse
          // anyway, as a bare 500. Archive with a reassignment is the way.
          const inUseCount = (await usageCounts(tx, [target.id])).get(target.id) ?? 0;
          if (inUseCount > 0) {
            throw httpError(
              409,
              `This ${noun} is used by ${inUsePhrase(inUseCount)} and can't be ` +
                "deleted. Archive it with a reassignment target instead.",
            );
          }
          await tx.delete(table).where(eq(table.id, target.id));
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: `${config.actionPrefix}.deleted`,
            visibility: "admin_only",
            payload: { slug: target.slug, displayName: target.displayName },
          });
        });
        return reply.status(204).send();
      },
    );
  };
}
