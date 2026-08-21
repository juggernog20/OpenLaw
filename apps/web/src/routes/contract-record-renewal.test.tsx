// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pending roll and its confirmation on the contract record (M16/4),
 * through the real route table with the standard fetch stub.
 *
 * **The banner is a reading, not a state this page holds.** It is drawn
 * because the record read said `renewalPendingConfirmation`, and it goes
 * because a later answer said otherwise. So these tests hand the flag
 * over in the row rather than write a date and wait: the predicate lives
 * at the seam, and a second copy of it here would be the copy that
 * drifts.
 *
 * **The dialog proposes and the person commits.** The box is seeded with
 * the expiry the record answered, and whatever is in it when the button
 * is pressed is what goes to the seam — with the **saved** expiry beside
 * it as the precondition that makes a roll exactly-once.
 *
 * **The history is the log, read back.** The confirmed-renewal rows and
 * the "Last renewal" fact are the same list, so a record with no roll
 * draws the standing em dash and no block at all.
 *
 * **The clock and the timezone are pinned**, the sibling timeline
 * suite's move. `formatShortDate` prints the year only when the date
 * falls outside the current one, so a suite asserting "Jun 30" against a
 * 2026 fixture starts failing on 1 January 2027 unless today is fixed.
 * The viewer's timezone is pinned for the same reason the timeline
 * suite pins it: a runner east or west of UTC would move a rendered
 * calendar day.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RENEWAL_EXPIRY_MOVED_PROBLEM_TYPE } from "@openlaw/shared";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

/** Frozen mid-day so no plausible display timezone moves the calendar
 * date these surfaces call today. */
const TODAY = "2026-08-17T12:00:00Z";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(TODAY));
});

afterEach(() => {
  vi.useRealTimers();
});

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
  // Pins `configureFormatting`, so every date these surfaces print is
  // the same on a runner in Dubai as on one in UTC.
  timezone: "UTC",
};
const CONTRIBUTOR = {
  id: "u3",
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  role: "contributor",
  timezone: "UTC",
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
  contractStatuses: [{ id: "s-active", slug: "active", displayName: "Active", stage: "active" }],
  users: PEOPLE,
  approverGroups: [],
};

/** One confirmed roll, as the seam answers it out of the activity log. */
function renewal(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    from: "2026-06-30",
    to: "2027-06-30",
    confirmedAt: "2026-07-02T09:15:00.000Z",
    confirmedBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
    ...overrides,
  };
}

/**
 * An auto-renewing contract whose expiry has gone by, with the two
 * derivations the seam answers beside it. Nothing here is computed by
 * the page: the pending flag and the proposal are given, exactly as the
 * record read gives them.
 */
function contractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    number: 42,
    title: "Acme master services agreement",
    contractTypeId: "t-msa",
    contractTypeName: "MSA",
    statusId: "s-active",
    statusName: "Active",
    stage: "active",
    manager: null,
    entity: null,
    primaryCounterparty: null,
    priority: "medium",
    risk: null,
    value: null,
    termType: "auto_renew",
    effectiveDate: "2025-07-01",
    expiryDate: "2026-06-30",
    renewalPeriodMonths: 12,
    noticePeriodDays: 90,
    noticeDeadline: "2026-04-01",
    daysRemaining: -20,
    renewalPendingConfirmation: true,
    proposedRenewalExpiry: "2027-06-30",
    description: null,
    customFields: {},
    isConfidential: false,
    archivedAt: null,
    createdAt: "2025-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * The record loader's reads plus the confirm.
 *
 * The stub advances the row the way the seam does — the expiry moves,
 * the pending flag goes out with it, and the proposal steps on — because
 * the record has to be seen **adopting** the answer rather than
 * predicting it.
 */
