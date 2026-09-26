// SPDX-License-Identifier: AGPL-3.0-only

/** DD-029 and SET-014: signed-in people answer consent and revoke their own grants; Administrators list and revoke every grant. */

import {
  allowedClients,
  oauthGrants,
  oauthConsents,
  orgSettings,
  users,
  USER_ROLES,
  eq,
  and,
  isNull,
  gt,
  desc,
  type Executor,
} from "@openlaw/db";
import { MCP_TOOLSETS } from "@openlaw/shared";
import { z } from "zod";
import { APIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireAuth, requireRole, readLiveUser, userColumns } from "../../auth/guards.js";
import { findAllowedClient } from "../../auth/allowed-clients.js";
import { revokeOAuthRefreshTokens } from "../../auth/oauth-grants.js";
import { transactionalOAuth } from "../../auth/oauth-management.js";
import type { Auth } from "../../auth/instance.js";
import { selectableToolsets } from "../../mcp/selectable-toolsets.js";
import { publishLiveEvent } from "../../lib/live-events.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const Query = z.object({ oauth_query: z.string().min(1).max(16000) });
const Choice = z
  .object({
    accept: z.literal(true),
    toolsets: z
      .array(z.enum(MCP_TOOLSETS))
      .min(1)
      .max(MCP_TOOLSETS.length)
      .refine((v) => new Set(v).size === v.length),
    scope: z.enum(["read", "write"]),
    ...Query.shape,
  })
  .strict();
