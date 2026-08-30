// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Documents destination's flat, reached repository across Contracts and
 * Matters (DOC-002), filtered on standard Document properties only (DOC-007)
 * under the DD-014 reach gate. Built in M26.
 */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  counterparties,
  contracts,
  contractCounterparties,
  documentFolders,
  documents,
  documentVersions,
  documentVersionText,
  eq,
  entities,
  gte,
  isNotNull,
  isNull,
  knowledgeItems,
  lt,
  matters,
  or,
  sql,
  users,
  DOCUMENT_VERSION_KINDS,
  type Db,
  type SQL,
} from "@openlaw/db";
import {
  DOCUMENT_OWNER_KINDS,
  SORT_DIRECTIONS,
  resolveDocumentOwner,
  type DocumentOwner,
  type SortDirection,
} from "@openlaw/shared";
import { documentRepositoryScope, requireDocumentReader } from "../../lib/document-access.js";
import { problemResponse } from "../../lib/problem.js";
import { renderFamilySql } from "../../lib/render-family.js";
import {
  documentOwnerCase,
  documentOwnerReferenceSql,
  documentOwnerFilterValueSql,
  documentOwnerSql,
  parseDocumentOwnerReference,
} from "./owner.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const CursorSchema = z.string().min(1).max(64);
const DOCUMENT_FORMATS = ["pdf", "word", "powerpoint", "image", "email", "other"] as const;
const DOCUMENT_SORT_KEYS = [
  "title",
  "owner",
  "kind",
  "format",
  "size",
  "uploader",
  "uploaded",
] as const;
type DocumentSortKey = (typeof DOCUMENT_SORT_KEYS)[number];
interface SortRequest {
  key: DocumentSortKey;
  dir: SortDirection;
}

/**
 * One owning record. A C- or M- reference names a Contract or Matter by
 * number; anything else is an opaque Entity id. A value that starts like a
 * numbered reference but is not one is refused rather than tried as an id,
 * so a bad number never reaches the query as NaN.
 */
const RecordReferenceSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) =>
      !/^[CM]-/.test(value) ||
      (/^[CM]-[1-9]\d*$/.test(value) && BigInt(value.slice(2)) <= 2_147_483_647n),
    "Record must be a C- or M- reference within range, or an Entity or Knowledge item id.",
  );

const RepositoryQuerySchema = z
  .object({
    owner: z.enum(DOCUMENT_OWNER_KINDS).optional(),
    record: RecordReferenceSchema.optional(),
    folder: z.string().min(1).max(64).optional(),
    counterparty: z.string().min(1).max(64).optional(),
    uploader: z.string().min(1).max(64).optional(),
    format: z.enum(DOCUMENT_FORMATS).optional(),
    kind: z.enum(DOCUMENT_VERSION_KINDS).optional(),
    uploadedFrom: z.iso.date().optional(),
    uploadedTo: z.iso.date().optional(),
    includeArchived: z.enum(["true", "false"]).optional(),
    sort: z.enum(DOCUMENT_SORT_KEYS).optional(),
    dir: z.enum(SORT_DIRECTIONS).optional(),
    cursor: CursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  })
  .superRefine((query, context) => {
    if (query.folder !== undefined && query.record === undefined) {
      context.addIssue({
        code: "custom",
        path: ["folder"],
        message: "Folder requires a record filter.",
      });
    }
    if (query.folder !== undefined && query.owner === "knowledge_item") {
      context.addIssue({
        code: "custom",
        path: ["folder"],
        message: "Knowledge item Documents do not have Document folders.",
      });
    }
  });

const PersonSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  image: z.string().nullable(),
  archived: z.boolean(),
});

const RepositoryRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  isConfidential: z.boolean(),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
  owner: z.object({
    kind: z.enum(DOCUMENT_OWNER_KINDS),
    id: z.string(),
    number: z.int().positive().nullable(),
    reference: z.string(),
    title: z.string(),
  }),
  folder: z.object({ id: z.string(), name: z.string() }).nullable(),
  currentVersion: z.object({
    id: z.string(),
    versionNumber: z.int().positive(),
    kind: z.enum(DOCUMENT_VERSION_KINDS),
    originalFilename: z.string(),
    mimeType: z.string(),
    byteSize: z.int().nonnegative(),
    uploadedBy: PersonSchema,
    createdAt: z.iso.datetime({ offset: true }),
  }),
  versionCount: z.int().positive(),
});

const CounterpartyOptionSchema = z.object({ id: z.string(), name: z.string() });
const RecordOptionSchema = z.object({
  reference: RecordReferenceSchema,
  kind: z.enum(DOCUMENT_OWNER_KINDS),
  number: z.int().positive().nullable(),
  title: z.string(),
});
const RepositoryOptionsSchema = z.object({
  counterparties: z.array(CounterpartyOptionSchema),
  uploaders: z.array(PersonSchema),
  records: z.array(RecordOptionSchema),
});