function recordApi(
  initial: Record<string, unknown> = contractRow(),
  initialRenewals: Record<string, unknown>[] = [],
  refusal: { status: number; detail: string } | null = null,
) {
  let row = initial;
  let renewals = initialRenewals;
  const writes: { body: unknown }[] = [];

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
        renewals,
      });
    }
    if (call.url.pathname === "/api/v1/contracts/42/renewal" && call.method === "POST") {
      writes.push({ body: call.body });
      if (refusal) return problem(refusal.status, refusal.detail);
      const body = call.body as { fromExpiry: string; toExpiry: string };
      row = {
        ...row,
        expiryDate: body.toExpiry,
        // The predicate the seam recomputes: the term now runs into the
        // future, so nothing is pending on it.
        renewalPendingConfirmation: false,
        proposedRenewalExpiry: "2028-06-30",
        daysRemaining: 345,
      };
      renewals = [
        renewal({ id: `log-${renewals.length + 1}`, from: body.fromExpiry, to: body.toExpiry }),
        ...renewals,
      ];
      return json(200, { contract: row, renewals });
    }
    return undefined;
  };
  return { handler, writes };
}

/** The Approvals & signing card, which is where the renewal rows and
 * the Renew control both live. */
const card = async () => within(await screen.findByRole("region", { name: "Approvals & signing" }));

describe("the renewal-pending banner (CTR-006, DES-043)", () => {
  it("draws the banner and its call to action on a record the seam says is pending", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42");

    const banner = await screen.findByRole("region", { name: "Renewal pending confirmation" });
    expect(
      within(banner).getByText(
        "Renewal date passed — pending confirmation. The term does not advance until a human confirms.",
      ),
    ).toBeInTheDocument();
    expect(within(banner).getByRole("button", { name: "Review renewal" })).toBeInTheDocument();
  });

  it("draws no banner when the seam says nothing is pending", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ renewalPendingConfirmation: false, expiryDate: "2027-06-30" }))
        .handler,
    });
    renderAt("/contracts/42");

    // The record is on screen, and the strip is not.
    await screen.findByRole("heading", { name: "Acme master services agreement" });
    expect(
      screen.queryByRole("region", { name: "Renewal pending confirmation" }),
    ).not.toBeInTheDocument();
  });

  it("stacks under the confidentiality banner when a record carries both", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ isConfidential: true })).handler,
    });
    renderAt("/contracts/42");

    const walled = await screen.findByRole("region", { name: "Confidential contract" });
    const pending = screen.getByRole("region", { name: "Renewal pending confirmation" });
    // Confidentiality leads, because it governs who may read the page
    // at all; this one is about one date on it (DES-043 clause 4).
    expect(walled.compareDocumentPosition(pending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers a read-only viewer the statement and no way in", async () => {
    stubApi({ signedIn: CONTRIBUTOR, extra: recordApi().handler });
    renderAt("/contracts/42");

    const banner = await screen.findByRole("region", { name: "Renewal pending confirmation" });
    // Absent, never disabled: an affordance nobody may use is worse
    // than none (DES-035 clause 9).
    expect(
      within(banner).queryByRole("button", { name: "Review renewal" }),
    ).not.toBeInTheDocument();
  });
});

