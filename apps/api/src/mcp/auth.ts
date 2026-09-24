// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TECH-035 API key authentication. Approval, revocation, expiry and owner match
 * precede the shared live-user read. Archival, the master switch and the current
 * account group's switch can refuse each request without a server restart.
 */

import { and, apiKeyRequests, apikeys, eq, isNull, orgSettings } from "@openlaw/db";
import type { FastifyRequest } from "fastify";
import { API_KEY_PREFIX } from "../auth/api-keys.js";
import { readLiveUser } from "../auth/guards.js";
import { httpError } from "../lib/problem.js";
import type { ToolContext } from "./register.js";

export async function authenticateKey(request: FastifyRequest): Promise<ToolContext> {
  const header = request.headers["x-api-key"];
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1];
  const key = typeof header === "string" ? header : bearer;
  if (!key?.startsWith(API_KEY_PREFIX)) throw httpError(401, "Authentication required.");
  const verified = await request.server.auth.api.verifyApiKey({ body: { key } });
  if (!verified.valid || !verified.key) throw httpError(401, "Authentication required.");
  const db = request.server.db;
  const [approved] = await db
    .select({ request: apiKeyRequests, credential: apikeys })
    .from(apiKeyRequests)
    .innerJoin(apikeys, eq(apikeys.id, apiKeyRequests.keyId))
    .where(
      and(
        eq(apikeys.id, verified.key.id),
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
    notifier: request.server.notifier,
    jobs: request.server.jobs,
    resolveAiProvider: request.server.resolveAiProvider,
    user,
    credentialId: approved.credential.id,
    clientName: approved.request.clientName,
    organizationName: policy.name,
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
