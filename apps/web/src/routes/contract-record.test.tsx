// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The /contracts/:number record page (M8), through the real route table
 * with the standard fetch stub: Member+ lands on the record at its
 * number-based address, edits a field in place (DES-017 — blur commits
 * one PATCH, Escape commits none), sets the Owner, the signing entity,
 * status, priority, and risk from their selects, records the CTR-010
 * value as one field in three controls — committed, reverted, and
 * cleared as a group — works the Team card,
 * archives the record (every input freezes, the sub-bar action flips),
 * and restores it. The signing-entity picker reads the M7 registry,
 * which never lists an archived entity. The counterparty typeahead
 * searches the book, commits an existing organization by id and an
 * unknown name by name, never offers to create a name the search
 * already answered with, and moves the primary. The activity bar mounts
 * with the applet set that exists at M9/2 — the chat slot and the
 * settings deep-link.
 *
 * The CTR-016 fields are the type's: the card draws the attachments in
 * attachment order, every field type gets its own control, and each
 * commits on its own keyed by slug. Re-typing commits straight away
 * when the new type demands nothing new, and opens a dialog collecting
 * the gaps when it does — one write for the type and the values
 * together (MTR-014).
 *
 * A Contributor on the contract's team gets the same page read-only
 * (M9/1): every control inert, no archive, no team or counterparty
 * action, and neither Member+ picker read asked for. A contract they
 * hold no team row on answers 404 and lands on the error page. Business
 * Users are bounced home; unauthenticated visitors land on login.
 */

import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, problem, renderAt, stubApi, type StubCall } from "../testing/helpers";
import type { CustomFieldValue, CustomFieldValues } from "../lib/custom-fields";

const ADMIN = {
  id: "u1",
  email: "admin@example.com",
  displayName: "Blair Wentworth",
  role: "administrator",
};
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

/** The fields the two types attach (CTR-016). MSAs carry an optional
 * text field; NDAs demand a select before anything may be typed onto
 * one, which is what makes a re-type onto NDA a compound edit. */
const PAYMENT_TERMS = {
  fieldId: "f-terms",
  slug: "payment_terms",
  displayName: "Payment terms",
  description: "How long the other side has to pay.",
  fieldType: "text",
  options: null,
  displayOrder: 1,
  isRequired: false,
};
const OUR_POSITION = {
  fieldId: "f-position",
  slug: "our_position",
  displayName: "Our position",
  description: null,
  fieldType: "single_select",
  options: ["Customer", "Provider"],
  displayOrder: 1,
  isRequired: true,
};

/** A type attaching one field of every CTR-016 kind, so the nine
 * controls can be read in one render. Order is the attachment order the
 * API answers with, which is the order the card must draw. */
const EVERY_FIELD = [
  ["text", "Governing office", null],
  ["long_text", "Special terms", null],
  ["number", "Notice period", null],
  ["date", "Signed on", null],
  ["boolean", "Auto renews", null],
  ["single_select", "Paper", ["Ours", "Theirs"]],
  ["multi_select", "Regions", ["EMEA", "APAC"]],
  ["user", "Reviewer", null],
  ["entity", "Booking entity", null],
].map(([fieldType, displayName, options], index) => ({
  fieldId: `f-${index}`,
  slug: `field_${index}`,
  displayName: displayName as string,
  description: null,
  fieldType: fieldType as string,
  options: options as string[] | null,
  displayOrder: index + 1,
  isRequired: false,
}));

