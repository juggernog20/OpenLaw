// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Portal Document lists enforce portalRecordScope and documentAudienceScope (DD-014,
 * DD-024). Callers authenticate the reader. A cursor outside the result set returns an
 * empty page.
 */

import {
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
import { documentAudienceScope } from "../../lib/contract-access.js";
import { portalRecordScope } from "../../lib/portal-record-access.js";
import { httpError } from "../../lib/problem.js";
import { renderFamilyOf } from "../../lib/render-family.js";
import type { AuthenticatedUser } from "../../auth/guards.js";
import type { Db } from "@openlaw/db";

export async function listPortalDocuments(
  db: Db,
  user: AuthenticatedUser,
  module: "contract" | "matter",
  number: number,
  query: { cursor?: string; q?: string } = {},
) {
  const table = module === "contract" ? contracts : matters;

  const [record] = await db
    .select({
      id: table.id,
      primaryDocumentId:
        module === "contract" ? contracts.primaryDocumentId : sql<string | null>`null`,
    })
    .from(table)
    .where(and(eq(table.number, number), portalRecordScope(db, user, module)))
    .limit(1);
  if (!record) throw httpError(404, `No ${module} exists with this number.`);
  const primaryRank =
    sql<number>`case when ${documents.id} = ${record.primaryDocumentId} then 1 else 0 end`.mapWith(
      Number,
    );
  const scope = and(
    eq(module === "contract" ? documents.contractId : documents.matterId, record.id),
    isNull(documents.archivedAt),
    documentAudienceScope(db, user),
    query.q
      ? or(
          sql`position(lower(${query.q}) in lower(${documents.title})) > 0`,
          sql`exists (select 1 from ${documentVersions} where ${documentVersions.documentId} = ${documents.id} and position(lower(${query.q}) in lower(${documentVersions.originalFilename})) > 0)`,
        )
      : undefined,
  );
  let boundary;
  if (query.cursor) {
    const [cursor] = await db
      .select({ id: documents.id, rank: primaryRank })
      .from(documents)
      .where(and(scope, eq(documents.id, query.cursor)))
      .limit(1);
    if (!cursor) return { documents: [], nextCursor: null };
    boundary = or(
      lt(primaryRank, cursor.rank),
      and(eq(primaryRank, cursor.rank), lt(documents.id, cursor.id)),
    );
  }
  const rows = await db
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
    ? await db
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
}
