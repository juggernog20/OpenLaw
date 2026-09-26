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
  sql,
} from "@openlaw/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireRole, type AuthenticatedUser } from "../../auth/guards.js";
import { contractTeamScope, documentAudienceScope } from "../../lib/contract-access.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import { checkEnvelopeStatus, LAUNCH_LIFETIME_MINUTES } from "../../lib/signing/status-check.js";
import { applyEnvelopeStatus } from "../../lib/signing/transitions.js";
import {
  EnvelopeEditConflictError,
  EnvelopeAccessError,
  EnvelopeNotFoundError,
  SigningConfigError,
} from "../../lib/signing/provider.js";
import { recordActivity, RECORD_ACTIVITY_TIER } from "../../lib/activity.js";
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
      const eligible = async () => {
        await requireMember(request);
        const row = await reached(request.user, request.params.envelopeId);
        if (!row) throw httpError(404, "No envelope exists with that id.");
        const { envelope, contract } = row;
        if (
          contract.archivedAt ||
          envelope.status !== "draft" ||
          envelope.scheduled ||
          envelope.externallyRestored ||
          !envelope.providerEnvelopeId
        )
          throw httpError(
            409,
            "This Envelope cannot be resumed. Check its current status in Signatures. Sent Envelopes use Void.",
          );
        if (
          request.user.role !== "administrator" &&
          request.user.id !== envelope.sentBy &&
          request.user.id !== contract.managerId
        )
          throw httpError(
            403,
            "Only the preparer, Legal Owner or an Administrator may open this Envelope.",
          );
        if (!envelope.documentVersionId || !envelope.documentId)
          throw httpError(
            409,
            "The source Version was erased. This preparation cannot be launched. Resolve the existing Envelope in DocuSign; OpenLaw will keep its history.",
          );
        if (envelope.documentId !== contract.primaryDocumentId)
          throw httpError(
            409,
            "The primary Document changed. This preparation still uses its original Document and Version. Restore that Document as primary to Resume, or resolve this preparation in DocuSign before preparing different paper.",
          );
        const [source] = await app.db
          .select({ id: documentVersions.id })
          .from(documentVersions)
          .innerJoin(documents, eq(documents.id, documentVersions.documentId))
          .where(
            and(
              eq(documentVersions.id, envelope.documentVersionId),
              eq(documents.id, envelope.documentId),
              eq(documents.contractId, contract.id),
              isNull(documents.archivedAt),
              documentAudienceScope(app.db, request.user),
            ),
          )
          .limit(1);
        if (!source) throw httpError(409, "The source Version is no longer available.");
        return row;
      };
      const { envelope } = await eligible();
      // The claim coordinates requests across API replicas, not browser sessions.
      // A crashed request releases itself after five minutes.
      const [claimed] = await app.db
        .update(contractEnvelopes)
        .set({
          launchClaimExpiresAt: sql`date_trunc('milliseconds', clock_timestamp()) + interval '5 minutes'`,
        })
        .where(
          and(
            eq(contractEnvelopes.id, envelope.id),
            eq(contractEnvelopes.status, "draft"),
            eq(contractEnvelopes.scheduled, false),
            eq(contractEnvelopes.externallyRestored, false),
            or(
              isNull(contractEnvelopes.launchClaimExpiresAt),
              sql`${contractEnvelopes.launchClaimExpiresAt} <= clock_timestamp()`,
            ),
          ),
        )
        .returning();
      if (!claimed)
        throw httpError(
          409,
          "Another launch is in progress. Wait, then Resume this same Envelope from Signatures.",
        );
      const state = randomBytes(32).toString("base64url");
      try {
        const signing = await app.resolveSigningProvider();
        if (!signing)
          throw httpError(
            409,
            "The Signing connector is disabled. Ask an Administrator to enable it, then Resume.",
          );
        const account = await signing.testConnection();
        if (
          signing.provider !== envelope.provider ||
          signing.environment !== envelope.providerEnvironment ||
          account.accountId !== envelope.providerAccountId
        )
          throw httpError(
            409,
            "This Envelope belongs to a different Signing account. Restore its original account before resuming.",
          );
        // A fresh creation needs no read. Resume shares the existing durable allowance.
        const [previous] = await app.db
          .select()
          .from(envelopeLaunches)
          .where(eq(envelopeLaunches.envelopeId, envelope.id))
          .limit(1);
        if (previous) {
          const checked = await checkEnvelopeStatus(app.db, signing, envelope.id);
          if (checked) {
            const result = await applyEnvelopeStatus(app.notifier, {
              provider: signing.provider,
              providerEnvelopeId: envelope.providerEnvelopeId!,
              ...checked,
            });
            await requestExecutedCopy(app.jobs, request.log, result);
            if (checked.status !== "draft" || checked.scheduled)
              throw httpError(
                409,
                "This Envelope is no longer editable here. Check its confirmed status and any scheduled sending in Signatures.",
              );
          }
        }
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
        await eligible();
        if ((await app.resolveSigningProvider()) !== signing)
          throw httpError(
            409,
            "The Signing connector changed. Check its current settings, then Resume.",
          );
        const url = await signing.launchEnvelope(envelope.providerEnvelopeId!, returnUrl.href);
        await app.db.transaction(async (tx) => {
          await tx
            .update(contractEnvelopes)
            .set({ confirmationPending: true })
            .where(
              and(eq(contractEnvelopes.id, envelope.id), eq(contractEnvelopes.status, "draft")),
            );
          // The provider issued a session even if the final access check withholds
          // its URL. Neither issuance nor a browser return establishes a send.
          await recordActivity(tx, {
            entityType: "contract",
            entityId: envelope.contractId,
            actorId: request.user.id,
            action: "envelope.session_launched",
            visibility: RECORD_ACTIVITY_TIER,
            payload: {
              envelopeId: envelope.id,
              provider: envelope.provider,
              providerEnvelopeId: envelope.providerEnvelopeId!,
            },
          });
        });
        await app.db
          .delete(envelopeLaunches)
          .where(
            and(
              eq(envelopeLaunches.envelopeId, envelope.id),
              or(
                isNotNull(envelopeLaunches.consumedAt),
                lte(envelopeLaunches.expiresAt, new Date()),
              ),
            ),
          );
        // A remote session can already exist if access changed during the request.
        // Refuse to hand out its URL, but keep provider accounting independent.
        await eligible();
        if ((await app.resolveSigningProvider()) !== signing)
          throw httpError(
            409,
            "The Signing connector changed. A session already issued by DocuSign may remain usable. Check Signatures before trying again.",
          );
        return { url };
      } catch (error) {
        await app.db.delete(envelopeLaunches).where(eq(envelopeLaunches.stateHash, hash(state)));
        if (error instanceof EnvelopeEditConflictError) {
          await app.db
            .update(contractEnvelopes)
            .set({ confirmationPending: true })
            .where(
              and(eq(contractEnvelopes.id, envelope.id), eq(contractEnvelopes.status, "draft")),
            );
          throw httpError(
            409,
            error.conflict === "locked"
              ? "DocuSign has this Envelope open in another editing session. Save and close that session, then Resume here. A new link does not close an earlier session."
              : "DocuSign reports that this Envelope is no longer editable as a draft. Signatures is waiting for its next allowed status check. Do not start another preparation.",
          );
        }
        if (error instanceof EnvelopeNotFoundError)
          throw httpError(
            409,
            "DocuSign could not find this Envelope. Its preparation is still reserved. Ask an Administrator to check the original account and deletion history.",
          );
        if (error instanceof EnvelopeAccessError) throw httpError(403, error.message);
        if (error instanceof SigningConfigError)
          throw httpError(
            409,
            "The Signing credentials need attention. Ask an Administrator to repair the connector, then Resume this Envelope.",
          );
        if (typeof error === "object" && error !== null && "statusCode" in error) throw error;
        throw httpError(
          502,
          "DocuSign is temporarily unavailable. This Envelope is still saved. Try Resume again from Signatures.",
          { expose: true },
        );
      } finally {
        await app.db
          .update(contractEnvelopes)
          .set({ launchClaimExpiresAt: null })
          .where(
            and(
              eq(contractEnvelopes.id, envelope.id),
              eq(contractEnvelopes.launchClaimExpiresAt, claimed.launchClaimExpiresAt!),
            ),
          );
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
      if (launch.expiresAt <= new Date()) {
        reply.header("set-cookie", `${cookie("")}; Max-Age=0`);
        return {
          destination: `/contracts/${row.contract.number}/signatures`,
          waiting: row.envelope.status === "draft",
        };
      }
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
              .where(
                and(
                  eq(contractEnvelopes.id, row.envelope.id),
                  eq(contractEnvelopes.status, "draft"),
                ),
              );
          }
        } catch {
          // A failed check retains the reservation and the durable allowance.
        }
      }
      return { destination: `/contracts/${row.contract.number}/signatures`, waiting };
    },
  );
};
