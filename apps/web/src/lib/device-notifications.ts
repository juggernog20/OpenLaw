// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Browser enrolment and worker messages for device notifications (DES-089).
 * The signed-in shell owns registration. Enrolment follows a permission request on click.
 */
import { applicationServerKey, subscriptionBody, type NotificationSurface } from "./push-protocol";
import { api } from "./api";
import { problem } from "./problem";

export function supportsDeviceNotifications() {
  return (
    "serviceWorker" in navigator && "PushManager" in globalThis && "Notification" in globalThis
  );
}

const registrations = new WeakMap<ServiceWorkerContainer, Promise<ServiceWorkerRegistration>>();

export async function registerNotificationWorker() {
  if (!supportsDeviceNotifications()) return;
  const container = navigator.serviceWorker;
  if (!registrations.has(container)) {
    const pending = container.register(import.meta.env.DEV ? "/src/sw.ts" : "/sw.js", {
      type: "module",
      scope: "/",
    });
    registrations.set(container, pending);
    void pending.catch(() => registrations.delete(container));
  }
  return registrations.get(container);
}

export class NotificationWorkerUnavailableError extends Error {}

async function readyRegistration() {
  try {
    const container = navigator.serviceWorker;
    const registration = await (registrations.get(container) ?? container.getRegistration("/"));
    if (!registration) throw new Error();
    if (registration.active) return registration;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        container.ready,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error()), 15_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    throw new NotificationWorkerUnavailableError();
  }
}

export async function enrolDevice(vapidPublicKey: string, surface: NotificationSurface) {
  const registration = await readyRegistration();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(vapidPublicKey),
    }));
  try {
    const result =
      surface === "staff"
        ? await api.POST("/api/v1/notifications/subscriptions", {
            body: subscriptionBody(subscription),
          })
        : await api.POST("/api/v1/portal/notifications/subscriptions", {
            body: subscriptionBody(subscription),
          });
    if (!result.data) throw new Error((await problem(result)).detail);
    return result.data.subscription;
  } catch (error) {
    if (!existing) await subscription.unsubscribe();
    throw error;
  }
}

export async function unsubscribeDevice() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  for (const notification of (await registration?.getNotifications()) ?? []) notification.close();
}

export async function closeReadNotifications(ids: string[]) {
  if (!("serviceWorker" in navigator) || ids.length === 0) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    (navigator.serviceWorker.controller ?? registration?.active)?.postMessage({
      type: "notifications-read",
      ids,
    });
  } catch {
    /* Reading a bell item does not depend on worker availability. */
  }
}

/** Read-all covers more than the bell's loaded page. Recheck OS items through the same mount. */
export async function closeAllReadNotifications(surface: NotificationSurface) {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const notifications = (await registration?.getNotifications()) ?? [];
    const ids: string[] = [];
    for (const notification of notifications) {
      if (notification.data?.surface !== surface) continue;
      const result =
        surface === "staff"
          ? await api.GET("/api/v1/notifications/{id}", {
              params: { path: { id: notification.tag } },
            })
          : await api.GET("/api/v1/portal/notifications/{id}", {
              params: { path: { id: notification.tag } },
            });
      if (result.data?.readAt) ids.push(notification.tag);
    }
    await closeReadNotifications(ids);
  } catch {
    /* A later bell refresh can retry the read receipts. */
  }
}
