// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The portal bell and the portal notification settings (#383, M20/9,
 * NOT-001, NOT-005) at the route seam.
 *
 * **The two bells are the whole point of this suite.** NOT-001 has one
 * notification system on two surfaces, and what a person can observe is
 * that the portal's chrome carries a bell of its own, that it asks the
 * portal's own four routes and never the staff ones, and that its items
 * narrate group 5 and land on the Request they are about.
 *
 * **The scope itself is the API's.** That a staff read-all cannot touch
 * a requester's group-5 rows is asserted where it is enforced — over the
 * real database, in `requester-events.test.ts`. What is asserted here is
 * that this surface adds nothing of its own: it draws what it is
 * answered and it addresses the mount that belongs to it.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const REQUESTER = {
  id: "u9",
  email: "priya.raman@acme.com",
  displayName: "Priya Raman",
  role: "business_user",
};

interface Item {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

function item(index: number, over: Partial<Item> = {}): Item {
  return {
    id: `n${index}`,
    eventType: "request.replied",
    entityType: "request",
    entityId: `r${index}`,
    payload: {
      requestNumber: 40 + index,
      requestSummary: `Review the Northwind redline ${index}`,
      actorName: "Rita Okonjo",
    },
    readAt: null,
    createdAt: new Date(Date.UTC(2026, 7, 21, 12, 0, index)).toISOString(),
    ...over,
  };
}

/**
 * What the portal bell's suite wires: a badge, a page, and a record of
 * every call the surface made.
 *
 * Every call is recorded, not only the writes — the claim that the
 * portal bell never touches the staff mount can only be made against the
 * whole traffic.
 */
function portalBellApi(state: {
  unread: number;
  items?: Item[];
  nextCursor?: string | null;
  afterRead?: number;
}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  stubApi({
    signedIn: REQUESTER,
    extra: (call: StubCall) => {
      // Where an opened item lands. The Request behind it is not this
      // suite's, so its page is answered nothing and left to say so.
      if (call.url.pathname.startsWith("/api/v1/portal/requests/")) {
        return problem(404, "Not found.");
      }
      if (!call.url.pathname.includes("notification")) return undefined;
      calls.push({ method: call.method, path: call.url.pathname, body: call.body });
      if (call.url.pathname === "/api/v1/portal/notifications/unread-count") {
        return json(200, { unread: state.unread });
      }
      if (call.url.pathname === "/api/v1/portal/notifications" && call.method === "GET") {
        return json(200, {
          notifications: state.items ?? [],
          nextCursor: state.nextCursor ?? null,
        });
      }
      // The count follows the writes, as a server's would, so the
      // count re-read a navigation makes agrees with the write before it.
      if (call.url.pathname === "/api/v1/portal/notifications/read" && call.method === "POST") {
        state.unread = state.afterRead ?? 0;
        return json(200, { unread: state.unread });
      }
      if (call.url.pathname === "/api/v1/portal/notifications/read-all" && call.method === "POST") {
        state.unread = 0;
        return json(200, { unread: 0 });
      }
      return undefined;
    },
  });
  return calls;
}

const bell = (name: string) => screen.findByRole("button", { name: `Notifications, ${name}` });

describe("the portal bell (NOT-001, NOT-005)", () => {
  it("shows the unread count and caps the drawing at 9+", async () => {
    portalBellApi({ unread: 12 });
    renderAt("/portal");

    // The cap is the badge's, not the number's: the nudge is capped and
    // the screen reader is told the truth (NOT-005).
    expect(await bell("12 unread")).toHaveTextContent("9+");
  });

  it("draws no badge at all when nothing is unread", async () => {
    portalBellApi({ unread: 0 });
    renderAt("/portal");

    expect(await bell("none unread")).toHaveTextContent("");
  });

  it("opens without writing, and marks an item read when it is opened", async () => {
    const user = userEvent.setup();
    const calls = portalBellApi({ unread: 2, items: [item(1), item(2)], afterRead: 1 });
    renderAt("/portal");

    await user.click(await bell("2 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    expect(within(centre).getAllByRole("listitem")).toHaveLength(2);

    // Drawing the panel is not reading it (the NOT-005 2026-09-09
    // amendment): no write, and the badge is where it was.
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    expect(await bell("2 unread")).toBeVisible();

    await user.click(within(centre).getByRole("link", { name: /Unread .*Northwind redline 1/ }));

    // One write, carrying exactly the id opened — and addressed to the
    // portal's own mount. The badge takes the server's answer.
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      { method: "POST", path: "/api/v1/portal/notifications/read", body: { ids: ["n1"] } },
    ]);
    expect(await bell("1 unread")).toBeVisible();
  });

  it("asks the portal mount and never the staff notification centre", async () => {
    const user = userEvent.setup();
    const calls = portalBellApi({ unread: 1, items: [item(1)] });
    renderAt("/portal");

    await user.click(await bell("1 unread"));
    await screen.findByRole("dialog", { name: "Notifications" });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.path.startsWith("/api/v1/portal/notifications")).toBe(true);
    }
  });

