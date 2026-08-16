// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The signing connector (CTR-013, TECH-013) — the API behind Settings →
 * Organization → Integrations → E-signature.
 *
 * Six Administrator-only operations on one adapter-keyed connector: read
 * its state (never its secrets), save or rotate it, test the credentials
 * against the provider, turn it off, turn it back on, and take it out.
 *
 * **Off and out are different acts, and the pane offers both.** CTR-013
 * promises that a team which never configures a connector loses nothing,
 * and until #273 an install that configured one could not get back to
 * that promise: there was no route and no control, so the send stayed on
 * offer for ever. Turning it off is the reversible answer — the row and
 * the credentials stay, and every surface answers as an unconfigured
 * install does, because the resolver reads the switch. Taking it out is
 * the other answer, for a team that wants the credentials gone.
 *
 * **A live envelope refuses the delete and not the disable.** Deleting
 * strands a round that is still out for good: nothing left to void it
 * with, and nothing for the reconciliation sweep to ask. Turning the
 * connector off strands nothing, because turning it back on picks the
 * round up again — so an Administrator who needs to stop the sending
 * right now is never blocked by paper somebody else has out.
 *
 * **The two secrets are write-only.** The RSA private key and the
 * Connect HMAC secret go in and never come back: an omitted or blank
 * field keeps the stored value, a pasted one rotates it, and no answer
 * this module gives ever carries either. That is the authentication
 * pane's own credential anatomy (TECH-008), applied here.
 *
 * **The Connect secret is required, not optional.** A connector saved
 * without one would leave the install answering unsigned webhook
 * deliveries on its first internet-facing write path, so the first save
 * refuses without it.
 *
 * **Every mutation is audited, with the secrets redacted at the call
 * site.** `activity_log` is append-only (DD-017 forbids UPDATE and
 * DELETE), so a secret that reached a payload would be in the record
 * forever — the payload records that a secret rotated and never what it
 * became.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  contractEnvelopes,
  count,
  eq,
  signingConnectors,
  SIGNING_ENVIRONMENTS,
  SIGNING_PROVIDERS,
  type Executor,
  type SigningConnector,
} from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { recordActivity } from "../../lib/activity.js";
import { httpError, problemResponse } from "../../lib/problem.js";
import {
  SigningConfigError,
  SigningTimeoutError,
  SigningUnavailableError,
} from "../../lib/signing/provider.js";

/**
 * The path each provider's Connect-style webhook is delivered to. The
 * route itself lands with the webhook slice; the address is stable from
 * here, because an Administrator pastes it into the provider's console
 * once and never again.
 */
export function webhookPath(provider: string): string {
  return `/api/v1/signing/${provider}/webhook`;
}

/** What the pane reads. Note what is absent: both secrets. */
const ConnectorSchema = z.object({
  provider: z.enum(SIGNING_PROVIDERS),
  /** False until an Administrator saves credentials for this provider. */
  configured: z.boolean(),
  /**
   * Whether the connector is switched on. False on a configured
   * connector an Administrator turned off — the credentials are still
   * here and everything else in the app answers as it would with no
   * connector at all.
   *
   * A connector that was never configured reads `configured: false` and
   * `enabled: false`, because the pane draws one control from the pair
   * and "off" is the honest reading of both.
   */
  enabled: z.boolean(),
  /** When it was turned off, or null while it is on. */
  disabledAt: z.iso.datetime().nullable(),
  environment: z.enum(SIGNING_ENVIRONMENTS).nullable(),
  integrationKey: z.string().nullable(),
  apiUserId: z.string().nullable(),
  /** Presence only — the key itself is write-only. */
  hasPrivateKey: z.boolean(),
  /** Presence only — the secret itself is write-only. */
  hasWebhookSecret: z.boolean(),
  /** The address this install answers deliveries on, to paste into the
   * provider's console. */
  webhookUrl: z.string(),
  updatedAt: z.iso.datetime().nullable(),
});

const ConnectorEnvelope = z.object({ connector: ConnectorSchema });

/**
 * A saved connector. The two secrets are optional because blank keeps:
 * the pane never reads them back, so it cannot resend what it has.
 */
const ConnectorBodySchema = z.object({
  environment: z.enum(SIGNING_ENVIRONMENTS),
  integrationKey: z.string().trim().min(1).max(200),
  apiUserId: z.string().trim().min(1).max(200),
  /** Omitted or blank keeps the stored key; a value rotates it. */
  privateKey: z.string().max(20_000).optional(),
  /** Omitted or blank keeps the stored secret; a value rotates it. */
  webhookSecret: z.string().max(500).optional(),
});

