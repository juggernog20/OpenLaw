// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The bell and the notification centre (#317, NOT-001, NOT-005,
 * DES-049).
 *
 * **The badge is the server's number.** It shows what the count read
 * answers, caps its *drawing* at "9+", and says the whole number in the
 * trigger's accessible name — the cap is a nudge, not a fact hidden
 * from a screen reader.
 *
 * **Reading is the only ceremony.** Opening the centre marks the page
 * it drew read and takes the badge from the write's own answer; "Show
 * older" does the same for the page it brings; mark-all-read zeroes the
 * rest. There is no per-item control anywhere, because a per-item
 * ceremony is exactly what NOT-005 declined.
 *
 * **The wall is not this surface's.** A record walled off after an item
 * was written is silently absent from the list and the count alike
 * (DD-014, M10, and the M18/1 suite at the HTTP seam). What is asserted
 * here is that the surface adds nothing of its own: it draws what it is
 * answered, counts nothing itself, and shows no gap where the API left
 * a row out.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BellItem } from "../lib/notifications";
import {
  json,
  problem,
  renderAt,
  stubApi,
  stubEventSource,
  type StubCall,
} from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "casey@example.com",
  displayName: "Casey Counsel",
  role: "legal_team_member",
};

/** One approval-request item, the only event M18/1 fires. */
function item(index: number, over: Partial<BellItem> = {}): BellItem {
  return {
    id: `n${index}`,
    eventType: "approval.requested",
    entityType: "contract",
    entityId: `c${index}`,
    payload: {
      contractNumber: 40 + index,
      contractTitle: `Acme MSA ${index}`,
      actorName: "Nadia Counsel",
    },
    readAt: null,
    // Fixed and descending, so the rows are stable and the timestamps
    // read as a feed does.
    createdAt: new Date(Date.UTC(2026, 7, 18, 12, 0, index)).toISOString(),
    ...over,
  };
}

/** What the bell's suite wires: a badge, one or two pages, and a record
 * of every write the surface made. */
function bellApi(state: {
  unread: number;
  surface?: "staff" | "portal";
  pages?: Record<string, { notifications: BellItem[]; nextCursor: string | null }>;
  /** What the mark-read write answers. Defaults to zero. */
  afterRead?: number;
  /** Fails the named page read, so the two failure states can be seen. */
  failCursor?: string | null;
  /** Fails both writes, so what a refused write does to the badge can
   * be seen. */
  failWrites?: boolean;
}) {
  const writes: { path: string; body: unknown }[] = [];
  const pages = state.pages ?? {
    first: { notifications: [], nextCursor: null },
  };
  const root =
    state.surface === "portal" ? "/api/v1/portal/notifications" : "/api/v1/notifications";
  stubApi({
    signedIn: MEMBER,
    extra: (call: StubCall) => {
      if (call.url.pathname === `${root}/unread-count`) {
        return json(200, { unread: state.unread });
      }
      if (call.url.pathname === root && call.method === "GET") {
        const key = call.url.searchParams.get("cursor") ?? "first";
        if (state.failCursor !== undefined && state.failCursor === (key === "first" ? null : key)) {
          return problem(500, "Nope.");
        }
        return json(200, pages[key] ?? { notifications: [], nextCursor: null });
      }
      if (call.url.pathname === `${root}/read` && call.method === "POST") {
        writes.push({ path: "read", body: call.body });
        return state.failWrites
          ? problem(500, "Nope.")
          : json(200, { unread: state.afterRead ?? 0 });
      }
      if (call.url.pathname === `${root}/read-all` && call.method === "POST") {
        writes.push({ path: "read-all", body: call.body });
        return state.failWrites ? problem(500, "Nope.") : json(200, { unread: 0 });
      }
      return undefined;
    },
  });
  return writes;
}

/**
 * The trigger, once the badge has settled on the count it was given.
 *
 * The name is the whole assertion: the trigger renders before the count
 * read answers, so waiting for it by name is what makes "the badge shows
 * the count" a wait rather than a race.
 */
const bell = (name: string) => screen.findByRole("button", { name: `Notifications, ${name}` });

