// SPDX-License-Identifier: AGPL-3.0-only

/** The authenticated Server-Sent Events channel (TECH-009). */

import { autoDocs, eq, knowledgeItems } from "@openlaw/db";
import {
  LIVE_RECORD_ENTITY_TYPES,
  type LiveEventVisibility,
  type LiveRecordEntityType,
} from "@openlaw/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth } from "../../auth/guards.js";
import { contractAudience } from "../../lib/contract-access.js";
import { entityAudience } from "../../lib/entity-access.js";
import { EventHubFullError } from "../../lib/event-hub.js";
import { httpError, problemResponse } from "../../lib/problem.js";
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

export async function reachedRecord(
  app: Parameters<FastifyPluginAsyncZod>[0],
  user: Parameters<typeof contractAudience>[1],
  entityType: LiveRecordEntityType,
  entityId: string,
): Promise<{
  entityType: LiveRecordEntityType;
  entityId: string;
  tiers: readonly LiveEventVisibility[];
} | null> {
  if (entityType === "contract" || entityType === "matter" || entityType === "request") {
    const audience = await commentAudience(app.db, user, { entityType, entityId });
    return audience &&
      audience.entityType !== "matter_task" &&
      audience.entityType !== "contract_task"
      ? { entityType: audience.entityType, entityId: audience.entityId, tiers: audience.tiers }
      : null;
  }
  if (entityType === "entity") {
    const audience = await entityAudience(app.db, user, entityId);
    return audience
      ? { entityType: "entity", entityId: audience.entityId, tiers: audience.tiers }
      : null;
  }
  if (user.role !== "administrator" && user.role !== "legal_team_member") return null;
  const table = entityType === "auto_doc" ? autoDocs : knowledgeItems;
  const [item] = await app.db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, entityId))
    .limit(1);
  return item ? { entityType, entityId: item.id, tiers: ["legal_only"] } : null;
}

export const eventRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/api/events",
    {
      preHandler: requireAuth,
      // The stream is an internal browser channel, not the REST/OpenAPI
      // integration surface and not a generated-client operation.
      schema: {
        hide: true,
        querystring: EventQuerySchema,
        response: { default: problemResponse },
      },
    },
    async (request, reply) => {
      const record =
        request.query.entityType && request.query.entityId
          ? await reachedRecord(app, request.user, request.query.entityType, request.query.entityId)
          : undefined;
      if (request.query.entityType && !record) throw httpError(404, NO_RECORD);
      const scopedRecord = record ?? undefined;

      let closed = false;
      let heartbeat: NodeJS.Timeout | null = null;
      let unsubscribe = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
      };
      const writeFrame = (frame: string) => {
        if (closed || reply.raw.destroyed || reply.raw.writableEnded) {
          close();
          return;
        }
        try {
          if (reply.raw.write(frame)) return;
        } catch {
          // Fall through to the same cleanup as a slow reader.
        }
        close();
        reply.raw.destroy();
      };

      try {
        unsubscribe = app.eventHub.subscribe(
          {
            userId: request.user.id,
            role: request.user.role,
            record: scopedRecord ? [scopedRecord] : undefined,
          },
          (event) => {
            writeFrame(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
          },
          // The hub drops this stream when its owner opens one past the
          // per-user cap. The browser reconnects if it still wants one.
          () => {
            close();
            if (!reply.raw.writableEnded) reply.raw.end();
          },
        );
      } catch (error) {
        if (error instanceof EventHubFullError) {
          reply.header("retry-after", "5");
          throw httpError(503, "Too many live event streams are open. Try again shortly.", {
            expose: true,
          });
        }
        throw error;
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.flushHeaders();
      heartbeat = setInterval(() => writeFrame(": heartbeat\n\n"), app.eventHub.heartbeatMs);
      heartbeat.unref();
      reply.raw.once("close", close);
      request.raw.once("aborted", close);
    },
  );
};
