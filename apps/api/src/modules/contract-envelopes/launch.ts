// SPDX-License-Identifier: AGPL-3.0-only

/** Sender View launch and authenticated return confirmation (CTR-013, TECH-033). */
import { createHash, randomBytes } from "node:crypto";
import {
  and,
  contractEnvelopes,
  contracts,
  documents,
  documentVersions,
  envelopeLaunches,
  eq,
  gt,
  isNotNull,
  isNull,
  lte,
  or,
} from "@openlaw/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { contractTeamScope, documentAudienceScope } from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { checkEnvelopeStatus, LAUNCH_LIFETIME_MINUTES } from "../../lib/signing/status-check.js";
import { applyEnvelopeStatus } from "../../lib/signing/transitions.js";
import { requestExecutedCopy } from "../../lib/signing/completion.js";

const hash = (state: string) => createHash("sha256").update(state).digest("hex");
const RETURN_EVENTS = ["send", "save", "cancel", "error", "sessionend"];
const COOKIE = "openlaw-signing-return";
const RETURN_PATH = "/api/v1/signing/return";
const UNAVAILABLE = "This signing return is unavailable. Open the Contract from Signatures.";
const requireMember = requireRole("administrator", "legal_team_member");
export const envelopeLaunchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer");
  });
  const cookie = (value: string) =>
    `${COOKIE}=${value}; Path=${RETURN_PATH}; HttpOnly; SameSite=Lax${new URL(app.baseUrl).protocol === "https:" ? "; Secure" : ""}`;
  async function reached(user: AuthenticatedUser, id: string) {
    const [row] = await app.db
      .select({ envelope: contractEnvelopes, contract: contracts })
      .from(contractEnvelopes)
      .innerJoin(contracts, eq(contracts.id, contractEnvelopes.contractId))
      .where(and(eq(contractEnvelopes.id, id), contractTeamScope(app.db, user)))
      .limit(1);
    return row;
  }
  app.post(
    "/envelopes/:envelopeId/launch",
    {
      preHandler: requireMember,
      schema: {
        operationId: "launchContractEnvelope",
        tags: ["envelopes"],
        params: z.object({ envelopeId: z.string().min(1).max(64) }),
        response: { 200: z.object({ url: z.string() }), default: problemResponse },
      },
    },
    async (request) => {
      if (!app.signingPreparationEnabled)
        throw httpError(409, "Envelope preparation is not enabled.");
      const row = await reached(request.user, request.params.envelopeId);
      if (!row) throw httpError(404, "No envelope exists with that id.");
      const { envelope, contract } = row;
      if (
        contract.archivedAt ||
        envelope.status !== "draft" ||
        !envelope.providerEnvelopeId ||
        !envelope.documentVersionId ||
        envelope.documentId !== contract.primaryDocumentId
      )
        throw httpError(409, "This Envelope cannot be opened for preparation.");
      if (
        request.user.role !== "administrator" &&
        request.user.id !== envelope.sentBy &&
        request.user.id !== contract.managerId
      )
        throw httpError(
          403,
          "Only the preparer, Legal Owner or an Administrator may open this Envelope.",
        );
      const [source] = await app.db
        .select({ id: documentVersions.id })
        .from(documentVersions)
        .innerJoin(documents, eq(documents.id, documentVersions.documentId))
        .where(
          and(
            eq(documentVersions.id, envelope.documentVersionId),
            documentAudienceScope(app.db, request.user),
          ),
        )
        .limit(1);
      if (!source) throw httpError(409, "The source Version is no longer available.");
      const signing = await app.resolveSigningProvider();
      const account = signing ? await signing.testConnection().catch(() => null) : null;
      if (
        !signing ||
        !account ||
        signing.provider !== envelope.provider ||
        signing.environment !== envelope.providerEnvironment ||
        account.accountId !== envelope.providerAccountId
      )
        throw httpError(409, "The original Signing account is unavailable.");
      // Spent correlations for this Envelope have nothing left to grant.
      // Pruned here so the table holds only launches that can still return.
      await app.db
        .delete(envelopeLaunches)
        .where(
          and(
            eq(envelopeLaunches.envelopeId, envelope.id),
            or(isNotNull(envelopeLaunches.consumedAt), lte(envelopeLaunches.expiresAt, new Date())),
          ),
        );
      const state = randomBytes(32).toString("base64url");
      await app.db.insert(envelopeLaunches).values({
        stateHash: hash(state),
        envelopeId: envelope.id,
        userId: request.user.id,
        providerAccountId: envelope.providerAccountId!,
        providerEnvironment: signing.environment,
        expiresAt: new Date(Date.now() + LAUNCH_LIFETIME_MINUTES * 60_000),
      });
      const returnUrl = new URL(RETURN_PATH, app.baseUrl);
      returnUrl.searchParams.set("state", state);
      try {
        const url = await signing.launchEnvelope(envelope.providerEnvelopeId, returnUrl.href);
        await app.db
          .update(contractEnvelopes)
          .set({ confirmationPending: true })
          .where(eq(contractEnvelopes.id, envelope.id));
        return { url };
      } catch {
        await app.db.delete(envelopeLaunches).where(eq(envelopeLaunches.stateHash, hash(state)));
        throw httpError(502, "DocuSign could not open this draft. Try again from Signatures.", {
          expose: true,
        });
      }
    },
  );
  // Navigation stores only a session cookie, never local/sessionStorage or a persistent cookie.
  // Its value grants nothing until the protected POST rechecks the user and Contract reach.
  app.get("/signing/return", { schema: { hide: true } }, async (request, reply) => {
    const query = new URL(request.url, app.baseUrl).searchParams;
    const state = query.get("state") ?? "";
    // Events, including unknown events and missing provider IDs, carry no authority.
    const event = (query.get("event") ?? "").toLowerCase();
    const recognized = RETURN_EVENTS.includes(event);
    const value = /^[A-Za-z0-9_-]{43}$/.test(state)
      ? `${state}.${recognized ? event : "unknown"}`
      : "";
    return reply.header("set-cookie", cookie(value)).redirect("/signing/return");
  });
  app.post(
    "/signing/return",
    {
      preHandler: requireMember,
      schema: {
        operationId: "confirmEnvelopeReturn",
        tags: ["envelopes"],
        response: {
          200: z.object({ destination: z.string(), waiting: z.boolean() }),
          default: problemResponse,
        },
      },
    },
    async (request, reply) => {
      const value =
        request.headers.cookie
          ?.split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${COOKIE}=`))
          ?.slice(COOKIE.length + 1) ?? "";
      const [state, hint] = value.split(".");
      if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw httpError(404, UNAVAILABLE);
      const [launch] = await app.db
        .select()
        .from(envelopeLaunches)
        .where(
          and(
            eq(envelopeLaunches.stateHash, hash(state)),
            eq(envelopeLaunches.userId, request.user.id),
            isNull(envelopeLaunches.consumedAt),
            gt(envelopeLaunches.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!launch) throw httpError(404, UNAVAILABLE);
      const row = await reached(request.user, launch.envelopeId);
      if (
        !row ||
        row.envelope.providerAccountId !== launch.providerAccountId ||
        row.envelope.providerEnvironment !== launch.providerEnvironment
      )
        throw httpError(404, UNAVAILABLE);
      const signing = await app.resolveSigningProvider().catch(() => null);
      const account = signing ? await signing.testConnection().catch(() => null) : null;
      if (
        signing &&
        (signing.provider !== row.envelope.provider ||
          signing.environment !== launch.providerEnvironment ||
          (account !== null && account.accountId !== launch.providerAccountId))
      )
        throw httpError(404, UNAVAILABLE);
      const [consumed] = await app.db
        .update(envelopeLaunches)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(envelopeLaunches.stateHash, launch.stateHash),
            isNull(envelopeLaunches.consumedAt),
            gt(envelopeLaunches.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!consumed) throw httpError(404, UNAVAILABLE);
      reply.header("set-cookie", `${cookie("")}; Max-Age=0`);
      let waiting = row.envelope.status === "draft";
      if (hint && RETURN_EVENTS.includes(hint) && signing && account) {
        try {
          const checked = await checkEnvelopeStatus(app.db, signing, row.envelope.id);
          if (checked && row.envelope.providerEnvelopeId) {
            const result = await applyEnvelopeStatus(app.notifier, {
              provider: signing.provider,
              providerEnvelopeId: row.envelope.providerEnvelopeId,
              ...checked,
            });
            await requestExecutedCopy(app.jobs, request.log, result);
            // The event controls only the waiting display; provider evidence owns status.
            waiting = hint === "send" && checked.status === "draft";
            await app.db
              .update(contractEnvelopes)
              .set({ confirmationPending: waiting })
              .where(eq(contractEnvelopes.id, row.envelope.id));
          }
        } catch {
          // A failed check retains the reservation and the durable allowance.
        }
      }
      return { destination: `/contracts/${row.contract.number}/signatures`, waiting };
    },
  );
};
