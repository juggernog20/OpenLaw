// SPDX-License-Identifier: AGPL-3.0-only

import {
  KnowledgeListQuery,
  listKnowledgeItems,
  getKnowledgeItem,
  creators,
  project,
  readItem,
} from "./service.js";

/** M28/3's shared Knowledge library: items, managed-list reads, and folders. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  asc,
  documents,
  eq,
  isNull,
  knowledgeFolders,
  knowledgeItems,
  knowledgeTypes,
  sql,
  KNOWLEDGE_ITEM_AUDIENCES,
  KNOWLEDGE_ITEM_STATES,
  MAX_FOLDER_NAME_LENGTH,
  type Executor,
  type KnowledgeFolder,
  type KnowledgeItem,
  type Transaction,
} from "@openlaw/db";
import { type ChangedFields } from "@openlaw/shared";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { folderName } from "../documents/folders.js";
import { RENDER_FAMILIES } from "../../lib/render-family.js";

const requireMember = requireRole("administrator", "legal_team_member");
const IdSchema = z.string().min(1).max(64);
const TitleSchema = z.string().trim().min(1).max(500);
const BodySchema = z.string().max(100_000).nullable();
const FolderNameSchema = z.string().max(MAX_FOLDER_NAME_LENGTH + 2);

const PersonSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});

const ReferenceSchema = z.object({ id: z.string(), title: z.string() });
const PrimaryDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  currentVersion: z.object({
    id: z.string(),
    originalFilename: z.string(),
    mimeType: z.string(),
    renderFamily: z.enum(RENDER_FAMILIES),
  }),
});

const KnowledgeItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  knowledgeTypeId: z.string(),
  knowledgeTypeName: z.string(),
  body: z.string().nullable(),
  folderId: z.string().nullable(),
  folderName: z.string().nullable(),
  state: z.enum(KNOWLEDGE_ITEM_STATES),
  audience: z.enum(KNOWLEDGE_ITEM_AUDIENCES),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  deflectionLinkCount: z.number().int().nonnegative(),
  replacedBy: ReferenceSchema.nullable(),
  primaryDocument: PrimaryDocumentSchema.nullable(),
  documentCount: z.number().int().nonnegative(),
  createdBy: PersonSchema,
  updatedBy: PersonSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

/** A list row is the record without its guidance: a page of fifty rows
 * must not carry fifty bodies of up to 100,000 characters each. */
const KnowledgeItemSummarySchema = KnowledgeItemSchema.omit({ body: true });

const KnowledgeItemsEnvelope = z.object({
  knowledgeItems: z.array(KnowledgeItemSummarySchema),
  nextCursor: z.string().nullable(),
});

const FolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  displayOrder: z.number().int().nonnegative(),
  /** Live Knowledge Items in this folder **and its descendants** — the
   * same subtree selecting the folder lists (KNW-003), so the number
   * says what opening the folder will show. */
  itemCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
const FoldersEnvelope = z.object({ folders: z.array(FolderSchema) });

/** The type's name as the log names it. No liveness check: the item's
 * current type is a fact to narrate, not a choice to validate. */
async function typeName(db: Executor, id: string): Promise<string> {
  const [row] = await db
    .select({ displayName: knowledgeTypes.displayName })
    .from(knowledgeTypes)
    .where(eq(knowledgeTypes.id, id))
    .limit(1);
  return row?.displayName ?? id;
}

async function liveType(db: Executor, id: string) {
  const [row] = await db
    .select({ id: knowledgeTypes.id, displayName: knowledgeTypes.displayName })
    .from(knowledgeTypes)
    .where(and(eq(knowledgeTypes.id, id), isNull(knowledgeTypes.archivedAt)))
    .limit(1);
  if (!row) throw httpError(400, "The Knowledge type must be a live Knowledge type.");
  return row;
}

async function namedFolder(db: Executor, id: string | null) {
  if (id === null) return null;
  const [row] = await db
    .select({ id: knowledgeFolders.id, name: knowledgeFolders.name })
    .from(knowledgeFolders)
    .where(eq(knowledgeFolders.id, id))
    .limit(1);
  if (!row) throw httpError(400, "The folder must be a Knowledge folder.");
  return row;
}

