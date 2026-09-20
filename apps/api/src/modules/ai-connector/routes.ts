// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Administrator-only API behind the AI analysis integration pane (TECH-003,
 * TECH-012). It owns preset normalization, write-only credential handling, live
 * connection probes, lifecycle controls, and the connector's settings history.
 */

import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AI_ANSWER_STYLES,
  AI_OUTPUT_TOKEN_DEFAULT,
  AI_OUTPUT_TOKEN_MIN,
  AI_OUTPUT_TOKEN_MAX,
  normalizeAiBaseUrl,
} from "@openlaw/shared";
import {
  aiConnector,
  aiSavedKeys,
  ADVISORY_LOCK,
  asc,
  sql,
  type AiSavedKey,
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
import { findSavedAiKey } from "../../lib/ai/saved-keys.js";
import { listAiModels } from "../../lib/ai/models.js";
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

const WorkflowSettingsSchema = z.object({
  matterPreparation: z.boolean(),
  contractPreparation: z.boolean(),
  contractConversionAnalysis: z.boolean(),
});

const AnswerStyleSchema = z.object({ answerStyle: z.enum(AI_ANSWER_STYLES) });
const SavedKeySchema = z.object({
  id: z.string(),
  preset: z.enum(AI_PRESETS),
  protocol: z.enum(AI_PROTOCOLS),
  baseUrl: z.string(),
  inUse: z.boolean(),
  hasApiKey: z.boolean(),
  updatedAt: z.iso.datetime(),
});

const ConnectorSchema = WorkflowSettingsSchema.extend({
  answerStyle: z.enum(AI_ANSWER_STYLES),
  configured: z.boolean(),
  enabled: z.boolean(),
  preset: z.enum(AI_PRESETS).nullable(),
  protocol: z.enum(AI_PROTOCOLS).nullable(),
  baseUrl: z.string().nullable(),
  hasApiKey: z.boolean(),
  savedKeys: z.array(SavedKeySchema),
  model: z.string().nullable(),
  maxOutputTokens: z.number().int(),
  disabledAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime().nullable(),
});

const ConnectorEnvelope = z.object({
  connector: ConnectorSchema,
  presets: z.array(PresetOptionSchema),
});

const ProviderBodySchema = z.object({
  preset: z.enum(AI_PRESETS),
  protocol: z.enum(AI_PROTOCOLS).optional(),
  baseUrl: z.string().trim().max(2_000).optional(),
  apiKey: z.string().max(20_000).optional(),
});

const ConnectorBodySchema = ProviderBodySchema.extend({
  answerStyle: z.enum(AI_ANSWER_STYLES).optional(),
  model: z.string().trim().min(1).max(300),
  maxOutputTokens: z.number().int().min(AI_OUTPUT_TOKEN_MIN).max(AI_OUTPUT_TOKEN_MAX).optional(),
});

function pasted(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readConnector(
  row: AiConnector | undefined,
  keys: AiSavedKey[],
): z.infer<typeof ConnectorSchema> {
  const savedKeys = keys.map((key) => ({
    id: key.id,
    preset: key.preset,
    protocol: key.protocol,
    baseUrl: normalizeAiBaseUrl(key.baseUrl),
    inUse: row?.savedKeyId === key.id,
    hasApiKey: !!key.apiKey,
    updatedAt: key.updatedAt.toISOString(),
  }));
  if (!row) {
    return {
      savedKeys,
      matterPreparation: false,
      contractPreparation: false,
      contractConversionAnalysis: false,
      answerStyle: "sentence",
      configured: false,
      enabled: false,
      preset: null,
      protocol: null,
      baseUrl: null,
      hasApiKey: false,
      model: null,
      maxOutputTokens: AI_OUTPUT_TOKEN_DEFAULT,
      disabledAt: null,
      updatedAt: null,
    };
  }
  return {
    matterPreparation: row.matterPreparation,
    contractPreparation: row.contractPreparation,
    contractConversionAnalysis: row.contractConversionAnalysis,
    answerStyle: row.answerStyle,
    configured: true,
    enabled: row.disabledAt === null,
    preset: row.preset,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    hasApiKey: keys.some((key) => key.id === row.savedKeyId && !!key.apiKey),
    savedKeys,
    model: row.model,
    maxOutputTokens: row.maxOutputTokens,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
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

function resolvedConfig(body: z.infer<typeof ProviderBodySchema>): {
  preset: AiPreset;
  protocol: AiProtocol;
  baseUrl: string;
} {
  const definition = AI_PRESET_DEFINITIONS[body.preset];
  const protocol = body.preset === "custom" ? body.protocol : definition.protocol;
  if (!protocol) throw httpError(400, "Choose the protocol used by the custom endpoint.");
  const baseUrl = definition.baseUrl ?? checkedBaseUrl(body.baseUrl);
  return { preset: body.preset, protocol, baseUrl: normalizeAiBaseUrl(baseUrl) };
}

/**
 * Writes the provider's refusal to the log and nowhere else. The
 * message on the error is generic and names only the status code, so
 * it is what the Administrator sees. The summary is a short, redacted
 * cut of the provider's own body, which can quote back the key it was
 * handed.
 */
function logUpstreamRefusal(request: FastifyRequest, error: AiProviderError, call: string): void {
  if (!error.upstream) return;
  request.log.warn(
    { providerStatus: error.upstream.status, providerReply: error.upstream.summary },
    `The AI provider refused the ${call}.`,
  );
}

async function lockedConnector(tx: Executor): Promise<AiConnector> {
  const [row] = await tx.select().from(aiConnector).limit(1).for("update");
  if (!row) throw httpError(404, "This install has no AI connector to change.");
  return row;
}

export const aiConnectorRoutes: FastifyPluginAsyncZod = async (app) => {
  async function envelope(
    row: AiConnector | undefined,
  ): Promise<z.infer<typeof ConnectorEnvelope>> {
    const keys = await app.db
      .select()
      .from(aiSavedKeys)
      .orderBy(asc(aiSavedKeys.createdAt), asc(aiSavedKeys.id));
    return { connector: readConnector(row, keys), presets: AI_PRESET_OPTIONS };
  }

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

  app.patch(
    "/ai-connector",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "updateAiAnswerStyle",
        summary: "Set the Organization default answer style",
        tags: ["ai-connector"],
        body: AnswerStyleSchema.strict(),
        response: { 200: ConnectorEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const saved = await app.db.transaction(async (tx) => {
        const current = await lockedConnector(tx);
        if (current.answerStyle === request.body.answerStyle) return current;
        const [row] = await tx
          .update(aiConnector)
          .set(request.body)
          .where(eq(aiConnector.id, current.id))
          .returning();
        if (!row) throw httpError(500, "The AI connector could not be updated.");
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "ai_connector.updated",
          visibility: "admin_only",
          payload: {
            preset: current.preset,
            field: "answerStyle",
            old: current.answerStyle,
            new: row.answerStyle,
          },
        });
        return row;
      });
      return envelope(saved);
    },
  );

  app.patch(
    "/ai-connector/workflows",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "updateAiWorkflows",
        summary: "Update AI workflow settings; an empty body changes nothing",
        tags: ["ai-connector"],
        body: WorkflowSettingsSchema.partial().strict(),
        response: { 200: ConnectorEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const saved = await app.db.transaction(async (tx) => {
        const current = await lockedConnector(tx);
        if (Object.keys(request.body).length === 0) return current;
        const [row] = await tx
          .update(aiConnector)
          .set(request.body)
          .where(eq(aiConnector.id, current.id))
          .returning();
        if (!row) throw httpError(500, "The AI connector could not be updated.");
        for (const field of Object.keys(request.body) as (keyof z.infer<
          typeof WorkflowSettingsSchema
        >)[]) {
          if (current[field] !== row[field])
            await recordActivity(tx, {
              entityType: "system",
              actorId: request.user.id,
              action: "ai_connector.updated",
              visibility: "admin_only",
              payload: { preset: current.preset, field, old: current[field], new: row[field] },
            });
        }
        return row;
      });
      return envelope(saved);
    },
  );

  app.put(
    "/ai-connector",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "saveAiConnector",
        summary:
          "Configure or update the AI connector; a blank API key uses the destination’s Saved key",
        tags: ["ai-connector"],
        body: ConnectorBodySchema,
        response: { 200: ConnectorEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const config = { ...resolvedConfig(request.body), model: request.body.model };
      const apiKey = pasted(request.body.apiKey);
      const saved = await app.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.aiConnectorSave})`);
        const [current] = await tx.select().from(aiConnector).limit(1).for("update");
        let key = await findSavedAiKey(tx, config);
        if (apiKey) {
          const replaced = key !== undefined;
          [key] = key
            ? await tx
                .update(aiSavedKeys)
                .set({ apiKey, baseUrl: config.baseUrl })
                .where(eq(aiSavedKeys.id, key.id))
                .returning()
            : await tx
                .insert(aiSavedKeys)
                .values({
                  preset: config.preset,
                  protocol: config.protocol,
                  baseUrl: config.baseUrl,
                  apiKey,
                })
                .returning();
          if (!key) throw httpError(500, "The Saved key could not be stored.");
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "ai_saved_key.stored",
            visibility: "admin_only",
            payload: {
              preset: config.preset,
              protocol: config.protocol,
              baseUrl: config.baseUrl,
              replaced,
            },
          });
        }
        if (config.preset !== "ollama" && !key?.apiKey) {
          throw httpError(400, "Paste the API key for this provider.");
        }

        if (!current) {
          const [row] = await tx
            .insert(aiConnector)
            .values({
              ...config,
              savedKeyId: key?.id ?? null,
              answerStyle: request.body.answerStyle,
              maxOutputTokens: request.body.maxOutputTokens ?? AI_OUTPUT_TOKEN_DEFAULT,
            })
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

        const [row] = await tx
          .update(aiConnector)
          .set({
            ...config,
            ...(request.body.answerStyle === undefined
              ? {}
              : { answerStyle: request.body.answerStyle }),
            ...(request.body.maxOutputTokens === undefined
              ? {}
              : { maxOutputTokens: request.body.maxOutputTokens }),
            savedKeyId: key?.id ?? null,
            updatedAt: new Date(),
          })
          .where(eq(aiConnector.id, current.id))
          .returning();
        if (!row) throw httpError(500, "The AI connector could not be saved.");

        for (const field of [
          "preset",
          "protocol",
          "baseUrl",
          "model",
          "maxOutputTokens",
          "answerStyle",
        ] as const) {
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
        return row;
      });
      return envelope(saved);
    },
  );

  app.post(
    "/ai-connector/models",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listAiConnectorModels",
        summary: "List models for pending connector settings without saving them",
        tags: ["ai-connector"],
        body: ProviderBodySchema,
        response: {
          200: z.object({
            models: z.array(z.object({ id: z.string(), label: z.string() })),
            truncated: z.boolean(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const config = resolvedConfig(request.body);
      if (config.preset === "azure_openai")
        throw httpError(
          400,
          "Enter the deployment name from Azure manually. This endpoint does not list deployments.",
        );
      const apiKey =
        pasted(request.body.apiKey) ?? ((await findSavedAiKey(app.db, config))?.apiKey || null);
      if (AI_PRESET_DEFINITIONS[config.preset].requiresApiKey && !apiKey)
        throw httpError(400, "Paste the API key for this provider and endpoint to load models.");
      try {
        return await listAiModels({ ...config, apiKey });
      } catch (error) {
        if (error instanceof AiProviderError) {
          logUpstreamRefusal(request, error, "model discovery");
          throw httpError(502, error.message, { expose: true });
        }
        throw error;
      }
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
    async (request) => {
      const provider = await app.resolveAiProvider();
      if (!provider) throw httpError(400, "No enabled AI connector is configured. Save it first.");
      try {
        await provider.probe();
        return { ok: true as const };
      } catch (error) {
        if (error instanceof AiProviderError) {
          logUpstreamRefusal(request, error, "connection test");
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
    "/ai-connector/saved-keys/:id",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "forgetAiSavedKey",
        summary: "Forget one Saved key unless the AI connector references it",
        tags: ["ai-connector"],
        params: z.object({ id: z.uuid() }),
        response: { 200: ConnectorEnvelope, 409: problemResponse, default: problemResponse },
      },
    },
    async (request) => {
      await app.db.transaction(async (tx) => {
        // Saving and forgetting share the lock so a key cannot become referenced after the check.
        await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK.aiConnectorSave})`);
        const [current] = await tx.select().from(aiConnector).limit(1).for("update");
        const [key] = await tx
          .select()
          .from(aiSavedKeys)
          .where(eq(aiSavedKeys.id, request.params.id));
        if (!key) throw httpError(404, "This Saved key no longer exists.");
        if (current?.savedKeyId === key.id) {
          throw httpError(
            409,
            "This Saved key is in use by the AI connector. Remove the connector or choose another destination before forgetting it.",
          );
        }
        await tx.delete(aiSavedKeys).where(eq(aiSavedKeys.id, key.id));
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "ai_saved_key.forgotten",
          visibility: "admin_only",
          payload: {
            preset: key.preset,
            protocol: key.protocol,
            baseUrl: normalizeAiBaseUrl(key.baseUrl),
          },
        });
      });
      return envelope(await stored());
    },
  );

  app.delete(
    "/ai-connector",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "deleteAiConnector",
        summary: "Remove the AI connector, keeping its Saved keys",
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
