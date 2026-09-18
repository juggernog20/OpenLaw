// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one thing the SMTP sender must never do at boot: repeat the relay
 * URL when it cannot parse it. The password is in that URL (TECH-029).
 */

import { describe, expect, it } from "vitest";
import type { Db } from "@openlaw/db";
import { createMailerResolver, createSmtpMailer } from "./mailer.js";

describe("a malformed relay URL", () => {
  const url = "smtp://relay:hunter2-not-for-logs@mail.example.com:587 with a space";

  it("names the setting and the parse failure, and never echoes the value", () => {
    let failure: unknown;
    try {
      createSmtpMailer(url, "legal@example.com");
    } catch (error) {
      failure = error;
    }
    // Narrowed by `instanceof`, so the fields below are read on a real
    // Error and not on a cast.
    if (!(failure instanceof Error)) throw new Error("createSmtpMailer did not throw an Error");
    const printed = `${failure.message}\n${failure.stack}\n${JSON.stringify(failure)}`;
    expect(printed).toContain("SMTP_URL");
    expect(printed).toContain("not a valid URL");
    expect(printed).not.toContain("hunter2");
    expect(printed).not.toContain("mail.example.com");
    expect(failure).not.toHaveProperty("input");
  });

  it("names the saved setting when the URL came from Settings", () => {
    expect(() =>
      createSmtpMailer(url, "legal@example.com", "the SMTP URL saved in Settings"),
    ).toThrow(/the SMTP URL saved in Settings is not a valid URL/);
  });
});

describe("SMTP_URL set with SMTP_FROM unset (#889)", () => {
  it("pins the instance to the environment and resolves the unconfigured mailer", async () => {
    // The database is never read on the env-pinned path, so no
    // connection is needed to prove it.
    const resolve = createMailerResolver({} as Db, { url: "smtp://relay.example:587" });
    const resolved = await resolve();
    expect(resolved).toMatchObject({ source: "env", from: null });
    expect(resolved.mailer.configured).toBe(false);
    await expect(
      resolved.mailer.send({ to: "a@example.com", subject: "x", text: "x" }),
    ).rejects.toThrow(/SMTP is not configured/);
  });
});
