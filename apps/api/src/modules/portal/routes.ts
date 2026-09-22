// SPDX-License-Identifier: AGPL-3.0-only

/** Portal reads require a session. Request forms read the destination type's Intake tree; archived Request types take no submissions. */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { departmentOptions } from "../departments/references.js";
import {
  and,
  asc,
  desc,
  documents,
  documentVersions,
  eq,
  intakeLinks,
  isNull,
  knowledgeItems,
  or,
  requestTypes,
  type Executor,
} from "@openlaw/db";
import { requireAuth } from "../../auth/guards.js";
import { documentAudienceScope } from "../../lib/contract-access.js";
import { AttachedCustomFieldSchema } from "../../lib/custom-fields.js";
import { httpError, problemResponse, PROBLEM_CONTENT_TYPE } from "../../lib/problem.js";
import { attachmentDisposition } from "../../lib/uploads.js";

import { readIntakeForm } from "../../lib/intake-form.js";
import { FormNodeSchema } from "../../lib/type-form-routes.js";

const PortalRequestTypeSchema = z.object({
  turnaroundDays: z.number().int().nullable(),
  id: z.string(),
  /** Addresses the type's form; the picker links on it. */
  slug: z.string(),
  displayName: z.string(),
  /** The requester-facing line under the name; NULL = none. */
  description: z.string().nullable(),
  displayOrder: z.number().int(),
});

const PortalIntakeLinkSchema = z.union([
  z.object({
    id: z.string(),
    label: z.string(),
    /** Absolute http/https, exactly as stored (INT-004). */
    url: z.string(),
    displayOrder: z.number().int(),
  }),
  z.object({
    id: z.string(),
    label: z.string(),
    knowledgeItemId: z.string(),
    displayOrder: z.number().int(),
  }),
]);

const PortalDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  currentVersion: z.object({
    id: z.string(),
    originalFilename: z.string(),
    mimeType: z.string(),
    byteSize: z.number().int().nonnegative(),
    downloadUrl: z.string(),
  }),
});

const PortalKnowledgeItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  primaryDocument: z.object({ id: z.string(), title: z.string() }).nullable(),
  documents: z.array(PortalDocumentSchema),
});

const DownloadSchema = z.any().meta({ type: "string", format: "binary" });
const PORTAL_KNOWLEDGE_NOT_FOUND = "No portal Knowledge Item exists with this id.";

async function portalKnowledgeItem(db: Executor, id: string) {
  const [item] = await db
    .select({
      id: knowledgeItems.id,
      title: knowledgeItems.title,
      body: knowledgeItems.body,
      primaryDocumentId: knowledgeItems.primaryDocumentId,
    })
    .from(knowledgeItems)
    .where(
      and(
        eq(knowledgeItems.id, id),
        eq(knowledgeItems.state, "published"),
        eq(knowledgeItems.audience, "everyone"),
        isNull(knowledgeItems.archivedAt),
      ),
    )
    .limit(1);
  return item ?? null;
}

/**
 * Deliberately hand-written rather than thrown through `httpError`: the
 * shared handler stamps `instance` with the request URL, which carries
 * the probed id. The KNW-004 addendum wants draft, Legal only, archived,
 * and unknown items to answer one byte-identical 404 body, so nothing
 * derived from the request may appear in it.
 */
function portalKnowledgeNotFound(reply: FastifyReply) {
  return reply.type(PROBLEM_CONTENT_TYPE).status(404).send({
    type: "about:blank",
    title: "Not found",
    status: 404,
    detail: PORTAL_KNOWLEDGE_NOT_FOUND,
  });
}

function portalLink(row: {
  id: string;
  label: string;
  url: string | null;
  knowledgeItemId: string | null;
  displayOrder: number;
}) {
  return row.knowledgeItemId
    ? {
        id: row.id,
        label: row.label,
        knowledgeItemId: row.knowledgeItemId,
        displayOrder: row.displayOrder,
      }
    : { id: row.id, label: row.label, url: row.url!, displayOrder: row.displayOrder };
}

const reachableLink = or(
  isNull(intakeLinks.knowledgeItemId),
  and(
    eq(knowledgeItems.state, "published"),
    eq(knowledgeItems.audience, "everyone"),
    isNull(knowledgeItems.archivedAt),
  ),
);