const OPTIONS = {
  contractTypes: [
    { id: "t-nda", slug: "nda", displayName: "NDA", fields: [OUR_POSITION] },
    { id: "t-msa", slug: "msa", displayName: "MSA", fields: [PAYMENT_TERMS] },
    { id: "t-full", slug: "full", displayName: "Every field", fields: EVERY_FIELD },
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
    // No value is recorded, which is where every contract starts
    // (CTR-010).
    value: null,
    description: "Three-year platform engagement.",
    customFields: {},
    // Open by default; the flag is opt-in, per record (DD-014).
    isConfidential: false,
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
  /** The attached fields follow the row's type, exactly as the API
   * derives them from the `contract_type_fields` join (CTR-016). */
  const fieldsOf = (of: Record<string, unknown>) =>
    OPTIONS.contractTypes.find((option) => option.id === of.contractTypeId)?.fields ?? [];
  const customEnvelope = () => ({
    fields: fieldsOf(row),
    // Nothing in these suites stores a `user` or `entity` value, so no
    // row is named that the pickers do not already offer.
    customFieldRefs: { users: [], entities: [] },
  });
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
      return json(200, { contract: row, ...customEnvelope(), team, counterparties: parties });
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
      // Merge customFields rather than replacing: null removes a field, omitted preserves it.
      const customFields =
        "customFields" in body &&
        typeof body.customFields === "object" &&
        body.customFields !== null
          ? (() => {
              const merged: CustomFieldValues = { ...(row.customFields ?? {}) };
              const patch = body.customFields as Record<string, CustomFieldValue | null>;
              for (const [key, value] of Object.entries(patch)) {
                if (value === null) {
                  delete merged[key];
                } else {
                  merged[key] = value;
                }
              }
              return merged;
            })()
          : row.customFields;
      row = {
        ...row,
        ...body,
        customFields,
        ...owner,
        ...signatory,
        ...(status ? { statusName: status.displayName, stage: status.stage } : {}),
      };
      // The stored FKs never ride the row back — the joined rows do.
      delete (row as Record<string, unknown>).managerId;
      delete (row as Record<string, unknown>).entityId;
      return json(200, { contract: row, ...customEnvelope() });
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

/**
 * The value's three controls are one field, so moving between them is
 * not leaving it. Every commit assertion has to put the focus outside
 * the group deliberately — Tab from the amount only reaches the
 * currency, which is still inside.
 */
const leaveValueGroup = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByLabelText("Title"));

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

  it("mounts the activity bar with the applet set that exists at M9/2", async () => {
    stubApi({ signedIn: ADMIN, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    const bar = await screen.findByRole("toolbar", { name: "Applets" });
    // Chat opens a panel (CMT-004); settings navigates (SET-001).
    expect(within(bar).getByRole("button", { name: "Comments" })).toBeInTheDocument();
    expect(within(bar).getByRole("link", { name: "Contract settings" })).toHaveAttribute(
      "href",
      "/settings/contracts",
    );
  });

  it("keeps the settings slot off the bar for anyone the pane would bounce", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    const bar = await screen.findByRole("toolbar", { name: "Applets" });
    // The contract-settings pane is Administrator-only, and its loader
    // sends everybody else to their profile. The slot is absent rather
    // than offering a door that opens on a redirect — the same
    // treatment the settings rail already gives the group it sits in.
    expect(within(bar).getByRole("button", { name: "Comments" })).toBeInTheDocument();
    expect(within(bar).queryByRole("link", { name: "Contract settings" })).not.toBeInTheDocument();
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

  it("commits the amount, the currency, and the cadence as one PATCH", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    expect(
      await screen.findByText("No value is recorded. Many contracts have none."),
    ).toBeVisible();
    await user.type(screen.getByLabelText("Amount"), "480000");
    // Moving between the three controls stays inside one field, so
    // neither of these blurs commits anything on its own.
    await user.selectOptions(screen.getByLabelText("Currency"), "USD");
    await user.selectOptions(screen.getByLabelText("Cadence"), "annually");
    expect(api.patches).toEqual([]);

    // Leaving the group is what commits it.
    await leaveValueGroup(user);
    await waitFor(() =>
      expect(api.patches).toEqual([
        { value: { amount: 48_000_000, currency: "USD", cadence: "annually" } },
      ]),
    );
    // The record reads the value back as DES-014 renders it.
    expect(await screen.findByText("$480,000.00 /year")).toBeVisible();
  });

  it("commits the group on Enter from any one of its three controls", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Amount"), "1200");
    await user.selectOptions(screen.getByLabelText("Currency"), "EUR");
    await user.selectOptions(screen.getByLabelText("Cadence"), "monthly");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(api.patches).toEqual([
        { value: { amount: 120_000, currency: "EUR", cadence: "monthly" } },
      ]),
    );
    expect(await screen.findByText("€1,200.00 /month")).toBeVisible();
  });

  it("reverts all three parts on Escape, because half a value is nobody's", async () => {
    const api = recordApi(
      contractRow({ value: { amount: 48_000_000, currency: "USD", cadence: "annually" } }),
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const amount = await screen.findByLabelText("Amount");
    expect(amount).toHaveValue(480_000);
    await user.clear(amount);
    await user.type(amount, "1");
    await user.selectOptions(screen.getByLabelText("Currency"), "GBP");
    await user.selectOptions(screen.getByLabelText("Cadence"), "monthly");
    await user.keyboard("{Escape}");

    expect(amount).toHaveValue(480_000);
    expect(screen.getByLabelText("Currency")).toHaveValue("USD");
    expect(screen.getByLabelText("Cadence")).toHaveValue("annually");
    await leaveValueGroup(user);
    expect(api.patches).toEqual([]);
  });

  it("clears the whole value when the amount is emptied", async () => {
    const api = recordApi(
      contractRow({ value: { amount: 500_000, currency: "USD", cadence: "one_time" } }),
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    // A one-off takes no cadence suffix: there is nothing it is per.
    expect(await screen.findByText("$5,000.00")).toBeVisible();
    await user.clear(screen.getByLabelText("Amount"));
    await leaveValueGroup(user);

    await waitFor(() => expect(api.patches).toEqual([{ value: null }]));
    // The currency and the cadence go with it — the group clears whole.
    expect(screen.getByLabelText("Currency")).toHaveValue("");
    expect(screen.getByLabelText("Cadence")).toHaveValue("one_time");
    expect(screen.getByText("No value is recorded. Many contracts have none.")).toBeVisible();
  });

  it("refuses an amount with no currency without sending it", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Amount"), "1000");
    await leaveValueGroup(user);

    expect(await screen.findByText("Pick a currency for the amount.")).toBeVisible();
    expect(api.patches).toEqual([]);

    // Picking one answers the refusal on the next commit.
    await user.selectOptions(screen.getByLabelText("Currency"), "USD");
    await leaveValueGroup(user);
    await waitFor(() =>
      expect(api.patches).toEqual([
        { value: { amount: 100_000, currency: "USD", cadence: "one_time" } },
      ]),
    );
  });

  it("refuses a negative amount without sending it", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Amount"), "-5");
    await leaveValueGroup(user);

    expect(await screen.findByText("Enter the amount as a number.")).toBeVisible();
    expect(api.patches).toEqual([]);
  });

  it("commits nothing when the group leaves the value as it found it", async () => {
    const api = recordApi(
      contractRow({ value: { amount: 100_000, currency: "USD", cadence: "one_time" } }),
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText("Amount"));
    await leaveValueGroup(user);
    expect(api.patches).toEqual([]);
  });

  it("counts the smallest unit of the currency, not always cents", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    // The yen has no minor unit: 5,000 yen is 5000, not 500000.
    await user.type(await screen.findByLabelText("Amount"), "5000");
    await user.selectOptions(screen.getByLabelText("Currency"), "JPY");
    await leaveValueGroup(user);

    await waitFor(() =>
      expect(api.patches).toEqual([
        { value: { amount: 5000, currency: "JPY", cadence: "one_time" } },
      ]),
    );
    expect(await screen.findByText("¥5,000")).toBeVisible();
  });

  it("shows the API's refusal beside the value when a commit is turned down", async () => {
    const api = recordApi(contractRow());
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH"
          ? problem(400, "Use a three-letter ISO 4217 currency code.")
          : api.handler(call),
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Amount"), "10");
    await user.selectOptions(screen.getByLabelText("Currency"), "USD");
    await leaveValueGroup(user);

    expect(
      await screen.findByText("Use a three-letter ISO 4217 currency code."),
    ).toBeInTheDocument();
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

    // By role, not by label: the recorded-parties list carries the same
    // accessible name as the picker that adds to it.
    const picker = await screen.findByRole("combobox", { name: "Counterparties" });
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

    // By role, not by label: the recorded-parties list carries the same
    // accessible name as the picker that adds to it.
    const picker = await screen.findByRole("combobox", { name: "Counterparties" });
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

    // By role, not by label: the recorded-parties list carries the same
    // accessible name as the picker that adds to it.
    const picker = await screen.findByRole("combobox", { name: "Counterparties" });
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

    // By role, not by label: the recorded-parties list carries the same
    // accessible name as the picker that adds to it.
    const picker = await screen.findByRole("combobox", { name: "Counterparties" });
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
    const counterpartiesList = screen.getByRole("list", { name: "Counterparties" });
    const rows = within(counterpartiesList).getAllByRole("listitem");
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
            fields: [PAYMENT_TERMS],
            customFieldRefs: { users: [], entities: [] },
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

    // By role, not by label: the recorded-parties list carries the same
    // accessible name as the picker that adds to it.
    const picker = await screen.findByRole("combobox", { name: "Counterparties" });
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
            fields: [PAYMENT_TERMS],
            customFieldRefs: { users: [], entities: [] },
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
            fields: [PAYMENT_TERMS],
            customFieldRefs: { users: [], entities: [] },
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
      "Contract type",
      "Owner",
      "Our entity",
      "Status",
      "Priority",
      "Risk",
      // The type's own fields freeze with the record (CTR-016).
      "Payment terms",
      // The value freezes as a group, like it commits as one.
      "Amount",
      "Currency",
      "Cadence",
      "Description",
    ]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    // The counterparties freeze too — the parties still read, but
    // nothing about them can be changed. The picker is asked for by
    // role: the recorded-parties list shares its accessible name.
    expect(screen.getByRole("combobox", { name: "Counterparties" })).toBeDisabled();
    expect(screen.getByText("Helix Labs GmbH")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make primary" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Take Helix Labs GmbH off the contract/ }),
    ).not.toBeInTheDocument();
    // The audience freezes with the facts: an archived record refuses
    // the flag edit like every other edit (DD-014).
    expect(
      screen.getByRole("switch", { name: "Confidential — restrict to the contract team" }),
    ).toBeDisabled();
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

  it("draws the type's attached fields in attachment order and commits one by slug", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const card = within(await screen.findByRole("region", { name: "Fields" }));
    // The MSA attaches one field, and the card draws its help text.
    const terms = card.getByLabelText("Payment terms");
    expect(card.getByText("How long the other side has to pay.")).toBeInTheDocument();

    await user.type(terms, "Net 45");
    await user.tab();
    // One PATCH, keyed by the field's slug — never by its id, and never
    // as a whole-map replacement.
    await waitFor(() =>
      expect(api.patches).toEqual([{ customFields: { payment_terms: "Net 45" } }]),
    );
    expect(await card.findByText("Saved")).toBeInTheDocument();
  });

  it("commits nothing when Escape reverts a field, or when a blur changes nothing", async () => {
    const api = recordApi(contractRow({ customFields: { payment_terms: "Net 30" } }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const terms = await screen.findByLabelText("Payment terms");
    expect(terms).toHaveValue("Net 30");
    await user.clear(terms);
    await user.type(terms, "Net 60{Escape}");
    expect(terms).toHaveValue("Net 30");

    // A blur that changes nothing is not a commit (DES-017).
    await user.click(terms);
    await user.tab();
    expect(api.patches).toEqual([]);
  });

  it("clears a field by emptying it, and sends null rather than a blank", async () => {
    const api = recordApi(contractRow({ customFields: { payment_terms: "Net 30" } }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.clear(await screen.findByLabelText("Payment terms"));
    await user.tab();
    await waitFor(() => expect(api.patches).toEqual([{ customFields: { payment_terms: null } }]));
  });

  it("renders a control for every field type and commits the ones that commit on change", async () => {
    const api = recordApi(
      contractRow({ contractTypeId: "t-full", contractTypeName: "Every field" }),
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const card = within(await screen.findByRole("region", { name: "Fields" }));
    // All nine, in attachment order.
    expect(
      card.getAllByText(
        /Governing office|Special terms|Notice period|Signed on|Auto renews|Paper|Regions|Reviewer|Booking entity/,
      ),
    ).toHaveLength(9);
    expect(card.getByLabelText("Notice period")).toHaveAttribute("type", "number");
    expect(card.getByLabelText("Signed on")).toHaveAttribute("type", "date");
    // The two that name a row reuse the record's own pickers: the
    // people the Owner select offers and the M7 registry.
    expect(
      within(card.getByLabelText("Reviewer")).getByRole("option", { name: "Nadia Counsel" }),
    ).toBeInTheDocument();
    expect(
      within(card.getByLabelText("Booking entity")).getByRole("option", {
        name: "Meridian Bio, Inc.",
      }),
    ).toBeInTheDocument();

    // A pick is a decision, so it commits the moment it changes.
    await user.click(card.getByRole("switch", { name: "Auto renews" }));
    await waitFor(() => expect(api.patches).toEqual([{ customFields: { field_4: true } }]));
    await user.selectOptions(card.getByLabelText("Paper"), "Theirs");
    await user.click(card.getByRole("checkbox", { name: "APAC" }));
    await waitFor(() =>
      expect(api.patches).toEqual([
        { customFields: { field_4: true } },
        { customFields: { field_5: "Theirs" } },
        { customFields: { field_6: ["APAC"] } },
      ]),
    );
  });

  it("commits a number field as a number, and clears it when the box is emptied", async () => {
    const api = recordApi(
      contractRow({
        contractTypeId: "t-full",
        contractTypeName: "Every field",
        customFields: { field_2: 30 },
      }),
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const notice = await screen.findByLabelText("Notice period");
    expect(notice).toHaveValue(30);
    await user.clear(notice);
    await user.type(notice, "45");
    await user.tab();
    // A number, not the string that was typed — the box holds a draft,
    // and the draft becomes a value only at the moment of commit.
    await waitFor(() => expect(api.patches).toEqual([{ customFields: { field_2: 45 } }]));

    await user.clear(screen.getByLabelText("Notice period"));
    await user.tab();
    await waitFor(() =>
      expect(api.patches).toEqual([
        { customFields: { field_2: 45 } },
        { customFields: { field_2: null } },
      ]),
    );
  });

  it("re-types straight away when the new type demands nothing new", async () => {
    const api = recordApi(contractRow({ customFields: { our_position: "Provider" } }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    // The NDA's required field is already answered by a retained value,
    // so the pick commits like any other select.
    await user.selectOptions(await screen.findByLabelText("Contract type"), "t-nda");
    await waitFor(() => expect(api.patches).toEqual([{ contractTypeId: "t-nda" }]));
    // The new type's fields replace the old type's on the card.
    const card = within(screen.getByRole("region", { name: "Fields" }));
    expect(await card.findByLabelText(/Our position/)).toBeInTheDocument();
    expect(card.queryByLabelText("Payment terms")).not.toBeInTheDocument();
  });

  it("asks for the new type's required fields before re-typing, and commits both as one write", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Contract type"), "t-nda");
    // Nothing is committed until the gap is answered — the record has
    // nowhere to fill a field its current type does not attach.
    expect(
      await screen.findByRole("heading", { name: "Change contract type" }),
    ).toBeInTheDocument();
    expect(api.patches).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Change type" }));
    expect(await screen.findByText(/Fill Our position/)).toBeInTheDocument();
    expect(api.patches).toEqual([]);

    await user.selectOptions(screen.getByLabelText("Our position"), "Customer");
    await user.click(screen.getByRole("button", { name: "Change type" }));
    await waitFor(() =>
      expect(api.patches).toEqual([
        { contractTypeId: "t-nda", customFields: { our_position: "Customer" } },
      ]),
    );
    expect(screen.queryByRole("heading", { name: "Change contract type" })).not.toBeInTheDocument();
  });

  it("shows the seam's own refusal inside the re-type dialog", async () => {
    const record = recordApi(contractRow());
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
          return problem(400, "Our position: pick one of the options.");
        }
        return record.handler(call);
      },
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Contract type"), "t-nda");
    await user.selectOptions(screen.getByLabelText("Our position"), "Customer");
    await user.click(screen.getByRole("button", { name: "Change type" }));

    // The dialog covers the field whose micro-state would carry this,
    // so the refusal has to read inside the dialog or it reads nowhere.
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Our position: pick one of the options.",
    );
    expect(dialog.getByRole("heading", { name: "Change contract type" })).toBeInTheDocument();
  });

  it("cancels a re-type without committing anything", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Contract type"), "t-nda");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Change contract type" }),
      ).not.toBeInTheDocument(),
    );
    expect(api.patches).toEqual([]);
    // The select goes back to what the record holds — it must never
    // show a type the contract is not on.
    expect(screen.getByLabelText("Contract type")).toHaveValue("t-msa");
  });

  it("shows the seam's refusal beside the field that earned it", async () => {
    const api = recordApi(contractRow());
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
          return problem(400, "Payment terms: that is longer than this field holds.");
        }
        return api.handler(call);
      },
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Payment terms"), "Net 45");
    await user.tab();
    expect(
      await screen.findByText("Payment terms: that is longer than this field holds."),
    ).toBeInTheDocument();
  });

  it("says so when the type attaches no fields at all", async () => {
    const api = recordApi(
      contractRow({ contractTypeId: "t-none", contractTypeName: "Unconfigured" }),
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    expect(await screen.findByText(/This contract type attaches no fields/)).toBeInTheDocument();
  });

  it("bounces a Business User home", async () => {
    stubApi({ signedIn: BUSINESS });
    renderAt("/contracts/42");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });

  it("sends an unauthenticated visitor to login", async () => {
    stubApi({ signedIn: null, needsSetup: false });
    renderAt("/contracts/42");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("a Contributor on the contract record (M9/1)", () => {
  /**
   * The record stub with both Member+ picker reads walled off. A
   * Contributor is refused them at the seam, so a loader that asked
   * would be asking for a refusal — `pickerReads` is what proves it
   * never does.
   */
  function contributorApi(...args: Parameters<typeof recordApi>) {
    const api = recordApi(...args);
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

  it("renders the record read-only, with no edit affordance and no picker read", async () => {
    const api = contributorApi(
      contractRow(),
      [person("u1", "creator"), person("u3", "contributor")],
      [party("cp-helix", true), party("cp-orion", false)],
    );
    stubApi({ signedIn: CONTRIBUTOR, extra: api.handler });
    renderAt("/contracts/42");

    // The record reads: the title, the status, the parties, the team.
    expect(
      await screen.findByRole("heading", { level: 1, name: /Acme master services agreement/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Helix Labs GmbH")).toBeInTheDocument();
    expect(screen.getByText("Casey Contributor")).toBeInTheDocument();
    expect(screen.getByText(/This record is read-only/)).toBeInTheDocument();

    // Every control is inert, exactly as an archived record renders.
    for (const label of [
      "Title",
      "Contract type",
      "Owner",
      "Our entity",
      "Status",
      "Priority",
      "Risk",
      "Payment terms",
      "Amount",
      "Currency",
      "Cadence",
      "Description",
    ]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    expect(screen.getByRole("combobox", { name: "Counterparties" })).toBeDisabled();

    // Archive and restore are record-level actions a Contributor never
    // gets, so they are absent rather than permanently disabled.
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    // The team and party controls freeze the way an archived record
    // freezes them — inert where they stand, gone where the archived
    // record drops them.
    expect(screen.getByRole("button", { name: "Add team member" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Make primary" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Take Helix Labs GmbH off the contract/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Take Casey Contributor off the team/ }),
    ).not.toBeInTheDocument();

    // No inline commit fires, and the Member+ picker seams are never
    // asked for.
    expect(api.patches).toEqual([]);
    expect(api.posts).toEqual([]);
    expect(api.pickerReads).toEqual([]);
  });

  it("still names the type, status, and Owner the record holds, with no picker list to read them from", async () => {
    const api = contributorApi(
      contractRow({ manager: person("u2"), statusId: "s-redlining", statusName: "Redlining" }),
    );
    stubApi({ signedIn: CONTRIBUTOR, extra: api.handler });
    renderAt("/contracts/42");

    // The selects are inert, so what they show is all the record says.
    // Each one names what is stored, not a blank — the row carries the
    // names, so no options read is needed to draw them.
    expect(await screen.findByLabelText("Contract type")).toHaveDisplayValue("MSA");
    expect(screen.getByLabelText("Status")).toHaveDisplayValue("Redlining");
    expect(screen.getByLabelText("Owner")).toHaveDisplayValue("Nadia Counsel");
  });

  it("says archived once on an archived contract, and never offers the restore", async () => {
    const api = contributorApi(contractRow({ archivedAt: "2026-08-12T00:00:00.000Z" }));
    stubApi({ signedIn: CONTRIBUTOR, extra: api.handler });
    renderAt("/contracts/42");

    // The archived note carries the state; the read-only note stands
    // down, because "restore it to edit" is not this viewer's to act on
    // and two notes over one card would say the same thing twice.
    expect(await screen.findByText(/This contract is archived/)).toBeInTheDocument();
    expect(screen.queryByText(/This record is read-only/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(api.posts).toEqual([]);
  });

  it("shows the error page for a contract they hold no team row on", async () => {
    // The API answers 404, exactly as it does for a contract that does
    // not exist — the client never learns which it was.
    stubApi({
      signedIn: CONTRIBUTOR,
      extra: (call) =>
        call.url.pathname === "/api/v1/contracts/42" && call.method === "GET"
          ? problem(404, "No contract exists with this number.")
          : undefined,
    });
    renderAt("/contracts/42");

    expect(
      await screen.findByRole("heading", { name: "Something went wrong." }),
    ).toBeInTheDocument();
  });
});

/**
 * The chat applet (M9/2) on the contract record: the entity-generic
 * comment panel, mounted in the DES-016 activity bar's second slot.
 *
 * The panel names no record type — it is keyed by the entity reference
 * the record carries, so the same component mounts on matters and
 * documents later. Every row wears its DD-016 tier; a Legal Only row is
 * tinted and locked (CMT-003). A Contributor's composer has no Legal
 * Only segment, and their thread carries no trace of one — the API
 * filtered it at query time, so there is nothing here to hide.
 *
 * The Legal Only row's wash is asserted as a class, the way the panel's
 * docking already is in record-applets.test.tsx: jsdom computes no
 * colour, so the class that carries the treatment is the only thing
 * there is to read. The lock glyph beside the badge is decorative — the
 * badge's own text names the tier — so it is asserted structurally
 * rather than by an accessible name that would announce the tier twice.
 */
describe("the contract record's comment applet (M9/2)", () => {
  const AUTHOR = {
    id: "u2",
    displayName: "Nadia Counsel",
    image: null,
    archived: false,
  };
  const CASEY = {
    id: "u3",
    displayName: "Casey Contributor",
    image: null,
    archived: false,
  };

  function comment(
    id: string,
    body: string,
    visibility: string,
    author = AUTHOR,
    createdAt = "2026-08-12T09:00:00.000Z",
    mentions: { id: string; displayName: string }[] = [],
    /** M9/4's three states: edited, and removed by either hand. A plain
     * comment is none of them. */
    marks: { editedAt?: string; deletedAt?: string; redactedAt?: string } = {},
  ) {
    return {
      id,
      entityType: "contract",
      entityId: "c1",
      author,
      body,
      visibility,
      mentions,
      createdAt,
      editedAt: marks.editedAt ?? null,
      deletedAt: marks.deletedAt ?? null,
      redactedAt: marks.redactedAt ?? null,
    };
  }

  /** The @-typeahead's list, as the seam answers it: everybody a
   * comment on this record reaches, with the tiers they hear. Nadia is
   * Member+ and hears all three; Casey is a Contributor on the team and
   * hears the two wider ones. */
  const NADIA_CANDIDATE = {
    id: "u2",
    displayName: "Nadia Counsel",
    image: null,
    tiers: ["legal_only", "working_team", "full_thread"],
  };
  const CASEY_CANDIDATE = {
    id: "u3",
    displayName: "Casey Contributor",
    image: null,
    tiers: ["working_team", "full_thread"],
  };
  const CANDIDATES = [CASEY_CANDIDATE, NADIA_CANDIDATE];

  /** The thread seam, stateful the way the API is: a post appends, and
   * the next read answers what the poster now sees. The handler only
   * answers; what it was asked is recorded for the test to assert. */
  function commentsApi(
    initial: ReturnType<typeof comment>[] = [],
    candidates: typeof CANDIDATES = CANDIDATES,
    /** What the badge starts at (M9/5). Zero is the common case, so
     * every suite that is not about the badge draws none. */
    initialUnread = 0,
  ) {
    let thread = initial;
    let unread = initialUnread;
    const posts: unknown[] = [];
    const reads: Record<string, string | null>[] = [];
    /** Every correction the panel sent, in order — the seam's own record
     * of what it was asked to do (M9/4). */
    const corrections: { method: string; id: string; body?: unknown }[] = [];
    /** Every record the panel said it had read (M9/5). */
    const marksRead: unknown[] = [];

    /** Puts a corrected row back in the thread, in its own place. A
     * tombstone that moved would break the thread it is holding open. */
    const replace = (updated: ReturnType<typeof comment>) => {
      thread = thread.map((row) => (row.id === updated.id ? updated : row));
      return json(200, { comment: updated });
    };

    const handler = (call: StubCall): Response | undefined => {
      if (call.url.pathname === "/api/v1/comments/mention-candidates" && call.method === "GET") {
        return json(200, { candidates });
      }
      // The badge's two calls, ahead of the correction paths below —
      // both are a static word where those expect a comment's id.
      if (call.url.pathname === "/api/v1/comments/unread" && call.method === "GET") {
        return json(200, { unread });
      }
      if (call.url.pathname === "/api/v1/comments/read" && call.method === "POST") {
        marksRead.push(call.body);
        unread = 0;
        return json(200, { unread });
      }
      // The three corrections, each addressed to one comment by id.
      const correction = /^\/api\/v1\/comments\/([^/]+)(\/redact)?$/.exec(call.url.pathname);
      if (correction && correction[1] !== "mention-candidates") {
        const id = correction[1]!;
        const row = thread.find((existing) => existing.id === id);
        if (!row) return problem(404, "No comment exists with this id.");
        if (call.method === "PATCH") {
          corrections.push({ method: "PATCH", id, body: call.body });
          const { body } = call.body as { body: string };
          return replace({ ...row, body, editedAt: "2026-08-12T14:00:00.000Z" });
        }
        if (call.method === "DELETE") {
          corrections.push({ method: "DELETE", id });
          return replace({ ...row, body: "", deletedAt: "2026-08-12T15:00:00.000Z" });
        }
        if (call.method === "POST" && correction[2]) {
          corrections.push({ method: "REDACT", id });
          return replace({
            ...row,
            body: "",
            mentions: [],
            redactedAt: "2026-08-12T16:00:00.000Z",
          });
        }
        return undefined;
      }
      if (call.url.pathname !== "/api/v1/comments") return undefined;
      if (call.method === "GET") {
        reads.push({
          entityType: call.url.searchParams.get("entityType"),
          entityId: call.url.searchParams.get("entityId"),
        });
        return json(200, { comments: thread, nextCursor: null });
      }
      if (call.method === "POST") {
        posts.push(call.body);
        const body = call.body as {
          body: string;
          visibility: string;
          mentions?: string[];
        };
        const posted = comment(
          `c-new-${thread.length}`,
          body.body,
          body.visibility,
          AUTHOR,
          "2026-08-12T12:00:00.000Z",
          (body.mentions ?? []).map((id) => ({
            id,
            displayName: candidates.find((person) => person.id === id)!.displayName,
          })),
        );
        thread = [...thread, posted];
        return json(201, { comment: posted });
      }
      return undefined;
    };
    return { handler, posts, reads, corrections, marksRead };
  }

  /** The record page's own seam plus the thread's, in that order. */
  function pageApi(comments: ReturnType<typeof commentsApi>, record = recordApi(contractRow())) {
    return (call: StubCall) => comments.handler(call) ?? record.handler(call);
  }

  /** Opens the chat panel from the activity bar and answers its icon. */
  async function openChat(user: ReturnType<typeof userEvent.setup>) {
    const bar = await screen.findByRole("toolbar", { name: "Applets" });
    const icon = within(bar).getByRole("button", { name: "Comments" });
    await user.click(icon);
    return icon;
  }

  it("opens and closes the chat panel from the bar, returning focus to its icon", async () => {
    const user = userEvent.setup();
    const comments = commentsApi();
    stubApi({ signedIn: MEMBER, extra: pageApi(comments) });
    renderAt("/contracts/42");

    const icon = await openChat(user);
    const panel = await screen.findByRole("complementary", { name: "Comments" });
    expect(icon).toHaveAttribute("aria-expanded", "true");
    // The panel is keyed by the record's entity reference, never by the
    // contract's CTR-003 number — that is what makes it entity-generic.
    await waitFor(() => {
      expect(comments.reads).toEqual([{ entityType: "contract", entityId: "c1" }]);
    });

    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Comments" })).not.toBeInTheDocument();
    // DES-010: the panel is not a Radix overlay, so focus is restored
    // by hand — to the bar icon that opened it.
    expect(icon).toHaveFocus();
    expect(icon).toHaveAttribute("aria-expanded", "false");
  });

  it("renders the thread flat and chronological, every row wearing its tier", async () => {
    const user = userEvent.setup();
    stubApi({
      signedIn: MEMBER,
      extra: pageApi(
        commentsApi([
          comment("c-1", "Redline goes back Friday.", "working_team"),
          comment("c-2", "Hold the 1x cap.", "legal_only"),
          comment("c-3", "Signature date is the 14th.", "full_thread", CASEY),
        ]),
      ),
    });
    renderAt("/contracts/42");
    await openChat(user);

    const thread = await screen.findByRole("list", { name: "Comments" });
    const rows = within(thread).getAllByRole("listitem");
    expect(rows.map((row) => within(row).getByText(/\.$/).textContent)).toEqual([
      "Redline goes back Friday.",
      "Hold the 1x cap.",
      "Signature date is the 14th.",
    ]);
    expect(within(rows[0]!).getByText("Working team")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Legal only")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Full thread")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Casey Contributor")).toBeInTheDocument();
    // CMT-003: the tier reads peripherally, not by squinting at a badge
    // — the row is washed and the badge carries DES-009's lock.
    expect(rows[1]).toHaveClass("bg-legal-only-bg");
    expect(rows[0]).not.toHaveClass("bg-legal-only-bg");
    // Asserted structurally, for the reason this suite's header gives.
    expect(within(rows[1]!).getByText("Legal only").querySelector("svg")).not.toBeNull();
    expect(within(rows[0]!).getByText("Working team").querySelector("svg")).toBeNull();

    // The panel header counts what is on screen — the filtered set is
    // all there is, so no total can leak a hidden row.
    const panel = screen.getByRole("complementary", { name: "Comments" });
    expect(within(panel).getByRole("img", { name: "3 comments" })).toBeInTheDocument();
  });

  it("says what the panel is for when nothing has been said", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: MEMBER, extra: pageApi(commentsApi()) });
    renderAt("/contracts/42");
    await openChat(user);

    expect(
      await screen.findByText(/Nothing has been said about this record yet/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Comments" })).not.toBeInTheDocument();
  });

  it("offers a Legal Team Member three segments, preset to Working team, each naming its audience", async () => {
    const user = userEvent.setup();
    stubApi({ signedIn: MEMBER, extra: pageApi(commentsApi()) });
    renderAt("/contracts/42");
    await openChat(user);

    const panel = await screen.findByRole("complementary", { name: "Comments" });
    const segments = within(panel).getAllByRole("radio");
    expect(segments.map((segment) => segment.getAttribute("value"))).toEqual([
      "legal_only",
      "working_team",
      "full_thread",
    ]);
    // DD-016: a record page opens on the working group, so the common
    // case needs no decision.
    expect(within(panel).getByRole("radio", { name: "Working team" })).toBeChecked();
    expect(
      within(panel).getByText("Visible to the legal team and Contributors on this record."),
    ).toBeInTheDocument();

    // The audience is named before the post, never after it (CMT-003).
    await user.click(within(panel).getByRole("radio", { name: "Legal only" }));
    expect(
      within(panel).getByText("Visible to Administrators and Legal Team Members."),
    ).toBeInTheDocument();
  });

  it("posts at the selected tier and puts the new comment at the end of the thread", async () => {
    const user = userEvent.setup();
    const comments = commentsApi([comment("c-1", "Redline goes back Friday.", "working_team")]);
    stubApi({ signedIn: MEMBER, extra: pageApi(comments) });
    renderAt("/contracts/42");
    await openChat(user);

    const panel = await screen.findByRole("complementary", { name: "Comments" });
    await user.click(within(panel).getByRole("radio", { name: "Legal only" }));
    await user.type(within(panel).getByLabelText("New comment"), "Hold the 1x cap.");
    await user.click(within(panel).getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      expect(comments.posts).toEqual([
        {
          entityType: "contract",
          entityId: "c1",
          body: "Hold the 1x cap.",
          visibility: "legal_only",
          mentions: [],
        },
      ]);
    });
    const rows = within(await screen.findByRole("list", { name: "Comments" })).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(2);
    expect(within(rows[1]!).getByText("Hold the 1x cap.")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Legal only")).toBeInTheDocument();
    // The box empties, so the next comment starts clean.
    expect(within(panel).getByLabelText("New comment")).toHaveValue("");
  });

  it("gives a Contributor two segments and no trace of a Legal Only comment", async () => {
    const user = userEvent.setup();
    // The API filtered at query time, so the Legal Only row is not in
    // the answer at all — there is no placeholder here to render.
    const comments = commentsApi([
      comment("c-1", "Redline goes back Friday.", "working_team"),
      comment("c-3", "Signature date is the 14th.", "full_thread"),
    ]);
    const record = recordApi(contractRow(), [person("u1", "creator"), person("u3", "contributor")]);
    stubApi({
      signedIn: CONTRIBUTOR,
      extra: (call: StubCall) =>
        comments.handler(call) ??
        (["/api/v1/contracts/options", "/api/v1/entities"].includes(call.url.pathname)
          ? problem(403, "You do not have permission to perform this action.")
          : record.handler(call)),
    });
    renderAt("/contracts/42");
    await openChat(user);

    const panel = await screen.findByRole("complementary", { name: "Comments" });
    // Absent, not disabled — the same convention the nav and the
    // settings rail follow. The seam refuses the tier regardless.
    expect(
      within(panel)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value")),
    ).toEqual(["working_team", "full_thread"]);
    expect(within(panel).queryByRole("radio", { name: "Legal only" })).not.toBeInTheDocument();

    const rows = within(await screen.findByRole("list", { name: "Comments" })).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(2);
    expect(within(panel).queryByText("Legal only")).not.toBeInTheDocument();
    expect(panel.textContent).not.toContain("1x cap");
    // The count is the filtered set's, so it hides no gap either.
    expect(within(panel).getByRole("img", { name: "2 comments" })).toBeInTheDocument();
  });

  it("lets a Contributor post into the rooms they are in", async () => {
    const user = userEvent.setup();
    const comments = commentsApi();
    const record = recordApi(contractRow(), [person("u1", "creator"), person("u3", "contributor")]);
    stubApi({
      signedIn: CONTRIBUTOR,
      extra: (call: StubCall) =>
        comments.handler(call) ??
        (["/api/v1/contracts/options", "/api/v1/entities"].includes(call.url.pathname)
          ? problem(403, "You do not have permission to perform this action.")
          : record.handler(call)),
    });
    renderAt("/contracts/42");
    await openChat(user);

    const panel = await screen.findByRole("complementary", { name: "Comments" });
    await user.type(within(panel).getByLabelText("New comment"), "Procurement has the PO ready.");
    await user.click(within(panel).getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      expect(comments.posts).toEqual([
        {
          entityType: "contract",
          entityId: "c1",
          body: "Procurement has the PO ready.",
          visibility: "working_team",
          mentions: [],
        },
      ]);
    });
  });

  it("says so when the thread cannot be read, and still takes a comment", async () => {
    const user = userEvent.setup();
    const comments = commentsApi();
    let readsRefused = true;
    const record = recordApi(contractRow());
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/v1/comments" && call.method === "GET" && readsRefused) {
          return problem(503, "The conversation is unavailable.");
        }
        return comments.handler(call) ?? record.handler(call);
      },
    });
    renderAt("/contracts/42");
    await openChat(user);

    const panel = await screen.findByRole("complementary", { name: "Comments" });
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "The conversation could not be read. Reopen the panel to try again.",
    );
    // A failed read draws no thread and no count — there is nothing to
    // be honest about, so nothing is claimed.
    expect(within(panel).queryByRole("list", { name: "Comments" })).not.toBeInTheDocument();
    expect(within(panel).queryByText("0")).not.toBeInTheDocument();

    // The composer is still the composer: the read failed, not the post.
    readsRefused = false;
    await user.type(within(panel).getByLabelText("New comment"), "Saying it anyway.");
    await user.click(within(panel).getByRole("button", { name: "Comment" }));
    await waitFor(() => {
      expect(comments.posts).toHaveLength(1);
    });
    // And the thread it could not read stays unread. Folding the posted
    // row into the failure would draw a one-row conversation under the
    // load error, which reads as the whole of it.
    expect(within(panel).queryByRole("list", { name: "Comments" })).not.toBeInTheDocument();
  });

  it("says so when the post is refused, and keeps the draft", async () => {
    const user = userEvent.setup();
    const record = recordApi(contractRow());
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/v1/comments" && call.method === "GET") {
          return json(200, { comments: [], nextCursor: null });
        }
        if (call.url.pathname === "/api/v1/comments" && call.method === "POST") {
          return problem(403, "You cannot post a comment at that visibility tier.");
        }
        return record.handler(call);
      },
    });
    renderAt("/contracts/42");
    await openChat(user);

    const panel = await screen.findByRole("complementary", { name: "Comments" });
    await user.type(within(panel).getByLabelText("New comment"), "Into a room I am not in.");
    await user.click(within(panel).getByRole("button", { name: "Comment" }));

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "You cannot post a comment at that visibility tier.",
    );
    expect(within(panel).getByLabelText("New comment")).toHaveValue("Into a room I am not in.");
  });

  /**
   * Mentions and tier promotion (M9/3).
   *
   * The composer stays plain text. Typing `@` opens the typeahead over
   * the people this record can reach; picking one writes their name into
   * the box and puts them on the list the post carries, so who a comment
   * addresses is a list and not a substring of prose (CMT-007).
   *
   * The promotion confirmation is asserted as what it is: an
   * explanation. It names who cannot hear the comment, offers the
   * narrowest tier that reaches them, and on cancel leaves the box
   * untouched and posts nothing. The refusal that holds when no dialog
   * was shown lives at the API seam, and is asserted there.
   */
  describe("mentions and tier promotion (M9/3)", () => {
    /** Opens the panel and answers the composer's box. */
    async function composerIn(user: ReturnType<typeof userEvent.setup>) {
      await openChat(user);
      const panel = await screen.findByRole("complementary", { name: "Comments" });
      return { panel, box: within(panel).getByLabelText("New comment") };
    }

    it("opens a typeahead on @ and turns a pick into a chip carrying the person's name", async () => {
      const user = userEvent.setup();
      stubApi({ signedIn: MEMBER, extra: pageApi(commentsApi()) });
      renderAt("/contracts/42");
      const { panel, box } = await composerIn(user);

      await user.type(box, "@Cas");
      const list = await within(panel).findByRole("listbox", { name: "People you can mention" });
      // Narrowed to what was typed: the other candidate is not offered.
      expect(within(list).getAllByRole("option")).toHaveLength(1);
      expect(within(list).getByRole("option", { name: "Casey Contributor" })).toBeInTheDocument();

      await user.click(within(list).getByRole("option", { name: "Casey Contributor" }));
      // The name goes into the text, where the author is typing.
      expect(box).toHaveValue("@Casey Contributor ");
      // And the person goes onto the list the post will carry, drawn as
      // a chip rather than as raw text.
      const mentioned = within(panel).getByRole("list", { name: "Mentioned" });
      expect(within(mentioned).getByText("Casey Contributor")).toBeInTheDocument();
    });

    it("picks the active row with Enter rather than posting a half-written comment", async () => {
      const user = userEvent.setup();
      const comments = commentsApi();
      stubApi({ signedIn: MEMBER, extra: pageApi(comments) });
      renderAt("/contracts/42");
      const { box } = await composerIn(user);

      await user.type(box, "@Nadia{Enter}");
      expect(box).toHaveValue("@Nadia Counsel ");
      expect(comments.posts).toEqual([]);
    });

    it("posts the mentioned people as a list beside the plain-text body", async () => {
      const user = userEvent.setup();
      const comments = commentsApi();
      stubApi({ signedIn: MEMBER, extra: pageApi(comments) });
      renderAt("/contracts/42");
      const { panel, box } = await composerIn(user);

      await user.type(box, "@Casey{Enter}");
      await user.type(box, "what did procurement say?");
      await user.click(within(panel).getByRole("button", { name: "Comment" }));

      await waitFor(() => {
        expect(comments.posts).toEqual([
          {
            entityType: "contract",
            entityId: "c1",
            body: "@Casey Contributor what did procurement say?",
            visibility: "working_team",
            mentions: ["u3"],
          },
        ]);
      });
    });

    it("drops a mention when its name is taken out of the box", async () => {
      const user = userEvent.setup();
      const comments = commentsApi();
      stubApi({ signedIn: MEMBER, extra: pageApi(comments) });
      renderAt("/contracts/42");
      const { panel, box } = await composerIn(user);

      await user.type(box, "@Casey{Enter}over to you.");
      expect(within(panel).getByRole("list", { name: "Mentioned" })).toBeInTheDocument();

      // The chip's own control takes the name out of the text too, so
      // nothing is left addressing somebody the post does not name.
      await user.click(within(panel).getByRole("button", { name: "Remove Casey Contributor" }));
      expect(box).toHaveValue("over to you.");
      expect(within(panel).queryByRole("list", { name: "Mentioned" })).not.toBeInTheDocument();

      await user.click(within(panel).getByRole("button", { name: "Comment" }));
      await waitFor(() => {
        expect(comments.posts).toEqual([
          {
            entityType: "contract",
            entityId: "c1",
            body: "over to you.",
            visibility: "working_team",
            mentions: [],
          },
        ]);
      });
    });

    it("asks before posting a Legal Only comment that names a Contributor, and offers the narrowest tier", async () => {
      const user = userEvent.setup();
      const comments = commentsApi();
      stubApi({ signedIn: MEMBER, extra: pageApi(comments) });
      renderAt("/contracts/42");
      const { panel, box } = await composerIn(user);

      await user.click(within(panel).getByRole("radio", { name: "Legal only" }));
      await user.type(box, "@Casey{Enter}what did procurement say?");
      await user.click(within(panel).getByRole("button", { name: "Comment" }));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Widen the audience?")).toBeInTheDocument();
      // It names the person, and it offers Working team — the narrowest
      // tier that includes them, never a jump to Full thread.
      expect(dialog.textContent).toContain("Casey Contributor cannot see a legal only comment");
      expect(dialog.textContent).toContain("working team");
      expect(dialog.textContent).not.toContain("full thread");
      // Nothing is posted while the question is open.
      expect(comments.posts).toEqual([]);

      await user.click(within(dialog).getByRole("button", { name: "Widen and post" }));
      await waitFor(() => {
        expect(comments.posts).toEqual([
          {
            entityType: "contract",
            entityId: "c1",
            body: "@Casey Contributor what did procurement say?",
            visibility: "working_team",
            mentions: ["u3"],
          },
        ]);
      });
    });

    it("cancels the promotion, posting nothing and keeping the text and the mention", async () => {
      const user = userEvent.setup();
      const comments = commentsApi();
      stubApi({ signedIn: MEMBER, extra: pageApi(comments) });
      renderAt("/contracts/42");
      const { panel, box } = await composerIn(user);

      await user.click(within(panel).getByRole("radio", { name: "Legal only" }));
      await user.type(box, "@Casey{Enter}what did procurement say?");
      await user.click(within(panel).getByRole("button", { name: "Comment" }));

      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(comments.posts).toEqual([]);
      // The composer is exactly as it was, so changing the mention is as
      // available as widening the room.
      expect(within(panel).getByLabelText("New comment")).toHaveValue(
        "@Casey Contributor what did procurement say?",
      );
      expect(
        within(within(panel).getByRole("list", { name: "Mentioned" })).getByText(
          "Casey Contributor",
        ),
      ).toBeInTheDocument();
      expect(within(panel).getByRole("radio", { name: "Legal only" })).toBeChecked();
    });

    it("asks nothing when everybody named already hears the selected tier", async () => {
      const user = userEvent.setup();
      const comments = commentsApi();
      stubApi({ signedIn: MEMBER, extra: pageApi(comments) });
      renderAt("/contracts/42");
      const { panel, box } = await composerIn(user);

      await user.click(within(panel).getByRole("radio", { name: "Legal only" }));
      await user.type(box, "@Nadia{Enter}hold the 1x cap.");
      await user.click(within(panel).getByRole("button", { name: "Comment" }));

      await waitFor(() => {
        expect(comments.posts).toEqual([
          {
            entityType: "contract",
            entityId: "c1",
            body: "@Nadia Counsel hold the 1x cap.",
            visibility: "legal_only",
            mentions: ["u2"],
          },
        ]);
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("renders a posted comment's mentions as chips, not as raw text", async () => {
      const user = userEvent.setup();
      stubApi({
        signedIn: MEMBER,
        extra: pageApi(
          commentsApi([
            comment(
              "c-1",
              "@Casey Contributor what did procurement say?",
              "working_team",
              AUTHOR,
              "2026-08-12T09:00:00.000Z",
              [{ id: "u3", displayName: "Casey Contributor" }],
            ),
          ]),
        ),
      });
      renderAt("/contracts/42");
      await openChat(user);

      const row = within(await screen.findByRole("list", { name: "Comments" })).getAllByRole(
        "listitem",
      )[0]!;
      // The name is its own element, so it reads as a person; the rest
      // of the sentence is still the author's plain text.
      const chip = within(row).getByText("@Casey Contributor");
      expect(chip.tagName).toBe("SPAN");
      expect(row.textContent).toContain("@Casey Contributor what did procurement say?");
    });

    it("never asks a Contributor to promote, because every name they are offered hears their tiers", async () => {
      const user = userEvent.setup();
      const comments = commentsApi();
      const record = recordApi(contractRow(), [
        person("u1", "creator"),
        person("u3", "contributor"),
      ]);
      stubApi({
        signedIn: CONTRIBUTOR,
        extra: (call: StubCall) =>
          comments.handler(call) ??
          (["/api/v1/contracts/options", "/api/v1/entities"].includes(call.url.pathname)
            ? problem(403, "You do not have permission to perform this action.")
            : record.handler(call)),
      });
      renderAt("/contracts/42");
      const { panel, box } = await composerIn(user);

      // No Legal Only segment to select, so no mention can need one.
      expect(within(panel).queryByRole("radio", { name: "Legal only" })).not.toBeInTheDocument();
      await user.type(box, "@Nadia{Enter}we are ready.");
      await user.click(within(panel).getByRole("button", { name: "Comment" }));

      await waitFor(() => {
        expect(comments.posts).toEqual([
          {
            entityType: "contract",
            entityId: "c1",
            body: "@Nadia Counsel we are ready.",
            visibility: "working_team",
            mentions: ["u2"],
          },
        ]);
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  /**
   * Editing, deleting, and redacting a comment (M9/4, DES-025).
   *
   * Three corrections, three owners. The row's menu offers what this
   * viewer may do and nothing else — absent, not disabled. An edited row
   * wears the marker; a removed row keeps its place as a tombstone, and
   * the tombstone says which hand removed it, because an author taking
   * their own words back and an Administrator removing text from the
   * record are different facts.
   */
  describe("correcting a comment", () => {
    const ADMINISTRATOR = {
      id: "u1",
      email: "admin@example.com",
      displayName: "Ada Admin",
      role: "administrator",
    };

    /** Opens the panel and answers its rows. */
    async function rowsIn(
      user: ReturnType<typeof userEvent.setup>,
      api: ReturnType<typeof commentsApi>,
      signedIn: typeof MEMBER = MEMBER,
    ) {
      stubApi({ signedIn, extra: pageApi(api) });
      renderAt("/contracts/42");
      await openChat(user);
      const thread = await screen.findByRole("list", { name: "Comments" });
      return within(thread).getAllByRole("listitem");
    }

    /** Opens one row's overflow menu. */
    async function menuIn(user: ReturnType<typeof userEvent.setup>, row: HTMLElement) {
      await user.click(within(row).getByRole("button", { name: "Comment actions" }));
      return screen.findByRole("menu");
    }

    it("lets the author edit their own comment, and marks the row edited", async () => {
      const user = userEvent.setup();
      const api = commentsApi([comment("c-1", "Redline goes back Thusday.", "working_team")]);
      const [row] = await rowsIn(user, api);

      // Nothing to report before the edit.
      expect(within(row!).queryByText("edited")).not.toBeInTheDocument();

      await user.click(within(await menuIn(user, row!)).getByRole("menuitem", { name: "Edit" }));
      const box = within(row!).getByLabelText("Edit comment");
      expect(box).toHaveValue("Redline goes back Thusday.");
      await user.clear(box);
      await user.type(box, "Redline goes back Thursday.");
      await user.click(within(row!).getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(api.corrections).toEqual([
          { method: "PATCH", id: "c-1", body: { body: "Redline goes back Thursday." } },
        ]);
      });
      // The new text, and the marker that says a reader's copy is stale.
      expect(await within(row!).findByText("Redline goes back Thursday.")).toBeInTheDocument();
      expect(within(row!).getByText("edited")).toBeInTheDocument();
      expect(within(row!).queryByLabelText("Edit comment")).not.toBeInTheDocument();
    });

    it("cancels an edit, putting the row back with nothing sent", async () => {
      const user = userEvent.setup();
      const api = commentsApi([comment("c-1", "As it was.", "working_team")]);
      const [row] = await rowsIn(user, api);

      await user.click(within(await menuIn(user, row!)).getByRole("menuitem", { name: "Edit" }));
      await user.type(within(row!).getByLabelText("Edit comment"), " And more.");
      await user.click(within(row!).getByRole("button", { name: "Cancel" }));

      expect(within(row!).getByText("As it was.")).toBeInTheDocument();
      expect(within(row!).queryByLabelText("Edit comment")).not.toBeInTheDocument();
      expect(api.corrections).toEqual([]);
    });

    it("draws the edited marker on a row that arrived edited", async () => {
      const user = userEvent.setup();
      const api = commentsApi([
        comment("c-1", "Plain.", "working_team"),
        comment("c-2", "Corrected.", "working_team", AUTHOR, "2026-08-12T09:00:00.000Z", [], {
          editedAt: "2026-08-12T10:00:00.000Z",
        }),
      ]);
      const rows = await rowsIn(user, api);

      expect(within(rows[0]!).queryByText("edited")).not.toBeInTheDocument();
      expect(within(rows[1]!).getByText("edited")).toBeInTheDocument();
    });

    it("soft-deletes the author's own comment, leaving a tombstone in its place", async () => {
      const user = userEvent.setup();
      const api = commentsApi([
        comment("c-1", "Before.", "working_team"),
        comment("c-2", "Said in error.", "working_team"),
        comment("c-3", "After.", "working_team"),
      ]);
      const rows = await rowsIn(user, api);

      await user.click(
        within(await menuIn(user, rows[1]!)).getByRole("menuitem", { name: "Delete" }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Delete this comment?")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(api.corrections).toEqual([{ method: "DELETE", id: "c-2" }]);
      });
      // Nothing above or below shifted, and the text is gone.
      const after = within(await screen.findByRole("list", { name: "Comments" })).getAllByRole(
        "listitem",
      );
      expect(after).toHaveLength(3);
      expect(within(after[0]!).getByText("Before.")).toBeInTheDocument();
      expect(within(after[1]!).getByText("Comment deleted by its author.")).toBeInTheDocument();
      expect(within(after[1]!).queryByText("Said in error.")).not.toBeInTheDocument();
      expect(within(after[2]!).getByText("After.")).toBeInTheDocument();
    });

    it("cancels a delete, sending nothing", async () => {
      const user = userEvent.setup();
      const api = commentsApi([comment("c-1", "Still here.", "working_team")]);
      const [row] = await rowsIn(user, api);

      await user.click(within(await menuIn(user, row!)).getByRole("menuitem", { name: "Delete" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(api.corrections).toEqual([]);
      expect(within(row!).getByText("Still here.")).toBeInTheDocument();
    });

    it("gives an Administrator the redact on somebody else's comment, and no edit or delete", async () => {
      const user = userEvent.setup();
      const api = commentsApi([comment("c-1", "Pasted into the wrong record.", "working_team")]);
      const [row] = await rowsIn(user, api, ADMINISTRATOR);

      // A correction to somebody else's words is a redact, not an edit.
      const menu = await menuIn(user, row!);
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item) => item.textContent),
      ).toEqual(["Redact"]);

      await user.click(within(menu).getByRole("menuitem", { name: "Redact" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("Redact this comment?")).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Redact" }));

      await waitFor(() => {
        expect(api.corrections).toEqual([{ method: "REDACT", id: "c-1" }]);
      });
      const after = within(await screen.findByRole("list", { name: "Comments" })).getAllByRole(
        "listitem",
      );
      // The tombstone names the hand that removed it.
      expect(
        within(after[0]!).getByText("Comment removed by an Administrator."),
      ).toBeInTheDocument();
      expect(
        within(after[0]!).queryByText("Pasted into the wrong record."),
      ).not.toBeInTheDocument();
    });

    it("still offers the redact on a comment the author already deleted", async () => {
      const user = userEvent.setup();
      // The case the redact exists for: a soft delete only moved the
      // text to comment_revisions, and this is what takes it out.
      const api = commentsApi([
        comment("c-1", "", "working_team", AUTHOR, "2026-08-12T09:00:00.000Z", [], {
          deletedAt: "2026-08-12T10:00:00.000Z",
        }),
      ]);
      const [row] = await rowsIn(user, api, ADMINISTRATOR);

      expect(within(row!).getByText("Comment deleted by its author.")).toBeInTheDocument();
      const menu = await menuIn(user, row!);
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item) => item.textContent),
      ).toEqual(["Redact"]);
    });

    it("offers the author edit and delete, and no redact", async () => {
      const user = userEvent.setup();
      const api = commentsApi([comment("c-1", "My own words.", "working_team")]);
      const [row] = await rowsIn(user, api);

      const menu = await menuIn(user, row!);
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item) => item.textContent),
      ).toEqual(["Edit", "Delete"]);
    });

    it("gives a non-author who is no Administrator no menu at all", async () => {
      const user = userEvent.setup();
      const api = commentsApi([comment("c-1", "Not yours.", "working_team")]);
      const record = recordApi(contractRow(), [
        person("u1", "creator"),
        person("u3", "contributor"),
      ]);
      stubApi({
        signedIn: CONTRIBUTOR,
        extra: (call: StubCall) =>
          api.handler(call) ??
          (["/api/v1/contracts/options", "/api/v1/entities"].includes(call.url.pathname)
            ? problem(403, "You do not have permission to perform this action.")
            : record.handler(call)),
      });
      renderAt("/contracts/42");
      await openChat(user);

      const thread = await screen.findByRole("list", { name: "Comments" });
      const [row] = within(thread).getAllByRole("listitem");
      expect(
        within(row!).queryByRole("button", { name: "Comment actions" }),
      ).not.toBeInTheDocument();
    });

    it("draws no menu on a comment already redacted", async () => {
      const user = userEvent.setup();
      const api = commentsApi([
        comment("c-1", "", "working_team", CASEY, "2026-08-12T09:00:00.000Z", [], {
          redactedAt: "2026-08-12T10:00:00.000Z",
        }),
      ]);
      const [row] = await rowsIn(user, api, ADMINISTRATOR);

      expect(within(row!).getByText("Comment removed by an Administrator.")).toBeInTheDocument();
      expect(
        within(row!).queryByRole("button", { name: "Comment actions" }),
      ).not.toBeInTheDocument();
    });

    it("keeps the edit box and its text when a save is refused", async () => {
      const user = userEvent.setup();
      const api = commentsApi([comment("c-1", "As it was.", "working_team")]);
      const record = recordApi(contractRow());
      stubApi({
        signedIn: MEMBER,
        extra: (call: StubCall) =>
          call.url.pathname === "/api/v1/comments/c-1" && call.method === "PATCH"
            ? problem(409, "This comment has been removed. Its text cannot be changed.")
            : (api.handler(call) ?? record.handler(call)),
      });
      renderAt("/contracts/42");
      await openChat(user);
      const thread = await screen.findByRole("list", { name: "Comments" });
      const [row] = within(thread).getAllByRole("listitem");

      await user.click(within(await menuIn(user, row!)).getByRole("menuitem", { name: "Edit" }));
      const box = within(row!).getByLabelText("Edit comment");
      await user.clear(box);
      await user.type(box, "A correction that never lands.");
      await user.click(within(row!).getByRole("button", { name: "Save" }));

      expect(await within(row!).findByRole("alert")).toHaveTextContent(
        "This comment has been removed. Its text cannot be changed.",
      );
      // Nothing typed is lost to a failed save.
      expect(within(row!).getByLabelText("Edit comment")).toHaveValue(
        "A correction that never lands.",
      );
    });

    it("says so when a correction is refused, and leaves the row as it was", async () => {
      const user = userEvent.setup();
      const api = commentsApi([comment("c-1", "Mine to take back.", "working_team")]);
      const record = recordApi(contractRow());
      stubApi({
        signedIn: MEMBER,
        extra: (call: StubCall) =>
          call.url.pathname === "/api/v1/comments/c-1" && call.method === "DELETE"
            ? problem(403, "Only the author can delete a comment.")
            : (api.handler(call) ?? record.handler(call)),
      });
      renderAt("/contracts/42");
      await openChat(user);
      const thread = await screen.findByRole("list", { name: "Comments" });
      const [row] = within(thread).getAllByRole("listitem");

      await user.click(within(await menuIn(user, row!)).getByRole("menuitem", { name: "Delete" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      expect(await within(row!).findByRole("alert")).toHaveTextContent(
        "Only the author can delete a comment.",
      );
      expect(within(row!).getByText("Mine to take back.")).toBeInTheDocument();
    });
  });

  /**
   * The unread badge (M9/5, CMT-004).
   *
   * The count is the seam's, never the panel's: the API computes it over
   * the filtered set, and the icon draws the number it was given. So
   * these tests assert what the icon says and what the panel told the
   * seam — the two things a reader and the database can each see.
   *
   * The badge itself is decorative, because the count is folded into the
   * icon's accessible name (`applets.labelWithBadge`). That name is what
   * is asserted: a reader on a screen reader hears "Comments (3)", and a
   * cleared badge is an icon named "Comments" again.
   */
  describe("the unread badge", () => {
    it("carries the seam's count on the chat icon, and on no other applet", async () => {
      stubApi({ signedIn: ADMIN, extra: pageApi(commentsApi([], CANDIDATES, 3)) });
      renderAt("/contracts/42");

      const bar = await screen.findByRole("toolbar", { name: "Applets" });
      expect(await within(bar).findByRole("button", { name: "Comments (3)" })).toBeInTheDocument();
      // CMT-004: chat is the only applet that carries one. The settings
      // deep-link is the record's other slot, and it is named plainly.
      expect(within(bar).getByRole("link", { name: "Contract settings" })).toBeInTheDocument();
    });

    it("draws no badge when there is nothing unread", async () => {
      stubApi({ signedIn: MEMBER, extra: pageApi(commentsApi()) });
      renderAt("/contracts/42");

      const bar = await screen.findByRole("toolbar", { name: "Applets" });
      expect(await within(bar).findByRole("button", { name: "Comments" })).toBeInTheDocument();
    });

    it("marks the record read when the panel opens, and the badge clears", async () => {
      const user = userEvent.setup();
      const comments = commentsApi(
        [comment("c-1", "Redline goes back Friday.", "working_team", CASEY)],
        CANDIDATES,
        2,
      );
      stubApi({ signedIn: MEMBER, extra: pageApi(comments) });
      renderAt("/contracts/42");

      const bar = await screen.findByRole("toolbar", { name: "Applets" });
      const icon = await within(bar).findByRole("button", { name: "Comments (2)" });
      await user.click(icon);
      await screen.findByRole("complementary", { name: "Comments" });

      // The panel says it has read the record, by the same entity
      // reference the thread is keyed by.
      await waitFor(() => {
        expect(comments.marksRead).toEqual([{ entityType: "contract", entityId: "c1" }]);
      });
      await waitFor(() => {
        expect(within(bar).getByRole("button", { name: "Comments" })).toBeInTheDocument();
      });
    });

    it("keeps the badge when the thread could not be read", async () => {
      const user = userEvent.setup();
      const comments = commentsApi([], CANDIDATES, 2);
      const record = recordApi(contractRow());
      stubApi({
        signedIn: MEMBER,
        extra: (call: StubCall) =>
          call.url.pathname === "/api/v1/comments" && call.method === "GET"
            ? problem(500, "The conversation could not be read.")
            : (comments.handler(call) ?? record.handler(call)),
      });
      renderAt("/contracts/42");

      const bar = await screen.findByRole("toolbar", { name: "Applets" });
      await user.click(await within(bar).findByRole("button", { name: "Comments (2)" }));
      const panel = await screen.findByRole("complementary", { name: "Comments" });
      expect(await within(panel).findByRole("alert")).toHaveTextContent(
        "The conversation could not be read.",
      );

      // Nothing was shown, so nothing was read. Clearing the badge here
      // would take the signal away without delivering what it points at.
      expect(comments.marksRead).toEqual([]);
      expect(within(bar).getByRole("button", { name: "Comments (2)" })).toBeInTheDocument();
    });
  });

  /**
   * DES-009 inside a confidential record (M10/5): Tier 1's lock-only
   * micro-marker on every row, and Tier 3's notice under the composer.
   *
   * jsdom computes no colours, so what is asserted is the token class
   * that carries the treatment. There is no add-as-watcher offer to
   * assert the absence of copy for — CMT-007 superseded that clause
   * (CTR-022) — so what is asserted is that the notice states the bound
   * and nothing offers to widen the audience of the record itself.
   */
  describe("inside a confidential record (M10/5)", () => {
    const NOTICE =
      "Confidential contract — whichever audience you pick, only the contract team, the Owner, and Administrators can read it.";

    /** The record seam with the flag set, plus the thread's. */
    function confidentialPage(comments: ReturnType<typeof commentsApi>) {
      return pageApi(comments, recordApi(contractRow({ isConfidential: true })));
    }

    it("marks every comment beside its timestamp, whatever its tier", async () => {
      const user = userEvent.setup();
      const comments = commentsApi([
        comment("c-1", "Redline goes back Friday.", "working_team"),
        comment("c-2", "Privilege point for the file.", "legal_only"),
      ]);
      stubApi({ signedIn: MEMBER, extra: confidentialPage(comments) });
      renderAt("/contracts/42");
      await openChat(user);

      const thread = await screen.findByRole("list", { name: "Comments" });
      const rows = within(thread).getAllByRole("listitem");
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        // Lock only — no "CONFI" beside a timestamp; the record page
        // is already saying the word on its banner.
        const lock = row.querySelector("svg.lucide-lock.text-confidential");
        expect(lock).not.toBeNull();
        expect(row).not.toHaveTextContent("CONFI");
      }
    });

    it("marks no comment on a record that is not confidential", async () => {
      const user = userEvent.setup();
      // A Legal Only row, deliberately: its tier badge carries a lock of
      // its own (CMT-003), and the marker must be told apart from it.
      const comments = commentsApi([comment("c-1", "Privilege point.", "legal_only")]);
      stubApi({ signedIn: MEMBER, extra: pageApi(comments) });
      renderAt("/contracts/42");
      await openChat(user);

      const thread = await screen.findByRole("list", { name: "Comments" });
      const row = within(thread).getAllByRole("listitem")[0]!;
      expect(row.querySelector("svg.lucide-lock")).not.toBeNull();
      expect(row.querySelector("svg.lucide-lock.text-confidential")).toBeNull();
    });

    it("states the bound under the composer, and states it at every tier", async () => {
      const user = userEvent.setup();
      const comments = commentsApi();
      stubApi({ signedIn: MEMBER, extra: confidentialPage(comments) });
      renderAt("/contracts/42");
      await openChat(user);

      const notice = await screen.findByText(NOTICE);
      expect(notice).toHaveClass("text-confidential");
      // The tier line still says which room; the notice says the whole
      // panel is inside a wall.
      expect(
        screen.getByText("Visible to the legal team and Contributors on this record."),
      ).toBeInTheDocument();

      // Every segment, and the statement holds at each of them.
      for (const segment of ["Legal only", "Full thread"]) {
        await user.click(screen.getByRole("radio", { name: segment }));
        expect(screen.getByText(NOTICE)).toBeInTheDocument();
      }
    });

    it("says nothing about confidentiality on a record that is not confidential", async () => {
      const user = userEvent.setup();
      stubApi({ signedIn: MEMBER, extra: pageApi(commentsApi()) });
      renderAt("/contracts/42");
      await openChat(user);

      await screen.findByRole("textbox", { name: "New comment" });
      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    });

    it("offers no membership grant with a mention — CMT-007 replaced that clause", async () => {
      const user = userEvent.setup();
      const comments = commentsApi();
      stubApi({ signedIn: MEMBER, extra: confidentialPage(comments) });
      renderAt("/contracts/42");
      await openChat(user);

      const box = await screen.findByRole("textbox", { name: "New comment" });
      await user.type(box, "@Casey");
      await user.click(await screen.findByRole("option", { name: "Casey Contributor" }));
      await user.type(box, "please look");
      await user.click(screen.getByRole("button", { name: "Comment" }));

      // The typeahead offers only people the record reaches, so the
      // post goes straight through: no watcher confirmation, no grant.
      await waitFor(() =>
        expect(comments.posts).toEqual([
          {
            entityType: "contract",
            entityId: "c1",
            body: "@Casey Contributor please look",
            visibility: "working_team",
            mentions: ["u3"],
          },
        ]),
      );
      expect(screen.queryByText(/watcher/i)).not.toBeInTheDocument();
    });

    it("uses one Lock glyph in the panel, and no alternate icon", async () => {
      const user = userEvent.setup();
      const comments = commentsApi([comment("c-1", "Redline goes back Friday.", "working_team")]);
      stubApi({ signedIn: MEMBER, extra: confidentialPage(comments) });
      const { view } = renderAt("/contracts/42");
      await openChat(user);

      const panel = await screen.findByRole("complementary", { name: "Comments" });
      // The row's marker, the Legal Only segment's glyph, and the
      // composer notice — all the same glyph.
      expect(panel.querySelectorAll("svg.lucide-lock").length).toBeGreaterThan(0);
      expect(view.container.querySelector("svg.lucide-shield-alert")).toBeNull();
      expect(view.container.querySelector("svg.lucide-eye-off")).toBeNull();
    });
  });

  /**
   * The bound and its head control (CTR-024, DES-031).
   *
   * The thread is paged from the newest end, so the panel opens on the
   * conversation as it stands and the older conversation arrives above
   * it — which is where the control that fetches it goes.
   */
  describe("the paged thread (CTR-024, DES-031)", () => {
    /** Two pages: the newest one first, the older one behind a cursor. */
    function pagedComments() {
      const NEWEST = [comment("c-newest", "The last word.", "working_team")];
      const OLDER = [comment("c-older", "The first word.", "working_team")];
      const cursors: (string | null)[] = [];
      const handler = (call: StubCall): Response | undefined => {
        if (call.url.pathname === "/api/v1/comments/mention-candidates") {
          return json(200, { candidates: [] });
        }
        if (call.url.pathname === "/api/v1/comments/unread") return json(200, { unread: 0 });
        if (call.url.pathname === "/api/v1/comments/read") return json(200, { unread: 0 });
        if (call.url.pathname !== "/api/v1/comments" || call.method !== "GET") return undefined;
        const cursor = call.url.searchParams.get("cursor");
        cursors.push(cursor);
        return cursor === null
          ? json(200, { comments: NEWEST, nextCursor: "c-newest" })
          : json(200, { comments: OLDER, nextCursor: null });
      };
      return { handler, cursors, NEWEST, OLDER };
    }

    it("opens on the newest page and puts the older one above it", async () => {
      const user = userEvent.setup();
      const paged = pagedComments();
      stubApi({
        signedIn: MEMBER,
        extra: (call: StubCall) => paged.handler(call) ?? recordApi(contractRow()).handler(call),
      });
      renderAt("/contracts/42");
      await openChat(user);

      const panel = await screen.findByRole("complementary", { name: "Comments" });
      expect(await within(panel).findByText("The last word.")).toBeInTheDocument();
      expect(within(panel).queryByText("The first word.")).not.toBeInTheDocument();

      await user.click(within(panel).getByRole("button", { name: "Show older" }));

      // Prepended: the older comment goes above the newer one, because
      // the thread reads oldest to newest (CMT-002).
      const rows = await within(panel).findAllByRole("listitem");
      expect(rows[0]).toHaveTextContent("The first word.");
      expect(rows[1]).toHaveTextContent("The last word.");
      expect(paged.cursors).toEqual([null, "c-newest"]);
      // The start of the thread: the control goes with it.
      expect(within(panel).queryByRole("button", { name: "Show older" })).not.toBeInTheDocument();
    });

    it("puts focus on the oldest comment it brought, because the thread grew above the reader", async () => {
      const user = userEvent.setup();
      const paged = pagedComments();
      stubApi({
        signedIn: MEMBER,
        extra: (call: StubCall) => paged.handler(call) ?? recordApi(contractRow()).handler(call),
      });
      renderAt("/contracts/42");
      await openChat(user);

      const panel = await screen.findByRole("complementary", { name: "Comments" });
      await within(panel).findByText("The last word.");
      await user.click(within(panel).getByRole("button", { name: "Show older" }));

      const landed = (await within(panel).findByText("The first word.")).closest("li");
      await waitFor(() => expect(landed).toHaveFocus());
    });

    it("keeps the control and the cursor when an older page fails", async () => {
      const user = userEvent.setup();
      const NEWEST = [comment("c-newest", "The last word.", "working_team")];
      const OLDER = [comment("c-older", "The first word.", "working_team")];
      // The first reach backwards is refused; the second is not.
      let reached = 0;
      const paging = (call: StubCall): Response | undefined => {
        if (call.url.pathname === "/api/v1/comments/mention-candidates") {
          return json(200, { candidates: [] });
        }
        if (call.url.pathname === "/api/v1/comments/unread") return json(200, { unread: 0 });
        if (call.url.pathname === "/api/v1/comments/read") return json(200, { unread: 0 });
        if (call.url.pathname !== "/api/v1/comments" || call.method !== "GET") return undefined;
        if (call.url.searchParams.get("cursor") === null) {
          return json(200, { comments: NEWEST, nextCursor: "c-newest" });
        }
        reached += 1;
        return reached === 1
          ? problem(503, "The thread is not available.")
          : json(200, { comments: OLDER, nextCursor: null });
      };
      stubApi({
        signedIn: MEMBER,
        extra: (call: StubCall) => paging(call) ?? recordApi(contractRow()).handler(call),
      });
      renderAt("/contracts/42");
      await openChat(user);

      const panel = await screen.findByRole("complementary", { name: "Comments" });
      await within(panel).findByText("The last word.");
      await user.click(within(panel).getByRole("button", { name: "Show older" }));

      // The failure is spoken beside the control, and the control stays
      // — a thread that swallowed its cursor would strand the reader at
      // the newest page with no way back.
      expect(await within(panel).findByRole("alert")).toHaveTextContent(
        "The earlier comments could not be read. Try again.",
      );
      const again = within(panel).getByRole("button", { name: "Show older" });
      expect(within(panel).queryByText("The first word.")).not.toBeInTheDocument();

      await user.click(again);

      const rows = await within(panel).findAllByRole("listitem");
      expect(rows[0]).toHaveTextContent("The first word.");
      expect(rows[1]).toHaveTextContent("The last word.");
    });

    it("draws no control at all when the first page is the whole thread", async () => {
      const user = userEvent.setup();
      const comments = commentsApi([comment("c1", "Only this.", "working_team")]);
      stubApi({ signedIn: MEMBER, extra: pageApi(comments) });
      renderAt("/contracts/42");
      await openChat(user);

      const panel = await screen.findByRole("complementary", { name: "Comments" });
      expect(await within(panel).findByText("Only this.")).toBeInTheDocument();
      expect(within(panel).queryByRole("button", { name: "Show older" })).not.toBeInTheDocument();
    });
  });
});

describe("the contract record's history applet (M9/6)", () => {
  const NADIA = { id: "u2", displayName: "Nadia Counsel", image: null, archived: false };

  /** One activity entry as the seam answers it. */
  function entry(
    id: string,
    action: string,
    payload: Record<string, unknown> = {},
    visibility = "working_team",
    createdAt = "2026-08-12T09:00:00.000Z",
    actor: typeof NADIA | null = NADIA,
  ) {
    return { id, action, visibility, actor, createdAt, payload };
  }

  /**
   * The feed seam, paged the way the API is: one page and a cursor, and
   * the cursor names where the next page starts. The handler records
   * every cursor it was asked for, so paging is asserted at the seam
   * rather than by counting rows on screen.
   */
  function activityApi(pages: ReturnType<typeof entry>[][]) {
    const cursors: (string | null)[] = [];
    /** The reference each read was keyed by, so the entity-generic
     * claim is asserted rather than assumed. */
    const reads: Record<string, string | null>[] = [];
    const handler = (call: StubCall): Response | undefined => {
      if (call.url.pathname !== "/api/v1/activity" || call.method !== "GET") return undefined;
      const cursor = call.url.searchParams.get("cursor");
      cursors.push(cursor);
      reads.push({
        entityType: call.url.searchParams.get("entityType"),
        entityId: call.url.searchParams.get("entityId"),
      });
      const index = cursor === null ? 0 : pages.findIndex((page) => page.at(-1)?.id === cursor) + 1;
      const entries = pages[index] ?? [];
      const next = pages[index + 1] ? (entries.at(-1)?.id ?? null) : null;
      return json(200, { entries, nextCursor: next });
    };
    return { handler, cursors, reads };
  }

  function pageApi(activity: ReturnType<typeof activityApi>, record = recordApi(contractRow())) {
    return (call: StubCall) => activity.handler(call) ?? record.handler(call);
  }

  /** Opens the history panel from the activity bar and answers its icon. */
  async function openHistory(user: ReturnType<typeof userEvent.setup>) {
    const bar = await screen.findByRole("toolbar", { name: "Applets" });
    const icon = within(bar).getByRole("button", { name: "History" });
    await user.click(icon);
    return icon;
  }

  it("opens and closes the history panel from the bar, beside chat and settings", async () => {
    const user = userEvent.setup();
    const activity = activityApi([[entry("a1", "contract.created")]]);
    stubApi({ signedIn: ADMIN, extra: pageApi(activity) });
    renderAt("/contracts/42");

    const bar = await screen.findByRole("toolbar", { name: "Applets" });
    // The third slot, joining the two that were already there.
    expect(within(bar).getByRole("button", { name: "Comments" })).toBeInTheDocument();
    expect(within(bar).getByRole("link", { name: "Contract settings" })).toBeInTheDocument();

    const icon = await openHistory(user);
    const panel = await screen.findByRole("complementary", { name: "History" });
    expect(icon).toHaveAttribute("aria-expanded", "true");
    // Keyed by the record's entity reference, never by its CTR-003
    // number — that is what makes the panel entity-generic.
    await waitFor(() => {
      expect(activity.reads).toEqual([{ entityType: "contract", entityId: "c1" }]);
    });
    expect(activity.cursors).toEqual([null]);

    await user.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "History" })).not.toBeInTheDocument();
    expect(icon).toHaveFocus();
  });

  it("reads nothing until the panel is opened", async () => {
    const activity = activityApi([[entry("a1", "contract.created")]]);
    stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
    renderAt("/contracts/42");

    await screen.findByRole("toolbar", { name: "Applets" });
    // The chat applet's badge is read as the page opens (CMT-004). The
    // feed is not: a closed panel is a tool nobody has asked for.
    expect(activity.cursors).toEqual([]);
  });

  it("writes each entry as a sentence naming the actor and the action", async () => {
    const user = userEvent.setup();
    const activity = activityApi([
      [
        entry("a7", "contract.confidentiality_cleared", { number: 42 }),
        entry("a6", "contract.confidentiality_set", { number: 42 }),
        entry("a5", "comment.posted", { commentId: "c9" }, "legal_only"),
        entry("a4", "contract.counterparty_added", { counterparty: "Orion Cloud Ltd" }),
        entry("a3", "contract.team_removed", { member: "Casey Contributor", role: "contributor" }),
        entry("a2", "contract.team_added", { member: "Casey Contributor", role: "contributor" }),
        entry("a1", "contract.created", { number: 42, title: "Acme master services agreement" }),
      ],
    ]);
    stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    const feed = await screen.findByRole("list", { name: "History" });
    const rows = within(feed).getAllByRole("listitem");
    // Newest first, as a history is read.
    expect(rows.map((row) => row.textContent)).toEqual([
      // The two M10/2 slugs have arms of their own — without them the
      // feed would fall through to the plain unknown-slug rendering.
      expect.stringContaining("Nadia Counsel cleared this contract's confidential mark"),
      expect.stringContaining("Nadia Counsel marked this contract confidential"),
      expect.stringContaining("Nadia Counsel commented"),
      expect.stringContaining("Nadia Counsel added Orion Cloud Ltd on the other side"),
      // The role reads in the Team card's own words, not as the stored
      // slug: one fact, named the same way on both surfaces.
      expect.stringContaining("Nadia Counsel took Casey Contributor off the team as Contributor"),
      expect.stringContaining("Nadia Counsel added Casey Contributor to the team as Contributor"),
      expect.stringContaining("Nadia Counsel created this contract"),
    ]);
  });

  it("shows the old and the new value of a field edit, formatted as the record formats them", async () => {
    const user = userEvent.setup();
    const activity = activityApi([
      [
        entry("a3", "contract.updated", {
          changed: {
            value: { from: null, to: { amount: 12_000_000, currency: "USD", cadence: "annually" } },
          },
        }),
        entry("a2", "contract.updated", {
          changed: {
            title: { from: "Old title", to: "New title" },
            priority: { from: "medium", to: "critical" },
            // A custom field's key is namespaced by its slug; the label
            // comes from the type's attached fields, which the record
            // page holds and hands to the narration.
            "field.payment_terms": { from: null, to: "Net 45" },
          },
        }),
        entry("a1", "contract.status_changed", {
          from: "Draft",
          to: "Internal review",
          fromStage: "draft",
          toStage: "review",
        }),
      ],
    ]);
    stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    const feed = await screen.findByRole("list", { name: "History" });
    const [value, edit, status] = within(feed).getAllByRole("listitem");
    // The money reads through the record's own currency helper, cadence
    // suffix and all (CTR-010, DES-014).
    expect(value).toHaveTextContent("Nadia Counsel changed Value");
    expect(value).toHaveTextContent("Not set → $120,000.00 /year");
    // Several fields are counted in the sentence and named on their own
    // lines, each old→new pair rendered the way the record renders it.
    expect(edit).toHaveTextContent("Nadia Counsel changed 3 fields");
    expect(edit).toHaveTextContent("Title: Old title → New title");
    expect(edit).toHaveTextContent("Priority: Medium → Critical");
    expect(edit).toHaveTextContent("Payment terms: Not set → Net 45");
    // A status move keeps its own words rather than reading as a
    // generic edit (CTR-001).
    expect(status).toHaveTextContent("Nadia Counsel changed the status");
    expect(status).toHaveTextContent("Draft → Internal review");
  });

  it("names the person and the Entity a reference field stores by id", async () => {
    const user = userEvent.setup();
    const activity = activityApi([
      [
        entry("a1", "contract.updated", {
          changed: {
            // CTR-016's two reference kinds store an id, so the id is
            // what M8 wrote. The names are already on the page — the
            // pickers loaded them — so the feed reads as the record
            // does rather than as a pair of uuids.
            "field.field_7": { from: null, to: "u2" },
            "field.field_8": { from: null, to: "e-meridian" },
          },
        }),
      ],
    ]);
    stubApi({
      signedIn: MEMBER,
      // The type attaching one field of every kind, so the reviewer and
      // the booking-entity fields are on this record.
      extra: pageApi(activity, recordApi(contractRow({ contractTypeId: "t-full" }))),
    });
    renderAt("/contracts/42");
    await openHistory(user);

    const feed = await screen.findByRole("list", { name: "History" });
    const row = within(feed).getAllByRole("listitem")[0]!;
    expect(row).toHaveTextContent("Reviewer: Not set → Nadia Counsel");
    expect(row).toHaveTextContent("Booking entity: Not set → Meridian Bio, Inc.");
  });

  it("falls back to what the log stored when nothing names the id", async () => {
    const user = userEvent.setup();
    const activity = activityApi([
      [
        entry("a1", "contract.updated", {
          // A field detached since the change reads as its own slug, and
          // an id nothing names reads as itself. Both are the honest
          // rendering of a log nobody prunes.
          changed: { "field.since_detached": { from: null, to: "u-deleted" } },
        }),
      ],
    ]);
    stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    const feed = await screen.findByRole("list", { name: "History" });
    expect(within(feed).getAllByRole("listitem")[0]).toHaveTextContent(
      "Nadia Counsel changed since_detached",
    );
  });

  it("renders an unknown action slug plainly instead of throwing", async () => {
    const user = userEvent.setup();
    const activity = activityApi([
      [
        // A slug from a version of the application that no longer
        // exists. The log is append-only, so this is inevitable rather
        // than hypothetical.
        entry("a2", "contract.frobnicated", { whatever: true }),
        entry("a1", "contract.created"),
      ],
    ]);
    stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    const feed = await screen.findByRole("list", { name: "History" });
    const rows = within(feed).getAllByRole("listitem");
    // The row still names the actor and the fact, and the rows around
    // it still read.
    expect(rows[0]).toHaveTextContent("Nadia Counsel — contract.frobnicated");
    expect(rows[1]).toHaveTextContent("Nadia Counsel created this contract");
  });

  it("names OpenLaw as the actor on an entry with no human behind it", async () => {
    const user = userEvent.setup();
    const activity = activityApi([
      [entry("a1", "contract.archived", {}, "working_team", undefined, null)],
    ]);
    stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    const feed = await screen.findByRole("list", { name: "History" });
    expect(within(feed).getAllByRole("listitem")[0]).toHaveTextContent(
      "OpenLaw archived this contract",
    );
  });

  it("pages rather than loading the whole history", async () => {
    const user = userEvent.setup();
    const activity = activityApi([
      [entry("a3", "contract.created"), entry("a2", "contract.archived")],
      [entry("a1", "contract.restored")],
    ]);
    stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    const feed = await screen.findByRole("list", { name: "History" });
    expect(within(feed).getAllByRole("listitem")).toHaveLength(2);

    const panel = screen.getByRole("complementary", { name: "History" });
    await user.click(within(panel).getByRole("button", { name: "Show older" }));

    await waitFor(() => {
      expect(within(feed).getAllByRole("listitem")).toHaveLength(3);
    });
    // The second read asked for what came after the first page's last
    // row, and the end of the feed offers nothing further.
    expect(activity.cursors).toEqual([null, "a2"]);
    expect(within(panel).queryByRole("button", { name: "Show older" })).not.toBeInTheDocument();
  });

  it("says what the panel is for when nothing has happened yet", async () => {
    const user = userEvent.setup();
    const activity = activityApi([[]]);
    stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    const panel = await screen.findByRole("complementary", { name: "History" });
    expect(
      await within(panel).findByText(/Nothing has happened to this record yet/),
    ).toBeInTheDocument();
  });

  it("says the history could not be read when the seam refuses", async () => {
    const user = userEvent.setup();
    const refusing = (call: StubCall) =>
      call.url.pathname === "/api/v1/activity"
        ? problem(500, "Something went wrong.")
        : recordApi(contractRow()).handler(call);
    stubApi({ signedIn: MEMBER, extra: refusing });
    renderAt("/contracts/42");
    await openHistory(user);

    const panel = await screen.findByRole("complementary", { name: "History" });
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "The history could not be read.",
    );
  });

  it("opens the same panel for a Contributor on the team", async () => {
    const user = userEvent.setup();
    // The API filters the feed; the panel takes what it is given. What
    // this proves is that a Contributor reaches the applet at all —
    // the tier predicate itself is proven at the API seam.
    const activity = activityApi([[entry("a1", "comment.posted", { commentId: "c1" })]]);
    stubApi({ signedIn: CONTRIBUTOR, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    const feed = await screen.findByRole("list", { name: "History" });
    expect(within(feed).getAllByRole("listitem")[0]).toHaveTextContent("Nadia Counsel commented");
  });

  /**
   * DES-009 Tier 1's micro-marker in the feed (M10/5). An entry copied
   * out of the panel has to carry its restriction with it, which is the
   * whole reason the marker exists at this size.
   */
  describe("inside a confidential record (M10/5)", () => {
    it("marks every entry beside its timestamp", async () => {
      const user = userEvent.setup();
      const activity = activityApi([
        [entry("a1", "contract.created"), entry("a2", "contract.confidentiality_set")],
      ]);
      stubApi({
        signedIn: MEMBER,
        extra: pageApi(activity, recordApi(contractRow({ isConfidential: true }))),
      });
      renderAt("/contracts/42");
      await openHistory(user);

      const feed = await screen.findByRole("list", { name: "History" });
      const rows = within(feed).getAllByRole("listitem");
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        // Lock only — the record page's banner is already saying the
        // word, and thirty repetitions of it are noise.
        expect(row.querySelector("svg.lucide-lock.text-confidential")).not.toBeNull();
        expect(row).not.toHaveTextContent("CONFI");
      }
    });

    it("marks no entry on a record that is not confidential", async () => {
      const user = userEvent.setup();
      const activity = activityApi([[entry("a1", "contract.created")]]);
      stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
      renderAt("/contracts/42");
      await openHistory(user);

      const feed = await screen.findByRole("list", { name: "History" });
      expect(within(feed).getAllByRole("listitem")[0]!.querySelector("svg.lucide-lock")).toBeNull();
    });
  });
});

/**
 * The record page's confidentiality surfaces (M10/4): DES-009's Tier 2
 * banner and the flag control.
 *
 * The banner is chrome, so what is asserted is that it is there, that
 * it carries the tokens, and that nothing closes it. The colours
 * themselves are covered by the contrast lint — jsdom computes none —
 * so the classes that carry the treatment are the only thing there is
 * to read, the way the comment row's wash is already asserted.
 *
 * The control's gate says what `confidentialityWrite` says on the
 * server: an Administrator, the `creator` team row, and the Owner may
 * change the audience, and every other included viewer reads it inert.
 * A viewer who cannot reach the record never gets this far — the API
 * answers 404, which the Contributor block above already proves.
 */
describe("the contract record's confidentiality surfaces (M10/4)", () => {
  const BANNER = "Confidential contract";
  const FLAG = "Confidential — restrict to the contract team";

  /** The banner's own region. It is a landmark so the statement stays
   * reachable after half an hour inside the record. */
  function banner() {
    return screen.queryByRole("region", { name: BANNER });
  }

  it("renders no banner on a contract that is not confidential", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    await screen.findByRole("heading", { level: 1, name: /Acme master services agreement/ });
    expect(banner()).not.toBeInTheDocument();
    // The control is there either way: it is the record's audience,
    // and an open record states that it is open.
    expect(screen.getByRole("switch", { name: FLAG })).not.toBeChecked();
  });

  it("banners a confidential record with the DES-009 tokens, and offers no way to close it", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ isConfidential: true })).handler,
    });
    renderAt("/contracts/42");

    const strip = await screen.findByRole("region", { name: BANNER });
    expect(strip).toHaveTextContent(
      "Confidential contract — the contract team, the Owner, and Administrators see it.",
    );
    // The existing tokens, not a hand-picked colour or height.
    expect(strip).toHaveClass("bg-confidential-bg");
    expect(strip).toHaveClass("text-confidential");
    expect(strip).toHaveClass("h-(--height-confidential-banner)");
    // Chrome, not a notification: nothing in it dismisses it.
    expect(within(strip).queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers Manage team to an Administrator, and lands it on the Team card", async () => {
    // The roster names somebody else as creator and there is no Owner,
    // so the role is the only thing that qualifies this viewer — the
    // default roster's creator is u1, which would let this pass on the
    // creator clause alone.
    stubApi({
      signedIn: ADMIN,
      extra: recordApi(contractRow({ isConfidential: true }), [person("u2", "creator")]).handler,
    });
    renderAt("/contracts/42");

    const strip = await screen.findByRole("region", { name: BANNER });
    const manage = within(strip).getByRole("link", { name: "Manage team" });
    expect(manage).toHaveAttribute("href", "#contract-team");
    // The link stays on the banner's own foreground. The base layer
    // colours every `<a>` with the link token, and the link token on
    // `confidential-bg` is 4.34:1 — under the 4.5 floor the contrast
    // lint holds the banner's own pair to.
    expect(manage).toHaveClass("text-confidential");
    expect(screen.getByRole("region", { name: "Team" })).toHaveAttribute("id", "contract-team");
    // The same clause gates the control: an Administrator off the team
    // gets a working switch, not the inert reading.
    expect(screen.getByRole("switch", { name: FLAG })).toBeEnabled();
  });

  it("offers Manage team to the creator — the row DD-014 means by that word", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ isConfidential: true }), [person("u2", "creator")]).handler,
    });
    renderAt("/contracts/42");

    const strip = await screen.findByRole("region", { name: BANNER });
    expect(within(strip).getByRole("link", { name: "Manage team" })).toBeInTheDocument();
  });

  it("offers Manage team to the Owner, who joined the actor set in CTR-022", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ isConfidential: true, manager: person("u2") }), [
        person("u1", "creator"),
      ]).handler,
    });
    renderAt("/contracts/42");

    const strip = await screen.findByRole("region", { name: BANNER });
    expect(within(strip).getByRole("link", { name: "Manage team" })).toBeInTheDocument();
    // Ownership alone is what makes the control live here: the creator
    // row belongs to somebody else.
    expect(screen.getByRole("switch", { name: FLAG })).toBeEnabled();
  });

  it("offers it to nobody else on the team", async () => {
    // Working on a record is not a claim on who else may see it.
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ isConfidential: true }), [
        person("u1", "creator"),
        person("u2", "member"),
      ]).handler,
    });
    renderAt("/contracts/42");

    const strip = await screen.findByRole("region", { name: BANNER });
    expect(within(strip).queryByRole("link", { name: "Manage team" })).not.toBeInTheDocument();
  });

  it("draws the Team card's controls inert for that same viewer (CTR-023)", async () => {
    // The viewer of the test above: on the team, and none of the three
    // actors. The banner hides "Manage team" from them, so the card
    // below it must not let them do it anyway.
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ isConfidential: true }), [
        person("u1", "creator"),
        person("u3", "member"),
      ]).handler,
    });
    renderAt("/contracts/42");

    const team = await screen.findByRole("region", { name: "Team" });
    // Inert, not absent: who is on the contract is a fact, and only the
    // deciding is withheld.
    expect(within(team).getByRole("button", { name: "Add team member" })).toBeDisabled();
    expect(
      within(team).getByRole("button", { name: "Take Casey Contributor off the team as Member" }),
    ).toBeDisabled();
    // The roster still reads.
    expect(within(team).getByText("Casey Contributor")).toBeVisible();
  });

  it("leaves the Team card live for an actor, and live on an open record for anybody", async () => {
    // The creator, on the same walled record.
    const asActor = recordApi(contractRow({ isConfidential: true }), [
      person("u2", "creator"),
      person("u3", "member"),
    ]);
    stubApi({ signedIn: MEMBER, extra: asActor.handler });
    const walled = renderAt("/contracts/42");
    const team = await screen.findByRole("region", { name: "Team" });
    expect(within(team).getByRole("button", { name: "Add team member" })).toBeEnabled();
    expect(
      within(team).getByRole("button", { name: "Take Casey Contributor off the team as Member" }),
    ).toBeEnabled();
    walled.view.unmount();

    // The same non-actor viewer, on a record with no flag on it: the
    // gate arrives with the flag and nowhere else (CTR-004 stands).
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow(), [person("u1", "creator"), person("u3", "member")]).handler,
    });
    renderAt("/contracts/42");
    const open = await screen.findByRole("region", { name: "Team" });
    expect(within(open).getByRole("button", { name: "Add team member" })).toBeEnabled();
    expect(
      within(open).getByRole("button", { name: "Take Casey Contributor off the team as Member" }),
    ).toBeEnabled();
  });

  it("sets the flag through the record, and the banner follows the commit", async () => {
    const api = recordApi(contractRow(), [person("u2", "creator")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("switch", { name: FLAG }));
    await waitFor(() => expect(api.patches).toEqual([{ isConfidential: true }]));
    expect(await screen.findByRole("region", { name: BANNER })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: FLAG })).toBeChecked();
  });

  it("clears the flag again, and the banner goes with it", async () => {
    const api = recordApi(contractRow({ isConfidential: true }), [person("u2", "creator")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("switch", { name: FLAG }));
    await waitFor(() => expect(api.patches).toEqual([{ isConfidential: false }]));
    await waitFor(() => expect(banner()).not.toBeInTheDocument());
  });

  it("shows the seam's refusal beside the control, and keeps the saved truth", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/42" && call.method === "PATCH") {
          return problem(403, "You do not have permission to perform this action.");
        }
        return recordApi(contractRow(), [person("u2", "creator")]).handler(call);
      },
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("switch", { name: FLAG }));
    expect(
      await screen.findByText("You do not have permission to perform this action."),
    ).toBeInTheDocument();
    // Nothing was adopted: the record is still open, and it still says so.
    expect(screen.getByRole("switch", { name: FLAG })).not.toBeChecked();
    expect(banner()).not.toBeInTheDocument();
  });

  it("gives a team Member who is none of the three actors the inert control, not a broken one", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ isConfidential: true }), [
        person("u1", "creator"),
        person("u2", "member"),
      ]).handler,
    });
    renderAt("/contracts/42");

    const flag = await screen.findByRole("switch", { name: FLAG });
    // Inert, not absent: the audience is a fact of the record, and a
    // control that vanished would leave it unreadable on the card.
    expect(flag).toBeDisabled();
    expect(flag).toBeChecked();
    expect(screen.getByText(/Everyone outside the contract team loses the record/)).toBeVisible();
  });

  it("gives a Contributor on the team the inert control too", async () => {
    const api = recordApi(contractRow({ isConfidential: true }), [
      person("u1", "creator"),
      person("u3", "contributor"),
    ]);
    stubApi({
      signedIn: CONTRIBUTOR,
      extra: (call) =>
        ["/api/v1/contracts/options", "/api/v1/entities"].includes(call.url.pathname)
          ? problem(403, "You do not have permission to perform this action.")
          : api.handler(call),
    });
    renderAt("/contracts/42");

    expect(await screen.findByRole("region", { name: BANNER })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: FLAG })).toBeDisabled();
  });

  it("freezes the control on an archived record, like every other edit", async () => {
    const api = recordApi(contractRow({ archivedAt: "2026-08-02T00:00:00.000Z" }), [
      person("u2", "creator"),
    ]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    expect(await screen.findByRole("switch", { name: FLAG })).toBeDisabled();
  });

  it("uses one Lock glyph on both surfaces, and no alternate icon anywhere", async () => {
    stubApi({
      signedIn: ADMIN,
      extra: recordApi(contractRow({ isConfidential: true })).handler,
    });
    const { view } = renderAt("/contracts/42");

    const strip = await screen.findByRole("region", { name: BANNER });
    // The banner and the control each carry one, and it is the same
    // glyph — DES-009 admits no alternate.
    expect(strip.querySelector("svg.lucide-lock")).not.toBeNull();
    expect(view.container.querySelectorAll("svg.lucide-lock")).toHaveLength(2);
    expect(view.container.querySelector("svg.lucide-shield-alert")).toBeNull();
    expect(view.container.querySelector("svg.lucide-eye-off")).toBeNull();
  });
});