describe("the bell badge (NOT-005)", () => {
  it("shows the unread count and says it in the trigger's name", async () => {
    bellApi({ unread: 3 });
    renderAt("/");

    const trigger = await bell("3 unread");
    expect(trigger).toHaveTextContent("3");
  });

  it("caps the drawn badge at 9+ and keeps the whole number in the name", async () => {
    bellApi({ unread: 42 });
    renderAt("/");

    // The cap is the badge's, not the number's: the nudge is capped and
    // the screen reader is told the truth.
    expect(await bell("42 unread")).toHaveTextContent("9+");
  });

  it("draws no badge at all when nothing is unread", async () => {
    bellApi({ unread: 0 });
    renderAt("/");

    expect(await bell("none unread")).toHaveTextContent("");
  });
});

describe("the live bell (M30/2)", () => {
  it("shares the shell's one connection and takes a bell refresh from the count route", async () => {
    const sources = stubEventSource();
    let unread = 2;
    let countReads = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/notifications/unread-count") {
          countReads += 1;
          return json(200, { unread });
        }
        return undefined;
      },
    });
    renderAt("/");

    expect(await bell("2 unread")).toBeVisible();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toBe("/api/events");

    unread = 7;
    sources[0]!.emit({ kind: "bell", userId: MEMBER.id });
    expect(await bell("7 unread")).toBeVisible();
    expect(countReads).toBe(2);
  });

  it("re-asks the count when the browser reconnects", async () => {
    const sources = stubEventSource();
    let unread = 0;
    bellApi({ unread });
    renderAt("/");
    expect(await bell("none unread")).toBeVisible();

    unread = 4;
    // Re-stub the count with the changed server answer. `open` is the
    // browser's signal for both the first connection and a reconnect.
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/notifications/unread-count"
          ? json(200, { unread })
          : undefined,
    });
    sources[0]!.open();
    expect(await bell("4 unread")).toBeVisible();
  });

  it("refreshes an open centre when a bell frame arrives", async () => {
    const user = userEvent.setup();
    const sources = stubEventSource();
    let notifications: BellItem[] = [];
    let unread = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/notifications/unread-count") {
          return json(200, { unread });
        }
        if (call.url.pathname === "/api/v1/notifications" && call.method === "GET") {
          return json(200, { notifications, nextCursor: null });
        }
        if (call.url.pathname === "/api/v1/notifications/read" && call.method === "POST") {
          unread = 0;
          return json(200, { unread });
        }
        return undefined;
      },
    });
    renderAt("/");
    await user.click(await bell("none unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    expect(within(centre).queryAllByRole("listitem")).toHaveLength(0);

    notifications = [item(1)];
    unread = 1;
    sources[0]!.emit({ kind: "bell", userId: MEMBER.id });
    expect(await within(centre).findAllByRole("listitem")).toHaveLength(1);
  });

  it("does not refresh or mark rows read after the centre closes", async () => {
    const user = userEvent.setup();
    const sources = stubEventSource();
    let countReads = 0;
    let listReads = 0;
    let resolveLiveCount!: (response: Response) => void;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/notifications/unread-count") {
          countReads += 1;
          if (countReads === 2) {
            return new Promise<Response>((resolve) => {
              resolveLiveCount = resolve;
            });
          }
          return json(200, { unread: 0 });
        }
        if (call.url.pathname === "/api/v1/notifications" && call.method === "GET") {
          listReads += 1;
          return json(200, { notifications: [], nextCursor: null });
        }
        return undefined;
      },
    });
    renderAt("/");
    await user.click(await bell("none unread"));
    expect(await screen.findByRole("dialog", { name: "Notifications" })).toBeVisible();
    expect(listReads).toBe(1);

    sources[0]!.emit({ kind: "bell", userId: MEMBER.id });
    await waitFor(() => expect(countReads).toBe(2));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();

    resolveLiveCount(json(200, { unread: 3 }));
    expect(await bell("3 unread")).toBeVisible();
    expect(listReads).toBe(1);
  });

  it("uses the same live read model against the portal routes", async () => {
    const sources = stubEventSource();
    let unread = 1;
    bellApi({ unread, surface: "portal" });
    renderAt("/portal");

    expect(await bell("1 unread")).toBeVisible();
    expect(sources).toHaveLength(1);
    unread = 6;
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/portal/notifications/unread-count"
          ? json(200, { unread })
          : undefined,
    });
    sources[0]!.emit({ kind: "bell", userId: MEMBER.id });
    expect(await bell("6 unread")).toBeVisible();
  });
});

