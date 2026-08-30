// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Personal · Notifications (#320, NOT-001/NOT-002), from the ST3 frame
 * of settings.pen and DES-050: one row per event group, one switch per
 * channel, saved the moment it is flipped (SET-003 immediate apply).
 *
 * The pane is the card; the grid is shared (M20/9). This file owns the
 * settings chrome (the page title, the settings card, and the one
 * status note in its header strip) and the choice of which of
 * notification groups a staff reader is shown. The table itself is
 * `components/notification-preferences.tsx`, because the portal draws
 * the same table over a different row.
 */

import { useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { requireUser } from "../lib/session";
import { PageTitle } from "../components/page-title";
import {
  NotificationSwitchGrid,
  useNotificationPreferences,
  type EventGroup,
} from "../components/notification-preferences";
import { SettingsCard } from "../components/settings-card";
import { StatusNote } from "../components/status-note";

export async function settingsNotificationsLoader() {
  await requireUser();
  const { data } = await api.GET("/api/v1/me/notification-preferences");
  // A failed read must fail the pane. Drawing the catalog's defaults off
  // a network error would show somebody a grid that is not theirs.
  if (!data) throw new Error("The notification preferences could not be read.");
  return { groups: data.groups };
}

/**
 * The groups this pane draws, in NOT-002's order.
 *
 * Five of the six. `requester_events` is the portal audience's own
 * group (NOT-001). A Business User tunes it in the portal's own
 * settings page, and it has no meaning on a staff page. It stays
 * in the model, and the API answers it, so the portal renders it where
 * it belongs.
 *
 * `new_requests` is drawn as the frame draws it, and from M21/4 the
 * switches control something that fires: a Request arriving in the Inbox
 * reaches every live Member+ (INT-006). The group value shipped ahead of
 * that event because an opinion can be held about a group before
 * anything in it has happened.
 */
const STAFF_GROUPS: readonly EventGroup[] = [
  "assigned_to_you",
  "activity_on_your_records",
  "dates_approaching",
  "new_requests",
  "knowledge",
];

export function SettingsNotificationsPage() {
  const intl = useIntl();
  const loaded = useLoaderData<typeof settingsNotificationsLoader>();
  const state = useNotificationPreferences(loaded.groups);

  return (
    <>
      <PageTitle
        title={intl.formatMessage({
          id: "settings.section.notifications",
          defaultMessage: "Notifications",
        })}
      />
      <SettingsCard
        title={
          <FormattedMessage
            id="settings.notifications.title"
            defaultMessage="Notification preferences"
          />
        }
        actions={<StatusNote status={state.status} detail={state.detail} />}
        flush
      >
        <NotificationSwitchGrid
          order={STAFF_GROUPS}
          state={state}
          emailOnlyGroups={["knowledge"]}
        />
      </SettingsCard>
    </>
  );
}
