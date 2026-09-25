// SPDX-License-Identifier: AGPL-3.0-only

/** DD-029 and TECH-035: resolve live grants, end refresh access, and require a current grant when the provider issues tokens. */

import {
  allowedClientLinks,
  allowedClients,
  oauthGrants,
  oauthConsents,
  oauthRefreshTokens,
  orgSettings,
  eq,
  and,
  isNull,
  gt,
  type Executor,
} from "@openlaw/db";

type AllowedClient = typeof allowedClients.$inferSelect;
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { decodeJwt } from "jose";
import { z } from "zod";
import { findAllowedClient } from "./allowed-clients.js";
import { readLiveUser } from "./live-user.js";
import { HttpError, httpError } from "../lib/problem.js";

export async function liveOAuthGrant(db: Executor, personId: string, clientId: string) {
  return liveOAuthGrantFor(db, personId, await findAllowedClient(db, clientId));
}

/** The same checks for a grant whose Allowed Client row is already known, as on a signed upload. */
export async function liveOAuthGrantFor(
  db: Executor,
  personId: string,
  client: AllowedClient | undefined,
) {
  if (!client?.enabled) throw httpError(401, "Authentication required.");
  const [grant] = await db
    .select()
    .from(oauthGrants)
    .where(and(eq(oauthGrants.personId, personId), eq(oauthGrants.allowedClientId, client.id)));
  if (!grant || grant.revokedAt || grant.expiresAt <= new Date())
    throw httpError(401, "Authentication required.");
  const user = await readLiveUser(db, personId);
  const [policy] = await db.select().from(orgSettings);
  if (
    !policy?.mcpEnabled ||
    !(user.role === "business_user"
      ? policy.mcpBusinessOAuthClientsEnabled
      : policy.mcpLegalOAuthClientsEnabled)
  )
    throw httpError(401, "Authentication required.");
  return { grant, client, user, policy };
}

export async function revokeOAuthRefreshTokens(
  db: Executor,
  personId: string,
  allowedClientId: string,
) {
  const links = await db
    .select()
    .from(allowedClientLinks)
    .where(eq(allowedClientLinks.allowedClientId, allowedClientId));
  for (const link of links) {
    await db
      .update(oauthRefreshTokens)
      .set({ revoked: new Date() })
      .where(
        and(
          eq(oauthRefreshTokens.userId, personId),
          eq(oauthRefreshTokens.clientId, link.clientId),
          isNull(oauthRefreshTokens.revoked),
        ),
      );
    await db
      .delete(oauthConsents)
      .where(and(eq(oauthConsents.userId, personId), eq(oauthConsents.clientId, link.clientId)));
  }
}

export function oauthGrantsPlugin(db: Executor, resource: string) {
  return {
    id: "oauth-grants" as const,
    endpoints: {
      // The provider's before hook verifies oauth_query, including its signature and expiry.
      validateOAuthConsentQuery: createAuthEndpoint(
        "/openlaw/validate-consent-query",
        {
          method: "POST",
          metadata: { SERVER_ONLY: true },
          body: z.object({ oauth_query: z.string().min(1) }),
        },
        async () => ({ valid: true }),
      ),
    },
    hooks: {
      before: [
        {
          matcher: (ctx: { path?: string }) => ctx.path === "/oauth2/token",
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.body && ctx.body.resource === undefined) ctx.body.resource = resource;
          }),
        },
        {
          matcher: (ctx: { path?: string }) => ctx.path === "/oauth2/authorize",
          handler: createAuthMiddleware(async (ctx) => {
            const clientId = (ctx.method === "POST" ? ctx.body : ctx.query)?.client_id;
            if (typeof clientId !== "string") return;
            const client = await findAllowedClient(db, clientId);
            if (!client) return;
            const session = await getSessionFromCtx(ctx);
            if (!session) return;
            const [grant] = await db
              .select()
              .from(oauthGrants)
              .where(
                and(
                  eq(oauthGrants.allowedClientId, client.id),
                  eq(oauthGrants.personId, session.user.id),
                ),
              );
            // A remembered consent cannot replace a missing or ended grant.
            if (!grant || grant.revokedAt || grant.expiresAt <= new Date()) {
              await db
                .delete(oauthConsents)
                .where(
                  and(
                    eq(oauthConsents.clientId, clientId),
                    eq(oauthConsents.userId, session.user.id),
                  ),
                );
            }
          }),
        },
      ],
      after: [
        {
          matcher: (ctx: { path?: string }) => ctx.path === "/oauth2/token",
          handler: createAuthMiddleware(async (ctx) => {
            const result = ctx.context.returned as { access_token?: string } | undefined;
            if (!result?.access_token) return;
            const invalidGrant = () =>
              new APIError("BAD_REQUEST", {
                error: "invalid_grant",
                error_description: "A new consent is required.",
              });
            const claims = decodeJwt(result.access_token);
            if (typeof claims.sub !== "string" || typeof claims.client_id !== "string")
              throw invalidGrant();
            const { grant } = await liveOAuthGrant(db, claims.sub, claims.client_id).catch(
              (error: unknown) => {
                if (error instanceof HttpError && error.statusCode === 401) throw invalidGrant();
                throw error;
              },
            );
            // Rotation retains the consent's absolute end date.
            await db
              .update(oauthRefreshTokens)
              .set({ expiresAt: grant.expiresAt })
              .where(
                and(
                  eq(oauthRefreshTokens.userId, claims.sub),
                  eq(oauthRefreshTokens.clientId, claims.client_id),
                  gt(oauthRefreshTokens.expiresAt, grant.expiresAt),
                ),
              );
          }),
        },
      ],
    },
  };
}
