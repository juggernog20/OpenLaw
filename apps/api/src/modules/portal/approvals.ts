// SPDX-License-Identifier: AGPL-3.0-only

/** An approval grants its named recipient a review packet, not Contract team membership. */
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  ilike,
  or,
  contractApprovals,
  contracts,
  desc,
  documents,
  documentVersions,
  documentVersionRenditions,
  eq,
  isNull,
  lt,
  ne,
  users,
  type Executor,
} from "@openlaw/db";
import { MAX_APPROVAL_NOTE_LENGTH } from "@openlaw/shared";
import { requireAuth } from "../../auth/guards.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { attachmentDisposition, inlineDisposition } from "../../lib/uploads.js";

import { conversionFormatOf, previewContentType, renderFamilyOf } from "../../lib/render-family.js";

import { searchPattern } from "./list-query.js";

const Params = z.object({ id: z.string().min(1).max(64) });
const Approval = z.object({
  id: z.string(),
  contractNumber: z.number(),
  contractTitle: z.string(),
  requestedBy: z.string(),
  requestedAt: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  note: z.string().nullable(),
  decidedAt: z.string().nullable(),
});
const Packet = z.object({
  approval: Approval,
  document: z
    .object({
      filename: z.string(),
      downloadUrl: z.string(),
      previewUrl: z.string(),
      byteSize: z.number(),
      preview: z.enum(["pdf", "image", "pending", "unavailable"]),
    })
    .nullable(),
});

