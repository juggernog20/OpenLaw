// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The signing half of the record (#246, CTR-013, DES-036) at
 * `/contracts/42/approvals`, through the real route table with the
 * standard fetch stub.
 *
 * What it draws: the envelope row with its status pill, its signers,
 * the version that went out, and when — plus the chip in the record's
 * sub-bar that says where the signature stands.
 *
 * What it offers: the send dialog, which defaults to the current round
 * of the primary document, collects signers as name-and-email pairs,
 * and sends them all in one request.
 *
 * What it must not offer is asserted just as hard, because absence is
 * the decision (DES-035's rule): no send control on an install with no
 * connector, none on a record with no primary document, none while an
 * envelope is already out, and none for a read-only viewer.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MAX_ENVELOPE_SIGNERS } from "@openlaw/shared";
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
    description: null,
    customFields: {},
    isConfidential: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The record's instrument and its chain, newest round first, as the
 * seam answers it. */
const PRIMARY = {
  id: "d1",
  title: "Acme MSA",
  versions: [
    {
      id: "v2",
      versionNumber: 2,
      kind: "redline_theirs",
      originalFilename: "acme-msa-redline.pdf",
      createdAt: "2026-08-08T00:00:00.000Z",
    },
    {
      id: "v1",
      versionNumber: 1,
      kind: "draft_ours",
      originalFilename: "acme-msa-draft.pdf",
      createdAt: "2026-08-02T00:00:00.000Z",
    },
  ],
};

const SIGNERS = [
  { name: "Sarah Chen", email: "sarah@meridianbio.example" },
  { name: "J. Malone", email: "j.malone@orioncloud.example" },
];

/** One envelope, as the API answers it. */
function envelopeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    provider: "docusign",
    status: "sent",
    signers: SIGNERS,
    documentTitle: "Acme MSA",
    documentVersionNumber: 2,
    sentBy: { id: "u2", displayName: "Nadia Counsel", image: null },
    sentAt: "2026-08-10T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

/**
 * The record loader's reads plus the envelope routes under test. The
 * signing state is stateful: a send answers the state it produces, and
 * a later read answers the latest one.
 */
function recordApi(
  initial: {
    envelopes?: Record<string, unknown>[];
    signingConfigured?: boolean;
    primaryDocument?: typeof PRIMARY | null;
  } = {},
  row: Record<string, unknown> = contractRow(),
) {
  let state = {
    envelopes: initial.envelopes ?? [],
    signingConfigured: initial.signingConfigured ?? true,
    primaryDocument: initial.primaryDocument === undefined ? PRIMARY : initial.primaryDocument,
  };
  const writes: { path: string; body: unknown }[] = [];
  /** What the next send answers with; a refusal when set. */
  let refuse: { status: number; detail: string; type?: string } | null = null;

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
        team: [{ id: "u2", displayName: "Nadia Counsel", image: null, role: "creator" }],
        counterparties: [],
      });
    }
    if (call.url.pathname === "/api/v1/contracts/42/envelopes" && call.method === "GET") {
      return json(200, state);
    }
    if (call.url.pathname === "/api/v1/contracts/42/envelopes" && call.method === "POST") {
      writes.push({ path: call.url.pathname, body: call.body });
      if (refuse) return problem(refuse.status, refuse.detail, refuse.type);
      const body = call.body as { documentVersionId: string; signers: typeof SIGNERS };
      const version = PRIMARY.versions.find((round) => round.id === body.documentVersionId)!;
      state = {
        ...state,
        envelopes: [
          envelopeRow({ signers: body.signers, documentVersionNumber: version.versionNumber }),
          ...state.envelopes,
        ],
      };
      return json(201, state);
    }
    return undefined;
  };
  return {
    handler,
    writes,
    refuseNext: (status: number, detail: string, type?: string) => {
      refuse = { status, detail, type };
    },
  };
}

/** The signing block's own table, once the card has drawn it. */
async function envelopeRows() {
  const table = await screen.findByRole("table", { name: "Signing" });
  return within(table).getAllByRole("row").slice(1);
}

describe("the record's signing block", () => {
  it("draws the envelope with its pill, signers, version, and sender", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const rows = await envelopeRows();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(within(row).getByText("Out for signature")).toBeInTheDocument();
    expect(within(row).getByText("Sarah Chen")).toBeInTheDocument();
    expect(within(row).getByText("sarah@meridianbio.example")).toBeInTheDocument();
    expect(within(row).getByText("J. Malone")).toBeInTheDocument();
    expect(within(row).getByText("Acme MSA")).toBeInTheDocument();
    expect(within(row).getByText("Version 2")).toBeInTheDocument();
    expect(within(row).getByText("Aug 10")).toBeInTheDocument();
    expect(within(row).getByText("by Nadia Counsel")).toBeInTheDocument();
  });

  it("takes the card's two-part name", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    expect(await screen.findByRole("heading", { name: "Approvals & signing" })).toBeInTheDocument();
  });

  it("says where the signature stands in the record's sub-bar", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    expect(await screen.findByText("Envelope sent")).toBeInTheDocument();
  });

  it("draws no chip and no signing block on a record signed by hand", async () => {
    const api = recordApi({ envelopes: [], signingConfigured: false });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await screen.findByRole("heading", { name: "Approvals & signing" });
    expect(screen.queryByText("Envelope sent")).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Signing" })).not.toBeInTheDocument();
  });
});

