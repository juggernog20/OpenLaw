// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Personal · Notifications (#320, NOT-001/NOT-002), from the ST3 frame
 * of settings.pen and DES-050: one row per event group, one switch per
 * channel, saved the moment it is flipped (SET-003 immediate apply).
 *
 * **A row is a group, not an event.** NOT-002 keys a preference on the
 * group — "activity on my records", never one verb — so the frame's four
 * sub-rows under group 2 are one row here (DES-050 normalization 1).
 *
 * **The defaults are the state.** The table behind this pane holds
 * overrides, so somebody who has never opened it has no rows at all;
 * the API answers what they effectively get, and the switches draw that.
 * A save writes the one pair that moved, and the very next event honours
 * it.
 */

import { useRef, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, defineMessage, useIntl, type MessageDescriptor } from "react-intl";
import { api } from "../lib/api";
import { problemDetail } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Switch } from "../components/ui/switch";

/** One group's answer, as the API sends it. */
interface GroupPreference {
  eventGroup: string;
  inApp: boolean;
  email: boolean;
}

export async function settingsNotificationsLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  const { data } = await api.GET("/api/v1/me/notification-preferences");
  // A failed read must fail the pane. Drawing the catalog's defaults off
  // a network error would show somebody a grid that is not theirs.
  if (!data) throw new Error("The notification preferences could not be read.");
  return { groups: data.groups as GroupPreference[] };
}

/**
 * The groups this pane draws, in NOT-002's order.
 *
 * Four of the five. `requester_events` is the portal audience's own
 * group (NOT-001) — a business user tunes it in the portal's own
 * settings, and it has no meaning on a staff surface. It stays in the
 * model, and the API answers it, so M20 renders it where it belongs.
 *
 * `new_requests` is drawn as the frame draws it, and nothing fires it
 * until the Inbox lands (M21): an opinion can be held about a group
 * before anything in it has happened, which is why the group value
 * shipped with the engine.
 */
const STAFF_GROUPS = [
  "assigned_to_you",
  "activity_on_your_records",
  "dates_approaching",
  "new_requests",
] as const;

type StaffGroup = (typeof STAFF_GROUPS)[number];

/** What each group is called and what it covers — the frame's own copy,
 * with group 2's four sub-rows folded into the one sentence its single
 * row now carries. */
const GROUP_COPY: Record<StaffGroup, { label: MessageDescriptor; detail: MessageDescriptor }> = {
  assigned_to_you: {
    label: defineMessage({
      id: "settings.notifications.group.assigned",
      defaultMessage: "Assigned to you",
    }),
    detail: defineMessage({
      id: "settings.notifications.group.assigned.detail",
      defaultMessage: "Assignments, tasks, mentions, and approval requests addressed to you.",
    }),
  },
  activity_on_your_records: {
    label: defineMessage({
      id: "settings.notifications.group.activity",
      defaultMessage: "Activity on your records",
    }),
    detail: defineMessage({
      id: "settings.notifications.group.activity.detail",
      defaultMessage:
        "Status changes, comments, documents, and signatures on records where you're the owner, on the team, or a watcher.",
    }),
  },
  dates_approaching: {
    label: defineMessage({
      id: "settings.notifications.group.dates",
      defaultMessage: "Dates approaching",
    }),
    detail: defineMessage({
      id: "settings.notifications.group.dates.detail",
      defaultMessage: "Key dates, notice deadlines, and expiries — emailed as one daily digest.",
    }),
  },
  new_requests: {
    label: defineMessage({
      id: "settings.notifications.group.requests",
      defaultMessage: "New requests",
    }),
    detail: defineMessage({
      id: "settings.notifications.group.requests.detail",
      defaultMessage: "New intake requests arriving in the Inbox.",
    }),
  },
};

/** The two channels, in the frame's column order. */
const CHANNELS = [
  {
    id: "in_app",
    key: "inApp",
    label: defineMessage({ id: "settings.notifications.channel.inApp", defaultMessage: "In-app" }),
  },
  {
    id: "email",
    key: "email",
    label: defineMessage({ id: "settings.notifications.channel.email", defaultMessage: "Email" }),
  },
] as const;

