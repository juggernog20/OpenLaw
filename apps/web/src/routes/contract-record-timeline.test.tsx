// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Term timeline card on the contract record (M16/2), through the
 * real route table with the standard fetch stub.
 *
 * The card holds no state of its own, so every test here is the same
 * shape: write dates on the row, read what the card draws. Nothing is
 * seeded, nothing is cached, and the one test that edits a field proves
 * it — the notice-deadline mark moves because the seam answered a new
 * deadline, not because anything on the page remembered the old one.
 *
 * The clock is frozen and the reader's timezone pinned to UTC, because
 * the today line is the one mark whose place is not a stored date. Both
 * come off the same seam the formatters read (DES-014), so a test that
 * pins them pins the picture.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";
import { pickDate } from "../testing/dates";

/** Frozen mid-day so no plausible display timezone moves the calendar
 * date the card calls today. */
const TODAY = "2026-08-17T12:00:00Z";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
  // Pins `configureFormatting`, so every date the card prints is the
  // same on a runner in Dubai as on one in UTC.
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
    termType: "fixed",
    effectiveDate: null,
    expiryDate: null,
    renewalPeriodMonths: null,
    noticePeriodDays: null,
    noticeDeadline: null,
    daysRemaining: null,
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

/** A whole civil date, shifted by days — the seam's notice-deadline
 * arithmetic, so the stub answers what the real one would. */
function minusDays(civil: string, days: number): string {
  const year = Number(civil.slice(0, 4));
  const month = Number(civil.slice(5, 7));
  const day = Number(civil.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
}

/**
 * The record loader's reads plus the per-field PATCH.
 *
 * The stub derives the notice deadline the way CTR-006 derives it —
 * expiry minus the notice period, at read — so a test that edits either
 * half sees the card follow the seam rather than follow itself.
 */
function recordApi(initial: Record<string, unknown> = contractRow()) {
  let row = initial;
  const patches: unknown[] = [];

  const derived = () => {
    const expiry = row.expiryDate as string | null;
    const notice = row.noticePeriodDays as number | null;
    return {
      ...row,
      noticeDeadline: expiry === null || notice === null ? null : minusDays(expiry, notice),
    };
  };
  const envelope = () => ({
    contract: derived(),
    fields: [],
    customFieldRefs: { users: [], entities: [] },
  });

  const handler = (call: StubCall) => {
    if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
      return json(200, OPTIONS);
    }
    if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
      return json(200, { entities: [] });
    }
    if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
      return json(200, {
        ...envelope(),
        team: [{ ...PEOPLE[0], role: "creator" }],
        counterparties: [],
        renewals: [],
      });
    }
    if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
      patches.push(call.body);
      row = { ...row, ...(call.body as Record<string, unknown>) };
      return json(200, envelope());
    }
    return undefined;
  };
  return { handler, patches };
}

/** The card, found by the heading that names it. */
async function timeline() {
  return within(await screen.findByRole("region", { name: "Term timeline" }));
}

/** The gutter — the card's readable half, one row per drawn period. */
function periodsOf(card: ReturnType<typeof within>) {
  return within(card.getByRole("list", { name: "Term periods" }));
}

/** The key under the plot, which names the fills the plot uses. */
function keyOf(card: ReturnType<typeof within>) {
  return within(card.getByRole("list", { name: "Timeline key" }));
}

