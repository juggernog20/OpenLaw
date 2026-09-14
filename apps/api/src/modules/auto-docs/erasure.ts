// SPDX-License-Identifier: AGPL-3.0-only

/** ADO-012 and DOC-010: Administrator erasure removes Auto-Doc content while independent records keep their generated origin. */
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  asc,
  autoDocAcknowledgements,
  autoDocFilings,
  autoDocGenerations,
  autoDocs,
  documents,
  eq,
  inArray,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { documentErasureBlobs } from "../../lib/document-erasure.js";
import { httpError, problemResponse } from "../../lib/problem.js";

export const autoDocErasureRoutes: FastifyPluginAsyncZod = async (app) => {
  app.delete(
    "/auto-docs/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "hardDeleteAutoDoc",
        tags: ["auto-docs"],
        summary:
          "Permanently erase an Auto-Doc, its template and derivations, forms, saved Generation answers and output files. Created Contracts and Filed Documents retain their own copies and generated provenance. Requires the typed word delete and the current Auto-Doc name, including for archived Auto-Docs.",
        params: z.object({ id: z.string() }),
        body: z.strictObject({ confirm: z.literal("delete"), confirmName: z.string().min(1) }),
        response: { 204: z.null(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        const [autoDoc] = await tx
          .select()
          .from(autoDocs)
          .where(eq(autoDocs.id, request.params.id))
          .for("update");
        if (!autoDoc) throw httpError(404, "This Auto-Doc does not exist.");
        if (request.body.confirmName.trim() !== autoDoc.name.trim())
          throw httpError(409, "This Auto-Doc was renamed. Reload it before deleting.");
        const generations = await tx
          .select({
            id: autoDocGenerations.id,
            docxFileRef: autoDocGenerations.docxFileRef,
            pdfFileRef: autoDocGenerations.pdfFileRef,
          })
          .from(autoDocGenerations)
          .where(eq(autoDocGenerations.autoDocId, autoDoc.id))
          .orderBy(asc(autoDocGenerations.id))
          .for("update");
        const templates = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.autoDocId, autoDoc.id))
          .orderBy(asc(documents.id))
          .for("update");
        const blobs = generations.flatMap((row) =>
          [row.pdfFileRef, row.docxFileRef].filter((ref): ref is string => ref !== null),
        );
        let versionCount = 0;
        for (const template of templates) {
          const files = await documentErasureBlobs(tx, template.id);
          versionCount += files.versionCount;
          blobs.push(...files.blobs);
        }
        await tx
          .update(autoDocs)
          .set({
            state: "draft",
            archivedAt: null,
            templateDocumentId: null,
            publishedDocumentVersionId: null,
            publishedFormVersionId: null,
            publishedAt: null,
          })
          .where(eq(autoDocs.id, autoDoc.id));
        await tx
          .delete(autoDocFilings)
          .where(
            inArray(
              autoDocFilings.generationId,
              tx
                .select({ id: autoDocGenerations.id })
                .from(autoDocGenerations)
                .where(eq(autoDocGenerations.autoDocId, autoDoc.id)),
            ),
          );
        await tx
          .delete(autoDocAcknowledgements)
          .where(eq(autoDocAcknowledgements.autoDocId, autoDoc.id));
        await tx.delete(autoDocGenerations).where(eq(autoDocGenerations.autoDocId, autoDoc.id));
        await tx.delete(documents).where(eq(documents.autoDocId, autoDoc.id));
        await tx.delete(autoDocs).where(eq(autoDocs.id, autoDoc.id));
        await recordActivity(tx, {
          entityType: "auto_doc",
          entityId: autoDoc.id,
          actorId: request.user.id,
          action: "auto_doc.hard_deleted",
          visibility: "legal_only",
          payload: { generationCount: generations.length, versionCount },
        });
        // DOC-010 keeps the references on rollback so a failed storage deletion can be retried.
        for (const ref of new Set(blobs)) await app.storage.delete(ref);
      });
      return reply.status(204).send(null);
    },
  );
};
