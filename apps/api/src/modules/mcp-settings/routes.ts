// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Administrator-only MCP policy (DD-029, SET-002, SET-014).
 * Each changed field writes an org_settings.updated row at admin_only in
 * the same transaction as the policy update (DD-017).
 */
import { orgSettings, eq } from "@openlaw/db";
import { MCP_TOOLSETS } from "@openlaw/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const lifetimeError = "API key lifetime must be a whole number from 1 to 365 days.";
const Policy = z.object({
  enabled: z.boolean(),
  legalApiKeysEnabled: z.boolean(),
  businessApiKeysEnabled: z.boolean(),
  toolsetCeiling: z
    .array(z.enum(MCP_TOOLSETS))
    .max(MCP_TOOLSETS.length)
    .refine(
      (values) => new Set(values).size === values.length,
      "Toolset ceiling cannot contain duplicate Toolsets.",
    ),
  readOnly: z.boolean(),
  apiKeyLifetimeDays: z
    .number({ error: lifetimeError })
    .int({ error: lifetimeError })
    .min(1, { error: lifetimeError })
    .max(365, { error: lifetimeError }),
});
const State = Policy.extend({ serverAddress: z.string() });
const columns = {
  enabled: orgSettings.mcpEnabled,
  legalApiKeysEnabled: orgSettings.mcpLegalApiKeysEnabled,
  businessApiKeysEnabled: orgSettings.mcpBusinessApiKeysEnabled,
  toolsetCeiling: orgSettings.mcpToolsetCeiling,
  readOnly: orgSettings.mcpReadOnly,
  apiKeyLifetimeDays: orgSettings.mcpApiKeyLifetimeDays,
};
const fieldColumns = {
  enabled: "mcpEnabled",
  legalApiKeysEnabled: "mcpLegalApiKeysEnabled",
  businessApiKeysEnabled: "mcpBusinessApiKeysEnabled",
  toolsetCeiling: "mcpToolsetCeiling",
  readOnly: "mcpReadOnly",
  apiKeyLifetimeDays: "mcpApiKeyLifetimeDays",
} as const;

export const mcpSettingsRoutes: FastifyPluginAsyncZod = async (app) => {
  const serverAddress = `${app.baseUrl.replace(/\/$/, "")}/mcp`;
  app.get(
    "/mcp-settings",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getMcpSettings",
        tags: ["mcp-settings"],
        response: { 200: State, default: problemResponse },
      },
    },
    async () => {
      const [row] = await app.db.select(columns).from(orgSettings);
      if (!row) throw httpError(500, "Organization settings are unavailable.");
      return { ...row, serverAddress };
    },
  );
  app.patch(
    "/mcp-settings",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "updateMcpSettings",
        tags: ["mcp-settings"],
        body: Policy.partial()
          .strict()
          .refine(
            (body) => Object.keys(body).length > 0,
            "Name at least one MCP setting to change.",
          ),
        response: { 200: State, default: problemResponse },
      },
    },
    async (request) =>
      app.db.transaction(async (tx) => {
        const [row] = await tx
          .select({ id: orgSettings.id, ...columns })
          .from(orgSettings)
          .for("update");
        if (!row) throw httpError(500, "Organization settings are unavailable.");
        const changes: Partial<typeof orgSettings.$inferInsert> = {};
        for (const field of Object.keys(request.body) as (keyof typeof fieldColumns)[]) {
          const next = request.body[field]!;
          if (JSON.stringify(row[field]) === JSON.stringify(next)) continue;
          Object.assign(changes, { [fieldColumns[field]]: next });
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "org_settings.updated",
            visibility: "admin_only",
            payload: { field: fieldColumns[field], old: row[field], new: next },
          });
        }
        if (Object.keys(changes).length)
          await tx.update(orgSettings).set(changes).where(eq(orgSettings.id, row.id));
        return { ...row, ...request.body, serverAddress };
      }),
  );
};
