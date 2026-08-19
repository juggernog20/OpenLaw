// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The /contracts destination (M8/1), through the real route table with
 * the standard fetch stub: Member+ lands on the list, which shows each
 * contract's C-### reference, title, primary counterparty, type, and
 * status and links to the record by number; the create dialog takes a
 * title and a type and
 * adds the created contract to the list; the show-archived toggle
 * re-reads the list and offers a row-level restore.
 *
 * A Contributor lands on the same list read-only (M9/1): the API
 * answers them exactly the contracts they hold a `contract_team` row
 * on, the page offers no create and no restore, and neither Member+
 * picker read is asked for. An empty answer is the list's own empty
 * state. Business Users are bounced home; unauthenticated visitors land
 * on login.
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
const BUSINESS = {
  id: "u9",
  email: "business@example.com",
  displayName: "Bao Business",
  role: "business_user",
};

/** The Governing law field, hard-required on MSAs and unattached to
 * NDAs — the CTR-016 attachment the create dialog grows for. */
const GOVERNING_LAW = {
  fieldId: "f-law",
  slug: "governing_law",
  displayName: "Governing law",
  description: null,
  fieldType: "text",
  options: null,
  displayOrder: 1,
  isRequired: true,
};

const OPTIONS = {
  contractTypes: [
    { id: "t-nda", slug: "nda", displayName: "NDA", fields: [] },
    { id: "t-msa", slug: "msa", displayName: "MSA", fields: [GOVERNING_LAW] },
  ],
  contractStatuses: [
    { id: "s-draft", slug: "draft", displayName: "Draft", stage: "draft" },
    { id: "s-active", slug: "active", displayName: "Active", stage: "active" },
  ],
  users: [
    {
      id: "u2",
      displayName: "Nadia Counsel",
      image: null,
      archived: false,
      role: "legal_team_member",
    },
  ],
};

/** The Owner as a list row carries them (CTR-004). */
const OWNER = { id: "u2", displayName: "Nadia Counsel", image: null, archived: false };

function contractRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "c1",
    number: 42,
    title: "Acme master services agreement",
    contractTypeId: "t-msa",
    contractTypeName: "MSA",
    statusId: "s-draft",
    statusName: "Draft",
    stage: "draft",
    // Unassigned until someone takes it (CTR-004).
    manager: null,
    // Nobody is recorded on the other side yet (CTR-011).
    primaryCounterparty: null,
    priority: "medium",
    risk: null,
    // No value is recorded, which is where every contract starts
    // (CTR-010).
    value: null,
    description: null,
    customFields: {},
    // Open by default; the flag is opt-in, per record (DD-014).
    isConfidential: false,
    // Never moved to an ended status (CTR-019).
    endedAt: null,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The list loader's two reads plus the mutations under test. The list
 * is stateful: creating adds a row, and the archived read answers with
 * the archived rows appended. */
function listApi(
  live: Record<string, unknown>[],
  archived: Record<string, unknown>[] = [],
  ended: Record<string, unknown>[] = [],
) {
  const rows = [...live];
  const creates: unknown[] = [];
  const restores: string[] = [];
  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
      return json(200, OPTIONS);
    }
    // The create dialog can grow an `entity` field, so the list reads
    // the M7 registry the same way the record does (CTR-016).
    if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
      return json(200, { entities: [] });
    }
    if (call.url.pathname === "/api/v1/contracts" && call.method === "GET") {
      const withArchived = call.url.searchParams.get("includeArchived") === "true";
      const withEnded = call.url.searchParams.get("includeEnded") === "true";
      return json(200, {
        contracts: [...rows, ...(withEnded ? ended : []), ...(withArchived ? archived : [])],
        nextCursor: null,
      });
    }
    if (call.url.pathname === "/api/v1/contracts" && call.method === "POST") {
      creates.push(call.body);
      const body = call.body as {
        title: string;
        contractTypeId: string;
        customFields?: Record<string, unknown>;
        isConfidential?: boolean;
      };
      const created = contractRow({
        id: "c-new",
        number: 43,
        title: body.title,
        contractTypeId: body.contractTypeId,
        contractTypeName: body.contractTypeId === "t-nda" ? "NDA" : "MSA",
        customFields: body.customFields ?? {},
        isConfidential: body.isConfidential ?? false,
      });
      rows.unshift(created);
      return json(201, { contract: created });
    }
    const restore = /^\/api\/v1\/contracts\/(\d+)\/restore$/.exec(call.url.pathname);
    if (restore && call.method === "POST") {
      restores.push(restore[1]!);
      const row = archived.find((candidate) => String(candidate.number) === restore[1]);
      return json(200, { contract: { ...row, archivedAt: null } });
    }
    return undefined;
  };
  return { handler, creates, restores };
}

