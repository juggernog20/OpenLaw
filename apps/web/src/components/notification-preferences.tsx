// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The notification preferences grid (NOT-001, NOT-002, DES-050): one row
 * per event group, one switch per channel, saved the moment it is
 * flipped (SET-003 immediate apply).
 *
 * **One grid, two panes** (M20/9). The API answers all six notification
 * groups, and which of them a surface draws is the surface's business:
 * Personal → Notifications draws the staff groups, and the portal's
 * settings surface draws `requester_events` alone. So the caller passes
 * the order it wants and this module owns everything else — the copy,
 * the layout, the save chain, and what a refused write does.
 *
 * **A row is a group, not an event.** NOT-002 keys a preference on the
 * group — "activity on my records", never one verb — so the ST3 frame's
 * four sub-rows under group 2 are one row here (DES-050 normalization
 * 1).
 *
 * **The defaults are the state.** The table behind this pane holds
 * overrides, so somebody who has never opened it has no rows at all; the
 * API answers what they effectively get, and the switches draw that. A
 * save writes the one pair that moved — or removes it, when the pair is
 * moved back to the group's own default — and the very next event
 * honours the result.
 */

import { useRef, useState } from "react";
import { FormattedMessage, defineMessage, type MessageDescriptor } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { type FieldStatus } from "./status-note";
import { Switch } from "./ui/switch";

/**
 * One group's answer, taken from the generated contract rather than
 * restated here.
 *
 * A hand-written copy would widen `eventGroup` to `string` and then need
 * a cast at every read — which is exactly how a pane goes on compiling
 * after the API stops answering what it draws. Derived, a group added or
 * renamed upstream is a type error in this file.
 */
export type GroupPreference =
  paths["/api/v1/me/notification-preferences"]["get"]["responses"]["200"]["content"]["application/json"]["groups"][number];

/** One of the six notification groups, as the model names it. */
export type EventGroup = GroupPreference["eventGroup"];

export type BriefingPreference =
  paths["/api/v1/me/notification-preferences"]["get"]["responses"]["200"]["content"]["application/json"]["briefing"][number];
export type BriefingGroup = BriefingPreference["eventGroup"];

/**
 * What each group is called and what it covers.
 *
 * All five, in one place, because the copy belongs to the model rather
 * than to whichever pane happens to draw a row. Group 2's four sub-rows
 * from the ST3 frame are folded into the one sentence its single row now
 * carries.
 */
export const GROUP_COPY: Record<
  EventGroup,
  { label: MessageDescriptor; detail: MessageDescriptor }
