// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Renewal routing to the other three vehicles on the contract record
 * (M16/5, CTR-007, DES-044), through the real route table with the
 * standard fetch stub.
 *
 * **The Renew dialog is a chooser now.** DES-043 shipped it with one
 * exit while three of the four could not be picked; all four exist, so
 * the mock's radio list is drawn and the button says the chosen
 * vehicle's own verb.
 *
 * **Three of the four vehicles route rather than write.** Nothing is
 * sent when one of them is picked: the amendment hands the person to the
 * record's Documents section with the composer open and the kind already
 * `amendment`, and the child and successor hand them to the create
 * dialog, prefilled. What the seam does with the create is the API
 * suite's; what this asserts is the handover.
 *
 * **The prefill this page owns is two fields and no rules.** The title
 * and the type are seeded from the record and stay editable; the rest of
 * the business facts are copied at the seam, and the request says only
 * which record and which vehicle. A page that decided what a renewal
 * inherits would be a second copy of CTR-015's stance.
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
];

const OPTIONS = {
  contractTypes: [
    { id: "t-msa", slug: "msa", displayName: "MSA", fields: [] },
    { id: "t-nda", slug: "nda", displayName: "NDA", fields: [] },
  ],
  contractStatuses: [{ id: "s-active", slug: "active", displayName: "Active", stage: "active" }],
  users: PEOPLE,
  approverGroups: [],
};

/** The record's instrument (CTR-014) — what an amendment is filed on. */
const PRIMARY = {
  id: "doc-1",
  title: "Acme_MSA_2025.docx",
  description: null,
  isPrimary: true,
  versions: [
    {
      id: "ver-1",
      versionNumber: 1,
      kind: "draft_ours",
      note: null,
      originalFilename: "Acme_MSA_2025.docx",
      mimeType: "application/pdf",
      renderFamily: "pdf",
      byteSize: 4_000,
      checksumSha256: "a".repeat(64),
      uploadedBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
      createdAt: "2025-07-01T09:00:00.000Z",
      isCurrent: true,
      isExecuted: false,
    },
  ],
  archivedAt: null,
  isConfidential: false,
  folderId: null,
  createdBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
  createdAt: "2025-07-01T09:00:00.000Z",
  updatedAt: "2025-07-01T09:00:00.000Z",
};

/** An auto-renewing record past its expiry — the one the Renew act is
 * raised on. Every derivation is the seam's answer, handed over. */
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
 * The record loader's reads, the create the routing makes, and the
 * upload the amendment vehicle ends at.
 *
 * `paper` decides whether the record has an instrument, because the
 * amendment vehicle is drawn only when there is a chain to append to.
 */
function recordApi(
  options: {
    paper?: readonly Record<string, unknown>[];
    /** The whole record's paper, used only to resolve a Document landing
     * target that may live inside a folder. */
    landingPaper?: readonly Record<string, unknown>[];
    row?: Record<string, unknown>;
    /** What the create answers instead of a record, when the seam
     * refuses one. */
    refusal?: { status: number; detail: string };
  } = {},
) {
  const paper = options.paper ?? [PRIMARY];
  const landingPaper = options.landingPaper ?? paper;
  const row = options.row ?? contractRow();
  const creates: unknown[] = [];

  const handler = (call: StubCall) => {
    if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
      return json(200, OPTIONS);
    }
    if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
      return json(200, { entities: [] });
    }
    if (call.url.pathname === "/api/v1/contracts/42/documents" && call.method === "GET") {
      return json(200, {
        documents: call.url.searchParams.get("folder") === "root" ? paper : landingPaper,
        nextCursor: null,
      });
    }
    // Which document is the record's instrument is the record's own
    // answer, not a flag on the page of paper on screen (CTR-014), and
    // this is the read that carries it.
    if (call.url.pathname === "/api/v1/contracts/42/envelopes" && call.method === "GET") {
      const primary = paper.find((row) => row.isPrimary);
      return json(200, {
        envelopes: [],
        signingConfigured: false,
        primaryDocument: primary
          ? { id: primary.id, title: primary.title, versions: primary.versions }
          : null,
      });
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
    if (call.url.pathname === "/api/v1/contracts" && call.method === "POST") {
      creates.push(call.body);
      if (options.refusal) return problem(options.refusal.status, options.refusal.detail);
      const body = call.body as { title: string; contractTypeId: string };
      return json(201, {
        contract: contractRow({
          id: "c2",
          number: 51,
          title: body.title,
          contractTypeId: body.contractTypeId,
        }),
      });
    }
    return undefined;
  };
  return { handler, creates };
}

