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

/** SMTP sender — `url` is a nodemailer connection URL (smtp[s]://user:pass@host:port). */
export function createSmtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
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