const Answer = z.discriminatedUnion("accept", [
  Choice,
  z.object({ accept: z.literal(false), ...Query.shape }).strict(),
]);
const Refusal = z.enum([
  "expired_query",
  "mcp_disabled",
  "group_disabled",
  "client_unlisted",
  "client_disabled",
]);
const Facts = z.object({
  organizationName: z.string(),
  client: z
    .object({
      id: z.string(),
      name: z.string(),
      kind: z.enum(["published", "registered"]),
      identityCaption: z.string(),
    })
    .nullable(),
  person: z.object({
    id: z.string(),
    displayName: z.string(),
    email: z.string(),
    role: z.enum(USER_ROLES),
    image: z.string().nullable(),
  }),
  toolsets: z.array(z.enum(MCP_TOOLSETS)),
  writeOffered: z.boolean(),
  refusalReason: Refusal.nullable(),
});
const Row = z.object({
  id: z.string(),
  personId: z.string(),
  owner: z.string(),
  clientName: z.string(),
  toolsets: z.array(z.enum(MCP_TOOLSETS)),
  scope: z.enum(["read", "write"]),
  grantedAt: z.string(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
async function validQuery(
  auth: { api: Pick<Auth["api"], "validateOAuthConsentQuery"> },
  oauth_query: string,
  headers: Headers,
) {
  if (!auth.api.validateOAuthConsentQuery) return false;
  try {
    await auth.api.validateOAuthConsentQuery({ body: { oauth_query }, headers });
    return true;
  } catch (error) {
    if (error instanceof APIError && error.body?.error === "invalid_signature") return false;
    throw error;
  }
}
async function facts(
  db: Executor,
  auth: { api: Pick<Auth["api"], "validateOAuthConsentQuery"> },
  personId: string,
  oauth_query: string,
  headers: Headers,
): Promise<z.infer<typeof Facts>> {
  await readLiveUser(db, personId);
  const [person] = await db.select(userColumns).from(users).where(eq(users.id, personId));
  const [policy] = await db.select().from(orgSettings);
  if (!person || !policy) throw httpError(401, "Authentication required.");
  const valid = await validQuery(auth, oauth_query, headers);
  const params = new URLSearchParams(oauth_query);
  const client = valid ? await findAllowedClient(db, params.get("client_id") ?? "") : undefined;
  const refusalReason = !valid
    ? "expired_query"
    : !policy.mcpEnabled
      ? "mcp_disabled"
      : !(person.role === "business_user"
            ? policy.mcpBusinessOAuthClientsEnabled
            : policy.mcpLegalOAuthClientsEnabled)
        ? "group_disabled"
        : !client
          ? "client_unlisted"
          : !client.enabled
            ? "client_disabled"
            : null;
  const requested = params.get("scope")?.split(" ") ?? [];
  return {
    organizationName: policy.name,
    client: client
      ? {
          id: client.id,
          name: client.name,
          kind: client.kind,
          identityCaption: client.metadataUrl ?? client.clientId ?? "",
        }
      : null,
    person,
    toolsets: refusalReason
      ? []
      : selectableToolsets(policy.mcpToolsetCeiling, person.role).filter((id) =>
          requested.includes(`toolset:${id}`),
        ),
    writeOffered: !refusalReason && !policy.mcpReadOnly && requested.includes("write"),
    refusalReason,
  };
}
export function oauthGrantRoutes(lifetimeDays: number): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      "/oauth-grants/consent",
      {
        preHandler: requireAuth,
        schema: {
          tags: ["OAuth grants"],
          querystring: Query,
          response: { 200: Facts, default: problemResponse },
        },
      },
      async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        return facts(
          app.db,
          app.auth,
          req.user.id,
          req.query.oauth_query,
          fromNodeHeaders(req.headers),
        );
      },
    );
    app.post(
      "/oauth-grants/consent",
      {
        preHandler: requireAuth,
        schema: {
          tags: ["OAuth grants"],
          body: Answer,
          response: { 200: z.object({ url: z.string() }), default: problemResponse },
        },
      },
      async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        return app.db.transaction(async (tx) => {
          const auth = transactionalOAuth(app.auth, tx);
          const headers = fromNodeHeaders(req.headers);
          const request = new Request(new URL("/api/auth/oauth2/consent", app.baseUrl), {
            method: "POST",
            headers,
          });
          // Hold policy and identity steady until consent, grant and audit commit.
          await tx.select().from(orgSettings).for("share");
          await tx.select().from(users).where(eq(users.id, req.user.id)).for("share");
          const params = new URLSearchParams(req.body.oauth_query);
          const client = await findAllowedClient(tx, params.get("client_id") ?? "");
          if (client)
            await tx
              .select()
              .from(allowedClients)
              .where(eq(allowedClients.id, client.id))
              .for("update");
          const current = await facts(tx, auth, req.user.id, req.body.oauth_query, headers);
          if (current.refusalReason === "expired_query")
            throw httpError(
              400,
              "This consent request has expired or changed. Start again from your Client.",
            );
          if (!req.body.accept)
            return auth.api.oauth2Consent({
              headers,
              request,
              asResponse: false,
              body: { accept: false, oauth_query: req.body.oauth_query },
            });
          if (current.refusalReason || !current.client)
            throw httpError(403, "This Client cannot connect with your account.");
          if (
            req.body.toolsets.some((t) => !current.toolsets.includes(t)) ||
            (req.body.scope === "write" && !current.writeOffered)
          )
            throw httpError(403, "The chosen Toolsets or scope are not available.");
          await revokeOAuthRefreshTokens(tx, req.user.id, current.client.id);
          const grantedAt = new Date();
          const choice = {
            toolsets: req.body.toolsets,
            scope: req.body.scope,
            grantedAt,
            expiresAt: new Date(grantedAt.getTime() + lifetimeDays * 86400000),
            revokedAt: null,
            revokedBy: null,
            consentId: null,
          };
          const [grant] = await tx
            .insert(oauthGrants)
            .values({ personId: req.user.id, allowedClientId: current.client.id, ...choice })
            .onConflictDoUpdate({
              target: [oauthGrants.personId, oauthGrants.allowedClientId],
              set: choice,
            })
            .returning();
          const scope = [
            ...req.body.toolsets.map((t) => `toolset:${t}`),
            ...(req.body.scope === "write" ? ["write"] : []),
            ...(params.get("scope")?.split(" ").includes("offline_access")
              ? ["offline_access"]
              : []),
          ].join(" ");
          const result = await auth.api.oauth2Consent({
            headers,
            request,
            asResponse: false,
            body: { accept: true, scope, oauth_query: req.body.oauth_query },
          });
          const [consent] = await tx
            .select()
            .from(oauthConsents)
            .where(
              and(
                eq(oauthConsents.userId, req.user.id),
                eq(oauthConsents.clientId, params.get("client_id")!),
              ),
            );
          if (!consent || !new URL(result.url, app.baseUrl).searchParams.has("code"))
            throw httpError(400, "Sign in again before completing consent.");
          await tx
            .update(oauthGrants)
            .set({ consentId: consent.id })
            .where(eq(oauthGrants.id, grant!.id));
          await recordActivity(tx, {
            entityType: "system",
            actorId: req.user.id,
            action: "oauth_grant.granted",
            visibility: "admin_only",
            payload: {
              personId: req.user.id,
              allowedClientId: current.client.id,
              oauthGrantId: grant!.id,
              clientName: current.client.name,
              toolsets: req.body.toolsets,
              scope: req.body.scope,
            },
          });
          return result;
        });
      },
    );
    for (const personal of [true, false]) {
      app.get(
        personal ? "/oauth-grants" : "/mcp-settings/oauth-grants",
        {
          preHandler: personal ? requireAuth : requireRole("administrator"),
          schema: {
            tags: ["OAuth grants"],
            response: { 200: z.array(Row), default: problemResponse },
          },
        },
        async (req, reply) => {
          reply.header("Cache-Control", "no-store");
          const rows = await app.db
            .select({
              grant: oauthGrants,
              owner: users.displayName,
              clientName: allowedClients.name,
            })
            .from(oauthGrants)
            .innerJoin(users, eq(users.id, oauthGrants.personId))
            .innerJoin(allowedClients, eq(allowedClients.id, oauthGrants.allowedClientId))
            .where(
              and(
                personal ? eq(oauthGrants.personId, req.user.id) : undefined,
                isNull(oauthGrants.revokedAt),
                gt(oauthGrants.expiresAt, new Date()),
              ),
            )
            .orderBy(desc(oauthGrants.grantedAt));
          return rows.map(({ grant, owner, clientName }) => ({
            ...grant,
            owner,
            clientName,
            grantedAt: grant.grantedAt.toISOString(),
            expiresAt: grant.expiresAt.toISOString(),
            lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
          }));
        },
      );
    }
    app.post(
      "/oauth-grants/:id/revoke",
      {
        preHandler: requireAuth,
        schema: {
          tags: ["OAuth grants"],
          params: z.object({ id: z.uuid() }),
          response: { 200: z.object({ revoked: z.literal(true) }), default: problemResponse },
        },
      },
      async (req) => {
        return app.db.transaction(async (tx) => {
          const [grant] = await tx
            .select()
            .from(oauthGrants)
            .where(eq(oauthGrants.id, req.params.id))
            .for("update");
          if (!grant || (req.user.role !== "administrator" && grant.personId !== req.user.id))
            throw httpError(404, "OAuth grant not found.");
          if (!grant.revokedAt) {
            await tx
              .update(oauthGrants)
              .set({ revokedAt: new Date(), revokedBy: req.user.id })
              .where(eq(oauthGrants.id, grant.id));
            await revokeOAuthRefreshTokens(tx, grant.personId, grant.allowedClientId);
            await publishLiveEvent(tx, {
              kind: "mcp",
              change: "revocation",
              credentialIds: [grant.id],
            });
            const [client] = await tx
              .select()
              .from(allowedClients)
              .where(eq(allowedClients.id, grant.allowedClientId));
            await recordActivity(tx, {
              entityType: "system",
              actorId: req.user.id,
              action: "oauth_grant.revoked",
              visibility: "admin_only",
              payload: {
                clientName: client!.name,
                oauthGrantId: grant.id,
                personId: grant.personId,
                allowedClientId: grant.allowedClientId,
              },
            });
          }
          return { revoked: true as const };
        });
      },
    );
  };
}