describe("the notification centre", () => {
  it("marks the page it drew read and takes the badge from the answer", async () => {
    const user = userEvent.setup();
    const writes = bellApi({
      unread: 2,
      pages: { first: { notifications: [item(1), item(2)], nextCursor: null } },
      afterRead: 0,
    });
    renderAt("/");

    const trigger = await bell("2 unread");
    expect(trigger).toHaveTextContent("2");
    await user.click(trigger);

    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    expect(within(centre).getAllByRole("listitem")).toHaveLength(2);

    // One write, carrying exactly the ids just drawn.
    expect(writes).toEqual([{ path: "read", body: { ids: ["n1", "n2"] } }]);
    // The badge follows the write's own answer rather than its own
    // arithmetic.
    expect(await screen.findByRole("button", { name: "Notifications, none unread" })).toBeVisible();
  });

  it("sends no write when the page it drew was already read", async () => {
    const user = userEvent.setup();
    const writes = bellApi({
      unread: 0,
      pages: {
        first: {
          notifications: [item(1, { readAt: "2026-08-18T12:30:00.000Z" })],
          nextCursor: null,
        },
      },
    });
    renderAt("/");

    await user.click(await bell("none unread"));
    await screen.findByRole("dialog", { name: "Notifications" });
    expect(writes).toEqual([]);
  });

  it("narrates each item and deep-links it to its record's section", async () => {
    const user = userEvent.setup();
    bellApi({
      unread: 1,
      pages: { first: { notifications: [item(1)], nextCursor: null } },
    });
    renderAt("/");

    await user.click(await bell("1 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });

    // An approval request opens the Approvals section, not the record's
    // overview: the prompt names a thing to do, and the section is its
    // address (DES-032).
    const link = within(centre).getByRole("link", {
      name: /Nadia Counsel asked you to approve Acme MSA 1/,
    });
    expect(link).toHaveAttribute("href", "/contracts/41/approvals");
  });

  it("opens Home from the daily briefing summary", async () => {
    const user = userEvent.setup();
    bellApi({
      unread: 1,
      pages: {
        first: {
          notifications: [
            item(1, {
              eventType: "briefing.ready",
              entityType: "knowledge_item",
              entityId: MEMBER.id,
              payload: { localDate: "2026-08-18" },
            }),
          ],
          nextCursor: null,
        },
      },
    });
    renderAt("/");

    await user.click(await bell("1 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    expect(
      within(centre).getByRole("link", { name: /^Your daily briefing is ready/ }),
    ).toHaveAttribute("href", "/");
  });

  it("narrates an Entity obligation and opens its Obligations tab", async () => {
    const user = userEvent.setup();
    bellApi({
      unread: 1,
      pages: {
        first: {
          notifications: [
            item(1, {
              eventType: "date.obligation_approaching",
              entityType: "entity",
              entityId: "e1",
              payload: {
                entityLegalName: "Aldgate UK Ltd",
                obligationId: "o1",
                label: "Annual return",
                reminderDate: "2026-09-30",
                offsetDays: 7,
              },
            }),
          ],
          nextCursor: null,
        },
      },
    });
    renderAt("/");

    await user.click(await bell("1 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    const link = within(centre).getByRole("link", {
      name: /Annual return on Aldgate UK Ltd is coming up/,
    });
    expect(link).toHaveAttribute("href", "/entities/e1/obligations");
  });

  it("deep-links the Inbox's arrival to the staff request detail", async () => {
    // Group 4 is the one Request event on this bell (INT-006, M21/4),
    // and it addresses the staff detail rather than the portal one: the
    // reader is a triager, and the Request is work rather than news
    // about an ask of their own.
    const user = userEvent.setup();
    bellApi({
      unread: 1,
      pages: {
        first: {
          notifications: [
            item(1, {
              eventType: "request.submitted",
              entityType: "request",
              entityId: "r1",
              payload: {
                requestNumber: 42,
                requestSummary: "Review the Northwind supply redline",
                requestType: "Contract review",
                urgency: "critical",
                actorName: "Priya Raman",
              },
            }),
          ],
          nextCursor: null,
        },
      },
    });
    renderAt("/");

    await user.click(await bell("1 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    const link = within(centre).getByRole("link", {
      name: /Priya Raman submitted a new request: Review the Northwind supply redline/,
    });
    expect(link).toHaveAttribute("href", "/inbox/42");
  });

  it("deep-links a mention on a Request thread to the staff request detail", async () => {
    // One slug on two records (M21/5). A mention on a Request is a
    // mention of a triager — the Requester is never mention-notified —
    // so it addresses the staff detail, not the portal one, and the
    // sentence names the Request by the summary the requester wrote.
    const user = userEvent.setup();
    bellApi({
      unread: 1,
      pages: {
        first: {
          notifications: [
            item(1, {
              eventType: "comment.mentioned",
              entityType: "request",
              entityId: "r1",
              payload: {
                requestNumber: 42,
                requestSummary: "Review the Northwind supply redline",
                commentId: "cm1",
                actorName: "Omar Dib",
              },
            }),
          ],
          nextCursor: null,
        },
      },
    });
    renderAt("/");

    await user.click(await bell("1 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    const link = within(centre).getByRole("link", {
      name: /Omar Dib mentioned you on Review the Northwind supply redline/,
    });
    expect(link).toHaveAttribute("href", "/inbox/42");
  });

  it("draws the empty state and no paging foot when the bell is empty", async () => {
    const user = userEvent.setup();
    bellApi({ unread: 0 });
    renderAt("/");

    await user.click(await bell("none unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });

    expect(
      within(centre).getByText("Nothing to catch up on. News about your records shows up here."),
    ).toBeInTheDocument();
    expect(within(centre).queryByRole("button", { name: "Show older" })).not.toBeInTheDocument();
    expect(within(centre).queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();
  });

  it("pages with a 'Show older' foot, appending and then losing the control", async () => {
    const user = userEvent.setup();
    const writes = bellApi({
      unread: 2,
      pages: {
        first: { notifications: [item(1)], nextCursor: "n1" },
        n1: { notifications: [item(2)], nextCursor: null },
      },
    });
    renderAt("/");

    await user.click(await bell("2 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    expect(within(centre).getAllByRole("listitem")).toHaveLength(1);

    await user.click(within(centre).getByRole("button", { name: "Show older" }));
    expect(await within(centre).findAllByRole("listitem")).toHaveLength(2);
    // Absent, not disabled, once the list is complete (DES-026).
    expect(within(centre).queryByRole("button", { name: "Show older" })).not.toBeInTheDocument();

    // The page just brought is read too, and only its own ids go.
    expect(writes.map((write) => write.body)).toEqual([{ ids: ["n1"] }, { ids: ["n2"] }]);
    // DES-031 clause 4: focus lands on the first row of the page just
    // brought, so a keyboard reader is told the list grew.
    expect(within(centre).getAllByRole("link")[1]).toHaveFocus();
  });

  it("zeroes the badge on mark-all-read and drops the control with it", async () => {
    const user = userEvent.setup();
    const writes = bellApi({
      unread: 5,
      pages: { first: { notifications: [item(1)], nextCursor: null } },
      // The page's own write leaves four behind, which is what the
      // mark-all-read affordance is for (NOT-005).
      afterRead: 4,
    });
    renderAt("/");

    await user.click(await bell("5 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    await screen.findByRole("button", { name: "Notifications, 4 unread" });

    await user.click(within(centre).getByRole("button", { name: "Mark all read" }));
    expect(await screen.findByRole("button", { name: "Notifications, none unread" })).toBeVisible();
    expect(writes.at(-1)?.path).toBe("read-all");
    // Nothing left to clear, so the control goes.
    expect(within(centre).queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();
  });

  it("leaves the badge where it was when a write is refused", async () => {
    const user = userEvent.setup();
    // Both writes refused. The badge is the server's number, so a write
    // that did not land must not move it — and the surface must not
    // guess at what the count would have been.
    const writes = bellApi({
      unread: 3,
      pages: { first: { notifications: [item(1)], nextCursor: null } },
      failWrites: true,
    });
    renderAt("/");

    await user.click(await bell("3 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    expect(writes.map((write) => write.path)).toEqual(["read"]);
    expect(await bell("3 unread")).toBeVisible();

    await user.click(within(centre).getByRole("button", { name: "Mark all read" }));
    expect(writes.map((write) => write.path)).toEqual(["read", "read-all"]);
    expect(await bell("3 unread")).toBeVisible();
  });

  it("offers no per-item read control (NOT-005 declined one)", async () => {
    const user = userEvent.setup();
    bellApi({
      unread: 1,
      pages: { first: { notifications: [item(1)], nextCursor: null } },
    });
    renderAt("/");

    await user.click(await bell("1 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    const row = within(centre).getAllByRole("listitem")[0]!;
    // The row is one link and nothing else: no dismiss, no mark, no
    // overflow menu.
    expect(within(row).getAllByRole("link")).toHaveLength(1);
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
  });

  it("says a failed first page and keeps no stale list", async () => {
    const user = userEvent.setup();
    bellApi({ unread: 1, failCursor: null });
    renderAt("/");

    await user.click(await bell("1 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    expect(await within(centre).findByRole("alert")).toHaveTextContent(
      "Notifications could not be read. Close this and open it again.",
    );
    expect(within(centre).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("keeps the list and the control when an older page fails", async () => {
    const user = userEvent.setup();
    bellApi({
      unread: 1,
      pages: { first: { notifications: [item(1)], nextCursor: "n1" } },
      failCursor: "n1",
    });
    renderAt("/");

    await user.click(await bell("1 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    await user.click(within(centre).getByRole("button", { name: "Show older" }));

    expect(await within(centre).findByRole("alert")).toHaveTextContent(
      "The older notifications could not be read. Try again.",
    );
    // The retry is the control already under the reader's hand
    // (DES-026), and the page they had is still there.
    expect(within(centre).getByRole("button", { name: "Show older" })).toBeInTheDocument();
    expect(within(centre).getAllByRole("listitem")).toHaveLength(1);
  });

  it("opens and closes from the keyboard alone (DES-010, DES-011)", async () => {
    const user = userEvent.setup();
    bellApi({
      unread: 1,
      pages: { first: { notifications: [item(1)], nextCursor: null } },
    });
    renderAt("/");

    const trigger = await bell("1 unread");
    trigger.focus();
    await user.keyboard("{Enter}");
    const centre = await screen.findByRole("dialog", { name: "Notifications" });

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
    // Focus comes back to where it was, so the next Tab carries on from
    // the header rather than from the top of the document.
    expect(trigger).toHaveFocus();
    expect(centre).not.toBeInTheDocument();
  });

  it("draws only what the API answered — the wall leaves no gap", async () => {
    const user = userEvent.setup();
    // What the API answers after a record was walled off: one item, and
    // a count that agrees with it. The row it left out is not here to be
    // drawn, and the surface counts nothing of its own.
    bellApi({
      unread: 1,
      pages: { first: { notifications: [item(1)], nextCursor: null } },
      afterRead: 0,
    });
    renderAt("/");

    await user.click(await bell("1 unread"));
    const centre = await screen.findByRole("dialog", { name: "Notifications" });
    expect(within(centre).getAllByRole("listitem")).toHaveLength(1);
    // No total, no "1 of 2", and nothing that says something was left
    // out (M10).
    expect(within(centre).queryByText(/hidden|restricted|of 2/i)).not.toBeInTheDocument();
  });
});
