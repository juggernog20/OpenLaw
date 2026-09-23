// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import {
  alias,
  and,
  documents,
  documentVersions,
  eq,
  getTableColumns,
  isNotNull,
  isNull,
  knowledgeFolders,
  knowledgeItems,
  knowledgeTypes,
  sql,
  users,
  KNOWLEDGE_ITEM_AUDIENCES,
  KNOWLEDGE_ITEM_STATES,
  type Executor,
  type KnowledgeItem,
  type SQL,
} from "@openlaw/db";
import {
  KNOWLEDGE_LIST_SORT_KEYS,
  SORT_DIRECTIONS,
  type KnowledgeListSortKey,
  type SortDirection,
} from "@openlaw/shared";
import { httpError } from "../../lib/problem.js";
import { renderFamilySql, type RenderFamily } from "../../lib/render-family.js";
import { NO_PERMISSION, type AuthenticatedUser } from "../../auth/guards.js";
import type { Db } from "@openlaw/db";

const PAGE_SIZE = 50;
const IdSchema = z.string().min(1).max(64);
export const KnowledgeListQuery = z.object({
  type: IdSchema.optional(),
  state: z.enum(KNOWLEDGE_ITEM_STATES).optional(),
  audience: z.enum(KNOWLEDGE_ITEM_AUDIENCES).optional(),
  folder: IdSchema.optional(),
  author: IdSchema.optional(),
  format: z.enum(["pdf", "word", "powerpoint", "image", "email", "other"]).optional(),
  sort: z.enum(KNOWLEDGE_LIST_SORT_KEYS).optional(),
  dir: z.enum(SORT_DIRECTIONS).optional(),
  cursor: IdSchema.optional(),
});
export const creators = alias(users, "knowledge_item_creators");
const editors = alias(users, "knowledge_item_editors");
const replacements = alias(knowledgeItems, "knowledge_item_replacements");
const primaryDocuments = alias(documents, "knowledge_item_primary_documents");
const primaryVersions = alias(documentVersions, "knowledge_item_primary_versions");
const primaryVersionIsCurrent = sql`${primaryVersions.versionNumber} = (
  select max(current_primary_version.version_number)
  from document_versions current_primary_version
  where current_primary_version.document_id = ${primaryDocuments.id}
)`;

function withoutBody<T extends { body: unknown }>({ body: _body, ...rest }: T): Omit<T, "body"> {
  void _body;
  return rest;
}

/** The record's own columns, with or without the guidance body. */
const itemColumns = {
  full: getTableColumns(knowledgeItems),
  summary: withoutBody(getTableColumns(knowledgeItems)),
} as const;

function itemProjection<S extends keyof typeof itemColumns>(shape: S) {
  return {
    item: itemColumns[shape],
    knowledgeTypeName: knowledgeTypes.displayName,
    folderName: knowledgeFolders.name,
    replacementId: replacements.id,
    replacementTitle: replacements.title,
    primaryDocumentId: primaryDocuments.id,
    primaryDocumentTitle: primaryDocuments.title,
    primaryVersionId: primaryVersions.id,
    primaryOriginalFilename: primaryVersions.originalFilename,
    primaryMimeType: primaryVersions.mimeType,
    primaryRenderFamily: renderFamilySql(
      primaryVersions.mimeType,
      primaryVersions.originalFilename,
    ),
    documentCount: sql<number>`(
      select count(*)::int from documents counted_document
      where counted_document.knowledge_item_id = ${knowledgeItems.id}
        and counted_document.archived_at is null
    )`,
    deflectionLinkCount: sql<number>`(
      select count(*)::int from intake_links counted_link
      where counted_link.knowledge_item_id = ${knowledgeItems.id}
    )`,
    createdBy: {
      id: creators.id,
      displayName: creators.displayName,
      image: creators.image,
      archivedAt: creators.archivedAt,
    },
    updatedBy: {
      id: editors.id,
      displayName: editors.displayName,
      image: editors.image,
      archivedAt: editors.archivedAt,
    },
  } as const;
}

type ProjectedItem = {
  item: Omit<KnowledgeItem, "body"> & { body?: string | null };
  knowledgeTypeName: string;
  folderName: string | null;
  replacementId: string | null;
  replacementTitle: string | null;
  primaryDocumentId: string | null;
  primaryDocumentTitle: string | null;
  primaryVersionId: string | null;
  primaryOriginalFilename: string | null;
  primaryMimeType: string | null;
  primaryRenderFamily: RenderFamily;
  documentCount: number;
  deflectionLinkCount: number;
  createdBy: { id: string; displayName: string; image: string | null; archivedAt: Date | null };
  updatedBy: { id: string; displayName: string; image: string | null; archivedAt: Date | null };
};

