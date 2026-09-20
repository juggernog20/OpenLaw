// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it, vi } from "vitest";
import { createIntl, createIntlCache } from "react-intl";
import { installNotificationWorker } from "./notification-worker";
import { narrateNotification, type BellItem } from "./lib/notifications";

const row: BellItem = {
  id: "n1",
  eventType: "contract.task_assigned",
  entityType: "contract",
  entityId: "c1",
  payload: { contractNumber: 42, contractTitle: "Secret agreement", actorName: "Casey" },
  readAt: null,
  createdAt: "2026-09-20T10:00:00Z",
};
const intl = createIntl({ locale: "en-US" }, createIntlCache());
let handlers: Record<string, (event: unknown) => void>;
let windows: {
  url: string;
  focused: boolean;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
}[];
const show = vi.fn();
const openWindow = vi.fn();
const fetcher = vi.fn();
const subscribe = vi.fn();
const getNotifications = vi.fn();
const subscription = {
  endpoint: "https://push.example/new",
  toJSON: () => ({ endpoint: "https://push.example/new", keys: { p256dh: "key", auth: "auth" } }),
  unsubscribe: vi.fn(),
};
async function dispatch(type: string, data: object) {
  let work: Promise<unknown> | undefined;
  handlers[type]!({
    ...data,
    waitUntil: (promise: Promise<unknown>) => {
      work = promise;
    },
  });
  await work;
}
function push(surface = "staff") {
  return dispatch("push", { data: { json: () => ({ notificationId: "n1", surface }) } });
}
beforeEach(() => {
  vi.clearAllMocks();
  handlers = {};
  windows = [];
  subscribe.mockResolvedValue(subscription);
  getNotifications.mockResolvedValue([]);
  fetcher.mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url === "/api/v1/me/notification-preferences"
            ? { showRecordNamesOnDevices: true, vapidPublicKey: "AQID" }
            : url === "/api/v1/me"
              ? { user: { role: "legal_team_member" } }
              : url.endsWith("/subscriptions")
                ? { subscriptions: [], subscription: { id: "s2" } }
                : row,
        ),
        { status: 200 },
      ),
  );
  const scope = {
    location: { origin: "https://law.example" },
    navigator: { language: "en-US" },
    fetch: fetcher,
    addEventListener: (type: string, callback: (event: unknown) => void) => {
      handlers[type] = callback;
    },
    clients: { matchAll: vi.fn(async () => windows), openWindow, claim: vi.fn() },
    registration: { showNotification: show, getNotifications, pushManager: { subscribe } },
  };
  installNotificationWorker(scope as unknown as ServiceWorkerGlobalScope);
});
it.each(["staff", "portal"] as const)("uses the %s bell's words and link", async (surface) => {
  await push(surface);
  expect(fetcher).toHaveBeenCalledWith(
    `/api/v1/${surface === "portal" ? "portal/" : ""}notifications/n1`,
    expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
  );
  const narrated = narrateNotification(intl, row, surface);
  expect(show).toHaveBeenCalledWith(
    "OpenLaw",
    expect.objectContaining({
      body: narrated.sentence,
      tag: "n1",
      renotify: false,
      data: { notificationId: "n1", surface, href: narrated.href },
    }),
  );
});
it("does not show read rows", async () => {
  fetcher.mockResolvedValue(new Response(JSON.stringify({ ...row, readAt: row.createdAt })));
  await push();
  expect(show).not.toHaveBeenCalled();
});
it("does not show while an app window is focused, even when the read fails", async () => {
  windows.push({
    url: "https://law.example/portal",
    focused: true,
    focus: vi.fn(),
    navigate: vi.fn(),
  });
  fetcher.mockRejectedValue(new Error("offline"));
  await push();
  expect(show).not.toHaveBeenCalled();
});
it.each(["staff", "portal"])(
  "silently omits inaccessible items on the %s bell",
  async (surface) => {
    for (const status of [403, 404]) {
      fetcher.mockResolvedValue(new Response("", { status }));
      await push(surface);
    }
    expect(show).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  },
);
it.each([401, 500])("opens the bell with generic words on a failed read (%s)", async (status) => {
  fetcher.mockResolvedValue(new Response("", { status }));
  await push("portal");
  expect(show).toHaveBeenCalledWith(
    "OpenLaw",
    expect.objectContaining({
      body: "You have a new notification",
      data: { notificationId: "n1", surface: "portal", href: "/portal?notifications=1" },
    }),
  );
});
it("uses only the event kind when record names are off", async () => {
  fetcher.mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("notification-preferences") ? { showRecordNamesOnDevices: false } : row,
        ),
      ),
  );
  await push();
  expect(show).toHaveBeenCalledWith(
    "OpenLaw",
    expect.objectContaining({ body: "You were assigned a Task" }),
  );
});
it("fails closed on record names when preferences cannot be read", async () => {
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith("notification-preferences")
      ? new Response("", { status: 503 })
      : new Response(JSON.stringify(row)),
  );
  await push();
  expect(show).toHaveBeenCalledWith(
    "OpenLaw",
    expect.objectContaining({ body: "You were assigned a Task" }),
  );
});
it("marks read and reuses a window of the same surface", async () => {
  const staff = {
    url: "https://law.example/contracts",
    focused: false,
    focus: vi.fn(),
    navigate: vi.fn(),
  };
  const portal = { ...staff, url: "https://law.example/portal", focus: vi.fn(), navigate: vi.fn() };
  windows.push(staff, portal);
  const close = vi.fn();
  await dispatch("notificationclick", {
    notification: {
      close,
      data: { notificationId: "n1", surface: "portal", href: "/portal/requests/41" },
    },
  });
  expect(fetcher).toHaveBeenCalledWith(
    "/api/v1/portal/notifications/read",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ ids: ["n1"] }) }),
  );
  expect(close).toHaveBeenCalled();
  expect(portal.focus).toHaveBeenCalled();
  expect(portal.navigate).toHaveBeenCalledWith("https://law.example/portal/requests/41");
  expect(staff.navigate).not.toHaveBeenCalled();
  expect(openWindow).not.toHaveBeenCalled();
});
it("opens a window even if the read write fails", async () => {
  fetcher.mockRejectedValue(new Error("offline"));
  await dispatch("notificationclick", {
    notification: {
      close: vi.fn(),
      data: { notificationId: "n1", surface: "staff", href: "/contracts/42/tasks" },
    },
  });
  expect(openWindow).toHaveBeenCalledWith("https://law.example/contracts/42/tasks");
});
it.each(["staff", "portal"])(
  "renews and posts a subscription on the %s mount without a tab",
  async (surface) => {
    fetcher.mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url === "/api/v1/me"
              ? { user: { role: surface === "portal" ? "business_user" : "legal_team_member" } }
              : { subscriptions: [], subscription: { id: "s2" } },
          ),
        ),
    );
    const options = { userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) };
    await dispatch("pushsubscriptionchange", {
      oldSubscription: { options, endpoint: "https://push.example/old" },
      newSubscription: null,
    });
    expect(subscribe).toHaveBeenCalledWith(options);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/${surface === "portal" ? "portal/" : ""}notifications/subscriptions`,
      expect.objectContaining({ method: "POST", body: JSON.stringify(subscription.toJSON()) }),
    );
  },
);
it("closes only the read ids sent by a tab", async () => {
  const close = vi.fn();
  const other = vi.fn();
  getNotifications.mockResolvedValue([
    { tag: "n1", close },
    { tag: "n2", close: other },
  ]);
  await dispatch("message", { data: { type: "notifications-read", ids: ["n1"] } });
  expect(close).toHaveBeenCalled();
  expect(other).not.toHaveBeenCalled();
});
it("ignores malformed pushes", async () => {
  await dispatch("push", {
    data: { json: () => ({ surface: "elsewhere", notificationId: "../me" }) },
  });
  expect(fetcher).not.toHaveBeenCalled();
  expect(show).not.toHaveBeenCalled();
});

it("removes the expired endpoint before renewal so the device cap cannot block it", async () => {
  let removed = false;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/v1/me")
      return new Response(JSON.stringify({ user: { role: "legal_team_member" } }));
    if (init?.method === "DELETE") {
      removed = true;
      return new Response(null, { status: 204 });
    }
    if (init?.method === "POST") return new Response("{}", { status: removed ? 200 : 409 });
    return new Response(
      JSON.stringify({ subscriptions: [{ id: "old-id", endpoint: "https://push.example/old" }] }),
    );
  });
  await dispatch("pushsubscriptionchange", {
    oldSubscription: {
      options: { userVisibleOnly: true, applicationServerKey: new Uint8Array([1]) },
      endpoint: "https://push.example/old",
    },
    newSubscription: null,
  });
  expect(removed).toBe(true);
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
});

it("saves the replacement before removing the expired endpoint", async () => {
  const order: string[] = [];
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/v1/me")
      return new Response(JSON.stringify({ user: { role: "legal_team_member" } }));
    if (init?.method === "DELETE") {
      order.push("delete");
      return new Response(null, { status: 204 });
    }
    if (init?.method === "POST") {
      order.push("post");
      return new Response("{}", { status: 200 });
    }
    return new Response(
      JSON.stringify({ subscriptions: [{ id: "old-id", endpoint: "https://push.example/old" }] }),
    );
  });
  await dispatch("pushsubscriptionchange", {
    oldSubscription: {
      options: { userVisibleOnly: true, applicationServerKey: new Uint8Array([1]) },
      endpoint: "https://push.example/old",
    },
    newSubscription: null,
  });
  expect(order).toEqual(["post", "delete"]);
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
});

it.each([429, 503])("keeps the browser subscription when the save answers %s", async (status) => {
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/v1/me")
      return new Response(JSON.stringify({ user: { role: "legal_team_member" } }));
    if (init?.method === "POST") return new Response("{}", { status });
    return new Response(JSON.stringify({ subscriptions: [] }));
  });
  await expect(
    dispatch("pushsubscriptionchange", { oldSubscription: null, newSubscription: subscription }),
  ).rejects.toThrow("Subscription could not be saved");
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
});

it("keeps the browser subscription when the save request never reaches the server", async () => {
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/v1/me")
      return new Response(JSON.stringify({ user: { role: "legal_team_member" } }));
    if (init?.method === "POST") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ subscriptions: [] }));
  });
  await expect(
    dispatch("pushsubscriptionchange", { oldSubscription: null, newSubscription: subscription }),
  ).rejects.toThrow("Failed to fetch");
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
});

it("drops the browser subscription when the server refuses it outright", async () => {
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/v1/me")
      return new Response(JSON.stringify({ user: { role: "legal_team_member" } }));
    if (init?.method === "POST") return new Response("{}", { status: 400 });
    return new Response(JSON.stringify({ subscriptions: [] }));
  });
  await expect(
    dispatch("pushsubscriptionchange", { oldSubscription: null, newSubscription: subscription }),
  ).rejects.toThrow("Subscription could not be saved");
  expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
});

it("posts the browser's replacement subscription without asking for new keys", async () => {
  await dispatch("pushsubscriptionchange", {
    oldSubscription: null,
    newSubscription: subscription,
  });
  expect(subscribe).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalledWith(
    "/api/v1/me/notification-preferences",
    expect.anything(),
  );
  expect(fetcher).toHaveBeenCalledWith(
    "/api/v1/notifications/subscriptions",
    expect.objectContaining({ method: "POST" }),
  );
});

it.each([
  ["request.status_changed", "Your request Review the NDA is now In progress"],
  ["request.declined", "Legal declined your request Review the NDA"],
  ["request.replied", "Rita replied on your request Review the NDA"],
])("narrates %s through the Portal mount and opens the Request", async (eventType, sentence) => {
  const requestRow = {
    ...row,
    eventType,
    entityType: "request",
    entityId: "r1",
    payload: {
      requestNumber: 41,
      requestTitle: "Review the NDA",
      actorName: "Rita",
      to: "converted",
    },
  };
  fetcher.mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("notification-preferences")
            ? { showRecordNamesOnDevices: true }
            : requestRow,
        ),
      ),
  );
  const staff = {
    url: "https://law.example/requests/41",
    focused: false,
    focus: vi.fn(),
    navigate: vi.fn(),
  };
  const prefix = {
    ...staff,
    url: "https://law.example/portal-other",
    focus: vi.fn(),
    navigate: vi.fn(),
  };
  windows.push(staff, prefix);
  await push("portal");
  expect(fetcher).toHaveBeenCalledWith("/api/v1/portal/notifications/n1", expect.anything());
  expect(show).toHaveBeenCalledWith(
    "OpenLaw",
    expect.objectContaining({
      body: sentence,
      data: { notificationId: "n1", surface: "portal", href: "/portal/requests/41" },
    }),
  );
  await dispatch("notificationclick", {
    notification: { close: vi.fn(), data: show.mock.calls[0]![1].data },
  });
  expect(fetcher).toHaveBeenCalledWith(
    "/api/v1/portal/notifications/read",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ ids: ["n1"] }) }),
  );
  expect(staff.focus).not.toHaveBeenCalled();
  expect(staff.navigate).not.toHaveBeenCalled();
  expect(prefix.focus).not.toHaveBeenCalled();
  expect(prefix.navigate).not.toHaveBeenCalled();
  expect(openWindow).toHaveBeenCalledWith("https://law.example/portal/requests/41");
});
