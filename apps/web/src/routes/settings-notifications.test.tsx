// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Personal · Notifications (#320) at the route seam: the rail carries
 * the entry M5 omitted, the pane draws one row per staff event group
 * with the defaults rendered as switch state, and a flip saves
 * immediately (SET-003).
 *
 * Nothing here asserts how the fan-out is wired. That belongs to
 * `preferences.test.ts`, over the real engine. This suite pins what a
 * person sees and what the pane sends.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BriefingPreference } from "../components/notification-preferences";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
};

/** The grid the API answers, with NOT-002's defaults. */
const DEFAULTS = [
  { eventGroup: "assigned_to_you", inApp: true, email: true },
  { eventGroup: "activity_on_your_records", inApp: true, email: false },
  { eventGroup: "dates_approaching", inApp: true, email: true },
  { eventGroup: "new_requests", inApp: true, email: false },
  { eventGroup: "knowledge", inApp: true, email: true },
  { eventGroup: "requester_events", inApp: true, email: true },
];

const BRIEFING_DEFAULTS = [
  { eventGroup: "briefing.approvals", email: true },
  { eventGroup: "briefing.tasks", email: true },
  { eventGroup: "briefing.dates", email: true },
  { eventGroup: "briefing.obligations", email: true },
  { eventGroup: "briefing.intake", email: false },
] satisfies BriefingPreference[];

/** Answers the pane's read and captures its writes, the way the real
 * endpoint does. Every save answers the whole grid back. */
function capturePreferenceWrites(writes: unknown[], failWith?: Response) {
  let groups = DEFAULTS.map((row) => ({ ...row }));
  let briefing: BriefingPreference[] = BRIEFING_DEFAULTS.map((row) => ({ ...row }));
  return (call: StubCall) => {
    if (call.url.pathname !== "/api/v1/me/notification-preferences") return undefined;
    if (call.method === "PATCH") {
      const body = call.body as { eventGroup: string; channel: string; enabled: boolean };
      writes.push(body);
      if (failWith) return failWith;
      groups = groups.map((row) =>
        row.eventGroup === body.eventGroup
          ? { ...row, [body.channel === "in_app" ? "inApp" : "email"]: body.enabled }
          : row,
      );
      briefing = briefing.map((row) =>
        row.eventGroup === body.eventGroup ? { ...row, email: body.enabled } : row,
      );
    }
    return json(200, { groups, briefing });
  };
}