  it("narrates a group-5 item and links it to the Request's portal detail", async () => {
    const user = userEvent.setup();
    portalBellApi({ unread: 1, items: [item(1)] });
    renderAt("/portal");

    await user.click(await bell("1 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });

    const link = within(centre).getByRole("link", {
      name: /Rita Okonjo replied on your request Review the Northwind redline 1/,
    });
    // A Request has one page and no sections to name, so the item lands
    // on the detail itself.
    expect(link).toHaveAttribute("href", "/portal/requests/41");
  });

  it("names the new status of a Request in the requester's words", async () => {
    const user = userEvent.setup();
    portalBellApi({
      unread: 2,
      items: [
        item(1, {
          eventType: "request.status_changed",
          payload: {
            requestNumber: 41,
            requestSummary: "Review the Northwind redline 1",
            from: "new",
            to: "converted",
          },
        }),
        item(2, {
          eventType: "request.status_changed",
          payload: {
            requestNumber: 42,
            requestSummary: "Review the Northwind redline 2",
            from: "new",
            to: "declined",
          },
        }),
      ],
    });
    renderAt("/portal");

    await user.click(await bell("2 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });

    // `converted` is Legal's word; "In progress" is the requester's
    // (INT-003 M20/10).
    expect(
      within(centre).getByRole("link", {
        name: /Your request Review the Northwind redline 1 is now In progress/,
      }),
    ).toHaveAttribute("href", "/portal/requests/41");
    expect(
      within(centre).getByRole("link", {
        name: /Your request Review the Northwind redline 2 is now Declined/,
      }),
    ).toBeVisible();
  });

  it("still reads a status-change row whose payload names no status", async () => {
    const user = userEvent.setup();
    portalBellApi({
      unread: 2,
      items: [
        // A row written before `to` was snapshotted, and one whose
        // status this build has no word for.
        item(1, {
          eventType: "request.status_changed",
          payload: { requestNumber: 41, requestSummary: "Review the Northwind redline 1" },
        }),
        item(2, {
          eventType: "request.status_changed",
          payload: {
            requestNumber: 42,
            requestSummary: "Review the Northwind redline 2",
            to: "parked",
          },
        }),
      ],
    });
    renderAt("/portal");

    await user.click(await bell("2 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });

    expect(
      within(centre).getByRole("link", {
        name: /The status of your request Review the Northwind redline 1 changed/,
      }),
    ).toBeVisible();
    expect(
      within(centre).getByRole("link", {
        name: /The status of your request Review the Northwind redline 2 changed/,
      }),
    ).toBeVisible();
  });

  it("says what an empty portal bell is about", async () => {
    const user = userEvent.setup();
    portalBellApi({ unread: 0 });
    renderAt("/portal");

    await user.click(await bell("none unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    expect(
      within(centre).getByText("Nothing to catch up on. News about your requests shows up here."),
    ).toBeVisible();
  });

  it("zeroes the badge on mark-all-read", async () => {
    const user = userEvent.setup();
    const calls = portalBellApi({ unread: 3, items: [item(1)] });
    renderAt("/portal");

    await user.click(await bell("3 unread"));
    await screen.findByRole("dialog", { name: "Notifications" });
    await user.click(await screen.findByRole("button", { name: "Mark all read" }));

    expect(await bell("none unread")).toBeVisible();
    // The sweep is the only write the surface made.
    expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual([
      "/api/v1/portal/notifications/read-all",
    ]);
  });
});

/** The grid the API answers, with the model's defaults. Every group,
 * because the model is the model — the pane draws one of them. */
const DEFAULTS = [
  { eventGroup: "assigned_to_you", inApp: true, email: true },
  { eventGroup: "activity_on_your_records", inApp: true, email: false },
  { eventGroup: "dates_approaching", inApp: true, email: true },
  { eventGroup: "new_requests", inApp: true, email: false },
  { eventGroup: "knowledge", inApp: true, email: true },
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

describe("the portal notification settings (NOT-001)", () => {
  it("is reached from the gear in the portal chrome", async () => {
    portalBellApi({ unread: 0 });
    renderAt("/portal");

    expect(await screen.findByRole("link", { name: "Notification settings" })).toHaveAttribute(
      "href",
      "/portal/settings",
    );
  });

  it("draws group 5 alone, with its defaults as switch state", async () => {
    stubApi({ signedIn: REQUESTER, extra: capturePreferenceWrites([]) });
    renderAt("/portal/settings");

    expect(
      await screen.findByRole("heading", { name: "How we tell you about your requests" }),
    ).toBeVisible();
    expect(screen.getByText("Request updates")).toBeVisible();

    // Group 5 is the one group whose email is on by default: a requester
    // does not live in the app (INT-003).
    expect(screen.getByRole("switch", { name: "Request updates In-app" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Request updates Email" })).toBeChecked();
    // And exactly two switches, because the other four groups are about
    // records a Business User cannot open.
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });

  it("draws none of the staff groups", async () => {
    stubApi({ signedIn: REQUESTER, extra: capturePreferenceWrites([]) });
    renderAt("/portal/settings");

    await screen.findByRole("heading", { name: "How we tell you about your requests" });
    for (const label of [
      "Assigned to you",
      "Activity on your records",
      "Dates approaching",
      "New requests",
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("saves a flip immediately, as one pair on one group", async () => {
    const user = userEvent.setup();
    const writes: unknown[] = [];
    stubApi({ signedIn: REQUESTER, extra: capturePreferenceWrites(writes) });
    renderAt("/portal/settings");

    await user.click(await screen.findByRole("switch", { name: "Request updates Email" }));

    await waitFor(() =>
      expect(writes).toEqual([
        { eventGroup: "requester_events", channel: "email", enabled: false },
      ]),
    );
    expect(await screen.findByText("Saved")).toBeVisible();
    expect(screen.getByRole("switch", { name: "Request updates Email" })).not.toBeChecked();
    // The bell for the same group is untouched — opting out of the mail
    // is not opting out of the portal.
    expect(screen.getByRole("switch", { name: "Request updates In-app" })).toBeChecked();
  });

  it("sends the flip back the other way when the switch is returned", async () => {
    const user = userEvent.setup();
    const writes: unknown[] = [];
    stubApi({ signedIn: REQUESTER, extra: capturePreferenceWrites(writes) });
    renderAt("/portal/settings");

    const email = await screen.findByRole("switch", { name: "Request updates Email" });
    await user.click(email);
    await waitFor(() => expect(writes).toHaveLength(1));
    await user.click(screen.getByRole("switch", { name: "Request updates Email" }));

    // The pane sends the value; whether that value removes the override
    // or writes one is the API's business (M20/9).
    await waitFor(() =>
      expect(writes).toEqual([
        { eventGroup: "requester_events", channel: "email", enabled: false },
        { eventGroup: "requester_events", channel: "email", enabled: true },
      ]),
    );
    expect(screen.getByRole("switch", { name: "Request updates Email" })).toBeChecked();
  });

  it("snaps the switch back when the save is refused", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: REQUESTER,
      extra: capturePreferenceWrites([], problem(500, "The change could not be saved.")),
    });
    renderAt("/portal/settings");

    await user.click(await screen.findByRole("switch", { name: "Request updates In-app" }));

    expect(await screen.findByText("The change could not be saved.")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Request updates In-app" })).toBeChecked(),
    );
  });

  it("sends a signed-out visitor to the portal entry screen", async () => {
    stubApi({ signedIn: null });
    const { router } = renderAt("/portal/settings");

    await waitFor(() => expect(router.state.location.pathname).toBe("/portal/enter"));
  });
});