/** Blank means "keep", so it is the same as omitted. */
function pasted(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The connector as the pane reads it, with the secrets left behind. */
function readConnector(
  provider: SigningConnector["provider"],
  row: SigningConnector | undefined,
  baseUrl: string,
): z.infer<typeof ConnectorSchema> {
  const webhookUrl = new URL(webhookPath(provider), baseUrl).toString();
  if (!row) {
    return {
      provider,
      configured: false,
      enabled: false,
      disabledAt: null,
      environment: null,
      integrationKey: null,
      apiUserId: null,
      hasPrivateKey: false,
      hasWebhookSecret: false,
      webhookUrl,
      updatedAt: null,
    };
  }
  return {
    provider,
    configured: true,
    enabled: row.disabledAt === null,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    environment: row.environment,
    integrationKey: row.integrationKey,
    apiUserId: row.apiUserId,
    hasPrivateKey: row.privateKey !== "",
    hasWebhookSecret: row.webhookSecret !== "",
    webhookUrl,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const signingConnectorRoutes: FastifyPluginAsyncZod = async (app) => {
  const ParamsSchema = z.object({ provider: z.enum(SIGNING_PROVIDERS) });

  /** The stored row for one adapter, if there is one. */
  async function storedConnector(
    provider: SigningConnector["provider"],
  ): Promise<SigningConnector | undefined> {
    const [row] = await app.db
      .select()
      .from(signingConnectors)
      .where(eq(signingConnectors.provider, provider))
      .limit(1);
    return row;
  }

  app.get(
    "/signing-connectors/:provider",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getSigningConnector",
        summary:
          "The e-signature connector's state (CTR-013): whether it is " +
          "configured, which estate and credentials it names, and the " +
          "webhook URL to paste into the provider's console. Never the " +
          "RSA key or the Connect secret",
        tags: ["signing-connector"],
        params: ParamsSchema,
        response: { 200: ConnectorEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { provider } = request.params;
      return { connector: readConnector(provider, await storedConnector(provider), app.baseUrl) };
    },
  );

  app.put(
    "/signing-connectors/:provider",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "saveSigningConnector",
        summary:
          "Save the e-signature connector (CTR-013, TECH-013). The RSA " +
          "key and the Connect secret are write-only: blank keeps the " +
          "stored value, a value rotates it. A first save without the " +
          "Connect secret is refused — the webhook must never answer " +
          "unsigned deliveries",
        tags: ["signing-connector"],
        params: ParamsSchema,
        body: ConnectorBodySchema,
        response: { 200: ConnectorEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { provider } = request.params;
      const body = request.body;
      const privateKey = pasted(body.privateKey);
      const webhookSecret = pasted(body.webhookSecret);

      // The write and its audit entries commit or roll back together;
      // the row lock keeps a concurrent save from reading a stale "old"
      // into its payload.
      const saved = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(signingConnectors)
          .where(eq(signingConnectors.provider, provider))
          .limit(1)
          .for("update");

        if (!current) {
          // A first save has nothing to keep, so both secrets have to
          // be pasted. The Connect secret is named separately because
          // its absence is a security posture, not a missing field.
          if (!privateKey) {
            throw httpError(400, "Paste the RSA private key DocuSign issued for the integration.");
          }
          if (!webhookSecret) {
            throw httpError(
              400,
              "Paste the DocuSign Connect HMAC secret. Without it this install would " +
                "answer unsigned webhook deliveries, so a connector cannot be saved without one.",
            );
          }
          const [row] = await tx
            .insert(signingConnectors)
            .values({
              provider,
              environment: body.environment,
              integrationKey: body.integrationKey,
              apiUserId: body.apiUserId,
              privateKey,
              webhookSecret,
            })
            .returning();
          if (!row) throw httpError(500, "The connector could not be saved.");
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "signing_connector.configured",
            visibility: "admin_only",
            // The credentials never enter the payload; the estate and
            // the integration key are configuration, not secrets.
            payload: {
              provider,
              environment: row.environment,
              integrationKey: row.integrationKey,
            },
          });
          return row;
        }

        const [row] = await tx
          .update(signingConnectors)
          .set({
            environment: body.environment,
            integrationKey: body.integrationKey,
            apiUserId: body.apiUserId,
            // Blank keeps: the stored value is written back unchanged
            // rather than being left out, so one UPDATE covers both.
            privateKey: privateKey ?? current.privateKey,
            webhookSecret: webhookSecret ?? current.webhookSecret,
            updatedAt: new Date(),
          })
          .where(eq(signingConnectors.id, current.id))
          .returning();
        if (!row) throw httpError(500, "The connector could not be saved.");

        // One entry per changed field, the SSO-provider shape: an
        // Administrator asking "when did the RSA key last rotate" has
        // to be able to filter the audit log on it rather than read
        // every save's payload.
        const changes: { field: string; old: unknown; new: unknown }[] = [];
        if (row.environment !== current.environment) {
          changes.push({ field: "environment", old: current.environment, new: row.environment });
        }
        if (row.integrationKey !== current.integrationKey) {
          changes.push({
            field: "integrationKey",
            old: current.integrationKey,
            new: row.integrationKey,
          });
        }
        if (row.apiUserId !== current.apiUserId) {
          changes.push({ field: "apiUserId", old: current.apiUserId, new: row.apiUserId });
        }
        // A pasted secret counts as rotated. Equality with the stored
        // one is not worth checking, and the value appears nowhere.
        if (privateKey) changes.push({ field: "privateKey", old: "[secret]", new: "[secret]" });
        if (webhookSecret) {
          changes.push({ field: "webhookSecret", old: "[secret]", new: "[secret]" });
        }
        for (const change of changes) {
          await recordActivity(tx, {
            entityType: "system",
            actorId: request.user.id,
            action: "signing_connector.updated",
            visibility: "admin_only",
            payload: { provider, ...change },
          });
        }
        return row;
      });

      return { connector: readConnector(provider, saved, app.baseUrl) };
    },
  );

  app.post(
    "/signing-connectors/:provider/test",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "testSigningConnector",
        summary:
          "Authenticate against the provider with the stored credentials " +
          "(TECH-013's test button) and name the account they reach. " +
          "Answers in place; changes nothing",
        tags: ["signing-connector"],
        params: ParamsSchema,
        response: {
          200: z.object({
            connected: z.literal(true),
            accountName: z.string(),
            accountId: z.string(),
            userEmail: z.string(),
          }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const { provider } = request.params;
      const signing = await app.resolveSigningProvider();
      // Unconfigured fails before dialling anything, so the reason is
      // ours to author rather than a provider's text to scrub.
      if (!signing || signing.provider !== provider) {
        throw httpError(400, "No e-signature connector is configured. Save the credentials first.");
      }
      try {
        const check = await signing.testConnection();
        return {
          connected: true as const,
          accountName: check.accountName,
          accountId: check.accountId,
          userEmail: check.userEmail,
        };
      } catch (error) {
        // 502: the provider (or its absence) failed us, not the
        // request. The detail is the plain-language reason the pane
        // shows verbatim — and it is ours, never the provider's own
        // response text, which can quote back what it was just handed.
        if (error instanceof SigningConfigError) {
          throw httpError(502, `The connection test failed. ${error.message}`, { expose: true });
        }
        if (error instanceof SigningTimeoutError) {
          throw httpError(
            502,
            "The connection test failed. The provider did not answer in time. Try again.",
            { expose: true },
          );
        }
        if (error instanceof SigningUnavailableError) {
          throw httpError(
            502,
            "The connection test failed. The provider could not be reached. " +
              "Check the environment setting and this host's outbound network access.",
            { expose: true },
          );
        }
        throw error;
      }
    },
  );

  /** How many rounds this install has out right now.
   *
   * Read under the connector's own row lock, so a send that raced the
   * switch is either counted here or refused by the resolver after it —
   * the send resolves the connector before it dials anybody. */
  async function liveEnvelopeCount(tx: Executor): Promise<number> {
    const [row] = await tx
      .select({ live: count() })
      .from(contractEnvelopes)
      .where(eq(contractEnvelopes.status, "sent"));
    return row?.live ?? 0;
  }

  /** The stored row, locked, or the 404 an unconfigured install gets. */
  async function lockedConnector(
    tx: Executor,
    provider: SigningConnector["provider"],
  ): Promise<SigningConnector> {
    const [row] = await tx
      .select()
      .from(signingConnectors)
      .where(eq(signingConnectors.provider, provider))
      .limit(1)
      .for("update");
    if (!row) {
      throw httpError(404, "This install has no e-signature connector to change.");
    }
    return row;
  }

  app.post(
    "/signing-connectors/:provider/disable",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "disableSigningConnector",
        summary:
          "Turn the e-signature connector off (CTR-013) without losing " +
          "its credentials. Every surface then answers as an " +
          "unconfigured install does — the send control leaves the " +
          "record and the manual hand-off is the path again. A live " +
          "envelope does not refuse this: turning the connector back on " +
          "picks the round up where the sweep left it",
        tags: ["signing-connector"],
        params: ParamsSchema,
        response: { 200: ConnectorEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { provider } = request.params;
      const saved = await app.db.transaction(async (tx) => {
        const current = await lockedConnector(tx, provider);
        if (current.disabledAt) {
          throw httpError(409, "This e-signature connector is already turned off.");
        }
        // Counted before the write and recorded with it. While the
        // connector is off the reconciliation sweep resolves nothing
        // and these rounds stand still, so how many were out at that
        // moment is the fact somebody reading the log afterwards wants.
        const liveEnvelopes = await liveEnvelopeCount(tx);
        const [row] = await tx
          .update(signingConnectors)
          .set({ disabledAt: new Date(), updatedAt: new Date() })
          .where(eq(signingConnectors.id, current.id))
          .returning();
        if (!row) throw httpError(500, "The connector could not be turned off.");
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "signing_connector.disabled",
          visibility: "admin_only",
          payload: { provider, liveEnvelopes },
        });
        return row;
      });
      return { connector: readConnector(provider, saved, app.baseUrl) };
    },
  );

  app.post(
    "/signing-connectors/:provider/enable",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "enableSigningConnector",
        summary:
          "Turn the e-signature connector back on with the credentials " +
          "it already holds (CTR-013). The send control returns to the " +
          "record and the reconciliation sweep reaches every round that " +
          "was out while it was off",
        tags: ["signing-connector"],
        params: ParamsSchema,
        response: { 200: ConnectorEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { provider } = request.params;
      const saved = await app.db.transaction(async (tx) => {
        const current = await lockedConnector(tx, provider);
        if (!current.disabledAt) {
          throw httpError(409, "This e-signature connector is already on.");
        }
        const [row] = await tx
          .update(signingConnectors)
          .set({ disabledAt: null, updatedAt: new Date() })
          .where(eq(signingConnectors.id, current.id))
          .returning();
        if (!row) throw httpError(500, "The connector could not be turned on.");
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "signing_connector.enabled",
          visibility: "admin_only",
          payload: { provider },
        });
        return row;
      });
      return { connector: readConnector(provider, saved, app.baseUrl) };
    },
  );

  app.delete(
    "/signing-connectors/:provider",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "deleteSigningConnector",
        summary:
          "Take the e-signature connector out (CTR-013). The row and " +
          "both secrets go, and the install is back to the zero-config " +
          "manual hand-off. Refused while any envelope is still out: " +
          "deleting the credentials strands that round for good — " +
          "nothing left to void it with, and nothing for the " +
          "reconciliation sweep to ask. Turn the connector off instead " +
          "if the sending has to stop before the paper comes back",
        tags: ["signing-connector"],
        params: ParamsSchema,
        response: { 200: ConnectorEnvelope, default: problemResponse },
      },
    },
    async (request) => {
      const { provider } = request.params;
      await app.db.transaction(async (tx) => {
        const current = await lockedConnector(tx, provider);
        const liveEnvelopes = await liveEnvelopeCount(tx);
        if (liveEnvelopes > 0) {
          throw httpError(
            409,
            `${String(liveEnvelopes)} ${liveEnvelopes === 1 ? "envelope is" : "envelopes are"} ` +
              "still out for signature. Removing the connector would leave " +
              `${liveEnvelopes === 1 ? "it" : "them"} with no way to be voided or finished. ` +
              "Void or finish the round first, or turn the connector off instead.",
          );
        }
        // Written before the delete, so the entry and the row it
        // describes commit together. The estate and the integration key
        // ride along because after this transaction they exist nowhere
        // else — the audit log is the only thing left that says which
        // account this install was talking to.
        await recordActivity(tx, {
          entityType: "system",
          actorId: request.user.id,
          action: "signing_connector.removed",
          visibility: "admin_only",
          payload: {
            provider,
            environment: current.environment,
            integrationKey: current.integrationKey,
          },
        });
        await tx.delete(signingConnectors).where(eq(signingConnectors.id, current.id));
      });
      // The unconfigured answer, which is what this install now is.
      return { connector: readConnector(provider, undefined, app.baseUrl) };
    },
  );
};