/** The sub-bar's create action. The empty state offers the same verb,
 * so the query is scoped rather than ambiguous. */
async function openCreateDialog(user: ReturnType<typeof userEvent.setup>) {
  const subbar = await screen.findByRole("region", { name: "Contracts" });
  await user.click(within(subbar).getByRole("button", { name: "Create contract" }));
}

describe("the /contracts destination", () => {
  it("shows a Legal Team Member the list, linked to each record by number", async () => {
    stubApi({ signedIn: MEMBER, extra: listApi([contractRow()]).handler });
    renderAt("/contracts");

    expect(await screen.findByRole("heading", { level: 1, name: "Contracts" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Acme master services agreement/ });
    expect(within(row).getByText("C-42")).toBeInTheDocument();
    expect(
      within(row).getByRole("link", { name: "Acme master services agreement" }),
    ).toHaveAttribute("href", "/contracts/42");
    expect(within(row).getByText("MSA")).toBeInTheDocument();
    expect(within(row).getByText("Draft")).toBeInTheDocument();
    // Unassigned is a state the list states, not a blank cell (CTR-004).
    expect(within(row).getByText("Unassigned")).toBeInTheDocument();
    // So is nobody on the other side yet (CTR-011).
    expect(within(row).getByText("None recorded")).toBeInTheDocument();
  });

  it("names the primary counterparty on the row, so the list answers who it is with", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: listApi([
        contractRow({ primaryCounterparty: { id: "cp-orion", name: "Orion Cloud Ltd" } }),
      ]).handler,
    });
    renderAt("/contracts");

    // One name per row: the primary is what a list can show, and the
    // record holds the rest of a tripartite deal (CTR-011).
    const row = await screen.findByRole("row", { name: /Acme master services agreement/ });
    expect(within(row).getByText("Orion Cloud Ltd")).toBeInTheDocument();
  });

  it("renders the value with its cadence suffix, and says so when there is none", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: listApi([
        contractRow({ value: { amount: 48_000_000, currency: "USD", cadence: "annually" } }),
        contractRow({
          id: "c2",
          number: 41,
          title: "Mutual NDA",
          value: null,
        }),
      ]).handler,
    });
    renderAt("/contracts");

    // DES-014: the full figure with the locale's own symbol and
    // grouping — never a compact "$480K".
    const priced = await screen.findByRole("row", { name: /Acme master services agreement/ });
    expect(within(priced).getByText("$480,000.00 /year")).toBeInTheDocument();
    // No value recorded is a real state, not a gap (CTR-010).
    const free = screen.getByRole("row", { name: /Mutual NDA/ });
    expect(within(free).getByText("No value")).toBeInTheDocument();
  });

  it("names the Owner on the row, so the list answers who runs what", async () => {
    stubApi({ signedIn: MEMBER, extra: listApi([contractRow({ manager: OWNER })]).handler });
    renderAt("/contracts");

    const row = await screen.findByRole("row", { name: /Acme master services agreement/ });
    expect(within(row).getByText("Nadia Counsel")).toBeInTheDocument();
  });

  it("pitches the module when nothing exists yet", async () => {
    stubApi({ signedIn: MEMBER, extra: listApi([]).handler });
    renderAt("/contracts");
    expect(await screen.findByText("No contracts yet")).toBeInTheDocument();
  });

  it("creates a contract from a title and a type, and shows it in the list", async () => {
    const api = listApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts");
    const user = userEvent.setup();

    await openCreateDialog(user);
    await user.type(screen.getByLabelText("Title"), "Globex NDA");
    await user.selectOptions(screen.getByLabelText("Contract type"), "t-nda");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(api.creates).toEqual([
        { title: "Globex NDA", contractTypeId: "t-nda", customFields: {}, isConfidential: false },
      ]),
    );
    expect(await screen.findByRole("link", { name: "Globex NDA" })).toHaveAttribute(
      "href",
      "/contracts/43",
    );
  });

  it("sets the Confidential flag at creation, so the record is never open even briefly", async () => {
    // DD-014's story 5: the actor is the creator by definition, so
    // whoever may create a contract may be born one confidential.
    const api = listApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts");
    const user = userEvent.setup();

    await openCreateDialog(user);
    await user.type(screen.getByLabelText("Title"), "Project Atlas NDA");
    await user.selectOptions(screen.getByLabelText("Contract type"), "t-nda");
    await user.click(
      screen.getByRole("switch", { name: "Confidential — restrict to the contract team" }),
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(api.creates).toEqual([
        {
          title: "Project Atlas NDA",
          contractTypeId: "t-nda",
          customFields: {},
          isConfidential: true,
        },
      ]),
    );
  });

  it("refuses to create without a title or a type, and keeps the dialog open", async () => {
    const api = listApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts");
    const user = userEvent.setup();

    await openCreateDialog(user);
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Name the contract.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Title"), "Untyped");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Pick a contract type.")).toBeInTheDocument();
    expect(api.creates).toEqual([]);
  });

  it("grows the picked type's hard-required fields, and refuses to create while one is empty", async () => {
    const api = listApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts");
    const user = userEvent.setup();

    await openCreateDialog(user);
    await user.type(screen.getByLabelText("Title"), "Orion MSA");
    // The NDA demands nothing, so the dialog asks for nothing.
    await user.selectOptions(screen.getByLabelText("Contract type"), "t-nda");
    expect(screen.queryByLabelText(/Governing law/)).not.toBeInTheDocument();

    // The MSA demands one field, and it appears the moment it is picked.
    await user.selectOptions(screen.getByLabelText("Contract type"), "t-msa");
    const law = await screen.findByLabelText(/Governing law/);

    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(
      await screen.findByText("Fill Governing law — this contract type requires it."),
    ).toBeInTheDocument();
    expect(api.creates).toEqual([]);

    await user.type(law, "England & Wales");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(api.creates).toEqual([
        {
          title: "Orion MSA",
          contractTypeId: "t-msa",
          customFields: { governing_law: "England & Wales" },
          isConfidential: false,
        },
      ]),
    );
  });

  it("shows the API's refusal in the dialog", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
          return json(200, OPTIONS);
        }
        if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
          return json(200, { entities: [] });
        }
        if (call.url.pathname === "/api/v1/contracts" && call.method === "GET") {
          return json(200, { contracts: [], nextCursor: null });
        }
        if (call.url.pathname === "/api/v1/contracts" && call.method === "POST") {
          return problem(400, "The contract type must be a live contract type.");
        }
        return undefined;
      },
    });
    renderAt("/contracts");
    const user = userEvent.setup();

    await openCreateDialog(user);
    await user.type(screen.getByLabelText("Title"), "Doomed");
    await user.selectOptions(screen.getByLabelText("Contract type"), "t-nda");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByText("The contract type must be a live contract type."),
    ).toBeInTheDocument();
  });

  it("reveals archived contracts behind the toggle, with a row-level restore", async () => {
    const api = listApi(
      [contractRow()],
      [
        contractRow({
          id: "c2",
          number: 7,
          title: "Old pilot",
          archivedAt: "2026-08-10T00:00:00Z",
        }),
      ],
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts");
    const user = userEvent.setup();

    expect(await screen.findByText("C-42")).toBeInTheDocument();
    expect(screen.queryByText("C-7")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Show archived" }));
    expect(await screen.findByText("C-7")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore Old pilot" }));
    await waitFor(() => expect(api.restores).toEqual(["7"]));
    // The restored row reads as live: no Archived pill, and the offer
    // to restore it is gone.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Restore Old pilot" })).not.toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole("row", { name: /Old pilot/ })).queryByText("Archived"),
    ).toBeNull();
  });

  it("reveals ended contracts behind the Show inactive toggle (CTR-019)", async () => {
    const api = listApi(
      [contractRow()],
      [],
      [
        contractRow({
          id: "c3",
          number: 9,
          title: "Expired supply deal",
          statusId: "s-expired",
          statusName: "Expired",
          stage: "ended",
          endedAt: "2026-08-12T00:00:00Z",
        }),
      ],
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts");
    const user = userEvent.setup();

    // The default list hides the dead deal (CTR-019).
    expect(await screen.findByText("C-42")).toBeInTheDocument();
    expect(screen.queryByText("C-9")).not.toBeInTheDocument();

    // The toggle re-reads with includeEnded and the deal appears.
    await user.click(screen.getByRole("switch", { name: "Show inactive" }));
    expect(await screen.findByText("C-9")).toBeInTheDocument();

    // And back: the toggle off re-reads the default list.
    await user.click(screen.getByRole("switch", { name: "Show inactive" }));
    await waitFor(() => expect(screen.queryByText("C-9")).not.toBeInTheDocument());
    expect(screen.getByText("C-42")).toBeInTheDocument();
  });

  it("reports a failed archived re-read instead of showing a stale list", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
          return json(200, OPTIONS);
        }
        if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
          return json(200, { entities: [] });
        }
        if (call.url.pathname === "/api/v1/contracts" && call.method === "GET") {
          return call.url.searchParams.get("includeArchived") === "true"
            ? problem(500, "The contract list could not be read.")
            : json(200, { contracts: [contractRow()], nextCursor: null });
        }
        return undefined;
      },
    });
    renderAt("/contracts");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("switch", { name: "Show archived" }));
    expect(
      await screen.findByText("The contract list could not be read. Try again."),
    ).toBeInTheDocument();
    // The live list stands; the toggle did not flip on a failed read.
    expect(screen.getByText("C-42")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show archived" })).not.toBeChecked();
  });

  it("bounces a Business User home", async () => {
    stubApi({ signedIn: BUSINESS });
    renderAt("/contracts");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("sends an unauthenticated visitor to login", async () => {
    stubApi({ signedIn: null, needsSetup: false });
    renderAt("/contracts");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});

/**
 * DES-009's Tier 1 marker in the list (M10/5). The list is the one
 * surface in this build that renders a contract title outside the
 * record page, so it is the one place the marker goes today.
 *
 * jsdom computes no colours, so what is asserted is the token class
 * that carries the treatment — the same thing the banner's own tests
 * assert, and the contrast lint covers the values.
 */
describe("the confidential marker in the contract list (M10/5)", () => {
  const MARKER = "Confidential";

  it("marks a confidential row beside its title, and marks nothing else", async () => {
    const api = listApi([
      contractRow({ id: "c1", number: 42, title: "Acme master services agreement" }),
      contractRow({ id: "c2", number: 55, title: "Beacon sponsorship", isConfidential: true }),
    ]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts");

    const walled = await screen.findByRole("row", { name: /Beacon sponsorship/ });
    const marker = within(walled).getByRole("img", { name: MARKER });
    // DES-009's literal label, in DES-009's own foreground token.
    expect(marker).toHaveClass("text-confidential");
    // Uppercase and letter-spaced, as DES-009 draws it.
    expect(within(marker).getByText("CONFI")).toHaveClass("uppercase", "tracking-[0.4px]");
    // The open record carries nothing at all — the marker is the
    // exception, and the absence of one is the rule.
    const open = screen.getByRole("row", { name: /Acme master services agreement/ });
    expect(within(open).queryByRole("img", { name: MARKER })).not.toBeInTheDocument();
  });

  it("never doubles as a placeholder for a record the viewer cannot reach", async () => {
    // The seam answers this viewer the contracts they may reach and no
    // others (DD-014, CTR-021). A record they cannot reach is not a
    // marked row — it is no row, and no count.
    const api = listApi([contractRow({ id: "c1", number: 42, title: "Acme master services" })]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts");

    expect(await screen.findByText("C-42")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2); // the header and the one row
    expect(screen.queryByRole("img", { name: MARKER })).not.toBeInTheDocument();
    expect(screen.getByText("1 contract")).toBeInTheDocument();
  });

  it("uses one Lock glyph, and no alternate icon", async () => {
    const api = listApi([contractRow({ isConfidential: true })]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { view } = renderAt("/contracts");

    const marker = await screen.findByRole("img", { name: MARKER });
    expect(marker.querySelector("svg.lucide-lock")).not.toBeNull();
    // DES-009 admits no alternate — the glyph is the affordance.
    expect(view.container.querySelector("svg.lucide-shield-alert")).toBeNull();
    expect(view.container.querySelector("svg.lucide-eye-off")).toBeNull();
  });
});

describe("a Contributor on the /contracts destination (M9/1)", () => {
  /**
   * The list stub with both Member+ picker reads walled off. The
   * create dialog is what needs them, and a Contributor has no create
   * dialog — `pickerReads` is what proves the loader never asks.
   */
  function contributorApi(...args: Parameters<typeof listApi>) {
    const api = listApi(...args);
    const pickerReads: string[] = [];
    const handler = (call: StubCall): Response | undefined => {
      if (["/api/v1/contracts/options", "/api/v1/entities"].includes(call.url.pathname)) {
        pickerReads.push(call.url.pathname);
        return problem(403, "You do not have permission to perform this action.");
      }
      return api.handler(call);
    };
    return { ...api, handler, pickerReads };
  }

  it("shows a Contributor their contracts, with no way to create one", async () => {
    const api = contributorApi([contractRow()]);
    stubApi({ signedIn: CONTRIBUTOR, extra: api.handler });
    renderAt("/contracts");

    expect(await screen.findByRole("heading", { level: 1, name: "Contracts" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Acme master services agreement/ });
    expect(
      within(row).getByRole("link", { name: "Acme master services agreement" }),
    ).toHaveAttribute("href", "/contracts/42");
    // Absent, not disabled — the same convention the nav follows.
    expect(screen.queryByRole("button", { name: "Create contract" })).not.toBeInTheDocument();
    expect(api.pickerReads).toEqual([]);
    expect(api.creates).toEqual([]);
  });

  it("gives a Contributor on no contract the list's empty state, not a refusal", async () => {
    const api = contributorApi([]);
    stubApi({ signedIn: CONTRIBUTOR, extra: api.handler });
    renderAt("/contracts");

    expect(await screen.findByRole("heading", { name: "No contracts yet" })).toBeInTheDocument();
    // The pitch a Contributor gets says how a row lands here, because
    // making one is not something they can do (DD-015).
    expect(screen.getByText(/Contracts you are added to appear here/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create contract" })).not.toBeInTheDocument();
  });

  it("shows a Contributor archived contracts behind the same toggle, with no restore", async () => {
    const api = contributorApi(
      [contractRow()],
      [
        contractRow({
          id: "c2",
          number: 41,
          title: "Mutual NDA",
          archivedAt: "2026-08-02T00:00:00.000Z",
        }),
      ],
    );
    stubApi({ signedIn: CONTRIBUTOR, extra: api.handler });
    renderAt("/contracts");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("switch", { name: "Show archived" }));
    const archived = await screen.findByRole("row", { name: /Mutual NDA/ });
    expect(within(archived).getByText("Archived")).toBeInTheDocument();
    // Restore is a mutation, so no row offers one and the actions
    // column never appears.
    expect(screen.queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument();
    expect(api.restores).toEqual([]);
  });
});

/**
 * The bound and its foot (CTR-024, DES-031).
 *
 * The list is paged from a server-fixed page size, so the page can no
 * longer say how many contracts exist — only how many are on screen —
 * and the way to the rest is a control under the table rather than a
 * scroll sentinel nobody can reach with a keyboard.
 */
describe("the paged contract list (CTR-024, DES-031)", () => {
  const FIRST = [contractRow({ id: "c-1", number: 42, title: "Acme master services agreement" })];
  const SECOND = [contractRow({ id: "c-2", number: 41, title: "Orion supply agreement" })];

  /** Two pages, the second reached only with the first's cursor. */
  function pagedApi() {
    const cursors: (string | null)[] = [];
    const handler = (call: StubCall): Response | undefined => {
      if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
        return json(200, OPTIONS);
      }
      if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
        return json(200, { entities: [] });
      }
      if (call.url.pathname === "/api/v1/contracts" && call.method === "GET") {
        const cursor = call.url.searchParams.get("cursor");
        cursors.push(cursor);
        return cursor === null
          ? json(200, { contracts: FIRST, nextCursor: "c-1" })
          : json(200, { contracts: SECOND, nextCursor: null });
      }
      return undefined;
    };
    return { handler, cursors };
  }

  it("appends the next page in place, and says what is on screen rather than a total", async () => {
    const api = pagedApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts");
    const user = userEvent.setup();

    // One row, and the page says so without claiming to be the list.
    expect(await screen.findByRole("link", { name: FIRST[0]!.title })).toBeInTheDocument();
    expect(screen.getByText("1 contract shown")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show more" }));

    // Appended, not replaced: the first page is still there above it.
    expect(await screen.findByRole("link", { name: SECOND[0]!.title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: FIRST[0]!.title })).toBeInTheDocument();
    // The read carried the first page's cursor.
    expect(api.cursors).toEqual([null, "c-1"]);
    // The end of the list: the foot goes, and the count stops hedging
    // because it is now the whole of it.
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    expect(screen.getByText("2 contracts")).toBeInTheDocument();
  });

  it("puts focus on the first row it appended, and says how many followed", async () => {
    stubApi({ signedIn: MEMBER, extra: pagedApi().handler });
    renderAt("/contracts");
    const user = userEvent.setup();

    await screen.findByRole("link", { name: FIRST[0]!.title });
    await user.click(screen.getByRole("button", { name: "Show more" }));

    // The rows are the answer, so focus lands where the answer starts —
    // the row itself, so a screen reader hears the whole of it.
    const landed = (await screen.findByRole("link", { name: SECOND[0]!.title })).closest("tr");
    await waitFor(() => expect(landed).toHaveFocus());
    expect(screen.getByText("1 more contract. 2 shown.")).toBeInTheDocument();
  });

  it("keeps the foot and the cursor when a page fails, so the retry is the same button", async () => {
    // The first reach for the next page is refused; the second is not.
    // A failed page must not consume the cursor, or the rest of the
    // list becomes unreachable from a control that is still on screen.
    let reached = 0;
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall): Response | undefined => {
        if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
          return json(200, OPTIONS);
        }
        if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
          return json(200, { entities: [] });
        }
        if (call.url.pathname === "/api/v1/contracts" && call.method === "GET") {
          if (call.url.searchParams.get("cursor") === null) {
            return json(200, { contracts: FIRST, nextCursor: "c-1" });
          }
          reached += 1;
          return reached === 1
            ? problem(503, "The list is not available.")
            : json(200, { contracts: SECOND, nextCursor: null });
        }
        return undefined;
      },
    });
    renderAt("/contracts");
    const user = userEvent.setup();

    await screen.findByRole("link", { name: FIRST[0]!.title });
    await user.click(screen.getByRole("button", { name: "Show more" }));

    // The failure is spoken beside the control, and the control stays.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The next contracts could not be read. Try again.",
    );
    const again = screen.getByRole("button", { name: "Show more" });
    expect(again).toBeInTheDocument();
    // Nothing was appended, and the count still hedges.
    expect(screen.queryByRole("link", { name: SECOND[0]!.title })).not.toBeInTheDocument();
    expect(screen.getByText("1 contract shown")).toBeInTheDocument();

    await user.click(again);

    // The same cursor carried again, so the retry lands where the
    // failure left off rather than at the top of the list.
    expect(await screen.findByRole("link", { name: SECOND[0]!.title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: FIRST[0]!.title })).toBeInTheDocument();
    expect(screen.getByText("2 contracts")).toBeInTheDocument();
  });

  it("draws no foot at all when the first page is the whole list", async () => {
    stubApi({ signedIn: MEMBER, extra: listApi([contractRow()]).handler });
    renderAt("/contracts");

    await screen.findByRole("link", { name: /Acme master services agreement/ });
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    expect(screen.getByText("1 contract")).toBeInTheDocument();
  });
});