describe("Personal · Notifications (#320)", () => {
  it("carries the rail entry M5 omitted", async () => {
    stubApi({ signedIn: MEMBER, extra: capturePreferenceWrites([]) });
    renderAt("/settings/notifications");

    const rail = await screen.findByRole("navigation", { name: "Settings sections" });
    expect(within(rail).getByRole("link", { name: "Notifications" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("draws one row per staff group, with the defaults as switch state", async () => {
    stubApi({ signedIn: MEMBER, extra: capturePreferenceWrites([]) });
    renderAt("/settings/notifications");

    expect(await screen.findByRole("heading", { name: "Notification preferences" })).toBeVisible();

    // The five staff groups. Group 2 is one row and not the frame's four
    // sub-rows: NOT-002 keys a preference on the group (DES-050).
    for (const label of [
      "Assigned to you",
      "Activity on your records",
      "Dates approaching",
      "New requests",
      "Knowledge items",
    ]) {
      expect(screen.getByText(label)).toBeVisible();
    }

    // Defaults follow interruptiveness: direct asks interrupt, ambient
    // activity does not, and the bell is on for everything.
    expect(screen.getByRole("switch", { name: "Assigned to you In-app" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Assigned to you Email" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Activity on your records In-app" })).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Activity on your records Email" }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("switch", { name: "Dates approaching Email" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "New requests Email" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Knowledge items Email" })).toBeChecked();
  });

  it("does not draw the portal audience's own group", async () => {
    stubApi({ signedIn: MEMBER, extra: capturePreferenceWrites([]) });
    renderAt("/settings/notifications");

    await screen.findByRole("heading", { name: "Notification preferences" });
    // Group 5 stays in the model and in the API's answer; a business
    // user tunes it in the portal, so it means nothing on a staff pane.
    // Named by its visible label — M20/9 gave the row real copy, and a
    // regex on the model's name would go on passing if the pane drew it.
    expect(screen.queryByText("Request updates")).not.toBeInTheDocument();
    // Four event groups have two channels. Knowledge has one briefing
    // switch because publishing never makes a bell event.
    expect(screen.getAllByRole("switch")).toHaveLength(13);
  });

  it("draws a separate email-only Briefing group and saves its rows", async () => {
    const user = userEvent.setup();
    const writes: unknown[] = [];
    stubApi({ signedIn: MEMBER, extra: capturePreferenceWrites(writes) });
    renderAt("/settings/notifications");

    const briefing = await screen.findByRole("heading", { name: "Briefing" });
    expect(briefing).toBeVisible();
    for (const label of ["Approvals", "Tasks", "Dates", "Obligations", "Intake"]) {
      expect(screen.getByText(label)).toBeVisible();
      expect(screen.queryByRole("switch", { name: `${label} In-app` })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("switch", { name: "Approvals Email" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Intake Email" })).not.toBeChecked();

    await user.click(screen.getByRole("switch", { name: "Intake Email" }));
    await waitFor(() =>
      expect(writes).toContainEqual({
        eventGroup: "briefing.intake",
        channel: "email",
        enabled: true,
      }),
    );
    expect(screen.getByRole("switch", { name: "Intake Email" })).toBeChecked();
  });

  it("saves a flip immediately and leaves the other channel alone", async () => {
    const user = userEvent.setup();
    const writes: unknown[] = [];
    stubApi({ signedIn: MEMBER, extra: capturePreferenceWrites(writes) });
    renderAt("/settings/notifications");

    const email = await screen.findByRole("switch", { name: "Assigned to you Email" });
    await user.click(email);

    await waitFor(() =>
      expect(writes).toEqual([{ eventGroup: "assigned_to_you", channel: "email", enabled: false }]),
    );
    expect(await screen.findByText("Saved")).toBeVisible();
    expect(screen.getByRole("switch", { name: "Assigned to you Email" })).not.toBeChecked();
    // The bell for the same group is untouched. Opting out of
    // interruption is not opting out of information.
    expect(screen.getByRole("switch", { name: "Assigned to you In-app" })).toBeChecked();
  });

  it("sends two quick flips in order, so the slower reply cannot undo the faster press", async () => {
    const user = userEvent.setup();
    const writes: unknown[] = [];
    let groups = DEFAULTS.map((row) => ({ ...row }));
    const releases: (() => void)[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname !== "/api/v1/me/notification-preferences") return undefined;
        if (call.method !== "PATCH") return json(200, { groups, briefing: BRIEFING_DEFAULTS });
        const body = call.body as { eventGroup: string; channel: string; enabled: boolean };
        writes.push(body);
        groups = groups.map((row) =>
          row.eventGroup === body.eventGroup
            ? { ...row, [body.channel === "in_app" ? "inApp" : "email"]: body.enabled }
            : row,
        );
        // Every reply is held open, so the test decides when each one
        // lands and can look at the pane in the gap between them.
        const answer = json(200, { groups, briefing: BRIEFING_DEFAULTS });
        return new Promise<Response>((resolve) => {
          releases.push(() => {
            resolve(answer);
          });
        });
      },
    });
    renderAt("/settings/notifications");

    await user.click(await screen.findByRole("switch", { name: "Assigned to you Email" }));
    await user.click(screen.getByRole("switch", { name: "Activity on your records Email" }));

    // Both switches have already moved, and only the first write is out.
    expect(screen.getByRole("switch", { name: "Assigned to you Email" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Activity on your records Email" })).toBeChecked();
    expect(writes).toHaveLength(1);

    releases[0]!();
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes).toEqual([
      { eventGroup: "assigned_to_you", channel: "email", enabled: false },
      { eventGroup: "activity_on_your_records", channel: "email", enabled: true },
    ]);
    // The second write is still in the air, and the first reply's grid
    // predates the second press. The pane must not draw that snapshot
    // over the switch that already moved, not even for the round trip
    // the queued write takes.
    expect(screen.getByRole("switch", { name: "Activity on your records Email" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Assigned to you Email" })).not.toBeChecked();

    releases[1]!();
    // Once the last reply lands, its grid is the state. The last reply
    // is the last press.
    expect(await screen.findByText("Saved")).toBeVisible();
    expect(screen.getByRole("switch", { name: "Activity on your records Email" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Assigned to you Email" })).not.toBeChecked();
  });

  it("snaps the switch back when the save is refused", async () => {
    const user = userEvent.setup();
    const writes: unknown[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: capturePreferenceWrites(writes, problem(500, "The change could not be saved.")),
    });
    renderAt("/settings/notifications");

    const email = await screen.findByRole("switch", { name: "Assigned to you Email" });
    await user.click(email);

    expect(await screen.findByText("The change could not be saved.")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Assigned to you Email" })).toBeChecked(),
    );
  });
});
