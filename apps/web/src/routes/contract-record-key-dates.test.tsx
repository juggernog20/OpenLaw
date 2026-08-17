// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record's Key dates section (M16/3, CTR-009) at
 * `/contracts/42/key-dates`, through the real route table with the
 * standard fetch stub.
 *
 * What the section draws: the CTR-009 union in one table — the team's
 * own named dates beside the contract's expiry and its derived notice
 * deadline — with the head's count badge and its upcoming/past tally,
 * the Source chip that tells the three apart, and the next deadline
 * named in words rather than only in colour.
 *
 * What it offers: "Add date", the row's own edit, and the row's remove.
 * What it must not offer is asserted just as hard — the two derived rows
 * carry no menu at all, because the term is edited on the record's own
 * Contract card, and a read-only or archived record carries no control
 * anywhere.
 *
 * The order, the day counts, and which date is next are the seam's
 * answer (DES-040 clause 4), so these tests hand them over in the
 * response rather than recomputing them. The section must never work
 * them out itself.
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

const PEOPLE = [
  {
    id: "u2",
    displayName: "Nadia Counsel",
    image: null,
    archived: false,
    role: "legal_team_member",
  },
];

const OPTIONS = {
  contractTypes: [{ id: "t-msa", slug: "msa", displayName: "MSA", fields: [] }],
  contractStatuses: [{ id: "s-draft", slug: "draft", displayName: "Draft", stage: "draft" }],
  users: PEOPLE,
  approverGroups: [],
};

function contractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    number: 42,
    title: "Acme master services agreement",
    contractTypeId: "t-msa",
    contractTypeName: "MSA",
    statusId: "s-draft",
    statusName: "Draft",
    stage: "draft",
    manager: null,
    entity: null,
    primaryCounterparty: null,
    priority: "medium",
    risk: null,
    value: null,
    termType: "auto_renew",
    effectiveDate: "2026-01-01",
    expiryDate: "2026-12-31",
    renewalPeriodMonths: 12,
    noticePeriodDays: 90,
    noticeDeadline: "2026-10-02",
    daysRemaining: 120,
    renewalPendingConfirmation: false,
    proposedRenewalExpiry: null,
    description: null,
    customFields: {},
    isConfidential: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** One row of the union, as the API answers it. */
function deadline(overrides: Record<string, unknown> = {}) {
  return {
    source: "key_date",
    keyDateId: "kd-1",
    date: "2027-03-01",
    label: "Price review window opens",
    note: null,
    daysAway: 60,
    isNext: false,
    ...overrides,
  };
}

/** The union the C6 mock draws, in the order and with the marks the seam
 * would have given: the derived deadline is next, the record's own dates
 * sit among the term's, and one date has gone by. */
const UNION = [
  deadline({
    source: "notice_deadline",
    keyDateId: null,
    date: "2026-10-02",
    label: null,
    daysAway: 30,
    isNext: true,
  }),
  deadline({ daysAway: 60 }),
  deadline({
    source: "expiry",
    keyDateId: null,
    date: "2026-12-31",
    label: null,
    daysAway: 120,
  }),
  deadline({
    keyDateId: "kd-2",
    date: "2026-07-01",
    label: "Phase 1 delivery acceptance",
    note: "Signed off by the delivery lead.",
    daysAway: -40,
  }),
];

/**
 * The record loader's reads plus the three key-date writes. The union is
 * stateful: a write answers the union it produces, and a later read
 * answers the latest one — which is the contract the section relies on,
 * since a write moves more rows than the one it was addressed at.
 */
