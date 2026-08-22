// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record's Approvals section (M14/3, CTR-012) at
 * `/contracts/42/approvals`, through the real route table with the
 * standard fetch stub.
 *
 * What the roster draws: one row per ask, with the decision pill, the
 * approver's note, who asked, and when it landed. What it offers: the
 * "Add approver" dialog that asks several people at once, the named
 * approver's own approve and reject with an optional note, and the
 * cancel the requester, the Owner, and an Administrator get.
 *
 * What it must not offer is asserted just as hard. A person somebody
 * else was asked to decide for gets no menu; a person with a pending
 * ask already is not in the picker; a read-only viewer gets no control
 * at all; and on a confidential record the picker offers the audience
 * and nobody else.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Ada Admin",
  role: "administrator",
};
const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};
const APPROVER = {
  id: "u4",
  email: "approver@example.com",
  displayName: "Sarah Chen",
  role: "legal_team_member",
};
const CONTRIBUTOR = {
  id: "u3",
  email: "contributor@example.com",
  displayName: "Casey Contributor",
  role: "contributor",
};

/** The people the record's pickers read. A Contributor is offered for
 * the team, and never as an approver (CTR-012, DD-013). */
const PEOPLE = [
  { id: "u1", displayName: "Ada Admin", image: null, archived: false, role: "administrator" },
  { id: "u3", displayName: "Casey Contributor", image: null, archived: false, role: "contributor" },
  {
    id: "u2",
    displayName: "Nadia Counsel",
    image: null,
    archived: false,
    role: "legal_team_member",
  },
  { id: "u4", displayName: "Sarah Chen", image: null, archived: false, role: "legal_team_member" },
];

/** The live approver-group templates the apply picker offers (CTR-012).
 * "Commercial sign-off" holds two people; "Empty template" holds none,
 * which is a group the seam refuses rather than one the picker hides. */
const GROUPS = [
  { id: "g1", name: "Commercial sign-off", memberIds: ["u4", "u1"] },
  { id: "g2", name: "Empty template", memberIds: [] },
];

const OPTIONS = {
  contractTypes: [{ id: "t-msa", slug: "msa", displayName: "MSA", fields: [] }],
  contractStatuses: [{ id: "s-draft", slug: "draft", displayName: "Draft", stage: "draft" }],
  users: PEOPLE,
  approverGroups: GROUPS,
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
    // CTR-006's term: `fixed` is where every contract starts, and
    // nothing else about the term is recorded yet.
    termType: "fixed",
    effectiveDate: null,
    expiryDate: null,
    renewalPeriodMonths: null,
    noticePeriodDays: null,
    // Derived at read and stored nowhere — both blank while there is no
    // expiry to subtract from.
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

const named = (id: string) => {
  const found = PEOPLE.find((entry) => entry.id === id)!;
  return { id: found.id, displayName: found.displayName, image: null };
};

function approval(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    approver: named("u4"),
    requestedBy: named("u2"),
    source: "manual",
    groupName: null,
    status: "pending",
    note: null,
    requestedAt: "2026-08-10T00:00:00.000Z",
    decidedAt: null,
    ...overrides,
  };
}

/**
 * The record loader's reads plus the approvals routes under test. The
 * roster is stateful: a write answers the roster it produces, and a
 * later read answers the latest one.
 */