export function SettingsNotificationsPage() {
  const intl = useIntl();
  const loaded = useLoaderData<typeof settingsNotificationsLoader>();
  const [groups, setGroups] = useState<GroupPreference[]>(loaded.groups);
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);

  const choiceOf = (group: StaffGroup): GroupPreference =>
    groups.find((row) => row.eventGroup === group) ?? {
      eventGroup: group,
      inApp: true,
      email: false,
    };

  /** Moves one pair, and nothing else on the grid. */
  const setPair = (group: StaffGroup, key: "inApp" | "email", value: boolean) =>
    setGroups((rows) =>
      rows.map((row) => (row.eventGroup === group ? { ...row, [key]: value } : row)),
    );

  /**
   * The writes still in flight, as one chain.
   *
   * Each save answers the **whole** grid, so two of them racing would let
   * the slower reply land last and undo the faster one's pair. Sending
   * them in the order they were pressed makes the last reply the last
   * press, which is the only ordering a person watching switches move
   * would accept.
   */
  const pending = useRef<Promise<void>>(Promise.resolve());

  async function send(
    group: StaffGroup,
    channel: (typeof CHANNELS)[number],
    enabled: boolean,
  ): Promise<void> {
    setStatus("saving");
    setDetail(null);
    try {
      const { data, error } = await api.PATCH("/api/v1/me/notification-preferences", {
        body: { eventGroup: group, channel: channel.id, enabled },
      });
      if (!data) {
        // Only this pair goes back, and only to the value this press
        // moved it from. A whole-grid snapshot would also undo whatever
        // was pressed while this request was in the air.
        setPair(group, channel.key, !enabled);
        setStatus("error");
        setDetail(problemDetail(error) ?? null);
        return;
      }
      // The write answers the whole grid, so the pane takes the server's
      // state rather than trusting the row it just moved.
      setGroups(data.groups as GroupPreference[]);
      setStatus("saved");
    } catch {
      setPair(group, channel.key, !enabled);
      setStatus("error");
    }
  }

  function commit(group: StaffGroup, channel: (typeof CHANNELS)[number], enabled: boolean): void {
    // The switch moves at once (SET-003 immediate apply); the write
    // queues behind whatever is already in flight.
    setPair(group, channel.key, enabled);
    pending.current = pending.current.then(() => send(group, channel, enabled));
  }

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
        actions={<StatusNote status={status} detail={detail} />}
        flush
      >
        {/* The card's own container, so the grid reflows on the width it
            actually has rather than on the viewport (DES-012). */}
        <div className="@container/prefs">
          {/* The column heads, which only mean anything once the toggles
              sit in columns. Below that width each switch carries its own
              visible label instead. */}
          <div
            aria-hidden="true"
            className="hidden h-8.5 items-center border-b border-border-default @lg/prefs:flex"
          >
            <span className="flex-1 px-4 text-xs font-semibold text-muted">
              <FormattedMessage
                id="settings.notifications.column.group"
                defaultMessage="Event group"
              />
            </span>
            {CHANNELS.map((channel) => (
              <span key={channel.id} className="w-22.5 text-xs font-semibold text-muted">
                <FormattedMessage {...channel.label} />
              </span>
            ))}
          </div>

          {STAFF_GROUPS.map((group) => {
            const choice = choiceOf(group);
            const labelId = `notification-group-${group}`;
            const detailId = `${labelId}-detail`;
            return (
              <div
                key={group}
                className="flex flex-col gap-3 border-b border-border-muted px-4 py-3 last:border-b-0 @lg/prefs:flex-row @lg/prefs:items-center @lg/prefs:gap-0 @lg/prefs:pe-0 @lg/prefs:py-2.5"
              >
                <div className="flex flex-1 flex-col gap-0.5 @lg/prefs:pe-4">
                  <span id={labelId} className="text-base font-medium text-primary">
                    <FormattedMessage {...GROUP_COPY[group].label} />
                  </span>
                  <span id={detailId} className="text-sm text-muted">
                    <FormattedMessage {...GROUP_COPY[group].detail} />
                  </span>
                </div>
                <div className="flex gap-6 @lg/prefs:gap-0">
                  {CHANNELS.map((channel) => (
                    <span key={channel.id} className="flex items-center gap-2 @lg/prefs:w-22.5">
                      {/* Visible while the columns are stacked, and the
                          switch's own name once the heads carry it — in
                          both states it is what names the control. */}
                      <span
                        id={`${labelId}-${channel.id}`}
                        className="text-xs text-muted @lg/prefs:sr-only"
                      >
                        <FormattedMessage {...channel.label} />
                      </span>
                      <Switch
                        checked={choice[channel.key]}
                        onCheckedChange={(next) => commit(group, channel, next)}
                        aria-labelledby={`${labelId} ${labelId}-${channel.id}`}
                        aria-describedby={detailId}
                      />
                    </span>
                  ))}
                </div>
              </div>
            );
          })}

          <p className="border-t border-border-default px-4 py-3 text-sm text-muted">
            <FormattedMessage
              id="settings.notifications.caption"
              defaultMessage="Email off keeps the bell items coming. In-app off turns the group off entirely, email included."
            />
          </p>
        </div>
      </SettingsCard>
    </>
  );
}
