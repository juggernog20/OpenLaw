// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Administrator-only routes for the Allowed Clients list: create, edit, toggle,
 * delete, and the once-shown secret. Registered clients are created and updated
 * through the plugin server API. See DD-029, DD-013 and TECH-035.
 */
import {
  allowedClients,
  allowedClientLinks,
  eq,
  asc,
  type Executor,
  type Transaction,
} from "@openlaw/db";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole } from "../../auth/guards.js";
import { transactionalOAuth } from "../../auth/oauth-management.js";
import { MCP_SCOPES, authorizationServerAvailable } from "../../auth/oauth.js";
import { publishLiveEvent } from "../../lib/live-events.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

export const AllowedClient = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["published", "registered"]),
  metadataUrl: z.string().nullable(),
  clientId: z.string().nullable(),
  enabled: z.boolean(),
  seeded: z.boolean(),
  callbackUrls: z.array(z.string()),
  secretGeneratedAt: z.iso.datetime().nullable(),
  registeredByClient: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const serializeAllowedClient = (row: typeof allowedClients.$inferSelect) => ({
  ...row,
  secretGeneratedAt: row.secretGeneratedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});
/** Seed order first, then creation order. Postgres moves an updated row without this. */
export async function listAllowedClients(db: Executor) {
  const rows = await db
    .select()
    .from(allowedClients)
    .orderBy(asc(allowedClients.createdAt), asc(allowedClients.id));
  return rows.map(serializeAllowedClient);
}
const callback = z
  .string()
  .max(2048)
  .refine((value) => {
    if (value === "") return true;
    try {
      const url = new URL(value);
      return (
        ((url.protocol === "https:" &&
          !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
        !url.username &&
        !url.password &&
        !value.includes("#")
      );
    } catch {
      return false;
    }
  }, "Use an HTTPS callback URL, or HTTP on loopback, without credentials or a fragment.");
const callbacks = z
  .array(callback)
  .min(1)
  .max(20)
  .refine(
    (values) => values.some(Boolean) && new Set(values).size === values.length,
    "Add at least one callback URL without duplicates.",
  );
const Create = z
  .object({ name: z.string().trim().min(1).max(200), callbackUrls: callbacks })
  .strict();
const params = z.object({ id: z.string() });
const copilotCallbacks = [
  "https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect",
  "https://vscode.dev/redirect",
];
async function locked(tx: Transaction, id: string) {
  const [row] = await tx
    .select()
    .from(allowedClients)
    .where(eq(allowedClients.id, id))
    .for("update");
  if (!row) throw httpError(404, "Allowed Client not found.");
  return row;
}
export const allowedClientRoutes: FastifyPluginAsyncZod = async (app) => {
  const path = "/mcp-settings/allowed-clients";
  const guard = requireRole("administrator");
  const schema = {
    tags: ["mcp-settings"],
    response: { 200: AllowedClient, default: problemResponse },
  };
  app.get(
    path,
    {
      preHandler: guard,
      schema: {
        ...schema,
        operationId: "listAllowedClients",
        response: { 200: z.array(AllowedClient), default: problemResponse },
      },
    },
    async () => listAllowedClients(app.db),
  );
  app.post(
    path,
    {
      preHandler: guard,
      schema: {
        ...schema,
        operationId: "createAllowedClient",
        body: Create,
        response: { 201: AllowedClient, default: problemResponse },
      },
    },
    async (request, reply) => {
      if (!authorizationServerAvailable(app.baseUrl))
        throw httpError(400, "Configure HTTPS before creating an OAuth Client.");
      const row = await app.db.transaction(async (tx) => {
        const auth = transactionalOAuth(app.auth, tx);
        const client = await auth.api.adminCreateOAuthClient({
          headers: fromNodeHeaders(request.headers),
          body: {
            client_name: request.body.name,
            redirect_uris: request.body.callbackUrls.filter(Boolean),
            application_type: "native",
            token_endpoint_auth_method: "client_secret_post",
            grant_types: ["authorization_code", "refresh_token"],
            scope: MCP_SCOPES.join(" "),
          },
        });
        const [created] = await tx
          .insert(allowedClients)
          .values({
            ...request.body,
            kind: "registered",
            clientId: client.client_id,
            createdBy: request.user.id,
          })
          .returning();
        if (!created) throw httpError(500, "Allowed Client was not created.");
        await tx
          .insert(allowedClientLinks)
          .values({ clientId: client.client_id, allowedClientId: created.id });
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "allowed_client.created",
          visibility: "admin_only",
          payload: {
            allowedClientId: created.id,
            clientName: created.name,
            callbackUrls: created.callbackUrls,
          },
        });
        return created;
      });
      return reply.code(201).send(serializeAllowedClient(row));
    },
  );
  app.patch(
    `${path}/:id`,
    {
      preHandler: guard,
      schema: {
        ...schema,
        operationId: "updateAllowedClient",
        params,
        body: Create.partial()
          .extend({ enabled: z.boolean().optional() })
          .strict()
          .refine((body) => Object.keys(body).length > 0),
      },
    },
    async (request) => {
      const result = await app.db.transaction(async (tx) => {
        const row = await locked(tx, request.params.id);
        const body = request.body;
        if (
          row.kind === "published" &&
          (body.name !== undefined || body.callbackUrls !== undefined)
        )
          throw httpError(400, "Published identities are not editable.");
        if (
          row.seeded &&
          row.kind === "registered" &&
          body.callbackUrls &&
          !copilotCallbacks.every((url) => body.callbackUrls!.includes(url))
        )
          throw httpError(400, "Keep the fixed Microsoft 365 Copilot callback URLs.");
        // Without the authorization server the plugin API is absent; the row still changes.
        const oauth = authorizationServerAvailable(app.baseUrl);
        const auth = transactionalOAuth(app.auth, tx);
        if (oauth && row.clientId && (body.name !== undefined || body.callbackUrls !== undefined))
          await auth.api.adminUpdateOAuthClient({
            headers: fromNodeHeaders(request.headers),
            body: {
              client_id: row.clientId,
              update: { client_name: body.name, redirect_uris: body.callbackUrls?.filter(Boolean) },
            },
          });
        if (oauth && body.enabled !== undefined) {
          const links = await tx
            .select()
            .from(allowedClientLinks)
            .where(eq(allowedClientLinks.allowedClientId, row.id));
          for (const link of links)
            await auth.api.setOAuthClientEnabled({
              body: { clientId: link.clientId, enabled: body.enabled },
            });
        }
        const [updated] = await tx
          .update(allowedClients)
          .set(body)
          .where(eq(allowedClients.id, row.id))
          .returning();
        if (!updated) throw httpError(500, "Allowed Client was not updated.");
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: body.enabled !== undefined ? "allowed_client.toggled" : "allowed_client.updated",
          visibility: "admin_only",
          payload: { allowedClientId: row.id, clientName: updated.name, ...body },
        });
        if (body.enabled !== undefined && body.enabled !== row.enabled)
          await publishLiveEvent(tx, { kind: "mcp", change: "policy" });
        return updated;
      });
      return serializeAllowedClient(result);
    },
  );
  app.post(
    `${path}/:id/secret`,
    {
      preHandler: guard,
      schema: {
        ...schema,
        operationId: "generateAllowedClientSecret",
        params,
        response: {
          200: z.object({ clientId: z.string(), secret: z.string() }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      if (!authorizationServerAvailable(app.baseUrl))
        throw httpError(400, "Configure HTTPS before generating a Client secret.");
      const result = await app.db.transaction(async (tx) => {
        const row = await locked(tx, request.params.id);
        if (row.kind !== "registered")
          throw httpError(400, "Published identities have no Client secret.");
        const auth = transactionalOAuth(app.auth, tx);
        const headers = fromNodeHeaders(request.headers);
        const client = row.clientId
          ? await auth.api.rotateClientSecret({ headers, body: { client_id: row.clientId } })
          : await auth.api.adminCreateOAuthClient({
              headers,
              body: {
                client_name: row.name,
                redirect_uris: row.callbackUrls.filter(Boolean),
                application_type: "native",
                token_endpoint_auth_method: "client_secret_post",
                grant_types: ["authorization_code", "refresh_token"],
                scope: MCP_SCOPES.join(" "),
              },
            });
        if (!client.client_secret)
          throw httpError(400, "This Client does not use a client secret.");
        await tx
          .update(allowedClients)
          .set({ clientId: client.client_id, secretGeneratedAt: new Date() })
          .where(eq(allowedClients.id, row.id));
        await tx
          .insert(allowedClientLinks)
          .values({ clientId: client.client_id, allowedClientId: row.id })
          .onConflictDoNothing();
        await auth.api.setOAuthClientEnabled({
          body: { clientId: client.client_id, enabled: row.enabled },
        });
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "allowed_client.secret_generated",
          visibility: "admin_only",
          payload: { allowedClientId: row.id, clientName: row.name },
        });
        return { clientId: client.client_id, secret: client.client_secret };
      });
      reply.header("cache-control", "no-store");
      return result;
    },
  );
  app.delete(
    `${path}/:id`,
    {
      preHandler: guard,
      schema: {
        ...schema,
        operationId: "deleteAllowedClient",
        params,
        response: { 204: z.null(), default: problemResponse },
      },
    },
    async (request, reply) => {
      await app.db.transaction(async (tx) => {
        const row = await locked(tx, request.params.id);
        if (row.seeded || row.kind !== "registered")
          throw httpError(400, "Seeded Clients cannot be deleted.");
        // Keep the protocol row for existing consent and token references. It cannot authorize again.
        if (row.clientId && authorizationServerAvailable(app.baseUrl))
          await transactionalOAuth(app.auth, tx).api.setOAuthClientEnabled({
            body: { clientId: row.clientId, enabled: false },
          });
        await publishLiveEvent(tx, { kind: "mcp", change: "policy" });
        await tx.delete(allowedClients).where(eq(allowedClients.id, row.id));
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "allowed_client.deleted",
          visibility: "admin_only",
          payload: { allowedClientId: row.id, clientName: row.name },
        });
      });
      return reply.code(204).send(null);
    },
  );
};