function ownApprovals(db: Executor, userId: string, id?: string) {
  return db
    .select({
      id: contractApprovals.id,
      contractId: contracts.id,
      contractNumber: contracts.number,
      contractTitle: contracts.title,
      requestedBy: users.displayName,
      requestedAt: contractApprovals.createdAt,
      status: contractApprovals.status,
      note: contractApprovals.note,
      decidedAt: contractApprovals.decidedAt,
    })
    .from(contractApprovals)
    .innerJoin(contracts, eq(contracts.id, contractApprovals.contractId))
    .innerJoin(users, eq(users.id, contractApprovals.requestedBy))
    .where(
      and(
        eq(contractApprovals.approverId, userId),
        isNull(contracts.archivedAt),
        id ? eq(contractApprovals.id, id) : undefined,
      ),
    );
}
function serialize(row: Awaited<ReturnType<typeof ownApprovals>>[number]) {
  return {
    id: row.id,
    contractNumber: row.contractNumber,
    contractTitle: row.contractTitle,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    status: row.status,
    note: row.note,
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}
async function primaryDocument(db: Executor, contractId: string) {
  const [row] = await db
    .select({
      versionId: documentVersions.id,
      filename: documentVersions.originalFilename,
      fileRef: documentVersions.fileRef,
      mimeType: documentVersions.mimeType,
      byteSize: documentVersions.byteSize,
    })
    .from(contracts)
    .innerJoin(
      documents,
      and(eq(documents.id, contracts.primaryDocumentId), eq(documents.contractId, contracts.id)),
    )
    .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .where(
      and(eq(contracts.id, contractId), isNull(documents.archivedAt), isNull(contracts.archivedAt)),
    )
    .orderBy(desc(documentVersions.versionNumber))
    .limit(1);
  return row;
}

export const portalApprovalsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/portal/approvals",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listPortalApprovals",
        tags: ["portal"],
        querystring: z.object({
          status: z.enum(["pending", "completed"]).default("pending"),
          q: z.string().trim().max(200).optional(),
          before: z.string().max(64).optional(),
        }),
        response: {
          200: z.object({ approvals: z.array(Approval), nextCursor: z.string().nullable() }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const rows = await ownApprovals(app.db, request.user.id)
        .$dynamic()
        .where(
          and(
            eq(contractApprovals.approverId, request.user.id),
            isNull(contracts.archivedAt),
            request.query.status === "pending"
              ? eq(contractApprovals.status, "pending")
              : ne(contractApprovals.status, "pending"),
            request.query.q
              ? or(
                  ilike(contracts.title, searchPattern(request.query.q)),
                  ilike(users.displayName, searchPattern(request.query.q)),
                )
              : undefined,
            request.query.before ? lt(contractApprovals.id, request.query.before) : undefined,
          ),
        )
        .orderBy(desc(contractApprovals.id))
        .limit(51);
      return {
        approvals: rows.slice(0, 50).map(serialize),
        nextCursor: rows.length > 50 ? rows[49]!.id : null,
      };
    },
  );
  app.get(
    "/portal/approvals/:id",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "getPortalApproval",
        tags: ["portal"],
        params: Params,
        response: { 200: Packet, default: problemResponse },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const [approval] = await ownApprovals(app.db, request.user.id, request.params.id).limit(1);
      if (!approval) throw httpError(404, "No approval request exists with this id.");
      const document = await primaryDocument(app.db, approval.contractId);
      let preview: "pdf" | "image" | "pending" | "unavailable" = "unavailable";
      if (document) {
        const family = renderFamilyOf(document.mimeType, document.filename);
        if (family === "pdf" || family === "image") preview = family;
        if (conversionFormatOf(document.mimeType, document.filename)) {
          const [rendition] = await app.db
            .select()
            .from(documentVersionRenditions)
            .where(eq(documentVersionRenditions.versionId, document.versionId));
          preview =
            !rendition || rendition.state === "pending"
              ? "pending"
              : rendition.state === "ready"
                ? "pdf"
                : "unavailable";
        }
      }
      return {
        approval: serialize(approval),
        document: document
          ? {
              filename: document.filename,
              byteSize: document.byteSize,
              preview,
              downloadUrl: `/api/v1/portal/approvals/${approval.id}/document`,
              previewUrl: `/api/v1/portal/approvals/${approval.id}/preview`,
            }
          : null,
      };
    },
  );
  app.get(
    "/portal/approvals/:id/document",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "downloadPortalApprovalDocument",
        tags: ["portal"],
        params: Params,
        response: { 200: z.any(), default: problemResponse },
      },
    },
    async (request, reply) => {
      const [approval] = await ownApprovals(app.db, request.user.id, request.params.id).limit(1);
      if (!approval) throw httpError(404, "No approval request exists with this id.");
      const document = await primaryDocument(app.db, approval.contractId);
      if (!document) throw httpError(404, "No primary document is available for review.");
      return reply
        .header("Cache-Control", "private, no-store")
        .header("content-type", document.mimeType)
        .header("content-length", String(document.byteSize))
        .header("x-content-type-options", "nosniff")
        .header("content-disposition", attachmentDisposition(document.filename))
        .send(await app.storage.get(document.fileRef));
    },
  );
  app.get(
    "/portal/approvals/:id/preview",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "previewPortalApprovalDocument",
        tags: ["portal"],
        params: Params,
        response: { 200: z.any(), default: problemResponse },
      },
    },
    async (request, reply) => {
      const [approval] = await ownApprovals(app.db, request.user.id, request.params.id).limit(1);
      if (!approval) throw httpError(404, "No approval request exists with this id.");
      const document = await primaryDocument(app.db, approval.contractId);
      if (!document) throw httpError(404, "No primary document is available for review.");
      let { fileRef, byteSize } = document;
      let contentType = previewContentType(document.mimeType, document.filename);
      if (conversionFormatOf(document.mimeType, document.filename)) {
        const [rendition] = await app.db
          .select()
          .from(documentVersionRenditions)
          .where(eq(documentVersionRenditions.versionId, document.versionId));
        if (!rendition || rendition.state === "pending")
          throw httpError(409, "The preview is still being prepared.");
        if (rendition.state !== "ready" || !rendition.fileRef || rendition.byteSize === null)
          throw httpError(415, "Download the document to review it.");
        fileRef = rendition.fileRef;
        byteSize = rendition.byteSize;
        contentType = "application/pdf";
      }
      if (!contentType) throw httpError(415, "Download the document to review it.");
      return reply
        .header("Cache-Control", "private, no-store")
        .header("content-type", contentType)
        .header("content-length", String(byteSize))
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("content-disposition", inlineDisposition(document.filename))
        .send(await app.storage.get(fileRef));
    },
  );
  app.post(
    "/portal/approvals/:id/decision",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "decidePortalApproval",
        tags: ["portal"],
        params: Params,
        body: z
          .object({
            decision: z.enum(["approved", "rejected"]),
            note: z.string().trim().max(MAX_APPROVAL_NOTE_LENGTH).optional(),
          })
          .strict(),
        response: { 200: z.object({ approval: Approval }), default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const [approval] = await ownApprovals(tx, request.user.id, request.params.id)
          .limit(1)
          .for("update", { of: contracts });
        if (!approval) throw httpError(404, "No approval request exists with this id.");
        if (approval.status !== "pending")
          throw httpError(409, "This approval request has already been decided.");
        const note = request.body.note?.trim() || null;
        const [decided] = await tx
          .update(contractApprovals)
          .set({ status: request.body.decision, note, decidedAt: new Date() })
          .where(
            and(eq(contractApprovals.id, approval.id), eq(contractApprovals.status, "pending")),
          )
          .returning({ id: contractApprovals.id });
        if (!decided) throw httpError(409, "This approval request has already been decided.");
        await recordActivity(tx, {
          entityType: "contract",
          entityId: approval.contractId,
          actorId: request.user.id,
          action: request.body.decision === "approved" ? "approval.approved" : "approval.rejected",
          visibility: RECORD_ACTIVITY_TIER,
          payload: {
            approvalId: approval.id,
            approverId: request.user.id,
            approverName: request.user.displayName,
            hasNote: note !== null,
          },
        });
        const [updated] = await ownApprovals(tx, request.user.id, approval.id);
        return { approval: serialize(updated!) };
      }),
  );
};