> = {
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
        "Status changes, comments, documents, and signatures on records where you're the Owner, on the team, or a watcher.",
    }),
  },
  dates_approaching: {
    label: defineMessage({
      id: "settings.notifications.group.dates",
      defaultMessage: "Dates approaching",
    }),
    detail: defineMessage({
      id: "settings.notifications.group.dates.detail",
      defaultMessage: "Bell reminders for key dates, notice deadlines, expiries, and obligations.",
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
  knowledge: {
    label: defineMessage({
      id: "settings.notifications.group.knowledge",
      defaultMessage: "Knowledge items",
    }),
    detail: defineMessage({
      id: "settings.notifications.group.knowledge.detail",
      defaultMessage: "Knowledge items included in your daily briefing.",
    }),
  },
  // Group 5, drawn on the portal alone (NOT-001). The sentence names
  // the four events INT-003 promised, in the words a requester would
  // use for them. "Request updates" rather than "Your requests":
  // everything on that surface is theirs, and the row has to name what
  // the switches turn on rather than repeat whose they are.
  requester_events: {
    label: defineMessage({
      id: "settings.notifications.group.requesterEvents",
      defaultMessage: "Request updates",
    }),
    detail: defineMessage({
      id: "settings.notifications.group.requesterEvents.detail",
      defaultMessage:
        "Receipts, replies, status changes, and decisions on the requests you submit.",
    }),
  },
};

const BRIEFING_COPY: Record<
  BriefingGroup,
  { label: MessageDescriptor; detail: MessageDescriptor }
> = {
  "briefing.approvals": {
    label: defineMessage({
      id: "settings.notifications.briefing.approvals",
      defaultMessage: "Approvals",
    }),
    detail: defineMessage({
      id: "settings.notifications.briefing.approvals.detail",
      defaultMessage: "Approval requests waiting on you.",
    }),
  },
  "briefing.tasks": {
    label: defineMessage({ id: "settings.notifications.briefing.tasks", defaultMessage: "Tasks" }),
    detail: defineMessage({
      id: "settings.notifications.briefing.tasks.detail",
      defaultMessage: "Tasks assigned to you that are due today or overdue.",
    }),
  },
  "briefing.dates": {
    label: defineMessage({ id: "settings.notifications.briefing.dates", defaultMessage: "Dates" }),
    detail: defineMessage({
      id: "settings.notifications.briefing.dates.detail",
      defaultMessage: "Key dates, notice deadlines, and expiries.",
    }),
  },
  "briefing.obligations": {
    label: defineMessage({
      id: "settings.notifications.briefing.obligations",
      defaultMessage: "Obligations",
    }),
    detail: defineMessage({
      id: "settings.notifications.briefing.obligations.detail",
      defaultMessage: "Entity obligations assigned to you or awaiting an Administrator.",
    }),
  },
  "briefing.intake": {
    label: defineMessage({
      id: "settings.notifications.briefing.intake",
      defaultMessage: "Intake",
    }),
    detail: defineMessage({
      id: "settings.notifications.briefing.intake.detail",
      defaultMessage: "Open Requests in the Inbox. Off by default.",
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

type Channel = (typeof CHANNELS)[number];

/** What the grid needs from its owner, and what the owner needs back to
 * draw the card's one status note. */
export interface PreferenceState {
  groups: GroupPreference[];
  status: FieldStatus;
  /** The refusal's own words, when there are any. */
  detail: string | null;
  commit: (group: EventGroup, channel: Channel, enabled: boolean) => void;
}

type PreferenceWrite<Row> = { rows: Row[]; detail: null } | { rows: null; detail: string | null };

/**
 * The serialized immediate-save chain shared by both preference cards.
 *
 * Each save answers its whole grid, so racing requests could let an old
 * snapshot undo a later press. Writes leave in press order and only the
 * last reply replaces local state. A refusal rolls back its one pair.
 */
function usePreferenceChain<Row, Change extends { enabled: boolean }>(
  initial: Row[],
  update: (rows: Row[], change: Change, enabled: boolean) => Row[],
  write: (change: Change) => Promise<PreferenceWrite<Row>>,
) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(0);

  async function send(change: Change): Promise<void> {
    setStatus("saving");
    setDetail(null);
    try {
      const result = await write(change);
      if (result.rows === null) {
        // Only this pair goes back, and only to the value this press
        // moved it from. A whole-grid snapshot would also undo whatever
        // was pressed while this request was in the air.
        setRows((current) => update(current, change, !change.enabled));
        setStatus("error");
        setDetail(result.detail);
        return;
      }
      if (queued.current === 1) setRows(result.rows);
      setStatus("saved");
    } catch {
      setRows((current) => update(current, change, !change.enabled));
      setStatus("error");
    }
  }

  function commit(change: Change): void {
    // The switch moves at once (SET-003 immediate apply); the write
    // queues behind whatever is already in flight.
    setRows((current) => update(current, change, change.enabled));
    queued.current += 1;
    pending.current = pending.current
      .then(() => send(change))
      // A rejected link must not poison the chain. `send` handles its
      // own failures, so this catches only what it cannot — and if it
      // ever did reject, every later press would skip its `then` and the
      // pane would quietly stop saving with nothing on screen to say so.
      .catch(() => {
        setStatus("error");
      })
      .finally(() => {
        queued.current -= 1;
      });
  }

  return { rows, status, detail, commit };
}

/**
 * The save chain behind the event-group grid. A hook rather than state
 * inside the grid lets the card draw one DES-050 status note.
 */
export function useNotificationPreferences(initial: GroupPreference[]): PreferenceState {
  const chain = usePreferenceChain(
    initial,
    (rows, change: { group: EventGroup; channel: Channel; enabled: boolean }, enabled) =>
      rows.map((row) =>
        row.eventGroup === change.group ? { ...row, [change.channel.key]: enabled } : row,
      ),
    async (change) => {
      const result = await api.PATCH("/api/v1/me/notification-preferences", {
        body: { eventGroup: change.group, channel: change.channel.id, enabled: change.enabled },
      });
      return result.data
        ? { rows: result.data.groups, detail: null }
        : { rows: null, detail: (await problem(result)).detail ?? null };
    },
  );
  return {
    groups: chain.rows,
    status: chain.status,
    detail: chain.detail,
    commit: (group, channel, enabled) => chain.commit({ group, channel, enabled }),
  };
}

export const BRIEFING_GROUPS: readonly BriefingGroup[] = [
  "briefing.approvals",
  "briefing.tasks",
  "briefing.dates",
  "briefing.obligations",
  "briefing.intake",
];

export interface BriefingPreferenceState {
  rows: BriefingPreference[];
  status: FieldStatus;
  detail: string | null;
  commit: (group: BriefingGroup, enabled: boolean) => void;
}

/** The immediate-save chain for NOT-008's email-only section rows. */
export function useBriefingPreferences(initial: BriefingPreference[]): BriefingPreferenceState {
  const chain = usePreferenceChain(
    initial,
    (rows, change: { group: BriefingGroup; enabled: boolean }, enabled) =>
      rows.map((row) => (row.eventGroup === change.group ? { ...row, email: enabled } : row)),
    async (change) => {
      const result = await api.PATCH("/api/v1/me/notification-preferences", {
        body: { eventGroup: change.group, channel: "email", enabled: change.enabled },
      });
      return result.data
        ? { rows: result.data.briefing, detail: null }
        : { rows: null, detail: (await problem(result)).detail ?? null };
    },
  );
  return {
    rows: chain.rows,
    status: chain.status,
    detail: chain.detail,
    commit: (group, enabled) => chain.commit({ group, enabled }),
  };
}

/** The visually separate email-only Briefing group (DES-050 extension). */
export function BriefingSwitchList({ state }: Readonly<{ state: BriefingPreferenceState }>) {
  const choiceOf = (group: BriefingGroup) =>
    state.rows.find((row) => row.eventGroup === group)?.email ?? false;

  return (
    <div className="@container/prefs">
      <div
        aria-hidden="true"
        className="hidden h-8.5 items-center border-b border-border-default @lg/prefs:flex"
      >
        <span className="flex-1 px-4 text-xs font-semibold text-muted">
          <FormattedMessage id="settings.notifications.column.section" defaultMessage="Section" />
        </span>
        <span className="w-27 px-2 text-xs font-semibold text-muted">
          <FormattedMessage id="settings.notifications.emailOnly" defaultMessage="Email only" />
        </span>
      </div>
      {BRIEFING_GROUPS.map((group) => {
        const labelId = `notification-group-${group}`;
        const detailId = `${labelId}-detail`;
        return (
          <div
            key={group}
            className="flex flex-col gap-3 border-b border-border-muted px-4 py-3 last:border-b-0 @lg/prefs:flex-row @lg/prefs:items-center @lg/prefs:gap-0 @lg/prefs:pe-0 @lg/prefs:py-2.5"
          >
            <div className="flex flex-1 flex-col gap-0.5 @lg/prefs:pe-4">
              <span id={labelId} className="text-base font-medium text-primary">
                <FormattedMessage {...BRIEFING_COPY[group].label} />
              </span>
              <span id={detailId} className="text-sm text-muted">
                <FormattedMessage {...BRIEFING_COPY[group].detail} />
              </span>
            </div>
            <span className="flex items-center gap-2 @lg/prefs:w-27 @lg/prefs:px-2">
              <span id={`${labelId}-email`} className="text-xs text-muted @lg/prefs:sr-only">
                <FormattedMessage
                  id="settings.notifications.channel.email"
                  defaultMessage="Email"
                />
              </span>
              <Switch
                checked={choiceOf(group)}
                onCheckedChange={(enabled) => state.commit(group, enabled)}
                aria-labelledby={`${labelId} ${labelId}-email`}
                aria-describedby={detailId}
              />
            </span>
          </div>
        );
      })}
      <p className="border-t border-border-default px-4 py-3 text-sm text-muted">
        <FormattedMessage
          id="settings.notifications.briefing.caption"
          defaultMessage="These switches change the email only. Your Home sections and daily bell summary stay on."
        />
      </p>
    </div>
  );
}

/**
 * The grid itself: a column head, one row per group drawn, and the
 * caption that says what the two switches mean to each other.
 *
 * It expects to sit in a flush card body — the table owns its gutters,
 * as every flush settings body does.
 */
export function NotificationSwitchGrid({
  order,
  state,
  emailOnlyGroups = [],
  inAppOnlyGroups = [],
}: Readonly<{
  /** Which groups this pane draws, in the order it draws them. */
  order: readonly EventGroup[];
  state: PreferenceState;
  /** Briefing sections that have no per-publication bell channel. */
  emailOnlyGroups?: readonly EventGroup[];
  /** Event groups whose email is controlled by the Briefing card. */
  inAppOnlyGroups?: readonly EventGroup[];
}>) {
  const choiceOf = (group: EventGroup): GroupPreference =>
    // The API answers every group, so the fallback is unreachable. It is
    // deliberately **not** a restatement of the group's catalogue
    // default — those differ per group, and a second copy here is how a
    // pane drifts from the model. It is the quietest thing a switch
    // could draw when it has to draw something: on for the bell, off for
    // the mail.
    state.groups.find((row) => row.eventGroup === group) ?? {
      eventGroup: group,
      inApp: true,
      email: false,
    };

  return (
    /* The card's own container, so the grid reflows on the width it
       actually has rather than on the viewport (DES-012). */
    <div className="@container/prefs">
      {/* The column heads, which only mean anything once the toggles sit
          in columns. Below that width each switch carries its own
          visible label instead. */}
      <div
        aria-hidden="true"
        className="hidden h-8.5 items-center border-b border-border-default @lg/prefs:flex"
      >
        <span className="flex-1 px-4 text-xs font-semibold text-muted">
          <FormattedMessage id="settings.notifications.column.group" defaultMessage="Event group" />
        </span>
        {CHANNELS.map((channel) => (
          <span key={channel.id} className="w-22.5 text-xs font-semibold text-muted">
            <FormattedMessage {...channel.label} />
          </span>
        ))}
      </div>

      {order.map((group) => {
        const choice = choiceOf(group);
        const emailOnly = emailOnlyGroups.includes(group);
        const inAppOnly = inAppOnlyGroups.includes(group);
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
              {CHANNELS.map((channel) =>
                (emailOnly && channel.id === "in_app") || (inAppOnly && channel.id === "email") ? (
                  <span
                    key={channel.id}
                    aria-hidden="true"
                    className="hidden @lg/prefs:block @lg/prefs:w-22.5"
                  />
                ) : (
                  <span key={channel.id} className="flex items-center gap-2 @lg/prefs:w-22.5">
                    {/* Visible while the columns are stacked, and the
                      switch's own name once the heads carry it — in both
                      states it is what names the control. */}
                    <span
                      id={`${labelId}-${channel.id}`}
                      className="text-xs text-muted @lg/prefs:sr-only"
                    >
                      <FormattedMessage {...channel.label} />
                    </span>
                    <Switch
                      checked={choice[channel.key]}
                      onCheckedChange={(next) => state.commit(group, channel, next)}
                      aria-labelledby={`${labelId} ${labelId}-${channel.id}`}
                      aria-describedby={detailId}
                    />
                  </span>
                ),
              )}
            </div>
          </div>
        );
      })}

      <p className="border-t border-border-default px-4 py-3 text-sm text-muted">
        <FormattedMessage
          id="settings.notifications.caption"
          defaultMessage="Email off keeps the bell items coming. In-app off turns the group off entirely, email included."
        />
        {/* The two-switch sentence is false for an email-only group —
            there are no bell items to keep coming — so the caption says
            so whenever one is drawn. */}
        {emailOnlyGroups.length > 0 ? (
          <>
            {" "}
            <FormattedMessage
              id="settings.notifications.captionEmailOnly"
              defaultMessage="A group with no in-app switch reaches you by email only; its one switch is the whole choice."
            />
          </>
        ) : null}
        {inAppOnlyGroups.length > 0 ? (
          <>
            {" "}
            <FormattedMessage
              id="settings.notifications.captionInAppOnly"
              defaultMessage="Approaching-date emails are set in the Briefing group below."
            />
          </>
        ) : null}
      </p>
    </div>
  );
}
