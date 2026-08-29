// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Instance email settings (#37), the API behind the SET-004 wizard's
 * SMTP setup step. Three Administrator-only operations. Read the
 * resolved state: source and from-address, never the relay URL, which
 * embeds the credential and is write-only. Save or clear the app relay,
 * refused while the environment pins SMTP because env always wins and
 * app values would never apply. Send a test email to the signed-in
 * Administrator's own address; the recipient is fixed, so the endpoint
 * cannot send arbitrary mail.
 */

import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { orgSettings } from "@openlaw/db";
import { requireRole } from "../../auth/guards.js";
import { MAILER_SOURCES } from "../../lib/mailer.js";
import { httpError, problemResponse } from "../../lib/problem.js";

const StateSchema = z.object({
  /** Where the effective configuration lives: env-pinned, app, or nowhere. */
  source: z.enum(MAILER_SOURCES),
  /** The effective from-address; null when nothing is configured. */
  fromAddress: z.string().nullable(),
});

/** smtp:// or smtps:// only, the same shape the SMTP_URL env variable takes. */
function assertRelayUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw httpError(400, "The relay URL is not a valid URL.");
  }
  if (parsed.protocol !== "smtp:" && parsed.protocol !== "smtps:") {
    throw httpError(400, "The relay URL must start with smtp:// or smtps://.");
  }
}

/**
 * A send failure the Administrator can act on: the common transport
 * errors in plain language. Everything else gets a fixed generic line,
 * never the error's own message. That message can quote the relay's
 * response verbatim, and a relay that was just handed the credential
 * must not have its text echoed into `detail` (the write-only relay-URL
 * posture). The guard on `error` matters too: a null or primitive
 * rejection must still produce the 502 Problem, not a TypeError-turned-500.
 */
function describeSendFailure(error: unknown): string {
  const err =
    typeof error === "object" && error !== null ? (error as Partial<NodeJS.ErrnoException>) : {};
  switch (err.code) {
    case "EDNS":
    case "ENOTFOUND":
      return "The relay host could not be found. Check the host name in the relay URL.";
    case "ECONNREFUSED":
      return "The relay refused the connection. Check the host and port in the relay URL.";
    case "ETIMEDOUT":
    case "ESOCKET":
    case "ECONNECTION":
      return "The relay did not respond in time. Check the host, port, and smtp/smtps scheme.";
    case "EAUTH":
      return "The relay rejected the credentials. Check the user and password in the relay URL.";
    default:
      return "The relay reported an unexpected error. Check the relay URL, credentials, and from-address.";
  }
}

export const emailSettingsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/email-settings",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "getEmailSettings",
        summary:
          "Where outbound email is configured (#37): environment, app, or " +
          "not at all — and the effective from-address. Never the relay URL",
        tags: ["email-settings"],
        response: { 200: StateSchema, default: problemResponse },
      },
    },
    async () => {
      const { source, from } = await app.resolveMailer();
      return { source, fromAddress: from };
    },
  );

  app.put(
    "/email-settings",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "saveEmailSettings",
        summary:
          "Save the app SMTP relay (#37): smtp:// or smtps:// URL with " +
          "credentials inline, plus a from-address; both null clears. " +
          "Takes effect on the next send. Refused while the environment " +
          "pins SMTP — env always wins over app configuration",
        tags: ["email-settings"],
        body: z.object({
          /** The relay URL, credentials inline. Write-only, never echoed. */
          smtpUrl: z.string().nullable(),
          smtpFrom: z.string().nullable(),
        }),
        response: { 200: StateSchema, default: problemResponse },
      },
    },
    async (request) => {
      const { source } = await app.resolveMailer();
      if (source === "env") {
        // Not merely redundant. A database relay under an env pin would
        // sit inert until the operator unsets the env vars, then start
        // sending through a relay nobody remembers saving. The dev
        // overlay's Mailpit pin depends on this refusal staying loud.
        throw httpError(
          409,
          "SMTP is set by the deployment environment (SMTP_URL / SMTP_FROM), " +
            "which always wins over settings saved here. Change it in the environment instead.",
        );
      }
      const smtpUrl = request.body.smtpUrl?.trim() || null;
      const smtpFrom = request.body.smtpFrom?.trim() || null;
      if ((smtpUrl === null) !== (smtpFrom === null)) {
        throw httpError(400, "Provide both the relay URL and the from-address, or neither.");
      }
      if (smtpUrl !== null) assertRelayUrl(smtpUrl);
      // The singleton row always exists (seeded by the 0000 migration),
      // so an unconditional UPDATE hits exactly one row. Saving nulls is
      // the documented clear. Replacing overwrites; there is no reveal.
      await app.db.update(orgSettings).set({ smtpUrl, smtpFrom });
      const { source: saved, from } = await app.resolveMailer();
      return { source: saved, fromAddress: from };
    },
  );

  app.post(
    "/email-settings/test",
    {
      preHandler: requireRole("administrator"),
      schema: {
        operationId: "sendTestEmail",
        summary:
          "Send a test email through the currently resolved mailer to the " +
          "signed-in Administrator's own address (#37); fails loudly with " +
          "a plain-language reason",
        tags: ["email-settings"],
        response: {
          200: z.object({ delivered: z.literal(true), to: z.string() }),
          default: problemResponse,
        },
      },
    },
    async (request) => {
      const { mailer } = await app.resolveMailer();
      // Unconfigured fails before dialing anything: the reason is ours to
      // author, so the relay-text scrubbing in describeSendFailure never
      // has to special-case it.
      if (!mailer.configured) {
        throw httpError(
          502,
          "The test email could not be sent. SMTP is not configured — save a relay first.",
          { expose: true },
        );
      }
      try {
        await mailer.send({
          to: request.user.email,
          subject: "OpenLaw test email",
          text: [
            `Hello ${request.user.displayName},`,
            "",
            "This is a test email from your OpenLaw instance. " +
              "Receiving it means outbound email is working.",
          ].join("\n"),
        });
      } catch (error) {
        // 502: the upstream relay (or its absence) failed us, not the
        // request. The detail is the plain-language reason the wizard
        // shows verbatim.
        throw httpError(502, `The test email could not be sent. ${describeSendFailure(error)}`, {
          expose: true,
        });
      }
      return { delivered: true as const, to: request.user.email };
    },
  );
};
