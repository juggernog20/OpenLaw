// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Ownership tab as a share register (ENT-011, DES-088): the register
 * derived from entries, the as-of scrubber in the URL, the dimmed later
 * entries, the DES-046 entries filter, the empty state, and one refused
 * write surfacing the API's problem detail.
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

const TODAY = new Date().toISOString().slice(0, 10);

function entity(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    legalName: "Wentworth Capital Partners Ltd",
    entityTypeId: "t-corp",
    entityTypeName: "Corporation",
    jurisdiction: "Cayman Islands",
    formedOn: null,
    registrationNumber: null,
    taxId: null,
    registeredAgent: null,
    registeredAddress: null,
    status: "active",
    sharesAuthorized: null,
    sharesIssued: 750_000,
    parValue: null,
    parValueCurrency: null,
    customFields: {},
    isConfidential: false,
    portalListed: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const WFO = {
  restricted: false,
  id: "h-wfo",
  kind: "entity",
  name: "Wentworth Family Office Holdings Ltd",
  entityId: "e2",
  jurisdiction: "Jersey",
};
const BLAIR = {
  restricted: false,
  id: "h-blair",
  kind: "individual",
  name: "Blair Wentworth",
  entityId: null,
  jurisdiction: null,
};
const WALLED = { restricted: true, id: "h-walled" };

const ORDINARY = {
  id: "c-ord",
  name: "Ordinary",
  authorized: 1_000_000,
  parValue: 100,
  parValueCurrency: "USD",
  votesPerShare: 1,
  rights: "One vote per share",
  position: 0,
  archivedAt: null,
  entryCount: 3,
};

function entryRow(overrides: Record<string, unknown>) {
  return {
    id: "x",
    entryNo: 1,
    kind: "allotment",
    effectiveOn: "2019-03-12",
    shareClassId: "c-ord",
    toShareClassId: null,
    quantity: 1,
    from: null,
    to: WFO,
    pricePerShare: null,
    priceCurrency: null,
    consideration: null,
    distinctiveNumbers: null,
    resolutionRef: null,
    note: null,
    certificatesIssued: [],
    certificatesCancelled: [],
    applied: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The register as the API replays it: at today, and scrubbed to 2022-12-31. */
function registerAt(asOf: string) {
  const historic = asOf < "2023-02-01";
  const entries = [
    entryRow({
      id: "en1",
      entryNo: 1,
      quantity: 550_000,
      to: WFO,
      consideration: "$550,000 cash",
      resolutionRef: "BR-2019-01",
      certificatesIssued: [
        {
          number: "001",
          holderId: "h-wfo",
          shareClassId: "c-ord",
          quantity: 550_000,
          distinctiveNumbers: "1–550,000",
        },
      ],
    }),
    entryRow({ id: "en2", entryNo: 2, quantity: 200_000, to: BLAIR }),
    entryRow({
      id: "en3",
      entryNo: 3,
      kind: "transfer",
      effectiveOn: "2023-02-01",
      quantity: 40_000,
      from: BLAIR,
      to: WALLED,
      certificatesCancelled: ["002"],
      applied: !historic,
    }),
  ];
  const holders = historic
    ? [
        {
          holder: WFO,
          shareClassId: "c-ord",
          balance: 550_000,
          percentOfClass: 73.33,
          percentOfVotes: 73.33,
          certificates: ["001"],
          memberSince: "2019-03-12",
          balanceToday: 550_000,
        },
        {
          holder: BLAIR,
          shareClassId: "c-ord",
          balance: 200_000,
          percentOfClass: 26.67,
          percentOfVotes: 26.67,
          certificates: [],
          memberSince: "2019-03-12",
          balanceToday: 160_000,
        },
      ]
    : [
        {
          holder: WFO,
          shareClassId: "c-ord",
          balance: 550_000,
          percentOfClass: 73.33,
          percentOfVotes: 73.33,
          certificates: ["001"],
          memberSince: "2019-03-12",
          balanceToday: 550_000,
        },
        {
          holder: BLAIR,
          shareClassId: "c-ord",
          balance: 160_000,
          percentOfClass: 21.33,
          percentOfVotes: 21.33,
          certificates: [],
          memberSince: "2019-03-12",
          balanceToday: 160_000,
        },
        {
          holder: WALLED,
          shareClassId: "c-ord",
          balance: 40_000,
          percentOfClass: 5.33,
          percentOfVotes: 5.33,
          certificates: [],
          memberSince: "2023-02-01",
          balanceToday: 40_000,
        },
      ];
  return {
    asOf,
    today: TODAY,
    classes: [ORDINARY],
    holders,
    treasury: [],
    totals: [
      {
        shareClassId: "c-ord",
        issued: 750_000,
        treasury: 0,
        outstanding: 750_000,
        votes: 750_000,
        percentOfVotes: 100,
      },
    ],
    entries,
    dates: ["2019-03-12", "2023-02-01"],
    reconciliation: { declaredIssued: 750_000, registerIssued: 750_000 },
    warnings: [],
  };
}

function registerApi(options: { empty?: boolean; refuse?: string } = {}) {
  const writes: StubCall[] = [];
  const handler = (call: StubCall) => {
    if (call.url.pathname === "/api/v1/entities/e1" && call.method === "GET") {
      return json(200, {
        entity: entity(),
        fields: [],
        customFieldRefs: { users: [], entities: [] },
      });
    }
    if (call.url.pathname === "/api/v1/entities/types" && call.method === "GET") {
      return json(200, {
        entityTypes: [{ id: "t-corp", slug: "corporation", displayName: "Corporation" }],
      });
    }
    if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
      return json(200, { entities: [entity(), entity({ id: "e2", legalName: WFO.name })] });
    }
    if (call.url.pathname === "/api/v1/entities/e1/share-register" && call.method === "GET") {
      if (options.empty) return undefined; // the shared stub answers an empty register
      return json(200, registerAt(call.url.searchParams.get("asOf") ?? TODAY));
    }
    if (call.url.pathname === "/api/v1/entities/e1/share-entries" && call.method === "POST") {
      writes.push(call);
      if (options.refuse) return problem(409, options.refuse);
      return json(201, registerAt(TODAY));
    }
    if (call.url.pathname === "/api/v1/entities/e1/share-classes" && call.method === "POST") {
      writes.push(call);
      return json(201, registerAt(TODAY));
    }
    return undefined;
  };
  return { handler, writes };
}

describe("the Entity Ownership tab as a share register", () => {
  it("derives the Register of members and the entries, with no way to add a holder", async () => {
    stubApi({ signedIn: MEMBER, extra: registerApi().handler });
    renderAt("/entities/e1/ownership");
    expect(await screen.findByRole("heading", { name: "Register of members" })).toBeInTheDocument();
    expect(screen.getByText(/derived from 3 register entries/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add holder/ })).not.toBeInTheDocument();
    expect(
      screen.getByText("Today the register agrees with Share capital: 750,000 issued."),
    ).toBeInTheDocument();

    const members = screen
      .getByRole("heading", { name: "Register of members" })
      .closest("section")!;
    const rows = within(members).getAllByRole("row");
    expect(within(rows[1]!).getByText("Wentworth Family Office Holdings Ltd")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Entity · Jersey")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("550,000")).toBeInTheDocument();
    expect(within(rows[1]!).getAllByText("73.3%")).toHaveLength(2);
    expect(within(rows[2]!).getByText("Individual")).toBeInTheDocument();
    expect(within(rows[3]!).getByText("Restricted Entity")).toBeInTheDocument();
    expect(within(members).getByText("Total Ordinary")).toBeInTheDocument();
    expect(
      within(members).getByText(/750,000 outstanding · 0 in treasury · par \$1\.00/),
    ).toBeInTheDocument();
    expect(within(members).queryByText("Change to today")).not.toBeInTheDocument();

    const entries = screen
      .getByRole("heading", { name: "Register of allotments and transfers" })
      .closest("section")!;
    const entryRows = within(entries).getAllByRole("row").slice(1);
    expect(entryRows).toHaveLength(3);
    expect(entryRows[0]).toHaveAttribute("data-applied", "true");
    expect(within(entryRows[0]!).getAllByText("001")).toHaveLength(2);
    expect(within(entryRows[0]!).getByText("Allotment")).toBeInTheDocument();
    expect(within(entryRows[0]!).getByText("$550,000 cash")).toBeInTheDocument();
    expect(within(entryRows[0]!).getByText("BR-2019-01")).toBeInTheDocument();
    expect(within(entryRows[2]!).getByText("Transfer")).toBeInTheDocument();
    expect(within(entryRows[2]!).getByText("002")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Holdings in other Entities" })).toBeInTheDocument();
  });

  it("scrubs the register through ?asOf, dims later entries, and resets to today", async () => {
    const api = registerApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/entities/e1/ownership?asOf=2022-12-31");
    expect(
      await screen.findByRole("heading", { name: "Register of members at Dec 31, 2022" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /At Dec 31, 2022 the register showed 750,000 Ordinary issued, from 2 entries of 3/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Change to today")).toBeInTheDocument();
    const members = screen
      .getByRole("heading", { name: /Register of members/ })
      .closest("section")!;
    expect(within(members).getByText("−40,000")).toBeInTheDocument();
    expect(screen.getByText("Entries after Dec 31, 2022 are dimmed")).toBeInTheDocument();
    const entries = screen
      .getByRole("heading", { name: "Register of allotments and transfers" })
      .closest("section")!;
    const entryRows = within(entries).getAllByRole("row").slice(1);
    expect(entryRows[2]).toHaveAttribute("data-applied", "false");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next entry date" }));
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get("asOf")).toBe("2023-02-01"),
    );
    await user.click(screen.getByRole("button", { name: "Previous entry date" }));
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get("asOf")).toBe("2019-03-12"),
    );
    await user.click(screen.getByRole("button", { name: "Reset to today" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(await screen.findByRole("heading", { name: "Register of members" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset to today" })).toBeDisabled();
  });

  it("filters entries through the shared bar", async () => {
    stubApi({ signedIn: MEMBER, extra: registerApi().handler });
    const { router } = renderAt("/entities/e1/ownership");
    await screen.findByRole("heading", { name: "Register of allotments and transfers" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Filter/ }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Filter" })).getByRole("button", { name: "Entry" }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Transfer" }));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("button", { name: "Entry: Transfer" })).toBeInTheDocument();
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get("kind")).toBe("transfer"),
    );
    const entries = screen
      .getByRole("heading", { name: "Register of allotments and transfers" })
      .closest("section")!;
    await waitFor(() => expect(within(entries).getAllByRole("row").slice(1)).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Remove Entry filter" }));
    await waitFor(() => expect(within(entries).getAllByRole("row").slice(1)).toHaveLength(3));
  });

  it("opens on the empty state, with Record entry waiting on a share class", async () => {
    stubApi({ signedIn: MEMBER, extra: registerApi({ empty: true }).handler });
    renderAt("/entities/e1/ownership");
    expect(
      await screen.findByRole("heading", { name: "No share register yet" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New share class" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Record entry" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Holdings in other Entities" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Holding" })).toBeInTheDocument();
  });

  it("shows the API's refusal when an entry would overdraw a holder", async () => {
    const api = registerApi({ refuse: "Entry 4 would take a holder's balance below zero." });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1/ownership");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Record entry" }));
    const dialog = await screen.findByRole("dialog", { name: "Record entry" });
    await user.selectOptions(within(dialog).getByLabelText(/^Entry/), "transfer");
    await user.selectOptions(within(dialog).getByLabelText(/^From/), "holder:h-blair");
    await user.selectOptions(within(dialog).getByLabelText(/^To/), "holder:h-wfo");
    await user.type(within(dialog).getByLabelText(/^Shares/), "999999");
    await user.click(within(dialog).getByRole("button", { name: "Enter in register" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Entry 4 would take a holder's balance below zero.",
    );
    expect(api.writes[0]?.body).toMatchObject({
      kind: "transfer",
      quantity: 999_999,
      from: { kind: "holder", holderId: "h-blair" },
      to: { kind: "holder", holderId: "h-wfo" },
      shareClassId: "c-ord",
    });
  });
});
