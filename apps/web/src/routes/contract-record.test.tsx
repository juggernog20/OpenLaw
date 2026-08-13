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
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");

    const bar = await screen.findByRole("toolbar", { name: "Applets" });
    // Chat opens a panel (CMT-004); settings navigates (SET-001).
    expect(within(bar).getByRole("button", { name: "Comments" })).toBeInTheDocument();
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
  ) {
    return { id, entityType: "contract", entityId: "c1", author, body, visibility, createdAt };
  }

  /** The thread seam, stateful the way the API is: a post appends, and
   * the next read answers what the poster now sees. The handler only
   * answers; what it was asked is recorded for the test to assert. */
  function commentsApi(initial: ReturnType<typeof comment>[] = []) {
    let thread = initial;
    const posts: unknown[] = [];
    const reads: Record<string, string | null>[] = [];
    const handler = (call: StubCall): Response | undefined => {
      if (call.url.pathname !== "/api/v1/comments") return undefined;
      if (call.method === "GET") {
        reads.push({
          entityType: call.url.searchParams.get("entityType"),
          entityId: call.url.searchParams.get("entityId"),
        });
        return json(200, { comments: thread });
      }
      if (call.method === "POST") {
        posts.push(call.body);
        const body = call.body as { body: string; visibility: string };
        const posted = comment(
          `c-new-${thread.length}`,
          body.body,
          body.visibility,
          AUTHOR,
          "2026-08-12T12:00:00.000Z",
        );
        thread = [...thread, posted];
        return json(201, { comment: posted });
      }
      return undefined;
    };
    return { handler, posts, reads };
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
    expect(within(panel).getByText("3")).toBeInTheDocument();
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
    expect(within(panel).getByText("2")).toBeInTheDocument();
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
  });

  it("says so when the post is refused, and keeps the draft", async () => {
    const user = userEvent.setup();
    const record = recordApi(contractRow());
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        if (call.url.pathname === "/api/v1/comments" && call.method === "GET") {
          return json(200, { comments: [] });
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
});
