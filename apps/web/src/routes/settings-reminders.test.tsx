// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Notifications (#322) at the route seam: the rail gains
 * its section, the pane draws the NOT-004 lead times in the DES-052
 * value-list anatomy, and adding, removing, and rearranging each save
 * the moment they are made (SET-003).
 *
 * Nothing here asserts what the round then fires on. That belongs to
 * `reminder-offsets.test.ts`, over the real handler. What this suite
 * pins is what an Administrator sees and what the pane sends.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "blair@example.com",
  displayName: "Blair Wentworth",
  role: "administrator",
};

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
};

/** NOT-004's seeded list, as a fresh install answers it. */
const SEEDED = [7, 1, 0];

/**
 * Answers the pane's read and captures its writes, the way the real
 * endpoint does. Every save sends the whole list and gets the stored
 * one back.
 */
function captureOffsetWrites(writes: number[][], failWith?: Response) {
  let offsets = [...SEEDED];
  return (call: StubCall) => {
    if (call.url.pathname !== "/api/v1/org/reminder-offsets") return undefined;
    if (call.method === "PUT") {
      const body = call.body as { offsets: number[] };
      writes.push(body.offsets);
      if (failWith) return failWith;
      offsets = [...new Set(body.offsets)];
    }
    return json(200, { offsets });
  };
}

const leadTimeList = () => screen.getByRole("list");

/** The lead times the pane is drawing, in the order it draws them. */
const drawnRows = (): string[] =>
  within(leadTimeList())
    .getAllByRole("listitem")
    .map((row) => row.textContent ?? "");

