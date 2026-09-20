// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Wire helpers shared by the notification worker and its tabs (DES-089).
 * A surface selects an API mount and a bell address; subscription keys stay on that origin.
 */
export type NotificationSurface = "staff" | "portal";
export function notificationMount(surface: NotificationSurface) {
  return surface === "portal" ? "/api/v1/portal/notifications" : "/api/v1/notifications";
}
export function bellAddress(surface: NotificationSurface) {
  return surface === "portal" ? "/portal?notifications=1" : "/?notifications=1";
}
export function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
export function subscriptionBody(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! },
  };
}
