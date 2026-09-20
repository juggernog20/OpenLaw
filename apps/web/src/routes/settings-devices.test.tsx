// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { paths } from "@openlaw/api-client";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
};
type Device =
  paths["/api/v1/notifications/subscriptions"]["get"]["responses"]["200"]["content"]["application/json"]["subscriptions"][number];
const device: Device = {
  id: "s1",
  endpoint: "https://push.example/one",
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0",
  currentSession: true,
  createdAt: "2026-09-20T10:00:00Z",
  lastSeenAt: "2026-09-20T10:00:00Z",
};
const requestPermission = vi.fn();
const unsubscribe = vi.fn();
const subscribe = vi.fn();
const getSubscription = vi.fn();
const postMessage = vi.fn();
const subscription = {
  endpoint: device.endpoint,
  toJSON: () => ({ endpoint: device.endpoint, keys: { p256dh: "key", auth: "auth" } }),
  unsubscribe,
};
let devices: Device[];
let writes: StubCall[];
let failSave = false;
function extra(call: StubCall) {
  if (call.url.pathname === "/api/v1/me/notification-preferences") {
    if (call.method === "PATCH") {
      writes.push(call);
      if (failSave) return problem(500, "The change could not be saved.");
    }
    return json(200, {
      groups: [],
      briefing: [],
      vapidPublicKey: "AQID",
      showRecordNamesOnDevices: call.method === "PATCH" ? false : true,
    });
  }
  if (call.url.pathname === "/api/v1/notifications/subscriptions") {
    if (call.method === "POST") {
      writes.push(call);
      if (failSave) return problem(409, "You can register up to ten browsers.");
      devices = [device];
      return json(200, { subscription: device });
    }
    return json(200, { subscriptions: devices });
  }
  if (
    call.url.pathname.startsWith("/api/v1/notifications/subscriptions/") &&
    call.method === "DELETE"
  ) {
    writes.push(call);
    devices = [];
    return new Response(null, { status: 204 });
  }
  if (call.url.pathname === "/api/auth/sign-out") {
    writes.push(call);
    return json(200, { success: true });
  }
  return undefined;
}
beforeEach(() => {
  vi.clearAllMocks();
  devices = [];
  writes = [];
  failSave = false;
  requestPermission.mockResolvedValue("granted");
  unsubscribe.mockResolvedValue(true);
  getSubscription.mockResolvedValue(null);
  subscribe.mockResolvedValue(subscription);
  const registration = {
    pushManager: { subscribe, getSubscription },
    active: { postMessage },
    getNotifications: vi.fn(async () => []),
  };
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("navigator", {
    ...navigator,
    userAgent: "Chrome/140.0",
    serviceWorker: {
      register: vi.fn(async () => registration),
      getRegistration: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
      controller: { postMessage },
    },
  });
  stubApi({ signedIn: MEMBER, extra });
});
it("prompts only on click, posts keys, lists the browser and revokes it", async () => {
  const user = userEvent.setup();
  renderAt("/settings/notifications");
  const enable = await screen.findByRole("button", { name: "Turn on for this browser" });
  expect(requestPermission).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
  await user.click(enable);
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect(subscribe).toHaveBeenCalledWith({
    userVisibleOnly: true,
    applicationServerKey: new Uint8Array([1, 2, 3]),
  });
  expect(await screen.findByText("Chrome on Linux")).toBeVisible();
  expect(screen.getByText(/Last seen/)).toBeVisible();
  expect(writes[0]!.body).toEqual(subscription.toJSON());
  getSubscription.mockResolvedValue(subscription);
  await user.click(screen.getByRole("button", { name: /Revoke/ }));
  await waitFor(() => expect(screen.queryByText("Chrome on Linux")).not.toBeInTheDocument());
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(writes[1]!.method).toBe("DELETE");
});
it("shows the browser unblock path without prompting when blocked", async () => {
  vi.stubGlobal("Notification", { permission: "denied", requestPermission });
  renderAt("/settings/notifications");
  expect(
    await screen.findByText(/Chrome.*Settings.*Privacy and security.*Site settings.*Notifications/),
  ).toBeVisible();
  expect(requestPermission).not.toHaveBeenCalled();
});
it("shows the blocked note when the prompt is denied", async () => {
  requestPermission.mockResolvedValue("denied");
  renderAt("/settings/notifications");
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Turn on for this browser" }));
  expect(await screen.findByText(/Chrome.*Settings.*Privacy and security/)).toBeVisible();
  expect(subscribe).not.toHaveBeenCalled();
});
it("saves record names immediately and restores them on refusal", async () => {
  failSave = true;
  renderAt("/settings/notifications");
  const toggle = await screen.findByRole("switch", { name: "Show record names on devices" });
  expect(toggle).toBeChecked();
  await userEvent.setup().click(toggle);
  expect(await screen.findByText("The change could not be saved.")).toBeVisible();
  expect(toggle).toBeChecked();
  expect(writes[0]!.body).toEqual({ showRecordNamesOnDevices: false });
});
it("saves the record-name choice", async () => {
  renderAt("/settings/notifications");
  const toggle = await screen.findByRole("switch", { name: "Show record names on devices" });
  await userEvent.setup().click(toggle);
  expect(await screen.findByText("Saved")).toBeVisible();
  expect(toggle).not.toBeChecked();
});
it("unsubscribes an enrolment the server refuses and displays its reason", async () => {
  failSave = true;
  renderAt("/settings/notifications");
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Turn on for this browser" }));
  expect(await screen.findByText("You can register up to ten browsers.")).toBeVisible();
  expect(unsubscribe).toHaveBeenCalled();
});
it("revokes another device without unsubscribing this browser", async () => {
  devices = [{ ...device, endpoint: "https://push.example/other", currentSession: false }];
  getSubscription.mockResolvedValue(subscription);
  renderAt("/settings/notifications");
  await userEvent.setup().click(await screen.findByRole("button", { name: /Revoke/ }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(unsubscribe).not.toHaveBeenCalled();
});
it("unsubscribes the browser on sign-out without holding the session request", async () => {
  getSubscription.mockResolvedValue(subscription);
  // The browser API answers in a later task. The session request must
  // not wait behind it, or a navigation that lands meanwhile leaves the
  // person signed in.
  const held: ((registration: ServiceWorkerRegistration) => void)[] = [];
  vi.mocked(navigator.serviceWorker.getRegistration).mockImplementation(
    () => new Promise((resolve) => held.push(resolve)),
  );
  renderAt("/settings/notifications");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Casey Counsel" }));
  await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
  await waitFor(() =>
    expect(writes.some((call) => call.url.pathname === "/api/auth/sign-out")).toBe(true),
  );
  expect(unsubscribe).not.toHaveBeenCalled();
  for (const release of held) {
    release({
      pushManager: { subscribe, getSubscription },
      active: { postMessage },
      getNotifications: vi.fn(async () => []),
    } as unknown as ServiceWorkerRegistration);
  }
  await waitFor(() => expect(unsubscribe).toHaveBeenCalled());
});

it("explains a worker registration failure when the browser exposes push APIs", async () => {
  vi.mocked(navigator.serviceWorker.register).mockRejectedValue(
    new TypeError("Module workers are unavailable"),
  );
  vi.mocked(navigator.serviceWorker.getRegistration).mockResolvedValue(undefined);
  renderAt("/settings/notifications");
  const button = await screen.findByRole("button", { name: "Turn on for this browser" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.setup().click(button);
  expect(
    await screen.findByText(/Device notifications could not start.*Reload.*update your browser/),
  ).toBeVisible();
  expect(subscribe).not.toHaveBeenCalled();
});

it("ends the session when browser push cleanup does not settle", async () => {
  getSubscription.mockResolvedValue(subscription);
  unsubscribe.mockImplementation(() => new Promise(() => {}));
  renderAt("/settings/notifications");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Casey Counsel" }));
  await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
  await waitFor(
    () => expect(writes.some((call) => call.url.pathname === "/api/auth/sign-out")).toBe(true),
    { timeout: 5000 },
  );
});

it("registers from the Portal and manages devices only through its mount", async () => {
  const calls: StubCall[] = [];
  stubApi({
    signedIn: { ...MEMBER, role: "business_user" },
    extra: (call) => {
      if (call.url.pathname.includes("/notifications/subscriptions")) calls.push(call);
      const url = new URL(call.url);
      url.pathname = url.pathname.replace("/api/v1/portal/", "/api/v1/");
      return extra({ ...call, url });
    },
  });
  renderAt("/portal/settings");
  const enable = await screen.findByRole("button", { name: "Turn on for this browser" });
  await waitFor(() => expect(enable).toBeEnabled());
  expect(navigator.serviceWorker.register).toHaveBeenCalledWith("/src/sw.ts", {
    type: "module",
    scope: "/",
  });
  expect(requestPermission).not.toHaveBeenCalled();
  await userEvent.setup().click(enable);
  expect(await screen.findByText("Chrome on Linux")).toBeVisible();
  expect(writes[0]!.body).toEqual(subscription.toJSON());
  getSubscription.mockResolvedValue(subscription);
  await userEvent.setup().click(screen.getByRole("button", { name: "Revoke Chrome on Linux" }));
  await screen.findByText("No browsers have been turned on.");
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(calls.map((call) => [call.method, call.url.pathname])).toEqual([
    ["GET", "/api/v1/portal/notifications/subscriptions"],
    ["POST", "/api/v1/portal/notifications/subscriptions"],
    ["DELETE", "/api/v1/portal/notifications/subscriptions/s1"],
  ]);
});
