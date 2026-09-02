// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Administrator-only API behind the AI analysis integration pane (TECH-003,
 * TECH-012). It owns preset normalization, write-only credential handling, live
 * connection probes, lifecycle controls, and the connector's settings history.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  aiConnector,
  AI_PRESETS,
  AI_PROTOCOLS,
  eq,
  type AiConnector,
  type AiPreset,
  type AiProtocol,
  type Executor,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { AI_PRESET_DEFINITIONS, AI_PRESET_OPTIONS } from "../../lib/ai/presets.js";
import { AiProviderError } from "../../lib/ai/provider.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const PresetOptionSchema = z.object({
  preset: z.enum(AI_PRESETS),
  label: z.string(),
  protocol: z.enum(AI_PROTOCOLS),
  baseUrl: z.string().nullable(),
  defaultModel: z.string(),
  requiresApiKey: z.boolean(),
  requiresBaseUrl: z.boolean(),
});

const ConnectorSchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  preset: z.enum(AI_PRESETS).nullable(),
  protocol: z.enum(AI_PROTOCOLS).nullable(),
  baseUrl: z.string().nullable(),
  hasApiKey: z.boolean(),
  model: z.string().nullable(),
  disabledAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime().nullable(),
});

const ConnectorEnvelope = z.object({
  connector: ConnectorSchema,
  presets: z.array(PresetOptionSchema),
});

const ConnectorBodySchema = z.object({
  preset: z.enum(AI_PRESETS),
  protocol: z.enum(AI_PROTOCOLS).optional(),
  baseUrl: z.string().trim().max(2_000).optional(),
  apiKey: z.string().max(20_000).optional(),
  model: z.string().trim().min(1).max(300),
});

