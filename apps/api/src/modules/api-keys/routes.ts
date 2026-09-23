// SPDX-License-Identifier: AGPL-3.0-only

/**
 * DD-029 API key requests and SET-014 settings reads. Approval, audit and notifications
 * commit together. Only the owner detail read opens and clears a sealed key.
 */

import {
  apiKeyRequests,
  apikeys,
  orgSettings,
  users,
  eq,
  and,
  isNull,
  desc,
  sealSecret,
  openSecret,
  type Transaction,
} from "@openlaw/db";
import { MCP_TOOLSETS, API_KEY_PROBLEMS } from "@openlaw/shared";
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { requireAuth, requireRole } from "../../auth/guards.js";
import { mintApiKey } from "../../auth/api-keys.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse, problemTypeResponse } from "../../lib/problem.js";
import type { NotifyingTransaction } from "../../lib/notifications/notifier.js";

const Input = z
  .object({
    clientName: z.string().trim().min(1).max(200),
    toolsets: z
      .array(z.enum(MCP_TOOLSETS))
      .min(1)
      .max(MCP_TOOLSETS.length)
      .refine((v) => new Set(v).size === v.length),
    scope: z.enum(["read", "write"]),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();
const Decision = z.object({ note: z.string().trim().max(2000).optional() }).strict();
const Params = z.object({ id: z.uuid() });
const Row = z.object({
  id: z.string(),
  requesterId: z.string(),
  owner: z.string(),
  clientName: z.string(),
  toolsets: z.array(z.enum(MCP_TOOLSETS)),
  scope: z.enum(["read", "write"]),
  note: z.string().nullable(),
  status: z.enum(["pending", "active", "denied", "cancelled", "revoked", "expired"]),
  decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  keyAvailable: z.boolean(),
  key: z.string().optional(),
});
const Policy = z.object({
  enabled: z.boolean(),
  groupEnabled: z.boolean(),
  toolsetCeiling: z.array(z.enum(MCP_TOOLSETS)),
  readOnly: z.boolean(),
  apiKeyLifetimeDays: z.number(),
});
const response = { 200: Row, default: problemResponse };
type RequestRow = typeof apiKeyRequests.$inferSelect;

async function readPolicy(tx: Transaction, role: string) {
  const [p] = await tx.select().from(orgSettings).for("share");
  if (!p) throw httpError(500, "Organization settings are unavailable.");
  return {
    enabled: p.mcpEnabled,
    groupEnabled: role === "business_user" ? p.mcpBusinessApiKeysEnabled : p.mcpLegalApiKeysEnabled,
    toolsetCeiling: p.mcpToolsetCeiling,
    readOnly: p.mcpReadOnly,
    apiKeyLifetimeDays: p.mcpApiKeyLifetimeDays,
  };
}
function assertPolicy(p: z.infer<typeof Policy>, input: Pick<RequestRow, "toolsets" | "scope">) {
  const fail = (index: number, detail: string): never => {
    throw httpError(403, detail, { type: API_KEY_PROBLEMS[index] });
  };
  if (!p.enabled) fail(0, "MCP is off for the organization.");
  if (!p.groupEnabled) fail(1, "API keys are off for your group.");
  if (input.toolsets.some((t) => !p.toolsetCeiling.includes(t)))
    fail(2, "A requested Toolset is outside the organization ceiling.");
  if (input.scope === "write" && p.readOnly) fail(3, "MCP is read-only for the organization.");
}
async function present(tx: Transaction, row: RequestRow): Promise<z.infer<typeof Row>> {
  const [owner] = await tx
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, row.requesterId));
  const [approver] = row.decidedBy
    ? await tx.select({ name: users.displayName }).from(users).where(eq(users.id, row.decidedBy))
    : [];
  const [key] = row.keyId ? await tx.select().from(apikeys).where(eq(apikeys.id, row.keyId)) : [];
  const status =
    row.status !== "approved"
      ? row.status
      : row.revokedAt || !key?.enabled
        ? "revoked"
        : key.expiresAt && key.expiresAt <= new Date()
          ? "expired"
          : "active";
  return {
    id: row.id,
    requesterId: row.requesterId,
    owner: owner!.name,
    clientName: row.clientName,
    toolsets: row.toolsets,
    scope: row.scope,
    note: row.note,
    status,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    approvedBy: approver?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: key?.expiresAt?.toISOString() ?? null,
    lastUsedAt: key?.lastRequest?.toISOString() ?? null,
    keyAvailable: status === "active" && !!row.sealedKey,
  };
}
async function audit(
  tx: Transaction,
  row: RequestRow,
  action: "requested" | "minted" | "approved" | "denied" | "cancelled" | "revoked",
  actorId: string,
  selfApproved = false,
) {
  await recordActivity(tx, {
    entityType: "system",
    actorId,
    action: `api_key.${action}`,
    visibility: "admin_only",
    payload: {
      requestId: row.id,
      clientName: row.clientName,
      requesterId: row.requesterId,
      ...(row.keyId ? { keyId: row.keyId } : {}),
      ...(action === "approved" ? { selfApproved } : {}),
      ...(action === "approved" || action === "denied" ? { note: row.decisionNote } : {}),
    },
  });
}

