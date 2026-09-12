// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Inbox destination (#413), through the real route table with the
 * standard fetch stub: nav slot one for Member+, the undecided queue in
 * the shared columns and filters, the trail from a converted Request
 * to the record it became, the empty state, and the next page.
 *
 * A Contributor and a Business User never see the destination and never
 * reach the screen. The API's 403 is the real refusal, and the loader
 * is its client half.
 */

import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};
const BUSINESS = {
  id: "u9",
  email: "business@example.com",
  displayName: "Bao Business",
  role: "business_user",
};

/** One row of the queue, as the staff read answers it. */
function inboxRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "r1",
    number: 48,
    status: "new",
    title: "Injunction threat — Meridian dispute letter",
    urgency: "critical",
    requestType: {
      id: "rt-nda",
      displayName: "NDA request",
      targetModule: "contract",
      targetTypeName: "NDA",
    },
    requester: { id: "u7", displayName: "Dana Reyes" },
    createdAt: "2026-08-20T11:00:00.000Z",
    convertedContract: null,
    convertedRecord: null,
    ...overrides,
  };
}

/**
 * The queue behind the screen. `triaged` rows are answered only when
 * the filters ask for them, so the test can watch the re-read happen.
 */
function inboxApi(open: Record<string, unknown>[], triaged: Record<string, unknown>[] = []) {
  const asked: URL[] = [];
  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/requests" && call.method === "GET") {
      asked.push(call.url);
      const withTriaged = !call.url.searchParams
        .get("status")
        ?.split(",")
        .every((status) => status === "new");
      return json(200, {
        requests: [...open, ...(withTriaged ? triaged : [])],
        nextCursor: null,
      });
    }
    return undefined;
  };
  return { handler, asked };
}

