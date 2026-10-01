// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";
import type { TrustRegister } from "../lib/trust-register";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};

const TODAY = new Date().toISOString().slice(0, 10);

function entity(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    legalName: "Calloway Capital Partners Ltd",
    entityTypeId: "t-corp",
    entityTypeName: "Corporation",
    registerKind: "trust",
    typeRegisterKind: "trust",
    registerKindSource: "type",
    registerKindLocked: false,
    registerKindLockReason: null,
    headOfficeEntityId: null,
    jurisdiction: "Cayman Islands",
    formedOn: null,
    registrationNumber: null,
    taxId: null,
    registeredAgent: null,
    registeredAddress: null,
    status: "active",
    sharesAuthorized: null,
    sharesIssued: 750_000,
    parValue: null,
    parValueCurrency: null,
    customFields: {},
    isConfidential: false,
    portalListed: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const individual = {
  restricted: false as const,
  id: "p1",
  kind: "individual" as const,
  name: "Devon Calloway",
  entityId: null,
};
const restricted = { restricted: true as const, id: "p2" };
const beneficiary = {
  ...individual,
  id: "p3",
  kind: "class" as const,
  name: "Children of the Settlor",
};
function registerAt(asOf = TODAY): TrustRegister {
  const entries: TrustRegister["entries"] = [
    {
      id: "en1",
      entryNo: 1,
      kind: "settlement",
      effectiveOn: "2020-01-01",
      party: individual,
      role: null,
      roleLabel: null,
      interest: null,
      amount: 100000,
      currency: "AED",
      property: null,
      reference: "Deed 1",
      note: null,
      applied: true,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "en2",
      entryNo: 2,
      kind: "appointment",
      effectiveOn: "2020-01-01",
      party: restricted,
      role: "trustee",
      roleLabel: null,
      interest: "All trustee powers",
      amount: null,
      currency: null,
      property: null,
      reference: "Deed 2",
      note: null,
      applied: true,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "en3",
      entryNo: 3,
      kind: "appointment",
      effectiveOn: "2020-01-01",
      party: beneficiary,
      role: "beneficiary",
      roleLabel: null,
      interest: "Discretionary interest",
      amount: null,
      currency: null,
      property: null,
      reference: null,
      note: null,
      applied: true,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    },
  ];
  entries.push({
    ...entries[1]!,
    id: "en4",
    entryNo: 4,
    kind: "cessation",
    effectiveOn: "2023-01-01",
    applied: asOf >= "2023-01-01",
  });
  const parties = [
    {
      party: beneficiary,
      role: "beneficiary" as const,
      roleLabel: null,
      interest: "Discretionary interest",
      since: "2020-01-01",
      until: null,
      open: true,
      openToday: true,
    },
    {
      party: restricted,
      role: "trustee" as const,
      roleLabel: null,
      interest: "All trustee powers",
      since: "2020-01-01",
      until: asOf >= "2023-01-01" ? "2023-01-01" : null,
      open: asOf < "2023-01-01",
      openToday: false,
    },
    {
      party: individual,
      role: "settlor" as const,
      roleLabel: null,
      interest: null,
      since: "2020-01-01",
      until: null,
      open: true,
      openToday: true,
    },
  ];
  return {
    asOf,
    today: TODAY,
    entries,
    parties,
    partiesToday: parties.filter((p) => p.openToday),
    dates: ["2020-01-01", "2023-01-01"],
    fund: [
      { currency: "AED", settled: 100000, distributed: 120000, balance: -20000 },
      { currency: "USD", settled: 50000, distributed: 0, balance: 50000 },
    ],
    warnings: [{ code: "fund-negative", currency: "AED", balance: -20000 }],
  };
}
function registerApi(options: { empty?: boolean; refuse?: string; frozen?: boolean } = {}) {
  const writes: StubCall[] = [];
  const reads: StubCall[] = [];
  return {
    writes,
    reads,
    handler(call: StubCall) {
      if (call.url.pathname === "/api/v1/entities/types")
        return json(200, {
          entityTypes: [{ id: "t-corp", slug: "corporation", displayName: "Corporation" }],
        });
      if (call.url.pathname === "/api/v1/entities/e1" && call.method === "GET")
        return json(200, {
          entity: entity({ archivedAt: options.frozen ? "2026-01-01T00:00:00.000Z" : null }),
          fields: [],
          customFieldRefs: { users: [], entities: [] },
        });
      if (call.url.pathname === "/api/v1/entities/e1/trust-register") {
        reads.push(call);
        const register = registerAt(call.url.searchParams.get("asOf") ?? TODAY);
        return json(
          200,
          options.empty
            ? {
                ...register,
                entries: [],
                parties: [],
                partiesToday: [],
                fund: [],
                dates: [],
                warnings: [],
              }
            : register,
        );
      }
      if (call.url.pathname.includes("/trust-entries")) {
        writes.push(call);
        return options.refuse
          ? problem(409, options.refuse)
          : call.method === "DELETE"
            ? new Response(null, { status: 204 })
            : json(200, registerAt());
      }
      return undefined;
    },
  };
}
const section = (name: string | RegExp) =>
  screen.getByRole("heading", { name }).closest("section")!;

describe("the trust Ownership tab", () => {
  it("loads the register and renders the DES-096 order, grouped roles, fund and exports", async () => {
    const api = registerApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1/ownership?asOf=2022-01-01");
    await screen.findByRole("heading", { name: /Register of trust parties/ });
    expect(api.reads[0]?.url.searchParams.get("asOf")).toBe("2022-01-01");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Register as of",
      "Register of trust parties at Jan 1, 2022",
      "Register of trust entries",
      "Holdings in other Entities",
    ]);
    const parties = section(/Register of trust parties/);
    const rows = within(parties).getAllByRole("row");
    expect(
      rows.filter((r) => r.querySelector('[scope="rowgroup"]')).map((r) => r.textContent),
    ).toEqual(["Settlors", "Trustees", "Beneficiaries"]);
    expect(within(parties).getByText("Restricted Entity")).toBeInTheDocument();
    expect(within(parties).getByText("Class")).toBeInTheDocument();
    expect(within(parties).getByText("Change to today")).toBeInTheDocument();
    expect(within(parties).getByText("Ceased")).toBeInTheDocument();
    expect(within(parties).getByText("Deed 1")).toBeInTheDocument();
    expect(
      screen.getByText(/3 parties · 3 roles · derived from 3 register entries/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Settled 1,000 AED/)).toHaveTextContent(
      "Distributed 1,200 AED · Fund -200 AED",
    );
    expect(screen.getByText(/Settled 500 USD/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Distributions exceed settlements in AED");
    expect(screen.getByRole("link", { name: "Export register" })).toHaveAttribute(
      "href",
      "/api/v1/entities/e1/trust-register/export?kind=parties&asOf=2022-01-01",
    );
    expect(screen.getByRole("link", { name: "Export" })).toHaveAttribute(
      "href",
      "/api/v1/entities/e1/trust-register/export?kind=entries",
    );
    expect(screen.getByRole("link", { name: "Export" })).toHaveAttribute("download");
    const entries = within(section("Register of trust entries")).getAllByRole("row").slice(1);
    expect(entries[3]).toHaveAttribute("data-applied", "false");
    expect(screen.queryByRole("button", { name: "Add Holding" })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reset to today" }));
    await screen.findByRole("heading", { name: "Register of trust parties" });
    expect(screen.queryByText("Change to today")).not.toBeInTheDocument();
  });
  it("filters by entry, role, party and effective date", async () => {
    stubApi({ signedIn: MEMBER, extra: registerApi().handler });
    const { router } = renderAt(
      "/entities/e1/ownership?kind=appointment&role=beneficiary&party=p3&effectiveFrom=2020-01-01&effectiveTo=2020-12-31",
    );
    await screen.findByRole("heading", { name: "Register of trust entries" });
    expect(within(section("Register of trust entries")).getAllByRole("row")).toHaveLength(2);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove Entry filter" }));
    await waitFor(() => expect(router.state.location.search).not.toContain("kind="));
    await user.click(screen.getByRole("button", { name: /^Filter/ }));
    const filter = screen.getByRole("dialog", { name: "Filter" });
    for (const name of ["Entry", "Role", "Party", "Effective date"])
      expect(
        within(filter).getByRole("button", { name: new RegExp(`^${name}`) }),
      ).toBeInTheDocument();
  });
  it("offers Record entry on an empty register and freezes archived writes", async () => {
    stubApi({ signedIn: MEMBER, extra: registerApi({ empty: true, frozen: true }).handler });
    renderAt("/entities/e1/ownership");
    await screen.findByRole("heading", { name: "No trust register yet" });
    expect(screen.queryByRole("heading", { name: "Register as of" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record entry" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Holdings in other Entities" })).toBeInTheDocument();
  });
  it.each(["appointment", "cessation", "settlement", "distribution"] as const)(
    "records %s with its fields and shows a refused write",
    async (kind) => {
      const api = registerApi({ refuse: "Entry 5: The party already holds this role." });
      stubApi({ signedIn: MEMBER, extra: api.handler });
      renderAt("/entities/e1/ownership");
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Record entry" }));
      const dialog = screen.getByRole("dialog", { name: "Record entry" });
      await user.selectOptions(within(dialog).getByLabelText(/^Entry/), kind);
      await user.selectOptions(within(dialog).getByLabelText(/^Party/), "party:p1");
      if (kind === "appointment" || kind === "cessation") {
        await user.selectOptions(within(dialog).getByLabelText(/^Role\s*\*?$/), "other");
        await user.type(within(dialog).getByLabelText(/^Role label/), "Adviser");
        expect(within(dialog).queryByLabelText(/^Amount\s*\*?$/)).not.toBeInTheDocument();
      } else {
        await user.selectOptions(within(dialog).getByLabelText(/^Form/), "property");
        await user.type(within(dialog).getByLabelText(/^Property/), "Family house");
        expect(within(dialog).queryByLabelText(/^Role\s*\*?$/)).not.toBeInTheDocument();
      }
      await user.click(within(dialog).getByRole("button", { name: "Enter in register" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "Entry 5: The party already holds this role.",
      );
      expect(api.writes[0]?.body).toMatchObject({
        kind,
        party: { kind: "party", partyId: "p1" },
        ...(kind === "appointment" || kind === "cessation"
          ? { role: "other", roleLabel: "Adviser", amount: null, property: null }
          : { role: null, property: "Family house", amount: null, currency: null }),
      });
    },
  );
  it("creates a beneficiary class and removes class choices for other roles", async () => {
    const api = registerApi({ empty: true });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1/ownership");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Record entry" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("option", { name: "Class" })).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText(/^Role\s*\*?$/), "beneficiary");
    await user.selectOptions(within(dialog).getByLabelText(/^Party/), "class");
    await user.type(
      within(dialog).getByLabelText(/^Description/),
      "Children and remoter issue of the Settlor",
    );
    await user.click(within(dialog).getByRole("button", { name: "Enter in register" }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]?.body).toMatchObject({
      kind: "appointment",
      role: "beneficiary",
      party: { kind: "class", description: "Children and remoter issue of the Settlor" },
    });
  });
  it.each(["entity", "individual"] as const)(
    "records money from a new %s party in minor units",
    async (partyKind) => {
      const api = registerApi();
      stubApi({
        signedIn: MEMBER,
        extra: (call) =>
          call.url.pathname === "/api/v1/entities"
            ? json(200, {
                entities: [
                  entity(),
                  entity({ id: "e2", legalName: "Family Office", jurisdiction: "Jersey" }),
                ],
              })
            : api.handler(call),
      });
      renderAt("/entities/e1/ownership");
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Record entry" }));
      const dialog = screen.getByRole("dialog");
      await user.selectOptions(within(dialog).getByLabelText(/^Entry/), "settlement");
      await user.selectOptions(within(dialog).getByLabelText(/^Party/), partyKind);
      if (partyKind === "entity") {
        // The trust cannot be a party on its own register, so it is not offered.
        expect(
          within(within(dialog).getByLabelText(/^Entity/)).queryByRole("option", {
            name: "Calloway Capital Partners Ltd",
          }),
        ).not.toBeInTheDocument();
        await user.selectOptions(within(dialog).getByLabelText(/^Entity/), "e2");
      } else await user.type(within(dialog).getByLabelText(/^Full name/), "New Settlor");
      await user.type(within(dialog).getByLabelText(/^Amount/), "1200.251");
      await user.click(within(dialog).getByRole("button", { name: "Enter in register" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "Choose a currency for the amount.",
      );
      expect(api.writes).toHaveLength(0);
      await user.selectOptions(within(dialog).getByLabelText(/^Currency/), "USD");
      await user.click(within(dialog).getByRole("button", { name: "Enter in register" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("up to 2 decimal places");
      expect(api.writes).toHaveLength(0);
      await user.clear(within(dialog).getByLabelText(/^Amount/));
      await user.type(within(dialog).getByLabelText(/^Amount/), "1200.25");
      await user.click(within(dialog).getByRole("button", { name: "Enter in register" }));
      await waitFor(() => expect(api.writes).toHaveLength(1));
      expect(api.writes[0]?.body).toMatchObject({
        kind: "settlement",
        amount: 120025,
        currency: "USD",
        property: null,
        role: null,
        party:
          partyKind === "entity"
            ? { kind: "entity", entityId: "e2" }
            : { kind: "individual", name: "New Settlor" },
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    },
  );
  it("keeps a restricted party when editing and confirms removal with a refusal", async () => {
    const api = registerApi({ refuse: "Entry 4: The party does not hold this role." });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1/ownership");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit entry 2" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^Party/)).toHaveValue("party:p2");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await within(dialog).findByRole("alert");
    expect(api.writes[0]?.body).toMatchObject({ party: { kind: "party", partyId: "p2" } });
    expect(api.writes[0]?.method).toBe("PATCH");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Remove entry 2" }));
    expect(api.writes).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Remove entry 002" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "Entry 4",
    );
    expect(api.writes[1]?.method).toBe("DELETE");
  });
});
