// SPDX-License-Identifier: AGPL-3.0-only

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  DOCUMENT_VERSION_KINDS,
  and,
  contracts,
  desc,
  documents,
  documentVersions,
  eq,
  inArray,
  isNull,
  lt,
  matters,
  or,
  sql,
  users,
} from "@openlaw/db";
import { requireAuth } from "../../auth/guards.js";
import { documentAudienceScope } from "../../lib/contract-access.js";
import { portalRecordScope } from "../../lib/portal-record-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { renderFamilyOf, RENDER_FAMILIES } from "../../lib/render-family.js";

const Version = z.object({
  id: z.string(),
  versionNumber: z.int().positive(),
  originalFilename: z.string(),
  mimeType: z.string(),
  byteSize: z.number(),
  renderFamily: z.enum(RENDER_FAMILIES),
  kind: z.enum(DOCUMENT_VERSION_KINDS),
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
  uploadedBy: z.object({ id: z.string(), displayName: z.string(), image: z.string().nullable() }),
  isCurrent: z.boolean(),
  isExecuted: z.boolean(),
});
const Document = z.object({
  id: z.string(),
  title: z.string(),
  isPrimary: z.boolean(),
  versions: z.array(Version),
});

export const portalDocumentRoutes: FastifyPluginAsyncZod = async (app) => {
  for (const module of ["contract", "matter"] as const) {
    const table = module === "contract" ? contracts : matters;
    app.get(
      `/portal/${module}s/:number/documents`,
      {
        preHandler: requireAuth,
        schema: {
          operationId: `listPortal${module === "contract" ? "Contract" : "Matter"}Documents`,
          tags: ["portal"],
          params: z.object({ number: z.coerce.number().int().positive() }),
          querystring: z.object({
            cursor: z.string().optional(),
            q: z.string().trim().max(200).optional(),
          }),
          response: {
            200: z.object({ documents: z.array(Document), nextCursor: z.string().nullable() }),
            default: problemResponse,
          },
        },
      },
      async (request, reply) => {
        reply.header("cache-control", "private, no-store");
        const [record] = await app.db
          .select({
            id: table.id,
            primaryDocumentId:
              module === "contract" ? contracts.primaryDocumentId : sql<string | null>`null`,
          })
          .from(table)
          .where(
            and(
              eq(table.number, request.params.number),
              portalRecordScope(app.db, request.user, module),
            ),
          )
          .limit(1);
        if (!record) throw httpError(404, `No ${module} exists with this number.`);
        const primaryRank =
          sql<number>`case when ${documents.id} = ${record.primaryDocumentId} then 1 else 0 end`.mapWith(
            Number,
          );
        const scope = and(
          eq(module === "contract" ? documents.contractId : documents.matterId, record.id),
          isNull(documents.archivedAt),
          documentAudienceScope(app.db, request.user),
          request.query.q
            ? or(
                sql`position(lower(${request.query.q}) in lower(${documents.title})) > 0`,
                sql`exists (select 1 from ${documentVersions} where ${documentVersions.documentId} = ${documents.id} and position(lower(${request.query.q}) in lower(${documentVersions.originalFilename})) > 0)`,
              )
            : undefined,
        );
        let boundary;
        if (request.query.cursor) {
          const [cursor] = await app.db
            .select({ id: documents.id, rank: primaryRank })
            .from(documents)
            .where(and(scope, eq(documents.id, request.query.cursor)))
            .limit(1);
          if (!cursor) return { documents: [], nextCursor: null };
          boundary = or(
            lt(primaryRank, cursor.rank),
            and(eq(primaryRank, cursor.rank), lt(documents.id, cursor.id)),
          );
        }
        const rows = await app.db
          .select({
            id: documents.id,
            title: documents.title,
            rank: primaryRank,
            executedVersionId: documents.executedVersionId,
          })
          .from(documents)
          .where(and(scope, boundary))
          .orderBy(desc(primaryRank), desc(documents.id))
          .limit(51);
        const page = rows.slice(0, 50);
        const versions = page.length
          ? await app.db
              .select({
                documentId: documentVersions.documentId,
                id: documentVersions.id,
                versionNumber: documentVersions.versionNumber,
                originalFilename: documentVersions.originalFilename,
                mimeType: documentVersions.mimeType,
                byteSize: documentVersions.byteSize,
                kind: documentVersions.kind,
                note: documentVersions.note,
                createdAt: documentVersions.createdAt,
                uploadedBy: { id: users.id, displayName: users.displayName, image: users.image },
              })
              .from(documentVersions)
              .innerJoin(users, eq(users.id, documentVersions.createdBy))
              .where(
                inArray(
                  documentVersions.documentId,
                  page.map(({ id }) => id),
                ),
              )
              .orderBy(desc(documentVersions.versionNumber))
          : [];
        return {
          documents: page.map(({ id, title, rank, executedVersionId }) => ({
            id,
            title,
            isPrimary: rank === 1,
            versions: versions
              .filter((version) => version.documentId === id)
              .map((version, index) => ({
                id: version.id,
                versionNumber: version.versionNumber,
                originalFilename: version.originalFilename,
                mimeType: version.mimeType,
                byteSize: version.byteSize,
                kind: version.kind,
                note: version.note,
                uploadedBy: version.uploadedBy,
                createdAt: version.createdAt.toISOString(),
                renderFamily: renderFamilyOf(version.mimeType, version.originalFilename),
                isCurrent: index === 0,
                isExecuted: version.id === executedVersionId,
              })),
          })),
          nextCursor: rows.length > 50 ? page.at(-1)!.id : null,
        };
      },
    );
  }
};