export const portalRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/portal/request-types",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listPortalRequestTypes",
        summary:
          "The live request types the portal picker offers, in the " +
          "Administrator's display order (INT-002); archived types are " +
          "absent, because an archived form takes no submissions",
        tags: ["portal"],
        response: {
          200: z.object({ requestTypes: z.array(PortalRequestTypeSchema) }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const rows = await app.db
        .select({
          id: requestTypes.id,
          slug: requestTypes.slug,
          displayName: requestTypes.displayName,
          description: requestTypes.description,
          turnaroundDays: requestTypes.turnaroundDays,
          displayOrder: requestTypes.displayOrder,
        })
        .from(requestTypes)
        .where(isNull(requestTypes.archivedAt))
        // The same tiebreak the taxonomy list uses, so two types an
        // Administrator has never reordered read in the order they
        // were created rather than an arbitrary one.
        .orderBy(asc(requestTypes.displayOrder), asc(requestTypes.createdAt));
      return { requestTypes: rows };
    },
  );

  app.get(
    "/portal/intake-links",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listPortalIntakeLinks",
        summary:
          'The "Before you submit…" links placed on the portal home ' +
          "(INT-004), in panel order; per-request-type links belong to " +
          "that type's form and are not answered here",
        tags: ["portal"],
        response: {
          200: z.object({ intakeLinks: z.array(PortalIntakeLinkSchema) }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const rows = await app.db
        .select({
          id: intakeLinks.id,
          label: intakeLinks.label,
          url: intakeLinks.url,
          knowledgeItemId: intakeLinks.knowledgeItemId,
          displayOrder: intakeLinks.displayOrder,
        })
        .from(intakeLinks)
        .leftJoin(knowledgeItems, eq(intakeLinks.knowledgeItemId, knowledgeItems.id))
        .where(and(isNull(intakeLinks.requestTypeId), reachableLink))
        .orderBy(asc(intakeLinks.displayOrder), asc(intakeLinks.createdAt));
      return { intakeLinks: rows.map(portalLink) };
    },
  );

  app.get(
    "/portal/request-types/:slug",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "readPortalRequestForm",
        summary:
          "The destination type's Intake tree, pinned basics, Row definitions and deflection links",
        tags: ["portal"],
        params: z.object({ slug: z.string() }),
        response: {
          200: z.object({
            requestType: PortalRequestTypeSchema,
            fields: z.array(AttachedCustomFieldSchema),
            form: z.array(FormNodeSchema),
            basics: z.array(z.enum(["title", "department", "urgency", "attachments"])),
            regions: z.array(z.object({ id: z.string(), displayName: z.string() })),
            departments: z.array(z.object({ id: z.string(), displayName: z.string() })),
            intakeLinks: z.array(PortalIntakeLinkSchema),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      // Addressed by slug, because that is what the picker's link
      // carries and what a requester sees in the address bar. Archived
      // types are absent for the picker's reason — an archived form
      // takes no submissions (the INT-004 addendum) — and 404 rather
      // than a refusal, because to a requester the form is simply not
      // there.
      const [type] = await app.db
        .select({
          id: requestTypes.id,
          slug: requestTypes.slug,
          displayName: requestTypes.displayName,
          description: requestTypes.description,
          turnaroundDays: requestTypes.turnaroundDays,
          displayOrder: requestTypes.displayOrder,
        })
        .from(requestTypes)
        .where(and(eq(requestTypes.slug, request.params.slug), isNull(requestTypes.archivedAt)))
        .limit(1);
      if (!type) throw httpError(404, "That request type is not taking submissions.");

      const [intake, links] = await Promise.all([
        readIntakeForm(app.db, type.id),
        app.db
          .select({
            id: intakeLinks.id,
            label: intakeLinks.label,
            url: intakeLinks.url,
            knowledgeItemId: intakeLinks.knowledgeItemId,
            displayOrder: intakeLinks.displayOrder,
          })
          .from(intakeLinks)
          .leftJoin(knowledgeItems, eq(intakeLinks.knowledgeItemId, knowledgeItems.id))
          .where(and(eq(intakeLinks.requestTypeId, type.id), reachableLink))
          .orderBy(asc(intakeLinks.displayOrder), asc(intakeLinks.createdAt)),
      ]);
      return {
        requestType: type,
        departments: await departmentOptions(app.db),
        fields: intake.fields,
        form: intake.form,
        basics: ["title", "department", "urgency", "attachments"] as (
          "title" | "department" | "urgency" | "attachments"
        )[],
        regions: intake.regions,
        intakeLinks: links.map(portalLink),
      };
    },
  );

  app.get(
    "/portal/knowledge/:id",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "readPortalKnowledgeItem",
        summary:
          "One portal-readable Knowledge Item — published, audience " +
          "Everyone, not archived; every signed-in role reads it " +
          "(Administrator, Legal Team Member, and Business " +
          "User per DD-023), and anything short of that gate answers 404",
        tags: ["portal"],
        params: z.object({ id: z.string() }),
        response: {
          200: z.object({ knowledgeItem: PortalKnowledgeItemSchema }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const item = await portalKnowledgeItem(app.db, request.params.id);
      if (!item) return portalKnowledgeNotFound(reply);
      // The Document's own Confidential flag (DOC-008) narrows the paper
      // one level below the item gate. The same predicate every staff
      // read applies, so a flagged file leaves the Portal listing with
      // the staff surfaces.
      const paper = await app.db
        .select({ id: documents.id, title: documents.title })
        .from(documents)
        .where(
          and(
            eq(documents.knowledgeItemId, item.id),
            isNull(documents.archivedAt),
            documentAudienceScope(app.db, request.user),
          ),
        )
        .orderBy(asc(documents.createdAt), asc(documents.id));
      const withVersions = (
        await Promise.all(
          paper.map(async (document) => {
            const [version] = await app.db
              .select({
                id: documentVersions.id,
                originalFilename: documentVersions.originalFilename,
                mimeType: documentVersions.mimeType,
                byteSize: documentVersions.byteSize,
              })
              .from(documentVersions)
              .where(eq(documentVersions.documentId, document.id))
              .orderBy(desc(documentVersions.versionNumber))
              .limit(1);
            return version
              ? {
                  ...document,
                  currentVersion: {
                    ...version,
                    downloadUrl: `/api/v1/portal/knowledge/${item.id}/documents/${document.id}/download`,
                  },
                }
              : null;
          }),
        )
      ).filter((row): row is NonNullable<typeof row> => row !== null);
      withVersions.sort((left, right) => {
        if (left.id === item.primaryDocumentId) return -1;
        if (right.id === item.primaryDocumentId) return 1;
        return 0;
      });
      const primary = withVersions.find((row) => row.id === item.primaryDocumentId) ?? null;
      return {
        knowledgeItem: {
          id: item.id,
          title: item.title,
          body: item.body,
          primaryDocument: primary ? { id: primary.id, title: primary.title } : null,
          documents: withVersions,
        },
      };
    },
  );

  app.get(
    "/portal/knowledge/:id/documents/:documentId/download",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "downloadPortalKnowledgeDocument",
        summary:
          "The current Version's bytes for one Document on a " +
          "portal-readable Knowledge Item, behind the same gate as the " +
          "article; every signed-in role downloads it (Administrator, " +
          "Legal Team Member, and Business User per DD-023)",
        tags: ["portal"],
        produces: ["application/octet-stream"],
        params: z.object({ id: z.string(), documentId: z.string() }),
        response: { 200: DownloadSchema, default: problemResponse },
      },
    },
    async (request, reply) => {
      const item = await portalKnowledgeItem(app.db, request.params.id);
      if (!item) return portalKnowledgeNotFound(reply);
      const [version] = await app.db
        .select({
          fileRef: documentVersions.fileRef,
          originalFilename: documentVersions.originalFilename,
          mimeType: documentVersions.mimeType,
          byteSize: documentVersions.byteSize,
        })
        .from(documents)
        .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
        .where(
          and(
            eq(documents.id, request.params.documentId),
            eq(documents.knowledgeItemId, item.id),
            isNull(documents.archivedAt),
            // The listing's predicate, asked again on the bytes: a
            // flagged file answers the same 404 as one that is not there.
            documentAudienceScope(app.db, request.user),
          ),
        )
        .orderBy(desc(documentVersions.versionNumber))
        .limit(1);
      if (!version) return portalKnowledgeNotFound(reply);
      return reply
        .header("content-type", version.mimeType)
        .header("content-length", String(version.byteSize))
        .header("content-disposition", attachmentDisposition(version.originalFilename))
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "private, max-age=0, must-revalidate")
        .send(await app.storage.get(version.fileRef));
    },
  );
};
