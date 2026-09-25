// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Administrator-only MCP policy (DD-029, SET-002, SET-014).
 * Each changed field writes an org_settings.updated row at admin_only in
 * the same transaction as the policy update (DD-017).
 */
import { allowedClients, orgSettings, eq } from "@openlaw/db";
import { MCP_TOOLSETS, MCP_OAUTH_UNAVAILABLE_PROBLEM } from "@openlaw/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { authorizationServerAvailable } from "../../auth/oauth.js";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse, problemTypeResponse } from "../../lib/problem.js";

import { createReachabilityCheck, Reachability, type ResolveIpv4 } from "./reachability.js";

import { AllowedClient, serializeAllowedClient } from "./allowed-clients.js";

const lifetimeError = "API key lifetime must be a whole number from 1 to 365 days.";
const Policy = z.object({
  enabled: z.boolean(),
  dynamicClientRegistrationEnabled: z.boolean(),
  legalApiKeysEnabled: z.boolean(),
  businessApiKeysEnabled: z.boolean(),
  legalOAuthClientsEnabled: z.boolean(),
  businessOAuthClientsEnabled: z.boolean(),
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
const State = Policy.extend({
  reachability: Reachability.nullable(),
  allowedClients: z.array(AllowedClient),
  serverAddress: z.string(),
  authorizationServerAvailable: z.boolean(),
});
const columns = {
  enabled: orgSettings.mcpEnabled,
  dynamicClientRegistrationEnabled: orgSettings.mcpDynamicClientRegistrationEnabled,
  legalApiKeysEnabled: orgSettings.mcpLegalApiKeysEnabled,
  businessApiKeysEnabled: orgSettings.mcpBusinessApiKeysEnabled,
  legalOAuthClientsEnabled: orgSettings.mcpLegalOAuthClientsEnabled,
  businessOAuthClientsEnabled: orgSettings.mcpBusinessOAuthClientsEnabled,
  toolsetCeiling: orgSettings.mcpToolsetCeiling,
  readOnly: orgSettings.mcpReadOnly,
  apiKeyLifetimeDays: orgSettings.mcpApiKeyLifetimeDays,
};
const fieldColumns = {
  enabled: "mcpEnabled",
  dynamicClientRegistrationEnabled: "mcpDynamicClientRegistrationEnabled",
  legalApiKeysEnabled: "mcpLegalApiKeysEnabled",
  businessApiKeysEnabled: "mcpBusinessApiKeysEnabled",
  legalOAuthClientsEnabled: "mcpLegalOAuthClientsEnabled",
  businessOAuthClientsEnabled: "mcpBusinessOAuthClientsEnabled",
  toolsetCeiling: "mcpToolsetCeiling",
  readOnly: "mcpReadOnly",
  apiKeyLifetimeDays: "mcpApiKeyLifetimeDays",
} as const;

export function mcpSettingsRoutes(resolveIpv4?: ResolveIpv4): FastifyPluginAsyncZod {
  return async (app) => {
    const check = createReachabilityCheck(app.baseUrl, resolveIpv4);
    const reachability = (row: z.infer<typeof Policy>) =>
      row.legalOAuthClientsEnabled || row.businessOAuthClientsEnabled ? check() : null;
    const available = authorizationServerAvailable(app.baseUrl);
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
        return {
          ...row,
          allowedClients: (await app.db.select().from(allowedClients)).map(serializeAllowedClient),
          serverAddress,
          authorizationServerAvailable: available,
          reachability: await reachability(row),
        };
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
          response: {
            200: State,
            400: problemTypeResponse(
              "OAuth authorization server unavailable",
              [MCP_OAUTH_UNAVAILABLE_PROBLEM],
              { reachability: Reachability.optional() },
            ),
            default: problemResponse,
          },
        },
      },
      async (request) => {
        if (
          !available &&
          (request.body.legalOAuthClientsEnabled || request.body.businessOAuthClientsEnabled)
        )
          throw httpError(
            400,
            `BASE_URL scheme ${new URL(app.baseUrl).protocol} prevented the OAuth authorization server from starting. Configure HTTPS and restart before enabling OAuth Clients.`,
            {
              type: MCP_OAUTH_UNAVAILABLE_PROBLEM,
              extensions: { reachability: await check() },
            },
          );
        const result = await app.db.transaction(async (tx) => {
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
          return {
            ...row,
            ...request.body,
            serverAddress,
            authorizationServerAvailable: available,
          };
        });
        return {
          ...result,
          allowedClients: (await app.db.select().from(allowedClients)).map(serializeAllowedClient),
          reachability: await reachability(result),
        };
      },
    );
  };
}