/** The create dialog, once a routed vehicle has opened it. Scoped
 * rather than queried off the screen, because the record page behind it
 * draws a Title box and a type picker of its own (DES-017). */
const createDialog = () => screen.findByRole("dialog");

/** Open the Renew dialog from the pending banner's call to action. */
async function openRenew() {
  await userEvent.click(await screen.findByRole("button", { name: "Review renewal" }));
  return within(await screen.findByRole("dialog"));
}

describe("the Renew dialog's four vehicles (CTR-007, DES-044)", () => {
  it("draws all four when the record has paper to amend, with the roll chosen", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42");

    const dialog = await openRenew();
    for (const name of [
      "Confirm the roll",
      "Paper as amendment",
      "Create child contract",
      "New successor contract",
    ]) {
      expect(dialog.getByRole("radio", { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(dialog.getByRole("radio", { name: /Confirm the roll/ })).toBeChecked();
    // The roll's own field, and the roll's own verb.
    expect(dialog.getByLabelText("New expiry date")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Confirm renewal" })).toBeInTheDocument();
  });

  it("leaves the amendment vehicle out entirely on a record with no instrument", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi({ paper: [] }).handler });
    renderAt("/contracts/42");

    const dialog = await openRenew();
    // DES-035 clause 9: a chain that does not exist has nothing to
    // append, so the option is absent rather than drawn dead.
    expect(dialog.queryByRole("radio", { name: /Paper as amendment/ })).not.toBeInTheDocument();
    expect(dialog.getByRole("radio", { name: /Create child contract/ })).toBeInTheDocument();
  });

  it("takes the date box and the roll's verb away once another vehicle is chosen", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42");

    const dialog = await openRenew();
    await userEvent.click(dialog.getByRole("radio", { name: /New successor contract/ }));

    // The new term is recorded on the record the vehicle is about to
    // open, not here.
    expect(dialog.queryByLabelText("New expiry date")).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Open the successor" })).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Confirm renewal" })).not.toBeInTheDocument();
  });
});

describe("the amendment vehicle (CTR-007 §2)", () => {
  it("opens the Documents section's composer on the instrument, seeded as an amendment", async () => {
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/contracts/42");

    const dialog = await openRenew();
    await userEvent.click(dialog.getByRole("radio", { name: /Paper as amendment/ }));
    await userEvent.click(dialog.getByRole("button", { name: "File the amendment" }));

    // The record's own Documents section, and the composer on its chain.
    await waitFor(() => expect(router.state.location.pathname).toBe("/contracts/42/documents"));
    expect(await screen.findByRole("heading", { name: "Add version" })).toBeInTheDocument();
    expect(screen.getByLabelText("Kind")).toHaveValue("amendment");
    // Nothing was written: the amendment is the M11 upload, and the
    // person has not chosen a file yet.
    expect(api.creates).toEqual([]);
  });

  it("does not re-open the composer after it is closed", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42");

    const dialog = await openRenew();
    await userEvent.click(dialog.getByRole("radio", { name: /Paper as amendment/ }));
    await userEvent.click(dialog.getByRole("button", { name: "File the amendment" }));
    await screen.findByRole("heading", { name: "Add version" });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Add version" })).not.toBeInTheDocument(),
    );

    // The request was answered when the composer opened, so walking out
    // of the section and back draws it again and opens nothing.
    await userEvent.click(screen.getByRole("link", { name: "Overview" }));
    const sections = within(await screen.findByRole("navigation", { name: "Contract sections" }));
    await userEvent.click(sections.getByRole("link", { name: "Documents" }));
    await screen.findByRole("region", { name: "Documents" });
    expect(screen.queryByRole("heading", { name: "Add version" })).not.toBeInTheDocument();
  });
});