describe("the Inbox destination", () => {
  it("cycles column sorting through ascending, descending, and the default queue order", async () => {
    const api = inboxApi([inboxRow()]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/inbox");
    const user = userEvent.setup();
    await screen.findByRole("table");
    for (const name of ["Ref", "Title", "Type", "Requester", "Urgency", "Age", "Status"]) {
      expect(
        within(screen.getByRole("columnheader", { name })).getByRole("button", { name }),
      ).toBeInTheDocument();
    }
    for (const dir of ["asc", "desc", null]) {
      await act(async () => {
        await user.click(screen.getByRole("button", { name: "Title" }));
        await vi.waitFor(() => {
          expect(new URLSearchParams(router.state.location.search).get("dir")).toBe(dir);
          expect(router.state.navigation.state).toBe("idle");
        });
      });
      expect(api.asked.at(-1)?.searchParams.get("sort")).toBe(dir ? "title" : null);
      expect(api.asked.at(-1)?.searchParams.get("status")).toBe("new");
      const header = screen.getByRole("columnheader", { name: "Title" });
      if (dir) {
        expect(header).toHaveAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");
        expect(screen.queryByText("Ordered by urgency, then age")).not.toBeInTheDocument();
      } else {
        expect(header).not.toHaveAttribute("aria-sort");
        expect(screen.getByText("Ordered by urgency, then age")).toBeInTheDocument();
      }
    }
    await act(async () => {
      await router.navigate(-1);
    });
    expect(screen.getByRole("columnheader", { name: "Title" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("keeps the previous sort and rows when a sort request fails", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/requests") return undefined;
        return call.url.searchParams.has("sort")
          ? problem(500, "The Inbox could not be read.")
          : json(200, { requests: [inboxRow()], nextCursor: null });
      },
    });
    const { router } = renderAt("/inbox");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Title" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Inbox could not be read. Try again.",
    );
    expect(screen.getByRole("columnheader", { name: "Title" })).not.toHaveAttribute("aria-sort");
    expect(screen.getByRole("row", { name: /Injunction threat/ })).toBeInTheDocument();
    expect(router.state.location.search).toBe("");
  });

  it("shows a Legal Team Member the queue, each row opening the Request", async () => {
    stubApi({ signedIn: MEMBER, extra: inboxApi([inboxRow()]).handler });
    renderAt("/inbox");

    expect(await screen.findByRole("heading", { level: 1, name: "Inbox" })).toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "Width of the Actions column" }),
    ).not.toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Injunction threat/ });
    expect(within(row).getByText("R-48")).toBeInTheDocument();
    expect(
      within(row).getByRole("link", { name: "Injunction threat — Meridian dispute letter" }),
    ).toHaveAttribute("href", "/inbox/48");
    // The front door, and the routing the Administrator bound to it.
    // Triage confirms the target, so the row states it (DD-018).
    expect(within(row).getByText("NDA request")).toBeInTheDocument();
    expect(within(row).getByText("Contract · NDA")).toBeInTheDocument();
    expect(within(row).getByText("Dana Reyes")).toBeInTheDocument();
    expect(within(row).getByText("Critical")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Assign R-48" })).toBeInTheDocument();
  });

  it("reads a module-only target as the module alone, and no target as none", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: inboxApi([
        inboxRow({
          id: "r2",
          number: 45,
          title: "Orion Cloud MSA renewal",
          requestType: {
            id: "rt-review",
            displayName: "Contract review",
            targetModule: "contract",
            targetTypeName: null,
          },
        }),
        inboxRow({
          id: "r3",
          number: 46,
          title: "EU customer data processing question",
          requestType: {
            id: "rt-question",
            displayName: "Legal question",
            targetModule: null,
            targetTypeName: null,
          },
        }),
      ]).handler,
    });
    renderAt("/inbox");

    const review = await screen.findByRole("row", { name: /Orion Cloud MSA renewal/ });
    expect(within(review).getByText("Contract")).toBeInTheDocument();
    const question = screen.getByRole("row", { name: /EU customer data processing question/ });
    expect(within(question).getByText("No target")).toBeInTheDocument();
  });

  it("says what the queue is and how it is ordered", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: inboxApi([inboxRow(), inboxRow({ id: "r2", number: 45 })]).handler,
    });
    renderAt("/inbox");

    const subbar = await screen.findByRole("region", { name: "Inbox" });
    expect(within(subbar).getByText("2 requests")).toBeInTheDocument();
    expect(screen.getByText("Ordered by urgency, then age")).toBeInTheDocument();
  });

  it("states plainly that nothing is waiting", async () => {
    stubApi({ signedIn: MEMBER, extra: inboxApi([]).handler });
    renderAt("/inbox");

    expect(await screen.findByText("Nothing is waiting")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("reveals the triaged Requests with their outcome when the Status filter is cleared", async () => {
    const api = inboxApi(
      [inboxRow()],
      [
        inboxRow({
          id: "r9",
          number: 39,
          status: "declined",
          title: "Trademark check for Northstar",
        }),
      ],
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/inbox");
    const user = userEvent.setup();

    await screen.findByRole("row", { name: /Injunction threat/ });
    // Yesterday's decisions stay out of the queue until they are asked
    // for (INT-007).
    expect(screen.queryByText(/Trademark check/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Status filter" }));

    const declined = await screen.findByRole("row", { name: /Trademark check/ });
    expect(within(declined).getByText("Declined")).toBeInTheDocument();
    expect(api.asked.at(-1)?.searchParams.get("includeTriaged")).toBe("true");
  });

  it("says so when a filter read fails, and keeps the previous filter usable", async () => {
    let answers = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/requests" || call.method !== "GET") return undefined;
        answers += 1;
        // The loader's read lands; the filter change does not.
        return answers === 1
          ? json(200, { requests: [inboxRow()], nextCursor: null })
          : problem(500, "The Inbox could not be read.");
      },
    });
    renderAt("/inbox");
    const user = userEvent.setup();

    await screen.findByRole("row", { name: /Injunction threat/ });
    await user.click(screen.getByRole("button", { name: "Remove Status filter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Inbox could not be read. Try again.",
    );
    // The queue that was read still stands, and the retry is the same
    // control under the reader's hand.
    expect(screen.getByRole("row", { name: /Injunction threat/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove Status filter" })).toBeEnabled(),
    );
  });

  it("links a converted Request to the record it became", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: inboxApi(
        [],
        [
          inboxRow({
            id: "r5",
            number: 44,
            status: "converted",
            title: "NDA with Northwind Labs",
            convertedContract: { number: 91 },
            convertedRecord: { module: "contract", number: 91 },
          }),
        ],
      ).handler,
    });
    renderAt("/inbox");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Remove Status filter" }));

    const row = await screen.findByRole("row", { name: /NDA with Northwind Labs/ });
    expect(within(row).getByRole("link", { name: "C-91" })).toHaveAttribute(
      "href",
      "/contracts/91",
    );
  });

  it("links a converted Request to a matter", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: inboxApi(
        [],
        [
          inboxRow({
            id: "r-matter",
            number: 42,
            status: "converted",
            title: "Meridian dispute",
            convertedContract: null,
            convertedRecord: { module: "matter", number: 12 },
          }),
        ],
      ).handler,
    });
    renderAt("/inbox");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Remove Status filter" }));

    const row = await screen.findByRole("row", { name: /Meridian dispute/ });
    expect(within(row).getByRole("link", { name: "M-12" })).toHaveAttribute("href", "/matters/12");
  });

  it("draws no link when the server withheld the record (DD-014)", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: inboxApi(
        [],
        [
          inboxRow({
            id: "r6",
            number: 43,
            status: "converted",
            title: "Something quiet",
            // The withholding is the server's decision: the client is
            // never handed a reference it must decide not to render.
            convertedContract: null,
          }),
        ],
      ).handler,
    });
    renderAt("/inbox");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Remove Status filter" }));

    const row = await screen.findByRole("row", { name: /Something quiet/ });
    expect(within(row).getByText("Converted")).toBeInTheDocument();
    expect(within(row).queryByRole("link", { name: /^C-/ })).not.toBeInTheDocument();
  });

  it("appends the next page in place, carrying filters and sorting with the cursor", async () => {
    const FIRST = [inboxRow()];
    const SECOND = [inboxRow({ id: "r2", number: 45, title: "Orion Cloud MSA renewal" })];
    const asked: URL[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/requests" || call.method !== "GET") return undefined;
        asked.push(call.url);
        return call.url.searchParams.get("cursor") === null
          ? json(200, { requests: FIRST, nextCursor: "r1" })
          : json(200, { requests: SECOND, nextCursor: null });
      },
    });
    renderAt("/inbox?filters=1&status=new&sort=createdAt&dir=desc");
    const user = userEvent.setup();

    await screen.findByRole("row", { name: /Injunction threat/ });
    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByRole("row", { name: /Orion Cloud MSA renewal/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Injunction threat/ })).toBeInTheDocument();
    expect(asked.at(-1)?.searchParams.get("cursor")).toBe("r1");
    expect(asked.at(-1)?.searchParams.get("sort")).toBe("createdAt");
    expect(asked.at(-1)?.searchParams.get("dir")).toBe("desc");
    expect(asked.at(-1)?.searchParams.get("status")).toBe("new");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument(),
    );
  });
});

