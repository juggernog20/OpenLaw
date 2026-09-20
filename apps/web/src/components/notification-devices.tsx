// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Devices card on Personal Notifications (DES-089). Lists registered browsers,
 * requests permission on click, and saves revocation and record-name choices immediately.
 */
import { useCallback, useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import type { NotificationSurface } from "../lib/push-protocol";
import { problem } from "../lib/problem";
import {
  enrolDevice,
  supportsDeviceNotifications,
  NotificationWorkerUnavailableError,
} from "../lib/device-notifications";
import { formatLongDateTime, formatRelativeOrShort } from "../lib/format";
import { SettingsCard } from "./settings-card";
import { StatusNote, type FieldStatus } from "./status-note";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

type Device =
  paths["/api/v1/notifications/subscriptions"]["get"]["responses"]["200"]["content"]["application/json"]["subscriptions"][number];
function browserName(agent: string) {
  if (/Edg\//.test(agent)) return "Edge";
  if (/Firefox\//.test(agent)) return "Firefox";
  if (/Chrome\//.test(agent)) return "Chrome";
  if (/Safari\//.test(agent)) return "Safari";
  return null;
}
function devicePlatform(agent: string) {
  if (/Android/.test(agent)) return "Android";
  if (/iPhone|iPad/.test(agent)) return "iOS";
  if (/Windows/.test(agent)) return "Windows";
  if (/Macintosh|Mac OS/.test(agent)) return "macOS";
  if (/Linux/.test(agent)) return "Linux";
  return null;
}
function UnblockNote() {
  const browser = browserName(navigator.userAgent);
  if (/iPhone|iPad/.test(navigator.userAgent))
    return (
      <FormattedMessage
        id="settings.devices.blocked.ios"
        defaultMessage="Notifications are blocked. Open Settings > Notifications > OpenLaw and turn on Allow Notifications."
      />
    );
  if (browser === "Firefox")
    return (
      <FormattedMessage
        id="settings.devices.blocked.firefox"
        defaultMessage="Notifications are blocked. In Firefox, open Settings > Privacy & Security > Permissions > Notifications > Settings and allow this site."
      />
    );
  if (browser === "Safari")
    return (
      <FormattedMessage
        id="settings.devices.blocked.safari"
        defaultMessage="Notifications are blocked. In Safari, open Settings > Websites > Notifications and allow this site."
      />
    );
  if (browser === "Chrome")
    return (
      <FormattedMessage
        id="settings.devices.blocked.chrome"
        defaultMessage="Notifications are blocked. In Chrome, open Settings > Privacy and security > Site settings > Notifications and allow this site."
      />
    );
  if (browser === "Edge")
    return (
      <FormattedMessage
        id="settings.devices.blocked.edge"
        defaultMessage="Notifications are blocked. In Edge, open Settings > Privacy, search, and services > Site permissions > All sites. Choose this site and allow Notifications."
      />
    );
  return (
    <FormattedMessage
      id="settings.devices.blocked.other"
      defaultMessage="Notifications are blocked. Open this site's permissions from the address bar and allow notifications."
    />
  );
}

export function NotificationDevices({
  vapidPublicKey,
  showRecordNames,
  surface = "staff",
}: Readonly<{ vapidPublicKey: string; showRecordNames: boolean; surface?: NotificationSurface }>) {
  const intl = useIntl();
  const supported = supportsDeviceNotifications();
  const [permission, setPermission] = useState(supported ? Notification.permission : "default");
  const [devices, setDevices] = useState<Device[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [names, setNames] = useState(showRecordNames);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api
        .GET(
          surface === "portal"
            ? "/api/v1/portal/notifications/subscriptions"
            : "/api/v1/notifications/subscriptions",
        )
        .then((result) => {
          if (!result.data) throw new Error();
          setLoadFailed(false);
          setDevices(result.data.subscriptions);
          setLoaded(true);
        })
        .catch(() => setLoadFailed(true)),
    [surface],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!supported) return;
    void navigator.serviceWorker
      .getRegistration("/")
      .then(async (registration) => {
        setEndpoint((await registration?.pushManager.getSubscription())?.endpoint ?? null);
      })
      .catch(() => {});
    const refresh = () => setPermission(Notification.permission);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [supported]);

  async function save(work: () => Promise<void | false>) {
    setStatus("saving");
    setDetail(null);
    try {
      const changed = await work();
      setStatus(changed === false ? "idle" : "saved");
    } catch (error) {
      setStatus("error");
      setDetail(
        error instanceof NotificationWorkerUnavailableError
          ? intl.formatMessage({
              id: "settings.devices.workerUnavailable",
              defaultMessage:
                "Device notifications could not start in this browser. Reload to try again, or update your browser and try again.",
            })
          : error instanceof Error
            ? error.message
            : null,
      );
    }
  }
  async function turnOn() {
    await save(async () => {
      // Request permission while the click still has user activation.
      const next = await Notification.requestPermission();
      setPermission(next);
      if (next !== "granted") return false;
      const device = await enrolDevice(vapidPublicKey, surface);
      setEndpoint(device.endpoint);
      setDevices((current) => [device, ...current.filter((row) => row.id !== device.id)]);
      setLoaded(true);
    });
  }
  async function revoke(device: Device) {
    await save(async () => {
      // Revoke server delivery even if the browser has already lost the subscription.
      const result = await api.DELETE(
        surface === "portal"
          ? "/api/v1/portal/notifications/subscriptions/{id}"
          : "/api/v1/notifications/subscriptions/{id}",
        {
          params: { path: { id: device.id } },
        },
      );
      if (!result.response.ok) throw new Error((await problem(result)).detail);
      setDevices((current) => current.filter((row) => row.id !== device.id));
      if (supported) {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription?.endpoint === device.endpoint) {
          await subscription.unsubscribe();
          setEndpoint(null);
        }
      }
    });
  }
  const active = devices.some((device) => device.endpoint === endpoint && device.currentSession);
  return (
    <SettingsCard
      title={<FormattedMessage id="settings.devices.title" defaultMessage="Devices" />}
      actions={<StatusNote status={status} detail={detail} />}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          <FormattedMessage
            id="settings.devices.description"
            defaultMessage="Get notifications on your devices, even when OpenLaw is closed. Turning In-app off for an event group also silences its Push notifications."
          />
        </p>
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="device-record-names" className="text-base font-medium">
            <FormattedMessage
              id="settings.devices.recordNames"
              defaultMessage="Show record names on devices"
            />
          </label>
          <Switch
            id="device-record-names"
            checked={names}
            disabled={status === "saving"}
            onCheckedChange={(next) => {
              setNames(next);
              void save(async () => {
                try {
                  const result = await api.PATCH("/api/v1/me/notification-preferences", {
                    body: { showRecordNamesOnDevices: next },
                  });
                  if (!result.data) throw new Error((await problem(result)).detail);
                  setNames(result.data.showRecordNamesOnDevices);
                } catch (error) {
                  setNames(!next);
                  throw error;
                }
              });
            }}
          />
        </div>
        {!supported ? (
          <p className="text-sm text-muted">
            <FormattedMessage
              id="settings.devices.unsupported"
              defaultMessage="This browser does not support device notifications. On iPhone or iPad, add OpenLaw to your Home Screen and open it there."
            />
          </p>
        ) : permission === "denied" ? (
          <p className="text-sm text-muted">
            <UnblockNote />
          </p>
        ) : active ? (
          <p className="text-sm text-muted">
            <FormattedMessage
              id="settings.devices.enabled"
              defaultMessage="Notifications are on for this browser."
            />
          </p>
        ) : (
          <Button
            className="self-start"
            disabled={!loaded || status === "saving"}
            onClick={() => void turnOn()}
          >
            <FormattedMessage
              id="settings.devices.turnOn"
              defaultMessage="Turn on for this browser"
            />
          </Button>
        )}
        {loadFailed ? (
          <div className="text-sm text-status-danger-fg">
            <FormattedMessage
              id="settings.devices.loadFailed"
              defaultMessage="Devices could not be read."
            />{" "}
            <Button variant="link" onClick={() => void load()}>
              <FormattedMessage id="settings.devices.retry" defaultMessage="Try again" />
            </Button>
          </div>
        ) : !loaded ? (
          <p className="text-sm text-muted">
            <FormattedMessage id="settings.devices.loading" defaultMessage="Reading devices…" />
          </p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted">
            <FormattedMessage
              id="settings.devices.empty"
              defaultMessage="No browsers have been turned on."
            />
          </p>
        ) : (
          <ul className="divide-y divide-border-muted">
            {devices.map((device) => {
              const browser = browserName(device.userAgent);
              const platform = devicePlatform(device.userAgent);
              const label =
                browser && platform
                  ? intl.formatMessage(
                      { id: "settings.devices.label", defaultMessage: "{browser} on {platform}" },
                      { browser, platform },
                    )
                  : (browser ??
                    intl.formatMessage({
                      id: "settings.devices.unknownBrowser",
                      defaultMessage: "Browser",
                    }));
              return (
                <li key={device.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-base font-medium">{label}</p>
                    <p className="text-sm text-muted">
                      <FormattedMessage
                        id="settings.devices.lastSeen"
                        defaultMessage="Last seen {time}"
                        values={{
                          time: (
                            <time
                              dateTime={device.lastSeenAt}
                              title={formatLongDateTime(device.lastSeenAt)}
                            >
                              {formatRelativeOrShort(device.lastSeenAt)}
                            </time>
                          ),
                        }}
                      />
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    disabled={status === "saving"}
                    aria-label={intl.formatMessage(
                      { id: "settings.devices.revokeNamed", defaultMessage: "Revoke {device}" },
                      { device: label },
                    )}
                    onClick={() => void revoke(device)}
                  >
                    <FormattedMessage id="settings.devices.revoke" defaultMessage="Revoke" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SettingsCard>
  );
}
