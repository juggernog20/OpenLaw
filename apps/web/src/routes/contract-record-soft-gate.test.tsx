// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CTR-012's soft gate on the contract record (#235), through the real
 * route table with the standard fetch stub.
 *
 * The gate is the seam's, and these tests hold the record to that. The
 * status select commits like any other select; a refusal carrying the
 * gate's own RFC 9457 problem type is the only thing that raises the
 * dialog, and the confirm re-sends the same commit with the override
 * flag on it. Nothing here works out whether the move crosses the
 * approval stage — that would be a second copy of the rule.
 *
 * What is asserted: the dialog names the unresolved approvals and says
 * what each of them answered; nothing commits until it is confirmed;
 * the confirm sends `overrideSoftGate`; and dismissing it sends
 * nothing. A refusal that is not the gate's stays where every other
 * refusal reads — under the field — and raises no dialog.
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

const PEOPLE = [
  {
    id: "u2",
    displayName: "Nadia Counsel",
    image: null,
    archived: false,
    role: "legal_team_member",
  },
  { id: "u4", displayName: "Sarah Chen", image: null, archived: false, role: "legal_team_member" },
  { id: "u5", displayName: "Marcus Webb", image: null, archived: false, role: "legal_team_member" },
];

/** One status per stage the tests move between (CTR-001). */
const STATUSES = [
  {
    id: "s-approval",
    slug: "awaiting-approval",
    displayName: "Awaiting approval",
    stage: "approval",
  },
  {
    id: "s-signature",
    slug: "out-for-signature",
    displayName: "Out for signature",
    stage: "signature",
  },
  { id: "s-review", slug: "internal-review", displayName: "Internal review", stage: "review" },
];

const OPTIONS = {
  contractTypes: [{ id: "t-msa", slug: "msa", displayName: "MSA", fields: [] }],
  contractStatuses: STATUSES,
  users: PEOPLE,
  approverGroups: [],
};

/** The problem type the gate's refusal carries. */
const GATE_TYPE = "urn:openlaw:problem:approval-soft-gate";

function contractRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    number: 42,
    title: "Acme master services agreement",
    contractTypeId: "t-msa",
    contractTypeName: "MSA",
    statusId: "s-approval",
    statusName: "Awaiting approval",
    stage: "approval",
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

/** One approval row, as the API answers it. */
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
 * The record loader's reads plus the per-field PATCH.
 *
 * `refuseStatus` is what the seam answers the next status commit with.
 * The gate's own refusal is the two-step shape: refuse the bare commit,
 * and let the same commit through when it carries `overrideSoftGate`.
 */
function recordApi(
  approvals: Record<string, unknown>[],
  refuseStatus: { status: number; detail: string; type?: string } | null = null,
) {
  let row = contractRow();
  const patches: unknown[] = [];

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
        team: [{ ...named("u2"), archived: false, role: "creator" }],
        counterparties: [],
        renewals: [],
      });
    }
    if (call.url.pathname === "/api/v1/contracts/42/approvals" && call.method === "GET") {
      return json(200, { approvals });
    }
    if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
      patches.push(call.body);
      const body = call.body as { statusId?: string; overrideSoftGate?: boolean };
      if (refuseStatus && body.statusId && !body.overrideSoftGate) {
        return problem(refuseStatus.status, refuseStatus.detail, refuseStatus.type);
      }
      const status = STATUSES.find((entry) => entry.id === body.statusId);
      if (status) {
        row = contractRow({
          statusId: status.id,
          statusName: status.displayName,
          stage: status.stage,
        });
      }
      return json(200, {
        contract: row,
        fields: [],
        customFieldRefs: { users: [], entities: [] },
      });
    }
    return undefined;
  };
  return { handler, patches };
}

/** The two unresolved asks every gate test starts from: one waiting,
 * one who said no and was never asked again (CTR-012). */
const UNRESOLVED = [
  approval({ id: "a1", approver: named("u4"), status: "pending" }),
  approval({
    id: "a2",
    approver: named("u5"),
    status: "rejected",
    note: "Budget is not agreed.",
    decidedAt: "2026-08-11T00:00:00.000Z",
  }),
];

/** The gate's refusal, as the seam gives it. */
const GATE_REFUSAL = {
  status: 409,
  detail:
    "This contract has unresolved approvals: Sarah Chen (pending) and Marcus Webb (rejected). " +
    "Confirm the move to record it as an override.",
  type: GATE_TYPE,
};

/** Picks a status. It does not wait for the commit the pick sends —
 * each test waits for whatever that commit produces. */
async function pickStatus(user: ReturnType<typeof userEvent.setup>, statusId: string) {
  await user.selectOptions(await screen.findByLabelText("Status"), statusId);
}

