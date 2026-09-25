// SPDX-License-Identifier: AGPL-3.0-only
import {
  allowedClients,
  allowedClientLinks,
  orgSettings,
  eq,
  and,
  type Executor,
} from "@openlaw/db";
import { APIError, createAuthMiddleware, createAuthEndpoint } from "better-auth/api";
import { z } from "zod";
import { recordActivity } from "../lib/activity.js";

export const CHATGPT_METADATA = "https://chatgpt.com/oauth/client.json";
const chatgptConnection = /^https:\/\/chatgpt\.com\/oauth\/[A-Za-z0-9_-]+\/client\.json$/;
export async function findAllowedClient(db: Executor, clientId: string) {
  const metadataUrl = chatgptConnection.test(clientId) ? CHATGPT_METADATA : clientId;
  const [published] = await db
    .select()
    .from(allowedClients)
    .where(and(eq(allowedClients.kind, "published"), eq(allowedClients.metadataUrl, metadataUrl)));
  if (published) return published;
  const [registered] = await db
    .select()
    .from(allowedClients)
    .where(and(eq(allowedClients.kind, "registered"), eq(allowedClients.clientId, clientId)));
  return registered;
}
export function allowedRedirect(client: typeof allowedClients.$inferSelect, redirect: string) {
  if (client.kind === "registered") return client.callbackUrls.filter(Boolean).includes(redirect);
  switch (client.metadataUrl) {
    case "https://claude.ai/oauth/mcp-oauth-client-metadata":
      return redirect === "https://claude.ai/api/mcp/auth_callback";
    case "https://claude.ai/oauth/claude-code-client-metadata":
      return /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?\/callback$/.test(redirect);
    case CHATGPT_METADATA:
      return (
        redirect === "https://chatgpt.com/connector_platform_oauth_redirect" ||
        /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(redirect)
      );
    default:
      return false;
  }
}
export async function dynamicRegistrationEnabled(db: Executor) {
  const [row] = await db
    .select({ enabled: orgSettings.mcpDynamicClientRegistrationEnabled })
    .from(orgSettings);
  return row?.enabled ?? false;
}
export async function linkPublishedClient(db: Executor, clientId: string) {
  await db.transaction(async (tx) => {
    const identity = await findAllowedClient(tx, clientId);
    if (!identity || identity.kind !== "published") return;
    const [row] = await tx
      .select()
      .from(allowedClients)
      .where(eq(allowedClients.id, identity.id))
      .for("update");
    if (!row) return;
    const links = await tx
      .insert(allowedClientLinks)
      .values({ clientId, allowedClientId: row.id })
      .onConflictDoNothing()
      .returning();
    if (links.length)
      await recordActivity(tx, {
        entityType: "system",
        action: "allowed_client.linked",
        visibility: "admin_only",
        payload: { allowedClientId: row.id, clientName: row.name, clientId },
      });
  });
}

/** 1.7.5 has no client-disable endpoint. This server-only plugin extension uses its adapter. */
export function allowedClientsPlugin(db: Executor) {
  return {
    id: "allowed-clients" as const,
    endpoints: {
      setOAuthClientEnabled: createAuthEndpoint(
        "/admin/oauth2/client-enabled",
        {
          method: "POST",
          metadata: { SERVER_ONLY: true },
          body: z.object({ clientId: z.string(), enabled: z.boolean() }),
        },
        async (ctx) => {
          await ctx.context.adapter.update({
            model: "oauthClient",
            where: [{ field: "clientId", value: ctx.body.clientId }],
            update: { disabled: !ctx.body.enabled },
          });
          return { success: true };
        },
      ),
    },
    hooks: {
      before: [
        {
          matcher: (ctx: { path?: string }) =>
            ctx.path === "/oauth2/authorize" || ctx.path === "/oauth2/register",
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.path === "/oauth2/register") {
              if (!(await dynamicRegistrationEnabled(db)))
                throw new APIError("FORBIDDEN", {
                  error: "access_denied",
                  error_description: "Dynamic Client registration is disabled.",
                });
              return;
            }
            const clientId = ctx.query?.client_id;
            const redirect = ctx.query?.redirect_uri;
            const client =
              typeof clientId === "string" ? await findAllowedClient(db, clientId) : undefined;
            if (!client?.enabled)
              throw new APIError("BAD_REQUEST", {
                error: "invalid_client",
                error_description: "Client is not on the enabled Allowed Clients list.",
              });
            if (typeof redirect !== "string" || !allowedRedirect(client, redirect))
              throw new APIError("BAD_REQUEST", {
                error: "invalid_request",
                error_description: "Callback URL is not allowed for this Client.",
              });
          }),
        },
      ],
      after: [
        {
          matcher: (ctx: { path?: string }) =>
            ctx.path === "/oauth2/register" || ctx.path === "/oauth2/authorize",
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.path === "/oauth2/authorize") {
              const clientId = ctx.query?.client_id;
              if (typeof clientId !== "string" || ctx.context.returned instanceof APIError) return;
              const client = await findAllowedClient(db, clientId);
              if (!client?.enabled)
                throw new APIError("BAD_REQUEST", {
                  error: "invalid_client",
                  error_description: "Client is no longer enabled.",
                });
              // CIMD notifications are best effort. Authorization must not succeed without its link.
              if (client.kind === "published") await linkPublishedClient(db, clientId);
              return;
            }
            const result = ctx.context.returned as
              | {
                  client_id?: string;
                  client_secret?: string;
                  client_name?: string;
                  redirect_uris?: string[];
                }
              | undefined;
            if (!result?.client_id) return;
            await ctx.context.adapter.update({
              model: "oauthClient",
              where: [{ field: "clientId", value: result.client_id }],
              update: { referenceId: "openlaw", userId: null },
            });
            const [row] = await db
              .insert(allowedClients)
              .values({
                name: result.client_name || "Registered Client",
                kind: "registered",
                clientId: result.client_id,
                callbackUrls: result.redirect_uris ?? [],
                registeredByClient: true,
                secretGeneratedAt: result.client_secret ? new Date() : null,
              })
              .returning();
            if (!row) throw new Error("Allowed Client was not created.");
            await db
              .insert(allowedClientLinks)
              .values({ clientId: result.client_id, allowedClientId: row.id });
            await recordActivity(db, {
              entityType: "system",
              action: "allowed_client.created",
              visibility: "admin_only",
              payload: { allowedClientId: row.id, clientName: row.name, registeredByClient: true },
            });
          }),
        },
      ],
    },
  };
}
