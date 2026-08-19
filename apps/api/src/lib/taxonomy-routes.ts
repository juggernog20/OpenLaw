// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The configurable-taxonomy machinery (#85: one machinery, every type
 * table): list, add, rename, reorder, archive with the SET-003 guard,
 * restore, and hard delete, instantiated per module — contract types
 * (CTR-002), matter types (MTR-001), and entity types (ENT-001) mount
 * the same routes with their own tables, vocabulary, and audit
 * actions. Everything sits behind SET-002's single role gate —
 * Administrators only — and every mutation appends to the activity
 * log (DD-017) inside the same transaction.
 *
 * Three things are per mount, and nothing else is.
 *
 * **In-use counts.** A module whose record milestone has landed arms
 * `usage` (entities #100, contracts #113) and gets genuine counts plus
 * the live SET-003 guard; matter types read zero until M22 arms theirs.
 *
 * **The system-protected row.** `protectedSlug` names the fallback row
 * archive and delete refuse here, not just in the UI, regardless of
 * what a client sends. The three type taxonomies pass `other`. A mount
 * with no fallback row omits it and protects nothing, so a row an
 * Administrator happens to name "Other" never inherits the lock.
 *
 * **The mount's own columns.** `extras` adds keys to the row
 * projection and to the strict PATCH body, validates them under the
 * row lock, and narrates them in the `updated` payload. A mount that
 * passes none is the plain taxonomy the three type tables are.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { asc, eq, isNull, type Executor, type TaxonomyTable, type Transaction } from "@openlaw/db";
import type { ChangedFields } from "@openlaw/shared";
import { requireRole } from "../auth/guards.js";
import { recordActivity, type TaxonomyActionPrefix } from "./activity.js";
import { HttpError, httpError, problemResponse } from "./problem.js";
import { freeSlug } from "./slug.js";

/**
 * The taxonomy tables are one shape by construction
 * (`taxonomyColumns`), and a mount may carry columns of its own beside
 * it — those are the extras hook's business, never the machinery's.
 */
export type { TaxonomyTable };
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
  counts(db: Executor, ids: string[]): Promise<Map<string, number>>;
  reassign(
    tx: Executor,
    move: { from: TaxonomyRow; to: TaxonomyRow; actorId: string },
  ): Promise<number>;
}

/**
 * What a mount's extras answer once the machinery has locked the row
 * and is about to write it.
 */
export interface TaxonomyExtrasPatch {
  /** Columns to write, merged into the machinery's own patch. Nothing
   * to write is an empty object — the route then behaves exactly as it
   * does when no column changed. */
  columns?: Record<string, unknown>;
  /** What the `updated` activity payload should narrate, in the same
   * `changed` map the description edit already writes. */
  changed?: ChangedFields;
}

/** The locked row, and the body that asked for the change. */
export interface TaxonomyExtrasPatchInput<TPatch extends z.ZodRawShape = z.ZodRawShape> {
  /** The PATCH route's transaction — the extras' own reads and writes
   * commit or roll back with the machinery's. */
  tx: Transaction;
  /** The row, read `for update`: nothing else may write it until this
   * transaction ends, so a refusal here is a refusal on live values. */
  row: TaxonomyRow;
  /** The validated body: the mount's own keys, typed from
   * `patchSchema`, beside the two the machinery always accepts. */
  body: z.infer<z.ZodObject<TPatch>> & { displayName?: string; description?: string | null };
}

/**
 * A mount's own columns, wired into the shared machinery (#85's second
 * extension point, after `usage`).
 *
 * The three type taxonomies carry nothing beyond the shared columns and
 * pass no extras at all, which is exactly today's behavior. A mount
 * that does carry more — request types carry a target (INT-002) —
 * declares here what the row projects, what the strict PATCH body
 * accepts on top of the shared keys, and what happens under the row
 * lock before the write.
 */
export interface TaxonomyExtras<
  TRow extends z.ZodRawShape = z.ZodRawShape,
  TPatch extends z.ZodRawShape = z.ZodRawShape,
