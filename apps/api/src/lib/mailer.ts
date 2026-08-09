// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Outbound email (TECH-011): SMTP as the universal default behind a thin
 * sender interface. Provider adapters (Postmark / SES / Resend) implement
 * the same interface later; app code only ever sees `Mailer`.
 */

import nodemailer from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
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
export function createSmtpMailer(url: string, from: string): Mailer {
  const bounded = new URL(url);
  for (const [option, value] of [
    ["connectionTimeout", "10000"],
    ["greetingTimeout", "10000"],
    ["socketTimeout", "20000"],
  ] as const) {
    if (!bounded.searchParams.has(option)) bounded.searchParams.set(option, value);
  }
  const transport = nodemailer.createTransport(bounded.toString());
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

/**
 * Stand-in until SMTP is configured (the SET-004 wizard surface ships
 * later): any attempt to send fails loudly instead of dropping mail.
 */
export function createUnconfiguredMailer(): Mailer {
  return {
    send() {
      return Promise.reject(
        new Error("SMTP is not configured. Set SMTP_URL and SMTP_FROM to enable outbound email."),
      );
    },
  };
}