/** The highest numbered Version is current, independent of upload timestamps. */
const currentVersion = sql`${documentVersions.versionNumber} = (
  select max(current_version.version_number)
  from document_versions current_version
  where current_version.document_id = ${documents.id}
)`;

const ownerReference = documentOwnerReferenceSql(true);
const repositoryFormat = sql<string>`replace(
  ${renderFamilySql(documentVersions.mimeType, documentVersions.originalFilename)},
  'presentation',
  'powerpoint'
)`;
const repositoryTitle = sql<string>`lower(coalesce(${documentVersionText.emailSubject}, ${documents.title}))`;
const recordKind = documentOwnerCase<DocumentOwner>((owner) => owner.kindSql);
const recordNumber = documentOwnerCase((owner) => sql<number>`${owner.number}`);
const recordTitle = documentOwnerCase((owner) => sql<string>`${owner.title}`);
const recordReference = documentOwnerFilterValueSql();

const SORTS: Record<DocumentSortKey, SQL> = {
  title: repositoryTitle,
  owner: ownerReference,
  kind: sql`${documentVersions.kind}`,
  format: repositoryFormat,
  size: sql`${documentVersions.byteSize}`,
  uploader: sql`lower(${users.displayName})`,
  uploaded: sql`${documentVersions.createdAt}`,
};

function listOrder(sort: SortRequest | null): SQL[] {
  const primary = sort ? SORTS[sort.key] : sql`${documentVersions.createdAt}`;
  const direction = sort?.dir ?? "desc";
  return [
    sql`${primary} ${sql.raw(direction === "asc" ? "asc" : "desc")}`,
    sql`${ownerReference} desc`,
    sql`${documents.id} desc`,
  ];
}

function boundaryValue(expression: SQL, cursor: string, scope: SQL | undefined): SQL {
  return sql`(
    select ${expression}
    from ${documents}
    inner join ${documentVersions}
      on ${and(eq(documentVersions.documentId, documents.id), currentVersion)}
    inner join ${users} on ${users.id} = ${documentVersions.createdBy}
    left join ${documentVersionText} on ${documentVersionText.versionId} = ${documentVersions.id}
    left join ${contracts} on ${contracts.id} = ${documents.contractId}
    left join ${matters} on ${matters.id} = ${documents.matterId}
    left join ${entities} on ${entities.id} = ${documents.entityId}
    left join ${knowledgeItems} on ${knowledgeItems.id} = ${documents.knowledgeItemId}
    where ${and(eq(documents.id, cursor), scope)}
    limit 1
  )`;
}

function furtherDownThan(cursor: string, scope: SQL | undefined, sort: SortRequest | null): SQL {
  const primary = sort ? SORTS[sort.key] : sql`${documentVersions.createdAt}`;
  const value = boundaryValue(primary, cursor, scope);
  const atOwner = boundaryValue(ownerReference, cursor, scope);
  const atId = boundaryValue(sql`${documents.id}`, cursor, scope);
  const later = sql.raw((sort?.dir ?? "desc") === "asc" ? ">" : "<");
  return sql`(
    ${primary} ${later} ${value}
    or (
      ${primary} = ${value}
      and (
        ${ownerReference} < ${atOwner}
        or (${ownerReference} = ${atOwner} and ${documents.id} < ${atId})
      )
    )
  )`;
}

function recordPredicate(reference: string | undefined, owner?: DocumentOwner): SQL | undefined {
  if (!reference) return undefined;
  const parsed = parseDocumentOwnerReference(reference, owner);
  if ("id" in parsed && owner === undefined) {
    return or(
      sql`${documentOwnerSql("entity").documentOwnerId} = ${parsed.id}`,
      sql`${documentOwnerSql("knowledge_item").documentOwnerId} = ${parsed.id}`,
    );
  }
  return "id" in parsed
    ? sql`${parsed.owner.documentOwnerId} = ${parsed.id}`
    : and(
        sql`${parsed.owner.documentOwnerId} = ${parsed.owner.recordId}`,
        sql`${parsed.owner.number} = ${parsed.number}`,
      );
}

function counterpartyPredicate(counterpartyId: string | undefined): SQL | undefined {
  if (!counterpartyId) return undefined;
  return sql`exists (
    select 1
    from ${contractCounterparties}
    where ${contractCounterparties.contractId} = ${documents.contractId}
      and ${contractCounterparties.counterpartyId} = ${counterpartyId}
  )`;
}

function repositoryScope(
  db: Db,
  user: Parameters<typeof documentRepositoryScope>[1],
  includeArchived = false,
): SQL {
  return and(
    includeArchived ? undefined : isNull(documents.archivedAt),
    documentRepositoryScope(db, user),
  )!;
}