/**
 * The Documents section of the record body (M11/2, M11/3, M11/4), drawn
 * from the C4 mock: the heading with a count of what is on the record,
 * the upload composer beside it, and one row per document — the version
 * that matters now, with the rounds it supersedes opening underneath it.
 *
 * The panel DES-016 places in a wider sibling layer is not here — it
 * lands with M12's rendering. What this asserts is the section, the
 * count, the chain with its pin, a download per version, the composer
 * that sends the kind and the note, the metadata edit, and the two
 * CTR-014 designations: which document is the instrument, and which of
 * its versions is the signed copy.
 */
describe("the contract record's Documents section (M11/2, M11/3, M11/4, M11/5)", () => {
  /** One version of a chain, as the API answers it. */
  const version = (over: Record<string, unknown> = {}) => ({
    id: "ver-1",
    versionNumber: 1,
    kind: "draft_ours",
    note: null,
    originalFilename: "Orion_MSA_2026_draft.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    /** DOC-004's family, routed by the server (M12/2). Word is
     * download-only until M12/3, so most fixtures here keep the name a
     * plain download link. */
    renderFamily: "word",
    byteSize: 88_000,
    checksumSha256: "a".repeat(64),
    uploadedBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
    createdAt: "2026-08-11T09:00:00.000Z",
    isCurrent: true,
    /** The CTR-014 pin, which no upload ever sets: it is the team's own
     * decision, never read off the round's kind. */
    isExecuted: false,
    ...over,
  });

  const DRAFT = {
    id: "doc-1",
    title: "Orion_MSA_2026_draft.docx",
    description: null,
    /** The first document uploaded is the instrument (CTR-014). */
    isPrimary: true,
    versions: [version()],
    /** On the record's list and in its count (DOC-010). */
    archivedAt: null,
    /** Open to whoever reaches the contract, which is where every
     * document starts (DD-014). */
    isConfidential: false,
    createdBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
    createdAt: "2026-08-11T09:00:00.000Z",
    updatedAt: "2026-08-11T09:00:00.000Z",
  };

  const THEIRS = {
    ...DRAFT,
    id: "doc-2",
    title: "Orion_MSA_2026_redline_orion.docx",
    // A loose attachment beside the instrument, not the instrument.
    isPrimary: false,
    versions: [
      version({
        id: "ver-2",
        kind: "redline_theirs",
        originalFilename: "Orion_MSA_2026_redline_orion.docx",
        byteSize: 102_000,
      }),
    ],
  };

  /** A document somebody else put on the record. The signed-in Legal
   * Team Member is neither its uploader nor the record's Owner, so
   * DD-014's flag is not theirs to decide (CTR-022). */
  const SOMEONE_ELSES = {
    ...DRAFT,
    id: "doc-4",
    title: "board_pack.pdf",
    isPrimary: false,
    createdBy: { id: "u1", displayName: "Ada Admin", image: null, archived: false },
    versions: [
      version({
        id: "ver-4",
        originalFilename: "board_pack.pdf",
        mimeType: "application/pdf",
        renderFamily: "pdf",
      }),
    ],
  };

  /** One file narrowed to the contract's named team, on a record
   * everybody can open (DD-014, M11/6). */
  const WALLED = {
    ...DRAFT,
    id: "doc-5",
    title: "board-memo.txt",
    isPrimary: false,
    isConfidential: true,
    versions: [
      version({
        id: "ver-5",
        originalFilename: "board-memo.txt",
        mimeType: "text/plain",
        renderFamily: "other",
      }),
    ],
  };

  /** Three rounds on one document, the third of them current — the
   * chain a negotiation actually leaves behind. */
  const CHAIN = {
    ...DRAFT,
    id: "doc-3",
    title: "Orion Cloud — master services agreement",
    description: "The main instrument. Clause 8 was the fight.",
    versions: [
      version({
        id: "ver-a",
        versionNumber: 1,
        originalFilename: "round_1.docx",
        isCurrent: false,
      }),
      version({
        id: "ver-b",
        versionNumber: 2,
        kind: "redline_theirs",
        note: "Their first pass. Clause 8 is the fight.",
        originalFilename: "round_2.docx",
        isCurrent: false,
      }),
      version({
        id: "ver-c",
        versionNumber: 3,
        kind: "redline_ours",
        note: "Held the indemnity.",
        originalFilename: "round_3.docx",
      }),
    ],
  };

  /** The record stub, plus the documents read, the two uploads, the
   * metadata edit, and DOC-010's two removals. */
  function documentsApi(
    rows: Record<string, unknown>[],
    options: {
      uploadFails?: string;
      designationFails?: string;
      removalFails?: string;
      /** CTR-004's Owner, who is one of DD-014's three actors on every
       * document of the record (CTR-022). Unassigned unless a test
       * needs them. */
      ownerId?: string;
      /** The seam's own refusal of a metadata patch, which is the route
       * DD-014's flag rides. */
      editFails?: string;
    } = {},
    team = [person("u1", "creator")],
  ) {
    const record = recordApi(
      contractRow(options.ownerId ? { manager: person(options.ownerId) } : {}),
      team,
    );
    /** Every write the section made, in order, so a test can assert
     * both the address and what rode in the form. */
    const writes: { url: string; body: unknown }[] = [];
    let current = rows;
    /** The record's paper as the seam answers it: archived rows are off
     * the list unless they were asked for (DOC-010). */
    const paper = (includeArchived: boolean) =>
      includeArchived ? current : current.filter((row) => row.archivedAt === null);
    const handler = (call: StubCall): Response | undefined => {
      const { pathname } = call.url;
      if (pathname === "/api/v1/contracts/42/documents" && call.method === "GET") {
        return json(200, {
          documents: paper(call.url.searchParams.get("includeArchived") === "true"),
          nextCursor: null,
        });
      }
      if (pathname === "/api/v1/contracts/42/documents" && call.method === "POST") {
        writes.push({ url: pathname, body: call.body });
        if (options.uploadFails) return problem(413, options.uploadFails);
        const added = {
          ...DRAFT,
          id: "doc-new",
          title: "counter_redline.docx",
          // The first document on a record takes the designation; every
          // one after it is a loose attachment (CTR-014).
          isPrimary: current.length === 0,
          versions: [version({ id: "ver-new", originalFilename: "counter_redline.docx" })],
        };
        current = [added, ...current];
        return json(201, { document: added });
      }
      // Appending the next round to a document that already exists. The
      // number is the server's to assign, so the answer states it.
      const appended = /^\/api\/v1\/documents\/([^/]+)\/versions$/.exec(pathname);
      if (appended && call.method === "POST") {
        writes.push({ url: pathname, body: call.body });
        if (options.uploadFails) return problem(413, options.uploadFails);
        const target = current.find((row) => row.id === appended[1]);
        if (!target) return problem(404, "No document exists with this reference.");
        const chain = target.versions as Record<string, unknown>[];
        const next = {
          ...target,
          versions: [
            ...chain.map((row) => ({ ...row, isCurrent: false })),
            version({
              id: "ver-appended",
              versionNumber: chain.length + 1,
              kind: "redline_ours",
              note: "Our counter.",
              originalFilename: "counter_redline.docx",
            }),
          ],
        };
        current = current.map((row) => (row === target ? next : row));
        return json(201, { document: next });
      }
      // Which document is the instrument (CTR-014). The seam answers
      // the record's whole paper, because two rows move: the one that
      // takes the designation and the one that loses it.
      const named = /^\/api\/v1\/documents\/([^/]+)\/primary$/.exec(pathname);
      if (named && call.method === "POST") {
        writes.push({ url: pathname, body: call.body });
        if (options.designationFails) return problem(409, options.designationFails);
        current = current.map((row) => ({ ...row, isPrimary: row.id === named[1] }));
        return json(200, { documents: paper(false), nextCursor: null });
      }
      // DOC-010's soft delete and its undo. Both answer the one
      // document, because neither changes any other row.
      const removed = /^\/api\/v1\/documents\/([^/]+)\/(archive|restore)$/.exec(pathname);
      if (removed && call.method === "POST") {
        writes.push({ url: `${pathname}`, body: call.body });
        if (options.removalFails) return problem(409, options.removalFails);
        const target = current.find((row) => row.id === removed[1]);
        if (!target) return problem(404, "No document exists with this reference.");
        const next = {
          ...target,
          archivedAt: removed[2] === "archive" ? "2026-08-14T10:00:00.000Z" : null,
        };
        current = current.map((row) => (row === target ? next : row));
        return json(200, { document: next });
      }
      // The Administrator's erasure. It answers the record's whole
      // paper, because the instrument may have gone with it.
      const erased = /^\/api\/v1\/documents\/([^/]+)$/.exec(pathname);
      if (erased && call.method === "DELETE") {
        writes.push({ url: `${pathname}:DELETE`, body: call.body });
        if (options.removalFails) return problem(400, options.removalFails);
        current = current.filter((row) => row.id !== erased[1]);
        return json(200, { documents: paper(false), nextCursor: null });
      }
      // The executed pin (CTR-014), set and cleared at the document's
      // own address: the pin is one column on the document, and no
      // version row is touched by either.
      const pinned = /^\/api\/v1\/documents\/([^/]+)\/executed-version$/.exec(pathname);
      if (pinned && (call.method === "POST" || call.method === "DELETE")) {
        writes.push({ url: `${pathname}:${call.method}`, body: call.body });
        if (options.designationFails) return problem(409, options.designationFails);
        const target = current.find((row) => row.id === pinned[1]);
        if (!target) return problem(404, "No document exists with this reference.");
        const wanted =
          call.method === "POST" ? (call.body as { versionId: string }).versionId : null;
        const next = {
          ...target,
          versions: (target.versions as Record<string, unknown>[]).map((row) => ({
            ...row,
            isExecuted: row.id === wanted,
          })),
        };
        current = current.map((row) => (row === target ? next : row));
        return json(200, { document: next });
      }
      const edited = /^\/api\/v1\/documents\/([^/]+)$/.exec(pathname);
      if (edited && call.method === "PATCH") {
        writes.push({ url: pathname, body: call.body });
        if (options.editFails) return problem(403, options.editFails);
        const target = current.find((row) => row.id === edited[1]);
        if (!target) return problem(404, "No document exists with this reference.");
        const next = { ...target, ...(call.body as Record<string, unknown>) };
        current = current.map((row) => (row.id === next.id ? next : row));
        return json(200, { document: next });
      }
      return record.handler(call);
    };
    return { handler, writes };
  }

  const documentsSection = () => screen.findByRole("region", { name: /^Documents/ });

  /** The count badge, found the way a screen reader finds it. It draws a
   * bare number and says the whole phrase, so the phrase is what the
   * tests ask for — the digits alone would name nothing. */
  const countBadge = (section: HTMLElement, said: string) =>
    within(section).getByRole("img", { name: said });

  /** The composer, opened from whichever control opens it. */
  async function compose(
    user: ReturnType<typeof userEvent.setup>,
    section: HTMLElement,
    name: string,
  ) {
    await user.click(within(section).getByRole("button", { name }));
    return screen.findByRole("dialog");
  }

  /**
   * One act from a document row's overflow menu.
   *
   * Everything a viewer may do to a document lives behind one trigger
   * (DES-025's pattern), so a test reaches it the way a person does:
   * open the row's menu, then pick the verb.
   */
  async function act(
    user: ReturnType<typeof userEvent.setup>,
    section: HTMLElement,
    title: string,
    verb: string,
  ) {
    await user.click(within(section).getByRole("button", { name: `Actions for ${title}` }));
    await user.click(await screen.findByRole("menuitem", { name: verb }));
  }

  /** The verbs one document row's menu offers this viewer. */
  async function menuVerbs(
    user: ReturnType<typeof userEvent.setup>,
    section: HTMLElement,
    title: string,
  ): Promise<string[]> {
    await user.click(within(section).getByRole("button", { name: `Actions for ${title}` }));
    const menu = await screen.findByRole("menu");
    return within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent ?? "");
  }

  it("draws the section with a count of the paper on the record", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([DRAFT, THEIRS]).handler });
    renderAt("/contracts/42");

    const section = await documentsSection();
    expect(within(section).getByRole("heading", { level: 2, name: "Documents" })).toBeVisible();
    // The count is what the list holds — the API leaves out what this
    // viewer may not see, so it can never announce an omission.
    expect(countBadge(section, "2 documents")).toBeVisible();
    expect(within(section).getAllByRole("row")).toHaveLength(3); // header + two
  });

  it("names each document, marks the version that matters now, and makes the name its download", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([DRAFT]).handler });
    renderAt("/contracts/42");

    const section = await documentsSection();
    const link = within(section).getByRole("link", { name: "Orion_MSA_2026_draft.docx" });
    // Straight at the version's own address: every open is a download
    // in M11, and there is no presigned URL to build.
    expect(link).toHaveAttribute("href", "/api/v1/documents/doc-1/versions/ver-1/download");
    expect(link).toHaveAttribute("download", "Orion_MSA_2026_draft.docx");
    // The kind, the number, the pin, the size, and when it landed, as
    // the C4 mock draws them.
    expect(within(section).getByText("Draft · ours")).toBeVisible();
    expect(within(section).getByText("v1")).toBeVisible();
    expect(within(section).getByText("Current")).toBeVisible();
    expect(within(section).getByText("88 kB")).toBeVisible();
  });

  it("says so plainly when the record has no paper on it", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([]).handler });
    renderAt("/contracts/42");

    const section = await documentsSection();
    expect(within(section).getByText("No documents on this contract yet.")).toBeVisible();
    expect(countBadge(section, "0 documents")).toBeVisible();
  });

  it("shows the current version first and opens the rounds it supersedes", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([CHAIN]).handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    // Collapsed, the section answers "which file matters now" and
    // nothing else: the current round, under the document's own name.
    expect(within(section).getAllByRole("row")).toHaveLength(2); // header + current
    expect(within(section).getByText("v3")).toBeVisible();
    expect(within(section).getByText("Current")).toBeVisible();
    expect(within(section).getByText("The main instrument. Clause 8 was the fight.")).toBeVisible();
    expect(within(section).getByText("Held the indemnity.")).toBeVisible();

    const toggle = within(section).getByRole("button", {
      name: /Show the 2 earlier versions of Orion Cloud/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    // The whole chain, newest of the superseded rounds first, each its
    // own download — a superseded version is not a hidden one.
    expect(within(section).getAllByRole("row")).toHaveLength(4);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const second = within(section).getByRole("link", { name: "round_2.docx" });
    expect(second).toHaveAttribute("href", "/api/v1/documents/doc-3/versions/ver-b/download");
    expect(within(section).getByText("Their first pass. Clause 8 is the fight.")).toBeVisible();
    expect(within(section).getByRole("link", { name: "round_1.docx" })).toHaveAttribute(
      "href",
      "/api/v1/documents/doc-3/versions/ver-a/download",
    );
    // Ordered newest first under the current round, and the pin is on
    // the round that leads.
    const rows = within(section).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByText(/^v\d+$/).textContent)).toEqual([
      "v3",
      "v2",
      "v1",
    ]);
    expect(within(rows[0]!).getByText("Current")).toBeVisible();
    for (const row of rows.slice(1)) {
      expect(within(row).queryByText("Current")).not.toBeInTheDocument();
    }
  });

  it("draws no disclosure for a document with one version", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([DRAFT]).handler });
    renderAt("/contracts/42");

    const section = await documentsSection();
    expect(
      within(section).queryByRole("button", { name: /earlier version/ }),
    ).not.toBeInTheDocument();
  });

  it("uploads through the composer, sending the kind and the note with the file", async () => {
    const api = documentsApi([DRAFT]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    const dialog = await compose(user, section, "Upload");
    await user.upload(
      within(dialog).getByLabelText("File", { selector: "input" }),
      new File(["counter redline bytes"], "counter_redline.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    await user.selectOptions(within(dialog).getByLabelText("Kind"), "redline_ours");
    await user.type(within(dialog).getByLabelText("Note"), "Our counter to their clause 8.");
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    const form = api.writes[0]!.body as FormData;
    expect(api.writes[0]!.url).toBe("/api/v1/contracts/42/documents");
    expect(form.get("kind")).toBe("redline_ours");
    expect(form.get("note")).toBe("Our counter to their clause 8.");
    // The fields ride before the file, which is the order the seam
    // reads them in.
    expect([...form.keys()]).toEqual(["kind", "note", "file"]);
    // Newest first, and the count follows.
    expect(
      await within(section).findByRole("link", { name: "counter_redline.docx" }),
    ).toBeInTheDocument();
    expect(countBadge(section, "2 documents")).toBeVisible();
  });

  it("refuses to send a composer with no file on it", async () => {
    const api = documentsApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    const dialog = await compose(user, section, "Upload");
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));

    expect(await within(dialog).findByText("Choose a file to upload.")).toBeVisible();
    expect(api.writes).toEqual([]);
    // The refusal is about the File field, and the control a keyboard
    // reaches on that field is this button — so the refusal is reachable
    // from it rather than only findable by sight.
    const choose = within(dialog).getByRole("button", { name: "File Choose file" });
    expect(choose).toHaveAccessibleDescription("Choose a file to upload.");
  });

  it("appends the next version to a document from its own row", async () => {
    const api = documentsApi([DRAFT]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    await act(user, section, "Orion_MSA_2026_draft.docx", "Add version");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Add version" })).toBeVisible();
    await user.upload(
      within(dialog).getByLabelText("File", { selector: "input" }),
      new File(["our counter"], "counter_redline.docx", { type: "application/pdf" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    // The document's own address, not the contract's: the chain it
    // appends to is the one this row draws.
    expect(api.writes[0]!.url).toBe("/api/v1/documents/doc-1/versions");
    // The new round is current, and the one before it is now history —
    // still there, still a document of its own count of one.
    expect(await within(section).findByText("v2")).toBeVisible();
    expect(countBadge(section, "1 document")).toBeVisible();
    expect(
      within(section).getByRole("button", { name: /Show the 1 earlier version of/ }),
    ).toBeInTheDocument();
  });

  it("renames a document and edits its description, leaving the file's own name alone", async () => {
    const api = documentsApi([DRAFT]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    await act(user, section, "Orion_MSA_2026_draft.docx", "Edit details");
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Orion Cloud — MSA");
    await user.type(within(dialog).getByLabelText("Description"), "The main instrument.");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toEqual({
      url: "/api/v1/documents/doc-1",
      body: { title: "Orion Cloud — MSA", description: "The main instrument." },
    });
    // The record reads as renamed, and the download still offers the
    // file under the name it arrived with.
    const link = await within(section).findByRole("link", { name: "Orion Cloud — MSA" });
    expect(link).toHaveAttribute("download", "Orion_MSA_2026_draft.docx");
    expect(within(section).getByText("The main instrument.")).toBeVisible();
  });

  it("refuses to send a rename with no name in it", async () => {
    const api = documentsApi([DRAFT]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    await act(user, section, "Orion_MSA_2026_draft.docx", "Edit details");
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Give the document a name.")).toBeVisible();
    expect(api.writes).toEqual([]);
  });

  it("reports the seam's own refusal when the file is turned away", async () => {
    const api = documentsApi([], { uploadFails: "That file is over the 100 MB upload limit." });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    const dialog = await compose(user, section, "Upload");
    await user.upload(
      within(dialog).getByLabelText("File", { selector: "input" }),
      new File(["far too much"], "enormous.pdf", { type: "application/pdf" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));

    expect(
      await within(dialog).findByText("That file is over the 100 MB upload limit."),
    ).toBeVisible();
    expect(within(section).getByText("No documents on this contract yet.")).toBeVisible();
  });

  it("marks the document the record calls its instrument", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([DRAFT, THEIRS]).handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    // One mark on the record, on the row it is about.
    expect(within(section).getAllByText("Primary")).toHaveLength(1);
    // And no act offered on the row that already holds it: absent, not
    // disabled, and the mark beside the name is what says why.
    expect(await menuVerbs(user, section, "Orion_MSA_2026_draft.docx")).not.toContain(
      "Make primary",
    );
    await user.keyboard("{Escape}");
    expect(await menuVerbs(user, section, "Orion_MSA_2026_redline_orion.docx")).toContain(
      "Make primary",
    );
  });

  it("moves the designation to another document on the record", async () => {
    const api = documentsApi([DRAFT, THEIRS]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    await act(user, section, "Orion_MSA_2026_redline_orion.docx", "Make primary");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.url).toBe("/api/v1/documents/doc-2/primary");
    // Still exactly one mark, and it is on the other row now: the
    // section redraws from the whole list the seam answered with, so
    // the row that lost the designation is not left claiming it.
    await waitFor(() => expect(within(section).getAllByText("Primary")).toHaveLength(1));
    expect(await menuVerbs(user, section, "Orion_MSA_2026_draft.docx")).toContain("Make primary");
  });

  it("pins a superseded round as the executed copy, and clears it again", async () => {
    const api = documentsApi([CHAIN]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(
      within(section).getByRole("button", { name: /Show the 2 earlier versions of/ }),
    );
    // The signed copy is often not the last round: this contract was
    // signed in round two and redlined again in round three.
    await user.click(
      within(section).getByRole("button", {
        name: "Pin version 2 of Orion Cloud — master services agreement as the executed copy",
      }),
    );

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toEqual({
      url: "/api/v1/documents/doc-3/executed-version:POST",
      body: { versionId: "ver-b" },
    });
    expect(await within(section).findByText("Executed")).toBeVisible();
    // Current and executed are two marks on two rows, not one fact.
    expect(within(section).getByText("Current")).toBeVisible();

    // The same control, named for what it toggles: the state is on
    // `aria-pressed`, not in the name.
    const pin = within(section).getByRole("button", {
      name: "Pin version 2 of Orion Cloud — master services agreement as the executed copy",
    });
    await waitFor(() => expect(pin).toHaveAttribute("aria-pressed", "true"));
    await user.click(pin);

    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[1]!.url).toBe("/api/v1/documents/doc-3/executed-version:DELETE");
    // Every round is still there: the pin is one column on the
    // document, and clearing it takes nothing else with it.
    await waitFor(() => expect(within(section).queryByText("Executed")).not.toBeInTheDocument());
    expect(within(section).getByRole("link", { name: "round_2.docx" })).toBeInTheDocument();
  });

  it("never reads the pin off a round's kind", async () => {
    const signed = {
      ...DRAFT,
      id: "doc-signed",
      title: "Orion_MSA_2026_signed.pdf",
      versions: [version({ id: "ver-signed", kind: "executed" })],
    };
    stubApi({ signedIn: MEMBER, extra: documentsApi([signed]).handler });
    renderAt("/contracts/42");

    const section = await documentsSection();
    // The kind is what the uploader called this round; the pin is what
    // the team decided, and nobody has decided yet. One "Executed" on
    // the row — the kind pill — and none beside the version number.
    expect(within(section).getAllByText("Executed")).toHaveLength(1);
    expect(
      within(section).getByRole("button", {
        name: "Pin version 1 of Orion_MSA_2026_signed.pdf as the executed copy",
      }),
    ).toBeVisible();
  });

  it("reports the seam's own refusal when a designation is turned down", async () => {
    const api = documentsApi([DRAFT, THEIRS], {
      designationFails: "That document is already the contract's primary document.",
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    await act(user, section, "Orion_MSA_2026_redline_orion.docx", "Make primary");

    expect(
      await within(section).findByText("That document is already the contract's primary document."),
    ).toBeVisible();
    // Nothing moved: the section draws what the record says, not what
    // the click hoped for.
    expect(within(section).getAllByText("Primary")).toHaveLength(1);
  });

  it("offers a Contributor the list and the download, and no control that writes", async () => {
    const api = documentsApi([CHAIN], {}, [person("u1", "creator"), person("u3", "contributor")]);
    stubApi({
      signedIn: CONTRIBUTOR,
      extra: (call) =>
        ["/api/v1/contracts/options", "/api/v1/entities"].includes(call.url.pathname)
          ? problem(403, "You do not have permission to perform this action.")
          : api.handler(call),
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    // They read and download what they were added to work on (DD-015),
    // history included.
    await user.click(
      within(section).getByRole("button", { name: /Show the 2 earlier versions of/ }),
    );
    expect(within(section).getByRole("link", { name: "round_1.docx" })).toBeInTheDocument();
    // Every control that writes is absent rather than disabled — the
    // convention every other card on this page follows. Their write
    // grid arrives in M23.
    expect(within(section).queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: /^Pin version/ })).not.toBeInTheDocument();
    expect(within(section).queryByRole("switch")).not.toBeInTheDocument();
  });

  it("freezes the section's controls on an archived record", async () => {
    const record = recordApi(contractRow({ archivedAt: "2026-08-02T00:00:00.000Z" }));
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/contracts/42/documents" && call.method === "GET"
          ? json(200, { documents: [DRAFT], nextCursor: null })
          : record.handler(call),
    });
    renderAt("/contracts/42");

    const section = await documentsSection();
    expect(within(section).queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: /^Pin version/ })).not.toBeInTheDocument();
    expect(within(section).queryByRole("switch")).not.toBeInTheDocument();
    // Reading it is not editing it: the download and the marks stay.
    expect(
      within(section).getByRole("link", { name: "Orion_MSA_2026_draft.docx" }),
    ).toBeInTheDocument();
    expect(within(section).getByText("Primary")).toBeVisible();
  });

  it("archives a document off the list and out of the count", async () => {
    const api = documentsApi([DRAFT, THEIRS]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    expect(countBadge(section, "2 documents")).toBeVisible();
    // No confirmation: archiving destroys nothing, and Restore is the
    // way back (DOC-010).
    await act(user, section, "Orion_MSA_2026_redline_orion.docx", "Archive");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.url).toBe("/api/v1/documents/doc-2/archive");
    await waitFor(() =>
      expect(
        within(section).queryByRole("link", { name: "Orion_MSA_2026_redline_orion.docx" }),
      ).not.toBeInTheDocument(),
    );
    expect(countBadge(section, "1 document")).toBeVisible();
  });

  it("shows the archived rows on demand and restores one back onto the list", async () => {
    const api = documentsApi([DRAFT, { ...THEIRS, archivedAt: "2026-08-13T09:00:00.000Z" }]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    // Off the list and out of the count until they are asked for.
    expect(countBadge(section, "1 document")).toBeVisible();
    expect(
      within(section).queryByRole("link", { name: "Orion_MSA_2026_redline_orion.docx" }),
    ).not.toBeInTheDocument();

    await user.click(within(section).getByRole("switch"));

    // Drawn beside the live ones, marked for what they are, and still
    // downloadable — nothing was destroyed.
    const link = await within(section).findByRole("link", {
      name: "Orion_MSA_2026_redline_orion.docx",
    });
    expect(link).toHaveAttribute("href", "/api/v1/documents/doc-2/versions/ver-2/download");
    expect(within(section).getByText("Archived")).toBeVisible();
    // The count still says what is on the record, not what is on screen.
    expect(countBadge(section, "1 document")).toBeVisible();

    await act(user, section, "Orion_MSA_2026_redline_orion.docx", "Restore");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.url).toBe("/api/v1/documents/doc-2/restore");
    await waitFor(() => expect(countBadge(section, "2 documents")).toBeVisible());
    expect(within(section).queryByText("Archived")).not.toBeInTheDocument();
  });

  it("offers an archived document its way back and nothing that would be refused", async () => {
    const api = documentsApi([{ ...DRAFT, archivedAt: "2026-08-13T09:00:00.000Z" }]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(within(section).getByRole("switch"));
    await within(section).findByText("Archived");

    // A Legal Team Member gets the one act the seam still takes. Every
    // other write on an archived document is refused until it is
    // restored, so a control for one would be a dead end — and the
    // erasure is the Administrator's, not theirs.
    expect(await menuVerbs(user, section, "Orion_MSA_2026_draft.docx")).toEqual(["Restore"]);
    await user.keyboard("{Escape}");
    expect(within(section).queryByRole("button", { name: /^Pin version/ })).not.toBeInTheDocument();
  });

  it("keeps the erasure off a Legal Team Member's menu", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([DRAFT]).handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    // They archive all day and destroy nothing (DOC-010). The seam
    // refuses them regardless; the menu is what keeps a control from
    // offering a dead end. The Administrator's own menu is asserted by
    // the typed-confirmation test below.
    const member = await documentsSection();
    expect(await menuVerbs(user, member, "Orion_MSA_2026_draft.docx")).toEqual([
      "Add version",
      "Edit details",
      // They uploaded this one, so the flag is theirs to decide
      // (CTR-022). The next test is the row where it is not.
      "Mark confidential",
      "Archive",
    ]);
  });

  it("marks a confidential document, and draws nothing where one was left out", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([DRAFT, WALLED]).handler });
    renderAt("/contracts/42");

    // DES-009 Tier 1, on the row it is about: this file is narrowed to
    // the contract's named team even though the record is open.
    const section = await documentsSection();
    const marks = within(section).getAllByRole("img", { name: "Confidential" });
    expect(marks).toHaveLength(1);
    expect(within(section).getByText("board-memo.txt").closest("tr")).toContainElement(marks[0]!);
    expect(countBadge(section, "2 documents")).toBeVisible();
  });

  it("draws no placeholder for a document the seam left out, and counts what it was given", async () => {
    // What an outside viewer's request actually answers: the walled row
    // is not in it. The section has no hidden state to draw, so the
    // omission is silent by construction (DD-014).
    stubApi({ signedIn: MEMBER, extra: documentsApi([DRAFT]).handler });
    renderAt("/contracts/42");

    const section = await documentsSection();
    expect(within(section).queryByRole("img", { name: "Confidential" })).not.toBeInTheDocument();
    expect(within(section).queryByText("board-memo.txt")).not.toBeInTheDocument();
    expect(countBadge(section, "1 document")).toBeVisible();
    expect(within(section).getAllByRole("row")).toHaveLength(2); // header + one
  });

  it("lets the person who uploaded a document mark it confidential, and clear it again", async () => {
    const api = documentsApi([DRAFT]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    await act(user, section, "Orion_MSA_2026_draft.docx", "Mark confidential");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toEqual({
      url: "/api/v1/documents/doc-1",
      body: { isConfidential: true },
    });
    expect(await within(section).findByRole("img", { name: "Confidential" })).toBeVisible();

    // One item, two states: the words are what tell the set from the
    // clear, because DES-009 gives confidentiality one glyph.
    await act(user, section, "Orion_MSA_2026_draft.docx", "Clear confidential mark");
    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[1]).toEqual({
      url: "/api/v1/documents/doc-1",
      body: { isConfidential: false },
    });
    await waitFor(() =>
      expect(within(section).queryByRole("img", { name: "Confidential" })).not.toBeInTheDocument(),
    );
  });

  it("offers the flag to the record's Owner, who uploaded nothing", async () => {
    const api = documentsApi([SOMEONE_ELSES], { ownerId: "u2" });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    // CTR-022's clause: the person accountable for the record decides
    // its files' audience, team row or no team row.
    const section = await documentsSection();
    expect(await menuVerbs(user, section, "board_pack.pdf")).toContain("Mark confidential");
  });

  it("reports the seam's own refusal when the flag is turned down, and keeps the mark as it was", async () => {
    const api = documentsApi([WALLED], {
      editFails:
        "Only an Administrator, the person who uploaded this document, or " +
        "the contract's Owner can change this.",
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    await act(user, section, "board-memo.txt", "Clear confidential mark");

    // The seam is the rule; the menu only keeps a control from offering
    // a dead end. When the two disagree, the seam's words are what the
    // section says.
    expect(
      await within(section).findByText(
        "Only an Administrator, the person who uploaded this document, or " +
          "the contract's Owner can change this.",
      ),
    ).toBeVisible();
    expect(within(section).getByRole("img", { name: "Confidential" })).toBeVisible();
  });

  it("keeps the flag off the menu for a viewer who is none of the three", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([SOMEONE_ELSES]).handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    // On the record, working on it, and that is not a claim on who else
    // may see this file. The seam refuses them 403 regardless; the menu
    // is what keeps a control from offering a dead end.
    const section = await documentsSection();
    expect(await menuVerbs(user, section, "board_pack.pdf")).not.toContain("Mark confidential");
  });

  it("takes a typed name before it destroys a document, and sends it to the seam", async () => {
    const api = documentsApi([DRAFT, THEIRS]);
    stubApi({ signedIn: ADMIN, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    expect(await menuVerbs(user, section, "Orion_MSA_2026_draft.docx")).toContain("Delete");
    await user.keyboard("{Escape}");
    await act(user, section, "Orion_MSA_2026_draft.docx", "Delete");

    const dialog = await screen.findByRole("dialog");
    // The consequence before the verb: the chain and the stored files
    // go, and there is no undo.
    expect(
      within(dialog).getByText(/Orion_MSA_2026_draft.docx and its 1 version are removed/),
    ).toBeVisible();
    const confirm = within(dialog).getByRole("button", {
      name: "Delete Orion_MSA_2026_draft.docx",
    });
    expect(confirm).toBeDisabled();

    // A near miss is not the name.
    const box = within(dialog).getByLabelText("Type Orion_MSA_2026_draft.docx to confirm");
    await user.type(box, "Orion_MSA_2026_draft.doc");
    expect(confirm).toBeDisabled();
    await user.type(box, "x");
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(() => expect(api.writes).toHaveLength(1));
    // The typed name rides to the seam: the dialog is one half of the
    // rule, and the seam is where it holds.
    expect(api.writes[0]).toEqual({
      url: "/api/v1/documents/doc-1:DELETE",
      body: { confirmTitle: "Orion_MSA_2026_draft.docx" },
    });
    await waitFor(() =>
      expect(
        within(section).queryByRole("link", { name: "Orion_MSA_2026_draft.docx" }),
      ).not.toBeInTheDocument(),
    );
    expect(countBadge(section, "1 document")).toBeVisible();
  });

  it("reads a refused erasure inside the dialog, where the dialog has not covered it", async () => {
    // The refusal is reachable: a rename that lands between the dialog
    // opening and Delete arriving makes the typed name the wrong one.
    // The section's own note sits behind the open dialog, so a refusal
    // reported there reads nowhere at all.
    const api = documentsApi([DRAFT], {
      removalFails: "Type the document's name exactly to delete it.",
    });
    stubApi({ signedIn: ADMIN, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    await act(user, section, "Orion_MSA_2026_draft.docx", "Delete");

    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Type Orion_MSA_2026_draft.docx to confirm"),
      "Orion_MSA_2026_draft.docx",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Delete Orion_MSA_2026_draft.docx" }),
    );

    expect(
      await within(dialog).findByText("Type the document's name exactly to delete it."),
    ).toBeVisible();
    // The dialog stays: the typing is still there to correct.
    expect(screen.getByRole("dialog")).toBeVisible();
    // Nothing moved. Queried by text, not by role: the open dialog
    // hides the rest of the page from the accessibility tree.
    expect(within(section).getByText("Orion_MSA_2026_draft.docx")).toBeInTheDocument();
  });

  it("reports the seam's own refusal when a removal is turned down", async () => {
    const api = documentsApi([DRAFT], { removalFails: "This document is already archived." });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await documentsSection();
    await act(user, section, "Orion_MSA_2026_draft.docx", "Archive");

    expect(await within(section).findByText("This document is already archived.")).toBeVisible();
    // Nothing moved: the section draws what the record says.
    expect(
      within(section).getByRole("link", { name: "Orion_MSA_2026_draft.docx" }),
    ).toBeInTheDocument();
    expect(countBadge(section, "1 document")).toBeVisible();
  });
});

/**
 * The bound on the record's paper and its foot (CTR-024, DES-031).
 *
 * A contract holds as many documents as it needs (CTR-014), so the
 * section is paged like the contract list it hangs off — and the way to
 * the rest is a control under the table.
 */
describe("the paged Documents section (CTR-024, DES-031)", () => {
  const FIRST = {
    id: "doc-first",
    title: "Orion_MSA_2026_draft.docx",
    description: null,
    isPrimary: true,
    archivedAt: null,
    isConfidential: false,
    createdBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
    createdAt: "2026-08-11T09:00:00.000Z",
    updatedAt: "2026-08-11T09:00:00.000Z",
    versions: [
      {
        id: "ver-first",
        versionNumber: 1,
        kind: "draft_ours",
        note: null,
        originalFilename: "Orion_MSA_2026_draft.docx",
        mimeType: "text/plain",
        byteSize: 10,
        checksumSha256: "a".repeat(64),
        uploadedBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
        createdAt: "2026-08-11T09:00:00.000Z",
        isCurrent: true,
        isExecuted: false,
      },
    ],
  };
  const SECOND = {
    ...FIRST,
    id: "doc-second",
    title: "board_pack.pdf",
    isPrimary: false,
    versions: [{ ...FIRST.versions[0]!, id: "ver-second", originalFilename: "board_pack.pdf" }],
  };

  /** Two pages of paper, the second reached only with the first's
   * cursor. Everything else on the record is the plain stub. */
  function pagedPaper() {
    const cursors: (string | null)[] = [];
    const record = recordApi(contractRow());
    const handler = (call: StubCall): Response | undefined => {
      if (call.url.pathname === "/api/v1/contracts/42/documents" && call.method === "GET") {
        const cursor = call.url.searchParams.get("cursor");
        cursors.push(cursor);
        return cursor === null
          ? json(200, { documents: [FIRST], nextCursor: "doc-first" })
          : json(200, { documents: [SECOND], nextCursor: null });
      }
      return record.handler(call);
    };
    return { handler, cursors };
  }

  it("appends the next page in place, and the count follows what is on screen", async () => {
    const api = pagedPaper();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await screen.findByRole("region", { name: /^Documents/ });
    expect(within(section).getByRole("link", { name: FIRST.title })).toBeInTheDocument();
    expect(within(section).queryByRole("link", { name: SECOND.title })).not.toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "Show more" }));

    expect(await within(section).findByRole("link", { name: SECOND.title })).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: FIRST.title })).toBeInTheDocument();
    expect(api.cursors).toEqual([null, "doc-first"]);
    // The end of the record's paper: the foot goes with it.
    expect(within(section).queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    expect(within(section).getByRole("img", { name: "2 documents" })).toBeVisible();
  });

  it("puts focus on the first row it appended, and says how many followed", async () => {
    stubApi({ signedIn: MEMBER, extra: pagedPaper().handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await screen.findByRole("region", { name: /^Documents/ });
    await user.click(within(section).getByRole("button", { name: "Show more" }));

    const landed = (await within(section).findByRole("link", { name: SECOND.title })).closest("tr");
    await waitFor(() => expect(landed).toHaveFocus());
    expect(within(section).getByText("1 more document. 2 shown.")).toBeInTheDocument();
  });

  it("keeps the foot and the cursor when a page fails, so the retry is the same button", async () => {
    // The first reach for the next page is refused; the second is not.
    let reached = 0;
    const record = recordApi(contractRow());
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall): Response | undefined => {
        if (call.url.pathname === "/api/v1/contracts/42/documents" && call.method === "GET") {
          if (call.url.searchParams.get("cursor") === null) {
            return json(200, { documents: [FIRST], nextCursor: "doc-first" });
          }
          reached += 1;
          return reached === 1
            ? problem(503, "The documents are not available.")
            : json(200, { documents: [SECOND], nextCursor: null });
        }
        return record.handler(call);
      },
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const section = await screen.findByRole("region", { name: /^Documents/ });
    await within(section).findByRole("link", { name: FIRST.title });
    await user.click(within(section).getByRole("button", { name: "Show more" }));

    // The failure is spoken beside the control, and the control stays.
    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "The documents are not available.",
    );
    const again = within(section).getByRole("button", { name: "Show more" });
    // Nothing was appended, and the count still counts only what is here.
    expect(within(section).queryByRole("link", { name: SECOND.title })).not.toBeInTheDocument();
    expect(within(section).getByRole("img", { name: "1 document" })).toBeVisible();

    await user.click(again);

    expect(await within(section).findByRole("link", { name: SECOND.title })).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: FIRST.title })).toBeInTheDocument();
    expect(within(section).getByRole("img", { name: "2 documents" })).toBeVisible();
  });
});