describe("the Term timeline card", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(TODAY));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws a fixed term as one period, with its dates and the today line", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(
        contractRow({ effectiveDate: "2026-01-01", expiryDate: "2026-12-31", daysRemaining: 136 }),
      ).handler,
    });
    renderAt("/contracts/42");

    const card = await timeline();
    const periods = periodsOf(card);
    expect(periods.getAllByRole("listitem")).toHaveLength(1);
    expect(periods.getByText("Initial term")).toBeInTheDocument();
    expect(periods.getByText("Jan 1 – Dec 31")).toBeInTheDocument();
    expect(card.getByText("Today")).toBeInTheDocument();
    // One period means no roll, so the key names no renewals.
    expect(keyOf(card).queryByText("Renewals")).not.toBeInTheDocument();
  });

  it("places the today line by the dates it is drawn between", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(
        // Today is exactly halfway between these two.
        contractRow({ effectiveDate: "2026-08-07", expiryDate: "2026-08-27" }),
      ).handler,
    });
    renderAt("/contracts/42");

    const card = await timeline();
    const pill = card.getByText("Today").parentElement;
    expect(pill?.style.getPropertyValue("inset-inline-start")).toBe("50%");
  });

  it("draws an auto-renewing term as the periods its dates and renewal period imply", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(
        contractRow({
          termType: "auto_renew",
          effectiveDate: "2024-01-01",
          expiryDate: "2027-01-01",
          renewalPeriodMonths: 12,
        }),
      ).handler,
    });
    renderAt("/contracts/42");

    const card = await timeline();
    const periods = periodsOf(card);
    // Walked back from the expiry a renewal period at a time: what is
    // left in front of the first boundary is the initial term.
    expect(periods.getAllByRole("listitem")).toHaveLength(3);
    expect(periods.getByText("Jan 1, 2024 – Jan 1, 2025")).toBeInTheDocument();
    expect(periods.getByText("Renewal 1")).toBeInTheDocument();
    expect(periods.getByText("Jan 1, 2025 – Jan 1")).toBeInTheDocument();
    expect(periods.getByText("Renewal 2")).toBeInTheDocument();
    expect(periods.getByText("Jan 1 – Jan 1, 2027")).toBeInTheDocument();
    expect(periods.queryByText("Renewal 3")).not.toBeInTheDocument();
    // Rolls are drawn, so the key names them.
    expect(keyOf(card).getByText("Renewals")).toBeInTheDocument();
  });

  it("anchors every boundary on the expiry, so a month-end roll cannot drift", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(
        contractRow({
          termType: "auto_renew",
          effectiveDate: "2025-12-31",
          // A month-end date clamps on the way back — March's 31st is
          // February's 28th — and a boundary stepped from that clamp
          // would carry it into January.
          expiryDate: "2026-03-31",
          renewalPeriodMonths: 1,
        }),
      ).handler,
    });
    renderAt("/contracts/42");

    const periods = periodsOf(await timeline());
    expect(periods.getByText("Dec 31, 2025 – Jan 31")).toBeInTheDocument();
    expect(periods.getByText("Jan 31 – Feb 28")).toBeInTheDocument();
    expect(periods.getByText("Feb 28 – Mar 31")).toBeInTheDocument();
  });

  it("still draws a bar for a term that starts and ends on one day", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(
        contractRow({ effectiveDate: "2026-08-17", expiryDate: "2026-08-17", daysRemaining: 0 }),
      ).handler,
    });
    const { view } = renderAt("/contracts/42");

    expect(periodsOf(await timeline()).getByText("Aug 17 – Aug 17")).toBeInTheDocument();
    // Sized rather than pinned at both ends, so a period with no span
    // is still a bar a reader can see.
    const bar = view.container.querySelector<HTMLElement>("ul[aria-hidden] span[style]");
    expect(bar?.style.getPropertyValue("inline-size")).toContain("2px");
  });

  it("draws one period when an auto-renewing term has no renewal period yet", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(
        contractRow({
          termType: "auto_renew",
          effectiveDate: "2024-01-01",
          expiryDate: "2027-01-01",
        }),
      ).handler,
    });
    renderAt("/contracts/42");

    const periods = periodsOf(await timeline());
    expect(periods.getAllByRole("listitem")).toHaveLength(1);
    expect(periods.getByText("Jan 1, 2024 – Jan 1, 2027")).toBeInTheDocument();
  });

  it("draws the derived notice deadline, and no renewal cap anywhere", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(
        contractRow({
          termType: "auto_renew",
          effectiveDate: "2026-01-01",
          expiryDate: "2026-12-31",
          renewalPeriodMonths: 12,
          noticePeriodDays: 30,
        }),
      ).handler,
    });
    renderAt("/contracts/42");

    const card = await timeline();
    expect(keyOf(card).getByText("Notice deadline")).toBeInTheDocument();
    expect(card.getByText("Notice deadline Dec 1")).toBeInTheDocument();
    // No such column exists, so no such mark is drawn (G.R6, I.B7).
    expect(screen.queryByText(/renewal cap/i)).not.toBeInTheDocument();
  });

  it("moves the notice-deadline mark when the notice period is edited", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = recordApi(
      contractRow({ effectiveDate: "2026-01-01", expiryDate: "2026-12-31", noticePeriodDays: 30 }),
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    const before = await timeline();
    const wasAt = before
      .getByText("Notice deadline Dec 1")
      .closest<HTMLElement>("span[style]")
      ?.style.getPropertyValue("inset-inline-start");
    expect(wasAt).toBeTruthy();

    const notice = screen.getByLabelText("Notice period (days)");
    await user.clear(notice);
    await user.type(notice, "90");
    await user.click(screen.getByLabelText("Title"));

    await waitFor(() => expect(api.patches).toEqual([{ noticePeriodDays: 90 }]));
    const after = await timeline();
    expect(after.getByText("Notice deadline Oct 2")).toBeInTheDocument();
    expect(after.queryByText("Notice deadline Dec 1")).not.toBeInTheDocument();
    // The mark moved because the date did, and nothing on the page kept
    // the old one to move.
    const isAt = after
      .getByText("Notice deadline Oct 2")
      .closest<HTMLElement>("span[style]")
      ?.style.getPropertyValue("inset-inline-start");
    expect(isAt).not.toBe(wasAt);
  });

  it("moves the notice-deadline mark when the expiry is edited", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = recordApi(
      contractRow({ effectiveDate: "2026-01-01", expiryDate: "2026-12-31", noticePeriodDays: 30 }),
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    expect((await timeline()).getByText("Notice deadline Dec 1")).toBeInTheDocument();

    await pickDate(user, "Expiry date", "2026-11-30");

    await waitFor(() => expect(api.patches).toEqual([{ expiryDate: "2026-11-30" }]));
    const after = await timeline();
    expect(after.getByText("Notice deadline Oct 31")).toBeInTheDocument();
    expect(periodsOf(after).getByText("Jan 1 – Nov 30")).toBeInTheDocument();
  });

  it("draws an evergreen term open-ended, with no end it does not hold", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ termType: "evergreen", effectiveDate: "2025-06-01" })).handler,
    });
    renderAt("/contracts/42");

    const card = await timeline();
    expect(periodsOf(card).getByText("From Jun 1, 2025")).toBeInTheDocument();
    expect(card.getByText("No end date")).toBeInTheDocument();
    // An open term has no deadline to derive and no roll to draw.
    expect(keyOf(card).queryByText("Notice deadline")).not.toBeInTheDocument();
    expect(keyOf(card).queryByText("Renewals")).not.toBeInTheDocument();
  });

  it("draws the empty line, not a chart, when the term has no dates", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42");

    const card = await timeline();
    expect(card.getByText("No term dates on this contract yet.")).toBeInTheDocument();
    expect(card.queryByRole("list", { name: "Term periods" })).not.toBeInTheDocument();
    expect(card.queryByText("Today")).not.toBeInTheDocument();
  });

  it("names the date it is missing when only one end is set", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ effectiveDate: "2026-01-01" })).handler,
    });
    renderAt("/contracts/42");

    const card = await timeline();
    expect(card.getByText("No expiry date on this contract yet.")).toBeInTheDocument();
  });

  it("names the missing effective date on an evergreen contract", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow({ termType: "evergreen" })).handler });
    renderAt("/contracts/42");

    const card = await timeline();
    expect(card.getByText("No effective date on this contract yet.")).toBeInTheDocument();
  });

  it("keeps drawing today when the term has already run out", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(
        contractRow({
          effectiveDate: "2024-01-01",
          expiryDate: "2025-01-01",
          daysRemaining: -593,
        }),
      ).handler,
    });
    renderAt("/contracts/42");

    const card = await timeline();
    // The scale widens to hold today rather than clipping it off the
    // end, so the reader can see how far past the term they are.
    const pill = card.getByText("Today").parentElement;
    expect(pill?.style.getPropertyValue("inset-inline-start")).toBe("100%");
    expect(card.getByText("Aug 17")).toBeInTheDocument();
  });
});