function selectRepository(db: Db) {
  return db
    .select({
      id: documents.id,
      documentTitle: documents.title,
      emailSubject: documentVersionText.emailSubject,
      description: documents.description,
      isConfidential: documents.isConfidential,
      archivedAt: documents.archivedAt,
      contractId: documents.contractId,
      contractNumber: contracts.number,
      contractTitle: contracts.title,
      matterId: documents.matterId,
      matterNumber: matters.number,
      matterTitle: matters.title,
      entityId: documents.entityId,
      entityTitle: entities.legalName,
      knowledgeItemId: documents.knowledgeItemId,
      knowledgeItemTitle: knowledgeItems.title,
      folderId: documentFolders.id,
      folderName: documentFolders.name,
      versionId: documentVersions.id,
      versionNumber: documentVersions.versionNumber,
      versionKind: documentVersions.kind,
      originalFilename: documentVersions.originalFilename,
      mimeType: documentVersions.mimeType,
      byteSize: documentVersions.byteSize,
      versionCreatedAt: documentVersions.createdAt,
      uploaderId: users.id,
      uploaderName: users.displayName,
      uploaderImage: users.image,
      uploaderArchivedAt: users.archivedAt,
      versionCount: sql<number>`(
        select count(*)::int
        from document_versions counted_version
        where counted_version.document_id = ${documents.id}
      )`,
    })
    .from(documents)
    .innerJoin(documentVersions, and(eq(documentVersions.documentId, documents.id), currentVersion))
    .innerJoin(users, eq(users.id, documentVersions.createdBy))
    .leftJoin(documentVersionText, eq(documentVersionText.versionId, documentVersions.id))
    .leftJoin(documentFolders, eq(documentFolders.id, documents.folderId))
    .leftJoin(contracts, eq(contracts.id, documents.contractId))
    .leftJoin(matters, eq(matters.id, documents.matterId))
    .leftJoin(entities, eq(entities.id, documents.entityId))
    .leftJoin(knowledgeItems, eq(knowledgeItems.id, documents.knowledgeItemId));
}

type RepositoryDbRow = Awaited<ReturnType<typeof selectRepository>>[number];

function toRepositoryRow(row: RepositoryDbRow): z.infer<typeof RepositoryRowSchema> {
  const owner = resolveDocumentOwner({
    contract: row.contractId,
    matter: row.matterId,
    entity: row.entityId,
    knowledge_item: row.knowledgeItemId,
  });
  let ownerNumber: number | null;
  let ownerTitle: string | null;
  switch (owner.kind) {
    case "contract":
      ownerNumber = row.contractNumber;
      ownerTitle = row.contractTitle;
      break;
    case "matter":
      ownerNumber = row.matterNumber;
      ownerTitle = row.matterTitle;
      break;
    case "entity":
      ownerNumber = null;
      ownerTitle = row.entityTitle;
      break;
    case "knowledge_item":
      ownerNumber = null;
      ownerTitle = row.knowledgeItemTitle;
      break;
  }
  if (ownerTitle === null) {
    throw new Error(`Document ${row.id} has no readable owning record.`);
  }
  return {
    id: row.id,
    title: row.emailSubject ?? row.documentTitle,
    description: row.description,
    isConfidential: row.isConfidential,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    owner: {
      kind: owner.kind,
      id: owner.value,
      number: ownerNumber,
      reference:
        ownerNumber === null
          ? ownerTitle
          : `${owner.kind === "contract" ? "C" : "M"}-${ownerNumber}`,
      title: ownerTitle,
    },
    folder:
      row.folderId === null || row.folderName === null
        ? null
        : { id: row.folderId, name: row.folderName },
    currentVersion: {
      id: row.versionId,
      versionNumber: row.versionNumber,
      kind: row.versionKind,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      uploadedBy: {
        id: row.uploaderId,
        displayName: row.uploaderName,
        image: row.uploaderImage,
        archived: row.uploaderArchivedAt !== null,
      },
      createdAt: row.versionCreatedAt.toISOString(),
    },
    versionCount: row.versionCount,
  };
}

