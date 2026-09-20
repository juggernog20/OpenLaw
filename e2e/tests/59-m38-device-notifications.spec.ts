// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M38 close (#967): enrol and revoke browsers through both notification panes.
 * Only Notification and PushManager are stubbed. The built service worker,
 * preferences, sessions, and subscription routes run against the Compose stack.
 */
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { z } from "zod";
import {
  ADMIN,
  ensureAdminExists,
  ensureMemberInert,
  onboardActivatedMember,
  signInAs,
  sweepOrSay,
} from "./helpers.js";

test.setTimeout(180_000);
test.beforeAll(async ({ request }) => ensureAdminExists(request));

const Subscriptions = z.object({
  subscriptions: z.array(
    z.object({ id: z.string(), endpoint: z.string(), currentSession: z.boolean() }),
  ),
});

async function stubBrowserPush(context: BrowserContext) {
  const key = createECDH("prime256v1");
  key.generateKeys();
  const subscription = {
    endpoint: `https://push.example.com/m38/${randomUUID()}`,
    keys: {
      p256dh: key.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
  await context.addInitScript((json) => {
    // Keep browser state across reloads so persistence checks reach the server too.
    const subscription = {
      endpoint: json.endpoint,
      toJSON: () => json,
      unsubscribe: async () => {
        sessionStorage.removeItem("m38-subscribed");
        return true;
      },
    };
    Object.defineProperties(Notification, {
      permission: { get: () => sessionStorage.getItem("m38-permission") ?? "default" },
      requestPermission: {
        value: async () => {
          const count = Number(sessionStorage.getItem("m38-permission-requests") ?? 0);
          sessionStorage.setItem("m38-permission-requests", String(count + 1));
          sessionStorage.setItem("m38-permission", "granted");
          return "granted";
        },
      },
    });
    Object.defineProperties(PushManager.prototype, {
      getSubscription: {
        value: async () => (sessionStorage.getItem("m38-subscribed") ? subscription : null),
      },
      subscribe: {
        value: async (options: PushSubscriptionOptionsInit) => {
          if (!options.userVisibleOnly || !(options.applicationServerKey instanceof Uint8Array)) {
            throw new Error(
              "Enrolment must use the install's VAPID key and visible notifications.",
            );
          }
          const encoded = btoa(String.fromCharCode(...options.applicationServerKey))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
          sessionStorage.setItem("m38-vapid-key", encoded);
          sessionStorage.setItem("m38-subscribed", "true");
          return subscription;
        },
      },
    });
  }, subscription);
  return subscription.endpoint;
}

async function subscriptions(page: Page, mount: string) {
  const response = await page.request.get(`${mount}/subscriptions`);
  expect(response.status(), await response.text()).toBe(200);
  return Subscriptions.parse(await response.json()).subscriptions;
}

async function enrol(page: Page, mount: string, endpoint: string) {
  await expect(page.getByText("No browsers have been turned on.")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("m38-permission-requests"))).toBeNull();
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${mount}/subscriptions` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Turn on for this browser" }).click();
  const response = await saved;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByText("Notifications are on for this browser.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Revoke Chrome on / })).toBeVisible();
  await expect(page.getByText(/^Last seen /)).toBeVisible();
  expect(await subscriptions(page, mount)).toEqual([
    { id: expect.any(String), endpoint, currentSession: true },
  ]);
  expect(await page.evaluate(() => sessionStorage.getItem("m38-permission-requests"))).toBe("1");
  const preferences = await page.request.get("/api/v1/me/notification-preferences");
  expect(preferences.status(), await preferences.text()).toBe(200);
  const { vapidPublicKey } = z
    .object({ vapidPublicKey: z.string() })
    .parse(await preferences.json());
  expect(await page.evaluate(() => sessionStorage.getItem("m38-vapid-key"))).toBe(vapidPublicKey);
  await page.reload();
  await expect(page.getByText("Notifications are on for this browser.")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("m38-permission-requests"))).toBe("1");
}

async function flipPreference(page: Page, name: string, enabled: boolean) {
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/me/notification-preferences" &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("switch", { name, exact: true }).setChecked(enabled);
  const response = await saved;
  expect(response.status(), await response.text()).toBe(200);
  await page.reload();
  await expect(page.getByRole("switch", { name, exact: true })).toBeChecked({ checked: enabled });
}

async function revoke(page: Page, mount: string) {
  const removed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith(`${mount}/subscriptions/`) &&
      response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: /^Revoke Chrome on / }).click();
  expect((await removed).status()).toBe(204);
  await expect(page.getByText("No browsers have been turned on.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Turn on for this browser" })).toBeEnabled();
  expect(await subscriptions(page, mount)).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem("m38-subscribed"))).toBeNull();
  await page.reload();
  await expect(page.getByText("No browsers have been turned on.")).toBeVisible();
}

test("staff and a Business User enrol devices, save Push choices and record-name privacy, and revoke", async ({
  page,
  browser,
}) => {
  await signInAs(page, ADMIN.email, ADMIN.password, ADMIN.displayName);
  const run = randomUUID();
  const people = [
    { email: `m38-staff-${run}@example.com`, displayName: "M38 Staff", role: "legal_team_member" },
    { email: `m38-portal-${run}@example.com`, displayName: "M38 Requester", role: "business_user" },
  ];
  const contexts: BrowserContext[] = [];
  const cleanup = async () => {
    for (const context of contexts) await context.close();
    for (const person of people) await ensureMemberInert(page.request, person.email);
  };

  try {
    for (const person of people) {
      const member = await onboardActivatedMember(page.request, browser, {
        ...person,
        password: ADMIN.password,
      });
      contexts.push(member.context);
      const endpoint = await stubBrowserPush(member.context);
      const portal = person.role === "business_user";
      const mount = portal ? "/api/v1/portal/notifications" : "/api/v1/notifications";
      const pane = member.page;
      await pane.goto(portal ? "/portal/settings" : "/settings/notifications");
      await expect(pane.getByRole("heading", { name: "Devices", exact: true })).toBeVisible();

      const group = portal ? "Request updates" : "Assigned to you";
      for (const channel of ["In-app", "Email", "Push"]) {
        await expect(
          pane.getByRole("switch", { name: `${group} ${channel}`, exact: true }),
        ).toBeChecked();
      }
      await expect(
        pane.getByRole("switch", { name: "Dates approaching Push", exact: true }),
      ).toBeChecked();
      await expect(
        pane.getByRole("switch", { name: "Activity on your records Push", exact: true }),
      ).not.toBeChecked();
      if (!portal) {
        await expect(
          pane.getByRole("switch", { name: "New requests Push", exact: true }),
        ).not.toBeChecked();
        await expect(
          pane.getByRole("switch", { name: "Knowledge items Push", exact: true }),
        ).toHaveCount(0);
      }
      await enrol(pane, mount, endpoint);
      await flipPreference(pane, `${group} Push`, false);
      await expect(
        pane.getByRole("switch", { name: `${group} In-app`, exact: true }),
      ).toBeChecked();
      await expect(pane.getByRole("switch", { name: `${group} Email`, exact: true })).toBeChecked();
      await flipPreference(pane, `${group} Push`, true);
      await expect(
        pane.getByRole("switch", { name: "Show record names on devices" }),
      ).toBeChecked();
      await flipPreference(pane, "Show record names on devices", false);
      await flipPreference(pane, "Show record names on devices", true);
      await revoke(pane, mount);
    }
  } catch (error) {
    await sweepOrSay("M38 device notifications", cleanup);
    throw error;
  }
  await cleanup();
});
