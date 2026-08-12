// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The /contracts/:number record page (M8), through the real route table
 * with the standard fetch stub: Member+ lands on the record at its
 * number-based address, edits a field in place (DES-017 — blur commits
 * one PATCH, Escape commits none), sets the Owner, the signing entity,
 * status, priority, and risk from their selects, works the Team card,
 * archives the record (every input freezes, the sub-bar action flips),
 * and restores it. The signing-entity picker reads the M7 registry,
 * which never lists an archived entity. The counterparty typeahead
 * searches the book, commits an existing organization by id and an
 * unknown name by name, never offers to create a name the search
 * already answered with, and moves the primary. The activity bar mounts
 * with the applet set that exists before M9.
 * Contributors are bounced home; unauthenticated visitors land on login.
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

/** The people the pickers offer. A Contributor is offered for the team
 * (external counsel, MTR-006) but never for the Owner. */
const PEOPLE = [
  {
    id: "u1",
    displayName: "Ada Admin",
    image: null,
    archived: false,
    role: "administrator",
  },
  {
    id: "u3",
    displayName: "Casey Contributor",
    image: null,
    archived: false,
    role: "contributor",
  },
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
    { id: "t-nda", slug: "nda", displayName: "NDA" },
    { id: "t-msa", slug: "msa", displayName: "MSA" },
  ],
  contractStatuses: [
    { id: "s-draft", slug: "draft", displayName: "Draft", stage: "draft" },
    { id: "s-redlining", slug: "redlining", displayName: "Redlining", stage: "review" },
    { id: "s-active", slug: "active", displayName: "Active", stage: "active" },
  ],
  users: PEOPLE,
};

/** The M7 registry, as its Member+ list answers it — the seam the
 * signing-entity picker reads (CTR-011). Archived entities never appear
 * here, so the picker never offers one. */
