// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One person's saved list views (DD-019).
 *
 * A view records how somebody wants a list to read: which columns, in
 * what order, at what widths, under which filters, sorted how. The
 * reader saves it, names it, forks it, renames it, pins one as the list
 * they open on, and deletes it.
 *
 * **Every route is scoped to `request.user.id`, and that scope rides in
 * the WHERE clause of the read itself.** A view is private (DD-019
 * clause 1), so somebody else's view id answers **404 with the same body
 * as a view that was never made** — never 403, never a refusal that
 * confirms the id is real. This is CTR-021's not-advertised convention
 * applied to a preference, and it costs nothing to hold here because
 * there is no sharing rule to reason about.
 *
 * **The guard is authentication and nothing more.** A view says nothing
 * about a record, so no role opens or closes one; the list a view is for
 * enforces its own reach (CTR-021), and a Business User who reaches no
 * contracts list simply never asks for a contracts view. Adding a role
 * check here would be a second, weaker copy of the destination's own
 * gate.
 *
 * **The config is held, not interpreted.** This module bounds its shape —
 * how many columns, how wide, how long a key — and reads nothing out of
 * it. Which column keys are real, and which sort keys the list can
 * actually order by, are the surface's own question, answered against
 * the column catalogue that surface ships (DD-019 clause 7). A view
 * naming a column the build dropped is a view the page reads past, so it
 * must not be a view this seam rejects.
 *
 * **Nothing here is narrated** (DD-017). The activity log records what
 * happened to records; how one person likes their columns is not an
 * event anybody audits, and writing one entry per column drag would bury
 * the log the audit surface reads.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq, listViews, sql, type Transaction } from "@openlaw/db";
import {
  LIST_VIEW_SURFACES,
  MAX_LIST_VIEW_NAME_LENGTH,
  MAX_LIST_VIEWS_PER_SURFACE,
  SORT_DIRECTIONS,
} from "@openlaw/shared";
import { requireAuth } from "../../auth/guards.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const NO_VIEW = "No saved view exists with this id.";
const NAME_TAKEN = "You already have a view with that name on this list.";
const TOO_MANY = `A list holds at most ${String(MAX_LIST_VIEWS_PER_SURFACE)} saved views.`;

/**
 * Postgres's unique-violation code. The name index is the authority on a
 * duplicate name rather than a read-then-write check: two saves racing
 * would both find the name free and both insert it.
 */
const UNIQUE_VIOLATION = "23505";

const ViewIdParams = z.object({ viewId: z.string().min(1).max(64) });
const SurfaceQuery = z.object({ surface: z.enum(LIST_VIEW_SURFACES) });
const NameSchema = z.string().trim().min(1).max(MAX_LIST_VIEW_NAME_LENGTH);

/**
 * One column as a view holds it: which column, and how wide.
 *
 * The key is bounded text and never checked against a list, because the
 * surface owns which keys are real. `width` accepts null for a layout
 * stored before every column carried one; the surface reads that as its
 * own default (DES-046 clause 1).
 */
const ViewColumnSchema = z.strictObject({
  key: z.string().min(1).max(64),
  width: z.int().min(48).max(1200).nullable(),
});

const ViewSortSchema = z.strictObject({
  key: z.string().min(1).max(64),
  dir: z.enum(SORT_DIRECTIONS),
});

/**
 * The whole list state (DD-019 clause 2). Strict, so a config with a key
 * this build does not know is refused at the seam rather than stored and
 * silently ignored — the read-past rule is for column keys inside these
 * arrays, not for the envelope's own shape.
 *
 * `filters` is a flat map because every surface reads its own filters:
 * contracts has two booleans (`includeArchived`, `includeEnded`), and the
 * next surface's are its own business. The values are bounded to what a
 * filter can be so nothing large rides in here.
 */
