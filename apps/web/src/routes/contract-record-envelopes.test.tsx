// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The signing half of the record (#246, #247, CTR-013, DES-036,
 * DES-037) at `/contracts/42/approvals`, through the real route table
 * with the standard fetch stub.
 *
 * What it draws: the envelope row with its status pill, its signers,
 * the version that went out, and when — plus the ending the provider's
 * feed reported (its date, and its reason on a decline) and the chip in
 * the record's sub-bar that says where the signature stands.
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
/** CTR-004's Owner — one of the void's three actors, and somebody who
 * sent nothing. */
const OWNER = {
  id: "u4",
  email: "owner@example.com",
  displayName: "Omar Owner",
  role: "legal_team_member",
};
/** The Owner as the record answers them. */
const OWNER_PERSON = { id: "u4", displayName: "Omar Owner", image: null };
/** A Member+ who reaches the record and is none of the three actors. */
const BYSTANDER = {
  id: "u5",
  email: "bystander@example.com",
  displayName: "Bea Bystander",
  role: "legal_team_member",
};
const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Ada Admin",
  role: "administrator",
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
    reason: null,
    sentBy: { id: "u2", displayName: "Nadia Counsel", image: null },
    sentAt: "2026-08-10T00:00:00.000Z",
    completedAt: null,
    // Where this round's executed copy has got to (CTR-014). Every
    // live envelope is `pending`: nothing is owed until one completes.
    executedFetch: "pending",
    executedCopy: null,
    ...overrides,
  };
}

/** The C20 mock's note, whole now that every behaviour it names
 * exists (DES-039). */
const WEBHOOK_NOTE =
  "Signed, declined, and voided status arrives by webhook. " +
  "The executed file auto-files and the stage advances to Active.";

