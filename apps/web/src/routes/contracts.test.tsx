// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The /contracts destination (M8/1), through the real route table with
 * the standard fetch stub: Member+ lands on the list, which shows each
 * contract's C-### reference, title, primary counterparty, type, and
 * status and links to the record by number; the create dialog takes a
 * title and a type and
 * adds the created contract to the list; the show-archived toggle
 * re-reads the list and offers a row-level restore. Contributors are
 * bounced home; unauthenticated visitors land on login.
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
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The list loader's two reads plus the mutations under test. The list
 * is stateful: creating adds a row, and the archived read answers with
 * the archived rows appended. */
function listApi(live: Record<string, unknown>[], archived: Record<string, unknown>[] = []) {
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
      const all = call.url.searchParams.get("includeArchived") === "true";
      return json(200, { contracts: all ? [...rows, ...archived] : rows, cursor: null });
    }
    if (call.url.pathname === "/api/v1/contracts" && call.method === "POST") {
      creates.push(call.body);
      const body = call.body as {
        title: string;
        contractTypeId: string;
        customFields?: Record<string, unknown>;
      };
      const created = contractRow({
        id: "c-new",
        number: 43,
        title: body.title,
        contractTypeId: body.contractTypeId,
        contractTypeName: body.contractTypeId === "t-nda" ? "NDA" : "MSA",
        customFields: body.customFields ?? {},
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
        { title: "Globex NDA", contractTypeId: "t-nda", customFields: {} },
      ]),
    );
    expect(await screen.findByRole("link", { name: "Globex NDA" })).toHaveAttribute(
      "href",
      "/contracts/43",
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
          return json(200, { contracts: [], cursor: null });
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
            : json(200, { contracts: [contractRow()], cursor: null });
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

  it("bounces a Contributor home", async () => {
    stubApi({ signedIn: CONTRIBUTOR });
    renderAt("/contracts");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("sends an unauthenticated visitor to login", async () => {
    stubApi({ signedIn: null, needsSetup: false });
    renderAt("/contracts");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
