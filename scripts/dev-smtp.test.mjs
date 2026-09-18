// SPDX-License-Identifier: AGPL-3.0-only

import assert from "node:assert/strict";
import test from "node:test";
import { devSmtpMode } from "./dev-smtp.mjs";

test("normal restarts use a saved relay and fall back to Mailpit only without one", async () => {
  assert.equal(await devSmtpMode({ hasSavedRelay: async () => true }), "app");
  assert.equal(await devSmtpMode({ hasSavedRelay: async () => false }), "mailpit");
});

test("explicit SMTP configuration and wizard mode do not depend on database detection", async () => {
  const hasSavedRelay = () => assert.fail("Should not read saved settings");
  assert.equal(await devSmtpMode({ explicitUrl: "smtp://relay", hasSavedRelay }), "env");
  assert.equal(
    await devSmtpMode({ forceApp: true, explicitUrl: "smtp://relay", hasSavedRelay }),
    "app",
  );
});

test("seeded runs capture email even when a real environment relay is set", async () => {
  assert.equal(
    await devSmtpMode({
      seed: true,
      explicitUrl: "smtp://real-relay",
      hasSavedRelay: () => assert.fail("Must not use a saved relay while seeding"),
    }),
    "mailpit",
  );
  await assert.rejects(devSmtpMode({ seed: true, forceApp: true }), /combined with seeding/);
});

test("a database failure does not silently switch delivery to Mailpit", async () => {
  await assert.rejects(
    devSmtpMode({
      hasSavedRelay: async () => {
        throw new Error("Database unavailable");
      },
    }),
    /Database unavailable/,
  );
});