function summarize(row: ProjectedItem) {
  return {
    id: row.item.id,
    title: row.item.title,
    knowledgeTypeId: row.item.knowledgeTypeId,
    knowledgeTypeName: row.knowledgeTypeName,
    folderId: row.item.folderId,
    folderName: row.folderName,
    state: row.item.state,
    audience: row.item.audience,
    publishedAt: row.item.publishedAt?.toISOString() ?? null,
    archivedAt: row.item.archivedAt?.toISOString() ?? null,
    deflectionLinkCount: row.deflectionLinkCount,
    replacedBy:
      row.replacementId && row.replacementTitle
        ? { id: row.replacementId, title: row.replacementTitle }
        : null,
    primaryDocument:
      row.primaryDocumentId &&
      row.primaryDocumentTitle &&
      row.primaryVersionId &&
      row.primaryOriginalFilename &&
      row.primaryMimeType
        ? {
            id: row.primaryDocumentId,
            title: row.primaryDocumentTitle,
            currentVersion: {
              id: row.primaryVersionId,
              originalFilename: row.primaryOriginalFilename,
              mimeType: row.primaryMimeType,
              renderFamily: row.primaryRenderFamily,
            },
          }
        : null,
    documentCount: row.documentCount,
    createdBy: {
      id: row.createdBy.id,
      displayName: row.createdBy.displayName,
      image: row.createdBy.image,
      archived: row.createdBy.archivedAt !== null,
    },
    updatedBy: {
      id: row.updatedBy.id,
      displayName: row.updatedBy.displayName,
      image: row.updatedBy.image,
      archived: row.updatedBy.archivedAt !== null,
    },
    createdAt: row.item.createdAt.toISOString(),
    updatedAt: row.item.updatedAt.toISOString(),
  };
}

export function project(row: ProjectedItem) {
  return { ...summarize(row), body: row.item.body ?? null };
}

function itemSelect<S extends keyof typeof itemColumns = "full">(
  db: Executor,
  shape: S = "full" as S,
) {
  return db
    .select(itemProjection(shape))
    .from(knowledgeItems)
    .innerJoin(knowledgeTypes, eq(knowledgeItems.knowledgeTypeId, knowledgeTypes.id))
    .leftJoin(knowledgeFolders, eq(knowledgeItems.folderId, knowledgeFolders.id))
    .innerJoin(creators, eq(knowledgeItems.createdBy, creators.id))
    .innerJoin(editors, eq(knowledgeItems.updatedBy, editors.id))
    .leftJoin(replacements, eq(knowledgeItems.replacedById, replacements.id))
    .leftJoin(primaryDocuments, eq(knowledgeItems.primaryDocumentId, primaryDocuments.id))
    .leftJoin(
      primaryVersions,
      and(eq(primaryVersions.documentId, primaryDocuments.id), primaryVersionIsCurrent),
    );
}

export async function readItem(db: Executor, id: string): Promise<ProjectedItem | null> {
  const [row] = await itemSelect(db).where(eq(knowledgeItems.id, id)).limit(1);
  return row ?? null;
}

interface ListFilters {
  type?: string;
  state?: (typeof KNOWLEDGE_ITEM_STATES)[number];
  audience?: (typeof KNOWLEDGE_ITEM_AUDIENCES)[number];
  folder?: string;
  author?: string;
  format?: "pdf" | "word" | "powerpoint" | "image" | "email" | "other";
}

function listScope(filters: ListFilters): SQL | undefined {
  return and(
    isNull(knowledgeItems.archivedAt),
    filters.type ? eq(knowledgeItems.knowledgeTypeId, filters.type) : undefined,
    filters.state ? eq(knowledgeItems.state, filters.state) : undefined,
    filters.audience ? eq(knowledgeItems.audience, filters.audience) : undefined,
    filters.author ? eq(knowledgeItems.createdBy, filters.author) : undefined,
    // An item with no primary Document has no format: `other` names a
    // primary the table does not preview, not the absence of one.
    filters.format
      ? and(
          isNotNull(primaryVersions.id),
          eq(
            sql<string>`replace(${renderFamilySql(
              primaryVersions.mimeType,
              primaryVersions.originalFilename,
            )}, 'presentation', 'powerpoint')`,
            filters.format,
          ),
        )
      : undefined,
    filters.folder
      ? sql`${knowledgeItems.folderId} in (
          with recursive knowledge_folder_tree(id) as (
            select ${knowledgeFolders.id}
            from ${knowledgeFolders}
            where ${knowledgeFolders.id} = ${filters.folder}
            union all
            select child.id
            from ${knowledgeFolders} child
            inner join knowledge_folder_tree parent on child.parent_id = parent.id
          )
          select id from knowledge_folder_tree
        )`
      : undefined,
  );
}

