// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The signing half of the record (#246, #247, CTR-013, DES-036,
 * DES-037) at `/contracts/42/signatures`, through the real route table
 * with the standard fetch stub.
 *
 * What it draws: the envelope row with its status pill, its signers,
 * the version that went out, and when — plus the ending the provider's
 * feed reported (its date, and its reason on a decline).
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
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ENVELOPE_LIVE_PROBLEM_TYPE, MAX_ENVELOPE_SIGNERS } from "@openlaw/shared";
import {
  json,
  problem,
  renderAt,
  stubApi,
  stubEventSource,
  type StubCall,
} from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
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
  contractStatuses: [
    { id: "s-draft", slug: "draft", displayName: "Draft", stage: "draft" },
    {
      id: "s-signature",
      slug: "out_for_signature",
      displayName: "Out for signature",
      stage: "signature",
    },
  ],
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
    sourceState: "available",
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
    preparationEnabled?: boolean;
    updateMode?: "polling" | "webhook";
    primaryDocument?: typeof PRIMARY | null;
  } = {},
  row: Record<string, unknown> = contractRow(),
) {
  let state = {
    envelopes: initial.envelopes ?? [],
    signingConfigured: initial.signingConfigured ?? true,
    preparationEnabled: initial.preparationEnabled ?? false,
    updateMode: initial.updateMode ?? "webhook",
    primaryDocument: initial.primaryDocument === undefined ? PRIMARY : initial.primaryDocument,
  };
  let reads = 0;
  let refuseRead = false;
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
        renewals: [],
      });
    }
    if (call.url.pathname === "/api/v1/contracts/42/envelopes" && call.method === "GET") {
      reads += 1;
      if (refuseRead) {
        refuseRead = false;
        return problem(503, "Signing state unavailable");
      }
      return json(200, state);
    }
    if (call.url.pathname.endsWith("/launch") && call.method === "POST") {
      return problem(502, "DocuSign could not open this draft. Try again from Signatures.");
    }
    if (call.url.pathname === "/api/v1/contracts/42/envelopes/prepare" && call.method === "POST") {
      writes.push({ path: call.url.pathname, body: call.body });
      if (refuse) {
        const refusal = refuse;
        refuse = null;
        return problem(refusal.status, refusal.detail, refusal.type);
      }
      const body = call.body as { documentVersionId: string; signers: typeof SIGNERS };
      state = {
        ...state,
        envelopes: [
          envelopeRow({
            status: "draft",
            preparationState: "created",
            sentAt: null,
            signers: body.signers,
            documentVersionNumber: PRIMARY.versions.find(
              (round) => round.id === body.documentVersionId,
            )!.versionNumber,
          }),
        ],
      };
      return json(201, state);
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
      row = {
        ...row,
        statusId: "s-signature",
        statusName: "Out for signature",
        stage: "signature",
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
    get reads() {
      return reads;
    },
    replaceEnvelopes: (envelopes: Record<string, unknown>[]) => {
      state = { ...state, envelopes };
    },
    refuseNextRead: () => {
      refuseRead = true;
    },
    refuseNext: (status: number, detail: string, type?: string) => {
      refuse = { status, detail, type };
    },
  };
}

/** The signing block's own table, once the card has drawn it. */
async function envelopeRows() {
  const table = await screen.findByRole("table", { name: "Signatures" });
  return within(table).getAllByRole("row").slice(1);
}

