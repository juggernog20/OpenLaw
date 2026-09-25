// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TECH-035 API key authentication. Approval, revocation, expiry and owner match
 * precede the shared live-user read. Archival, the master switch and the current
 * account group's switch can refuse each request without a server restart.
 */

import {
  and,
  apiKeyRequests,
  apikeys,
  eq,
  isNull,
  orgSettings,
  oauthGrants,
  allowedClients,
} from "@openlaw/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createLocalJWKSet, jwtVerify } from "jose";
import { MCP_TOOLSETS } from "@openlaw/shared";
import { authorizationServerAvailable, mcpResource } from "../auth/oauth.js";
import { liveOAuthGrant, liveOAuthGrantFor } from "../auth/oauth-grants.js";
import { API_KEY_PREFIX } from "../auth/api-keys.js";
import { readLiveUser } from "../auth/guards.js";
import { httpError } from "../lib/problem.js";
import type { ToolContext } from "./register.js";

/** Verify locally against the same public keys published by better-auth at /jwks. */
export async function verifyMcpJwt(server: FastifyInstance, token: string) {
  if (!authorizationServerAvailable(server.baseUrl))
    throw httpError(401, "Authentication required.");
  const keys = await server.auth.api.getJwks();
  try {
    const verified = await jwtVerify(token, createLocalJWKSet(keys), {
      issuer: `${server.baseUrl.replace(/\/$/, "")}/api/auth`,
      audience: mcpResource(server.baseUrl),
      requiredClaims: ["exp"],
    });
    return verified.payload;
  } catch {
    throw httpError(401, "Authentication required.");
  }
}

export async function authenticateMcp(request: FastifyRequest): Promise<ToolContext> {
  const header = request.headers["x-api-key"];
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1];
  const token = typeof header === "string" ? header : bearer;
  if (!token) throw httpError(401, "Authentication required.");
  if (token.startsWith(API_KEY_PREFIX)) return authenticateKey(request);
  const claims = await verifyMcpJwt(request.server, token);
  if (
    typeof claims.sub !== "string" ||
    typeof claims.client_id !== "string" ||
    typeof claims.scope !== "string"
  )
    throw httpError(401, "Authentication required.");
  const context = await readOAuthContext(request.server, claims.sub, claims.client_id);
  const scopes = claims.scope.split(" ");
  context.grant.toolsets = context.grant.toolsets.filter(
    (t) => t === "guide" || scopes.includes(`toolset:${t}`),
  );
  if (!scopes.includes("write")) context.grant.scope = "read";
  await request.server.db
    .update(oauthGrants)
    .set({ lastUsedAt: new Date() })
    .where(eq(oauthGrants.id, context.credentialId));
  return context;
}

export async function mcpChallenge(server: FastifyInstance): Promise<string> {
  const [policy] = await server.db
    .select({
      ceiling: orgSettings.mcpToolsetCeiling,
      readOnly: orgSettings.mcpReadOnly,
    })
    .from(orgSettings)
    .limit(1);
  const scopes = [
    ...MCP_TOOLSETS.filter((id) => policy?.ceiling.includes(id)).map((id) => `toolset:${id}`),
    ...(policy && !policy.readOnly ? ["write"] : []),
    "offline_access",
  ];
  const metadata = new URL("/.well-known/oauth-protected-resource", server.baseUrl).href;
  return `Bearer resource_metadata="${metadata}" scope="${scopes.join(" ")}"`;
}

export async function authenticateKey(request: FastifyRequest): Promise<ToolContext> {
  const header = request.headers["x-api-key"];
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1];
  const key = typeof header === "string" ? header : bearer;
  if (!key?.startsWith(API_KEY_PREFIX)) throw httpError(401, "Authentication required.");
  const verified = await request.server.auth.api.verifyApiKey({ body: { key } });
  if (!verified.valid || !verified.key) throw httpError(401, "Authentication required.");
  return readCredentialContext(request.server, verified.key.id);
}

/** Revalidate a signed upload against its live credential without accepting another credential. */
export async function readCredentialContext(
  server: FastifyInstance,
  credentialId: string,
): Promise<ToolContext> {
  const db = server.db;
  const [oauthGrant] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, credentialId));
  if (oauthGrant) {
    const [client] = await db
      .select()
      .from(allowedClients)
      .where(eq(allowedClients.id, oauthGrant.allowedClientId));
    return oauthContext(server, await liveOAuthGrantFor(db, oauthGrant.personId, client));
  }
  const [approved] = await db
    .select({ request: apiKeyRequests, credential: apikeys })
    .from(apiKeyRequests)
    .innerJoin(apikeys, eq(apikeys.id, apiKeyRequests.keyId))
    .where(
      and(
        eq(apikeys.id, credentialId),
        eq(apiKeyRequests.status, "approved"),
        isNull(apiKeyRequests.revokedAt),
      ),
    );
  if (
    !approved ||
    !approved.credential.enabled ||
    !approved.credential.expiresAt ||
    approved.credential.expiresAt <= new Date() ||
    approved.request.requesterId !== approved.credential.referenceId
  )
    throw httpError(401, "Authentication required.");
  const user = await readLiveUser(db, approved.credential.referenceId);
  const [policy] = await db.select().from(orgSettings).limit(1);
  if (
    !policy?.mcpEnabled ||
    !(user.role === "business_user"
      ? policy.mcpBusinessApiKeysEnabled
      : policy.mcpLegalApiKeysEnabled)
  )
    throw httpError(401, "Authentication required.");
  return {
    db,
    notifier: server.notifier,
    jobs: server.jobs,
    resolveAiProvider: server.resolveAiProvider,
    user: {
      ...user,
      via: { kind: "api_key", id: approved.credential.id, clientName: approved.request.clientName },
    },
    credentialId: approved.credential.id,
    clientName: approved.request.clientName,
    organizationName: policy.name,
    baseUrl: server.baseUrl,
    grant: {
      role: user.role,
      toolsets: [
        "guide",
        ...approved.request.toolsets.filter((t) => policy.mcpToolsetCeiling.includes(t)),
      ],
      scope: policy.mcpReadOnly ? "read" : approved.request.scope,
    },
  };
}

async function readOAuthContext(
  server: FastifyInstance,
  personId: string,
  clientId: string,
): Promise<ToolContext> {
  return oauthContext(server, await liveOAuthGrant(server.db, personId, clientId));
}

function oauthContext(
  server: FastifyInstance,
  { grant, user, client, policy }: Awaited<ReturnType<typeof liveOAuthGrant>>,
): ToolContext {
  return {
    db: server.db,
    notifier: server.notifier,
    jobs: server.jobs,
    resolveAiProvider: server.resolveAiProvider,
    user: { ...user, via: { kind: "oauth_client", id: grant.id, clientName: client.name } },
    credentialId: grant.id,
    clientName: client.name,
    organizationName: policy.name,
    baseUrl: server.baseUrl,
    grant: {
      role: user.role,
      toolsets: ["guide", ...grant.toolsets.filter((t) => policy.mcpToolsetCeiling.includes(t))],
      scope: policy.mcpReadOnly ? "read" : grant.scope,
    },
  };
}
