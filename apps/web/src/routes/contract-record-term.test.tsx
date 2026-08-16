// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-006's term on the contract record (M16/1), through the real route
 * table with the standard fetch stub.
 *
 * Five fields, and the DES-017 rule with no carve-out: the term type is
 * a select that commits on its own change, and the two dates and two
 * counts commit on blur or Enter and revert on Escape. Each sends one
 * PATCH carrying one field.
 *
 * The rule between them is drawn rather than argued: an evergreen
 * contract is offered no expiry and anything but an auto-renewing one
 * is offered no renewal period, because a box the seam would refuse
 * everything typed into is a dead end. What stands in its place is the
 * em dash — the honest blank, which says the record holds nothing
 * there.
 *
 * Days remaining is the record's, not this page's: it is derived at the
 * seam and drawn here, so these tests hand it over in the row rather
 * than count anything. The record must never work it out itself — a
 * second copy of the rule would drift the first time either moved.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
    // CTR-006's term, unrecorded but for the type every contract starts
    // on.
    termType: "fixed",
    effectiveDate: null,
    expiryDate: null,
    renewalPeriodMonths: null,
    noticePeriodDays: null,
    noticeDeadline: null,
    daysRemaining: null,
    description: null,
    customFields: {},
    isConfidential: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * The record loader's reads plus the per-field PATCH.
 *
 * The stub applies the term rule the seam applies, because the record
 * has to be seen adopting the answer rather than predicting it: a
 * commit that turns a contract evergreen comes back with the expiry
 * already cleared, and the card's boxes have to follow.
 */
function recordApi(
  initial: Record<string, unknown> = contractRow(),
  refusal: { status: number; detail: string } | null = null,
) {
  let row = initial;
  const patches: unknown[] = [];

  const envelope = () => ({
    contract: row,
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
      });
    }
    if (call.url.pathname === "/api/v1/contracts/42/approvals" && call.method === "GET") {
      return json(200, { approvals: [] });
    }
    if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
      patches.push(call.body);
      if (refusal) return problem(refusal.status, refusal.detail);
      const body = call.body as Record<string, unknown>;
      row = { ...row, ...body };
      // CTR-006's clearing rule, as the seam answers it.
      if (body.termType === "evergreen") row = { ...row, expiryDate: null };
      if (body.termType !== undefined && body.termType !== "auto_renew") {
        row = { ...row, renewalPeriodMonths: null };
      }
      return json(200, envelope());
    }
    return undefined;
  };
  return { handler, patches };
}