> {
  /** Extra keys on the row schema, so they appear in the list and the
   * single-row responses and in the OpenAPI document. */
  rowSchema: TRow;
  /** Every key `rowSchema` declares and no other, read off the row the
   * machinery selected. A mount casts to its own row type — it owns its
   * table. */
  projectRow: (row: TaxonomyRow) => z.infer<z.ZodObject<TRow>>;
  /** Extra keys the strict PATCH body accepts. The body stays strict:
   * a key no mount declared is still refused rather than stripped, and
   * a mount may not declare a machinery-owned column (`slug` above
   * all) — the mount fails when it is built. */
  patchSchema?: TPatch;
  /**
   * Runs inside the PATCH transaction, under the row's `for update`
   * lock, before the write — the same place the SET-003 archive guard
   * reads its count. It validates what the body asked for against the
   * locked row, refuses with `httpError` (which surfaces as an
   * RFC 9457 problem like every other refusal), and answers the columns
   * to write and what to narrate.
   */
  applyPatch?: (
    input: TaxonomyExtrasPatchInput<TPatch>,
  ) => TaxonomyExtrasPatch | Promise<TaxonomyExtrasPatch>;
}

interface TaxonomyRoutesBase<
  TRow extends z.ZodRawShape = z.ZodRawShape,
  TPatch extends z.ZodRawShape = z.ZodRawShape,
> {
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
  /**
   * The slug of the system-protected row: archive and hard delete
   * refuse it here, not just in the UI, whatever a client sends. The
   * three type taxonomies pass `other`, so a non-null fallback type
   * always exists.
   *
   * A mount with no fallback row omits it and then no row is
   * protected — the lock must follow the decision that a row is a
   * fallback, never the name an Administrator happened to type.
   */
  protectedSlug?: string;
  /** The mount's own columns on the row, the PATCH body, and the
   * `updated` payload. Omitted, the mount is the plain taxonomy the
   * three type tables are. */
  extras?: TaxonomyExtras<TRow, TPatch>;
}

export type TaxonomyRoutesConfig<
  TRow extends z.ZodRawShape = z.ZodRawShape,
  TPatch extends z.ZodRawShape = z.ZodRawShape,
> =
  | (TaxonomyRoutesBase<TRow, TPatch> & {
      /** The milestone whose records arm `usage` (M8 / M22). */
      recordsMilestone: string;
      usage?: never;
    })
  | (TaxonomyRoutesBase<TRow, TPatch> & {
      recordsMilestone?: never;
      /** The module's live-usage counter and reassignment mover. */
      usage: TaxonomyUsage;
    });

const TaxonomyRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  displayOrder: z.number().int(),
  isSystemDefault: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  /** The SET-003 guard number: every record holding this type,
   * archived records included (ENT-009, CTR-020). */
  inUseCount: z.number().int(),
});

/**
 * The columns the machinery writes itself, and which a mount's extras
 * may therefore neither write nor put on the PATCH body: the slug is
 * immutable by rule (CTR-002), the display name and the description
 * have their own audit verbs, the display order belongs to the reorder
 * route, and `archived_at` belongs to archive and restore.
 * `is_system_default` is absent on purpose — the machinery never
 * writes it, so it is a mount's to own.
 */
const MACHINERY_COLUMNS: ReadonlySet<string> = new Set([
  "id",
  "slug",
  "displayName",
  "description",
  "displayOrder",
  "archivedAt",
  "createdAt",
  "updatedAt",
]);

const DisplayNameSchema = z.string().trim().min(1).max(100);
const DescriptionSchema = z.string().trim().max(500);

/** The mount's extra keys for one row, with their shape already
 * checked against `rowSchema` at the mount. */
type ProjectExtras = (row: TaxonomyRow) => Record<string, unknown>;

function toRow(row: TaxonomyRow, counts: Map<string, number>, projectExtras?: ProjectExtras) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    description: row.description,
    displayOrder: row.displayOrder,
    isSystemDefault: row.isSystemDefault,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    inUseCount: counts.get(row.id) ?? 0,
    ...projectExtras?.(row),
  };
}

