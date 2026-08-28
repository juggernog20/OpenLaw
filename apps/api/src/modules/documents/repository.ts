// SPDX-License-Identifier: AGPL-3.0-only

/** M26's flat, reached Document repository across Contracts and Matters. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  contracts,
  desc,
  documentFolders,
  documents,
  documentVersions,
  documentVersionText,
  eq,
  isNull,
  lt,
  matters,
  or,
  sql,
  users,
  DOCUMENT_VERSION_KINDS,
  type Db,
} from "@openlaw/db";
import { documentRepositoryScope, requireDocumentReader } from "../../lib/document-access.js";
import { problemResponse } from "../../lib/problem.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const CursorSchema = z.string().min(1).max(64);

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
    kind: z.enum(["contract", "matter"]),
    number: z.int().positive(),
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

/** The highest numbered Version is current, independent of upload timestamps. */
const currentVersion = sql`${documentVersions.versionNumber} = (
  select max(current_version.version_number)
  from document_versions current_version
  where current_version.document_id = ${documents.id}
)`;

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
    .leftJoin(matters, eq(matters.id, documents.matterId));
}

type RepositoryDbRow = Awaited<ReturnType<typeof selectRepository>>[number];

function toRepositoryRow(row: RepositoryDbRow): z.infer<typeof RepositoryRowSchema> {
  const contractOwned = row.contractId !== null;
  const ownerNumber = contractOwned ? row.contractNumber : row.matterNumber;
  const ownerTitle = contractOwned ? row.contractTitle : row.matterTitle;
  if (ownerNumber === null || ownerTitle === null) {
    throw new Error(`Document ${row.id} has no readable owning record.`);
  }
  return {
    id: row.id,
    title: row.emailSubject ?? row.documentTitle,
    description: row.description,
    isConfidential: row.isConfidential,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    owner: {
      kind: contractOwned ? "contract" : "matter",
      number: ownerNumber,
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
    "/documents",
    {
      preHandler: requireDocumentReader,
      schema: {
        operationId: "listDocuments",
        summary:
          "Every live Document on a reached, live Contract or Matter, ordered by the current " +
          "Version's upload time. Closed Matters and ended Contracts remain in the list. " +
          "Confidential Documents and records are omitted before paging.",
        tags: ["documents"],
        querystring: z.object({
          cursor: CursorSchema.optional(),
          limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
        }),
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
      const scope = and(
        isNull(documents.archivedAt),
        documentRepositoryScope(app.db, request.user),
      );
      let boundary: { id: string; versionId: string } | null = null;
      if (request.query.cursor !== undefined) {
        const [cursor] = await selectRepository(app.db)
          .where(and(eq(documents.id, request.query.cursor), scope))
          .limit(1);
        if (!cursor) return { documents: [], nextCursor: null };
        boundary = { id: cursor.id, versionId: cursor.versionId };
      }
      // The boundary's upload time stays in SQL. A JS Date keeps
      // milliseconds and Postgres keeps microseconds, so a value that
      // came back through the driver would sit a fraction before the
      // real stamp and the next page would skip every row in between.
      const boundaryCreatedAt =
        boundary === null
          ? null
          : sql`(
              select boundary_version.created_at
              from document_versions boundary_version
              where boundary_version.id = ${boundary.versionId}
            )`;

      const pageSize = request.query.limit ?? DEFAULT_LIMIT;
      const rows = await selectRepository(app.db)
        .where(
          and(
            scope,
            boundary === null || boundaryCreatedAt === null
              ? undefined
              : or(
                  lt(documentVersions.createdAt, boundaryCreatedAt),
                  and(
                    eq(documentVersions.createdAt, boundaryCreatedAt),
                    lt(documents.id, boundary.id),
                  ),
                ),
          ),
        )
        .orderBy(desc(documentVersions.createdAt), desc(documents.id))
        .limit(pageSize + 1);
      const page = rows.slice(0, pageSize);
      return {
        documents: page.map(toRepositoryRow),
        nextCursor: rows.length > pageSize ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );
};
