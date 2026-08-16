// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The signing connector (CTR-013, TECH-013) — the API behind Settings →
 * Organization → Integrations → E-signature.
 *
 * Three Administrator-only operations on one adapter-keyed connector:
 * read its state (never its secrets), save or rotate it, and test the
 * credentials against the provider.
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
  eq,
  signingConnectors,
  SIGNING_ENVIRONMENTS,
  SIGNING_PROVIDERS,
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
};
