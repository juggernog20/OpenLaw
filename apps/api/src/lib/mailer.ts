// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Outbound email (TECH-011): SMTP as the universal default behind a thin
 * sender interface. Provider adapters (Postmark / SES / Resend) implement
 * the same interface later; app code only ever sees `Mailer`.
 */

import nodemailer from "nodemailer";
import { type Db } from "@openlaw/db";
import { getOrgSettings } from "./org-settings.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content: Buffer; contentType: string; cid?: string }[];
}

export interface Mailer {
  /**
   * Whether outbound email is wired to a real sender. Read by surfaces
   * that must not promise mail they cannot deliver (the SET-004 wizard's
   * email step); `send` on an unconfigured mailer still fails loudly.
   */
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

/**
 * Parses the relay URL without ever repeating it.
 *
 * Node's `TypeError: Invalid URL` carries the input as its `input`
 * field, and an uncaught one prints it. The relay password is in that
 * input. So the failure is reported by the name of the setting that
 * holds the value, and the value stays where it was (TECH-029).
 */
function parseSmtpUrl(url: string, source: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error(
      `${source} is not a valid URL. Expected smtp://user:pass@host:port or smtps://...; ` +
        "check the value for a missing scheme or an unescaped character in the password.",
    );
  }
}

/**
 * SMTP sender — `url` is a nodemailer connection URL
 * (smtp[s]://user:pass@host:port, extra options as query parameters).
 *
 * Sends are awaited inside request handlers (invites, magic links), so an
 * unresponsive relay must fail in seconds — nodemailer's default socket
 * timeout is 10 minutes. The bounds ride the URL as query parameters
 * (nodemailer's documented option channel for URL configs), and an
 * operator's own query parameters win over these defaults.
 */
export function createSmtpMailer(url: string, from: string, source = "SMTP_URL"): Mailer {
  const bounded = parseSmtpUrl(url, source);
  for (const [option, value] of [
    ["connectionTimeout", "10000"],
    ["greetingTimeout", "10000"],
    ["socketTimeout", "20000"],
  ] as const) {
    if (!bounded.searchParams.has(option)) bounded.searchParams.set(option, value);
  }
  const transport = nodemailer.createTransport(bounded.toString());
  return {
    configured: true,
    async send(message) {
      await transport.sendMail({
        from,
        ...message,
        attachments: message.attachments?.map((attachment) => ({
          ...attachment,
          ...(attachment.cid ? { contentDisposition: "inline" } : {}),
        })),
      });
    },
  };
}

/**
 * Stand-in while SMTP is unconfigured: any attempt to send fails loudly
 * instead of dropping mail.
 */
export function createUnconfiguredMailer(): Mailer {
  return {
    configured: false,
    send() {
      return Promise.reject(
        new Error(
          "SMTP is not configured. Set it up in the Welcome to OpenLaw wizard, " +
            "or set SMTP_URL and SMTP_FROM in the environment.",
        ),
      );
    },
  };
}

/**
 * Where the effective SMTP configuration lives (#37): pinned by the
 * deployment environment, saved in the app through the wizard's email
 * step, or nowhere yet.
 */
export const MAILER_SOURCES = ["env", "app", "unset"] as const;
export type MailerSource = (typeof MAILER_SOURCES)[number];

export interface ResolvedMailer {
  source: MailerSource;
  from: string | null;
  mailer: Mailer;
}

/**
 * The app's mail composition point (#37): resolved at send time, so a
 * wizard save applies to the very next send — no restart, no cache to
 * invalidate (the TECH-014 read-on-every-decision pattern).
 */
export type MailerResolver = () => Promise<ResolvedMailer>;

export interface SmtpEnv {
  url?: string;
  from?: string;
}

/**
 * The env-pinned half of resolution, or null when the environment sets
 * no relay URL. A present URL pins the instance even without a from
 * address; it then cannot send, and says so on every send (#889).
 * Configuration cannot change under a running process, so the fixed
 * mailer is built once.
 */
export function envPinnedMailer(env: SmtpEnv): ResolvedMailer | null {
  if (!env.url) return null;
  return env.from
    ? { source: "env", from: env.from, mailer: createSmtpMailer(env.url, env.from) }
    : { source: "env", from: null, mailer: createUnconfiguredMailer() };
}

/**
 * Env-else-database resolution, environment first as a safety property,
 * not a convenience: the dev/E2E overlay pins Mailpit via env, and a
 * database-saved real relay must never beat it — or test traffic reaches
 * real inboxes. A present env URL alone pins the instance (`source:
 * "env"`, database ignored) even when SMTP_FROM is missing and sending
 * therefore cannot work; the email-settings surface then points the
 * operator at the environment instead of accepting values that would
 * never apply.
 */
export function createMailerResolver(db: Db, env: SmtpEnv): MailerResolver {
  const pinned = envPinnedMailer(env);
  if (pinned) return () => Promise.resolve(pinned);
  const unset: ResolvedMailer = { source: "unset", from: null, mailer: createUnconfiguredMailer() };
  return async () => {
    const settings = await getOrgSettings(db);
    if (!settings.smtpUrl || !settings.smtpFrom) return unset;
    return {
      source: "app",
      from: settings.smtpFrom,
      mailer: createSmtpMailer(
        settings.smtpUrl,
        settings.smtpFrom,
        "the SMTP URL saved in Settings",
      ),
    };
  };
}