describe("Organization · Notifications (#322)", () => {
  it("carries the rail entry, distinct from the Personal one", async () => {
    stubApi({ signedIn: ADMIN, extra: captureOffsetWrites([]) });
    renderAt("/settings/reminders");

    const rail = await screen.findByRole("navigation", { name: "Settings sections" });
    // Two sections are called Notifications. The group each one sits in
    // is what tells them apart, for a reader as well as on screen.
    const organization = within(rail).getByRole("group", { name: "Organization" });
    expect(within(organization).getByRole("link", { name: "Notifications" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const personal = within(rail).getByRole("group", { name: "Personal" });
    expect(within(personal).getByRole("link", { name: "Notifications" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("draws the seeded list in the saved order, day-of in words", async () => {
    stubApi({ signedIn: ADMIN, extra: captureOffsetWrites([]) });
    renderAt("/settings/reminders");

    expect(await screen.findByRole("heading", { name: "Reminder lead times" })).toBeVisible();
    expect(screen.getByText("3 lead times")).toBeVisible();
    // Nobody says "0 days before".
    expect(drawnRows()).toEqual(["7 days before", "1 day before", "On the day"]);
  });

  it("keeps a Member out of the section entirely (SET-002)", async () => {
    stubApi({ signedIn: MEMBER, extra: captureOffsetWrites([]) });
    renderAt("/settings/reminders");

    // The loader bounces them to their own first pane, and the rail
    // never drew the Organization group for them at all.
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeVisible();
    const rail = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(rail).queryByRole("group", { name: "Organization" })).not.toBeInTheDocument();
    expect(screen.queryByText("Reminder lead times")).not.toBeInTheDocument();
  });

  it("adds a lead time and saves it immediately", async () => {
    const user = userEvent.setup();
    const writes: number[][] = [];
    stubApi({ signedIn: ADMIN, extra: captureOffsetWrites(writes) });
    renderAt("/settings/reminders");

    await user.click(await screen.findByRole("button", { name: "Add lead time" }));
    await user.type(screen.getByLabelText("days before the date"), "30");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(writes).toEqual([[7, 1, 0, 30]]));
    expect(await screen.findByText("Saved")).toBeVisible();
    expect(drawnRows()).toEqual(["7 days before", "1 day before", "On the day", "30 days before"]);
  });

  it("refuses a lead time already on the list without sending anything", async () => {
    const user = userEvent.setup();
    const writes: number[][] = [];
    stubApi({ signedIn: ADMIN, extra: captureOffsetWrites(writes) });
    renderAt("/settings/reminders");

    await user.click(await screen.findByRole("button", { name: "Add lead time" }));
    await user.type(screen.getByLabelText("days before the date"), "7");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("7 days before is already on the list.")).toBeVisible();
    expect(writes).toEqual([]);
  });

  it("refuses a lead time past the bound without sending anything", async () => {
    const user = userEvent.setup();
    const writes: number[][] = [];
    stubApi({ signedIn: ADMIN, extra: captureOffsetWrites(writes) });
    renderAt("/settings/reminders");

    await user.click(await screen.findByRole("button", { name: "Add lead time" }));
    await user.type(screen.getByLabelText("days before the date"), "731");
    await user.keyboard("{Enter}");

    // Two years is the round's own bound: a number past it would be
    // dropped on the next read, so the draft row says so instead.
    expect(
      await screen.findByText("Enter a whole number of days between 0 and 730."),
    ).toBeVisible();
    expect(writes).toEqual([]);
  });

  it("removes a lead time and saves it immediately", async () => {
    const user = userEvent.setup();
    const writes: number[][] = [];
    stubApi({ signedIn: ADMIN, extra: captureOffsetWrites(writes) });
    renderAt("/settings/reminders");

    await user.click(await screen.findByRole("button", { name: "Remove 1 day before" }));

    await waitFor(() => expect(writes).toEqual([[7, 0]]));
    expect(drawnRows()).toEqual(["7 days before", "On the day"]);
  });

  it("locks the last lead time instead of offering to remove it", async () => {
    const user = userEvent.setup();
    const writes: number[][] = [];
    stubApi({ signedIn: ADMIN, extra: captureOffsetWrites(writes) });
    renderAt("/settings/reminders");

    await user.click(await screen.findByRole("button", { name: "Remove 1 day before" }));
    await waitFor(() => expect(drawnRows()).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Remove On the day" }));
    await waitFor(() => expect(drawnRows()).toEqual(["7 days before"]));

    // No lead times means no reminders, and that is not something a
    // settings row is allowed to decide by accident.
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "7 days before is the only lead time and can't be removed",
      }),
    ).toBeVisible();
  });

  it("reorders from the keyboard, one position per arrow press", async () => {
    const user = userEvent.setup();
    const writes: number[][] = [];
    stubApi({ signedIn: ADMIN, extra: captureOffsetWrites(writes) });
    renderAt("/settings/reminders");

    const grip = await screen.findByRole("button", {
      name: /^Reorder 7 days before, position 1 of 3/,
    });
    grip.focus();
    await user.keyboard("{ArrowDown}");

    await waitFor(() => expect(writes).toEqual([[1, 7, 0]]));
    expect(drawnRows()).toEqual(["1 day before", "7 days before", "On the day"]);
    // The move is announced, because the order itself is silent to a
    // reader (WCAG 4.1.3).
    expect(await screen.findByText("7 days before moved to position 2 of 3.")).toBeInTheDocument();
  });

  it("will not move the first row above itself", async () => {
    const user = userEvent.setup();
    const writes: number[][] = [];
    stubApi({ signedIn: ADMIN, extra: captureOffsetWrites(writes) });
    renderAt("/settings/reminders");

    const grip = await screen.findByRole("button", {
      name: /^Reorder 7 days before, position 1 of 3/,
    });
    grip.focus();
    await user.keyboard("{ArrowUp}");

    expect(writes).toEqual([]);
    expect(drawnRows()).toEqual(["7 days before", "1 day before", "On the day"]);
  });

  it("puts the list back when a save is refused", async () => {
    const user = userEvent.setup();
    const writes: number[][] = [];
    stubApi({
      signedIn: ADMIN,
      extra: captureOffsetWrites(writes, problem(500, "The change could not be saved.")),
    });
    renderAt("/settings/reminders");

    await user.click(await screen.findByRole("button", { name: "Remove 1 day before" }));

    expect(await screen.findByText("The change could not be saved.")).toBeVisible();
    await waitFor(() =>
      expect(drawnRows()).toEqual(["7 days before", "1 day before", "On the day"]),
    );
  });

  it("sends one write at a time, so a slower reply cannot undo a faster press", async () => {
    const user = userEvent.setup();
    const writes: number[][] = [];
    let offsets = [...SEEDED];
    const releases: (() => void)[] = [];
    stubApi({
      signedIn: ADMIN,
      extra: (call: StubCall) => {
        if (call.url.pathname !== "/api/v1/org/reminder-offsets") return undefined;
        if (call.method !== "PUT") return json(200, { offsets });
        const body = call.body as { offsets: number[] };
        writes.push(body.offsets);
        offsets = [...body.offsets];
        const answer = json(200, { offsets });
        return new Promise<Response>((resolve) => {
          releases.push(() => {
            resolve(answer);
          });
        });
      },
    });
    renderAt("/settings/reminders");

    await user.click(await screen.findByRole("button", { name: "Remove 1 day before" }));
    // The list moved at once and the write is out. Every trailing action
    // stands down until it lands, so the second press cannot be made.
    // Two whole-list writes racing would let the slower reply land last.
    expect(drawnRows()).toEqual(["7 days before", "On the day"]);
    expect(screen.getByRole("button", { name: "Remove 7 days before" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add lead time" })).toBeDisabled();
    expect(writes).toHaveLength(1);

    releases[0]!();
    expect(await screen.findByText("Saved")).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove 7 days before" })).toBeEnabled();
  });
});
