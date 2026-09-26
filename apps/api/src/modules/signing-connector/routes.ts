// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Administrator settings for the Signing connector (CTR-013, TECH-013).
 * Secrets remain write-only. Live preparations, uncertain creations and sent
 * Envelopes prevent removal or retargeting their account and environment.
 * Disable refuses new sessions while accounting keeps the real provider outcome.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  and,
  contractEnvelopes,
  count,
  eq,
  inArray,
  ne,
  or,
  signingConnectors,
  SIGNING_ENVIRONMENTS,
  SIGNING_UPDATE_MODES,
  SIGNING_PROVIDERS,
  type Executor,
  type Db,
  type SigningConnector,
} from "@openlaw/db";
import { LIVE_ENVELOPE_STATUSES } from "@openlaw/shared";
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
  updateMode: z.enum(SIGNING_UPDATE_MODES),
  webhookUrlOverride: z.string().nullable(),
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
  updateMode: z.enum(SIGNING_UPDATE_MODES).optional(),
  webhookUrl: z
    .url()
    .max(2000)
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return (
        url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
      );
    }, "Use an HTTPS callback URL without credentials, query parameters or fragments.")
    .nullable()
    .optional(),
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
  const webhookUrl = row?.webhookUrl ?? new URL(webhookPath(provider), baseUrl).toString();
  if (!row) {
    return {
      provider,
      configured: false,
      enabled: false,
      disabledAt: null,
      environment: null,
      updateMode: "polling",
      webhookUrlOverride: null,
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
    updateMode: row.updateMode,
    webhookUrlOverride: row.webhookUrl,
    integrationKey: row.integrationKey,
    apiUserId: row.apiUserId,
    hasPrivateKey: row.privateKey !== "",
    hasWebhookSecret: row.webhookSecret !== "",
    webhookUrl,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const needsConnector = () =>
  or(
    inArray(contractEnvelopes.status, [...LIVE_ENVELOPE_STATUSES]),
    and(eq(contractEnvelopes.status, "signed"), ne(contractEnvelopes.executedFetch, "ready")),
  );

export const signingConnectorRoutes: FastifyPluginAsyncZod = async (app) => {
  const ParamsSchema = z.object({ provider: z.enum(SIGNING_PROVIDERS) });

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
      return readSigningSettings(app.db, provider, app.baseUrl);
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
          "stored value, a value rotates it. Webhook mode requires a Connect secret. " +
          "New connectors default to polling",
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

      const [observed] = await app.db
        .select()
        .from(signingConnectors)
        .where(eq(signingConnectors.provider, provider))
        .limit(1);
      const changesCredentials = (current: SigningConnector) =>
        current.environment !== body.environment ||
        current.apiUserId !== body.apiUserId ||
        current.integrationKey !== body.integrationKey ||
        Boolean(privateKey && privateKey !== current.privateKey);
      let candidateAccountId: string | undefined;
      if (observed && changesCredentials(observed)) {
        const live = await app.db
          .select({ accountId: contractEnvelopes.providerAccountId })
          .from(contractEnvelopes)
          .where(needsConnector());
        if (live.some((envelope) => envelope.accountId !== null)) {
          try {
            const candidate = await app.resolveSigningProvider("accounting", {
              environment: body.environment,
              integrationKey: body.integrationKey,
              apiUserId: body.apiUserId,
              privateKey: privateKey ?? observed.privateKey,
              webhookSecret: webhookSecret ?? observed.webhookSecret,
            });
            candidateAccountId = (await candidate?.testConnection())?.accountId;
          } catch (error) {
            if (error instanceof SigningTimeoutError || error instanceof SigningUnavailableError)
              throw httpError(
                502,
                "DocuSign could not be reached to verify these credentials. Try again.",
                { expose: true },
              );
            throw httpError(
              409,
              "The replacement credentials could not verify the connector identity. Keep the original account and try again.",
            );
          }
        }
      }

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

        const updateMode = body.updateMode ?? current?.updateMode ?? "polling";
        if (updateMode === "webhook" && !(webhookSecret ?? current?.webhookSecret)) {
          throw httpError(400, "Paste the DocuSign Connect HMAC secret before selecting Webhook.");
        }

        if (!current) {
          if (!privateKey) {
            throw httpError(400, "Paste the RSA private key DocuSign issued for the integration.");
          }
          const [row] = await tx
            .insert(signingConnectors)
            .values({
              provider,
              environment: body.environment,
              integrationKey: body.integrationKey,
              apiUserId: body.apiUserId,
              privateKey,
              webhookSecret: webhookSecret ?? "",
              updateMode,
              webhookUrl: body.webhookUrl ?? null,
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
              updateMode: row.updateMode,
              integrationKey: row.integrationKey,
            },
          });
          return row;
        }

        const identityChanged =
          current.environment !== body.environment ||
          current.apiUserId !== body.apiUserId ||
          current.integrationKey !== body.integrationKey;
        if (identityChanged || (privateKey && privateKey !== current.privateKey)) {
          const live = await tx
            .select({
              providerEnvironment: contractEnvelopes.providerEnvironment,
              providerAccountId: contractEnvelopes.providerAccountId,
            })
            .from(contractEnvelopes)
            .where(needsConnector());
          const refusal = () =>
            httpError(
              409,
              `${String(live.length)} Envelope preparations, sends or outstanding executed copies still use this connector identity. ` +
                "Keep the original account and environment until their outcomes are resolved. " +
                "Rotate credentials for the same identity or turn the connector off. Existing DocuSign sessions remain usable.",
            );
          if (
            live.some(
              (envelope) =>
                (envelope.providerEnvironment !== null &&
                  envelope.providerEnvironment !== body.environment) ||
                (identityChanged && (!envelope.providerAccountId || !envelope.providerEnvironment)),
            )
          )
            throw refusal();
          if (live.some((envelope) => envelope.providerAccountId !== null)) {
            // A concurrent save may change the key that a blank field keeps.
            // Never apply a provider result to credentials we did not check.
            if (
              !observed ||
              current.id !== observed.id ||
              current.environment !== observed.environment ||
              current.integrationKey !== observed.integrationKey ||
              current.apiUserId !== observed.apiUserId ||
              current.privateKey !== observed.privateKey ||
              !candidateAccountId
            )
              throw httpError(
                409,
                "The connector or its active Envelopes changed while checking credentials. Try again.",
              );
            if (
              live.some(
                (envelope) =>
                  envelope.providerAccountId !== null &&
                  envelope.providerAccountId !== candidateAccountId,
              )
            )
              throw refusal();
          }
        }

        const [row] = await tx
          .update(signingConnectors)
          .set({
            environment: body.environment,
            updateMode,
            ...(body.webhookUrl !== undefined ? { webhookUrl: body.webhookUrl } : {}),
            integrationKey: body.integrationKey,
            apiUserId: body.apiUserId,
            // Blank keeps, and keeping means leaving the column out of
            // the UPDATE rather than writing the stored value back. The
            // two secrets are sealed at rest (TECH-022), so a rewrite
            // would open and reseal them on every save — and an
            // Administrator saving the estate while the sealing key is
            // wrong would write back what the row read as, which is
            // nothing.
            ...(privateKey ? { privateKey } : {}),
            ...(webhookSecret ? { webhookSecret } : {}),
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
        if (row.updateMode !== current.updateMode) {
          changes.push({ field: "updateMode", old: current.updateMode, new: row.updateMode });
        }
        if (row.webhookUrl !== current.webhookUrl) {
          changes.push({ field: "webhookUrl", old: current.webhookUrl, new: row.webhookUrl });
        }
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

  /** How many live rounds this install holds right now: preparing,
   * draft, or sent (`LIVE_ENVELOPE_STATUSES`). A draft counts, because
   * removing its connector would strand it at the provider.
   *
   * Read under the connector's own row lock, so a send that raced the
   * switch is either counted here or refused after it: the send's
   * reservation takes a share lock on the same row before it dials. */
  async function liveEnvelopeCount(tx: Executor): Promise<number> {
    const [row] = await tx
      .select({ live: count() })
      .from(contractEnvelopes)
      .where(needsConnector());
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
          "its credentials. New sends and launches are refused. Existing external " +
          "sessions remain usable and provider accounting continues",
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
        // Keep the number of outstanding Envelopes at the time sending stopped.
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
          "record. Provider accounting continues in both states",
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
              "still dependent on this connector for preparation, sending or outstanding executed-copy work. Removing the connector would leave " +
              `${liveEnvelopes === 1 ? "it" : "them"} without the credentials needed to resolve that work. ` +
              "Resolve preparations in DocuSign and finish sent Envelopes or outstanding executed-copy work first. Turn the connector off to refuse new launches while keeping history and status updates.",
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

export async function readSigningSettings(
  db: Db,
  provider: SigningConnector["provider"],
  baseUrl: string,
) {
  const [row] = await db
    .select()
    .from(signingConnectors)
    .where(eq(signingConnectors.provider, provider))
    .limit(1);
  return { connector: readConnector(provider, row, baseUrl) };
}
