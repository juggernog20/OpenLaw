// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";
import type { PartnershipRegister } from "../lib/partnership-register";

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
    registerKind: "partnership",
    typeRegisterKind: "partnership",
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
const assignee = { ...individual, id: "p3", name: "Alex Assignee" };
function registerAt(asOf = TODAY): PartnershipRegister {
  const admission: PartnershipRegister["entries"][number] = {
    id: "en1",
    entryNo: 1,
    kind: "admission",
    effectiveOn: "2020-01-01",
    party: individual,
    fromParty: null,
    toParty: null,
    capacity: "general",
    transfereeStatus: null,
    units: 100,
    statedPercent: 60,
    amount: null,
    currency: null,
    formOfContribution: null,
    consideration: null,
    reference: "Deed 1",
    note: null,
    applied: true,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  };
  const entries: PartnershipRegister["entries"] = [
    admission,
    {
      ...admission,
      id: "en2",
      entryNo: 2,
      party: restricted,
      capacity: "limited",
      units: 50,
      statedPercent: 20,
    },
    {
      ...admission,
      id: "en3",
      entryNo: 3,
      kind: "contribution",
      capacity: null,
      units: null,
      statedPercent: null,
      amount: 100000,
      currency: "AED",
    },
    {
      ...admission,
      id: "en4",
      entryNo: 4,
      kind: "transfer",
      effectiveOn: "2023-01-01",
      party: null,
      fromParty: individual,
      toParty: assignee,
      capacity: null,
      transfereeStatus: "assignee",
      units: 10,
      statedPercent: null,
      consideration: "Assignment deed",
      applied: asOf >= "2023-01-01",
    },
  ];
  const partner = {
    party: individual,
    capacity: "general" as const,
    status: "admitted" as const,
    since: "2020-01-01",
    units: asOf < "2023-01-01" ? 100 : 90,
    statedPercent: 60,
    committed: 150000,
    contributed: 100000,
    returned: 20000,
    transferred: 0,
    unreturned: 80000,
    percent: 60,
  };
  const other = {
    ...partner,
    party: restricted,
    capacity: "limited" as const,
    units: 50,
    statedPercent: 20,
    percent: 20,
  };
  const assigned = {
    ...partner,
    party: assignee,
    capacity: null,
    status: "assignee" as const,
    since: null,
    units: 10,
    statedPercent: 0,
    percent: 0,
    committed: 0,
    contributed: 0,
    returned: 0,
    unreturned: 0,
  };
  const totals = {
    units: 150,
    statedPercent: 80,
    committed: 300000,
    contributed: 200000,
    returned: 40000,
    unreturned: 160000,
  };
  return {
    asOf,
    today: TODAY,
    basis: "stated",
    currency: "AED",
    partners: asOf < "2023-01-01" ? [partner, other] : [partner, other, assigned],
    partnersToday: [{ ...partner, units: 90 }, other, assigned],
    totals,
    totalsToday: totals,
    entries,
    dates: ["2020-01-01", "2023-01-01"],
    warnings: [{ code: "stated-total", total: 80 }],
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
          entity: entity({
            archivedAt: options.frozen ? "2026-01-01T00:00:00.000Z" : null,
            partnershipBasis: "stated",
          }),
          fields: [],
          customFieldRefs: { users: [], entities: [] },
        });
      if (call.url.pathname === "/api/v1/entities/e1/partnership-register") {
        reads.push(call);
        const register = registerAt(call.url.searchParams.get("asOf") ?? TODAY);
        return json(
          200,
          options.empty
            ? {
                ...register,
                partners: [],
                partnersToday: [],
                entries: [],
                dates: [],
                currency: null,
                warnings: [],
              }
            : register,
        );
      }
      if (
        call.url.pathname.includes("/partnership-entries") ||
        (call.url.pathname === "/api/v1/entities/e1" && call.method === "PATCH")
      ) {
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

describe("the partnership Ownership tab", () => {
  it("loads the selected date and renders the register, totals, dimming and CSV downloads in DES-095 order", async () => {
    const api = registerApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1/ownership?asOf=2022-01-01");
    await screen.findByRole("heading", { name: /Register of partners(?: at|$)/ });
    expect(api.reads[0]?.url.searchParams.get("asOf")).toBe("2022-01-01");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Register as of",
      "Register of partners at Jan 1, 2022",
      "Register of partnership entries",
      "Holdings in other Entities",
    ]);
    expect(screen.getByText(/Partnership register · from the type/)).toBeInTheDocument();
    const partners = within(section(/Register of partners(?: at|$)/));
    expect(partners.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Partner",
      "Capacity",
      "Units",
      "Committed",
      "Contributed",
      "Returned",
      "Unreturned",
      "%",
      "Partner since",
      "Change to today",
    ]);
    expect(partners.getByText("General")).toHaveClass("bg-status-assigned-bg");
    expect(partners.getByText("Limited")).toBeInTheDocument();
    expect(partners.getByText("Restricted Entity")).toBeInTheDocument();
    expect(partners.getByText("Total").closest("tr")).toHaveTextContent("150");
    expect(partners.getByText("Total").closest("tr")).toHaveTextContent("80%");
    expect(partners.getByText("Total").closest("tr")).toHaveTextContent("AED");
    expect(partners.getByText("-10")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("80%");
    for (const [name, query] of [
      ["Export register", "kind=partners&asOf=2022-01-01"],
      ["Export", "kind=entries"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute(
        "href",
        `/api/v1/entities/e1/partnership-register/export?${query}`,
      );
      expect(screen.getByRole("link", { name })).toHaveAttribute("download");
    }
    const rows = within(section("Register of partnership entries")).getAllByRole("row");
    expect(rows[4]).toHaveAttribute("data-applied", "false");
    expect(rows[4]).toHaveClass("text-muted");
    expect(within(rows[3]!).getByText(/AED/)).toHaveClass("font-mono");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Reset to today" }));
    await screen.findByRole("heading", { name: "Register of partners" });
    expect(screen.queryByText("Change to today")).not.toBeInTheDocument();
    expect(within(section("Register of partners")).getByText("Assignee")).toBeInTheDocument();
  });
  it("filters transfers by either partner and by effective date", async () => {
    stubApi({ signedIn: MEMBER, extra: registerApi().handler });
    const { router } = renderAt(
      "/entities/e1/ownership?kind=transfer&party=p3&effectiveFrom=2023-01-01&effectiveTo=2023-12-31",
    );
    await screen.findByRole("heading", { name: "Register of partnership entries" });
    expect(within(section("Register of partnership entries")).getAllByRole("row")).toHaveLength(2);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove Entry filter" }));
    await waitFor(() => expect(router.state.location.search).not.toContain("kind="));
    await user.click(screen.getByRole("button", { name: /^Filter/ }));
    for (const name of ["Entry", "Partner", "Effective date"])
      expect(
        within(screen.getByRole("dialog", { name: "Filter" })).getByRole("button", {
          name: new RegExp(`^${name}`),
        }),
      ).toBeInTheDocument();
  });
  it.each([
    "admission",
    "commitment",
    "contribution",
    "return",
    "transfer",
    "capacity_change",
    "withdrawal",
  ] as const)("records %s with only its fields and displays the API problem", async (kind) => {
    const api = registerApi({ refuse: "Entry 5: A party must hold no units before withdrawal." });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1/ownership");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Record entry" }));
    const dialog = screen.getByRole("dialog");
    const d = within(dialog);
    await user.selectOptions(d.getByLabelText(/^Entry/), kind);
    if (kind === "transfer") {
      await user.selectOptions(d.getByLabelText(/^From/), "party:p1");
      await user.selectOptions(d.getByLabelText(/^To/), "party:p3");
      await user.selectOptions(d.getByLabelText(/^Transferee status/), "assignee");
    } else await user.selectOptions(d.getByLabelText(/^Partner/), "party:p1");
    if (kind === "admission" || kind === "capacity_change")
      await user.selectOptions(d.getByLabelText(/^Capacity/), "limited");
    else expect(d.queryByLabelText(/^Capacity/)).not.toBeInTheDocument();
    if (kind === "admission" || kind === "transfer") {
      await user.type(d.getByLabelText(/^Units/), "10");
      await user.type(d.getByLabelText(/^Stated percent/), "12.25");
    }
    const money = ["commitment", "contribution", "return", "transfer"].includes(kind);
    if (money) {
      await user.type(d.getByLabelText(/^Amount/), "1200.25");
      expect(d.getByLabelText(/^Currency/)).toHaveValue("AED");
    } else expect(d.queryByLabelText(/^Amount/)).not.toBeInTheDocument();
    if (kind === "contribution") await user.type(d.getByLabelText(/^Form of contribution/), "Cash");
    if (kind === "transfer") await user.type(d.getByLabelText(/^Consideration/), "Assignment deed");
    await user.click(d.getByRole("button", { name: "Enter in register" }));
    expect(await d.findByRole("alert")).toHaveTextContent(
      "Entry 5: A party must hold no units before withdrawal.",
    );
    expect(api.writes[0]?.body).toMatchObject({
      kind,
      effectiveOn: TODAY,
      party: kind === "transfer" ? null : { kind: "party", partyId: "p1" },
      capacity: kind === "admission" || kind === "capacity_change" ? "limited" : null,
      units: kind === "admission" || kind === "transfer" ? 10 : null,
      statedPercent: kind === "admission" || kind === "transfer" ? 12.25 : null,
      amount: money ? 120025 : null,
      currency: money ? "AED" : null,
      formOfContribution: kind === "contribution" ? "Cash" : null,
      consideration: kind === "transfer" ? "Assignment deed" : null,
      ...(kind === "transfer"
        ? {
            fromParty: { kind: "party", partyId: "p1" },
            toParty: { kind: "party", partyId: "p3" },
            transfereeStatus: "assignee",
          }
        : {}),
    });
  });
  it("changes the ownership basis through a four-option radio dialog and keeps a refusal inline", async () => {
    const api = registerApi({ refuse: "This Entity is archived." });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1/ownership");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Change basis" }));
    const d = within(screen.getByRole("dialog", { name: "Change basis" }));
    expect(d.getAllByRole("radio")).toHaveLength(4);
    await user.click(d.getByRole("radio", { name: /Equal shares/ }));
    await user.click(d.getByRole("button", { name: "Save" }));
    expect(await d.findByRole("alert")).toHaveTextContent("This Entity is archived.");
    expect(api.writes[0]?.body).toEqual({ partnershipBasis: "equal" });
  });
  it("keeps restricted parties on edit and confirms removal", async () => {
    const api = registerApi({ refuse: "Entry 2 is required by later entries." });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1/ownership");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit entry 2" }));
    const d = within(screen.getByRole("dialog"));
    expect(d.getByLabelText(/^Partner/)).toHaveValue("party:p2");
    await user.click(d.getByRole("button", { name: "Save" }));
    await d.findByRole("alert");
    expect(api.writes[0]?.body).toMatchObject({ party: { kind: "party", partyId: "p2" } });
    await user.click(d.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Remove entry 2" }));
    expect(api.writes).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Remove entry 002" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "Entry 2 is required",
    );
    expect(api.writes[1]?.method).toBe("DELETE");
  });
  it.each([false, true])("shows the empty state, with archived=%s", async (frozen) => {
    stubApi({ signedIn: MEMBER, extra: registerApi({ empty: true, frozen }).handler });
    renderAt("/entities/e1/ownership");
    await screen.findByRole("heading", { name: "No partnership register yet" });
    expect(screen.queryByRole("heading", { name: "Register as of" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record entry" })).toHaveProperty("disabled", frozen);
    expect(screen.getByRole("heading", { name: "Holdings in other Entities" })).toBeInTheDocument();
  });
  it("shows projected Holdings as read-only links", async () => {
    const api = registerApi();
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/entities/e1/holdings"
          ? json(200, {
              owners: [],
              owned: [
                {
                  owner: { restricted: false, id: "e1", legalName: "Partnership" },
                  owned: { restricted: false, id: "e2", legalName: "Operating Company" },
                  ownershipPercent: 42.25,
                },
              ],
            })
          : api.handler(call),
    });
    renderAt("/entities/e1/ownership");
    await screen.findByRole("heading", { name: "Register of partners" });
    const card = within(section("Holdings in other Entities"));
    expect(card.getByRole("link", { name: "Operating Company" })).toHaveAttribute(
      "href",
      "/entities/e2",
    );
    expect(card.getByRole("link", { name: "From register" })).toHaveAttribute(
      "href",
      "/entities/e2/ownership",
    );
    expect(card.getByText("42.25%")).toBeInTheDocument();
    expect(card.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(card.queryByRole("button")).not.toBeInTheDocument();
  });
  it.each(["entity", "individual"] as const)(
    "admits a new %s transferee and revalidates after saving",
    async (partyKind) => {
      const api = registerApi();
      stubApi({
        signedIn: MEMBER,
        extra: (call) =>
          call.url.pathname === "/api/v1/entities"
            ? json(200, { entities: [entity(), entity({ id: "e2", legalName: "Family Office" })] })
            : api.handler(call),
      });
      renderAt("/entities/e1/ownership");
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Record entry" }));
      const d = within(screen.getByRole("dialog"));
      await user.selectOptions(d.getByLabelText(/^Entry/), "transfer");
      await user.selectOptions(d.getByLabelText(/^From/), "party:p1");
      await user.selectOptions(d.getByLabelText(/^To/), partyKind);
      if (partyKind === "entity") {
        expect(
          within(d.getByLabelText(/^Entity/)).queryByRole("option", {
            name: "Calloway Capital Partners Ltd",
          }),
        ).not.toBeInTheDocument();
        await user.selectOptions(d.getByLabelText(/^Entity/), "e2");
      } else await user.type(d.getByLabelText(/^Full name/), "New Partner");
      await user.selectOptions(d.getByLabelText(/^Capacity/), "limited");
      await user.type(d.getByLabelText(/^Units/), "10");
      await user.click(d.getByRole("button", { name: "Enter in register" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(api.writes[0]?.body).toMatchObject({
        kind: "transfer",
        transfereeStatus: "admitted",
        capacity: "limited",
        toParty:
          partyKind === "entity"
            ? { kind: "entity", entityId: "e2" }
            : { kind: "individual", name: "New Partner" },
        amount: null,
        currency: null,
      });
      expect(api.reads.length).toBeGreaterThan(1);
    },
  );
  it("rejects imprecise amounts and stale fields when changing entry kinds", async () => {
    const api = registerApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1/ownership");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Record entry" }));
    const d = within(screen.getByRole("dialog"));
    await user.selectOptions(d.getByLabelText(/^Partner/), "party:p1");
    await user.type(d.getByLabelText(/^Units/), "2.5");
    await user.click(d.getByRole("button", { name: "Enter in register" }));
    expect(await d.findByRole("alert")).toHaveTextContent("whole non-negative units");
    expect(api.writes).toHaveLength(0);
    await user.selectOptions(d.getByLabelText(/^Entry/), "contribution");
    await user.type(d.getByLabelText(/^Amount/), "1.001");
    expect(d.getByLabelText(/^Currency/)).toBeDisabled();
    await user.click(d.getByRole("button", { name: "Enter in register" }));
    expect(await d.findByRole("alert")).toHaveTextContent("up to 2 decimal places");
    expect(api.writes).toHaveLength(0);
    await user.clear(d.getByLabelText(/^Amount/));
    await user.type(d.getByLabelText(/^Amount/), "1.25");
    await user.click(d.getByRole("button", { name: "Enter in register" }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]?.body).toMatchObject({
      kind: "contribution",
      amount: 125,
      currency: "AED",
      units: null,
      statedPercent: null,
      capacity: null,
    });
  });
  it("chooses the first money entry's currency and does not round excess precision", async () => {
    const api = registerApi({ empty: true });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/entities/e1/ownership");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Record entry" }));
    const d = within(screen.getByRole("dialog"));
    await user.selectOptions(d.getByLabelText(/^Entry/), "contribution");
    await user.selectOptions(d.getByLabelText(/^Partner/), "individual");
    await user.type(d.getByLabelText(/^Full name/), "New Partner");
    await user.type(d.getByLabelText(/^Amount/), "1.25");
    await user.click(d.getByRole("button", { name: "Enter in register" }));
    expect(await d.findByRole("alert")).toHaveTextContent("Choose a currency");
    expect(api.writes).toHaveLength(0);
    await user.selectOptions(d.getByLabelText(/^Currency/), "USD");
    await user.click(d.getByRole("button", { name: "Enter in register" }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]?.body).toMatchObject({ amount: 125, currency: "USD" });
  });
  it("revalidates the basis and warning after a successful change", async () => {
    const api = registerApi();
    let changed = false;
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.method === "PATCH" && call.url.pathname === "/api/v1/entities/e1") changed = true;
        if (changed && call.url.pathname.endsWith("/partnership-register"))
          return json(200, { ...registerAt(), basis: "capital", warnings: [] });
        return api.handler(call);
      },
    });
    renderAt("/entities/e1/ownership");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Change basis" }));
    const d = within(screen.getByRole("dialog"));
    await user.click(d.getByRole("radio", { name: "Unreturned capital" }));
    await user.click(d.getByRole("button", { name: "Save" }));
    await screen.findByText("Ownership by unreturned capital · AED");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.writes[0]?.body).toEqual({ partnershipBasis: "capital" });
  });
  it("disables every write control on an archived populated register", async () => {
    stubApi({ signedIn: MEMBER, extra: registerApi({ frozen: true }).handler });
    renderAt("/entities/e1/ownership");
    await screen.findByRole("heading", { name: "Register of partners" });
    for (const button of screen.getAllByRole("button", {
      name: /^(Record entry|Change basis|Edit entry|Remove entry)/,
    }))
      expect(button).toBeDisabled();
  });
  it("preserves an existing transfer with no status change when editing", async () => {
    const api = registerApi();
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname.endsWith("/partnership-register")) {
          const register = registerAt();
          register.entries[3]!.transfereeStatus = null;
          return json(200, register);
        }
        return api.handler(call);
      },
    });
    renderAt("/entities/e1/ownership");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit entry 4" }));
    const d = within(screen.getByRole("dialog"));
    expect(d.getByLabelText(/^Transferee status/)).toHaveValue("");
    expect(d.queryByLabelText(/^Capacity/)).not.toBeInTheDocument();
    await user.click(d.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]?.body).toMatchObject({ transfereeStatus: null, capacity: null });
  });
  it("shows capital and percentage changes even when units stay the same", async () => {
    const api = registerApi();
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname.endsWith("/partnership-register")) {
          const register = registerAt("2022-01-01");
          register.partnersToday[0] = { ...register.partners[0]!, unreturned: 90000, percent: 70 };
          return json(200, register);
        }
        return api.handler(call);
      },
    });
    renderAt("/entities/e1/ownership?asOf=2022-01-01");
    await screen.findByRole("heading", { name: "Register of partners at Jan 1, 2022" });
    const row = within(section(/Register of partners(?: at|$)/))
      .getByText("Devon Calloway")
      .closest("tr")!;
    expect(within(row).getByText("+10 pp")).toBeInTheDocument();
    expect(within(row).getByTitle("Unreturned")).toHaveTextContent(/AED.*100/);
  });
});