function recordApi(
  initial: Record<string, unknown>[] = [],
  row: Record<string, unknown> = contractRow(),
) {
  let deadlines = initial;
  const writes: { method: string; path: string; body: unknown }[] = [];
  let refuse: { status: number; detail: string } | null = null;

  const envelope = () => json(200, { deadlines });

  const handler = (call: StubCall) => {
    if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
      return json(200, OPTIONS);
    }
    if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
      return json(200, { entities: [] });
    }
    if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
      return json(200, {
        contract: row,
        fields: [],
        customFieldRefs: { users: [], entities: [] },
        team: [{ ...PEOPLE[0], role: "creator" }],
        counterparties: [],
        renewals: [],
      });
    }
    if (call.url.pathname === "/api/v1/contracts/42/key-dates" && call.method === "GET") {
      return envelope();
    }
    if (call.url.pathname === "/api/v1/contracts/42/key-dates" && call.method === "POST") {
      writes.push({ method: "POST", path: call.url.pathname, body: call.body });
      if (refuse) return problem(refuse.status, refuse.detail);
      const body = call.body as { date: string; label: string; note: string | null };
      deadlines = [
        ...deadlines,
        deadline({ keyDateId: `kd-new-${deadlines.length}`, ...body, daysAway: 10 }),
      ];
      return json(201, { deadlines });
    }
    const one = /^\/api\/v1\/key-dates\/([^/]+)$/.exec(call.url.pathname);
    if (one && call.method === "PATCH") {
      writes.push({ method: "PATCH", path: call.url.pathname, body: call.body });
      if (refuse) return problem(refuse.status, refuse.detail);
      const body = call.body as Record<string, unknown>;
      deadlines = deadlines.map((entry) =>
        entry.keyDateId === one[1] ? { ...entry, ...body } : entry,
      );
      return envelope();
    }
    if (one && call.method === "DELETE") {
      writes.push({ method: "DELETE", path: call.url.pathname, body: null });
      if (refuse) return problem(refuse.status, refuse.detail);
      deadlines = deadlines.filter((entry) => entry.keyDateId !== one[1]);
      return envelope();
    }
    return undefined;
  };
  return {
    handler,
    writes,
    refuseNext: (status: number, detail: string) => {
      refuse = { status, detail };
    },
  };
}

/** The section, once the loader has answered. */
const section = async () => within(await screen.findByRole("region", { name: "Key dates" }));

