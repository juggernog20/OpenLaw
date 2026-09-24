// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, expect, it } from "vitest";
import { orgSettings, users } from "@openlaw/db";
import { escapeHtml } from "../../lib/email-layout.js";
import type { MailMessage } from "../../lib/mailer.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  TEST_SMTP_ENV,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let admin: Record<string, string>;
const brand = "Northwind & Co";
const expiry = "The link expires in one hour. If you did not expect this email, you can ignore it.";
const expiryLine =
  "The link expires in 1 hour. If you did not expect this email, you can ignore it.";

beforeAll(async () => {
  harness = await startHarness();
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  admin = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
  await harness.db.update(orgSettings).set({ name: brand, allowedEmailDomains: ["example.com"] });
});
afterAll(async () => harness.stop());

function linkFrom(message: MailMessage): string {
  return /https?:\/\/\S+/.exec(message.text)![0];
}

function expectLayout(message: MailMessage, preheader: string) {
  expect(message.html).toContain("Northwind &amp; Co");
  // The inbox preview line comes before anything the header shows.
  expect(message.html!.indexOf(preheader)).toBeGreaterThan(-1);
  expect(message.html!.indexOf(preheader)).toBeLessThan(
    message.html!.indexOf("Northwind &amp; Co"),
  );
  expect(message.html).not.toMatch(/<script|src=["']data:|calc\(/i);
  expect(message.attachments).toHaveLength(1);
  expect(message.html).toContain(`cid:${message.attachments![0]!.cid}`);
  expect(message.html).not.toMatch(/href="[^"]*settings/);
}

function expectSecurity(
  message: MailMessage,
  portal: boolean,
  button: string,
  expires: string,
  preheader = "The link expires in 1 hour.",
) {
  expectLayout(message, preheader);
  const html = message.html!;
  const link = escapeHtml(linkFrom(message));
  expect(html).toContain(portal ? "/ Legal portal" : "/ Legal</span>");
  expect(html).toContain(`&#9679;&nbsp; ${portal ? "Legal portal" : "Account"}`);
  expect(html).toContain(expires);
  expect(html).toContain(
    "This is an automatic security email. Nobody at Northwind &amp; Co will ask you for this link.",
  );
  expect(html).toContain("Button not working? Paste this link into your browser:");
  const anchors = [...html.matchAll(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/g)];
  expect(anchors.map((match) => [match[1], match[2]])).toEqual([
    [link, button],
    [link, link],
  ]);
  // No record link or token in the preheader, copy, or footer. The two
  // anchors above are the whole set, so there is no record card either.
  expect(html.split(link)).toHaveLength(4);
  expect(html.replace(/<a\b[^>]*>.*?<\/a>/g, "")).not.toContain(link);
}

it.each(["legal_team_member", "business_user"] as const)(
  "keeps set-password text and adds the security layout for %s",
  async (role) => {
    const email = `${role}@example.com`;
    const name = "Alex & Morgan";
    if (role === "business_user") {
      await harness.db.insert(users).values({ email, displayName: name, role });
    } else {
      const invited = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/invites",
        cookies: admin,
        payload: { email, displayName: name, role },
      });
      expect(invited.statusCode, invited.body).toBe(201);
    }
    const check = () => {
      const message = harness.mailer.messagesTo(email).at(-1)!;
      const link = linkFrom(message);
      expect(message.subject).toBe("Set your OpenLaw password");
      expect(message.text).toBe(
        `Hello ${name},\n\nSet your OpenLaw password using the link below:\n\n${link}\n\n${expiry}`,
      );
      expect(link).toMatch(/^http:\/\/localhost\/auth\/set-password#token=/);
      expect(link.endsWith("&portal=1")).toBe(role === "business_user");
      expectSecurity(message, role === "business_user", "Set password", expiryLine);
      expect(message.html).toContain("Hello Alex &amp; Morgan,");
    };
    if (role !== "business_user") check();
    const reset = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/password-setup",
      payload: { email },
    });
    expect(reset.statusCode, reset.body).toBe(202);
    expect(harness.mailer.messagesTo(email)).toHaveLength(role === "business_user" ? 1 : 2);
    check();
  },
);

it("keeps new Business User password-setup text and uses the Portal layout", async () => {
  const email = "new-business@example.com";
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/password-setup",
    payload: { email },
  });
  expect(response.statusCode, response.body).toBe(202);
  const message = harness.mailer.messagesTo(email).at(-1)!;
  expect(message.subject).toBe("Set your OpenLaw password");
  expect(message.text).toBe(
    `Set your OpenLaw password using the link below:\n\n${linkFrom(message)}\n\n${expiry}`,
  );
  expect(linkFrom(message)).toMatch(/^http:\/\/localhost\/auth\/set-password#token=business\./);
  expectSecurity(message, true, "Set password", expiryLine);
});

it.each([
  [TEST_ADMIN.email, false],
  ["legal_team_member@example.com", false],
  ["business_user@example.com", true],
  ["unknown@example.com", false],
] as const)("selects the magic-link layout for %s without changing text", async (email, portal) => {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/magic-link",
    payload: { email, callbackURL: "/portal" },
  });
  expect(response.statusCode, response.body).toBe(200);
  const message = harness.mailer.messagesTo(email).at(-1)!;
  expect(message.subject).toBe("Sign in to OpenLaw");
  expect(message.text).toBe(
    `Hello,\n\nSign in to OpenLaw using the link below:\n\n${linkFrom(message)}\n\nThe link expires in five minutes and can be used once. If you did not request it, you can ignore this email.`,
  );
  expectSecurity(
    message,
    portal,
    "Sign in",
    "The link expires in 5 minutes and can be used once. If you did not request it, you can ignore this email.",
    "The link expires in 5 minutes and works once.",
  );
});

it.each(["env", "app"] as const)(
  "shows the resolved %s SMTP facts in monospace with unchanged text",
  async (source) => {
    const from = source === "env" ? TEST_SMTP_ENV.from : "Legal <legal@example.com>";
    if (source === "app") {
      harness.smtpEnv = null;
      await harness.db
        .update(orgSettings)
        .set({ smtpUrl: "smtp://user:secret@relay.example.com:587", smtpFrom: from });
    }
    try {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/email-settings/test",
        cookies: admin,
      });
      expect(response.statusCode, response.body).toBe(200);
      const message = harness.mailer.messagesTo(TEST_ADMIN.email).at(-1)!;
      expect(message.subject).toBe("OpenLaw test email");
      expect(message.text).toBe(
        `Hello ${TEST_ADMIN.displayName},\n\nThis is a test email from your OpenLaw instance. Receiving it means outbound email is working.`,
      );
      expectLayout(message, "Receiving it means outbound email is working.");
      expect(message.html).toContain("Only Administrators can send this email.");
      for (const [label, value] of [
        ["Sent through", source === "env" ? "capture.invalid:1025" : "relay.example.com:587"],
        ["From", from],
      ]) {
        expect(message.html).toContain(`>${label}</td>`);
        expect(message.html).toMatch(
          new RegExp(
            `font-family:[^;]*monospace[^>]*>${escapeHtml(value!).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`,
          ),
        );
      }
      expect(message.html).not.toMatch(/user:secret|smtp:\/\/|href=|automatic security email/);
    } finally {
      harness.smtpEnv = TEST_SMTP_ENV;
    }
  },
);
