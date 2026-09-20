// SPDX-License-Identifier: AGPL-3.0-only
/// <reference lib="webworker" />
import { createIntl, createIntlCache } from "react-intl";
import { narrateNotification, genericNotification, type BellItem } from "./lib/notifications";
import {
  applicationServerKey,
  bellAddress,
  notificationMount,
  subscriptionBody,
  type NotificationSurface,
} from "./lib/push-protocol";

type Prompt = { notificationId: string; surface: NotificationSurface };
function prompt(value: unknown): value is Prompt {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<Prompt>;
  return (
    typeof data.notificationId === "string" &&
    /^[\w-]{1,64}$/.test(data.notificationId) &&
    (data.surface === "staff" || data.surface === "portal")
  );
}

export function installNotificationWorker(scope: ServiceWorkerGlobalScope) {
  const intl = createIntl({ locale: "en-US" }, createIntlCache());
  const request = (path: string, init?: RequestInit) =>
    scope.fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
  const windows = () => scope.clients.matchAll({ type: "window", includeUncontrolled: true });
  const isPortal = (path: string) => path === "/portal" || path.startsWith("/portal/");
  const appWindows = async () =>
    (await windows()).filter((client) => new URL(client.url).origin === scope.location.origin);

  async function receive(data: Prompt) {
    if ((await appWindows()).some((client) => client.focused)) return;
    let body = intl.formatMessage({
      id: "notifications.push.new",
      defaultMessage: "You have a new notification",
    });
    let href = bellAddress(data.surface);
    try {
      const response = await request(
        `${notificationMount(data.surface)}/${encodeURIComponent(data.notificationId)}`,
      );
      if (!response.ok) throw new Error("Notification unavailable");
      const item = (await response.json()) as BellItem;
      if (item.readAt !== null) return;
      const narrated = narrateNotification(intl, item, data.surface);
      href = narrated.href ?? href;
      let showNames = false;
      try {
        const preferences = await request("/api/v1/me/notification-preferences");
        if (preferences.ok)
          showNames = (await preferences.json()).showRecordNamesOnDevices === true;
      } catch {
        /* An unreadable preference must not expose record names. */
      }
      body = showNames ? narrated.sentence : genericNotification(intl, item.eventType);
    } catch {
      /* An expired session still gets a prompt to open the bell. */
    }
    if ((await appWindows()).some((client) => client.focused)) return;
    const options = {
      body,
      tag: data.notificationId,
      renotify: false,
      icon: "/icons/openlaw-192.png",
      data: { ...data, href },
    };
    await scope.registration.showNotification("OpenLaw", options);
  }

  async function open(data: Prompt & { href?: string }) {
    try {
      await request(`${notificationMount(data.surface)}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [data.notificationId] }),
      });
    } catch {
      /* Navigation must still reach sign-in when the session has ended. */
    }
    let url = new URL(data.href ?? bellAddress(data.surface), scope.location.origin);
    if (
      url.origin !== scope.location.origin ||
      isPortal(url.pathname) !== (data.surface === "portal")
    ) {
      url = new URL(bellAddress(data.surface), scope.location.origin);
    }
    for (const client of await appWindows()) {
      if (isPortal(new URL(client.url).pathname) !== (data.surface === "portal")) continue;
      try {
        await client.focus();
        const navigated = await client.navigate(url.href);
        if (navigated !== null) return;
      } catch {
        /* A window may close between enumeration and navigation. */
      }
    }
    await scope.clients.openWindow(url.href);
  }

  async function renew(event: PushSubscriptionChangeEvent) {
    const me = await request("/api/v1/me");
    if (!me.ok) return;
    const surface = (await me.json()).user.role === "business_user" ? "portal" : "staff";
    const mount = notificationMount(surface);
    let subscription = event.newSubscription;
    if (!subscription) {
      let options = event.oldSubscription?.options;
      if (!options) {
        const preferences = await request("/api/v1/me/notification-preferences");
        if (!preferences.ok) return;
        options = {
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey((await preferences.json()).vapidPublicKey)
            .buffer,
        };
      }
      subscription = await scope.registration.pushManager.subscribe(options);
    }
    try {
      // The expired endpoint occupies one of the user's ten slots until deleted.
      if (event.oldSubscription && event.oldSubscription.endpoint !== subscription.endpoint) {
        const response = await request(`${mount}/subscriptions`);
        if (!response.ok) throw new Error("Subscriptions could not be read");
        const { subscriptions } = (await response.json()) as {
          subscriptions: { id: string; endpoint: string }[];
        };
        for (const old of subscriptions.filter(
          (row) => row.endpoint === event.oldSubscription!.endpoint,
        )) {
          const removed = await request(`${mount}/subscriptions/${encodeURIComponent(old.id)}`, {
            method: "DELETE",
          });
          if (!removed.ok && removed.status !== 404)
            throw new Error("Expired subscription could not be removed");
        }
      }
      const saved = await request(`${mount}/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscriptionBody(subscription)),
      });
      if (!saved.ok) throw new Error("Subscription could not be saved");
    } catch (error) {
      await subscription.unsubscribe();
      throw error;
    }
  }

  scope.addEventListener("activate", (event) => event.waitUntil(scope.clients.claim()));
  scope.addEventListener("push", (event) => {
    let data: unknown;
    try {
      data = event.data?.json();
    } catch {
      return;
    }
    if (prompt(data)) event.waitUntil(receive(data));
  });
  scope.addEventListener("notificationclick", (event) => {
    event.notification.close();
    if (prompt(event.notification.data)) event.waitUntil(open(event.notification.data));
  });
  scope.addEventListener("pushsubscriptionchange", (event) => event.waitUntil(renew(event)));
  scope.addEventListener("message", (event) => {
    const data = event.data;
    if (data?.type !== "notifications-read" || !Array.isArray(data.ids)) return;
    event.waitUntil(
      (async () => {
        for (const notification of await scope.registration.getNotifications()) {
          if (data.ids.includes(notification.tag)) notification.close();
        }
      })(),
    );
  });
}
