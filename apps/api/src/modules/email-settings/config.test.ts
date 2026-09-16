// SPDX-License-Identifier: AGPL-3.0-only

import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { parseConnectionUrl } from "nodemailer/lib/shared";
import { createSmtpMailer } from "../../lib/mailer.js";
import { SmtpSettingsSchema, smtpSettingsToStorage } from "./config.js";

const settings = {
  host: "127.0.0.1",
  port: 2525,
  security: "none",
  authentication: { type: "password", username: "mailer@acme.example", password: "p@:/%40?# +é" },
  senderName: 'Acme, "Legal"',
  senderEmail: "legal@acme.example",
} as const;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function startRelay(tlsProbe = false) {
  const commands: string[] = [];
  const messages: string[] = [];
  const firstBytes: Buffer[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    if (tlsProbe) {
      socket.once("data", (data) => {
        firstBytes.push(typeof data === "string" ? Buffer.from(data) : data);
        socket.destroy();
      });
      return;
    }
    socket.write("220 relay.example.com ESMTP\r\n");
    let buffer = "";
    let inData = false;
    let message = "";
    socket.on("data", (data) => {
      buffer += data.toString();
      let end: number;
      while ((end = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push(message);
            socket.write("250 queued\r\n");
          } else message += line + "\r\n";
          continue;
        }
        commands.push(line);
        if (line.startsWith("EHLO"))
          socket.write("250-relay.example.com\r\n250-AUTH PLAIN\r\n250 STARTTLS\r\n");
        else if (line.startsWith("AUTH PLAIN")) socket.write("235 authenticated\r\n");
        else if (line === "STARTTLS") socket.write("454 TLS unavailable\r\n");
        else if (line === "DATA") {
          inData = true;
          socket.write("354 send message\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing relay port");
  return { port: address.port, commands, messages, firstBytes };
}

it.each(["starttls", "tls", "none"] as const)(
  "applies %s exactly when Nodemailer parses the stored configuration",
  (security) => {
    const stored = smtpSettingsToStorage(
      SmtpSettingsSchema.parse({ ...settings, security, port: 465 }),
    );
    expect(parseConnectionUrl(stored.smtpUrl)).toMatchObject({
      port: 465,
      secure: security === "tls",
      requireTLS: security === "starttls",
      ignoreTLS: security === "none",
      auth: { user: settings.authentication.username, pass: settings.authentication.password },
    });
  },
);

it.each([true, false])(
  "delivers through SMTP with password authentication %s",
  async (authenticated) => {
    const relay = await startRelay();
    const stored = smtpSettingsToStorage(
      SmtpSettingsSchema.parse({
        ...settings,
        port: relay.port,
        authentication: authenticated ? settings.authentication : { type: "none" },
      }),
    );
    await createSmtpMailer(stored.smtpUrl, stored.smtpFrom).send({
      to: "admin@example.com",
      subject: "SMTP setup test",
      text: "Delivered through the configured relay.",
    });
    expect(relay.messages).toHaveLength(1);
    expect(relay.messages[0]).toContain("Subject: SMTP setup test");
    expect(relay.messages[0]).toContain('From: "Acme, \\"Legal\\"" <legal@acme.example>');
    expect(relay.commands).not.toContain("STARTTLS");
    const auth = relay.commands.find((command) => command.startsWith("AUTH PLAIN "));
    if (authenticated) {
      expect(Buffer.from(auth!.slice("AUTH PLAIN ".length), "base64").toString()).toBe(
        `\0${settings.authentication.username}\0${settings.authentication.password}`,
      );
    } else expect(auth).toBeUndefined();
  },
);

it("refuses delivery when STARTTLS cannot be established, before sending credentials", async () => {
  const relay = await startRelay();
  const stored = smtpSettingsToStorage(
    SmtpSettingsSchema.parse({ ...settings, port: relay.port, security: "starttls" }),
  );
  await expect(
    createSmtpMailer(stored.smtpUrl, stored.smtpFrom).send({
      to: "admin@example.com",
      subject: "test",
      text: "test",
    }),
  ).rejects.toMatchObject({ code: "ETLS" });
  expect(relay.commands).toContain("STARTTLS");
  expect(relay.commands.some((command) => command.startsWith("AUTH"))).toBe(false);
  expect(relay.messages).toHaveLength(0);
});

it("starts with a TLS handshake when implicit TLS is selected on a custom port", async () => {
  const relay = await startRelay(true);
  const stored = smtpSettingsToStorage(
    SmtpSettingsSchema.parse({ ...settings, port: relay.port, security: "tls" }),
  );
  await expect(
    createSmtpMailer(stored.smtpUrl, stored.smtpFrom).send({
      to: "admin@example.com",
      subject: "test",
      text: "test",
    }),
  ).rejects.toBeDefined();
  expect(relay.firstBytes[0]!.subarray(0, 2)).toEqual(Buffer.from([0x16, 0x03]));
});