describe("sending for signature", () => {
  it("sends the current round and every signer in one request", async () => {
    const user = userEvent.setup();
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Send for signature" }));
    const dialog = await screen.findByRole("dialog");

    // The current round is the default, and the older one is offered.
    const version = within(dialog).getByLabelText("Version");
    expect(version).toHaveValue("v2");
    expect(
      within(dialog).getByRole("option", { name: "Version 1 — acme-msa-draft.pdf" }),
    ).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Signer 1 name"), "Sarah Chen");
    await user.type(within(dialog).getByLabelText("Signer 1 email"), "sarah@meridianbio.example");
    await user.click(within(dialog).getByRole("button", { name: "Add signer" }));
    await user.type(within(dialog).getByLabelText("Signer 2 name"), "J. Malone");
    await user.type(within(dialog).getByLabelText("Signer 2 email"), "j.malone@orioncloud.example");
    await user.click(within(dialog).getByRole("button", { name: "Send envelope" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      path: "/api/v1/contracts/42/envelopes",
      body: { documentVersionId: "v2", signers: SIGNERS },
    });
    // The state the write answered with is what the card now draws.
    await waitFor(async () => expect(await envelopeRows()).toHaveLength(1));
  });

  it("sends the older round when it is the one picked", async () => {
    const user = userEvent.setup();
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Send for signature" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Version"), "v1");
    await user.type(within(dialog).getByLabelText("Signer 1 name"), "Sarah Chen");
    await user.type(within(dialog).getByLabelText("Signer 1 email"), "sarah@meridianbio.example");
    await user.click(within(dialog).getByRole("button", { name: "Send envelope" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.body).toMatchObject({ documentVersionId: "v1" });
  });

  it("restores focus to Add signer on a removal, even from a full list", async () => {
    const user = userEvent.setup();
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Send for signature" }));
    const dialog = await screen.findByRole("dialog");

    // Fill the list to the cap, at which point "Add signer" is absent —
    // the edge where a synchronous focus restore would find nothing,
    // because the control to focus is not mounted until the removal has
    // re-rendered the list back under the cap.
    for (let row = 1; row < MAX_ENVELOPE_SIGNERS; row += 1) {
      await user.click(within(dialog).getByRole("button", { name: "Add signer" }));
    }
    expect(within(dialog).queryByRole("button", { name: "Add signer" })).not.toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: `Remove signer ${MAX_ENVELOPE_SIGNERS}` }),
    );
    const addSigner = await within(dialog).findByRole("button", { name: "Add signer" });
    await waitFor(() => expect(addSigner).toHaveFocus());
  });

  it("prints the seam's own refusal in the dialog, and keeps the form", async () => {
    const user = userEvent.setup();
    const api = recordApi();
    api.refuseNext(
      409,
      "This contract already has an envelope out for signature. Void it before sending another.",
      "urn:openlaw:problem:envelope-live",
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Send for signature" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Signer 1 name"), "Sarah Chen");
    await user.type(within(dialog).getByLabelText("Signer 1 email"), "sarah@meridianbio.example");
    await user.click(within(dialog).getByRole("button", { name: "Send envelope" }));

    // The seam's sentence, printed once and where the press was made.
    expect(
      await within(dialog).findByText(/already has an envelope out for signature/),
    ).toBeInTheDocument();
    // The dialog stays open with what was typed still in it, so the
    // send can be made again without retyping the signers.
    expect(within(dialog).getByLabelText("Signer 1 name")).toHaveValue("Sarah Chen");
    expect(within(dialog).getByRole("button", { name: "Send envelope" })).toBeEnabled();
  });

  it("refuses to send a signer it could not reach, in the dialog", async () => {
    const user = userEvent.setup();
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Send for signature" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Signer 1 name"), "Sarah Chen");
    await user.click(within(dialog).getByRole("button", { name: "Send envelope" }));

    expect(
      await within(dialog).findByText("Give every signer a name and an email address."),
    ).toBeInTheDocument();
    expect(api.writes).toHaveLength(0);
  });
});

describe("when the send control is absent", () => {
  it("is absent on an install with no connector", async () => {
    const api = recordApi({ signingConfigured: false });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await screen.findByRole("button", { name: "Add approver" });
    expect(screen.queryByRole("button", { name: "Send for signature" })).not.toBeInTheDocument();
  });

  it("is absent on a record with no primary document", async () => {
    const api = recordApi({ primaryDocument: null });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await screen.findByRole("button", { name: "Add approver" });
    expect(screen.queryByRole("button", { name: "Send for signature" })).not.toBeInTheDocument();
  });

  it("is absent while an envelope is already out", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await envelopeRows();
    expect(screen.queryByRole("button", { name: "Send for signature" })).not.toBeInTheDocument();
  });

  it("comes back once the envelope is no longer live", async () => {
    const api = recordApi({ envelopes: [envelopeRow({ status: "voided" })] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Voided")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Send for signature" })).toBeInTheDocument();
  });

  it("is absent for a read-only viewer, who still reads the envelope", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: CONTRIBUTOR, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Out for signature")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send for signature" })).not.toBeInTheDocument();
  });
});
