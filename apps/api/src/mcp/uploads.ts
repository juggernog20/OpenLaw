// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { uuidv7 } from "uuidv7";
import { documentVersions, eq, knowledgeItems } from "@openlaw/db";
import { readCredentialContext } from "./auth.js";
import { uploadInput, requireOwner } from "./documents.js";
import type { ToolContext } from "./tool.js";
import { httpError } from "../lib/problem.js";
import { refuseOversize, withStoredBlob } from "../lib/uploads.js";
import { requestDerivations, versionStorageKey } from "../lib/document-versions.js";
import { reachedContract } from "../lib/contract-access.js";
import { reachedMatter } from "../lib/matter-access.js";
import { reachedEntity } from "../lib/entity-access.js";
import {
  assertOpen,
  assertOpenMatter,
  assertOpenEntity,
  assertOpenDocument,
  reachedDocument,
  completeContractUpload,
  completeMatterUpload,
  completeEntityUpload,
  completeKnowledgeUpload,
  completeVersionUpload,
  type StoredUpload,
} from "../modules/documents/upload-service.js";

const ticketSchema = z.object({
  input: uploadInput,
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  credentialId: z.string(),
  personId: z.string(),
  expiresAt: z.number().int(),
});
type Ticket = z.infer<typeof ticketSchema>;
const LIFETIME_MS = 10 * 60 * 1000;
function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`openlaw-mcp-upload:${payload}`).digest();
}
function readTicket(token: unknown, secret: string): Ticket {
  try {
    if (typeof token !== "string" || token.length > 16000) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1] || !/^[A-Za-z0-9_-]+$/.test(parts[1]))
      throw new Error();
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = signature(parts[0], secret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      throw new Error();
    const ticket = ticketSchema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString()));
    if (ticket.expiresAt <= Date.now()) throw new Error();
    return ticket;
  } catch {
    throw httpError(401, "This upload URL is invalid or expired. Request a new upload URL.");
  }
}
async function assertTarget(
  app: FastifyInstance,
  context: ToolContext,
  input: z.infer<typeof uploadInput>,
) {
  requireOwner(input);
  if (context.grant.scope !== "write" || !context.grant.toolsets.includes("documents"))
    throw httpError(403, "Document uploads require the documents Toolset and write scope.");
  const { db, user } = context;
  if (
    user.role === "business_user" &&
    input.ownerType !== "contract" &&
    input.ownerType !== "matter"
  )
    throw httpError(403, "These uploads require a Legal Team Member.");
  let ownerId: string;
  switch (input.ownerType) {
    case "contract": {
      const row = await reachedContract(db, user, input.number!);
      assertOpen(row);
      ownerId = row.id;
      break;
    }
    case "matter": {
      const row = await reachedMatter(db, user, input.number!);
      assertOpenMatter(row);
      ownerId = row.id;
      break;
    }
    case "entity": {
      const row = await reachedEntity(db, user, input.id!);
      assertOpenEntity(row);
      ownerId = row.id;
      break;
    }
    case "knowledge_item": {
      const [row] = await db.select().from(knowledgeItems).where(eq(knowledgeItems.id, input.id!));
      if (!row) throw httpError(404, "No Knowledge Item exists with this id.");
      if (row.archivedAt)
        throw httpError(409, "Restore this Knowledge Item before adding Documents.");
      ownerId = row.id;
      break;
    }
    case "auto_doc":
      if (!input.documentId)
        throw httpError(400, "An Auto-Doc upload must append to its template Document.");
      ownerId = input.id!;
      break;
  }
  if (input.documentId) {
    const document = await reachedDocument(app.db, user, input.documentId);
    assertOpenDocument(document);
    if (document.owner.kind !== input.ownerType || document.owner.value !== ownerId)
      throw httpError(404, "No Document exists on this record with this id.");
  }
}
export function documentUploadIssuer(
  app: FastifyInstance,
  config: { baseUrl: string; secret: string },
): NonNullable<ToolContext["prepareDocumentUpload"]> {
  return async (input, context) => {
    await assertTarget(app, context, input);
    const ticket: Ticket = {
      input,
      documentId: input.documentId ?? uuidv7(),
      versionId: uuidv7(),
      credentialId: context.credentialId,
      personId: context.user.id,
      expiresAt: Date.now() + LIFETIME_MS,
    };
    const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
    const url = new URL("/mcp/uploads", config.baseUrl);
    url.searchParams.set(
      "token",
      `${payload}.${signature(payload, config.secret).toString("base64url")}`,
    );
    return {
      uploadUrl: url.href,
      headers: { "Content-Type": "application/octet-stream" },
      versionId: ticket.versionId,
      documentId: ticket.documentId,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
      maxUploadBytes: app.maxUploadBytes,
    };
  };
}
export function documentUploadRoutes(secret: string): FastifyPluginAsync {
  return async (app) => {
    // This parser passes the stream through; the storage iterator counts actual bytes.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser("*", (_request, payload, done) => done(null, payload));
    app.put<{ Querystring: { token?: string } }>(
      "/mcp/uploads",
      { schema: { hide: true } },
      async (request, reply) => {
        const ticket = readTicket(request.query.token, secret);
        const context = await readCredentialContext(app, ticket.credentialId);
        if (context.user.id !== ticket.personId)
          throw httpError(401, "This upload URL is no longer valid.");
        await assertTarget(app, context, ticket.input);
        const [existing] = await app.db
          .select({ id: documentVersions.id })
          .from(documentVersions)
          .where(eq(documentVersions.id, ticket.versionId));
        if (existing) throw httpError(409, "This upload URL has already completed a Version.");
        const size = Number(request.headers["content-length"]);
        if (size > app.maxUploadBytes) throw refuseOversize(app.maxUploadBytes);
        const digest = createHash("sha256");
        let byteSize = 0;
        async function* metered() {
          for await (const chunk of (request.body as Readable).iterator({
            destroyOnReturn: false,
          })) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            byteSize += bytes.length;
            if (byteSize > app.maxUploadBytes) {
              (request.body as Readable).resume();
              throw refuseOversize(app.maxUploadBytes);
            }
            digest.update(bytes);
            yield bytes;
          }
        }
        // Each PUT attempt gets a fresh key, including retries after a failed database write.
        const key = `${versionStorageKey(ticket.documentId, ticket.versionId)}/${uuidv7()}`;
        const fileRef = await app.storage.put(key, Readable.from(metered()));
        const file: StoredUpload = {
          fileRef,
          byteSize,
          checksumSha256: digest.digest("hex"),
          filename: ticket.input.filename,
          mimeType: ticket.input.mimeType,
          note: ticket.input.note || null,
          destination: null,
          kind: ["matter", "entity", "auto_doc"].includes(ticket.input.ownerType)
            ? "general"
            : (ticket.input.kind ?? "draft_ours"),
        };
        const document = await withStoredBlob(app.storage, request.log, fileRef, async () => {
          if (ticket.expiresAt <= Date.now())
            throw httpError(401, "This upload URL has expired. Request a new upload URL.");
          const live = await readCredentialContext(app, ticket.credentialId);
          await assertTarget(app, live, ticket.input);
          try {
            if (ticket.input.documentId)
              return await completeVersionUpload(
                app,
                live.user,
                ticket.documentId,
                ticket.versionId,
                file,
              );
            switch (ticket.input.ownerType) {
              case "contract":
                return await completeContractUpload(
                  app,
                  live.user,
                  ticket.input.number!,
                  ticket.documentId,
                  ticket.versionId,
                  file,
                );
              case "matter":
                return await completeMatterUpload(
                  app,
                  live.user,
                  ticket.input.number!,
                  ticket.documentId,
                  ticket.versionId,
                  file,
                );
              case "entity":
                return await completeEntityUpload(
                  app,
                  live.user,
                  ticket.input.id!,
                  ticket.documentId,
                  ticket.versionId,
                  file,
                );
              case "knowledge_item":
                return await completeKnowledgeUpload(
                  app,
                  live.user,
                  ticket.input.id!,
                  ticket.documentId,
                  ticket.versionId,
                  file,
                );
              default:
                throw httpError(400, "An Auto-Doc upload must append a Version.");
            }
          } catch (error) {
            // Concurrent uses of one URL can both pass the initial read; only one may commit.
            const [completed] = await app.db
              .select({ id: documentVersions.id })
              .from(documentVersions)
              .where(eq(documentVersions.id, ticket.versionId));
            if (completed) throw httpError(409, "This upload URL has already completed a Version.");
            throw error;
          }
        });
        await requestDerivations(app.jobs, app.log, {
          versionId: ticket.versionId,
          mimeType: file.mimeType,
          originalFilename: file.filename,
        });
        return reply.status(201).send({ document });
      },
    );
  };
}
