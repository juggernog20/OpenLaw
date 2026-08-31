// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Inbox destination (#413), through the real route table with the
 * standard fetch stub: nav slot one for Member+, the undecided queue in
 * I1's columns, the triaged toggle, the trail from a converted Request
 * to the record it became, the empty state, and the next page.
 *
 * A Contributor and a Business User never see the destination and never
 * reach the screen. The API's 403 is the real refusal, and the loader
 * is its client half.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};
const CONTRIBUTOR = {
  id: "u3",
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  role: "contributor",
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
    summary: "Injunction threat — Meridian dispute letter",
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
 * the toggle asks for them, so the test can watch the re-read happen.
 */
function inboxApi(open: Record<string, unknown>[], triaged: Record<string, unknown>[] = []) {
  const asked: URL[] = [];
  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/requests" && call.method === "GET") {
      asked.push(call.url);
      const withTriaged = call.url.searchParams.get("includeTriaged") === "true";
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
  it("shows a Legal Team Member the queue, each row opening the Request", async () => {
    stubApi({ signedIn: MEMBER, extra: inboxApi([inboxRow()]).handler });
    renderAt("/inbox");

    expect(await screen.findByRole("heading", { level: 1, name: "Inbox" })).toBeInTheDocument();
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
    // INT-007: the row affordance is Assign, and it opens the
    // disposition entry on the Request itself.
    expect(within(row).getByRole("link", { name: "Assign R-48" })).toHaveAttribute(
      "href",
      "/inbox/48",
    );
  });

  it("reads a module-only target as the module alone, and no target as none", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: inboxApi([
        inboxRow({
          id: "r2",
          number: 45,
          summary: "Orion Cloud MSA renewal",
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
          summary: "EU customer data processing question",
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
    expect(within(subbar).getByText("2 awaiting triage")).toBeInTheDocument();
    expect(screen.getByText("Ordered by urgency, then age")).toBeInTheDocument();
  });

  it("states plainly that nothing is waiting", async () => {
    stubApi({ signedIn: MEMBER, extra: inboxApi([]).handler });
    renderAt("/inbox");

    expect(await screen.findByText("Nothing is waiting")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("reveals the triaged Requests with their outcome when the toggle is turned on", async () => {
    const api = inboxApi(
      [inboxRow()],
      [
        inboxRow({
          id: "r9",
          number: 39,
          status: "declined",
          summary: "Trademark check for Northstar",
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

    await user.click(screen.getByRole("switch", { name: "Show triaged" }));

    const declined = await screen.findByRole("row", { name: /Trademark check/ });
    expect(within(declined).getByText("Declined")).toBeInTheDocument();
    expect(api.asked.at(-1)?.searchParams.get("includeTriaged")).toBe("true");
  });

  it("says so when the toggle's re-read fails, and leaves the toggle usable", async () => {
    let answers = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname !== "/api/v1/requests" || call.method !== "GET") return undefined;
        answers += 1;
        // The loader's read lands; the toggle's does not.
        return answers === 1
          ? json(200, { requests: [inboxRow()], nextCursor: null })
          : problem(500, "The Inbox could not be read.");
      },
    });
    renderAt("/inbox");
    const user = userEvent.setup();

    await screen.findByRole("row", { name: /Injunction threat/ });
    await user.click(screen.getByRole("switch", { name: "Show triaged" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Inbox could not be read. Try again.",
    );
    // The queue that was read still stands, and the retry is the same
    // control under the reader's hand.
    expect(screen.getByRole("row", { name: /Injunction threat/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Show triaged" })).toBeEnabled());
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
            summary: "NDA with Northwind Labs",
            convertedContract: { number: 91 },
            convertedRecord: { module: "contract", number: 91 },
          }),
        ],
      ).handler,
    });
    renderAt("/inbox");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("switch", { name: "Show triaged" }));

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
            summary: "Meridian dispute",
            convertedContract: null,
            convertedRecord: { module: "matter", number: 12 },
          }),
        ],
      ).handler,
    });
    renderAt("/inbox");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("switch", { name: "Show triaged" }));

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
            summary: "Something quiet",
            // The withholding is the server's decision: the client is
            // never handed a reference it must decide not to render.
            convertedContract: null,
          }),
        ],
      ).handler,
    });
    renderAt("/inbox");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("switch", { name: "Show triaged" }));

    const row = await screen.findByRole("row", { name: /Something quiet/ });
    expect(within(row).getByText("Converted")).toBeInTheDocument();
    expect(within(row).queryByRole("link", { name: /^C-/ })).not.toBeInTheDocument();
  });

  it("appends the next page in place, carrying the toggle with the cursor", async () => {
    const FIRST = [inboxRow()];
    const SECOND = [inboxRow({ id: "r2", number: 45, summary: "Orion Cloud MSA renewal" })];
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
    renderAt("/inbox");
    const user = userEvent.setup();

    await screen.findByRole("row", { name: /Injunction threat/ });
    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByRole("row", { name: /Orion Cloud MSA renewal/ })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Injunction threat/ })).toBeInTheDocument();
    expect(asked.at(-1)?.searchParams.get("cursor")).toBe("r1");
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

  it("draws no Inbox for a Contributor, and bounces them off the screen", async () => {
    stubApi({ signedIn: CONTRIBUTOR });
    const { router } = renderAt("/inbox");

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    const nav = await screen.findByRole("navigation");
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).not.toContain("Inbox");
  });

  it("never gives a Business User the destination at all", async () => {
    stubApi({ signedIn: BUSINESS });
    const { router } = renderAt("/inbox");

    // Bounced home, and home for a Business User is the portal
    // (INT-001). The staff shell is somewhere they never arrive.
    await waitFor(() => expect(router.state.location.pathname).toBe("/portal"));
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