describe("the term on the contract record", () => {
  it("draws the five term fields and the derived count", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(
        contractRow({
          termType: "auto_renew",
          effectiveDate: "2026-01-01",
          expiryDate: "2026-12-31",
          renewalPeriodMonths: 12,
          noticePeriodDays: 90,
          noticeDeadline: "2026-10-02",
          daysRemaining: 45,
        }),
      ).handler,
    });
    renderAt("/contracts/42");

    expect(await screen.findByLabelText("Term type")).toHaveValue("auto_renew");
    expect(screen.getByLabelText("Effective date")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("Expiry date")).toHaveValue("2026-12-31");
    expect(screen.getByLabelText("Renewal period (months)")).toHaveValue(12);
    expect(screen.getByLabelText("Notice period (days)")).toHaveValue(90);
    // Derived at the seam and drawn here — never counted on this page.
    expect(screen.getByText("45 days left")).toBeInTheDocument();
  });

  it("commits each typed term field on blur, one field per write", async () => {
    const user = userEvent.setup();
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    await user.type(await screen.findByLabelText("Effective date"), "2026-03-01");
    await user.click(screen.getByLabelText("Title"));
    await waitFor(() => expect(api.patches).toEqual([{ effectiveDate: "2026-03-01" }]));

    await user.type(screen.getByLabelText("Notice period (days)"), "60");
    await user.click(screen.getByLabelText("Title"));
    await waitFor(() =>
      expect(api.patches).toEqual([{ effectiveDate: "2026-03-01" }, { noticePeriodDays: 60 }]),
    );
  });

  it("keeps a sibling box's draft when a term commit lands beside it", async () => {
    const user = userEvent.setup();
    // The PATCH's answer is held until the test releases it, so the
    // sibling's typing deterministically happens while the commit is in
    // flight — the race a fast round-trip only sometimes opens.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = recordApi();
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.method === "PATCH"
          ? gate.then(() => api.handler(call) as Response)
          : api.handler(call),
    });
    renderAt("/contracts/42");

    // Blurring the effective date into the notice box starts its
    // commit; the notice period is typed before the answer lands.
    await user.type(await screen.findByLabelText("Effective date"), "2026-03-01");
    const notice = screen.getByLabelText("Notice period (days)");
    await user.click(notice);
    await user.type(notice, "60");
    release();

    // The answer re-seeds only the box it committed: the sibling's
    // in-progress draft is not this commit's to discard.
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(notice).toHaveValue(60);
    expect(api.patches).toEqual([{ effectiveDate: "2026-03-01" }]);
  });

  it("commits the term type on the select's own change", async () => {
    const user = userEvent.setup();
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    await user.selectOptions(await screen.findByLabelText("Term type"), "auto_renew");

    await waitFor(() => expect(api.patches).toEqual([{ termType: "auto_renew" }]));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("reverts a term field on Escape and commits nothing", async () => {
    const user = userEvent.setup();
    const api = recordApi(contractRow({ noticePeriodDays: 30 }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    const notice = await screen.findByLabelText("Notice period (days)");
    await user.clear(notice);
    await user.type(notice, "45{Escape}");

    expect(notice).toHaveValue(30);
    await user.click(screen.getByLabelText("Title"));
    expect(api.patches).toEqual([]);
  });

  it("clears a term field back to nothing recorded", async () => {
    const user = userEvent.setup();
    const api = recordApi(contractRow({ expiryDate: "2027-01-31" }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    await user.clear(await screen.findByLabelText("Expiry date"));
    await user.click(screen.getByLabelText("Title"));

    await waitFor(() => expect(api.patches).toEqual([{ expiryDate: null }]));
  });

  it("offers an evergreen contract no expiry, and prints the blank instead", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ termType: "evergreen", noticePeriodDays: 60 })).handler,
    });
    renderAt("/contracts/42");

    expect(await screen.findByLabelText("Term type")).toHaveValue("evergreen");
    expect(screen.queryByLabelText("Expiry date")).not.toBeInTheDocument();
    // A notice obligation sits on any kind of term, so this one stays.
    expect(screen.getByLabelText("Notice period (days)")).toHaveValue(60);
    // Expiry, renewal period, and the countdown are all absences, and
    // all three say so the same way.
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  it("asks only an auto-renewing contract how far a roll goes", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow({ termType: "fixed" })).handler });
    renderAt("/contracts/42");

    expect(await screen.findByLabelText("Expiry date")).toBeInTheDocument();
    expect(screen.queryByLabelText("Renewal period (months)")).not.toBeInTheDocument();
  });

  it("adopts the clears the seam makes when the term type changes", async () => {
    const user = userEvent.setup();
    const api = recordApi(
      contractRow({ expiryDate: "2027-06-30", daysRemaining: 300, noticePeriodDays: 30 }),
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    expect(await screen.findByLabelText("Expiry date")).toHaveValue("2027-06-30");
    await user.selectOptions(screen.getByLabelText("Term type"), "evergreen");

    // The expiry box is gone with the expiry, because the record now
    // holds neither.
    await waitFor(() => expect(screen.queryByLabelText("Expiry date")).not.toBeInTheDocument());
    expect(api.patches).toEqual([{ termType: "evergreen" }]);
  });

  it("says how the countdown stands on either side of the expiry", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow({ daysRemaining: 0 })).handler });
    renderAt("/contracts/42");
    expect(await screen.findByText("Expires today")).toBeInTheDocument();
  });

  it("counts a term that has run out the other way", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow({ daysRemaining: -10 })).handler });
    renderAt("/contracts/42");
    expect(await screen.findByText("10 days past expiry")).toBeInTheDocument();
  });

  it("prints the seam's refusal beside the field it refused", async () => {
    const user = userEvent.setup();
    const api = recordApi(contractRow(), {
      status: 400,
      detail: "An evergreen contract has no expiry date.",
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    const expiry = await screen.findByLabelText("Expiry date");
    await user.type(expiry, "2027-01-01");
    await user.click(screen.getByLabelText("Title"));

    expect(
      await screen.findByText("An evergreen contract has no expiry date."),
    ).toBeInTheDocument();

    // Reverting takes the refusal with the draft it was about: a
    // refusal standing under a saved value would be a lie.
    await user.type(expiry, "{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByText("An evergreen contract has no expiry date."),
      ).not.toBeInTheDocument(),
    );
  });

  it("says so and keeps the draft when a count is not a whole number", async () => {
    const user = userEvent.setup();
    const api = recordApi(contractRow({ noticePeriodDays: 30 }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    const notice = await screen.findByLabelText("Notice period (days)");
    await user.clear(notice);
    await user.type(notice, "1.5");
    await user.click(screen.getByLabelText("Title"));

    // Nothing is sent, and the typo stays where its author can fix it.
    expect(api.patches).toEqual([]);
    expect(await screen.findByText("Enter this as a number.")).toBeInTheDocument();
    expect(notice).toHaveValue(1.5);
  });

  it("gives a Contributor the term as facts", async () => {
    stubApi({
      signedIn: CONTRIBUTOR,
      extra: recordApi(contractRow({ termType: "auto_renew", renewalPeriodMonths: 12 })).handler,
    });
    renderAt("/contracts/42");

    expect(await screen.findByLabelText("Term type")).toBeDisabled();
    expect(screen.getByLabelText("Effective date")).toBeDisabled();
    expect(screen.getByLabelText("Expiry date")).toBeDisabled();
    expect(screen.getByLabelText("Renewal period (months)")).toBeDisabled();
    expect(screen.getByLabelText("Notice period (days)")).toBeDisabled();
  });
});
