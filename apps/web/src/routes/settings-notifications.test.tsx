// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Personal · Notifications (#320) at the route seam: the rail carries
 * the entry M5 omitted, the pane draws one row per staff event group
 * with the defaults rendered as switch state, and a flip saves
 * immediately (SET-003).
 *
 * Nothing here asserts how the fan-out is wired — that is
 * `preferences.test.ts`'s, over the real engine. What this suite pins is
 * what a person sees and what the pane sends.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  { eventGroup: "requester_events", inApp: true, email: true },
];

/** Answers the pane's read and captures its writes, the way the real
 * endpoint does — every save answers the whole grid back. */
function capturePreferenceWrites(writes: unknown[], failWith?: Response) {
  let groups = DEFAULTS.map((row) => ({ ...row }));
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
    }
    return json(200, { groups });
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

    // The four staff groups. Group 2 is one row and not the frame's four
    // sub-rows: NOT-002 keys a preference on the group (DES-050).
    for (const label of [
      "Assigned to you",
      "Activity on your records",
      "Dates approaching",
      "New requests",
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
    expect(screen.getByRole("switch", { name: "Dates approaching Email" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "New requests Email" })).not.toBeChecked();
  });

  it("does not draw the portal audience's own group", async () => {
    stubApi({ signedIn: MEMBER, extra: capturePreferenceWrites([]) });
    renderAt("/settings/notifications");

    await screen.findByRole("heading", { name: "Notification preferences" });
    // Group 5 stays in the model and in the API's answer; a business
    // user tunes it in the portal, so it means nothing on a staff pane.
    expect(screen.queryByText(/requester/i)).not.toBeInTheDocument();
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
    // The bell for the same group is untouched — opting out of
    // interruption is not opting out of information.
    expect(screen.getByRole("switch", { name: "Assigned to you In-app" })).toBeChecked();
  });

  it("sends two quick flips in order, so the slower reply cannot undo the faster press", async () => {
    const user = userEvent.setup();
    const writes: unknown[] = [];
    let groups = DEFAULTS.map((row) => ({ ...row }));
    let release: (() => void) | null = null;
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname !== "/api/v1/me/notification-preferences") return undefined;
        if (call.method !== "PATCH") return json(200, { groups });
        const body = call.body as { eventGroup: string; channel: string; enabled: boolean };
        writes.push(body);
        groups = groups.map((row) =>
          row.eventGroup === body.eventGroup
            ? { ...row, [body.channel === "in_app" ? "inApp" : "email"]: body.enabled }
            : row,
        );
        // The first write is held open; the second must not overtake it.
        if (release === null) {
          const answer = json(200, { groups });
          return new Promise<Response>((resolve) => {
            release = () => resolve(answer);
          });
        }
        return json(200, { groups });
      },
    });
    renderAt("/settings/notifications");

    await user.click(await screen.findByRole("switch", { name: "Assigned to you Email" }));
    await user.click(screen.getByRole("switch", { name: "Dates approaching Email" }));

    // Both switches have already moved, and only the first write is out.
    expect(screen.getByRole("switch", { name: "Assigned to you Email" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Dates approaching Email" })).not.toBeChecked();
    expect(writes).toHaveLength(1);

    release!();
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes).toEqual([
      { eventGroup: "assigned_to_you", channel: "email", enabled: false },
      { eventGroup: "dates_approaching", channel: "email", enabled: false },
    ]);
    // And the grid the first reply carried has not put the second flip
    // back: the last reply is the last press.
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Dates approaching Email" })).not.toBeChecked(),
    );
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

    const email = await screen.findByRole("switch", { name: "Dates approaching Email" });
    await user.click(email);

    expect(await screen.findByText("The change could not be saved.")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Dates approaching Email" })).toBeChecked(),
    );
  });
});
