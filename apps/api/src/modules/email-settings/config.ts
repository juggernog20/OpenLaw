// SPDX-License-Identifier: AGPL-3.0-only

import { isIP } from "node:net";
import { z } from "zod";

const HostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(
    (host) =>
      isIP(host) !== 0 ||
      host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)),
    "Enter an SMTP hostname or IP address without a URL scheme or port.",
  );

export const SmtpSettingsSchema = z.strictObject({
  host: HostSchema,
  port: z.number().int().min(1).max(65535),
  security: z.enum(["starttls", "tls", "none"]),
  authentication: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("none") }),
    z.strictObject({
      type: z.literal("password"),
      username: z.string().min(1).max(1024),
      password: z.string().min(1).max(4096),
    }),
  ]),
  senderName: z
    .string()
    .trim()
    .max(200)
    .refine(
      (name) => !["\r", "\n", "\0"].some((character) => name.includes(character)),
      "Enter a sender name on one line.",
    ),
  senderEmail: z.string().trim().pipe(z.email().max(254)),
});

/** Keep the existing encrypted storage format for both the API and worker. */
export function smtpSettingsToStorage(settings: z.infer<typeof SmtpSettingsSchema>) {
  const host = isIP(settings.host) === 6 ? `[${settings.host}]` : settings.host;
  const url = new URL(
    `${settings.security === "tls" ? "smtps" : "smtp"}://${host}:${settings.port}`,
  );
  // Be explicit even on port 465, where Nodemailer otherwise assumes implicit TLS.
  url.searchParams.set("secure", String(settings.security === "tls"));
  url.searchParams.set("requireTLS", String(settings.security === "starttls"));
  url.searchParams.set("ignoreTLS", String(settings.security === "none"));
  if (settings.authentication.type === "password") {
    url.username = encodeURIComponent(settings.authentication.username);
    url.password = encodeURIComponent(settings.authentication.password);
  }
  return {
    smtpUrl: url.toString(),
    smtpFrom: settings.senderName
      ? `${JSON.stringify(settings.senderName)} <${settings.senderEmail}>`
      : settings.senderEmail,
  };
}