const REGISTRY = [
  {
    id: "e-meridian",
    legalName: "Meridian Bio, Inc.",
    entityTypeId: "et-corp",
    entityTypeName: "Corporation",
    jurisdiction: "Delaware",
    formedOn: null,
    registrationNumber: null,
    taxId: null,
    registeredAgent: null,
    registeredAddress: null,
    status: "active",
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "e-uk",
    legalName: "Meridian Bio UK Ltd",
    entityTypeId: "et-corp",
    entityTypeName: "Corporation",
    jurisdiction: "England and Wales",
    formedOn: null,
    registrationNumber: null,
    taxId: null,
    registeredAgent: null,
    registeredAddress: null,
    status: "active",
    archivedAt: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
];

/** One registry entity as the contract record names it: the id and the
 * legal name that goes on the paper, nothing else of the card. */
function signingEntity(id: unknown) {
  const found = REGISTRY.find((entry) => entry.id === id);
  return found ? { id: found.id, legalName: found.legalName } : null;
}

/** One person as a row on the record renders them. */
function person(id: string, role?: string) {
  const found = PEOPLE.find((entry) => entry.id === id)!;
  const shape = {
    id: found.id,
    displayName: found.displayName,
    image: found.image,
    archived: found.archived,
  };
  return role === undefined ? shape : { ...shape, role };
}

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
    // Which of ours signs is not known yet (CTR-011).
    entity: null,
    // Nobody is recorded on the other side yet (CTR-011).
    primaryCounterparty: null,
    priority: "medium",
    risk: null,
    description: "Three-year platform engagement.",
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The counterparties the shared search answers with — the book the
 * typeahead reads (CTR-011). */
const BOOK = [
  { id: "cp-helix", name: "Helix Labs GmbH", jurisdiction: "Germany" },
  { id: "cp-orion", name: "Orion Cloud Ltd", jurisdiction: null },
  { id: "cp-the-helix", name: "The Helix Group Ltd", jurisdiction: null },
];

/** One party on the record, as the API answers it. */
function party(id: string, isPrimary: boolean) {
  const found = BOOK.find((entry) => entry.id === id)!;
  return { id: found.id, name: found.name, jurisdiction: found.jurisdiction, isPrimary };
}

/** The record loader's three reads plus the mutations under test. The
 * record is stateful: mutations answer with the row they produce, and
 * later GETs answer the latest row. */
function recordApi(
  initial: Record<string, unknown>,
  initialTeam: Record<string, unknown>[] = [person("u1", "creator")],
  initialParties: ReturnType<typeof party>[] = [],
) {
  let row = initial;
  let team = initialTeam;
  let parties = initialParties;
  const patches: unknown[] = [];
  const posts: string[] = [];
  const teamCalls: string[] = [];
  const counterpartyCalls: string[] = [];
  const searches: (string | null)[] = [];

  /** The API answers the row's primary alongside the party list, so the
   * stub keeps the two in step the way the server does. */
  const partiesEnvelope = () => {
    const primary = parties.find((entry) => entry.isPrimary);
    row = {
      ...row,
      primaryCounterparty: primary ? { id: primary.id, name: primary.name } : null,
    };
    return { contract: row, counterparties: parties };
  };
  const statusById = new Map(OPTIONS.contractStatuses.map((status) => [status.id, status]));
  const handler = (call: StubCall): Response | undefined => {
    if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
      return json(200, OPTIONS);
    }
    if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
      return json(200, { entities: REGISTRY });
    }
    if (call.url.pathname === "/api/v1/counterparties" && call.method === "GET") {
      const term = call.url.searchParams.get("query");
      searches.push(term);
      return json(200, {
        counterparties: BOOK.filter(
          (entry) => !term || entry.name.toLowerCase().includes(term.toLowerCase()),
        ),
      });
    }
    if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
      return json(200, { contract: row, team, counterparties: parties });
    }
    if (call.url.pathname === "/api/v1/contracts/42/counterparties" && call.method === "POST") {
      const body = call.body as { counterpartyId?: string; name?: string };
      counterpartyCalls.push(
        body.counterpartyId ? `add ${body.counterpartyId}` : `new ${body.name}`,
      );
      const found =
        BOOK.find((entry) => entry.id === body.counterpartyId) ??
        BOOK.find((entry) => entry.name.toLowerCase() === body.name?.toLowerCase());
      const added = found
        ? { ...found, isPrimary: parties.length === 0 }
        : {
            id: `cp-new-${parties.length}`,
            name: body.name!,
            jurisdiction: null,
            isPrimary: parties.length === 0,
          };
      parties = [...parties, added];
      return json(201, partiesEnvelope());
    }
    const partyPath = /^\/api\/v1\/contracts\/42\/counterparties\/([^/]+)(\/primary)?$/.exec(
      call.url.pathname,
    );
    if (partyPath && call.method === "DELETE") {
      const [, counterpartyId] = partyPath;
      counterpartyCalls.push(`remove ${counterpartyId}`);
      const left = parties.filter((entry) => entry.id !== counterpartyId);
      // The API never leaves a contract with parties and no primary.
      parties = left.some((entry) => entry.isPrimary)
        ? left
        : left.map((entry, index) => ({ ...entry, isPrimary: index === 0 }));
      return json(200, partiesEnvelope());
    }
    if (partyPath?.[2] && call.method === "POST") {
      const [, counterpartyId] = partyPath;
      counterpartyCalls.push(`primary ${counterpartyId}`);
      parties = parties.map((entry) => ({ ...entry, isPrimary: entry.id === counterpartyId }));
      // Primary first, as the API orders the list.
      parties = [...parties].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
      return json(200, partiesEnvelope());
    }
    if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
      patches.push(call.body);
      const body = call.body as Record<string, unknown>;
      const status = typeof body.statusId === "string" ? statusById.get(body.statusId) : undefined;
      const owner =
        "managerId" in body
          ? {
              manager: typeof body.managerId === "string" ? person(body.managerId) : null,
            }
          : {};
      const signatory =
        "entityId" in body
          ? {
              entity: signingEntity(body.entityId),
            }
          : {};
      row = {
        ...row,
        ...body,
        ...owner,
        ...signatory,
        ...(status ? { statusName: status.displayName, stage: status.stage } : {}),
      };
      // The stored FKs never ride the row back — the joined rows do.
      delete (row as Record<string, unknown>).managerId;
      delete (row as Record<string, unknown>).entityId;
      return json(200, { contract: row });
    }
    if (call.url.pathname === "/api/v1/contracts/42/team" && call.method === "POST") {
      const body = call.body as { userId: string; role: string };
      teamCalls.push(`add ${body.userId} ${body.role}`);
      team = [...team, { ...person(body.userId), role: body.role }];
      return json(201, { team });
    }
    const removal = /^\/api\/v1\/contracts\/42\/team\/([^/]+)\/([^/]+)$/.exec(call.url.pathname);
    if (removal && call.method === "DELETE") {
      const [, userId, role] = removal;
      teamCalls.push(`remove ${userId} ${role}`);
      team = team.filter((member) => !(member.id === userId && member.role === role));
      return json(200, { team });
    }
    if (call.url.pathname === "/api/v1/contracts/42/archive" && call.method === "POST") {
      posts.push("archive");
      row = { ...row, archivedAt: "2026-08-12T00:00:00.000Z" };
      return json(200, { contract: row });
    }
    if (call.url.pathname === "/api/v1/contracts/42/restore" && call.method === "POST") {
      posts.push("restore");
      row = { ...row, archivedAt: null };
      return json(200, { contract: row });
    }
    return undefined;
  };
  return { handler, patches, posts, teamCalls, counterpartyCalls, searches };
}