describe("a Document search landing", () => {
  it("opens the requested version from a folder on the Documents tab", async () => {
    const filed = { ...PRIMARY, folderId: "folder-1" };
    stubApi({
      signedIn: MEMBER,
      extra: recordApi({ paper: [], landingPaper: [filed] }).handler,
    });

    renderAt("/contracts/42/documents?doc=doc-1&version=ver-1");

    expect(await screen.findByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(
      await screen.findByRole("complementary", {
        name: "Acme_MSA_2025.docx, version 1",
      }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close the document" }));
    expect(screen.getByRole("region", { name: "Document search landing" })).toHaveFocus();
  });

  it("leaves the Documents tab open without a panel for a missing target", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi({ paper: [], landingPaper: [] }).handler });

    renderAt("/contracts/42/documents?doc=missing&version=missing");

    expect(await screen.findByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});

describe("the child and successor vehicles (CTR-007 §3, §4)", () => {
  it("opens the create dialog prefilled from the record, and says what did not come across", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42");

    const renew = await openRenew();
    await userEvent.click(renew.getByRole("radio", { name: /Create child contract/ }));
    await userEvent.click(renew.getByRole("button", { name: "Open the child contract" }));

    expect(
      await screen.findByRole("heading", { name: "Create child contract" }),
    ).toBeInTheDocument();
    const create = within(await createDialog());
    // The two fields this dialog draws are seeded from the record.
    expect(create.getByLabelText("Title")).toHaveValue("Acme master services agreement");
    expect(create.getByLabelText("Contract type")).toHaveValue("t-msa");
    // And CTR-015's stance is said rather than left to be discovered.
    expect(
      create.getByText(
        "Prefilled from C-42 and born under it. The counterparties, our entity, the value, " +
          "and the term came across; the team, the status, and the Confidential flag did not. " +
          "Edit anything before you create it.",
      ),
    ).toBeInTheDocument();
  });

  it("sends whatever the person edited, plus which record and which vehicle", async () => {
    const api = recordApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/contracts/42");

    const renew = await openRenew();
    await userEvent.click(renew.getByRole("radio", { name: /New successor contract/ }));
    await userEvent.click(renew.getByRole("button", { name: "Open the successor" }));

    await screen.findByRole("heading", { name: "Create successor contract" });
    const create = within(await createDialog());
    const title = create.getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "Acme MSA 2027");
    await userEvent.selectOptions(create.getByLabelText("Contract type"), "t-nda");
    await userEvent.click(create.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(api.creates).toEqual([
        {
          title: "Acme MSA 2027",
          contractTypeId: "t-nda",
          customFields: {},
          isConfidential: false,
          // The routing, and nothing about what it copies: the seam owns
          // the prefill, so this page cannot disagree with it.
          renewalOf: { number: 42, vehicle: "successor" },
        },
      ]),
    );
    // Straight to the record that was just born.
    await waitFor(() => expect(router.state.location.pathname).toBe("/contracts/51"));
  });

  it("prints the seam's refusal and keeps the dialog open when the create is refused", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi({
        refusal: { status: 409, detail: "This contract is archived. Restore it before editing." },
      }).handler,
    });
    const { router } = renderAt("/contracts/42");

    const renew = await openRenew();
    await userEvent.click(renew.getByRole("radio", { name: /New successor contract/ }));
    await userEvent.click(renew.getByRole("button", { name: "Open the successor" }));

    await screen.findByRole("heading", { name: "Create successor contract" });
    const create = within(await createDialog());
    await userEvent.click(create.getByRole("button", { name: "Create" }));

    // The seam's own sentence, printed once, with the form still there
    // and still holding what it was given (DES-035 clause 12).
    expect(
      await create.findByText("This contract is archived. Restore it before editing."),
    ).toBeInTheDocument();
    expect(create.getByLabelText("Title")).toHaveValue("Acme master services agreement");
    expect(router.state.location.pathname).toBe("/contracts/42");
  });

  it("starts the Confidential flag off, however the predecessor is flagged", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi({ row: contractRow({ isConfidential: true }) }).handler,
    });
    renderAt("/contracts/42");

    const renew = await openRenew();
    await userEvent.click(renew.getByRole("radio", { name: /New successor contract/ }));
    await userEvent.click(renew.getByRole("button", { name: "Open the successor" }));

    await screen.findByRole("heading", { name: "Create successor contract" });
    // The audience is decided for this record, by whoever makes it
    // (CTR-015's no-inheritance stance, DD-014's default).
    expect(
      within(await createDialog()).getByRole("switch", {
        name: "Confidential — restrict to the contract team",
      }),
    ).not.toBeChecked();
  });
});