describe("the record's signing block", () => {
  it("re-asks the signing read when an Envelope ending lands", async () => {
    const sources = stubEventSource();
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

    expect(await screen.findByText("Out for signature")).toBeInTheDocument();
    expect(api.reads).toBe(1);
    api.replaceEnvelopes([
      envelopeRow({ status: "signed", completedAt: "2026-08-12T00:00:00.000Z" }),
    ]);
    sources[0]!.emit({
      kind: "record",
      action: "envelope.signed",
      entityType: "contract",
      entityId: "c1",
      entryId: "activity-signed",
      visibility: "working_team",
    });

    expect(await screen.findByText("Signed")).toBeInTheDocument();
    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Signed")).toBeInTheDocument();
    expect(api.reads).toBe(2);
  });

  it("keeps the last Envelope state when a live re-ask fails", async () => {
    const sources = stubEventSource();
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

    expect(await screen.findByText("Out for signature")).toBeInTheDocument();
    api.refuseNextRead();
    sources[0]!.emit({
      kind: "record",
      action: "envelope.signed",
      entityType: "contract",
      entityId: "c1",
      entryId: "activity-signed",
      visibility: "working_team",
    });
    await waitFor(() => expect(api.reads).toBe(2));
    await act(async () => Promise.resolve());

    expect(screen.getByText("Out for signature")).toBeInTheDocument();
    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Out for signature")).toBeInTheDocument();
  });

  it("re-asks the signing read when the connection opens after a missed ending", async () => {
    const sources = stubEventSource();
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

    expect(await screen.findByText("Out for signature")).toBeInTheDocument();
    expect(api.reads).toBe(1);

    // An ending the worker's sweep applied while this tab was
    // disconnected has no frame to narrate it here. The native open on
    // reconnect is the recovery re-ask, and it finds the ending.
    api.replaceEnvelopes([
      envelopeRow({ status: "voided", completedAt: "2026-08-12T00:00:00.000Z" }),
    ]);
    sources[0]!.open();

    expect(await screen.findByText("Voided")).toBeInTheDocument();
    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Voided")).toBeInTheDocument();
    expect(api.reads).toBe(2);
  });

  it("re-asks the signing read for document.executed_set, not version_added", async () => {
    const sources = stubEventSource();
    const signed = envelopeRow({
      status: "signed",
      completedAt: "2026-08-12T00:00:00.000Z",
    });
    const api = recordApi({ envelopes: [signed] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Filing the executed copy…")).toBeInTheDocument();
    api.replaceEnvelopes([{ ...signed, executedFetch: "ready", executedCopy: EXECUTED_COPY }]);

    sources[0]!.emit({
      kind: "record",
      action: "document.version_added",
      entityType: "contract",
      entityId: "c1",
      entryId: "activity-version",
      visibility: "working_team",
    });
    await act(async () => Promise.resolve());
    expect(api.reads).toBe(1);
    expect(within(rows[0]!).queryByRole("link", { name: "Executed copy" })).not.toBeInTheDocument();

    sources[0]!.emit({
      kind: "record",
      action: "document.executed_set",
      entityType: "contract",
      entityId: "c1",
      entryId: "activity-pin",
      visibility: "working_team",
    });
    const link = await within(rows[0]!).findByRole("link", { name: "Executed copy" });
    expect(link).toHaveAttribute("href", "/api/v1/documents/d1/versions/v3/download");
    expect(api.reads).toBe(2);
  });

  it("draws the envelope with its pill, signers, version, and sender", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

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

  it("keeps signature history in its own tab when navigating from approvals", async () => {
    const user = userEvent.setup();
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/contracts/42/approvals");

    await screen.findByRole("region", { name: "Approvals" });
    expect(screen.queryByRole("table", { name: "Signatures" })).not.toBeInTheDocument();
    const strip = within(screen.getByRole("navigation", { name: "Contract sections" }));
    await user.click(strip.getByRole("link", { name: "Signatures" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/contracts/42/signatures"));
    expect(await envelopeRows()).toHaveLength(1);
    expect(strip.getByRole("link", { name: "Signatures" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("region", { name: "Approvals" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add approver" })).not.toBeInTheDocument();
  });

  it("offers sending only from the signatures tab", async () => {
    const user = userEvent.setup();
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/approvals");

    await screen.findByRole("region", { name: "Approvals" });
    expect(screen.queryByRole("button", { name: "Send for signature" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Signatures" }));
    expect(await screen.findByRole("button", { name: "Send for signature" })).toBeInTheDocument();
    expect(screen.getByText("No signature requests on this contract yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Approvals" }));
    expect(await screen.findByRole("button", { name: "Add approver" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send for signature" })).not.toBeInTheDocument();
  });

  it("shows only the contract status in the header", async () => {
    const api = recordApi(
      { envelopes: [envelopeRow()] },
      contractRow({
        statusId: "s-signature",
        statusName: "Out for signature",
        stage: "signature",
      }),
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

    await envelopeRows();
    const header = within(screen.getByRole("region", { name: "Acme master services agreement" }));
    expect(header.getAllByText("Out for signature")).toHaveLength(1);
  });

  it("prints the em dash for an envelope that has not ended", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("—")).toBeInTheDocument();
  });

  it("shows a signed envelope with the date it ended", async () => {
    const api = recordApi({
      envelopes: [envelopeRow({ status: "signed", completedAt: "2026-08-12T00:00:00.000Z" })],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Signed")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Aug 12")).toBeInTheDocument();
    expect(await screen.findByText("Signed")).toBeInTheDocument();
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
    renderAt("/contracts/42/signatures");

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
    renderAt("/contracts/42/signatures");

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
    renderAt("/contracts/42/signatures");

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
    renderAt("/contracts/42/signatures");

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
    renderAt("/contracts/42/signatures");

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
    renderAt("/contracts/42/signatures");

    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Declined")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("The indemnity cap is wrong.")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Aug 11")).toBeInTheDocument();
    expect(await screen.findByText("Declined")).toBeInTheDocument();
  });

  it("shows an empty signature section on a record signed by hand", async () => {
    const api = recordApi({ envelopes: [], signingConfigured: false });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

    await screen.findByRole("heading", { name: "Signatures" });
    expect(
      screen.queryByText("Out for signature", {
        selector: "section[aria-labelledby=page-title] span",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Signatures" })).not.toBeInTheDocument();
  });
});

describe("sending for signature", () => {
  it("says what the send leads to, where the send is taken", async () => {
    const user = userEvent.setup();
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

    await user.click(await screen.findByRole("button", { name: "Send for signature" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "When everyone signs, the executed file lands on this Contract. " +
          "The Contract advances to Active only if it is still in the Signature Stage.",
      ),
    ).toBeInTheDocument();
  });

  it("sends the current round and every signer in one request", async () => {
    const user = userEvent.setup();
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

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
    const header = within(screen.getByRole("region", { name: "Acme master services agreement" }));
    expect(await header.findByText("Out for signature")).toBeInTheDocument();
    expect(header.getAllByText("Out for signature")).toHaveLength(1);
    expect(header.queryByText("Draft", { selector: ".rounded-pill" })).not.toBeInTheDocument();
  });

  it("sends a picked user by id, beside a typed signer, in row order", async () => {
    const user = userEvent.setup();
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

    await user.click(await screen.findByRole("button", { name: "Send for signature" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Signer 1 name"), "nad");
    await user.click(within(dialog).getByRole("option", { name: "Nadia Counsel" }));
    // A picked user has no email box: the seam reads their address.
    expect(within(dialog).queryByLabelText("Signer 1 email")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Uses their OpenLaw email")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Add signer" }));
    await user.type(within(dialog).getByLabelText("Signer 2 name"), "Sarah Chen");
    // Nadia is on row 1, so row 2 does not offer her again.
    expect(within(dialog).queryByRole("option", { name: "Nadia Counsel" })).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Signer 2 email"), "sarah@meridianbio.example");
    await user.click(within(dialog).getByRole("button", { name: "Send envelope" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.body).toMatchObject({
      signers: [{ personId: "u2" }, { name: "Sarah Chen", email: "sarah@meridianbio.example" }],
    });
  });

  it("sends the older round when it is the one picked", async () => {
    const user = userEvent.setup();
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

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
    renderAt("/contracts/42/signatures");

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
      ENVELOPE_LIVE_PROBLEM_TYPE,
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

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
    renderAt("/contracts/42/signatures");

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
    renderAt("/contracts/42/signatures");

    await screen.findByRole("region", { name: "Signatures" });
    expect(screen.queryByRole("button", { name: "Send for signature" })).not.toBeInTheDocument();
  });

  it("is absent on a record with no primary document", async () => {
    const api = recordApi({ primaryDocument: null });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

    await screen.findByRole("region", { name: "Signatures" });
    expect(screen.queryByRole("button", { name: "Send for signature" })).not.toBeInTheDocument();
  });

  it("is absent while an envelope is already out", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

    await envelopeRows();
    expect(screen.queryByRole("button", { name: "Send for signature" })).not.toBeInTheDocument();
  });

  it("comes back once the envelope is no longer live", async () => {
    const api = recordApi({ envelopes: [envelopeRow({ status: "voided" })] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Voided")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Send for signature" })).toBeInTheDocument();
  });
});

/** The row's action menu, once the card has drawn the signing block. */
const ROW_ACTIONS = "Actions for the envelope: Aug 10";

describe("voiding a live envelope", () => {
  it("collects the reason and withdraws the round, in one write", async () => {
    const user = userEvent.setup();
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");

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
    renderAt("/contracts/42/signatures");

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
    renderAt("/contracts/42/signatures");

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
    renderAt("/contracts/42/signatures");

    await envelopeRows();
    expect(await screen.findByRole("button", { name: ROW_ACTIONS })).toBeInTheDocument();
  });

  it("offers the act to an Administrator", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: ADMIN, extra: api.handler });
    renderAt("/contracts/42/signatures");

    await envelopeRows();
    expect(await screen.findByRole("button", { name: ROW_ACTIONS })).toBeInTheDocument();
  });
});

describe("when the void control is absent", () => {
  it("draws no menu for a Member+ who neither sent it nor owns the record", async () => {
    const api = recordApi({ envelopes: [envelopeRow()] });
    stubApi({ signedIn: BYSTANDER, extra: api.handler });
    renderAt("/contracts/42/signatures");

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
    renderAt("/contracts/42/signatures");

    const rows = await envelopeRows();
    expect(within(rows[0]!).getByText("Signed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROW_ACTIONS })).not.toBeInTheDocument();
  });
});

describe("preparing an unsent Envelope", () => {
  it.each([true, false])(
    "returns focus after Cancel with preparation enabled=%s",
    async (preparationEnabled) => {
      const user = userEvent.setup();
      const api = recordApi({ preparationEnabled });
      stubApi({ signedIn: MEMBER, extra: api.handler });
      renderAt("/contracts/42/signatures");
      const trigger = await screen.findByRole("button", {
        name: preparationEnabled ? "Prepare Envelope" : "Send for signature",
      });
      await user.click(trigger);
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(api.writes).toHaveLength(0);
    },
  );

  it("focuses Signatures when the tab opens and preserves focus on a live update", async () => {
    const sources = stubEventSource();
    const api = recordApi({ preparationEnabled: true });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");
    const heading = await screen.findByRole("heading", { name: "Signatures" });
    await waitFor(() => expect(heading).toHaveFocus());
    const trigger = screen.getByRole("button", { name: "Prepare Envelope" });
    trigger.focus();
    // A live connection rereads the record but must not take keyboard focus.
    act(() => sources[0]!.open());
    await waitFor(() => expect(api.reads).toBe(2));
    expect(trigger).toHaveFocus();
  });

  it("keeps preparation enabled when the live connection re-reads signing state", async () => {
    const sources = stubEventSource();
    const api = recordApi({ preparationEnabled: true });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");
    expect(await screen.findByRole("button", { name: "Prepare Envelope" })).toBeInTheDocument();
    sources[0]!.open();
    await waitFor(() => expect(api.reads).toBe(2));
    await act(async () => Promise.resolve());
    expect(screen.getByRole("button", { name: "Prepare Envelope" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send for signature" })).not.toBeInTheDocument();
  });

  it("retains discarded preparation history without Resume or Void", async () => {
    const api = recordApi({
      preparationEnabled: true,
      envelopes: [envelopeRow({ status: "discarded", preparationState: "created", sentAt: null })],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");
    expect(await screen.findByText("Discarded")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume in DocuSign" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROW_ACTIONS })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prepare Envelope" })).toBeInTheDocument();
  });

  it.each([
    { scheduled: true, text: "Scheduled in DocuSign" },
    {
      externallyRestored: true,
      text: "Restored outside OpenLaw. Review this Envelope in DocuSign.",
    },
  ])("keeps $text reserved without Resume", async ({ text, ...facts }) => {
    const api = recordApi({
      preparationEnabled: true,
      envelopes: [envelopeRow({ status: "draft", sentAt: null, ...facts })],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByText("Not sent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume in DocuSign" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prepare Envelope" })).not.toBeInTheDocument();
  });

  it("converges a waiting preparation through the record event without a return", async () => {
    const sources = stubEventSource();
    const api = recordApi({
      preparationEnabled: true,
      envelopes: [envelopeRow({ status: "draft", sentAt: null, confirmationPending: true })],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");
    expect(await screen.findByText("Waiting for confirmation")).toBeInTheDocument();
    api.replaceEnvelopes([envelopeRow({ status: "sent", confirmationPending: false })]);
    sources[0]!.emit({
      kind: "record",
      action: "envelope.sent",
      entityType: "contract",
      entityId: "c1",
      entryId: "worker-sent",
      visibility: "working_team",
    });
    expect(await screen.findByText("Out for signature")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for confirmation")).not.toBeInTheDocument();
  });

  it.each(["changed", "unavailable"] as const)(
    "explains a %s source and retains history without Resume",
    async (sourceState) => {
      const api = recordApi({
        preparationEnabled: true,
        envelopes: [
          envelopeRow({ status: "draft", preparationState: "created", sentAt: null, sourceState }),
        ],
      });
      stubApi({ signedIn: MEMBER, extra: api.handler });
      renderAt("/contracts/42/signatures");
      expect(
        await screen.findByText(
          sourceState === "changed"
            ? /The primary Document changed/
            : /The original source Version is unavailable/,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Resume in DocuSign" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Prepare Envelope" })).not.toBeInTheDocument();
      expect(screen.getByText(/does not close a session already issued/)).toBeInTheDocument();
    },
  );

  it("explains a disabled connector while retaining the preparation", async () => {
    const api = recordApi({
      preparationEnabled: true,
      signingConfigured: false,
      envelopes: [envelopeRow({ status: "draft", preparationState: "created", sentAt: null })],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");
    expect(
      await screen.findByText(/Signing connector is disabled or unavailable/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume in DocuSign" })).not.toBeInTheDocument();
  });

  it("offers Resume while confirmation is pending and never offers Send or Void for the draft", async () => {
    const api = recordApi({
      preparationEnabled: true,
      envelopes: [
        envelopeRow({
          status: "draft",
          preparationState: "created",
          sentAt: null,
          confirmationPending: true,
        }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");
    expect(await screen.findByText("Waiting for confirmation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume in DocuSign" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prepare Envelope" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send for signature" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROW_ACTIONS })).not.toBeInTheDocument();
  });

  it("shows the localized launch fallback when reopening a draft fails without problem detail", async () => {
    const user = userEvent.setup();
    const api = recordApi({
      preparationEnabled: true,
      envelopes: [envelopeRow({ status: "draft", preparationState: "created", sentAt: null })],
    });
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname.endsWith("/launch") && call.method === "POST"
          ? json(502, { status: 502 })
          : api.handler(call),
    });
    renderAt("/contracts/42/signatures");
    await user.click(await screen.findByRole("button", { name: "Resume in DocuSign" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "DocuSign could not open this draft. Try again from Signatures.",
    );
    expect(screen.getByRole("button", { name: "Resume in DocuSign" })).toBeEnabled();
  });

  it("selects the exact Version, Signers and Subject and displays the unsent draft", async () => {
    const user = userEvent.setup();
    const api = recordApi({ preparationEnabled: true });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");
    await user.click(await screen.findByRole("button", { name: "Prepare Envelope" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Version"), "v1");
    await user.type(within(dialog).getByLabelText("Signer 1 name"), "Sarah Chen");
    await user.type(within(dialog).getByLabelText("Signer 1 email"), "sarah@meridianbio.example");
    await user.type(within(dialog).getByLabelText("Subject"), "Please review this agreement");
    await user.click(within(dialog).getByRole("button", { name: "Continue to DocuSign" }));
    expect(await screen.findByText("Draft — not sent")).toBeInTheDocument();
    expect(screen.getByText("Not sent")).toBeInTheDocument();
    expect(screen.getByText("Prepared by Nadia Counsel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send for signature" })).not.toBeInTheDocument();
    expect(api.writes[0]).toMatchObject({
      path: "/api/v1/contracts/42/envelopes/prepare",
      body: {
        documentVersionId: "v1",
        signers: [SIGNERS[0]],
        subject: "Please review this agreement",
        idempotencyKey: expect.any(String),
      },
    });
  });

  it("keeps the idempotency key for a repeated request and replaces it for a corrected one", async () => {
    const user = userEvent.setup();
    const api = recordApi({ preparationEnabled: true });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");
    await user.click(await screen.findByRole("button", { name: "Prepare Envelope" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Signer 1 name"), "Sarah Chen");
    await user.type(within(dialog).getByLabelText("Signer 1 email"), "sarah@meridianbio.example");
    const refused = "The provider would not take the envelope.";
    api.refuseNext(502, refused);
    await user.click(within(dialog).getByRole("button", { name: "Continue to DocuSign" }));
    expect(await within(dialog).findByText(refused)).toBeInTheDocument();
    api.refuseNext(502, refused);
    await user.click(within(dialog).getByRole("button", { name: "Continue to DocuSign" }));
    await waitFor(() => expect(api.writes).toHaveLength(2));
    await user.type(within(dialog).getByLabelText("Subject"), "Corrected");
    await user.click(within(dialog).getByRole("button", { name: "Continue to DocuSign" }));
    await waitFor(() => expect(api.writes).toHaveLength(3));
    const keys = api.writes.map(
      (write) => (write.body as { idempotencyKey: string }).idempotencyKey,
    );
    // A seam that saw the first key again with a new subject would refuse
    // it as a conflict, so the corrected request needs its own.
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("refreshes an unresolved creation into the same recovered draft without creating or launching", async () => {
    const api = recordApi({
      preparationEnabled: true,
      envelopes: [
        envelopeRow({
          id: "recovering",
          status: "preparing",
          preparationState: "uncertain",
          sentAt: null,
          recoveryAttempts: 2,
          nextRecoveryAt: "2026-09-27T12:00:00Z",
        }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");
    expect(await screen.findByText(/Checks made: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Next check no earlier/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume in DocuSign" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(api.writes).toHaveLength(0);
    api.replaceEnvelopes([
      envelopeRow({ id: "recovering", status: "draft", preparationState: "created", sentAt: null }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    expect(await screen.findByRole("button", { name: "Resume in DocuSign" })).toBeInTheDocument();
    expect(await envelopeRows()).toHaveLength(1);
    expect(api.writes).toHaveLength(0);
  });

  it("explains operator resolution when the lookup window has expired", async () => {
    const api = recordApi({
      preparationEnabled: true,
      envelopes: [
        envelopeRow({
          status: "preparing",
          preparationState: "uncertain",
          sentAt: null,
          recoveryStopped: "lookup_expired",
        }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");
    expect(
      await screen.findByText(/Ask your Administrator to resolve this Envelope/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue to DocuSign" })).not.toBeInTheDocument();
  });

  it("shows an uncertain creation without offering a second preparation", async () => {
    const api = recordApi({
      preparationEnabled: true,
      envelopes: [
        envelopeRow({ status: "preparing", preparationState: "uncertain", sentAt: null }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/signatures");
    expect(await screen.findByText("Creation uncertain — not confirmed sent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prepare Envelope" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send for signature" })).not.toBeInTheDocument();
  });
});
