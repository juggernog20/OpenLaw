// SPDX-License-Identifier: AGPL-3.0-only

import { listPortalDocuments } from "./document-service.js";

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { DOCUMENT_VERSION_KINDS } from "@openlaw/db";
import { requireAuth } from "../../auth/guards.js";
import { problemResponse } from "../../lib/problem.js";
import { RENDER_FAMILIES } from "../../lib/render-family.js";

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
        return listPortalDocuments(
          app.db,
          request.user,
          module,
          request.params.number,
          request.query,
        );
      },
    );
  }
};