const SORTS: Record<KnowledgeListSortKey, SQL> = {
  title: sql`lower(${knowledgeItems.title})`,
  type: sql`lower(${knowledgeTypes.displayName})`,
  state: sql`${knowledgeItems.state}`,
  audience: sql`${knowledgeItems.audience}`,
  folder: sql`lower(${knowledgeFolders.name})`,
  author: sql`lower(${creators.displayName})`,
  created: sql`${knowledgeItems.createdAt}`,
  updated: sql`${knowledgeItems.updatedAt}`,
};

interface SortRequest {
  key: KnowledgeListSortKey;
  dir: SortDirection;
}

function orderFor(sort: SortRequest): SQL[] {
  return [sql`${SORTS[sort.key]} ${sql.raw(sort.dir)} nulls last`, sql`${knowledgeItems.id} asc`];
}

function sortValue(row: ProjectedItem, key: KnowledgeListSortKey): string | Date | null {
  switch (key) {
    case "title":
      return row.item.title.toLowerCase();
    case "type":
      return row.knowledgeTypeName.toLowerCase();
    case "state":
      return row.item.state;
    case "audience":
      return row.item.audience;
    case "folder":
      return row.folderName?.toLowerCase() ?? null;
    case "author":
      return row.createdBy.displayName.toLowerCase();
    case "created":
      return row.item.createdAt;
    case "updated":
      return row.item.updatedAt;
  }
}

function afterCursor(sort: SortRequest, cursor: ProjectedItem): SQL {
  const expression = SORTS[sort.key];
  const value = sortValue(cursor, sort.key);
  if (value === null) {
    return sql`${expression} is null and ${knowledgeItems.id} > ${cursor.item.id}`;
  }
  const later = sql.raw(sort.dir === "asc" ? ">" : "<");
  return sql`(
    ${expression} is null
    or ${expression} ${later} ${value}
    or (${expression} = ${value} and ${knowledgeItems.id} > ${cursor.item.id})
  )`;
}

function assertReader(user: AuthenticatedUser): void {
  if (user.role !== "administrator" && user.role !== "legal_team_member")
    throw httpError(403, NO_PERMISSION);
}
export async function listKnowledgeItems(
  db: Db,
  user: AuthenticatedUser,
  input: z.input<typeof KnowledgeListQuery> = {},
) {
  assertReader(user);
  const query = KnowledgeListQuery.parse(input);
  const filters = query;
  const sort: SortRequest = {
    key: query.sort ?? "updated",
    dir: query.dir ?? "desc",
  };
  let cursorRow: ProjectedItem | null = null;
  if (query.cursor) {
    const [row] = await itemSelect(db, "summary")
      .where(and(eq(knowledgeItems.id, query.cursor), listScope(filters)))
      .limit(1);
    if (!row) return { knowledgeItems: [], nextCursor: null };
    cursorRow = row;
  }
  const rows = await itemSelect(db, "summary")
    .where(and(listScope(filters), cursorRow ? afterCursor(sort, cursorRow) : undefined))
    .orderBy(...orderFor(sort))
    .limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  return {
    knowledgeItems: page.map(summarize),
    nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.item.id ?? null) : null,
  };
}
export async function getKnowledgeItem(db: Db, user: AuthenticatedUser, id: string) {
  assertReader(user);
  const row = await readItem(db, id);
  if (!row) throw httpError(404, "No Knowledge Item exists with this id.");
  return { knowledgeItem: project(row) };
}

/** Every signed-in role reads the same published, Everyone, live items on the Portal. */
export function portalKnowledgeScope(_db: Executor, _user: AuthenticatedUser): SQL {
  void _db;
  void _user;
  return and(
    eq(knowledgeItems.state, "published"),
    eq(knowledgeItems.audience, "everyone"),
    isNull(knowledgeItems.archivedAt),
  )!;
}
export async function readPortalKnowledgeItem(db: Executor, user: AuthenticatedUser, id: string) {
  const [item] = await db
    .select({
      id: knowledgeItems.id,
      title: knowledgeItems.title,
      body: knowledgeItems.body,
      primaryDocumentId: knowledgeItems.primaryDocumentId,
    })
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, id), portalKnowledgeScope(db, user)))
    .limit(1);
  return item ?? null;
}