describe("the Renew dialog (CTR-007's first vehicle)", () => {
  it("seeds the box with the seam's proposal and names the term it moves from", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42");

    await userEvent.click(await screen.findByRole("button", { name: "Review renewal" }));

    expect(await screen.findByRole("heading", { name: "Confirm renewal" })).toBeInTheDocument();
    // The proposal is the record's answer, drawn — never recomputed here.
    expect(screen.getByLabelText("New expiry date")).toHaveValue("2027-06-30");
    expect(screen.getByText("The term currently runs to Jun 30.")).toBeInTheDocument();
    expect(
      screen.getByText("C-42 auto-renews in 12-month periods. Choose how to record the new term."),
    ).toBeInTheDocument();
    // The roll is the chosen vehicle when the dialog opens, and the
    // date box belongs to it (M16/5, DES-044). The other three are on
    // offer and are covered by the routing suite.
    expect(screen.getByRole("radio", { name: /Confirm the roll/ })).toBeChecked();
  });

  it("confirms the proposal against the expiry the record holds, and clears the banner", async () => {
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    await userEvent.click(await screen.findByRole("button", { name: "Review renewal" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm renewal" }));

    await waitFor(() =>
      expect(api.writes).toEqual([{ body: { fromExpiry: "2026-06-30", toExpiry: "2027-06-30" } }]),
    );
    // The dialog closes, and the banner goes with the answer: the
    // pending state is the record's reading of its own dates.
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Confirm renewal" })).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("region", { name: "Renewal pending confirmation" }),
    ).not.toBeInTheDocument();
    // And the record's own expiry box has taken the new date.
    expect(screen.getByLabelText("Expiry date")).toHaveTextContent("Jun 30, 2027");
  });

  it("commits the date the person entered rather than the proposal", async () => {
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    await userEvent.click(await screen.findByRole("button", { name: "Review renewal" }));
    const box = screen.getByLabelText("New expiry date");
    await userEvent.clear(box);
    await userEvent.type(box, "2027-09-30");
    await userEvent.click(screen.getByRole("button", { name: "Confirm renewal" }));

    await waitFor(() =>
      // `fromExpiry` is still the record's saved expiry: it is the
      // precondition the seam compares, not a value the box holds.
      expect(api.writes).toEqual([{ body: { fromExpiry: "2026-06-30", toExpiry: "2027-09-30" } }]),
    );
  });

  it("refuses a date that does not move the term forward, before it reaches the seam", async () => {
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    await userEvent.click(await screen.findByRole("button", { name: "Review renewal" }));
    const box = screen.getByLabelText("New expiry date");
    await userEvent.clear(box);
    await userEvent.type(box, "2026-01-01");
    await userEvent.click(screen.getByRole("button", { name: "Confirm renewal" }));

    expect(
      await screen.findByText(
        "A roll moves the term forward. Pick a date after the current expiry.",
      ),
    ).toBeInTheDocument();
    expect(api.writes).toEqual([]);
  });

  it("prints the seam's refusal in the dialog and keeps it open", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow(), [], {
        status: 409,
        detail: "This contract's expiry has already moved.",
      }).handler,
    });
    renderAt("/contracts/42");

    await userEvent.click(await screen.findByRole("button", { name: "Review renewal" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm renewal" }));

    expect(
      await screen.findByText("This contract's expiry has already moved."),
    ).toBeInTheDocument();
    // Reported once, where the reader's attention already is (DES-035
    // clause 12) — and the dialog keeps what was typed.
    expect(screen.getByRole("heading", { name: "Confirm renewal" })).toBeInTheDocument();
    expect(screen.getByLabelText("New expiry date")).toHaveValue("2027-06-30");
  });

  it("reads the record again after a lost race, so a re-press confirms against the moved expiry", async () => {
    // The race the seam's named 409 reports: another confirm landed
    // first, so the record now holds the moved expiry and one roll.
    const moved = contractRow({
      expiryDate: "2026-09-30",
      proposedRenewalExpiry: "2027-09-30",
      renewalPendingConfirmation: false,
      daysRemaining: 90,
    });
    let lost = false;
    const writes: unknown[] = [];
    const handler = (call: StubCall) => {
      if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
        return json(200, OPTIONS);
      }
      if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
        return json(200, { entities: [] });
      }
      if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
        return json(200, {
          contract: lost ? moved : contractRow(),
          fields: [],
          customFieldRefs: { users: [], entities: [] },
          team: [{ ...PEOPLE[0], role: "creator" }],
          counterparties: [],
          renewals: lost ? [renewal({ from: "2026-06-30", to: "2026-09-30" })] : [],
        });
      }
      if (call.url.pathname === "/api/v1/contracts/42/renewal" && call.method === "POST") {
        writes.push(call.body);
        lost = true;
        return problem(
          409,
          "This contract's expiry has already moved.",
          RENEWAL_EXPIRY_MOVED_PROBLEM_TYPE,
        );
      }
      return undefined;
    };
    stubApi({ signedIn: MEMBER, extra: handler });
    renderAt("/contracts/42");

    await userEvent.click(await screen.findByRole("button", { name: "Review renewal" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm renewal" }));

    // The refusal prints in the dialog — and the record is read again,
    // so the sentence under the box names the expiry the record now
    // holds rather than the one the race already moved.
    expect(
      await screen.findByText("This contract's expiry has already moved."),
    ).toBeInTheDocument();
    expect(await screen.findByText("The term currently runs to Sep 30.")).toBeInTheDocument();
    // The fresh read said nothing is pending — the roll was confirmed,
    // just not by this viewer — so the banner went with it.
    expect(
      screen.queryByRole("region", { name: "Renewal pending confirmation" }),
    ).not.toBeInTheDocument();

    // A re-press carries the moved expiry as its precondition, instead
    // of looping on the stale one until somebody reloads the page.
    await userEvent.click(screen.getByRole("button", { name: "Confirm renewal" }));
    await waitFor(() =>
      expect(writes[1]).toEqual({ fromExpiry: "2026-09-30", toExpiry: "2027-06-30" }),
    );
  });
});