export const documentRepositoryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/documents/options",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "listDocumentOptions",
        summary:
          "The records, Counterparties, and current-Version uploaders carried by at least one " +
          "live Document the viewer can reach.",
        tags: ["documents"],
        response: { 200: RepositoryOptionsSchema, default: problemResponse },
      },
    },
    async (request) => {
      const scope = repositoryScope(app.db, request.user);
      const repositoryOwners = () =>
        app.db
          .selectDistinct({
            reference: recordReference,
            kind: recordKind,
            number: recordNumber,
            title: recordTitle,
          })
          .from(documents)
          .innerJoin(
            documentVersions,
            and(eq(documentVersions.documentId, documents.id), currentVersion),
          )
          .leftJoin(contracts, eq(contracts.id, documents.contractId))
          .leftJoin(matters, eq(matters.id, documents.matterId))
          .leftJoin(entities, eq(entities.id, documents.entityId))
          .leftJoin(knowledgeItems, eq(knowledgeItems.id, documents.knowledgeItemId))
          .where(scope)
          .orderBy(recordKind, recordNumber);
      const repositoryCounterparties = () =>
        app.db
          .selectDistinct({ id: counterparties.id, name: counterparties.name })
          .from(documents)
          .innerJoin(
            documentVersions,
            and(eq(documentVersions.documentId, documents.id), currentVersion),
          )
          .innerJoin(
            contractCounterparties,
            eq(contractCounterparties.contractId, documents.contractId),
          )
          .innerJoin(counterparties, eq(counterparties.id, contractCounterparties.counterpartyId))
          .leftJoin(contracts, eq(contracts.id, documents.contractId))
          .leftJoin(matters, eq(matters.id, documents.matterId))
          .leftJoin(entities, eq(entities.id, documents.entityId))
          .leftJoin(knowledgeItems, eq(knowledgeItems.id, documents.knowledgeItemId))
          .where(scope)
          .orderBy(counterparties.name, counterparties.id);
      const repositoryUploaders = () =>
        app.db
          .selectDistinct({
            id: users.id,
            displayName: users.displayName,
            image: users.image,
            archivedAt: users.archivedAt,
          })
          .from(documents)
          .innerJoin(
            documentVersions,
            and(eq(documentVersions.documentId, documents.id), currentVersion),
          )
          .innerJoin(users, eq(users.id, documentVersions.createdBy))
          .leftJoin(contracts, eq(contracts.id, documents.contractId))
          .leftJoin(matters, eq(matters.id, documents.matterId))
          .leftJoin(entities, eq(entities.id, documents.entityId))
          .leftJoin(knowledgeItems, eq(knowledgeItems.id, documents.knowledgeItemId))
          .where(scope)
          .orderBy(users.displayName, users.id);

      const [partyRows, uploaderRows, records] = await Promise.all([
        repositoryCounterparties(),
        repositoryUploaders(),
        repositoryOwners(),
      ]);
      return {
        counterparties: partyRows,
        uploaders: uploaderRows.map((uploader) => ({
          id: uploader.id,
          displayName: uploader.displayName,
          image: uploader.image,
          archived: uploader.archivedAt !== null,
        })),
        records,
      };
    },
  );

  app.get(
    "/documents",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "listDocuments",
        summary:
          "Every Document on a reached, live Contract or Matter, ordered by the current " +
          "Version's upload time. Archived Documents join live ones with includeArchived=true. " +
          "Closed Matters and ended Contracts remain in the list. Confidential Documents and " +
          "records are omitted before paging.",
        tags: ["documents"],
        querystring: RepositoryQuerySchema,
        response: {
          200: z.object({
            documents: z.array(RepositoryRowSchema),
            nextCursor: z.string().nullable(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const sort: SortRequest | null = request.query.sort
        ? { key: request.query.sort, dir: request.query.dir ?? "asc" }
        : null;
      const scope = repositoryScope(app.db, request.user, request.query.includeArchived === "true");

      const pageSize = request.query.limit ?? DEFAULT_LIMIT;
      const rows = await selectRepository(app.db)
        .where(
          and(
            scope,
            request.query.owner === undefined
              ? undefined
              : isNotNull(documentOwnerSql(request.query.owner).documentOwnerId),
            recordPredicate(request.query.record, request.query.owner),
            counterpartyPredicate(request.query.counterparty),
            request.query.uploader
              ? eq(documentVersions.createdBy, request.query.uploader)
              : undefined,
            request.query.folder === "root"
              ? isNull(documents.folderId)
              : request.query.folder
                ? eq(documents.folderId, request.query.folder)
                : undefined,
            request.query.format ? eq(repositoryFormat, request.query.format) : undefined,
            request.query.kind ? eq(documentVersions.kind, request.query.kind) : undefined,
            request.query.uploadedFrom
              ? gte(documentVersions.createdAt, sql`${request.query.uploadedFrom}::date`)
              : undefined,
            request.query.uploadedTo
              ? lt(
                  documentVersions.createdAt,
                  sql`(${request.query.uploadedTo}::date + interval '1 day')`,
                )
              : undefined,
            request.query.cursor ? furtherDownThan(request.query.cursor, scope, sort) : undefined,
          ),
        )
        .orderBy(...listOrder(sort))
        .limit(pageSize + 1);
      const page = rows.slice(0, pageSize);
      return {
        documents: page.map(toRepositoryRow),
        nextCursor: rows.length > pageSize ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );
};