/** The executed copy one signed round filed back onto the chain. */
const EXECUTED_COPY = {
  documentId: "d1",
  versionId: "v3",
  versionNumber: 3,
  originalFilename: "acme-msa-draft (executed).pdf",
};

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
    // The withdrawal, addressed by the envelope's own id. It answers
    // the record's whole signing state, exactly as the send does, which
    // is what brings the send control back with the ending.
    if (call.url.pathname === "/api/v1/envelopes/e1/void" && call.method === "POST") {
      writes.push({ path: call.url.pathname, body: call.body });
      if (refuse) return problem(refuse.status, refuse.detail, refuse.type);
      const body = call.body as { reason: string };
      state = {
        ...state,
        envelopes: state.envelopes.map((row) =>
          row.id === "e1"
            ? {
                ...row,
                status: "voided",
                reason: body.reason,
                completedAt: "2026-08-13T00:00:00.000Z",
              }
            : row,
        ),
      };
      return json(200, state);
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

  it("prints the em dash for an envelope that has not ended", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("—")).toBeInTheDocument();
  });

  it("says a delivery is coming, and what it brings, while an envelope is out", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    expect(await screen.findByText(WEBHOOK_NOTE)).toBeInTheDocument();
  });

  it("says nothing about deliveries once the envelope has ended", async () => {
    const api = recordApi({
      envelopes: [envelopeRow({ status: "signed", completedAt: "2026-08-12T00:00:00.000Z" })],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await envelopeRows();
    expect(screen.queryByText(WEBHOOK_NOTE)).not.toBeInTheDocument();
  });

  it("shows a signed envelope with the date it ended, on the row and the chip", async () => {
    const api = recordApi({
      envelopes: [envelopeRow({ status: "signed", completedAt: "2026-08-12T00:00:00.000Z" })],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Signed")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Aug 12")).toBeInTheDocument();
    expect(await screen.findByText("Envelope signed")).toBeInTheDocument();
  });

  it("hands over the executed copy on a signed row", async () => {
    const api = recordApi({
      envelopes: [
        envelopeRow({
          status: "signed",
          completedAt: "2026-08-12T00:00:00.000Z",
          executedFetch: "ready",
          executedCopy: EXECUTED_COPY,
        }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const rows = await envelopeRows();
    const link = within(rows[0]!).getByRole("link", { name: "Executed copy" });
    expect(link).toHaveAttribute("href", "/api/v1/documents/d1/versions/v3/download");
    expect(link).toHaveAttribute("download", EXECUTED_COPY.originalFilename);
  });

  it("says the executed copy is still coming while the fetch runs", async () => {
    const api = recordApi({
      envelopes: [envelopeRow({ status: "signed", completedAt: "2026-08-12T00:00:00.000Z" })],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Filing the executed copy…")).toBeInTheDocument();
  });

  it("says plainly when the executed copy could not be filed", async () => {
    const api = recordApi({
      envelopes: [
        envelopeRow({
          status: "signed",
          completedAt: "2026-08-12T00:00:00.000Z",
          executedFetch: "failed",
        }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const rows = await envelopeRows();
    expect(
      within(rows[0]!).getByText(
        "The executed copy could not be filed. Upload it to the record instead.",
      ),
    ).toBeInTheDocument();
  });

  it("says nothing once a filed copy has been erased from the record", async () => {
    // DOC-010's lawful erasure takes the version, and the row's link
    // with it. The fetch is settled, so "filing" would be a lie and a
    // failure line would call an Administrator's act a fault.
    const api = recordApi({
      envelopes: [
        envelopeRow({
          status: "signed",
          completedAt: "2026-08-12T00:00:00.000Z",
          executedFetch: "ready",
          executedCopy: null,
        }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const rows = await envelopeRows();
    expect(within(rows[0]!).queryByText("Filing the executed copy…")).not.toBeInTheDocument();
    expect(within(rows[0]!).queryByRole("link", { name: "Executed copy" })).not.toBeInTheDocument();
  });

  it("says nothing about an executed copy on a round that ended without one", async () => {
    const api = recordApi({
      envelopes: [
        envelopeRow({
          status: "voided",
          reason: "We sent the wrong redline.",
          completedAt: "2026-08-11T00:00:00.000Z",
        }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const rows = await envelopeRows();
    expect(within(rows[0]!).queryByText("Filing the executed copy…")).not.toBeInTheDocument();
    expect(within(rows[0]!).queryByRole("link", { name: "Executed copy" })).not.toBeInTheDocument();
  });

  it("shows a declined envelope's reason under its pill", async () => {
    const api = recordApi({
      envelopes: [
        envelopeRow({
          status: "declined",
          reason: "The indemnity cap is wrong.",
          completedAt: "2026-08-11T00:00:00.000Z",
        }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Declined")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("The indemnity cap is wrong.")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Aug 11")).toBeInTheDocument();
    expect(await screen.findByText("Envelope declined")).toBeInTheDocument();
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
  it("says what the send leads to, where the send is taken", async () => {
    const user = userEvent.setup();
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: "Send for signature" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "When everyone signs, the executed file lands on this contract and " +
          "the stage advances to Active.",
      ),
    ).toBeInTheDocument();
  });

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

/** The row's action menu, once the card has drawn the signing block. */
const ROW_ACTIONS = "Actions for the envelope sent on Aug 10";

describe("voiding a live envelope", () => {
  it("collects the reason and withdraws the round, in one write", async () => {
    const user = userEvent.setup();
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: ROW_ACTIONS }));
    await user.click(await screen.findByRole("menuitem", { name: "Void envelope" }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "We sent the wrong redline.");
    await user.click(within(dialog).getByRole("button", { name: "Void envelope" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toEqual({
      path: "/api/v1/envelopes/e1/void",
      body: { reason: "We sent the wrong redline." },
    });

    // The state the write answered with is what the card now draws:
    // the ending on the row, its reason under the pill, and the send
    // control back — the next round goes out as easily as the first.
    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Voided")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("We sent the wrong redline.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Send for signature" })).toBeInTheDocument();
  });

  it("refuses a void with no words, without writing anything", async () => {
    const user = userEvent.setup();
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: ROW_ACTIONS }));
    await user.click(await screen.findByRole("menuitem", { name: "Void envelope" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Void envelope" }));

    expect(
      await within(dialog).findByText("Say why this envelope is being voided."),
    ).toBeInTheDocument();
    expect(api.writes).toHaveLength(0);
  });

  it("prints the seam's own refusal in the dialog, and keeps what was typed", async () => {
    const user = userEvent.setup();
    const api = recordApi({ envelopes: [envelopeRow()] });
    api.refuseNext(409, "This envelope has already ended. It cannot be voided.");
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await user.click(await screen.findByRole("button", { name: ROW_ACTIONS }));
    await user.click(await screen.findByRole("menuitem", { name: "Void envelope" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Superseded by the new draft.");
    await user.click(within(dialog).getByRole("button", { name: "Void envelope" }));

    expect(await within(dialog).findByText(/already ended/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Reason")).toHaveValue("Superseded by the new draft.");
  });

  it("offers the act to the contract's Owner, who sent nothing", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] }, contractRow({ manager: OWNER_PERSON }));
    stubApi({ signedIn: OWNER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await envelopeRows();
    expect(await screen.findByRole("button", { name: ROW_ACTIONS })).toBeInTheDocument();
  });

  it("offers the act to an Administrator", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: ADMIN, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await envelopeRows();
    expect(await screen.findByRole("button", { name: ROW_ACTIONS })).toBeInTheDocument();
  });
});

describe("when the void control is absent", () => {
  it("draws no menu for a Member+ who neither sent it nor owns the record", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: BYSTANDER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    // They read the round; absence is about standing, not about reach.
    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Out for signature")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROW_ACTIONS })).not.toBeInTheDocument();
  });

  it("draws no menu on a round that has already ended", async () => {
    const api = recordApi({
      envelopes: [envelopeRow({ status: "signed", completedAt: "2026-08-12T00:00:00.000Z" })],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Signed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROW_ACTIONS })).not.toBeInTheDocument();
  });

  it("draws no action cell at all for a read-only viewer", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: CONTRIBUTOR, extra: api.handler });
    renderAt("/contracts/42/approvals");

    const table = await screen.findByRole("table", { name: "Signing" });
    expect(within(table).queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROW_ACTIONS })).not.toBeInTheDocument();
  });
});