describe("the /contracts/:number record page", () => {
  it("shows a Legal Team Member the record at its number-based address", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Acme master services agreement" }),
    ).toBeInTheDocument();
    // The sub-bar carries the breadcrumb, the reference, and the status
    // pill (the nav also links to Contracts, and the status select's
    // options carry the same labels).
    const subbar = screen.getByRole("region", { name: "Acme master services agreement" });
    expect(within(subbar).getByRole("link", { name: "Contracts" })).toHaveAttribute(
      "href",
      "/contracts",
    );
    expect(within(subbar).getByText("C-42")).toBeInTheDocument();
    expect(within(subbar).getByText("Draft")).toBeInTheDocument();

    expect(screen.getByLabelText("Title")).toHaveValue("Acme master services agreement");
    expect(screen.getByLabelText("Status")).toHaveValue("s-draft");
    expect(screen.getByLabelText("Priority")).toHaveValue("medium");
    // Risk stays empty until legal assesses it (CTR-005).
    expect(screen.getByLabelText("Risk")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("Three-year platform engagement.");
    // The type is shown, not editable here — re-typing re-checks the
    // type's required fields, which lands with the field work.
    expect(screen.getByText("MSA")).toBeInTheDocument();
  });

  it("mounts the activity bar with the applet set that exists before M9", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    const bar = await screen.findByRole("toolbar", { name: "Applets" });
    expect(within(bar).getByRole("link", { name: "Contract settings" })).toHaveAttribute(
      "href",
      "/settings/contracts",
    );
  });

  it("commits an edited field on blur as one PATCH (DES-017) and notes Saved", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const title = await screen.findByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Acme MSA");
    await user.tab();

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(api.patches).toEqual([{ title: "Acme MSA" }]);
    // The heading follows the committed title.
    expect(screen.getByRole("heading", { level: 1, name: "Acme MSA" })).toBeInTheDocument();
  });

  it("reverts an in-progress edit on Escape without a PATCH", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const description = await screen.findByLabelText("Description");
    await user.clear(description);
    await user.type(description, "wrong context");
    await user.keyboard("{Escape}");

    expect(description).toHaveValue("Three-year platform engagement.");
    await user.tab();
    expect(api.patches).toEqual([]);
  });

  it("changes the status to any other status, and the pill follows the new label", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Status"), "s-active");
    await waitFor(() => expect(api.patches).toEqual([{ statusId: "s-active" }]));
    const subbar = screen.getByRole("region", { name: "Acme master services agreement" });
    expect(within(subbar).getByText("Active")).toBeInTheDocument();

    // Backwards too — deals collapse and reopen (CTR-001).
    await user.selectOptions(screen.getByLabelText("Status"), "s-redlining");
    await waitFor(() =>
      expect(api.patches).toEqual([{ statusId: "s-active" }, { statusId: "s-redlining" }]),
    );
  });

  it("sets priority and risk from the shared severity ramp, and clears risk again", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Priority"), "critical");
    await waitFor(() => expect(api.patches).toEqual([{ priority: "critical" }]));

    await user.selectOptions(screen.getByLabelText("Risk"), "high");
    await waitFor(() => expect(api.patches).toEqual([{ priority: "critical" }, { risk: "high" }]));

    // Back to not-yet-assessed, which is a null, not a level.
    await user.selectOptions(screen.getByLabelText("Risk"), "");
    await waitFor(() =>
      expect(api.patches).toEqual([{ priority: "critical" }, { risk: "high" }, { risk: null }]),
    );
  });

  it("sets the Owner from the picker and clears it back to unassigned", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const owner = await screen.findByLabelText("Owner");
    expect(owner).toHaveValue("");
    await user.selectOptions(owner, "u2");
    await waitFor(() => expect(api.patches).toEqual([{ managerId: "u2" }]));
    // The roster follows: the Owner heads the Team card.
    const team = screen.getByRole("region", { name: "Team" });
    expect(within(team).getByText("Nadia Counsel")).toBeInTheDocument();
    expect(within(team).getByText("Owner")).toBeInTheDocument();

    await user.selectOptions(owner, "");
    await waitFor(() => expect(api.patches).toEqual([{ managerId: "u2" }, { managerId: null }]));
  });

  it("offers only Member+ people as the Owner — a Contributor cannot run a contract", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    const owner = (await screen.findByLabelText("Owner")) as HTMLSelectElement;
    expect([...owner.options].map((option) => option.textContent)).toEqual([
      "Unassigned",
      "Ada Admin",
      "Nadia Counsel",
    ]);
  });

  it("keeps a saved Owner the picker no longer offers selectable as themselves", async () => {
    const departed = {
      id: "u9",
      displayName: "Gone Counsel",
      image: null,
      archived: true,
    };
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ manager: departed })).handler,
    });
    renderAt("/contracts/42");

    const owner = await screen.findByLabelText("Owner");
    expect(owner).toHaveValue("u9");
    expect(
      within(owner as HTMLElement).getByRole("option", { name: "Gone Counsel" }),
    ).toBeInTheDocument();
  });

  it("sets our signing entity from the registry and clears it again", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const entity = await screen.findByLabelText("Our entity");
    // Which of ours signs is not known when the record is born (CTR-011).
    expect(entity).toHaveValue("");
    await user.selectOptions(entity, "e-uk");
    await waitFor(() => expect(api.patches).toEqual([{ entityId: "e-uk" }]));
    expect(entity).toHaveValue("e-uk");

    await user.selectOptions(entity, "");
    await waitFor(() => expect(api.patches).toEqual([{ entityId: "e-uk" }, { entityId: null }]));
    expect(entity).toHaveValue("");
  });

  it("offers the live registry only — an archived entity is never on the list", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    const entity = (await screen.findByLabelText("Our entity")) as HTMLSelectElement;
    expect([...entity.options].map((option) => option.textContent)).toEqual([
      "Not known yet",
      "Meridian Bio, Inc.",
      "Meridian Bio UK Ltd",
    ]);
  });

  it("keeps a signing entity the registry no longer lists selectable as itself", async () => {
    // The entity signed, then left the registry. The record still names
    // who signed it, so the picker must not drop the answer it holds.
    const closed = { id: "e-closed", legalName: "Closing Branch GmbH" };
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow({ entity: closed })).handler });
    renderAt("/contracts/42");

    const entity = await screen.findByLabelText("Our entity");
    expect(entity).toHaveValue("e-closed");
    expect(
      within(entity as HTMLElement).getByRole("option", { name: "Closing Branch GmbH" }),
    ).toBeInTheDocument();
  });

  it("commits an existing counterparty by id, so the typeahead never duplicates it", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    expect(
      await screen.findByText("Nobody is recorded on the other side yet."),
    ).toBeInTheDocument();
    const picker = screen.getByLabelText("Counterparties");
    await user.click(picker);
    await user.type(picker, "Helix");

    // Contains, not starts-with — both Helix organizations are offered.
    await screen.findByRole("option", { name: /Helix Labs GmbH/ });
    const listbox = screen.getByRole("listbox", { name: "Counterparty matches" });
    const options = within(listbox).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Helix Labs GmbHGermany",
      "The Helix Group Ltd",
      'Create "Helix"',
    ]);

    await user.click(screen.getByRole("option", { name: /Helix Labs GmbH/ }));
    // The id goes over the wire, not the name: picking one we hold can
    // never make a second record for it (CTR-011).
    await waitFor(() => expect(api.counterpartyCalls).toEqual(["add cp-helix"]));
    expect(screen.getByText("Helix Labs GmbH")).toBeInTheDocument();
    // The first party on a contract is its primary.
    expect(screen.getByText("Primary")).toBeInTheDocument();
    // The input clears itself, ready for the next party.
    expect(picker).toHaveValue("");
  });

  it("creates an unknown name inline, and withholds the offer for a name it found", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const picker = await screen.findByLabelText("Counterparties");
    await user.click(picker);
    await user.type(picker, "Vertex Materials SA");
    await user.click(await screen.findByRole("option", { name: 'Create "Vertex Materials SA"' }));

    await waitFor(() => expect(api.counterpartyCalls).toEqual(["new Vertex Materials SA"]));
    expect(screen.getByText("Vertex Materials SA")).toBeInTheDocument();

    // A name the search answers with exactly is not a new organization,
    // so creating it is never offered.
    await user.type(picker, "orion cloud ltd");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Orion Cloud Ltd" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("option", { name: /^Create/ })).not.toBeInTheDocument();
  });

  it("walks the list with the arrow keys and commits the active row with Enter", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const picker = await screen.findByLabelText("Counterparties");
    await user.click(picker);
    await user.type(picker, "Helix");
    await screen.findByRole("option", { name: /Helix Labs GmbH/ });

    // The combobox names its active row for a screen reader, and the
    // arrows are what move it.
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(picker).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("option", { name: "The Helix Group Ltd" }).id,
      ),
    );
    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.counterpartyCalls).toEqual(["add cp-the-helix"]));
  });

  it("closes the list on Escape without committing anything", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const picker = await screen.findByLabelText("Counterparties");
    await user.click(picker);
    await user.type(picker, "Helix");
    await screen.findByRole("option", { name: /Helix Labs GmbH/ });

    await user.keyboard("{Escape}");
    expect(picker).toHaveAttribute("aria-expanded", "false");
    expect(picker).toHaveValue("");
    expect(api.counterpartyCalls).toEqual([]);
  });

  it("never offers a counterparty the record already names", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow(), undefined, [party("cp-helix", true)]).handler,
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const picker = await screen.findByLabelText("Counterparties");
    await user.click(picker);
    await user.type(picker, "Helix");
    await screen.findByRole("option", { name: "The Helix Group Ltd" });
    expect(screen.queryByRole("option", { name: /Helix Labs GmbH/ })).not.toBeInTheDocument();

    // Nor is creating it offered under its own exact name: it is one we
    // hold, so a second record for it must never be invited — even
    // though this record already names it and the list is empty.
    await user.clear(picker);
    await user.type(picker, "Helix Labs GmbH");
    expect(await screen.findByText("No counterparties to add.")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Create/ })).not.toBeInTheDocument();
  });

  it("moves the primary to another party, and takes a party off the contract", async () => {
    const api = recordApi(contractRow(), undefined, [
      party("cp-helix", true),
      party("cp-orion", false),
    ]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    // The primary leads the list and carries the only Primary marker.
    expect(await screen.findByText("Primary")).toBeInTheDocument();
    // Only the party that is not primary is offered the promotion.
    expect(screen.getAllByRole("button", { name: "Make primary" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Make primary" }));
    await waitFor(() => expect(api.counterpartyCalls).toEqual(["primary cp-orion"]));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    // Still exactly one primary, and it is the other party now.
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("Orion Cloud Ltd");
    expect(rows[0]!.textContent).toContain("Primary");

    await user.click(screen.getByRole("button", { name: "Take Helix Labs GmbH off the contract" }));
    await waitFor(() =>
      expect(api.counterpartyCalls).toEqual(["primary cp-orion", "remove cp-helix"]),
    );
    expect(screen.queryByText("Helix Labs GmbH")).not.toBeInTheDocument();
  });

  it("shows the API's refusal beside the counterparties when a write is turned down", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
          return json(200, OPTIONS);
        }
        if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
          return json(200, { entities: REGISTRY });
        }
        if (call.url.pathname === "/api/v1/counterparties" && call.method === "GET") {
          return json(200, { counterparties: BOOK });
        }
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
          return json(200, {
            contract: contractRow(),
            team: [person("u1", "creator")],
            counterparties: [],
          });
        }
        if (call.url.pathname === "/api/v1/contracts/42/counterparties" && call.method === "POST") {
          return problem(409, "That counterparty is already on this contract.");
        }
        return undefined;
      },
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const picker = await screen.findByLabelText("Counterparties");
    await user.click(picker);
    await user.type(picker, "Orion");
    await user.click(await screen.findByRole("option", { name: "Orion Cloud Ltd" }));
    expect(
      await screen.findByText("That counterparty is already on this contract."),
    ).toBeInTheDocument();
  });

  it("shows the API's refusal beside the field when a commit fails", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
          return json(200, OPTIONS);
        }
        if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
          return json(200, { entities: REGISTRY });
        }
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
          return json(200, {
            contract: contractRow(),
            team: [person("u1", "creator")],
            counterparties: [],
          });
        }
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
          return problem(400, "The status must be a live contract status.");
        }
        return undefined;
      },
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Status"), "s-active");
    expect(
      await screen.findByText("The status must be a live contract status."),
    ).toBeInTheDocument();
    // The select still shows the saved truth — nothing was adopted.
    expect(screen.getByLabelText("Status")).toHaveValue("s-draft");
  });

  it("keeps a saved status the picker no longer offers selectable as itself", async () => {
    const api = recordApi(contractRow({ statusId: "s-archived", statusName: "Superseded" }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    const select = await screen.findByLabelText("Status");
    expect(select).toHaveValue("s-archived");
    expect(
      within(select as HTMLElement).getByRole("option", { name: "Superseded" }),
    ).toBeInTheDocument();
  });

  it("lists the contract team, and names who made the record", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    const team = await screen.findByRole("region", { name: "Team" });
    expect(within(team).getByText("Ada Admin")).toBeInTheDocument();
    expect(within(team).getByText("Creator")).toBeInTheDocument();
    // Provenance is not membership: the creator has no remove control.
    expect(
      within(team).queryByRole("button", { name: /Take Ada Admin off the team/ }),
    ).not.toBeInTheDocument();
  });

  it("adds a team member through the dialog and takes one off again", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Add team member" }));
    await user.selectOptions(screen.getByLabelText("Person"), "u3");
    await user.selectOptions(screen.getByLabelText("Role"), "contributor");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(api.teamCalls).toEqual(["add u3 contributor"]));
    const team = screen.getByRole("region", { name: "Team" });
    expect(within(team).getByText("Casey Contributor")).toBeInTheDocument();
    expect(within(team).getByText("Contributor")).toBeInTheDocument();

    await user.click(
      within(team).getByRole("button", {
        name: "Take Casey Contributor off the team as Contributor",
      }),
    );
    await waitFor(() =>
      expect(api.teamCalls).toEqual(["add u3 contributor", "remove u3 contributor"]),
    );
    expect(within(team).queryByText("Casey Contributor")).not.toBeInTheDocument();
  });

  it("keys a removal to the role, so a second role on the same person stands", async () => {
    const api = recordApi(contractRow(), [
      person("u1", "creator"),
      person("u2", "member"),
      person("u2", "watcher"),
    ]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const team = await screen.findByRole("region", { name: "Team" });
    await user.click(
      within(team).getByRole("button", { name: "Take Nadia Counsel off the team as Watcher" }),
    );
    await waitFor(() => expect(api.teamCalls).toEqual(["remove u2 watcher"]));
    expect(within(team).getByText("Member")).toBeInTheDocument();
    expect(within(team).queryByText("Watcher")).not.toBeInTheDocument();
  });

  it("shows the API's refusal when a team change is turned down", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/options" && call.method === "GET") {
          return json(200, OPTIONS);
        }
        if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
          return json(200, { entities: REGISTRY });
        }
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "GET") {
          return json(200, {
            contract: contractRow(),
            team: [person("u1", "creator")],
            counterparties: [],
          });
        }
        if (call.url.pathname === "/api/v1/contracts/42/team" && call.method === "POST") {
          return problem(409, "This person already holds that role.");
        }
        return undefined;
      },
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Add team member" }));
    await user.selectOptions(screen.getByLabelText("Person"), "u2");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("This person already holds that role.")).toBeInTheDocument();
  });

  it("archives the record — every input freezes and the action flips — then restores it", async () => {
    const api = recordApi(
      contractRow(),
      [person("u1", "creator"), person("u2", "member")],
      [party("cp-helix", true), party("cp-orion", false)],
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Archive" }));
    await waitFor(() => expect(api.posts).toEqual(["archive"]));
    expect(screen.getByText(/This contract is archived/)).toBeInTheDocument();
    for (const label of [
      "Title",
      "Owner",
      "Our entity",
      "Counterparties",
      "Status",
      "Priority",
      "Risk",
      "Description",
    ]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    // The counterparties freeze too — the parties still read, but
    // nothing about them can be changed.
    expect(screen.getByText("Helix Labs GmbH")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make primary" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Take Helix Labs GmbH off the contract/ }),
    ).not.toBeInTheDocument();
    // The team freezes with everything else.
    expect(screen.getByRole("button", { name: "Add team member" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Take Nadia Counsel off the team/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.posts).toEqual(["archive", "restore"]));
    expect(screen.queryByText(/This contract is archived/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("bounces a Contributor home", async () => {
    stubApi({ signedIn: CONTRIBUTOR });
    renderAt("/contracts/42");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("sends an unauthenticated visitor to login", async () => {
    stubApi({ signedIn: null, needsSetup: false });
    renderAt("/contracts/42");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