const ViewConfigSchema = z.strictObject({
  /** Shown columns, in display order. An empty list is a table with no
   * columns, so at least one is required. */
  columns: z.array(ViewColumnSchema).min(1).max(64),
  /**
   * Which column absorbs the container's spare width, or null for none —
   * in which case the spare width is trailing space (DES-046 clause 1).
   *
   * Optional, because a config stored before this field existed is still a
   * config. Never checked against a column list, for the same reason the
   * keys above are not: the surface owns which columns are real.
   */
  flexKey: z.string().min(1).max(64).nullable().optional(),
  /** The sort in force, or null for the list's natural order. */
  sort: ViewSortSchema.nullable(),
  filters: z.record(z.string().min(1).max(64), z.union([z.boolean(), z.string().max(2000)])),
});

const ViewSchema = z.object({
  id: z.string(),
  surface: z.enum(LIST_VIEW_SURFACES),
  name: z.string(),
  config: ViewConfigSchema,
  isDefault: z.boolean(),
});

const ViewsEnvelope = z.object({ views: z.array(ViewSchema) });

export const listViewsRoutes: FastifyPluginAsyncZod = async (app) => {
  const viewColumns = {
    id: listViews.id,
    surface: listViews.surface,
    name: listViews.name,
    config: listViews.config,
    isDefault: listViews.isDefault,
  } as const;

  /**
   * This person's views of one surface, in the order the menu draws
   * them: case-insensitive by name, which is the reading the unique
   * index takes too, so the menu never shows two rows that sort as one.
   */
  async function readViews(tx: Transaction, userId: string, surface: string) {
    const rows = await tx
      .select(viewColumns)
      .from(listViews)
      .where(and(eq(listViews.userId, userId), eq(listViews.surface, surface)))
      .orderBy(sql`lower(${listViews.name})`);
    return rows as z.infer<typeof ViewSchema>[];
  }

  /**
   * One of this person's views by id, or a 404.
   *
   * The owner rides beside the id in one predicate, so another person's
   * view is indistinguishable from an id that was never issued. Locked
   * when the caller is about to write, because clearing the old default
   * and setting the new one has to be one decision.
   */
  async function ownedView(
    tx: Transaction,
    userId: string,
    viewId: string,
    options: { lock?: boolean } = {},
  ) {
    const query = tx
      .select({ ...viewColumns, userId: listViews.userId })
      .from(listViews)
      .where(and(eq(listViews.id, viewId), eq(listViews.userId, userId)))
      .limit(1);
    const [row] = await (options.lock ? query.for("update") : query);
    if (!row) throw httpError(404, NO_VIEW);
    return row;
  }

  /**
   * Make this view the one its surface opens on, by clearing whatever
   * held the flag first.
   *
   * The partial unique index (`list_views_default_idx`) means the two
   * writes cannot be reordered or skipped: setting a second default
   * without clearing the first is a constraint violation, not a row that
   * quietly wins. Doing the clear here rather than trusting the caller
   * is what makes the index a backstop instead of the error path.
   */
  async function takeDefault(tx: Transaction, userId: string, surface: string, viewId: string) {
    await tx
      .update(listViews)
      .set({ isDefault: false })
      .where(
        and(
          eq(listViews.userId, userId),
          eq(listViews.surface, surface),
          eq(listViews.isDefault, true),
        ),
      );
    await tx.update(listViews).set({ isDefault: true }).where(eq(listViews.id, viewId));
  }

  /** A duplicate name arrives as a unique violation from the index, and
   * reads as a refusal the reader can act on rather than a 500. */
  function asNameConflict(error: unknown): never {
    const code = (error as { cause?: { code?: string }; code?: string } | null)?.cause?.code;
    if (code === UNIQUE_VIOLATION) throw httpError(409, NAME_TAKEN);
    throw error;
  }

  app.get(
    "/list-views",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listSavedViews",
        summary:
          "Your saved views of one list (DD-019), ordered by name. A " +
          "view is private: this answers only your own, and never " +
          "reveals that anybody else has one. At most one carries " +
          "isDefault, which is the view the list opens on; none doing " +
          "so means the list opens on its built-in layout",
        tags: ["list-views"],
        querystring: SurfaceQuery,
        response: { 200: ViewsEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => ({
        views: await readViews(tx, request.user.id, request.query.surface),
      })),
  );

  app.post(
    "/list-views",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "createSavedView",
        summary:
          "Save the list you are looking at as a named view (DD-019). " +
          "The name must be one you are not already using on this " +
          "list, compared case-insensitively — 409 if it is. Pass " +
          "isDefault to make this the view the list opens on, which " +
          "clears whichever view held that. Answers your whole view " +
          "list, so the menu needs no second read",
        tags: ["list-views"],
        body: z.strictObject({
          surface: z.enum(LIST_VIEW_SURFACES),
          name: NameSchema,
          config: ViewConfigSchema,
          isDefault: z.boolean().optional(),
        }),
        response: { 201: ViewsEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const { surface, name, config } = request.body;
      const answer = await app.db.transaction(async (tx) => {
        // Counted inside the transaction, so two saves racing at the
        // ceiling cannot both find room.
        const [count] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(listViews)
          .where(and(eq(listViews.userId, request.user.id), eq(listViews.surface, surface)));
        if ((count?.total ?? 0) >= MAX_LIST_VIEWS_PER_SURFACE) throw httpError(409, TOO_MANY);

        const [created] = await tx
          .insert(listViews)
          .values({ userId: request.user.id, surface, name, config })
          .returning({ id: listViews.id })
          .catch(asNameConflict);
        if (!created) throw httpError(500, "The view could not be saved.");

        if (request.body.isDefault === true) {
          await takeDefault(tx, request.user.id, surface, created.id);
        }
        return { views: await readViews(tx, request.user.id, surface) };
      });
      return reply.code(201).send(answer);
    },
  );

  app.patch(
    "/list-views/:viewId",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "updateSavedView",
        summary:
          "Change one of your saved views (DD-019): overwrite its " +
          "config with the list you are looking at, rename it, or make " +
          "it the view the list opens on. Every field is optional and " +
          "an omitted one is left alone. Somebody else's view id " +
          "answers 404, the same as an id that was never issued — a " +
          "view is private, and access is not advertised. isDefault " +
          "false on the view that holds it leaves the surface with no " +
          "default, which opens the built-in layout",
        tags: ["list-views"],
        params: ViewIdParams,
        body: z
          .strictObject({
            name: NameSchema.optional(),
            config: ViewConfigSchema.optional(),
            isDefault: z.boolean().optional(),
          })
          .refine((body) => Object.keys(body).length > 0, {
            message: "Name at least one thing to change.",
          }),
        response: { 200: ViewsEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const view = await ownedView(tx, request.user.id, request.params.viewId, { lock: true });
        const { name, config, isDefault } = request.body;

        if (name !== undefined || config !== undefined) {
          await tx
            .update(listViews)
            .set({
              ...(name === undefined ? {} : { name }),
              ...(config === undefined ? {} : { config }),
            })
            .where(eq(listViews.id, view.id))
            .catch(asNameConflict);
        }

        if (isDefault === true) {
          await takeDefault(tx, request.user.id, view.surface, view.id);
        } else if (isDefault === false && view.isDefault) {
          await tx.update(listViews).set({ isDefault: false }).where(eq(listViews.id, view.id));
        }

        return { views: await readViews(tx, request.user.id, view.surface) };
      }),
  );

  app.delete(
    "/list-views/:viewId",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "deleteSavedView",
        summary:
          "Delete one of your saved views (DD-019). A hard delete: a " +
          "view is a preference, not a record, so there is nothing to " +
          "keep and no archive to restore from. Deleting the default " +
          "leaves the surface with none, which opens the built-in " +
          "layout. Somebody else's view id answers 404",
        tags: ["list-views"],
        params: ViewIdParams,
        response: { 200: ViewsEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const view = await ownedView(tx, request.user.id, request.params.viewId, { lock: true });
        await tx.delete(listViews).where(eq(listViews.id, view.id));
        return { views: await readViews(tx, request.user.id, view.surface) };
      }),
  );
};