describe("the soft gate on the contract record", () => {
  it("raises the dialog on the gate's refusal, naming each unresolved approval", async () => {
    const user = userEvent.setup();
    const api = recordApi(UNRESOLVED, GATE_REFUSAL);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    await pickStatus(user, "s-signature");

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Move past approval")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "2 approvals on this contract are unresolved. Moving to Out for signature goes past sign-off.",
      ),
    ).toBeInTheDocument();
    // Every unresolved ask by name, with what its approver answered —
    // a rejection nobody re-requested counts exactly as a pending one.
    expect(within(dialog).getByText("Sarah Chen")).toBeInTheDocument();
    expect(within(dialog).getByText("Pending")).toBeInTheDocument();
    expect(within(dialog).getByText("Marcus Webb")).toBeInTheDocument();
    expect(within(dialog).getByText("Rejected")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "This is allowed. It is recorded on the record's activity as an override.",
      ),
    ).toBeInTheDocument();

    // One commit was tried, and it carried no override.
    expect(api.patches).toEqual([{ statusId: "s-signature" }]);
  });

  it("leaves the approvals an approval answered out of the dialog", async () => {
    const user = userEvent.setup();
    const api = recordApi(
      [...UNRESOLVED, approval({ id: "a3", approver: named("u2"), status: "approved" })],
      GATE_REFUSAL,
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    await pickStatus(user, "s-signature");

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Nadia Counsel")).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "2 approvals on this contract are unresolved. Moving to Out for signature goes past sign-off.",
      ),
    ).toBeInTheDocument();
  });

  it("commits with the override flag only on the confirm", async () => {
    const user = userEvent.setup();
    const api = recordApi(UNRESOLVED, GATE_REFUSAL);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    await pickStatus(user, "s-signature");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Move anyway" }));

    await waitFor(() =>
      expect(api.patches).toEqual([
        { statusId: "s-signature" },
        { statusId: "s-signature", overrideSoftGate: true },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The record adopted the status the override committed.
    expect(await screen.findByLabelText("Status")).toHaveValue("s-signature");
  });

  it("commits nothing more when the dialog is dismissed", async () => {
    const user = userEvent.setup();
    const api = recordApi(UNRESOLVED, GATE_REFUSAL);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    await pickStatus(user, "s-signature");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.patches).toEqual([{ statusId: "s-signature" }]);
    // Nothing committed, so the select still reads the saved status.
    expect(screen.getByLabelText("Status")).toHaveValue("s-approval");
  });

  it("holds the dialog open while the override is in flight, and freezes the select behind it", async () => {
    const user = userEvent.setup();
    const base = recordApi(UNRESOLVED, GATE_REFUSAL);
    /** Releases the override's answer, so the in-flight moment can be
     * read rather than raced. */
    let release: (() => void) | undefined;
    let calls = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
          calls += 1;
          if (calls === 1) return problem(409, GATE_REFUSAL.detail, GATE_TYPE);
          const answer = base.handler(call)!;
          return new Promise<Response>((resolve) => {
            release = () => resolve(answer);
          });
        }
        return base.handler(call);
      },
    });
    renderAt("/contracts/42");

    await pickStatus(user, "s-signature");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Move anyway" }));

    // The write is out. Neither the dialog's own dismissal nor a second
    // pick behind it may start something while it is.
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled(),
    );
    expect(within(dialog).getByRole("button", { name: "Move anyway" })).toBeDisabled();
    expect(screen.getByLabelText("Status")).toBeDisabled();

    release!();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByLabelText("Status")).toHaveValue("s-signature");
  });

  it("commits a status the gate does not refuse in one press, with no dialog", async () => {
    const user = userEvent.setup();
    const api = recordApi(UNRESOLVED);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    await pickStatus(user, "s-review");

    await waitFor(() => expect(api.patches).toEqual([{ statusId: "s-review" }]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("prints a refusal that is not the gate's under the field, and raises no dialog", async () => {
    const user = userEvent.setup();
    const api = recordApi(UNRESOLVED, {
      status: 409,
      detail: "This contract is archived. Restore it before editing it.",
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    await pickStatus(user, "s-signature");

    expect(
      await screen.findByText("This contract is archived. Restore it before editing it."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("prints a refusal the override itself meets inside the dialog", async () => {
    const user = userEvent.setup();
    let calls = 0;
    const base = recordApi(UNRESOLVED, GATE_REFUSAL);
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
          calls += 1;
          if (calls === 1) return problem(409, GATE_REFUSAL.detail, GATE_TYPE);
          return problem(409, "This contract is archived. Restore it before editing it.");
        }
        return base.handler(call);
      },
    });
    renderAt("/contracts/42");

    await pickStatus(user, "s-signature");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Move anyway" }));

    expect(
      await within(dialog).findByText("This contract is archived. Restore it before editing it."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