function pasted(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readConnector(row: AiConnector | undefined): z.infer<typeof ConnectorSchema> {
  if (!row) {
    return {
      configured: false,
      enabled: false,
      preset: null,
      protocol: null,
      baseUrl: null,
      hasApiKey: false,
      model: null,
      disabledAt: null,
      updatedAt: null,
    };
  }
  return {
    configured: true,
    enabled: row.disabledAt === null,
    preset: row.preset,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    hasApiKey: row.apiKey !== null && row.apiKey !== "",
    model: row.model,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function envelope(row: AiConnector | undefined): z.infer<typeof ConnectorEnvelope> {
  return { connector: readConnector(row), presets: AI_PRESET_OPTIONS };
}

function checkedBaseUrl(value: string | undefined): string {
  if (!value) throw httpError(400, "Enter the provider's full base URL.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw httpError(400, "Enter a valid provider base URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw httpError(400, "The provider base URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw httpError(400, "The provider base URL must not contain credentials.");
  }
  return url.toString();
}

function resolvedConfig(body: z.infer<typeof ConnectorBodySchema>): {
  preset: AiPreset;
  protocol: AiProtocol;
  baseUrl: string;
  model: string;
} {
  const definition = AI_PRESET_DEFINITIONS[body.preset];
  const protocol = body.preset === "custom" ? body.protocol : definition.protocol;
  if (!protocol) throw httpError(400, "Choose the protocol used by the custom endpoint.");
  const baseUrl = definition.baseUrl ?? checkedBaseUrl(body.baseUrl);
  return { preset: body.preset, protocol, baseUrl, model: body.model.trim() };
}

async function lockedConnector(tx: Executor): Promise<AiConnector> {
  const [row] = await tx.select().from(aiConnector).limit(1).for("update");
  if (!row) throw httpError(404, "This install has no AI connector to change.");
  return row;
}

export const aiConnectorRoutes: FastifyPluginAsyncZod = async (app) => {
  async function stored(): Promise<AiConnector | undefined> {
    const [row] = await app.db.select().from(aiConnector).limit(1);
    return row;
  }

  app.get(
    "/ai-connector",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getAiConnector",
        summary: "Read the AI connector without returning its write-only API key",
        tags: ["ai-connector"],
        response: { 200: ConnectorEnvelope, default: problemResponse },
      },
    },
    async () => envelope(await stored()),
  );

  app.put(
    "/ai-connector",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "saveAiConnector",
        summary: "Configure or update the AI connector; a blank API key keeps the stored key",
        tags: ["ai-connector"],
        body: ConnectorBodySchema,
        response: { 200: ConnectorEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const config = resolvedConfig(request.body);
      const apiKey = pasted(request.body.apiKey);
      const saved = await app.db.transaction(async (tx) => {
        const [current] = await tx.select().from(aiConnector).limit(1).for("update");
        if (!current) {
          if (config.preset !== "ollama" && !apiKey) {
            throw httpError(400, "Paste the API key for this provider.");
          }
          const [row] = await tx
            .insert(aiConnector)
            .values({ ...config, apiKey })
            .returning();
          if (!row) throw httpError(500, "The AI connector could not be saved.");
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "ai_connector.configured",
            visibility: "admin_only",
            payload: config,
          });
          return row;
        }

        if (config.preset !== "ollama" && !apiKey && !current.apiKey) {
          throw httpError(400, "Paste the API key for this provider.");
        }
        const [row] = await tx
          .update(aiConnector)
          .set({
            ...config,
            ...(apiKey ? { apiKey } : {}),
            updatedAt: new Date(),
          })
          .where(eq(aiConnector.id, current.id))
          .returning();
        if (!row) throw httpError(500, "The AI connector could not be saved.");

        for (const field of ["preset", "protocol", "baseUrl", "model"] as const) {
          if (current[field] !== row[field]) {
            await recordActivity(tx, {
              entityType: "system",
              actorId: request.user.id,
              action: "ai_connector.updated",
              visibility: "admin_only",
              payload: {
                preset: row.preset,
                field,
                old: current[field],
                new: row[field],
              },
            });
          }
        }
        if (apiKey) {
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "ai_connector.updated",
            visibility: "admin_only",
            payload: {
              preset: row.preset,
              field: "apiKey",
              old: "[secret]",
              new: "[secret]",
            },
          });
        }
        return row;
      });
      return envelope(saved);
    },
  );

  app.post(
    "/ai-connector/test",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "testAiConnector",
        summary: "Make one small call through the stored AI connector",
        tags: ["ai-connector"],
        response: {
          200: z.object({ ok: z.literal(true) }),
          default: problemResponse,
        },
      },
    },
    async () => {
      const provider = await app.resolveAiProvider();
      if (!provider) throw httpError(400, "No enabled AI connector is configured. Save it first.");
      try {
        await provider.probe();
        return { ok: true as const };
      } catch (error) {
        if (error instanceof AiProviderError) {
          throw httpError(502, `The connection test failed. ${error.message}`, { expose: true });
        }
        throw error;
      }
    },
  );

  app.post(
    "/ai-connector/disable",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "disableAiConnector",
        summary: "Turn off the AI connector without deleting its configuration",
        tags: ["ai-connector"],
        response: { 200: ConnectorEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const saved = await app.db.transaction(async (tx) => {
        const current = await lockedConnector(tx);
        if (current.disabledAt) throw httpError(409, "The AI connector is already turned off.");
        const [row] = await tx
          .update(aiConnector)
          .set({ disabledAt: new Date(), updatedAt: new Date() })
          .where(eq(aiConnector.id, current.id))
          .returning();
        if (!row) throw httpError(500, "The AI connector could not be turned off.");
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "ai_connector.disabled",
          visibility: "admin_only",
          payload: { preset: current.preset },
        });
        return row;
      });
      return envelope(saved);
    },
  );

  app.post(
    "/ai-connector/enable",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "enableAiConnector",
        summary: "Turn on the stored AI connector",
        tags: ["ai-connector"],
        response: { 200: ConnectorEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const saved = await app.db.transaction(async (tx) => {
        const current = await lockedConnector(tx);
        if (!current.disabledAt) throw httpError(409, "The AI connector is already on.");
        const [row] = await tx
          .update(aiConnector)
          .set({ disabledAt: null, updatedAt: new Date() })
          .where(eq(aiConnector.id, current.id))
          .returning();
        if (!row) throw httpError(500, "The AI connector could not be turned on.");
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "ai_connector.enabled",
          visibility: "admin_only",
          payload: { preset: current.preset },
        });
        return row;
      });
      return envelope(saved);
    },
  );

  app.delete(
    "/ai-connector",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "deleteAiConnector",
        summary: "Remove the AI connector and its API key",
        tags: ["ai-connector"],
        response: { 200: ConnectorEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        const current = await lockedConnector(tx);
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "ai_connector.removed",
          visibility: "admin_only",
          payload: {
            preset: current.preset,
            protocol: current.protocol,
            baseUrl: current.baseUrl,
            model: current.model,
          },
        });
        await tx.delete(aiConnector).where(eq(aiConnector.id, current.id));
      });
      return envelope(undefined);
    },
  );
};