export const apiKeyRoutes: FastifyPluginAsyncZod = async (app) => {
  async function approve(
    tx: NotifyingTransaction,
    row: RequestRow,
    actorId: string,
    note?: string,
  ) {
    const [owner] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, row.requesterId), isNull(users.archivedAt)))
      .for("share");
    if (!owner) throw httpError(409, "The requester is no longer active.");
    const p = await readPolicy(tx, owner.role);
    assertPolicy(p, row);
    const key = await mintApiKey(tx, {
      userId: row.requesterId,
      name: row.clientName,
      lifetimeDays: p.apiKeyLifetimeDays,
      secret: (await app.auth.$context).secret,
      baseUrl: app.baseUrl,
    });
    const selfApproved = row.requesterId === actorId;
    const [approved] = await tx
      .update(apiKeyRequests)
      .set({
        status: "approved",
        keyId: key.id,
        decidedBy: actorId,
        decidedAt: new Date(),
        decisionNote: note ?? null,
        sealedKey: selfApproved ? null : sealSecret(key.key, "sealed_key"),
      })
      .where(eq(apiKeyRequests.id, row.id))
      .returning();
    await audit(tx, approved!, "minted", actorId);
    await audit(tx, approved!, "approved", actorId, selfApproved);
    await app.notifier.apiKeyEvent(tx, {
      requestId: row.id,
      requesterId: row.requesterId,
      clientName: row.clientName,
      event: "approved",
      actorId,
    });
    return {
      ...(await present(tx, approved!)),
      ...(selfApproved ? { key: key.key } : {}),
      keyAvailable: false,
    };
  }
  app.get(
    "/api-key-requests",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "listApiKeyRequests",
        tags: ["api-keys"],
        response: {
          200: z.object({ policy: Policy, requests: z.array(Row) }),
          default: problemResponse,
        },
      },
    },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.db.transaction(async (tx) => {
        const policy = await readPolicy(tx, req.user.role);
        const rows = await tx
          .select()
          .from(apiKeyRequests)
          .where(eq(apiKeyRequests.requesterId, req.user.id))
          .orderBy(desc(apiKeyRequests.createdAt));
        return { policy, requests: await Promise.all(rows.map((row) => present(tx, row))) };
      });
    },
  );
  app.get(
    "/mcp-settings/api-keys",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "listOrganizationApiKeys",
        tags: ["api-keys"],
        response: { 200: z.array(Row), default: problemResponse },
      },
    },
    async () =>
      app.db.transaction(async (tx) => {
        const rows = await tx.select().from(apiKeyRequests).orderBy(desc(apiKeyRequests.createdAt));
        return Promise.all(
          rows.map(async (row) => ({ ...(await present(tx, row)), keyAvailable: false })),
        );
      }),
  );
  app.post(
    "/api-key-requests",
    {
      preHandler: requireAuth,
      schema: {
        operationId: "requestApiKey",
        tags: ["api-keys"],
        body: Input,
        response: {
          201: Row,
          403: problemTypeResponse("MCP policy refused this API key request.", API_KEY_PROBLEMS),
          default: problemResponse,
        },
      },
    },
    async (req, reply) => {
      const result = await app.notifier.notifying(async (tx) => {
        assertPolicy(await readPolicy(tx, req.user.role), req.body);
        const [row] = await tx
          .insert(apiKeyRequests)
          .values({ ...req.body, requesterId: req.user.id })
          .returning();
        await audit(tx, row!, "requested", req.user.id);
        if (req.user.role === "administrator") return approve(tx, row!, req.user.id);
        await app.notifier.apiKeyEvent(tx, {
          requestId: row!.id,
          requesterId: req.user.id,
          clientName: row!.clientName,
          event: "requested",
          actorId: req.user.id,
        });
        return present(tx, row!);
      });
      return reply.header("Cache-Control", "no-store").status(201).send(result);
    },
  );
  app.get(
    "/api-key-requests/:id",
    {
      preHandler: requireAuth,
      schema: { operationId: "readApiKeyRequest", tags: ["api-keys"], params: Params, response },
    },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      return app.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(apiKeyRequests)
          .where(
            and(eq(apiKeyRequests.id, req.params.id), eq(apiKeyRequests.requesterId, req.user.id)),
          )
          .for("update");
        if (!row) throw httpError(404, "API key request not found.");
        const result = await present(tx, row);
        if (row.sealedKey && result.status === "active") {
          const key = openSecret(row.sealedKey, "sealed_key");
          if (!key)
            throw httpError(503, "The API key cannot be opened. Contact an Administrator.", {
              expose: true,
            });
          await tx
            .update(apiKeyRequests)
            .set({ sealedKey: null })
            .where(eq(apiKeyRequests.id, row.id));
          return { ...result, key, keyAvailable: false };
        }
        return result;
      });
    },
  );
  for (const action of ["approve", "deny", "cancel", "revoke"] as const) {
    app.post(
      `/api-key-requests/:id/${action}`,
      {
        preHandler:
          action === "approve" || action === "deny" ? requireRole("administrator") : requireAuth,
        schema: {
          operationId: `${action}ApiKeyRequest`,
          tags: ["api-keys"],
          params: Params,
          ...(action === "approve" || action === "deny" ? { body: Decision } : {}),
          response,
        },
      },
      async (req, reply) => {
        reply.header("Cache-Control", "no-store");
        return app.notifier.notifying(async (tx) => {
          const [row] = await tx
            .select()
            .from(apiKeyRequests)
            .where(eq(apiKeyRequests.id, req.params.id))
            .for("update");
          if (
            !row ||
            ((action === "cancel" || action === "revoke") &&
              row.requesterId !== req.user.id &&
              !(action === "revoke" && req.user.role === "administrator"))
          )
            throw httpError(404, "API key request not found.");
          if (action === "revoke") {
            if ((await present(tx, row)).status !== "active")
              throw httpError(409, "This API key cannot be revoked.");
            await tx
              .update(apikeys)
              .set({ enabled: false, updatedAt: new Date() })
              .where(eq(apikeys.id, row.keyId!));
            const [changed] = await tx
              .update(apiKeyRequests)
              .set({ revokedAt: new Date(), sealedKey: null })
              .where(eq(apiKeyRequests.id, row.id))
              .returning();
            await audit(tx, changed!, "revoked", req.user.id);
            return present(tx, changed!);
          }
          if (row.status !== "pending")
            throw httpError(409, "This API key request has already been handled.");
          const note = (req.body as z.infer<typeof Decision> | undefined)?.note;
          if (action === "approve") return approve(tx, row, req.user.id, note);
          const [changed] = await tx
            .update(apiKeyRequests)
            .set({
              status: action === "deny" ? "denied" : "cancelled",
              decidedBy: req.user.id,
              decidedAt: new Date(),
              decisionNote: note ?? null,
            })
            .where(eq(apiKeyRequests.id, row.id))
            .returning();
          await audit(tx, changed!, action === "deny" ? "denied" : "cancelled", req.user.id);
          if (action === "deny")
            await app.notifier.apiKeyEvent(tx, {
              requestId: row.id,
              requesterId: row.requesterId,
              clientName: row.clientName,
              event: "denied",
              actorId: req.user.id,
            });
          return present(tx, changed!);
        });
      },
    );
  }
};