describe("who the Inbox is for (INT-006, DD-013)", () => {
  it("puts the Inbox in nav slot two, behind Home, for Member+", async () => {
    stubApi({ signedIn: MEMBER, extra: inboxApi([]).handler });
    renderAt("/inbox");

    const nav = await screen.findByRole("navigation");
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Home",
      "Inbox",
      "Matters",
      "Contracts",
      "Documents",
      "Entities",
      "Knowledge",
    ]);
    expect(links[1]).toHaveAttribute("aria-current", "page");
  });

  it("never gives a Business User the destination at all", async () => {
    stubApi({ signedIn: BUSINESS });
    const { router } = renderAt("/inbox");

    // Bounced home, and home for a Business User is the portal
    // (INT-001). The staff shell is somewhere they never arrive.
    await waitFor(() => expect(router.state.location.pathname).toBe("/portal"));
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  });
});

async function chooseFilter(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  choices: string[],
  router: ReturnType<typeof renderAt>["router"],
  expected: [string, string],
) {
  await user.click(await screen.findByRole("button", { name: /^Filter/ }));
  const picker = within(screen.getByRole("dialog", { name: "Filter" }));
  await user.click(picker.getByRole("button", { name }));
  for (const choice of choices) await user.click(picker.getByRole("checkbox", { name: choice }));
  await act(async () => {
    await user.click(picker.getByRole("button", { name: "Apply" }));
    await vi.waitFor(() => {
      expect(new URLSearchParams(router.state.location.search).get(expected[0])).toBe(expected[1]);
      expect(router.state.navigation.state).toBe("idle");
    });
  });
}

