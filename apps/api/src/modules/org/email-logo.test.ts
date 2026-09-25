// SPDX-License-Identifier: AGPL-3.0-only

import { afterAll, beforeAll, expect, it } from "vitest";
import sharp from "sharp";
import { eq, notifications, orgSettings, users } from "@openlaw/db";
import { provisionUser } from "../../auth/instance.js";
import { backfillEmailLogo } from "../../lib/email-logo.js";
import { handleNotificationEmail } from "../../pipeline/notification-email.js";
import {
  signInCookies,
  startHarness,
  TEST_ADMIN,
  type TestHarness,
} from "../../testing/harness.js";

let harness: TestHarness;
let cookies: Record<string, string>;
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48"><rect width="96" height="48" fill="red"/></svg>',
);
const dataUri = (mime: string, bytes: Buffer) =>
  `data:image/${mime};base64,${bytes.toString("base64")}`;
const read = async () => (await harness.db.select().from(orgSettings))[0]!;
const upload = (logo: string | null) =>
  harness.app.inject({
    method: "PATCH",
    url: "/api/v1/org/general",
    cookies,
    payload: { logo },
  });

async function expectCopy(base64: string | null) {
  expect(base64).toBeTruthy();
  const png = Buffer.from(base64!, "base64");
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info).toMatchObject({ width: 48, height: 48, channels: 4 });
  // A wide logo keeps all its red rectangle, with transparent space above it.
  expect(data[3]).toBe(0);
  const center = (24 * 48 + 24) * 4;
  expect(data[center]).toBeGreaterThan(240);
  expect(data[center + 3]).toBe(255);
}

beforeAll(async () => {
  harness = await startHarness({ runPipelineWorkers: false });
  const setup = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: TEST_ADMIN,
  });
  expect(setup.statusCode, setup.body).toBe(201);
  cookies = await signInCookies(harness.app, TEST_ADMIN.email, TEST_ADMIN.password);
});
afterAll(async () => {
  await harness?.stop();
});

it.each(["png", "jpeg", "webp", "svg+xml"] as const)(
  "stores a 48×48 PNG for an uploaded %s logo",
  async (format) => {
    const input = format === "svg+xml" ? svg : await sharp(svg).toFormat(format).toBuffer();
    const logo = dataUri(format, input);
    const response = await upload(logo);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().general.logo).toBe(logo);
    await expectCopy((await read()).emailLogoPng);
  },
);

it("refuses undecodable bytes without changing either logo or the audit timestamp", async () => {
  const before = await read();
  const response = await upload(dataUri("png", Buffer.from("not an image")));
  expect(response.statusCode).toBe(400);
  expect(await read()).toEqual(before);
});

it("rejects a mislabeled image and an image over the pixel limit", async () => {
  const before = await read();
  const tooLarge = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="5000"><rect width="5000" height="5000" fill="red"/></svg>',
  );
  for (const logo of [dataUri("png", svg), dataUri("svg+xml", tooLarge)]) {
    const response = await upload(logo);
    expect(response.statusCode, response.body).toBe(400);
    expect(await read()).toEqual(before);
  }
});

it("clears the copy with the logo and leaves it alone on unrelated saves", async () => {
  const before = await read();
  const response = await harness.app.inject({
    method: "PATCH",
    url: "/api/v1/org/general",
    cookies,
    payload: { name: "Example Legal" },
  });
  expect(response.statusCode).toBe(200);
  expect((await read()).emailLogoPng).toBe(before.emailLogoPng);
  expect((await upload(null)).statusCode).toBe(200);
  expect(await read()).toMatchObject({ logo: null, emailLogoPng: null });
});

it.each(["png", "jpeg", "webp", "svg+xml"] as const)(
  "backfills an existing %s logo once",
  async (format) => {
    const input = format === "svg+xml" ? svg : await sharp(svg).toFormat(format).toBuffer();
    await harness.db.update(orgSettings).set({ logo: dataUri(format, input), emailLogoPng: null });
    expect(await backfillEmailLogo(harness.db)).toBe("created");
    const saved = await read();
    await expectCopy(saved.emailLogoPng);
    expect(await backfillEmailLogo(harness.db)).toBe("unchanged");
    expect(await read()).toEqual(saved);
  },
);

it("leaves no-logo installs alone and reports an unreadable legacy logo without losing it", async () => {
  await upload(null);
  expect(await backfillEmailLogo(harness.db)).toBe("unchanged");
  const logo = dataUri("png", Buffer.from("old invalid image"));
  await harness.db.update(orgSettings).set({ logo, emailLogoPng: null });
  expect(await backfillEmailLogo(harness.db)).toBe("invalid");
  expect(await read()).toMatchObject({ logo, emailLogoPng: null });
});

it("attaches the current org logo on an approval email and falls back after clearing it", async () => {
  const approver = await provisionUser(harness.app.auth, {
    email: "logo-approver@example.com",
    displayName: "Approver",
    password: "correct-horse-battery",
  });
  await harness.db
    .update(users)
    .set({ role: "legal_team_member" })
    .where(eq(users.id, approver.id));
  const options = await harness.app.inject({
    method: "GET",
    url: "/api/v1/contracts/options",
    cookies,
  });
  const contractTypeId = options
    .json()
    .contractTypes.find((row: { slug: string }) => row.slug === "nda").id;
  for (const hasLogo of [true, false]) {
    const created = await harness.app.inject({
      method: "POST",
      url: "/api/v1/contracts",
      cookies,
      payload: { title: `Logo approval ${hasLogo}`, contractTypeId },
    });
    expect(created.statusCode, created.body).toBe(201);
    const contract = created.json().contract;
    const asked = await harness.app.inject({
      method: "POST",
      url: `/api/v1/contracts/${contract.number}/approvals`,
      cookies,
      payload: { approverIds: [approver.id] },
    });
    expect(asked.statusCode, asked.body).toBe(201);
    const [notification] = await harness.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, contract.id));
    expect(notification).toBeDefined();
    // Change the brand after queueing to prove the send reads the current copy.
    expect((await upload(hasLogo ? dataUri("svg+xml", svg) : null)).statusCode).toBe(200);
    await handleNotificationEmail(
      {
        db: harness.db,
        resolveMailer: harness.resolveMailer,
        baseUrl: "https://legal.example.com",
        log: { info() {}, error() {}, warn() {} },
      },
      { notificationId: notification!.id, retryCount: 0, retryLimit: 3 },
    );
    const message = harness.mailer.messagesTo("logo-approver@example.com").at(-1)!;
    expect(message.html).toContain(contract.title);
    const cid = hasLogo ? "org-logo@openlaw" : "openlaw-mark@openlaw";
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments![0]).toMatchObject({ cid, contentType: "image/png" });
    expect(message.html).toContain(`src="cid:${cid}"`);
    expect(message.html).not.toMatch(/src=["']data:/i);
    if (hasLogo)
      expect(message.attachments![0]!.content.toString("base64")).toBe((await read()).emailLogoPng);
  }
});