describe("the record's Key dates section (CTR-009)", () => {
  it("draws the union: the key dates, the expiry, and the derived notice deadline", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(UNION).handler });
    renderAt("/contracts/42/key-dates");

    const card = await section();
    // Every row in the order the seam gave, with the term's two dates
    // named by the record rather than by the seam.
    const rows = card.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Renewal notice deadline — 90 days before expiry");
    expect(rows[1]).toHaveTextContent("Price review window opens");
    expect(rows[2]).toHaveTextContent("Current term expires");
    expect(rows[3]).toHaveTextContent("Phase 1 delivery acceptance");
    // A key date's note reads under the name it belongs to.
    expect(rows[3]).toHaveTextContent("Signed off by the delivery lead.");

    // The Source chip tells the three apart: what the team wrote down,
    // and what the term produced.
    expect(within(rows[0]!).getByText("Derived")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Key date")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Derived")).toBeInTheDocument();

    // The head counts what is drawn and splits it the way the C6 mock's
    // toolbar does.
    expect(card.getByRole("img", { name: "4 dates" })).toBeInTheDocument();
    expect(card.getByText("3 upcoming")).toBeInTheDocument();
    expect(card.getByText("1 past")).toBeInTheDocument();

    // The tab chip counts upcoming work, not the whole union — a past
    // date is not news on the strip.
    const strip = within(screen.getByRole("navigation", { name: "Contract sections" }));
    expect(strip.getByRole("img", { name: "3 upcoming dates" })).toBeInTheDocument();
  });

  it("names the next deadline in words, not only in colour", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(UNION).handler });
    renderAt("/contracts/42/key-dates");

    const card = await section();
    const rows = card.getAllByRole("row").slice(1);
    // Exactly one row says it, and it is the one the seam marked.
    expect(card.getAllByText("Next deadline")).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Next deadline");
    // The distance is read from the seam's own day count, so the pill
    // and the order can never disagree.
    expect(rows[0]).toHaveTextContent("in 4 weeks");
    expect(rows[2]).toHaveTextContent("in 4 months");
    // A date behind us says so; how far behind is the Date column's job.
    expect(rows[3]).toHaveTextContent("Past");
  });

  it("draws the section's own empty line when the record has no dates at all", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi([], contractRow({ expiryDate: null, noticeDeadline: null })).handler,
    });
    renderAt("/contracts/42/key-dates");

    const card = await section();
    expect(
      card.getByText("No key dates on this contract yet, and no term dates to show beside them."),
    ).toBeInTheDocument();
    expect(card.queryByRole("table")).not.toBeInTheDocument();
    expect(card.getByRole("img", { name: "0 dates" })).toBeInTheDocument();
  });

  it("adds a key date and redraws the union the write answers with", async () => {
    const api = recordApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/key-dates");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add date" }));

    await user.type(screen.getByLabelText("Date"), "2027-05-04");
    await user.type(screen.getByLabelText("Event"), "Insurance certificate renewal");
    await user.type(screen.getByLabelText("Note (optional)"), "Broker confirms annually.");
    await user.click(screen.getByRole("button", { name: "Add date", hidden: false }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      method: "POST",
      body: {
        date: "2027-05-04",
        label: "Insurance certificate renewal",
        note: "Broker confirms annually.",
      },
    });
    const card = await section();
    expect(card.getByText("Insurance certificate renewal")).toBeInTheDocument();
  });

  it("refuses to send a date with no name, and says so in the dialog", async () => {
    const api = recordApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/key-dates");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add date" }));
    await user.type(screen.getByLabelText("Date"), "2027-05-04");
    await user.click(screen.getByRole("button", { name: "Add date", hidden: false }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Name what the date is.");
    expect(api.writes).toHaveLength(0);
    // The message names the box it is about, so a screen reader reads
    // the two together rather than announcing a complaint about nothing
    // in particular (DES-011).
    const label = screen.getByLabelText("Event");
    expect(label).toHaveAttribute("aria-invalid", "true");
    expect(label).toHaveAttribute("aria-describedby", alert.id);
    expect(screen.getByLabelText("Date")).not.toHaveAttribute("aria-invalid");
  });

  it("prints the seam's refusal in the dialog and keeps it open", async () => {
    const api = recordApi([]);
    api.refuseNext(409, "This contract is archived. Restore it before changing its key dates.");
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/key-dates");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add date" }));
    await user.type(screen.getByLabelText("Date"), "2027-05-04");
    await user.type(screen.getByLabelText("Event"), "Insurance renewal");
    await user.click(screen.getByRole("button", { name: "Add date", hidden: false }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This contract is archived. Restore it before changing its key dates.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("edits a key date from its own row, seeded with what the record holds", async () => {
    const api = recordApi(UNION);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/key-dates");

    const user = userEvent.setup();
    const card = await section();
    await user.click(card.getByRole("button", { name: "Actions for Price review window opens" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit date" }));

    expect(screen.getByLabelText("Date")).toHaveValue("2027-03-01");
    expect(screen.getByLabelText("Event")).toHaveValue("Price review window opens");

    await user.clear(screen.getByLabelText("Event"));
    await user.type(screen.getByLabelText("Event"), "Price review window closes");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      method: "PATCH",
      path: "/api/v1/key-dates/kd-1",
      body: { date: "2027-03-01", label: "Price review window closes", note: null },
    });
  });

  it("removes a key date in one press, with no confirmation to read", async () => {
    const api = recordApi(UNION);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/key-dates");

    const user = userEvent.setup();
    const card = await section();
    await user.click(card.getByRole("button", { name: "Actions for Price review window opens" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove date" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({ method: "DELETE", path: "/api/v1/key-dates/kd-1" });
    await waitFor(() =>
      expect(screen.queryByText("Price review window opens")).not.toBeInTheDocument(),
    );
  });

  it("offers no menu on the two rows the term derives", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(UNION).handler });
    renderAt("/contracts/42/key-dates");

    const card = await section();
    // Two key dates, two menus — and nothing on the expiry or the
    // notice deadline, which move by editing the term.
    expect(card.getAllByRole("button", { name: /^Actions for/ })).toHaveLength(2);
    expect(
      card.queryByRole("button", { name: /Actions for Current term expires/ }),
    ).not.toBeInTheDocument();
  });

  it("gives a read-only viewer the surface and no control on it", async () => {
    stubApi({ signedIn: CONTRIBUTOR, extra: recordApi(UNION).handler });
    renderAt("/contracts/42/key-dates");

    const card = await section();
    expect(card.getByText("Price review window opens")).toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Add date" })).not.toBeInTheDocument();
    expect(card.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
  });

  it("freezes every control on an archived record", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(UNION, contractRow({ archivedAt: "2026-08-02T00:00:00.000Z" })).handler,
    });
    renderAt("/contracts/42/key-dates");

    const card = await section();
    expect(card.getByText("Price review window opens")).toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Add date" })).not.toBeInTheDocument();
    expect(card.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
  });

  it("re-reads the union when the term moves under it", async () => {
    let deadlines = UNION;
    const reads: string[] = [];
    const row = contractRow();
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
          return json(200, OPTIONS);
        }
        if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
          return json(200, { entities: [] });
        }
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
          return json(200, {
            contract: row,
            fields: [],
            customFieldRefs: { users: [], entities: [] },
            team: [{ ...PEOPLE[0], role: "creator" }],
            counterparties: [],
            renewals: [],
          });
        }
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
          // The seam's answer to a shorter notice period: the deadline
          // it derives moves with it.
          deadlines = UNION.map((entry) =>
            entry.source === "notice_deadline"
              ? { ...entry, date: "2026-12-01", daysAway: 90 }
              : entry,
          );
          return json(200, {
            contract: { ...row, noticePeriodDays: 30, noticeDeadline: "2026-12-01" },
            fields: [],
            customFieldRefs: { users: [], entities: [] },
          });
        }
        if (call.url.pathname === "/api/v1/contracts/42/key-dates" && call.method === "GET") {
          reads.push(call.url.pathname);
          return json(200, { deadlines });
        }
        return undefined;
      },
    });
    renderAt("/contracts/42");

    const user = userEvent.setup();
    const notice = await screen.findByLabelText("Notice period (days)");
    await user.clear(notice);
    await user.type(notice, "30");
    await user.tab();

    // Two reads: the loader's, and the one the term commit asked for.
    await waitFor(() => expect(reads).toHaveLength(2));
  });

  it("lets only the newest re-read land, whatever order the answers arrive in", async () => {
    const row = contractRow();
    /** The two re-reads the term commits ask for, held open so the test
     * releases them by hand — the only way to see two in flight at once.
     * Every other read of the union answers at once, because a loader
     * this test is not about must not be left hanging. */
    const held: ((deadlines: Record<string, unknown>[]) => void)[] = [];
    let reads = 0;

    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
          return json(200, OPTIONS);
        }
        if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
          return json(200, { entities: [] });
        }
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
          return json(200, {
            contract: row,
            fields: [],
            customFieldRefs: { users: [], entities: [] },
            team: [{ ...PEOPLE[0], role: "creator" }],
            counterparties: [],
            renewals: [],
          });
        }
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
          const body = call.body as { noticePeriodDays: number };
          return json(200, {
            contract: { ...row, noticePeriodDays: body.noticePeriodDays },
            fields: [],
            customFieldRefs: { users: [], entities: [] },
          });
        }
        if (call.url.pathname === "/api/v1/contracts/42/key-dates" && call.method === "GET") {
          reads += 1;
          // Reads two and three are the two term commits' re-reads.
          if (reads === 2 || reads === 3) {
            return new Promise<Response>((resolve) => {
              held.push((deadlines) => resolve(json(200, { deadlines })));
            });
          }
          return json(200, { deadlines: [] });
        }
        return undefined;
      },
    });
    renderAt("/contracts/42");

    const user = userEvent.setup();
    const box = await screen.findByLabelText("Notice period (days)");
    await user.clear(box);
    await user.type(box, "30");
    await user.tab();
    await waitFor(() => expect(held).toHaveLength(1));

    await user.clear(box);
    await user.type(box, "10");
    await user.tab();
    await waitFor(() => expect(held).toHaveLength(2));

    // The second answer lands first, and then the first — which is the
    // order the network is free to choose and the section must survive.
    held[1]!([deadline({ keyDateId: "kd-newest", label: "From the newest read" })]);
    held[0]!([deadline({ keyDateId: "kd-stale", label: "From the stale read" })]);

    await user.click(screen.getByRole("link", { name: /^Key dates/ }));
    const card = await section();
    expect(card.getByText("From the newest read")).toBeInTheDocument();
    expect(card.queryByText("From the stale read")).not.toBeInTheDocument();
  });
});