/**
 * The doc panel (M12/2, DOC-004, DES-016).
 *
 * The demand is one sentence: a Legal Team Member clicks a PDF version
 * on a contract and reads it in-app, no download. What this asserts is
 * the panel around that — that the name opens it, that the family the
 * server routed the file to decides which surface it gets, that a file
 * outside the render set gets an honest card and never a broken
 * preview, that any round in the chain opens, and that the M4 keyboard
 * contract holds: Esc closes it and focus comes back to the row.
 *
 * The rendering itself is not asserted here and cannot be: pdf.js draws
 * into a canvas, which jsdom has none of. What the panel promises this
 * layer is the right surface at the right address — the pixels are the
 * library's job, and the demo spec is where the whole stack is watched
 * drawing them.
 */
describe("the doc panel (M12/2)", () => {
  const version = (over: Record<string, unknown> = {}) => ({
    id: "pv-1",
    versionNumber: 1,
    kind: "draft_ours",
    note: null,
    originalFilename: "msa-signed.pdf",
    mimeType: "application/pdf",
    renderFamily: "pdf",
    byteSize: 240_000,
    checksumSha256: "a".repeat(64),
    uploadedBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
    createdAt: "2026-08-11T09:00:00.000Z",
    isCurrent: true,
    isExecuted: false,
    ...over,
  });

  const document = (over: Record<string, unknown> = {}) => ({
    id: "pdoc-1",
    title: "Orion Cloud — master services agreement",
    description: null,
    isPrimary: true,
    archivedAt: null,
    isConfidential: false,
    createdBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
    createdAt: "2026-08-11T09:00:00.000Z",
    updatedAt: "2026-08-11T09:00:00.000Z",
    versions: [version()],
    ...over,
  });

  /** The record's three loader reads plus the paper, and nothing else:
   * the panel makes no call of its own — the preview is an address the
   * browser fetches, not a client call. */
  function panelApi(rows: Record<string, unknown>[]) {
    const record = recordApi(contractRow(), [person("u1", "creator"), person("u2", "member")]);
    return (call: StubCall): Response | undefined => {
      if (call.url.pathname === "/api/v1/contracts/42/documents" && call.method === "GET") {
        return json(200, { documents: rows, nextCursor: null });
      }
      return record.handler(call);
    };
  }

  /** The same, plus the metadata edit — for the one test that renames a
   * document while its panel is open. */
  function editablePanelApi() {
    const record = recordApi(contractRow(), [person("u1", "creator"), person("u2", "member")]);
    let rows = [document()];
    return (call: StubCall): Response | undefined => {
      if (call.url.pathname === "/api/v1/contracts/42/documents" && call.method === "GET") {
        return json(200, { documents: rows, nextCursor: null });
      }
      const edited = /^\/api\/v1\/documents\/([^/]+)$/.exec(call.url.pathname);
      if (edited && call.method === "PATCH") {
        const next = { ...rows[0]!, ...(call.body as Record<string, unknown>) };
        rows = [next];
        return json(200, { document: next });
      }
      return record.handler(call);
    };
  }

  const section = () => screen.findByRole("region", { name: /^Documents/ });
  const panel = (name: RegExp) => screen.findByRole("complementary", { name });

  it("opens a PDF version in the panel from its name, with no download", async () => {
    stubApi({ signedIn: MEMBER, extra: panelApi([document()]) });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const list = await section();
    // A file that reads in the app is a button, not a download link:
    // pressing it opens the panel rather than saving the file.
    const open = within(list).getByRole("button", {
      name: "Orion Cloud — master services agreement",
    });
    expect(
      within(list).queryByRole("link", { name: "Orion Cloud — master services agreement" }),
    ).toBeNull();

    await user.click(open);
    const reading = await panel(/master services agreement, version 1/);
    // The name, the round, and the file's own name — the DOC2 mock's
    // header and toolbar.
    expect(within(reading).getByRole("heading", { level: 2 })).toHaveTextContent(
      "Orion Cloud — master services agreement",
    );
    expect(within(reading).getByText("v1")).toBeVisible();
    expect(within(reading).getByText("msa-signed.pdf")).toBeVisible();
    // The download is still one click away, from inside the panel.
    expect(within(reading).getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "/api/v1/documents/pdoc-1/versions/pv-1/download",
    );
    // The chain says which round is on screen, so a reader coming back
    // to the list can see where they are.
    expect(open).toHaveAttribute("aria-current", "true");
  });

  it("keeps the panel's header on the record's own words after a rename", async () => {
    stubApi({ signedIn: MEMBER, extra: editablePanelApi() });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const list = await section();
    await user.click(
      within(list).getByRole("button", { name: "Orion Cloud — master services agreement" }),
    );
    await panel(/master services agreement, version 1/);

    // Renaming the document while it is open moves the panel's header
    // with it: what the panel draws is resolved from the list, never
    // from a copy taken when it opened.
    await user.click(
      within(list).getByRole("button", {
        name: "Actions for Orion Cloud — master services agreement",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Edit details" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Orion Cloud MSA");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await panel(/Orion Cloud MSA, version 1/)).toBeVisible();
  });

  it("draws a raster image inline, from the preview address", async () => {
    const image = document({
      id: "pdoc-img",
      title: "Signature page",
      versions: [
        version({
          id: "pv-img",
          originalFilename: "signature-page.png",
          mimeType: "image/png",
          renderFamily: "image",
        }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: panelApi([image]) });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(within(await section()).getByRole("button", { name: "Signature page" }));
    const reading = await panel(/Signature page, version 1/);
    // Inline, and read from the preview rather than the download: the
    // server sets the type and the disposition there.
    expect(within(reading).getByRole("img", { name: "signature-page.png" })).toHaveAttribute(
      "src",
      "/api/v1/documents/pdoc-img/versions/pv-img/preview",
    );
  });

  it("gives an out-of-set file an honest download card, never a broken preview", async () => {
    const sheet = document({
      id: "pdoc-x",
      title: "fee-schedule.xlsx",
      versions: [
        version({
          id: "pv-x",
          originalFilename: "fee-schedule.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          renderFamily: "other",
        }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: panelApi([sheet]) });
    renderAt("/contracts/42");

    const list = await section();
    // Nothing in the section opens it, because nothing in the app can
    // read it: the name stays the download it was in M11.
    expect(within(list).getByRole("link", { name: "fee-schedule.xlsx" })).toHaveAttribute(
      "href",
      "/api/v1/documents/pdoc-x/versions/pv-x/download",
    );
    expect(within(list).queryByRole("button", { name: "fee-schedule.xlsx" })).toBeNull();
  });

  it("opens a superseded round as readily as the current one", async () => {
    const chain = document({
      id: "pdoc-chain",
      title: "Negotiated agreement",
      versions: [
        version({
          id: "pv-a",
          versionNumber: 1,
          originalFilename: "round_1.pdf",
          isCurrent: false,
        }),
        version({ id: "pv-b", versionNumber: 2, originalFilename: "round_2.pdf" }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: panelApi([chain]) });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const list = await section();
    await user.click(
      within(list).getByRole("button", { name: /Show the 1 earlier version of Negotiated/ }),
    );
    await user.click(within(list).getByRole("button", { name: "round_1.pdf" }));

    // The round on screen is the one that was asked for, not the head
    // of the chain.
    const reading = await panel(/Negotiated agreement, version 1/);
    expect(within(reading).getByText("round_1.pdf")).toBeVisible();
    expect(within(reading).getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "/api/v1/documents/pdoc-chain/versions/pv-a/download",
    );
  });

  it("closes on Esc and puts focus back on the row that opened it", async () => {
    stubApi({ signedIn: MEMBER, extra: panelApi([document()]) });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const list = await section();
    const open = within(list).getByRole("button", {
      name: "Orion Cloud — master services agreement",
    });
    await user.click(open);
    await panel(/master services agreement, version 1/);

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: /master services agreement, version 1/ }),
      ).toBeNull(),
    );
    // DES-010's restore-to-trigger rule: the panel is a plain aside, so
    // this is wired by hand and has to be asserted.
    expect(open).toHaveFocus();
  });

  it("closes from its own close control", async () => {
    stubApi({ signedIn: MEMBER, extra: panelApi([document()]) });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const list = await section();
    await user.click(
      within(list).getByRole("button", { name: "Orion Cloud — master services agreement" }),
    );
    const reading = await panel(/master services agreement, version 1/);
    await user.click(within(reading).getByRole("button", { name: "Close the document" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: /master services agreement, version 1/ }),
      ).toBeNull(),
    );
  });

  it("lets a Contributor on the team read what they can already download", async () => {
    stubApi({ signedIn: CONTRIBUTOR, extra: panelApi([document()]) });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const list = await section();
    await user.click(
      within(list).getByRole("button", { name: "Orion Cloud — master services agreement" }),
    );
    // Read access means reading, on every surface: the panel is not a
    // write and is offered to everyone the record names.
    expect(await panel(/master services agreement, version 1/)).toBeVisible();
  });
});