describe("Inbox filters and views", () => {
  it("combines multiple urgency values with requester choices, carries filters into paging, and restores browser history", async () => {
    const asked: URL[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/requests/filter-options")
          return json(200, { types: [], people: [{ id: "u7", displayName: "Dana Reyes" }] });
        if (call.url.pathname !== "/api/v1/requests") return undefined;
        asked.push(call.url);
        return json(200, {
          requests: [
            inboxRow({
              id: call.url.searchParams.has("cursor") ? "r2" : "r1",
              title: call.url.searchParams.has("cursor") ? "Next page" : "First page",
            }),
          ],
          nextCursor: call.url.searchParams.has("cursor") ? null : "r1",
          total: 51,
        });
      },
    });
    const { router } = renderAt("/inbox");
    const user = userEvent.setup();
    await chooseFilter(user, "Urgency", ["High", "Critical"], router, ["urgency", "high,critical"]);
    await chooseFilter(user, "Requester", ["Dana Reyes"], router, ["requester", "u7"]);
    await waitFor(() => {
      expect(router.state.navigation.state).toBe("idle");
      expect(screen.queryByRole("dialog", { name: "Filter" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show more" })).toBeEnabled();
    });
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Show more" }));
    });
    await screen.findByRole("row", { name: /Next page/ });
    expect(asked.at(-1)?.searchParams.get("urgency")).toBe("high,critical");
    expect(asked.at(-1)?.searchParams.get("requester")).toBe("u7");
    expect(asked.at(-1)?.searchParams.get("status")).toBe("new");
    await act(async () => {
      await router.navigate(-1);
    });
    expect(
      screen.queryByRole("button", { name: "Remove Requester filter" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Urgency filter" })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Next page/ })).not.toBeInTheDocument();
  });

  it("saves filters and dates as an Inbox view, restores its default, and keeps explicit links authoritative", async () => {
    let saved: Record<string, unknown>[] = [];
    const asked: URL[] = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/list-views") {
          if (call.method === "POST") {
            const body = call.body as Record<string, unknown>;
            expect(body.surface).toBe("inbox");
            saved = [{ id: "inbox-view", ...body, isDefault: true }];
            return json(201, { views: saved });
          }
          return json(200, { views: saved });
        }
        if (call.url.pathname === "/api/v1/requests") {
          asked.push(call.url);
          return json(200, { requests: [], nextCursor: null, total: 0 });
        }
        return undefined;
      },
    });
    const { router } = renderAt(
      "/inbox?filters=1&status=new,resolved&urgency=critical,high&receivedFrom=2026-09-01&receivedTo=2026-09-30&sort=urgency&dir=desc",
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Default view/ }));
    await user.click(screen.getByRole("menuitem", { name: "Save as…" }));
    const dialog = within(screen.getByRole("dialog", { name: "Save this view" }));
    await user.clear(dialog.getByLabelText("Name"));
    await user.type(dialog.getByLabelText("Name"), "September priorities");
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "September priorities" });
    expect(saved[0]?.config).toMatchObject({
      sort: { key: "urgency", dir: "desc" },
      filters: {
        status: "new,resolved",
        urgency: "critical,high",
        receivedFrom: "2026-09-01",
        receivedTo: "2026-09-30",
      },
    });
    await act(async () => {
      await router.navigate("/inbox");
    });
    expect(asked.at(-1)?.searchParams.get("urgency")).toBe("critical,high");
    expect(asked.at(-1)?.searchParams.get("receivedTo")).toBe("2026-09-30");
    expect(asked.at(-1)?.searchParams.get("sort")).toBe("urgency");
    expect(asked.at(-1)?.searchParams.get("dir")).toBe("desc");
    await act(async () => {
      await router.navigate("/inbox?filters=1&view=all&status=declined");
    });
    expect(asked.at(-1)?.searchParams.get("status")).toBe("declined");
    expect(asked.at(-1)?.searchParams.has("urgency")).toBe(false);
    expect(asked.at(-1)?.searchParams.has("sort")).toBe(false);
    expect(screen.getByRole("button", { name: /^Default view/ })).toBeInTheDocument();
  });
});