describe("the Renew control on the Approvals & signing card", () => {
  it("draws it on a record that can roll, and opens the same dialog", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42/approvals");

    await userEvent.click(await (await card()).findByRole("button", { name: "Renew" }));
    expect(await screen.findByRole("heading", { name: "Confirm renewal" })).toBeInTheDocument();
  });

  it("draws none on a record with no term to roll", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(
        contractRow({
          termType: "fixed",
          renewalPeriodMonths: null,
          renewalPendingConfirmation: false,
          proposedRenewalExpiry: null,
        }),
      ).handler,
    });
    renderAt("/contracts/42/approvals");

    expect((await card()).queryByRole("button", { name: "Renew" })).not.toBeInTheDocument();
  });

  it("draws none for a viewer who may not write the record", async () => {
    stubApi({ signedIn: CONTRIBUTOR, extra: recordApi().handler });
    renderAt("/contracts/42/approvals");

    expect((await card()).queryByRole("button", { name: "Renew" })).not.toBeInTheDocument();
  });
});

describe("the renewal history the record draws (G.R5)", () => {
  it("draws a row per confirmed roll, newest first, with who confirmed it", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow(), [
        renewal({ id: "log-2", from: "2026-06-30", to: "2027-06-30" }),
        renewal({ id: "log-1", from: "2025-06-30", to: "2026-06-30" }),
      ]).handler,
    });
    renderAt("/contracts/42/approvals");

    const rows = within(await screen.findByRole("table", { name: "Renewals" })).getAllByRole("row");
    // A header row plus two rolls, in the order the seam answered them.
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("Term advanced to Jun 30, 2027")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("From Jun 30")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Nadia Counsel")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Term advanced to Jun 30")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("From Jun 30, 2025")).toBeInTheDocument();
    // A confirmed roll is a fact, not a thing to change: no row action.
    expect(within(rows[1]!).queryByRole("button")).not.toBeInTheDocument();
  });

  it("draws no renewal block at all on a record where none has been confirmed", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42/approvals");

    await card();
    expect(screen.queryByRole("table", { name: "Renewals" })).not.toBeInTheDocument();
    // And with one family on screen, the card names none of them.
    expect(screen.queryByRole("heading", { name: "Renewals" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Approvals", level: 3 })).not.toBeInTheDocument();
  });

  it("names both blocks once a roll has been confirmed", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow(), [renewal()]).handler });
    renderAt("/contracts/42/approvals");

    expect(await screen.findByRole("heading", { name: "Renewals" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Approvals", level: 3 })).toBeInTheDocument();
  });
});

describe("the Last renewal fact on the Contract card (G.R5)", () => {
  it("reads the newest confirmed roll out of the history", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow(), [
        renewal({ id: "log-2", confirmedAt: "2026-07-02T09:15:00.000Z" }),
        renewal({ id: "log-1", confirmedAt: "2025-07-03T09:15:00.000Z" }),
      ]).handler,
    });
    renderAt("/contracts/42");

    await screen.findByLabelText("Expiry date");
    expect(screen.getByText("Last renewal")).toBeInTheDocument();
    expect(screen.getByText("Jul 2")).toBeInTheDocument();
  });

  it("prints the record's standing em dash when nothing has renewed yet", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42");

    await screen.findByLabelText("Expiry date");
    const fact = screen.getByText("Last renewal").closest("div")!;
    expect(within(fact).getByText("—")).toBeInTheDocument();
  });

  it("takes the roll's own date the moment one is confirmed", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42");

    const fact = () => screen.getByText("Last renewal").closest("div")!;
    await screen.findByLabelText("Expiry date");
    expect(within(fact()).getByText("—")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Review renewal" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm renewal" }));

    // The stub answers the roll with the fixture's own timestamp.
    await waitFor(() => expect(within(fact()).getByText("Jul 2")).toBeInTheDocument());
  });
});
