// SPDX-License-Identifier: AGPL-3.0-only

/** The authenticated Server-Sent Events channel (TECH-009). */

import { eq, knowledgeItems } from "@openlaw/db";
import { LIVE_RECORD_ENTITY_TYPES, type LiveRecordEntityType } from "@openlaw/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../auth/guards.js";
import { contractAudience } from "../../lib/contract-access.js";
import { entityAudience } from "../../lib/entity-access.js";
import { httpError } from "../../lib/problem.js";
import { commentAudience } from "../comments/audience.js";

const NO_RECORD = "No record exists with this reference.";

const EventQuerySchema = z
  .object({
    entityType: z.enum(LIVE_RECORD_ENTITY_TYPES).optional(),
    entityId: z.string().min(1).max(64).optional(),
  })
  .refine((query) => Boolean(query.entityType) === Boolean(query.entityId), {
    message: "entityType and entityId must be supplied together.",
  });

async function reachedRecord(
  app: Parameters<FastifyPluginAsyncZod>[0],
  user: Parameters<typeof contractAudience>[1],
  entityType: LiveRecordEntityType,
  entityId: string,
): Promise<{ entityType: LiveRecordEntityType; entityId: string } | null> {
  if (entityType === "contract" || entityType === "matter" || entityType === "request") {
    const audience = await commentAudience(app.db, user, { entityType, entityId });
    return audience ? { entityType: audience.entityType, entityId: audience.entityId } : null;
  }
  if (entityType === "entity") {
    const audience = await entityAudience(app.db, user, entityId);
    return audience ? { entityType: "entity", entityId: audience.entityId } : null;
  }
  if (user.role !== "administrator" && user.role !== "legal_team_member") return null;
  const [item] = await app.db
    .select({ id: knowledgeItems.id })
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, entityId))
    .limit(1);
  return item ? { entityType: "knowledge_item", entityId: item.id } : null;
}

export const eventRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/api/events",
    {
      preHandler: requireAuth,
      // The stream is an internal browser channel, not the REST/OpenAPI
      // integration surface and not a generated-client operation.
      schema: { hide: true, querystring: EventQuerySchema },
    },
    async (request, reply) => {
      const record =
        request.query.entityType && request.query.entityId
          ? await reachedRecord(app, request.user, request.query.entityType, request.query.entityId)
          : undefined;
      if (request.query.entityType && !record) throw httpError(404, NO_RECORD);
      const scopedRecord = record ?? undefined;

      let closed = false;
      let unsubscribe = () => {};
      const heartbeat = setInterval(() => {
        if (closed || reply.raw.destroyed || reply.raw.writableEnded) {
          close();
          return;
        }
        reply.raw.write(": heartbeat\n\n");
      }, app.eventHub.heartbeatMs);
      heartbeat.unref();
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      };

      unsubscribe = app.eventHub.subscribe(
        { userId: request.user.id, role: request.user.role, record: scopedRecord },
        (event) => {
          if (closed || reply.raw.destroyed || reply.raw.writableEnded) return;
          try {
            reply.raw.write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
          } catch {
            close();
          }
        },
      );

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.flushHeaders();
      reply.raw.once("close", close);
      request.raw.once("aborted", close);
    },
  );
};
