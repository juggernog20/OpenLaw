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

/**
 * The save chain behind the grid.
 *
 * A hook rather than state inside the grid, because the status note it
 * produces is drawn by the **card**, not by the table — one note per
 * card is DES-050 point 6, and a note per switch would put eight live
 * regions on one pane.
 */
export function useNotificationPreferences(initial: GroupPreference[]): PreferenceState {
  const [groups, setGroups] = useState<GroupPreference[]>(initial);
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [detail, setDetail] = useState<string | null>(null);

  /** Moves one pair, and nothing else on the grid. */
  const setPair = (group: EventGroup, key: "inApp" | "email", value: boolean) =>
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

  /** How many presses are in the chain, counting the one in flight.
   * `1` inside {@link send} means "nothing is queued behind me". */
  const queued = useRef(0);

  async function send(group: EventGroup, channel: Channel, enabled: boolean): Promise<void> {
    setStatus("saving");
    setDetail(null);
    try {
      const result = await api.PATCH("/api/v1/me/notification-preferences", {
        body: { eventGroup: group, channel: channel.id, enabled },
      });
      const { data } = result;
      if (!data) {
        // Only this pair goes back, and only to the value this press
        // moved it from. A whole-grid snapshot would also undo whatever
        // was pressed while this request was in the air.
        setPair(group, channel.key, !enabled);
        setStatus("error");
        setDetail((await problem(result)).detail ?? null);
        return;
      }
      // The write answers the whole grid, so the pane takes the server's
      // state rather than trusting the row it just moved — but only from
      // the last reply in the chain. An earlier one predates the presses
      // still queued behind it, and its snapshot would draw them undone
      // for as long as the next request is in the air.
      if (queued.current === 1) setGroups(data.groups);
      setStatus("saved");
    } catch {
      setPair(group, channel.key, !enabled);
      setStatus("error");
    }
  }

  function commit(group: EventGroup, channel: Channel, enabled: boolean): void {
    // The switch moves at once (SET-003 immediate apply); the write
    // queues behind whatever is already in flight.
    setPair(group, channel.key, enabled);
    queued.current += 1;
    pending.current = pending.current
      .then(() => send(group, channel, enabled))
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

  return { groups, status, detail, commit };
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
}: Readonly<{
  /** Which groups this pane draws, in the order it draws them. */
  order: readonly EventGroup[];
  state: PreferenceState;
  /** Briefing sections that have no per-publication bell channel. */
  emailOnlyGroups?: readonly EventGroup[];
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
                emailOnly && channel.id === "in_app" ? (
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
      </p>
    </div>
  );
}