/** Builds the "3 entities" / "1 entity" phrase helper for guard refusals. */
export function recordNounPhrase(recordNoun: { singular: string; plural: string }) {
  return (count: number) => `${count} ${count === 1 ? recordNoun.singular : recordNoun.plural}`;
}

/**
 * The routes, mounted per module: `taxonomyRoutes(config)` is a
 * Fastify plugin serving `/{path}` with the full DES-020 behavior set.
 */
export function taxonomyRoutes<
  TRow extends z.ZodRawShape = z.ZodRawShape,
  TPatch extends z.ZodRawShape = z.ZodRawShape,
>(config: TaxonomyRoutesConfig<TRow, TPatch>): FastifyPluginAsyncZod {
  const { table, path, noun } = config;
  // A mount adds keys and redefines none: a key the machinery already
  // declares would silently take over the projection or the body, so it
  // fails here, when the mount is built, rather than at a request.
  for (const key of Object.keys(config.extras?.rowSchema ?? {})) {
    if (Object.hasOwn(TaxonomyRowSchema.shape, key)) {
      throw new Error(
        `The ${noun} extras redeclare \`${key}\` on the row, which the taxonomy owns.`,
      );
    }
  }
  // The body may not name a machinery column either: `slug` above all —
  // accepting it and ignoring it would turn the explicit immutability
  // refusal into a silent strip.
  for (const key of Object.keys(config.extras?.patchSchema ?? {})) {
    if (MACHINERY_COLUMNS.has(key)) {
      throw new Error(
        `The ${noun} extras declare \`${key}\` on the body, a column the taxonomy machinery owns.`,
      );
    }
  }
  // "a contract type", but "an entity type" — the indefinite article
  // rides the noun into every generated summary.
  const aNoun = `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
  // A mount with no extras gets `TaxonomyRowSchema` itself, so its
  // OpenAPI row and its responses are the ones it has always had.
  const RowSchema = config.extras
    ? TaxonomyRowSchema.extend(config.extras.rowSchema)
    : TaxonomyRowSchema;
  const RowEnvelope = z.object({ [config.keySingular]: RowSchema });
  const ListEnvelope = z.object({ [config.keyPlural]: z.array(RowSchema) });
  // The system-protected row's clause in the generated summaries. Empty
  // for a mount with no protected row, which then does not promise one.
  const protectedClause = config.protectedSlug ? `\`${config.protectedSlug}\` refuses` : "";
  // The one place the extras' types are erased: past here the machinery
  // treats a mount's keys as opaque, and `RowSchema` is what holds them
  // to what `rowSchema` declared.
  const projectExtras = config.extras?.projectRow as ProjectExtras | undefined;

  return async (app) => {
    /** Locks and returns one row, or 404s — every :id mutation starts here. */
    async function lockedType(tx: Transaction, id: string): Promise<TaxonomyRow> {
      const [row] = await tx.select().from(table).where(eq(table.id, id)).limit(1).for("update");
      if (!row) throw httpError(404, `No ${noun} exists with this id.`);
      return row;
    }

    /** The SET-003 guard numbers — zero for every id until `usage` arms. */
    async function usageCounts(db: Executor, ids: string[]): Promise<Map<string, number>> {
      if (!config.usage || ids.length === 0) return new Map();
      return config.usage.counts(db, ids);
    }

    /** One row as its envelope value, with its live count. */
    async function rowJson(row: TaxonomyRow) {
      return toRow(row, await usageCounts(app.db, [row.id]), projectExtras);
    }

    /** "3 entities" / "1 entity" — the guard refusals' count phrase. */
    const inUsePhrase = recordNounPhrase(config.recordNoun);

    /** The mount's fallback row, which archive and delete refuse. A
     * mount with no fallback protects nothing. */
    const isProtected = (row: TaxonomyRow) =>
      config.protectedSlug !== undefined && row.slug === config.protectedSlug;

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
        return { [config.keyPlural]: rows.map((row) => toRow(row, counts, projectExtras)) };
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
            `changes${config.protectedSlug ? `, and even \`${config.protectedSlug}\` may rename` : ""}`,
          tags: [config.tag],
          params: z.object({ id: z.string() }),
          // Strict: slug immutability is an explicit refusal, not a
          // strip. A mount's extras widen the accepted keys and nothing
          // else — an undeclared key is still refused.
          body: z.strictObject({
            displayName: DisplayNameSchema.optional(),
            description: DescriptionSchema.nullable().optional(),
            ...config.extras?.patchSchema,
          }),
          response: { 200: RowEnvelope, default: problemResponse },
        },
      },
      async (request) => {
        const body: Record<string, unknown> = request.body;
        const row = await app.db.transaction(async (tx) => {
          const target = await lockedType(tx, request.params.id);

          const patch: Record<string, unknown> = {};
          const displayName = (body.displayName as string | undefined)?.trim();
          if (displayName !== undefined && displayName !== target.displayName) {
            patch.displayName = displayName;
          }
          const rawDescription = body.description as string | null | undefined;
          const description =
            rawDescription !== undefined ? rawDescription?.trim() || null : undefined;
          if (description !== undefined && description !== target.description) {
            patch.description = description;
          }
          // The mount's own columns, decided under the row lock the
          // machinery already holds: a refusal here is a refusal on live
          // values, and it rolls back with everything else. The body is
          // the mount's own shape by construction — the strict schema
          // above was built from `patchSchema` — so the cast below is
          // the same erasure `projectExtras` makes.
          const extra = await config.extras?.applyPatch?.({
            tx,
            row: target,
            body: body as TaxonomyExtrasPatchInput<TPatch>["body"],
          });
          // A mount may write its own columns and no others. Reaching
          // for one the machinery writes — the immutable slug above
          // all — is a mount bug, so it fails as one rather than
          // quietly overwriting the row.
          for (const column of Object.keys(extra?.columns ?? {})) {
            if (MACHINERY_COLUMNS.has(column)) {
              throw new Error(
                `The ${noun} extras tried to write \`${column}\`, which the taxonomy machinery owns.`,
              );
            }
          }
          Object.assign(patch, extra?.columns);
          const changed: ChangedFields = {};
          if (patch.description !== undefined) {
            changed.description = { from: target.description, to: patch.description };
          }
          Object.assign(changed, extra?.changed);
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
              payload: {
                slug: target.slug,
                from: target.displayName,
                to: patch.displayName as string,
              },
            });
          }
          if (Object.keys(changed).length > 0) {
            await recordActivity(tx, {
              entityType: "system",
              actorId: request.user.id,
              action: `${config.actionPrefix}.updated`,
              visibility: "admin_only",
              payload: { slug: target.slug, changed },
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
        return { [config.keyPlural]: rows.map((row) => toRow(row, counts, projectExtras)) };
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
              `which takes them; nothing is deleted` +
              (protectedClause ? `; ${protectedClause}` : "")
            : `Archive ${aNoun} (SET-003 guarded): it leaves pickers ` +
              "and the default list; nothing is deleted" +
              (protectedClause ? `; ${protectedClause}` : ""),
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
          if (isProtected(target)) {
            throw httpError(
              409,
              `The ${target.displayName} type is system-protected and can't be archived.`,
            );
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
          // type column, serializing creation of new references.
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
          summary: protectedClause
            ? config.usage
              ? `Hard-delete ${aNoun}; ${protectedClause} (${config.decision}), ` +
                `and so does a type still used by ${config.recordNoun.plural}`
              : `Hard-delete ${aNoun}; ${protectedClause} (${config.decision}), and ` +
                `once ${config.recordNoun.plural} exist (${config.recordsMilestone}) an in-use type will refuse too`
            : config.usage
              ? `Hard-delete ${aNoun} (${config.decision}); a type still used ` +
                `by ${config.recordNoun.plural} refuses`
              : `Hard-delete ${aNoun} (${config.decision}); once ` +
                `${config.recordNoun.plural} exist (${config.recordsMilestone}) an in-use type will refuse`,
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
          if (isProtected(target)) {
            throw httpError(
              409,
              `The ${target.displayName} type is system-protected and can't be deleted.`,
            );
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