async function lockFolders(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(733, 601)`);
}

interface FolderRow extends KnowledgeFolder {
  itemCount: number;
}

async function folderRows(db: Executor): Promise<FolderRow[]> {
  // Counted over the same subtree `listScope`'s folder filter lists:
  // selecting a folder scopes the managed list to the folder and its
  // descendants (KNW-003), so the number beside the folder must say
  // what opening it will show. A direct count would read `0` on a
  // parent whose items all sit in children.
  return db
    .select({
      id: knowledgeFolders.id,
      name: knowledgeFolders.name,
      parentId: knowledgeFolders.parentId,
      displayOrder: knowledgeFolders.displayOrder,
      createdAt: knowledgeFolders.createdAt,
      updatedAt: knowledgeFolders.updatedAt,
      itemCount: sql<number>`(
        with recursive knowledge_folder_subtree(id) as (
          select ${knowledgeFolders.id}
          union all
          select child.id
          from knowledge_folders child
          inner join knowledge_folder_subtree parent on child.parent_id = parent.id
        )
        select count(*)::int
        from knowledge_items counted_item
        where counted_item.folder_id in (select id from knowledge_folder_subtree)
          and counted_item.archived_at is null
      )`,
    })
    .from(knowledgeFolders)
    .orderBy(asc(knowledgeFolders.displayOrder), asc(knowledgeFolders.id));
}

function orderedTree(rows: FolderRow[]): FolderRow[] {
  const children = new Map<string | null, FolderRow[]>();
  for (const row of rows) {
    const siblings = children.get(row.parentId);
    if (siblings) siblings.push(row);
    else children.set(row.parentId, [row]);
  }
  const answer: FolderRow[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string | null) => {
    for (const row of children.get(parentId) ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      answer.push(row);
      visit(row.id);
    }
  };
  visit(null);
  for (const row of rows) {
    if (!seen.has(row.id)) {
      answer.push(row);
      visit(row.id);
    }
  }
  return answer;
}

function folderEnvelope(rows: FolderRow[]) {
  return {
    folders: orderedTree(rows).map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      displayOrder: row.displayOrder,
      itemCount: row.itemCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

function folderById(rows: readonly FolderRow[], id: string): FolderRow {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw httpError(404, "No Knowledge folder exists with this id.");
  return row;
}

function assertNameFree(
  rows: readonly FolderRow[],
  parentId: string | null,
  name: string,
  except?: string,
): void {
  const wanted = name.toLocaleLowerCase("en-US");
  const duplicate = rows.find(
    (row) =>
      row.parentId === parentId &&
      row.id !== except &&
      row.name.toLocaleLowerCase("en-US") === wanted,
  );
  if (duplicate) throw httpError(409, `A folder named ${name} is already here.`);
}

function assertNoCycle(
  rows: readonly FolderRow[],
  folderId: string,
  parentId: string | null,
): void {
  let at = parentId;
  for (let step = 0; at !== null && step <= rows.length; step += 1) {
    if (at === folderId) throw httpError(409, "A folder cannot be moved inside itself.");
    at = folderById(rows, at).parentId;
  }
}

/** The Document-folder tree's ceiling (DOC-011), applied at Knowledge
 * scope for the same reason: the tree is walked recursively on every
 * read, and a tree with no ceiling is one bad script away from a stack
 * overflow that turns the whole listing into a 500. */
const MAX_KNOWLEDGE_FOLDER_DEPTH = 10;

function assertFolderDepthWithin(depth: number): void {
  if (depth > MAX_KNOWLEDGE_FOLDER_DEPTH) {
    throw httpError(
      409,
      `Folders can be nested ${MAX_KNOWLEDGE_FOLDER_DEPTH} deep. Put this one higher up.`,
    );
  }
}

/** How many folders sit above this one, the folder itself included. */
function folderDepthOf(rows: readonly FolderRow[], folderId: string | null): number {
  let depth = 0;
  let at = folderId;
  for (let step = 0; at !== null && step <= rows.length; step += 1) {
    depth += 1;
    at = folderById(rows, at).parentId;
  }
  return depth;
}

/** How many levels hang beneath this folder. */
function folderHeightOf(rows: readonly FolderRow[], folderId: string): number {
  const children = rows.filter((row) => row.parentId === folderId);
  if (children.length === 0) return 0;
  return 1 + Math.max(...children.map((child) => folderHeightOf(rows, child.id)));
}

async function recordFolderActivity(
  tx: Transaction,
  actorId: string,
  entry:
    | {
        action: "knowledge_folder.created";
        payload: { folderId: string; name: string; parentName: string | null };
      }
    | {
        action: "knowledge_folder.renamed";
        payload: { folderId: string; name: string; previousName: string };
      }
    | {
        action: "knowledge_folder.moved";
        payload: { folderId: string; name: string; parentName: string | null };
      }
    | {
        action: "knowledge_folder.reordered";
        payload: { parentName: string | null; folderIds: string[] };
      }
    | {
        action: "knowledge_folder.deleted";
        payload: { folderId: string; name: string };
      },
) {
  await recordActivity(tx, {
    entityType: "system",
    actorId,
    visibility: "legal_only",
    ...entry,
  });
}

export const knowledgeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/knowledge",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listKnowledgeItems",
        summary: "The filtered, sorted, keyset-paged managed Knowledge library",
        tags: ["knowledge"],
        querystring: KnowledgeListQuery,
        response: { 200: KnowledgeItemsEnvelope, default: problemResponse },
      },
    },
    async (request) => listKnowledgeItems(app.db, request.user, request.query),
  );

  app.get(
    "/knowledge/options",
    {
      preHandler: requireMember,
      schema: {
        operationId: "getKnowledgeListOptions",
        tags: ["knowledge"],
        response: {
          200: z.object({ authors: z.array(PersonSchema) }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const rows = await app.db
        .selectDistinct({
          id: creators.id,
          displayName: creators.displayName,
          image: creators.image,
          archivedAt: creators.archivedAt,
        })
        .from(knowledgeItems)
        .innerJoin(creators, eq(knowledgeItems.createdBy, creators.id))
        .where(isNull(knowledgeItems.archivedAt))
        .orderBy(asc(creators.displayName), asc(creators.id));
      return {
        authors: rows.map((row) => ({
          id: row.id,
          displayName: row.displayName,
          image: row.image,
          archived: row.archivedAt !== null,
        })),
      };
    },
  );

  app.post(
    "/knowledge",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createKnowledgeItem",
        tags: ["knowledge"],
        body: z.strictObject({
          title: TitleSchema,
          knowledgeTypeId: IdSchema,
          folderId: IdSchema.optional(),
        }),
        response: {
          201: z.object({ knowledgeItem: KnowledgeItemSchema }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const id = await app.db.transaction(async (tx) => {
        const type = await liveType(tx, request.body.knowledgeTypeId);
        const folder = await namedFolder(tx, request.body.folderId ?? null);
        const [created] = await tx
          .insert(knowledgeItems)
          .values({
            title: request.body.title,
            knowledgeTypeId: type.id,
            folderId: folder?.id ?? null,
            createdBy: request.user.id,
            updatedBy: request.user.id,
          })
          .returning({ id: knowledgeItems.id });
        await recordActivity(tx, {
          entityType: "knowledge_item",
          entityId: created!.id,
          actorId: request.user.id,
          action: "knowledge_item.created",
          visibility: "legal_only",
          payload: {
            title: request.body.title,
            knowledgeType: type.displayName,
            folder: folder?.name ?? null,
          },
        });
        return created!.id;
      });
      return reply.status(201).send({ knowledgeItem: project((await readItem(app.db, id))!) });
    },
  );

  app.get(
    "/knowledge/:id",
    {
      preHandler: requireMember,
      schema: {
        operationId: "getKnowledgeItem",
        tags: ["knowledge"],
        params: z.object({ id: IdSchema }),
        response: {
          200: z.object({ knowledgeItem: KnowledgeItemSchema }),
          default: problemResponse,
        },
      },
    },
    async (request) => getKnowledgeItem(app.db, request.user, request.params.id),
  );

  app.patch(
    "/knowledge/:id",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateKnowledgeItem",
        tags: ["knowledge"],
        params: z.object({ id: IdSchema }),
        body: z
          .strictObject({
            title: TitleSchema.optional(),
            knowledgeTypeId: IdSchema.optional(),
            body: BodySchema.optional(),
            folderId: IdSchema.nullable().optional(),
            replacedById: IdSchema.nullable().optional(),
            primaryDocumentId: IdSchema.nullable().optional(),
            audience: z.enum(KNOWLEDGE_ITEM_AUDIENCES).optional(),
          })
          .refine((body) => Object.keys(body).length > 0, {
            message: "Name at least one field to change.",
          }),
        response: {
          200: z.object({ knowledgeItem: KnowledgeItemSchema }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        const [target] = await tx
          .select()
          .from(knowledgeItems)
          .where(eq(knowledgeItems.id, request.params.id))
          .limit(1)
          .for("update");
        if (!target) throw httpError(404, "No Knowledge Item exists with this id.");
        if (target.archivedAt)
          throw httpError(409, "Restore this Knowledge Item before editing it.");

        const patch: Partial<KnowledgeItem> = {};
        const changed: ChangedFields = {};
        if (request.body.title !== undefined && request.body.title !== target.title) {
          patch.title = request.body.title;
          changed.title = { from: target.title, to: request.body.title };
        }
        if (
          request.body.knowledgeTypeId !== undefined &&
          request.body.knowledgeTypeId !== target.knowledgeTypeId
        ) {
          const from = await typeName(tx, target.knowledgeTypeId);
          const to = await liveType(tx, request.body.knowledgeTypeId);
          patch.knowledgeTypeId = to.id;
          changed.knowledgeType = { from, to: to.displayName };
        }
        if (request.body.body !== undefined) {
          const body = request.body.body?.trim() || null;
          if (body !== target.body) {
            patch.body = body;
            changed.body = {
              from: target.body === null ? null : "Guidance",
              to: body === null ? null : "Guidance",
            };
          }
        }
        if (request.body.folderId !== undefined && request.body.folderId !== target.folderId) {
          const from = await namedFolder(tx, target.folderId);
          const to = await namedFolder(tx, request.body.folderId);
          patch.folderId = to?.id ?? null;
          changed.folder = { from: from?.name ?? null, to: to?.name ?? null };
        }
        if (
          request.body.replacedById !== undefined &&
          request.body.replacedById !== target.replacedById
        ) {
          if (request.body.replacedById === target.id) {
            throw httpError(409, "A Knowledge Item cannot replace itself.");
          }
          let to: { id: string; title: string } | null = null;
          if (request.body.replacedById !== null) {
            const [replacement] = await tx
              .select({
                id: knowledgeItems.id,
                title: knowledgeItems.title,
                archivedAt: knowledgeItems.archivedAt,
              })
              .from(knowledgeItems)
              .where(eq(knowledgeItems.id, request.body.replacedById))
              .limit(1);
            if (!replacement) throw httpError(400, "The replacement must be a Knowledge Item.");
            if (replacement.archivedAt) {
              throw httpError(409, "An archived Knowledge Item cannot be the replacement.");
            }
            to = replacement;
          }
          const from = target.replacedById
            ? await tx
                .select({ title: knowledgeItems.title })
                .from(knowledgeItems)
                .where(eq(knowledgeItems.id, target.replacedById))
                .limit(1)
            : [];
          patch.replacedById = to?.id ?? null;
          changed.replacedBy = { from: from[0]?.title ?? null, to: to?.title ?? null };
        }
        if (request.body.audience !== undefined && request.body.audience !== target.audience) {
          patch.audience = request.body.audience;
          changed.audience = { from: target.audience, to: request.body.audience };
        }
        if (
          request.body.primaryDocumentId !== undefined &&
          request.body.primaryDocumentId !== target.primaryDocumentId
        ) {
          let next: { id: string; title: string } | null = null;
          if (request.body.primaryDocumentId !== null) {
            const [owned] = await tx
              .select({ id: documents.id, title: documents.title })
              .from(documents)
              .where(
                and(
                  eq(documents.id, request.body.primaryDocumentId),
                  eq(documents.knowledgeItemId, target.id),
                  isNull(documents.archivedAt),
                ),
              )
              .limit(1);
            if (!owned) {
              throw httpError(400, "The primary Document must be a live Document this item owns.");
            }
            next = owned;
          }
          const previous = target.primaryDocumentId
            ? await tx
                .select({ title: documents.title })
                .from(documents)
                .where(eq(documents.id, target.primaryDocumentId))
                .limit(1)
            : [];
          patch.primaryDocumentId = next?.id ?? null;
          changed.primaryDocument = { from: previous[0]?.title ?? null, to: next?.title ?? null };
        }

        if (Object.keys(patch).length === 0) return;
        patch.updatedBy = request.user.id;
        const [updated] = await tx
          .update(knowledgeItems)
          .set(patch)
          .where(eq(knowledgeItems.id, target.id))
          .returning({ title: knowledgeItems.title });
        await recordActivity(tx, {
          entityType: "knowledge_item",
          entityId: target.id,
          actorId: request.user.id,
          action: "knowledge_item.updated",
          visibility: "legal_only",
          payload: { title: updated!.title, changed },
        });
      });
      return { knowledgeItem: project((await readItem(app.db, request.params.id))!) };
    },
  );

  async function lifecycleTarget(tx: Transaction, id: string) {
    const [target] = await tx
      .select()
      .from(knowledgeItems)
      .where(eq(knowledgeItems.id, id))
      .limit(1)
      .for("update");
    if (!target) throw httpError(404, "No Knowledge Item exists with this id.");
    return target;
  }

  async function replacementForArchive(tx: Transaction, itemId: string, replacementId: string) {
    if (replacementId === itemId) throw httpError(409, "A Knowledge Item cannot replace itself.");
    const [replacement] = await tx
      .select({ id: knowledgeItems.id, title: knowledgeItems.title })
      .from(knowledgeItems)
      .where(and(eq(knowledgeItems.id, replacementId), isNull(knowledgeItems.archivedAt)))
      .limit(1)
      .for("key share");
    if (!replacement) throw httpError(400, "The replacement must be a live Knowledge Item.");
    return replacement;
  }

  app.post(
    "/knowledge/:id/publish",
    {
      preHandler: requireMember,
      schema: {
        operationId: "publishKnowledgeItem",
        tags: ["knowledge"],
        params: z.object({ id: IdSchema }),
        body: z.strictObject({}),
        response: {
          200: z.object({ knowledgeItem: KnowledgeItemSchema }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        const target = await lifecycleTarget(tx, request.params.id);
        if (target.archivedAt)
          throw httpError(409, "Restore this Knowledge Item before publishing it.");
        if (target.state === "published") return;
        await tx
          .update(knowledgeItems)
          .set({ state: "published", publishedAt: new Date(), updatedBy: request.user.id })
          .where(eq(knowledgeItems.id, target.id));
        await recordActivity(tx, {
          entityType: "knowledge_item",
          entityId: target.id,
          actorId: request.user.id,
          action: "knowledge_item.published",
          visibility: "legal_only",
          payload: { title: target.title },
        });
      });
      return { knowledgeItem: project((await readItem(app.db, request.params.id))!) };
    },
  );

  app.post(
    "/knowledge/:id/unpublish",
    {
      preHandler: requireMember,
      schema: {
        operationId: "unpublishKnowledgeItem",
        tags: ["knowledge"],
        params: z.object({ id: IdSchema }),
        body: z.strictObject({}),
        response: {
          200: z.object({ knowledgeItem: KnowledgeItemSchema }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        const target = await lifecycleTarget(tx, request.params.id);
        if (target.archivedAt)
          throw httpError(409, "Restore this Knowledge Item before returning it to draft.");
        if (target.state === "draft") return;
        await tx
          .update(knowledgeItems)
          .set({ state: "draft", publishedAt: null, updatedBy: request.user.id })
          .where(eq(knowledgeItems.id, target.id));
        await recordActivity(tx, {
          entityType: "knowledge_item",
          entityId: target.id,
          actorId: request.user.id,
          action: "knowledge_item.unpublished",
          visibility: "legal_only",
          payload: { title: target.title },
        });
      });
      return { knowledgeItem: project((await readItem(app.db, request.params.id))!) };
    },
  );

  app.post(
    "/knowledge/:id/archive",
    {
      preHandler: requireMember,
      schema: {
        operationId: "archiveKnowledgeItem",
        tags: ["knowledge"],
        params: z.object({ id: IdSchema }),
        body: z.strictObject({ replacedById: IdSchema.optional() }),
        response: {
          200: z.object({ knowledgeItem: KnowledgeItemSchema }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        const target = await lifecycleTarget(tx, request.params.id);
        if (target.archivedAt) return;
        const replacement = request.body.replacedById
          ? await replacementForArchive(tx, target.id, request.body.replacedById)
          : null;
        await tx
          .update(knowledgeItems)
          .set({
            archivedAt: new Date(),
            replacedById: replacement?.id ?? null,
            updatedBy: request.user.id,
          })
          .where(eq(knowledgeItems.id, target.id));
        await recordActivity(tx, {
          entityType: "knowledge_item",
          entityId: target.id,
          actorId: request.user.id,
          action: "knowledge_item.archived",
          visibility: "legal_only",
          payload: { title: target.title, replacedBy: replacement?.title ?? null },
        });
      });
      return { knowledgeItem: project((await readItem(app.db, request.params.id))!) };
    },
  );

  app.post(
    "/knowledge/:id/restore",
    {
      preHandler: requireMember,
      schema: {
        operationId: "restoreKnowledgeItem",
        tags: ["knowledge"],
        params: z.object({ id: IdSchema }),
        body: z.strictObject({}),
        response: {
          200: z.object({ knowledgeItem: KnowledgeItemSchema }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        const target = await lifecycleTarget(tx, request.params.id);
        if (!target.archivedAt) return;
        await tx
          .update(knowledgeItems)
          .set({ archivedAt: null, updatedBy: request.user.id })
          .where(eq(knowledgeItems.id, target.id));
        await recordActivity(tx, {
          entityType: "knowledge_item",
          entityId: target.id,
          actorId: request.user.id,
          action: "knowledge_item.restored",
          visibility: "legal_only",
          payload: { title: target.title },
        });
      });
      return { knowledgeItem: project((await readItem(app.db, request.params.id))!) };
    },
  );

  app.get(
    "/knowledge/folders",
    {
      preHandler: requireMember,
      schema: {
        operationId: "listKnowledgeFolders",
        tags: ["knowledge"],
        response: { 200: FoldersEnvelope, default: problemResponse },
      },
    },
    async () => folderEnvelope(await folderRows(app.db)),
  );

  app.post(
    "/knowledge/folders",
    {
      preHandler: requireMember,
      schema: {
        operationId: "createKnowledgeFolder",
        tags: ["knowledge"],
        body: z.strictObject({ name: FolderNameSchema, parentId: IdSchema.optional() }),
        response: { 201: FoldersEnvelope, default: problemResponse },
      },
    },
    async (request, reply) => {
      const answer = await app.db.transaction(async (tx) => {
        await lockFolders(tx);
        const rows = await folderRows(tx);
        const parent = request.body.parentId ? folderById(rows, request.body.parentId) : null;
        const name = folderName(request.body.name);
        assertFolderDepthWithin(folderDepthOf(rows, parent?.id ?? null) + 1);
        assertNameFree(rows, parent?.id ?? null, name);
        const siblings = rows.filter((row) => row.parentId === (parent?.id ?? null));
        const displayOrder = siblings.reduce((max, row) => Math.max(max, row.displayOrder), -1) + 1;
        const [created] = await tx
          .insert(knowledgeFolders)
          .values({ name, parentId: parent?.id ?? null, displayOrder })
          .returning({ id: knowledgeFolders.id });
        await recordFolderActivity(tx, request.user.id, {
          action: "knowledge_folder.created",
          payload: { folderId: created!.id, name, parentName: parent?.name ?? null },
        });
        return folderEnvelope(await folderRows(tx));
      });
      return reply.status(201).send(answer);
    },
  );

  app.put(
    "/knowledge/folders/order",
    {
      preHandler: requireMember,
      schema: {
        operationId: "reorderKnowledgeFolders",
        tags: ["knowledge"],
        body: z.strictObject({ parentId: IdSchema.nullable(), ids: z.array(IdSchema).max(500) }),
        response: { 200: FoldersEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        await lockFolders(tx);
        const rows = await folderRows(tx);
        const parent = request.body.parentId ? folderById(rows, request.body.parentId) : null;
        const siblings = rows.filter((row) => row.parentId === request.body.parentId);
        const received = new Set(request.body.ids);
        if (
          received.size !== request.body.ids.length ||
          received.size !== siblings.length ||
          siblings.some((row) => !received.has(row.id))
        ) {
          throw httpError(400, "Give every sibling exactly once when reordering folders.");
        }
        for (const [displayOrder, id] of request.body.ids.entries()) {
          await tx
            .update(knowledgeFolders)
            .set({ displayOrder })
            .where(eq(knowledgeFolders.id, id));
        }
        await recordFolderActivity(tx, request.user.id, {
          action: "knowledge_folder.reordered",
          payload: { parentName: parent?.name ?? null, folderIds: request.body.ids },
        });
        return folderEnvelope(await folderRows(tx));
      }),
  );

  app.patch(
    "/knowledge/folders/:folderId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "updateKnowledgeFolder",
        tags: ["knowledge"],
        params: z.object({ folderId: IdSchema }),
        body: z
          .strictObject({
            name: FolderNameSchema.optional(),
            parentId: IdSchema.nullable().optional(),
          })
          .refine((body) => Object.keys(body).length > 0, {
            message: "Give a name to rename to, or a parent to move under.",
          }),
        response: { 200: FoldersEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        await lockFolders(tx);
        const rows = await folderRows(tx);
        const target = folderById(rows, request.params.folderId);
        const moving = request.body.parentId !== undefined;
        const parent = moving
          ? request.body.parentId
            ? folderById(rows, request.body.parentId)
            : null
          : target.parentId
            ? folderById(rows, target.parentId)
            : null;
        if (moving) {
          assertNoCycle(rows, target.id, parent?.id ?? null);
          // Where the folder lands, itself, and everything it brings.
          assertFolderDepthWithin(
            folderDepthOf(rows, parent?.id ?? null) + 1 + folderHeightOf(rows, target.id),
          );
        }
        const name = request.body.name === undefined ? target.name : folderName(request.body.name);
        assertNameFree(rows, parent?.id ?? null, name, target.id);
        const renamed = name !== target.name;
        const moved = moving && (parent?.id ?? null) !== target.parentId;
        if (renamed || moved) {
          const displayOrder = moved
            ? rows
                .filter((row) => row.parentId === (parent?.id ?? null))
                .reduce((max, row) => Math.max(max, row.displayOrder), -1) + 1
            : target.displayOrder;
          await tx
            .update(knowledgeFolders)
            .set({
              ...(renamed ? { name } : {}),
              ...(moved ? { parentId: parent?.id ?? null, displayOrder } : {}),
            })
            .where(eq(knowledgeFolders.id, target.id));
        }
        if (renamed) {
          await recordFolderActivity(tx, request.user.id, {
            action: "knowledge_folder.renamed",
            payload: { folderId: target.id, name, previousName: target.name },
          });
        }
        if (moved) {
          await recordFolderActivity(tx, request.user.id, {
            action: "knowledge_folder.moved",
            payload: { folderId: target.id, name, parentName: parent?.name ?? null },
          });
        }
        return folderEnvelope(await folderRows(tx));
      }),
  );

  app.delete(
    "/knowledge/folders/:folderId",
    {
      preHandler: requireMember,
      schema: {
        operationId: "deleteKnowledgeFolder",
        tags: ["knowledge"],
        params: z.object({ folderId: IdSchema }),
        response: { 200: FoldersEnvelope, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        await lockFolders(tx);
        const rows = await folderRows(tx);
        const target = folderById(rows, request.params.folderId);
        const parent = target.parentId ? folderById(rows, target.parentId) : null;
        const children = rows.filter((row) => row.parentId === target.id);
        for (const child of children) {
          const collision = rows.some(
            (row) =>
              row.id !== child.id &&
              row.id !== target.id &&
              row.parentId === target.parentId &&
              row.name.toLocaleLowerCase("en-US") === child.name.toLocaleLowerCase("en-US"),
          );
          if (collision) {
            throw httpError(409, "A folder with that name already exists here.");
          }
        }
        const movedItems = await tx
          .select({ id: knowledgeItems.id, title: knowledgeItems.title })
          .from(knowledgeItems)
          .where(eq(knowledgeItems.folderId, target.id));
        await tx
          .update(knowledgeFolders)
          .set({ parentId: target.parentId })
          .where(eq(knowledgeFolders.parentId, target.id));
        await tx
          .update(knowledgeItems)
          .set({ folderId: target.parentId, updatedBy: request.user.id })
          .where(eq(knowledgeItems.folderId, target.id));
        await tx.delete(knowledgeFolders).where(eq(knowledgeFolders.id, target.id));
        await recordFolderActivity(tx, request.user.id, {
          action: "knowledge_folder.deleted",
          payload: { folderId: target.id, name: target.name },
        });
        if (movedItems.length > 0) {
          await recordActivity(
            tx,
            movedItems.map((item) => ({
              entityType: "knowledge_item" as const,
              entityId: item.id,
              actorId: request.user.id,
              action: "knowledge_item.updated" as const,
              visibility: "legal_only" as const,
              payload: {
                title: item.title,
                changed: { folder: { from: target.name, to: parent?.name ?? null } },
              },
            })),
          );
        }
        return folderEnvelope(await folderRows(tx));
      }),
  );
};