function recordApi(
  initialApprovals: Record<string, unknown>[] = [],
  row: Record<string, unknown> = contractRow(),
  team: Record<string, unknown>[] = [{ ...named("u2"), archived: false, role: "creator" }],
  groups: { id: string; name: string; memberIds: string[] }[] = GROUPS,
) {
  let approvals = initialApprovals;
  const writes: { method: string; path: string; body: unknown }[] = [];
  let refuse: { status: number; detail: string } | null = null;

  const envelope = () => json(200, { approvals });

  const handler = (call: StubCall) => {
    if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
      return json(200, { ...OPTIONS, approverGroups: groups });
    }
    if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
      return json(200, { entities: [] });
    }
    if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
      return json(200, {
        contract: row,
        fields: [],
        customFieldRefs: { users: [], entities: [] },
        team,
        counterparties: [],
        renewals: [],
      });
    }
    if (call.url.pathname === "/api/v1/contracts/42/approvals" && call.method === "GET") {
      return envelope();
    }
    if (call.url.pathname === "/api/v1/contracts/42/approvals" && call.method === "POST") {
      writes.push({ method: "POST", path: call.url.pathname, body: call.body });
      if (refuse) return problem(refuse.status, refuse.detail);
      const body = call.body as { approverIds: string[] };
      approvals = [
        ...approvals,
        ...body.approverIds.map((id, index) =>
          approval({ id: `new-${index}`, approver: named(id), requestedBy: named("u2") }),
        ),
      ];
      return json(201, { approvals });
    }
    if (call.url.pathname === "/api/v1/contracts/42/approvals/group" && call.method === "POST") {
      writes.push({ method: "POST", path: call.url.pathname, body: call.body });
      if (refuse) return problem(refuse.status, refuse.detail);
      // The seam's own two filters, so what the stub answers is what
      // the section would really be given back: the group's members,
      // minus anybody who already holds a pending request.
      const body = call.body as { groupId: string };
      const group = groups.find((entry) => entry.id === body.groupId)!;
      const pending = new Set(
        approvals.filter((entry) => entry.status === "pending").map((entry) => entry.approver),
      );
      const asked = group.memberIds.filter(
        (id) => ![...pending].some((person) => (person as { id: string }).id === id),
      );
      approvals = [
        ...approvals,
        ...asked.map((id, index) =>
          approval({
            id: `grp-${index}`,
            approver: named(id),
            requestedBy: named("u2"),
            source: "group",
            groupName: group.name,
          }),
        ),
      ];
      return json(201, { approvals });
    }
    const decision = /^\/api\/v1\/approvals\/([^/]+)\/decision$/.exec(call.url.pathname);
    if (decision && call.method === "POST") {
      writes.push({ method: "POST", path: call.url.pathname, body: call.body });
      if (refuse) return problem(refuse.status, refuse.detail);
      const body = call.body as { decision: string; note?: string };
      approvals = approvals.map((row) =>
        row.id === decision[1]
          ? {
              ...row,
              status: body.decision,
              note: body.note ?? null,
              decidedAt: "2026-08-12T00:00:00.000Z",
            }
          : row,
      );
      return envelope();
    }
    const cancelled = /^\/api\/v1\/approvals\/([^/]+)$/.exec(call.url.pathname);
    if (cancelled && call.method === "DELETE") {
      writes.push({ method: "DELETE", path: call.url.pathname, body: null });
      if (refuse) return problem(refuse.status, refuse.detail);
      approvals = approvals.filter((row) => row.id !== cancelled[1]);
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

async function rosterRows() {
  const table = await screen.findByRole("table");
  return within(table).getAllByRole("row").slice(1);
}

describe("the contract record's Approvals section", () => {
  it("draws the roster with a pill, the note, who asked, and when", async () => {
    const api = recordApi([
      approval({
        id: "a1",
        status: "approved",
        note: "Clear on commercials.",
        decidedAt: "2026-08-04T00:00:00.000Z",
      }),
      approval({ id: "a2", approver: named("u1"), status: "pending" }),
    ]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const rows = await rosterRows();
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Sarah Chen")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Approved")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Clear on commercials.")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Requested by Nadia Counsel")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Added manually")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Aug 4")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Pending")).toBeInTheDocument();
    // The header tally leaves the zero out rather than printing it.
    expect(screen.getByText("1 approved")).toBeInTheDocument();
    expect(screen.getByText("1 pending")).toBeInTheDocument();
    expect(screen.queryByText(/rejected/)).not.toBeInTheDocument();
  });

  it("counts only open approvals on the tab chip", async () => {
    // Two asks on the roster, one of them settled. The chip is a
    // standing count of what is still owed, so it says one.
    const api = recordApi([
      approval({ id: "a1", status: "approved" }),
      approval({ id: "a2", approver: named("u1"), status: "pending" }),
    ]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const strip = within(await screen.findByRole("navigation", { name: "Contract sections" }));
    expect(await strip.findByRole("img", { name: "1 open approval" })).toBeInTheDocument();
  });

  it("says so plainly when nobody has been asked", async () => {
    const api = recordApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    expect(
      await screen.findByText("No approvals requested on this contract yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("asks two people at once, in one request", async () => {
    const user = userEvent.setup();
    const api = recordApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Add approver" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: "Sarah Chen" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Ada Admin" }));
    await user.click(within(dialog).getByRole("button", { name: "Request approvals" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/contracts/42/approvals",
      body: { approverIds: ["u4", "u1"] },
    });
    // The roster the write answered with is what the section now draws.
    await waitFor(async () => expect(await rosterRows()).toHaveLength(2));
  });

  it("offers no Contributor and nobody who already has a pending ask", async () => {
    const user = userEvent.setup();
    const api = recordApi([approval({ id: "a1", approver: named("u4"), status: "pending" })]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Add approver" }));
    const dialog = await screen.findByRole("dialog");
    // A Contributor never approves anything (DD-013).
    expect(
      within(dialog).queryByRole("checkbox", { name: "Casey Contributor" }),
    ).not.toBeInTheDocument();
    // And a second pending ask at one person is refused at the seam, so
    // the picker does not offer it.
    expect(within(dialog).queryByRole("checkbox", { name: "Sarah Chen" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Ada Admin" })).toBeInTheDocument();
  });

  it("offers only the audience of a confidential record", async () => {
    const user = userEvent.setup();
    const api = recordApi([], contractRow({ isConfidential: true }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Add approver" }));
    const dialog = await screen.findByRole("dialog");
    // An Administrator reaches every record, and the creator holds a
    // team row. Sarah Chen holds neither and is not the Owner.
    expect(within(dialog).getByRole("checkbox", { name: "Ada Admin" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Nadia Counsel" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: "Sarah Chen" })).not.toBeInTheDocument();
  });

  it("lets the named approver approve with a note, and offers nobody else the decision", async () => {
    const user = userEvent.setup();
    const api = recordApi([approval({ id: "a1", approver: named("u4") })]);
    stubApi({ signedIn: APPROVER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Actions for Sarah Chen" }));
    await user.click(await screen.findByRole("menuitem", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Note (optional)"), "Fine by me.");
    await user.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      path: "/api/v1/approvals/a1/decision",
      body: { decision: "approved", note: "Fine by me." },
    });
    expect(await screen.findByText("Approved")).toBeInTheDocument();
  });

  it("takes a rejection with no note", async () => {
    const user = userEvent.setup();
    const api = recordApi([approval({ id: "a1", approver: named("u4") })]);
    stubApi({ signedIn: APPROVER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Actions for Sarah Chen" }));
    await user.click(await screen.findByRole("menuitem", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.body).toEqual({ decision: "rejected" });
    expect(await screen.findByText("Rejected")).toBeInTheDocument();
  });

  it("gives the requester a cancel and the approver's own decision to nobody else", async () => {
    const user = userEvent.setup();
    const api = recordApi([
      approval({ id: "a1", approver: named("u4"), requestedBy: named("u2") }),
    ]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Actions for Sarah Chen" }));
    // The requester may withdraw the ask and may not answer it.
    expect(await screen.findByRole("menuitem", { name: "Cancel request" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reject" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Cancel request" }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({ method: "DELETE", path: "/api/v1/approvals/a1" });
    expect(
      await screen.findByText("No approvals requested on this contract yet."),
    ).toBeInTheDocument();
  });

  it("offers a bystander no menu at all", async () => {
    const api = recordApi([
      approval({ id: "a1", approver: named("u1"), requestedBy: named("u1") }),
    ]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await rosterRows();
    expect(screen.queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it("offers an Administrator the cancel on somebody else's ask", async () => {
    const api = recordApi([
      approval({ id: "a1", approver: named("u4"), requestedBy: named("u2") }),
    ]);
    stubApi({ signedIn: ADMIN, extra: api.handler });
    renderAt("/contracts/42/approvals");

    expect(
      await screen.findByRole("button", { name: "Actions for Sarah Chen" }),
    ).toBeInTheDocument();
  });

  it("offers no menu on a decided row", async () => {
    const api = recordApi([
      approval({
        id: "a1",
        approver: named("u4"),
        status: "approved",
        decidedAt: "2026-08-04T00:00:00.000Z",
      }),
    ]);
    stubApi({ signedIn: APPROVER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await rosterRows();
    expect(screen.queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it("shows the seam's refusal in the dialog that raised the write, once", async () => {
    const user = userEvent.setup();
    const api = recordApi([]);
    api.refuseNext(422, "Casey Contributor can't see this contract, so they can't be asked.");
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Add approver" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: "Sarah Chen" }));
    await user.click(within(dialog).getByRole("button", { name: "Request approvals" }));

    // The dialog stays open on a refusal, so the pick is not lost, and
    // the sentence is printed there and nowhere else.
    const open = await screen.findByRole("dialog");
    expect(
      await within(open).findByText(
        "Casey Contributor can't see this contract, so they can't be asked.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Casey Contributor can't see this contract, so they can't be asked."),
    ).toHaveLength(1);
  });

  it("draws the roster read-only for a Contributor and for an archived record", async () => {
    const contributorApi = recordApi(
      [approval({ id: "a1", approver: named("u4") })],
      contractRow(),
      [{ ...named("u3"), archived: false, role: "contributor" }],
    );
    stubApi({ signedIn: CONTRIBUTOR, extra: contributorApi.handler });
    const contributorView = renderAt("/contracts/42/approvals");
    await rosterRows();
    expect(screen.queryByRole("button", { name: "Add approver" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Actions for/ })).not.toBeInTheDocument();
    contributorView.view.unmount();

    const archivedApi = recordApi(
      [approval({ id: "a1", approver: named("u4") })],
      contractRow({ archivedAt: "2026-08-11T00:00:00.000Z" }),
    );
    stubApi({ signedIn: MEMBER, extra: archivedApi.handler });
    renderAt("/contracts/42/approvals");
    await rosterRows();
    expect(screen.queryByRole("button", { name: "Add approver" })).not.toBeInTheDocument();
  });

  it("applies a group, and says who it will ask before it asks them", async () => {
    const user = userEvent.setup();
    const api = recordApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Apply group" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(
      within(dialog).getByLabelText("Approver group"),
      "Commercial sign-off",
    );
    // The set is named before it becomes requests.
    expect(within(dialog).getByText("Asks Sarah Chen and Ada Admin.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Apply group" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/contracts/42/approvals/group",
      body: { groupId: "g1" },
    });
    // The roster the apply answered with is what the section now draws,
    // and the Source cell names the template each row came from.
    const rows = await waitFor(async () => {
      const drawn = await rosterRows();
      expect(drawn).toHaveLength(2);
      return drawn;
    });
    expect(within(rows[0]!).getByText("Commercial sign-off")).toBeInTheDocument();
  });

  it("counts the members it would skip, and leaves them out of the ask", async () => {
    const user = userEvent.setup();
    const api = recordApi([approval({ id: "a1", approver: named("u4"), status: "pending" })]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Apply group" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(
      within(dialog).getByLabelText("Approver group"),
      "Commercial sign-off",
    );
    expect(within(dialog).getByText("Asks Ada Admin.")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Skips 1 person who already has a request open."),
    ).toBeInTheDocument();
  });

  it("says a group has nobody to ask, and prints the seam's refusal once", async () => {
    const user = userEvent.setup();
    const api = recordApi([]);
    api.refuseNext(422, "Empty template has no members to ask.");
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Apply group" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Approver group"), "Empty template");
    expect(within(dialog).getByText("This group has nobody to ask.")).toBeInTheDocument();

    // Whether an apply is a no-op is the seam's call, so the press is
    // carried and its sentence is what the dialog prints.
    await user.click(within(dialog).getByRole("button", { name: "Apply group" }));
    const open = await screen.findByRole("dialog");
    expect(
      await within(open).findByText("Empty template has no members to ask."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Empty template has no members to ask.")).toHaveLength(1);
  });

  it("refuses to apply nothing", async () => {
    const user = userEvent.setup();
    const api = recordApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Apply group" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Apply group" }));

    expect(await within(dialog).findByText("Pick an approver group.")).toBeInTheDocument();
    expect(api.writes).toHaveLength(0);
  });

  it("draws no apply control when no group is set up, and none for a read-only viewer", async () => {
    const bare = recordApi([], contractRow(), undefined, []);
    stubApi({ signedIn: MEMBER, extra: bare.handler });
    const bareView = renderAt("/contracts/42/approvals");
    await screen.findByRole("button", { name: "Add approver" });
    expect(screen.queryByRole("button", { name: "Apply group" })).not.toBeInTheDocument();
    bareView.view.unmount();

    const readOnly = recordApi([approval({ id: "a1", approver: named("u4") })], contractRow(), [
      { ...named("u3"), archived: false, role: "contributor" },
    ]);
    stubApi({ signedIn: CONTRIBUTOR, extra: readOnly.handler });
    renderAt("/contracts/42/approvals");
    await rosterRows();
    expect(screen.queryByRole("button", { name: "Apply group" })).not.toBeInTheDocument();
  });

  it("reaches the section from the record's own tab strip", async () => {
    const user = userEvent.setup();
    const api = recordApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/contracts/42");

    await user.click(await screen.findByRole("link", { name: "Approvals" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/contracts/42/approvals"));
    expect(
      await screen.findByText("No approvals requested on this contract yet."),
    ).toBeInTheDocument();
  });
});
