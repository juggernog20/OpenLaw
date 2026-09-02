// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The /contracts/:number record page (M8), through the real route table
 * with the standard fetch stub: Member+ lands on the record at its
 * number-based address, edits a field in place (DES-017 — blur commits
 * one PATCH, Escape commits none), sets the Owner, the signing entity,
 * status, priority, and risk from their selects, records the CTR-010
 * value as one field in three controls — committed, reverted, and
 * cleared as a group — works the Team applet,
 * archives the record (every input freezes, the sub-bar action flips),
 * and restores it. The signing-entity picker reads the M7 registry,
 * which never lists an archived entity. The counterparty typeahead
 * searches the book, commits an existing organization by id and an
 * unknown name by name, never offers to create a name the search
 * already answered with, and moves the primary. The activity bar mounts
 * with the applet set that exists at M9/2 — the team slot, the chat slot
 * and the settings deep-link.
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  json,
  problem,
  renderAt,
  stubApi,
  stubEventSource,
  type StubAnswer,
  type StubCall,
} from "../testing/helpers";
import type { CustomFieldValue, CustomFieldValues } from "../lib/custom-fields";
import type { Comment } from "../lib/comments";

const PDF_PAGE_TEXT = vi.hoisted(() => [
  ["The first termination right is on this page."],
  ["A second termi", "nation right appears here. The final termination right follows."],
]);

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: PDF_PAGE_TEXT.length,
      loadingTask: { destroy: () => Promise.resolve() },
      getPage: (pageNumber: number) => {
        const items = (PDF_PAGE_TEXT[pageNumber - 1] ?? []).map((str) => ({ str }));
        return Promise.resolve({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 600 * scale,
            height: 800 * scale,
          }),
          getTextContent: () => Promise.resolve({ items }),
          render: () => ({ promise: Promise.resolve() }),
        });
      },
    }),
  }),
  TextLayer: class MockTextLayer {
    readonly options: {
      textContentSource: { items: Array<{ str?: string }> };
      container: HTMLElement;
    };

    constructor(options: {
      textContentSource: { items: Array<{ str?: string }> };
      container: HTMLElement;
    }) {
      this.options = options;
    }

    render() {
      for (const item of this.options.textContentSource.items) {
        const span = document.createElement("span");
        span.textContent = item.str ?? "";
        this.options.container.append(span);
      }
      return Promise.resolve();
    }
  },
}));

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class MockIntersectionObserver {
      readonly callback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element) {
        queueMicrotask(() => {
          this.callback(
            [{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        });
      }

      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];
    },
  );
});

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
  fieldTag: "business",
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
  fieldTag: "legal",
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
  fieldTag: "legal" as const,
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
    { id: "s-redlining", slug: "redlining", displayName: "With counterparty", stage: "review" },
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

/** Opens the team applet from the activity bar and answers its panel.
 * Idempotent: a leftover `#contract-team` hash (DES-028) already expands
 * it on mount, and clicking the icon then would collapse it. */
async function openTeam(user: ReturnType<typeof userEvent.setup>) {
  const bar = await screen.findByRole("toolbar", { name: "Applets" });
  const icon = within(bar).getByRole("button", { name: "Team" });
  if (icon.getAttribute("aria-expanded") !== "true") {
    await user.click(icon);
  }
  return screen.getByRole("complementary", { name: "Team" });
}

/** The strip's move control (DES-053): the current stage's pill, which
 * is the one item of the six that can be pressed. Queried by its
 * accessible name rather than its role, so it is still reachable behind
 * an open dialog — the soft gate hides the page from the a11y tree. */
function moveControl(stage: string) {
  return screen.getByLabelText(`${stage} — move contract`);
}

/** Opens the move menu and picks a status by the label it wears. Does
 * not wait for the commit that follows. */
async function moveTo(user: ReturnType<typeof userEvent.setup>, status: string) {
  await user.click(await screen.findByRole("button", { name: /move contract$/ }));
  // A row's name is the status followed by its stage, so the match is on
  // what the name starts with — literally, because a status name is the
  // install's own words and may carry regex punctuation.
  await user.click(
    await screen.findByRole("menuitemradio", { name: (name: string) => name.startsWith(status) }),
  );
}

/** The record's overflow menu (DES-055), opened by its sub-bar trigger.
 * Only one Radix menu is mounted at a time, so the row can be asked for
 * by name even where a section draws a row of the same name. */
async function recordAction(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("button", { name: "Contract actions" }));
  await user.click(await screen.findByRole("menuitem", { name }));
}

/** The rows the record's overflow menu offers, in order. */
async function recordActions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Contract actions" }));
  const menu = await screen.findByRole("menu");
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
}

/** jsdom does not fire the clip's width transitionend, so a close
 * test that waits for the aside to unmount has to dispatch it. */
function finishAppletSlide(panel: HTMLElement) {
  const clip = panel.parentElement;
  expect(clip).not.toBeNull();
  fireEvent.transitionEnd(clip!, { propertyName: "width" });
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

/**
 * The synthetic drop harness (M13/4, M13/5, DOC-011).
 *
 * jsdom has neither drag nor the browser's directory-entry API, so a
 * dropped tree is fed in as synthetic `DataTransfer` entry objects — the
 * shape the walk reads and nothing else. That was M13's agreed seam
 * decision, and it lives at module scope so the batch suite and the
 * folder-drop suite exercise **one** harness: a change to what a
 * directory reader does under failure has one place to be made.
 */

/** One node of a dropped tree: a file, or a directory holding more of
 * them. */
type DropNode = File | { name: string; children: DropNode[] };

/** A directory of a dropped tree. With no children it is an empty
 * directory, which is the case M13/5 recreates on its own. */
const dir = (name: string, children: DropNode[] = []) => ({ name, children });

/**
 * One node of a dropped tree, as the directory-entry API would hand it
 * over.
 *
 * Both calls are callback-shaped because the real ones are, and
 * `readEntries` answers its children once and an empty page after —
 * which is how a real reader says it has finished, and the loop that
 * reads it has to be exercised against that.
 */
function entryOf(node: DropNode): unknown {
  if (node instanceof File) {
    return {
      isFile: true,
      isDirectory: false,
      name: node.name,
      file: (resolve: (file: File) => void) => resolve(node),
    };
  }
  return {
    isFile: false,
    isDirectory: true,
    name: node.name,
    createReader: () => {
      let served = false;
      return {
        readEntries: (resolve: (entries: unknown[]) => void) => {
          if (served) return resolve([]);
          served = true;
          resolve(node.children.map(entryOf));
        },
      };
    },
  };
}

/**
 * A drop on one target — the Documents section, or a folder row.
 *
 * The `DataTransfer` is synthetic for the reason the entries are.
 * `items` carries them, because that is the list that can say what an
 * entry *is*: `dataTransfer.files` would hand back a flat list with the
 * dropped structure already destroyed.
 */
function dropOn(target: HTMLElement, nodes: DropNode[]) {
  const dataTransfer = {
    types: ["Files"],
    files: nodes.filter((node): node is File => node instanceof File),
    items: nodes.map((node) => ({
      kind: "file",
      getAsFile: () => (node instanceof File ? node : new File([], node.name)),
      webkitGetAsEntry: () => entryOf(node),
    })),
  };
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

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
  initialRefs: {
    users: Record<string, unknown>[];
    entities: Record<string, unknown>[];
  } = { users: [], entities: [] },
) {
  let row = initial;
  /** The attached fields follow the row's type, exactly as the API
   * derives them from the `contract_type_fields` join (CTR-016). */
  const fieldsOf = (of: Record<string, unknown>) =>
    OPTIONS.contractTypes.find((option) => option.id === of.contractTypeId)?.fields ?? [];
  const customEnvelope = () => ({
    fields: fieldsOf(row),
    // Empty unless a suite names referenced rows. Only the restricted
    // Entity-valued Field case supplies one, and it names a row no
    // picker offers.
    customFieldRefs: initialRefs,
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
      return json(200, {
        contract: row,
        ...customEnvelope(),
        team,
        counterparties: parties,
        renewals: [],
      });
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
    // The sub-bar carries the breadcrumb, the reference, the status
    // pill, and the stage pipeline (the nav also links to Contracts, and
    // the status select's options carry the same labels).
    const subbar = screen.getByRole("region", { name: "Acme master services agreement" });
    expect(within(subbar).getByRole("link", { name: "Contracts" })).toHaveAttribute(
      "href",
      "/contracts",
    );
    expect(within(subbar).getByText("C-42")).toBeInTheDocument();
    // The pipeline's own "Draft" step says the stage, so the pill is
    // read as the one outside it (CTR-001: one datum, two zooms).
    const pipeline = within(subbar).getByRole("list", { name: "Stage" });
    expect(
      within(subbar)
        .getAllByText("Draft")
        .filter((node) => !pipeline.contains(node)),
    ).toHaveLength(1);

    expect(screen.getByLabelText("Title")).toHaveValue("Acme master services agreement");
    // The status is not a field of the card any more (DES-053): it
    // commits from the strip, on the stage the record sits on.
    expect(moveControl("Draft")).toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
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
    // Team opens a panel (DES-047); chat opens a panel (CMT-004);
    // settings navigates (SET-001).
    expect(within(bar).getByRole("button", { name: "Team" })).toBeInTheDocument();
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

    await moveTo(user, "Active");
    await waitFor(() => expect(api.patches).toEqual([{ statusId: "s-active" }]));
    const subbar = screen.getByRole("region", { name: "Acme master services agreement" });
    // The pipeline beside the pill says "Active" too, so the pill is
    // read as the one outside it (CTR-001: one datum, two zooms).
    const pipeline = within(subbar).getByRole("list", { name: "Stage" });
    expect(
      within(subbar)
        .getAllByText("Active")
        .filter((node) => !pipeline.contains(node)),
    ).toHaveLength(1);

    // Backwards too — deals collapse and reopen (CTR-001).
    await moveTo(user, "With counterparty");
    await waitFor(() =>
      expect(api.patches).toEqual([{ statusId: "s-active" }, { statusId: "s-redlining" }]),
    );
  });

  it("commits nothing when the status the record already holds is picked again", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await moveTo(user, "Draft");

    // The record is already on Draft, so that press is not a move. An
    // entry saying the contract moved to where it was is worse than no
    // entry at all (DD-017).
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(api.patches).toEqual([]);
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

    // Empty, the three controls are the whole field — there is no
    // read-back line under them to wait for.
    expect(await screen.findByLabelText("Amount")).toHaveValue(null);
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
    // And the read-back line goes with them: with no value there is
    // nothing to read back.
    expect(screen.queryByText("$5,000.00")).not.toBeInTheDocument();
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
    // The roster follows: the Owner heads the Team applet.
    const team = await openTeam(user);
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

  it("uses the shared Restricted Entity cell when the signing Entity is walled", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(contractRow({ entity: { restricted: true } })).handler,
    });
    renderAt("/contracts/42");

    expect(await screen.findByText("Restricted Entity")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Our entity" })).not.toBeInTheDocument();
  });

  it("uses the shared Restricted Entity cell for an Entity-valued custom Field", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: recordApi(
        contractRow({
          contractTypeId: "t-full",
          contractTypeName: "Every field",
          customFields: { field_8: "e-secret" },
        }),
        [person("u1", "creator")],
        [],
        { users: [], entities: [{ restricted: true, id: "e-secret" }] },
      ).handler,
    });
    renderAt("/contracts/42/fields");

    expect(await screen.findByText("Booking entity")).toBeInTheDocument();
    expect(screen.getByText("Restricted Entity")).toBeInTheDocument();
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

    // Wait for the create row, not a match row. A match row can come
    // from the empty-term search the click scheduled, and that stale
    // answer still lists Orion. The create row is withheld until the
    // answer to the full term is in (#611), so it is the signal that
    // the list below is the one the rendering rule promises.
    await screen.findByRole("option", { name: 'Create "Helix"' });
    // Contains, not starts-with — both Helix organizations are offered.
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
            renewals: [],
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
            renewals: [],
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

    await moveTo(user, "Active");
    expect(
      await screen.findByText("The status must be a live contract status."),
    ).toBeInTheDocument();
    // The strip still shows the saved truth — nothing was adopted.
    expect(moveControl("Draft")).toBeInTheDocument();
  });

  it("keeps a saved status the picker no longer offers pickable as itself", async () => {
    const api = recordApi(contractRow({ statusId: "s-archived", statusName: "Superseded" }));
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /move contract$/ }));
    const row = await screen.findByRole("menuitemradio", { name: /^Superseded/ });
    // Checked, so the menu says where the record is rather than leaving
    // every row unpicked and the reader guessing.
    expect(row).toHaveAttribute("aria-checked", "true");
  });

  it("lists the contract team, and names who made the record", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const team = await openTeam(user);
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

    const team = await openTeam(user);
    await user.click(within(team).getByRole("button", { name: "Add team member" }));
    await user.selectOptions(screen.getByLabelText("Person"), "u3");
    await user.selectOptions(screen.getByLabelText("Role"), "contributor");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(api.teamCalls).toEqual(["add u3 contributor"]));
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

    const team = await openTeam(user);
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
            renewals: [],
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

    const team = await openTeam(user);
    await user.click(within(team).getByRole("button", { name: "Add team member" }));
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

    await recordAction(user, "Archive");
    await waitFor(() => expect(api.posts).toEqual(["archive"]));
    expect(screen.getByText(/This contract is archived/)).toBeInTheDocument();
    for (const label of [
      "Title",
      "Contract type",
      "Owner",
      "Our entity",
      "Priority",
      "Risk",
      // The value freezes as a group, like it commits as one.
      "Amount",
      "Currency",
      "Cadence",
      "Description",
    ]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    // The move control does not freeze — it goes (DES-053). An
    // archived record is facts until it is restored, and the strip is
    // the reading it always was.
    expect(screen.queryByRole("button", { name: /move contract$/ })).not.toBeInTheDocument();
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
    const team = await openTeam(user);
    expect(within(team).getByRole("button", { name: "Add team member" })).toBeDisabled();
    expect(
      within(team).queryByRole("button", { name: /Take Nadia Counsel off the team/ }),
    ).not.toBeInTheDocument();
    // The freeze is the record's, not the section's: the type's own
    // fields are behind the Fields tab (DES-032) and freeze there too
    // (CTR-016).
    await user.click(screen.getByRole("link", { name: "Fields" }));
    expect(await screen.findByLabelText("Payment terms")).toBeDisabled();
    await user.click(screen.getByRole("link", { name: "Overview" }));

    // Archived, the menu keeps the way back and drops the rename: a
    // record with no editable title is offered no editor for it.
    expect(await recordActions(user)).toEqual(["Copy link", "Restore"]);
    await user.keyboard("{Escape}");

    await recordAction(user, "Restore");
    await waitFor(() => expect(api.posts).toEqual(["archive", "restore"]));
    expect(screen.queryByText(/This contract is archived/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeEnabled();
    expect(await recordActions(user)).toEqual(["Copy link", "Rename contract", "Archive"]);
  });

  it("renames from the menu by taking the reader to the title field, from any section", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    // Started on a section the title field is not on, which is the case
    // the menu has to answer: the field is behind the Overview tab.
    renderAt("/contracts/42/fields");
    const user = userEvent.setup();

    await screen.findByRole("button", { name: "Contract actions" });
    await recordAction(user, "Rename contract");

    const title = await screen.findByLabelText<HTMLInputElement>("Title");
    await waitFor(() => expect(title).toHaveFocus());
    // Selected whole, so the next keystroke is the new name.
    expect(title.selectionStart).toBe(0);
    expect(title.selectionEnd).toBe("Acme master services agreement".length);

    // The menu opened no editor of its own — this is the DES-017 field,
    // committing on blur as it always has, in one PATCH.
    await user.keyboard("Acme MSA");
    await user.tab();
    await waitFor(() => expect(api.patches).toEqual([{ title: "Acme MSA" }]));
  });

  it("copies a link to the record and says so without closing the menu", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi(contractRow()).handler });
    // Copying from a section: the link is the record's address, not the
    // reader's, so it drops the section.
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Contract actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Copy link" }));

    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/contracts/42`);
    // The row says it worked, which it can only do with the menu still
    // open — closing would take the one confirmation with it.
    expect(await screen.findByRole("menuitem", { name: "Copied" })).toBeInTheDocument();
  });

  it("draws the type's attached fields in attachment order and commits one by slug", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/fields");
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
    renderAt("/contracts/42/fields");
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
    renderAt("/contracts/42/fields");
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
    renderAt("/contracts/42/fields");
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
    renderAt("/contracts/42/fields");
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
    // The new type's fields replace the old type's on the card. The
    // re-type happens on the Overview and the card is a tab away
    // (DES-032), so crossing to it is part of the check: the attached
    // set is the record's state, not the section's.
    await user.click(screen.getByRole("link", { name: "Fields" }));
    const card = within(await screen.findByRole("region", { name: "Fields" }));
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
    renderAt("/contracts/42/fields");
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
    renderAt("/contracts/42/fields");

    expect(await screen.findByText(/This contract type attaches no fields/)).toBeInTheDocument();
  });

  it("bounces a Business User to the portal", async () => {
    // The refusal still bounces to "/"; the root guard forwards a
    // Business User from there to the portal (INT-001, #376).
    stubApi({ signedIn: BUSINESS });
    renderAt("/contracts/42");
    expect(
      await screen.findByRole("heading", { name: "What do you need from Legal?" }),
    ).toBeInTheDocument();
  });

  it("sends an unauthenticated visitor to login", async () => {
    stubApi({ signedIn: null, needsSetup: false });
    renderAt("/contracts/42");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("the contract record's broader Matter context (M23/6)", () => {
  const linkedMatter = {
    restricted: false as const,
    number: 12,
    title: "Regulatory programme",
    statusName: "Open",
    statusCategory: "open" as const,
    isConfidential: false,
    archived: false,
  };

  it("shows standalone and restricted states without leaking a Matter reference", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const first = renderAt("/contracts/42");

    expect(
      await screen.findByText("Standalone Contract — no broader Matter is linked."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Link to Matter" })).toBeVisible();

    first.view.unmount();
    stubApi({
      signedIn: CONTRIBUTOR,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/42/matter" && call.method === "GET") {
          return json(200, { matter: { restricted: true } });
        }
        return api.handler(call);
      },
    });
    renderAt("/contracts/42");

    expect(await screen.findByText("Restricted matter")).toBeVisible();
    expect(screen.queryByText(/M-12|Regulatory programme/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link to Matter" })).not.toBeInTheDocument();
  });

  it("follows the linked Matter and unlinks back to standalone", async () => {
    let matter: Record<string, unknown> | null = linkedMatter;
    let unlinks = 0;
    const api = recordApi(contractRow());
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/42/matter" && call.method === "GET") {
          return json(200, { matter });
        }
        if (call.url.pathname === "/api/v1/contracts/42/matter" && call.method === "DELETE") {
          matter = null;
          unlinks += 1;
          return json(200, { matter: null });
        }
        return api.handler(call);
      },
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    expect(await screen.findByRole("link", { name: "M-12 Regulatory programme" })).toHaveAttribute(
      "href",
      "/matters/12",
    );
    await user.click(screen.getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(unlinks).toBe(1));
    expect(
      await screen.findByText("Standalone Contract — no broader Matter is linked."),
    ).toBeVisible();
  });

  it("links from the record and makes a one-time, non-mutating mismatch suggestion", async () => {
    const writes: string[] = [];
    const confidentialMatter = { ...linkedMatter, isConfidential: true };
    const api = recordApi(contractRow({ isConfidential: false }));
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/42/matter" && call.method === "GET") {
          return json(200, { matter: null });
        }
        if (
          call.url.pathname === "/api/v1/contracts/42/matter-candidates" &&
          call.method === "GET"
        ) {
          return json(200, { candidates: [confidentialMatter] });
        }
        if (call.url.pathname === "/api/v1/contracts/42/matter" && call.method === "POST") {
          writes.push("link");
          return json(200, { matter: confidentialMatter, confidentialityMismatch: true });
        }
        if (call.method === "PATCH") writes.push("patch");
        return api.handler(call);
      },
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Link to Matter" }));
    await user.type(screen.getByLabelText("Search by number or title"), "Regulatory");
    await user.click(await screen.findByRole("button", { name: /Regulatory programme/ }));
    await user.click(screen.getByRole("button", { name: "Link" }));

    expect(await screen.findByRole("heading", { name: "Confidentiality differs" })).toBeVisible();
    expect(
      screen.getByText("This suggestion changes neither record.", { exact: false }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Leave them as they are" }));
    expect(await screen.findByRole("link", { name: "M-12 Regulatory programme" })).toBeVisible();
    expect(writes).toEqual(["link"]);
  });
});

/**
 * The six-stage pipeline on the record (M14/2, CTR-001, grill-plan
 * D.8): the fixed backbone in canonical order, with the marker on the
 * stage the seam answers. The marker follows `stage` and never a
 * label — a status may be renamed to anything, including another
 * stage's name — and it moves backwards as readily as forwards,
 * because transitions are unrestricted.
 */
describe("the contract record's stage pipeline (M14/2)", () => {
  /** The six stages as the strip reads them: the name, whether the
   * marker is on it, and whether it says the "done" word the check
   * glyph says visually. */
  function steps(pipeline: HTMLElement) {
    return within(pipeline)
      .getAllByRole("listitem")
      .map((item) => {
        const text = (item.textContent ?? "").trim();
        return {
          stage: text.replace(/\s*done$/, ""),
          current: item.getAttribute("aria-current") === "step",
          done: /\s*done$/.test(text),
        };
      });
  }

  async function pipelineOn(row: Record<string, unknown>) {
    const api = recordApi(row);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");
    const pipeline = await screen.findByRole("list", { name: "Stage" });
    return { api, pipeline };
  }

  it("draws all six stages in canonical order with the current one marked", async () => {
    const { pipeline } = await pipelineOn(contractRow());

    expect(steps(pipeline)).toEqual([
      { stage: "Draft", current: true, done: false },
      { stage: "Review", current: false, done: false },
      { stage: "Approval", current: false, done: false },
      { stage: "Signature", current: false, done: false },
      { stage: "Active", current: false, done: false },
      { stage: "Ended", current: false, done: false },
    ]);
  });

  it("marks the stage the seam answers, not the one the status label names", async () => {
    // A status renamed "Ended" that maps to `review` is legal: the
    // label is the team's, the stage is the system's (CTR-001).
    const { pipeline } = await pipelineOn(
      contractRow({ statusId: "s-x", statusName: "Ended", stage: "review" }),
    );

    expect(steps(pipeline).find((step) => step.current)?.stage).toBe("Review");
    expect(
      steps(pipeline)
        .filter((step) => step.done)
        .map((step) => step.stage),
    ).toEqual(["Draft"]);
  });

  it("moves the marker when a status change lands on another stage", async () => {
    const { pipeline } = await pipelineOn(contractRow());
    const user = userEvent.setup();

    await moveTo(user, "Active");

    await waitFor(() =>
      expect(steps(pipeline)).toEqual([
        { stage: "Draft", current: false, done: true },
        { stage: "Review", current: false, done: true },
        { stage: "Approval", current: false, done: true },
        { stage: "Signature", current: false, done: true },
        { stage: "Active", current: true, done: false },
        { stage: "Ended", current: false, done: false },
      ]),
    );
  });

  it("moves the marker backwards too, because stage regression is legal", async () => {
    const { pipeline } = await pipelineOn(contractRow({ statusId: "s-active", stage: "active" }));
    const user = userEvent.setup();

    // The redline status maps to `review` — two stages behind where it sits.
    await moveTo(user, "With counterparty");

    await waitFor(() =>
      expect(steps(pipeline)).toEqual([
        { stage: "Draft", current: false, done: true },
        { stage: "Review", current: true, done: false },
        { stage: "Approval", current: false, done: false },
        { stage: "Signature", current: false, done: false },
        { stage: "Active", current: false, done: false },
        { stage: "Ended", current: false, done: false },
      ]),
    );
  });

  it("reads the same on an archived record, which is facts until restored", async () => {
    const { pipeline } = await pipelineOn(
      contractRow({
        statusId: "s-active",
        stage: "active",
        archivedAt: "2026-08-01T00:00:00.000Z",
      }),
    );

    expect(steps(pipeline).find((step) => step.current)?.stage).toBe("Active");
    // Facts, so the current stage is a pill again and not a trigger.
    expect(screen.queryByRole("button", { name: /move contract$/ })).not.toBeInTheDocument();
  });

  it("reads the same for a Contributor, who reads the record rather than edits it", async () => {
    const api = recordApi(contractRow({ statusId: "s-active", stage: "active" }), [
      person("u3", "contributor"),
    ]);
    stubApi({ signedIn: CONTRIBUTOR, extra: api.handler });
    renderAt("/contracts/42");

    const pipeline = await screen.findByRole("list", { name: "Stage" });
    expect(steps(pipeline).find((step) => step.current)?.stage).toBe("Active");
    expect(screen.queryByRole("button", { name: /move contract$/ })).not.toBeInTheDocument();
  });

  it("names every status the record may hold, each beside the stage it maps to", async () => {
    await pipelineOn(contractRow());
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Draft — move contract" }));

    // Statuses, not stages: what commits is the label, and two labels
    // may share one stage (CTR-001). The stage is named on each row
    // because that pair would otherwise read as unexplained.
    const rows = screen.getAllByRole("menuitemradio");
    expect(rows.map((row) => row.textContent)).toEqual([
      "DraftDraft",
      "With counterpartyReview",
      "ActiveActive",
    ]);
    // Where the record is now, marked in the menu as well as the strip.
    expect(rows[0]).toHaveAttribute("aria-checked", "true");
  });
});

describe("the contract record's section tabs (DES-032)", () => {
  it("draws the six sections and lands the bare address on the Overview", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42");

    const strip = within(await screen.findByRole("navigation", { name: "Contract sections" }));
    expect(strip.getAllByRole("link").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Fields",
      "Documents",
      "Approvals",
      "Key dates",
      "Tasks",
    ]);
    // Empty sections carry no count chip — a zero is not news.
    expect(strip.queryByRole("img")).not.toBeInTheDocument();
    // The Overview is the bare address, so it must not read as active
    // on its siblings — that is what `end` on the link is for.
    expect(strip.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(strip.getByRole("link", { name: "Fields" })).not.toHaveAttribute("aria-current");
  });

  it("chips Approvals, Key dates, and Tasks when those sections have work waiting", async () => {
    const api = recordApi(contractRow());
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/42/approvals" && call.method === "GET") {
          return json(200, {
            approvals: [
              { id: "a1", status: "pending" },
              { id: "a2", status: "rejected" },
              { id: "a3", status: "approved" },
            ],
          });
        }
        if (call.url.pathname === "/api/v1/contracts/42/key-dates" && call.method === "GET") {
          return json(200, {
            deadlines: [{ daysAway: 10 }, { daysAway: 0 }, { daysAway: -4 }],
          });
        }
        if (call.url.pathname === "/api/v1/contracts/42/tasks" && call.method === "GET") {
          return json(200, { tasks: [], doneCount: 1, totalCount: 4 });
        }
        return api.handler(call);
      },
    });
    renderAt("/contracts/42");

    const strip = within(await screen.findByRole("navigation", { name: "Contract sections" }));
    // Open = unresolved (pending + rejected), not the whole roster.
    expect(strip.getByRole("img", { name: "2 open approvals" })).toBeInTheDocument();
    // Upcoming includes today; a date that has gone by does not.
    expect(strip.getByRole("img", { name: "2 upcoming dates" })).toBeInTheDocument();
    // Open = not done, not the whole checklist.
    expect(strip.getByRole("img", { name: "3 open tasks" })).toBeInTheDocument();
  });

  it("shows one section at a time, and moves the address with the tab", async () => {
    const api = recordApi(contractRow(), [person("u1", "creator")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/contracts/42");
    const user = userEvent.setup();

    // Overview: the record's own columns, and neither of the other two.
    expect(await screen.findByLabelText("Title")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Fields" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Documents" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Fields" }));
    expect(await screen.findByRole("region", { name: "Fields" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/contracts/42/fields");
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();

    const sections = within(await screen.findByRole("navigation", { name: "Contract sections" }));
    await user.click(sections.getByRole("link", { name: "Documents" }));
    expect(await screen.findByRole("region", { name: "Documents" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/contracts/42/documents");
    expect(screen.queryByRole("region", { name: "Fields" })).not.toBeInTheDocument();
  });

  it("keeps the sub-bar and the Team applet beside every section", async () => {
    const api = recordApi(contractRow(), [person("u1", "creator")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    // The breadcrumb, the reference, and the archive action are chrome:
    // they belong to the record, not to one of its sections.
    expect(
      await screen.findByRole("heading", { level: 1, name: /Acme master services agreement/ }),
    ).toBeInTheDocument();
    // Scoped to the sub-bar: the top nav carries a "Contracts" link of
    // its own, and this is about the breadcrumb.
    const subbar = within(screen.getByRole("region", { name: /Acme master services agreement/ }));
    expect(subbar.getByRole("link", { name: "Contracts" })).toBeInTheDocument();
    expect(subbar.getByText("C-42")).toBeInTheDocument();
    expect(subbar.getByRole("button", { name: "Contract actions" })).toBeInTheDocument();
    // The roster lives in the activity bar beside all sections, so the
    // DES-028 banner's "Manage team" fragment resolves from any of them.
    const team = await openTeam(user);
    expect(within(team).getByText("Ada Admin")).toBeInTheDocument();
  });

  it("lands a section the record does not have on the Overview", async () => {
    const api = recordApi(contractRow());
    stubApi({ signedIn: MEMBER, extra: api.handler });
    const { router } = renderAt("/contracts/42/clauses");

    expect(await screen.findByLabelText("Title")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/contracts/42");
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

  it("lets a Contributor edit business-owned details while legal-managed context stays read-only", async () => {
    const api = contributorApi(
      contractRow(),
      [person("u1", "creator"), person("u3", "contributor")],
      [party("cp-helix", true), party("cp-orion", false)],
    );
    stubApi({ signedIn: CONTRIBUTOR, extra: api.handler });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    // The record reads: the title, the status, the parties, the team.
    expect(
      await screen.findByRole("heading", { level: 1, name: /Acme master services agreement/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Helix Labs GmbH")).toBeInTheDocument();
    const team = await openTeam(user);
    expect(within(team).getByText("Casey Contributor")).toBeInTheDocument();
    expect(screen.getByText(/Legal-managed details are read-only/)).toBeInTheDocument();

    // Legal-managed context is inert, while DD-015's value and
    // effective-date inputs remain live.
    for (const label of [
      "Title",
      "Contract type",
      "Owner",
      "Our entity",
      "Priority",
      "Risk",
      "Description",
    ]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    for (const label of ["Amount", "Currency", "Cadence", "Effective date"]) {
      expect(screen.getByLabelText(label)).toBeEnabled();
    }
    await user.type(screen.getByLabelText("Amount"), "1200");
    await user.selectOptions(screen.getByLabelText("Currency"), "USD");
    await user.selectOptions(screen.getByLabelText("Cadence"), "annually");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("combobox", { name: "Counterparties" })).toBeDisabled();
    // The API projection supplies only the business-tagged attachment;
    // that Field remains editable behind its own tab.
    await user.click(screen.getByRole("link", { name: "Fields" }));
    const terms = await screen.findByLabelText("Payment terms");
    expect(terms).toBeEnabled();
    await user.type(terms, "Net 45");
    await user.tab();

    // Archive, restore, and rename are record-level mutations a
    // Contributor never gets, so the menu drops those rows rather than
    // drawing them permanently disabled. It keeps the one row that
    // changes nothing (DES-055 clause 2).
    expect(await recordActions(userEvent.setup())).toEqual(["Copy link"]);
    await userEvent.setup().keyboard("{Escape}");
    // The team and party controls freeze the way an archived record
    // freezes them — inert where they stand, gone where the archived
    // record drops them.
    expect(within(team).getByRole("button", { name: "Add team member" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Make primary" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Take Helix Labs GmbH off the contract/ }),
    ).not.toBeInTheDocument();
    expect(
      within(team).queryByRole("button", { name: /Take Casey Contributor off the team/ }),
    ).not.toBeInTheDocument();

    await waitFor(() =>
      expect(api.patches).toEqual([
        { value: { amount: 120_000, currency: "USD", cadence: "annually" } },
        { customFields: { payment_terms: "Net 45" } },
      ]),
    );
    expect(api.posts).toEqual([]);
    expect(api.pickerReads).toEqual([]);
  });

  it("still names the type, status, and Owner the record holds, with no picker list to read them from", async () => {
    const api = contributorApi(
      contractRow({
        manager: person("u2"),
        statusId: "s-redlining",
        statusName: "With counterparty",
      }),
    );
    stubApi({ signedIn: CONTRIBUTOR, extra: api.handler });
    renderAt("/contracts/42");

    // The selects are inert, so what they show is all the record says.
    // Each one names what is stored, not a blank — the row carries the
    // names, so no options read is needed to draw them.
    expect(await screen.findByLabelText("Contract type")).toHaveDisplayValue("MSA");
    expect(screen.getByLabelText("Owner")).toHaveDisplayValue("Nadia Counsel");
    // The status has no control at all for this viewer (DES-053): the
    // sub-bar pill names it, and the strip is the reading it always
    // was — no trigger to press and none disabled to work out.
    const subbar = screen.getByRole("region", { name: "Acme master services agreement" });
    const pipeline = within(subbar).getByRole("list", { name: "Stage" });
    expect(
      within(subbar)
        .getAllByText("With counterparty")
        .filter((node) => !pipeline.contains(node)),
    ).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /move contract$/ })).not.toBeInTheDocument();
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
    expect(await recordActions(userEvent.setup())).toEqual(["Copy link"]);
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
    visibility: Comment["visibility"],
    author = AUTHOR,
    createdAt = "2026-08-12T09:00:00.000Z",
    mentions: { id: string; displayName: string }[] = [],
    /** M9/4's three states: edited, and removed by either hand. A plain
     * comment is none of them. */
    marks: { editedAt?: string; deletedAt?: string; redactedAt?: string } = {},
  ): Comment {
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
    filingFailure?: string,
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
    /** CMT-011 filing bodies, in the order the attachment route saw them. */
    const filings: unknown[] = [];

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
      const filing = /^\/api\/v1\/comments\/([^/]+)\/attachments\/([^/]+)\/file$/.exec(
        call.url.pathname,
      );
      if (filing && call.method === "POST") {
        const row = thread.find((comment) => comment.id === filing[1]);
        const attachment = row?.attachments?.find((paper) => paper.id === filing[2]);
        if (!row || !attachment) return problem(404, "No comment attachment exists with this id.");
        if (attachment.filed) return problem(409, "This attachment was already filed.");
        if (filingFailure) return problem(409, filingFailure);
        const body = call.body as {
          destination: "new_document" | "new_version";
          name?: string;
          documentId?: string;
        };
        filings.push(body);
        const updated = {
          ...row,
          attachments: row.attachments?.map((paper) =>
            paper.id === attachment.id
              ? {
                  ...paper,
                  filed: {
                    documentId: body.documentId ?? "doc-filed",
                    documentTitle: body.name ?? "Orion MSA",
                    versionId: "ver-filed",
                    versionNumber: body.destination === "new_version" ? 2 : 1,
                  },
                }
              : paper,
          ),
        };
        return replace(updated);
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
        const form = call.body instanceof FormData ? call.body : null;
        const body = (
          form
            ? {
                body: String(form.get("body")),
                visibility: String(form.get("visibility")),
                mentions: form.has("mentions")
                  ? (JSON.parse(String(form.get("mentions"))) as string[])
                  : [],
              }
            : call.body
        ) as {
          body: string;
          visibility: string;
          mentions?: string[];
        };
        const posted = {
          ...comment(
            `c-new-${thread.length}`,
            body.body,
            body.visibility as Comment["visibility"],
            AUTHOR,
            "2026-08-12T12:00:00.000Z",
            (body.mentions ?? []).map((id) => ({
              id,
              displayName: candidates.find((person) => person.id === id)!.displayName,
            })),
          ),
          ...(form
            ? {
                attachments: (form.getAll("file") as File[]).map((file, index) => ({
                  id: `a-new-${index}`,
                  filename: file.name,
                })),
              }
            : {}),
        };
        thread = [...thread, posted];
        return json(201, { comment: posted });
      }
      return undefined;
    };
    return { handler, posts, reads, corrections, marksRead, filings };
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
    finishAppletSlide(panel);
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

  it("shows attachment rows and posts removable chosen files from the applet", async () => {
    const user = userEvent.setup();
    const comments = commentsApi([
      {
        ...comment("c-paper", "Counterparty markup.", "working_team"),
        attachments: [{ id: "a-paper", filename: "counterparty markup.pdf" }],
      },
    ]);
    stubApi({ signedIn: MEMBER, extra: pageApi(comments) });
    renderAt("/contracts/42");
    await openChat(user);

    expect(await screen.findByRole("link", { name: "counterparty markup.pdf" })).toHaveAttribute(
      "href",
      "/api/v1/comments/c-paper/attachments/a-paper?entityType=contract&entityId=c1",
    );
    const panel = screen.getByRole("complementary", { name: "Comments" });
    const input = within(panel).getByLabelText("Choose files for this comment");
    await user.upload(input, [
      new File(["one"], "round-one.pdf"),
      new File(["two"], "round-two.pdf"),
    ]);
    const chosen = within(panel).getByRole("list", {
      name: "Files attached to this comment",
    });
    await user.click(within(chosen).getByRole("button", { name: "Remove round-one.pdf" }));
    await user.type(within(panel).getByLabelText("New comment"), "Our response.");
    await user.click(within(panel).getByRole("button", { name: "Comment" }));

    await waitFor(() => expect(comments.posts).toHaveLength(1));
    const form = comments.posts[0] as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("entityType")).toBe("contract");
    expect(form.get("entityId")).toBe("c1");
    expect((form.getAll("file") as File[]).map((file) => file.name)).toEqual(["round-two.pdf"]);
    expect(await within(panel).findByRole("link", { name: "round-two.pdf" })).toBeInTheDocument();
    expect(
      within(panel).queryByRole("list", { name: "Files attached to this comment" }),
    ).toBeNull();
  });

  it("keeps the draft and shows the generic refusal for a non-JSON upload 413", async () => {
    const user = userEvent.setup();
    const comments = commentsApi();
    const record = recordApi(contractRow());
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/comments" && call.method === "POST"
          ? new Response("Payload Too Large", {
              status: 413,
              headers: { "content-type": "text/plain" },
            })
          : (comments.handler(call) ?? record.handler(call)),
    });
    renderAt("/contracts/42");
    await openChat(user);

    const panel = await screen.findByRole("complementary", { name: "Comments" });
    await user.upload(
      within(panel).getByLabelText("Choose files for this comment"),
      new File(["paper"], "large.pdf"),
    );
    await user.type(within(panel).getByLabelText("New comment"), "Keep this draft.");
    await user.click(within(panel).getByRole("button", { name: "Comment" }));

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "The comment could not be posted. Try again.",
    );
    expect(within(panel).getByLabelText("New comment")).toHaveValue("Keep this draft.");
    expect(within(panel).getByText("large.pdf")).toBeInTheDocument();
  });

  it("files a Legal Only attachment as a new Document with Confidential proposed on", async () => {
    const user = userEvent.setup();
    const comments = commentsApi([
      {
        ...comment("c-file", "First paper.", "legal_only"),
        attachments: [{ id: "a-file", filename: "first-draft.pdf" }],
      },
    ]);
    stubApi({ signedIn: MEMBER, extra: pageApi(comments) });
    renderAt("/contracts/42");
    await openChat(user);

    const panel = await screen.findByRole("complementary", { name: "Comments" });
    await user.click(within(panel).getByRole("button", { name: "File" }));
    const dialog = await screen.findByRole("dialog", { name: "File attachment" });
    expect(within(dialog).getByLabelText("Document name")).toHaveValue("first-draft.pdf");
    const confidential = within(dialog).getByRole("switch", {
      name: "Confidential — restrict to the contract team",
    });
    expect(confidential).toBeChecked();
    // The proposal is not a mandate: this filer clears it before filing.
    await user.click(confidential);
    await user.selectOptions(within(dialog).getByLabelText("Kind"), "draft_theirs");
    await user.clear(within(dialog).getByLabelText("Document name"));
    await user.type(within(dialog).getByLabelText("Document name"), "Counterparty paper");
    await user.click(within(dialog).getByRole("button", { name: "File" }));

    await waitFor(() => {
      expect(comments.filings).toEqual([
        {
          destination: "new_document",
          kind: "draft_theirs",
          name: "Counterparty paper",
          isConfidential: false,
        },
      ]);
    });
    expect(
      await within(panel).findByRole("link", {
        name: "Counterparty paper, version 1",
      }),
    ).toHaveAttribute("href", "/contracts/42/documents");
    expect(within(panel).queryByRole("button", { name: "File" })).not.toBeInTheDocument();
  });

  it("files another attachment as a new Version and proposes Confidential off outside Legal Only", async () => {
    const user = userEvent.setup();
    const comments = commentsApi([
      {
        ...comment("c-version", "Our markup.", "working_team"),
        attachments: [{ id: "a-version", filename: "our-counter.docx" }],
      },
    ]);
    const existing = {
      id: "doc-existing",
      title: "Orion MSA",
      description: null,
      isPrimary: true,
      versions: [],
      archivedAt: null,
      isConfidential: false,
      folderId: null,
      createdBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
      createdAt: "2026-08-11T09:00:00.000Z",
      updatedAt: "2026-08-11T09:00:00.000Z",
    };
    const record = recordApi(contractRow());
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) =>
        comments.handler(call) ??
        (call.url.pathname === "/api/v1/contracts/42/documents" && call.method === "GET"
          ? json(200, { documents: [existing], nextCursor: null })
          : record.handler(call)),
    });
    renderAt("/contracts/42");
    await openChat(user);

    const panel = await screen.findByRole("complementary", { name: "Comments" });
    await user.click(within(panel).getByRole("button", { name: "File" }));
    const dialog = await screen.findByRole("dialog", { name: "File attachment" });
    expect(
      within(dialog).getByRole("switch", {
        name: "Confidential — restrict to the contract team",
      }),
    ).not.toBeChecked();
    await user.selectOptions(within(dialog).getByLabelText("Destination"), "new_version");
    expect(within(dialog).getByLabelText("Document")).toHaveValue("doc-existing");
    await user.selectOptions(within(dialog).getByLabelText("Kind"), "redline_ours");
    await user.type(within(dialog).getByLabelText("Note"), "Held the liability cap.");
    await user.click(within(dialog).getByRole("button", { name: "File" }));

    await waitFor(() => {
      expect(comments.filings).toEqual([
        {
          destination: "new_version",
          documentId: "doc-existing",
          kind: "redline_ours",
          note: "Held the liability cap.",
        },
      ]);
    });
    expect(await within(panel).findByRole("link", { name: "Orion MSA, version 2" })).toBeVisible();
  });

  it("refuses a filing list whose cursor does not advance", async () => {
    const user = userEvent.setup();
    const comments = commentsApi([
      {
        ...comment("c-loop", "Paper to file.", "working_team"),
        attachments: [{ id: "a-loop", filename: "loop.pdf" }],
      },
    ]);
    const record = recordApi(contractRow());
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        comments.handler(call) ??
        (call.url.pathname === "/api/v1/contracts/42/documents" && call.method === "GET"
          ? json(200, { documents: [], nextCursor: "same-cursor" })
          : record.handler(call)),
    });
    renderAt("/contracts/42");
    await openChat(user);
    const panel = await screen.findByRole("complementary", { name: "Comments" });
    await user.click(within(panel).getByRole("button", { name: "File" }));

    const dialog = await screen.findByRole("dialog", { name: "File attachment" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The Documents could not be loaded. Try again.",
    );
    expect(within(dialog).getByRole("option", { name: /New Version/ })).toBeDisabled();
  });

  it("keeps a filing refusal in the dialog", async () => {
    const user = userEvent.setup();
    const row = {
      ...comment("c-refused", "Cannot file this.", "working_team"),
      attachments: [{ id: "a-refused", filename: "refused.pdf" }],
    };
    const refused = commentsApi(
      [row],
      CANDIDATES,
      0,
      "This attachment was already filed to Orion MSA, version 2.",
    );
    stubApi({ signedIn: MEMBER, extra: pageApi(refused) });
    renderAt("/contracts/42");
    await openChat(user);
    const memberPanel = await screen.findByRole("complementary", { name: "Comments" });
    await user.click(within(memberPanel).getByRole("button", { name: "File" }));
    const dialog = await screen.findByRole("dialog", { name: "File attachment" });
    await user.click(within(dialog).getByRole("button", { name: "File" }));
    expect(
      await within(dialog).findByText("This attachment was already filed to Orion MSA, version 2."),
    ).toBeVisible();
  });

  it("shows the filed marker but no File action to a Contributor", async () => {
    const user = userEvent.setup();
    const comments = commentsApi([
      {
        ...comment("c-filed", "The filed round.", "working_team"),
        attachments: [
          {
            id: "a-filed",
            filename: "round.pdf",
            filed: {
              documentId: "doc-round",
              documentTitle: "Negotiation",
              versionId: "ver-round",
              versionNumber: 2,
            },
          },
        ],
      },
    ]);
    const record = recordApi(contractRow(), [person("u1", "creator"), person("u3", "contributor")]);
    stubApi({
      signedIn: CONTRIBUTOR,
      extra: (call: StubCall) => comments.handler(call) ?? record.handler(call),
    });
    renderAt("/contracts/42");
    await openChat(user);
    const panel = await screen.findByRole("complementary", { name: "Comments" });
    expect(within(panel).queryByRole("button", { name: "File" })).not.toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Negotiation, version 2" })).toBeVisible();
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
    finishAppletSlide(panel);
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

  it("narrates folder work by name, and says where the record root is (M13/2)", async () => {
    const user = userEvent.setup();
    const activity = activityApi([
      [
        entry("a5", "folder.deleted", { folderId: "f-2", name: "Correspondence" }),
        entry("a4", "folder.moved", { folderId: "f-2", name: "Correspondence", parentName: null }),
        entry("a3", "folder.moved", {
          folderId: "f-2",
          name: "Correspondence",
          parentName: "Amendments",
        }),
        entry("a2", "folder.renamed", {
          folderId: "f-2",
          name: "Correspondence",
          previousName: "Corespondence",
        }),
        entry("a1", "folder.created", { folderId: "f-1", name: "Amendments", parentName: null }),
      ],
    ]);
    stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    const feed = await screen.findByRole("list", { name: "History" });
    expect(
      within(feed)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      // "Deleted" says what it means here: nothing was destroyed.
      expect.stringContaining("Nadia Counsel deleted the Correspondence folder and kept what"),
      expect.stringContaining("Nadia Counsel moved the Correspondence folder onto the contract"),
      expect.stringContaining("Nadia Counsel moved the Correspondence folder into Amendments"),
      // The old name is in the payload, so the entry outlives the
      // rename it records.
      expect.stringContaining("Nadia Counsel renamed the Corespondence folder to Correspondence"),
      expect.stringContaining("Nadia Counsel made the Amendments folder"),
    ]);
  });

  it("narrates a folder actually named none as a destination, not as the record root", async () => {
    const user = userEvent.setup();
    const activity = activityApi([
      [entry("a1", "folder.created", { folderId: "f-1", name: "2026", parentName: "none" })],
    ]);
    stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    // Where a folder went is its own fact, not a sentinel hidden in the
    // parent's name — a folder really can be called "none".
    const feed = await screen.findByRole("list", { name: "History" });
    expect(within(feed).getAllByRole("listitem")[0]).toHaveTextContent(
      "Nadia Counsel made the 2026 folder in none",
    );
  });

  it("shows the old and the new value of a field edit, formatted as the record formats them", async () => {
    const user = userEvent.setup();
    const activity = activityApi([
      [
        entry("a3", "contract.updated", {
          actorRole: "contributor",
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
    expect(value).toHaveTextContent("Nadia Counsel (Contributor) changed Value");
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

  it("narrates a soft-gate override beside its status change, naming who it went past", async () => {
    const user = userEvent.setup();
    const activity = activityApi([
      [
        entry("a2", "contract.stage_gate_overridden", {
          fromStage: "approval",
          toStage: "signature",
          approvers: [
            { approverId: "u4", approverName: "Sarah Chen", status: "pending" },
            { approverId: "u5", approverName: "Marcus Webb", status: "rejected" },
          ],
        }),
        entry("a1", "contract.status_changed", {
          from: "Awaiting approval",
          to: "Out for signature",
          fromStage: "approval",
          toStage: "signature",
        }),
      ],
    ]);
    stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    const feed = await screen.findByRole("list", { name: "History" });
    const [override, status] = within(feed).getAllByRole("listitem");
    // CTR-012: the whole reason the gate may be pushed past is that the
    // push is recorded — and it names the people it went past, because
    // "an override happened" is not something a reader can act on.
    expect(override).toHaveTextContent(
      "Nadia Counsel moved this contract past approval, overriding Sarah Chen and Marcus Webb",
    );
    // Two entries from one commit: the contract moved, and somebody
    // moved it past open sign-off.
    expect(status).toHaveTextContent("Nadia Counsel changed the status");
  });

  it("narrates an override whose payload names nobody as the override it was", async () => {
    const user = userEvent.setup();
    const activity = activityApi([[entry("a1", "contract.stage_gate_overridden", {})]]);
    stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    // The log is append-only, so an entry a later build cannot fully
    // read still has to come out as a sentence.
    const feed = await screen.findByRole("list", { name: "History" });
    expect(within(feed).getAllByRole("listitem")[0]).toHaveTextContent(
      "Nadia Counsel moved this contract past approval, overriding the soft gate",
    );
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

  it("appends a live entry without replacing pages the reader already loaded", async () => {
    const user = userEvent.setup();
    const sources = stubEventSource();
    const pages = [
      [entry("a3", "contract.updated"), entry("a2", "contract.archived")],
      [entry("a1", "contract.created")],
    ];
    const activity = activityApi(pages);
    stubApi({ signedIn: MEMBER, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    const panel = await screen.findByRole("complementary", { name: "History" });
    const feed = within(panel).getByRole("list", { name: "History" });
    await user.click(within(panel).getByRole("button", { name: "Show older" }));
    await waitFor(() => expect(within(feed).getAllByRole("listitem")).toHaveLength(3));

    pages[0] = [entry("a4", "contract.restored"), entry("a3", "contract.updated")];
    sources[0]!.emit({
      kind: "record",
      action: "contract.restored",
      entityType: "contract",
      entityId: "c1",
      entryId: "a4",
      visibility: "working_team",
    });

    await waitFor(() => expect(within(feed).getAllByRole("listitem")).toHaveLength(4));
    expect(
      within(feed)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining("restored this contract"),
      expect.stringContaining("changed this contract"),
      expect.stringContaining("archived this contract"),
      expect.stringContaining("created this contract"),
    ]);
    expect(activity.cursors).toEqual([null, "a2", null]);
    expect(within(panel).queryByRole("button", { name: "Show older" })).not.toBeInTheDocument();
    expect(sources[0]?.url).toBe("/api/events?entityType=contract&entityId=c1");
  });

  it("keeps the newest live answer when record prompts overlap", async () => {
    const user = userEvent.setup();
    const sources = stubEventSource();
    let activityReads = 0;
    let resolveEarlier!: (response: Response) => void;
    let resolveLater!: (response: Response) => void;
    const earlier = new Promise<Response>((resolve) => {
      resolveEarlier = resolve;
    });
    const later = new Promise<Response>((resolve) => {
      resolveLater = resolve;
    });
    const record = recordApi(contractRow());
    const handler = (call: StubCall): StubAnswer => {
      if (call.url.pathname !== "/api/v1/activity" || call.method !== "GET") {
        return record.handler(call);
      }
      activityReads += 1;
      if (activityReads === 1) {
        return json(200, { entries: [entry("a1", "contract.created")], nextCursor: null });
      }
      return activityReads === 2 ? earlier : later;
    };
    stubApi({ signedIn: MEMBER, extra: handler });
    renderAt("/contracts/42");
    await openHistory(user);

    const panel = await screen.findByRole("complementary", { name: "History" });
    const feed = within(panel).getByRole("list", { name: "History" });
    await within(feed).findByText(/created this contract/);

    sources[0]!.emit({
      kind: "record",
      action: "contract.archived",
      entityType: "contract",
      entityId: "c1",
      entryId: "a2",
      visibility: "working_team",
    });
    await waitFor(() => expect(activityReads).toBe(2));
    sources[0]!.emit({
      kind: "record",
      action: "contract.restored",
      entityType: "contract",
      entityId: "c1",
      entryId: "a3",
      visibility: "working_team",
    });
    await waitFor(() => expect(activityReads).toBe(3));

    resolveLater(
      json(200, {
        entries: [entry("a3", "contract.restored"), entry("a1", "contract.created")],
        nextCursor: null,
      }),
    );
    await within(feed).findByText(/restored this contract/);

    resolveEarlier(
      json(200, {
        entries: [entry("a2", "contract.archived"), entry("a1", "contract.created")],
        nextCursor: null,
      }),
    );
    await act(async () => earlier);

    expect(within(feed).queryByText(/archived this contract/)).not.toBeInTheDocument();
    expect(within(feed).getAllByRole("listitem")).toHaveLength(2);
  });

  it("re-asks the visible newest page on reconnect and leaves a filtered entry invisible", async () => {
    const user = userEvent.setup();
    const sources = stubEventSource();
    const pages = [[entry("a1", "contract.created")]];
    const activity = activityApi(pages);
    stubApi({ signedIn: CONTRIBUTOR, extra: pageApi(activity) });
    renderAt("/contracts/42");
    await openHistory(user);

    const panel = await screen.findByRole("complementary", { name: "History" });
    const feed = within(panel).getByRole("list", { name: "History" });
    expect(within(feed).getAllByRole("listitem")).toHaveLength(1);

    sources[0]!.emit({
      kind: "record",
      action: "comment.posted",
      entityType: "contract",
      entityId: "c1",
      entryId: "hidden-entry",
      visibility: "legal_only",
    });
    await waitFor(() => expect(activity.cursors).toHaveLength(2));
    expect(within(feed).getAllByRole("listitem")).toHaveLength(1);

    sources[0]!.open();
    await waitFor(() => expect(activity.cursors).toHaveLength(3));
    expect(within(feed).getAllByRole("listitem")).toHaveLength(1);
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
  afterEach(() => {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  });

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
    expect(strip).toHaveClass("h-(--height-record-banner)");
    // Chrome, not a notification: nothing in it dismisses it.
    expect(within(strip).queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers Manage team to an Administrator, and lands it on the Team applet", async () => {
    // The roster names somebody else as creator and there is no Owner,
    // so the role is the only thing that qualifies this viewer — the
    // default roster's creator is u1, which would let this pass on the
    // creator clause alone.
    stubApi({
      signedIn: ADMIN,
      extra: recordApi(contractRow({ isConfidential: true }), [person("u2", "creator")]).handler,
    });
    renderAt("/contracts/42");
    const user = userEvent.setup();

    const strip = await screen.findByRole("region", { name: BANNER });
    const manage = within(strip).getByRole("link", { name: "Manage team" });
    expect(manage).toHaveAttribute("href", "#contract-team");
    // The link stays on the banner's own foreground. The base layer
    // colours every `<a>` with the link token, and the link token on
    // `confidential-bg` is 4.34:1 — under the 4.5 floor the contrast
    // lint holds the banner's own pair to.
    expect(manage).toHaveClass("text-confidential");
    await user.click(manage);
    const team = await screen.findByRole("complementary", { name: "Team" });
    expect(team).toHaveAttribute("id", "contract-team");
    expect(team).toHaveFocus();
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
    const user = userEvent.setup();

    const team = await openTeam(user);
    // Inert, not absent: who is on the contract is a fact, and only the
    // deciding is withheld.
    expect(within(team).getByRole("button", { name: "Add team member" })).toBeDisabled();
    expect(
      within(team).getByRole("button", { name: "Take Casey Contributor off the team as Member" }),
    ).toBeDisabled();
    // The roster still reads.
    expect(within(team).getByText("Casey Contributor")).toBeVisible();
  });

  it("leaves the Team applet live for an actor, and live on an open record for anybody", async () => {
    // The creator, on the same walled record.
    const asActor = recordApi(contractRow({ isConfidential: true }), [
      person("u2", "creator"),
      person("u3", "member"),
    ]);
    stubApi({ signedIn: MEMBER, extra: asActor.handler });
    const walled = renderAt("/contracts/42");
    const actorUser = userEvent.setup();
    const team = await openTeam(actorUser);
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
    const openUser = userEvent.setup();
    const open = await openTeam(openUser);
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
    /** DOC-004's family, routed by the server (M12/2). Word reads in
     * the app from M12/4, converted for display — so the row's name is
     * a button that opens the panel, not a download link. */
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
    /** Filed nowhere, which is the record root (DOC-006, M13/3). */
    folderId: null,
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
      // A version-kind correction changes one field on one round and
      // answers the document with the chain in the same order.
      const corrected = /^\/api\/v1\/documents\/([^/]+)\/versions\/([^/]+)$/.exec(pathname);
      if (corrected && call.method === "PATCH") {
        writes.push({ url: pathname, body: call.body });
        const target = current.find((row) => row.id === corrected[1]);
        if (!target) return problem(404, "No document exists with this reference.");
        const next = {
          ...target,
          versions: (target.versions as Record<string, unknown>[]).map((row) =>
            row.id === corrected[2] ? { ...row, kind: (call.body as { kind: string }).kind } : row,
          ),
        };
        current = current.map((row) => (row === target ? next : row));
        return json(200, { document: next });
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
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    expect(within(section).getByRole("heading", { level: 2, name: "Documents" })).toBeVisible();
    // The count is what the list holds — the API leaves out what this
    // viewer may not see, so it can never announce an omission.
    expect(countBadge(section, "2 documents")).toBeVisible();
    expect(within(section).getAllByRole("row")).toHaveLength(3); // header + two
  });

  it("names each document, marks the version that matters now, and opens the name", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([DRAFT]).handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    // A Word draft reads in the app (DOC-004, M12/4), so its name is a
    // button that opens the panel rather than the download link it was
    // in M11. What the panel then draws — a converted PDF, a preparing
    // state, or an honest card — is the doc-panel suite's subject.
    expect(
      within(section).getByRole("button", { name: "Orion_MSA_2026_draft.docx" }),
    ).toBeVisible();
    // The kind, the number, and when it landed. No "Current" mark: this
    // is the head row, which is current by construction (lib/documents.ts
    // `chainOf`) — the mark would only repeat what the row's own
    // position already says.
    expect(within(section).getByText("Draft · ours")).toBeVisible();
    expect(within(section).getByText("v1")).toBeVisible();
  });

  it("names the counterparty's own first draft as a draft, not a redline (#326)", async () => {
    // CTR-014's sixth kind. Before it, this round had to wear
    // `redline_theirs`, which claims a markup of a round that does not
    // exist yet, or `draft_ours`, which names the wrong author.
    const theirDraft = {
      ...DRAFT,
      id: "doc-6",
      title: "Orion_MSA_2026_their_paper.docx",
      versions: [
        version({
          id: "ver-6",
          kind: "draft_theirs",
          originalFilename: "Orion_MSA_2026_their_paper.docx",
        }),
      ],
    };
    stubApi({ signedIn: MEMBER, extra: documentsApi([theirDraft]).handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    expect(
      within(section).getByRole("combobox", {
        name: "Kind of version 1 of Orion_MSA_2026_their_paper.docx",
      }),
    ).toHaveValue("draft_theirs");
  });

  it("lets Member+ correct a version kind from the pill", async () => {
    const api = documentsApi([CHAIN]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    const picker = within(section).getByRole("combobox", {
      name: "Kind of version 3 of Orion Cloud — master services agreement",
    });
    expect(
      within(picker)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Draft · ours",
      "Draft · theirs",
      "Redline · theirs",
      "Redline · ours",
      "Amendment",
      "Executed",
    ]);

    await user.selectOptions(picker, "executed");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toEqual({
      url: "/api/v1/documents/doc-3/versions/ver-c",
      body: { kind: "executed" },
    });
    await waitFor(() => expect(picker).toHaveValue("executed"));
  });

  it("shows a generated redline but never offers a picker for it", async () => {
    const generated = {
      ...DRAFT,
      versions: [version({ kind: "generated_redline" })],
    };
    stubApi({ signedIn: MEMBER, extra: documentsApi([generated]).handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    expect(within(section).getByText("Generated redline")).toBeVisible();
    expect(within(section).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("says so plainly when the record has no paper on it", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([]).handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    expect(within(section).getByText("No documents on this contract yet.")).toBeVisible();
    expect(countBadge(section, "0 documents")).toBeVisible();
  });

  it("shows the current version first and opens the rounds it supersedes", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([CHAIN]).handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    // Collapsed, the section answers "which file matters now" and
    // nothing else: the current round, under the document's own name.
    expect(within(section).getAllByRole("row")).toHaveLength(2); // header + current
    expect(within(section).getByText("v3")).toBeVisible();
    expect(within(section).getByText("The main instrument. Clause 8 was the fight.")).toBeVisible();
    expect(within(section).getByText("Held the indemnity.")).toBeVisible();

    const toggle = within(section).getByRole("button", {
      name: /Show the 2 earlier versions of Orion Cloud/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    // The whole chain, newest of the superseded rounds first, each of
    // them openable — a superseded version is not a hidden one.
    expect(within(section).getAllByRole("row")).toHaveLength(4);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(section).getByRole("button", { name: "round_2.docx" })).toBeVisible();
    expect(within(section).getByText("Their first pass. Clause 8 is the fight.")).toBeVisible();
    expect(within(section).getByRole("button", { name: "round_1.docx" })).toBeVisible();
    // Ordered newest first under the current round.
    const rows = within(section).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByText(/^v\d+$/).textContent)).toEqual([
      "v3",
      "v2",
      "v1",
    ]);
  });

  it("draws no disclosure for a document with one version", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([DRAFT]).handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    expect(
      within(section).queryByRole("button", { name: /earlier version/ }),
    ).not.toBeInTheDocument();
  });

  it("uploads through the composer, sending the kind and the note with the file", async () => {
    const api = documentsApi([DRAFT]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
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
      await within(section).findByRole("button", { name: "counter_redline.docx" }),
    ).toBeInTheDocument();
    expect(countBadge(section, "2 documents")).toBeVisible();
  });

  it("offers the six kinds in the order a negotiation walks them (#326)", async () => {
    // The order is a decision, not an accident: the two drafts are the
    // two ways a negotiation can open, so `draft_theirs` sits beside
    // `draft_ours` rather than beside the redlines it is not one of.
    stubApi({ signedIn: MEMBER, extra: documentsApi([DRAFT]).handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    const dialog = await compose(user, section, "Upload");

    const kind = within(dialog).getByLabelText("Kind");
    expect([...within(kind).getAllByRole("option")].map((option) => option.textContent)).toEqual([
      "Draft · ours",
      "Draft · theirs",
      "Redline · theirs",
      "Redline · ours",
      "Amendment",
      "Executed",
    ]);
  });

  it("refuses to send a composer with no file on it", async () => {
    const api = documentsApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    const dialog = await compose(user, section, "Upload");
    await user.click(within(dialog).getByRole("button", { name: "Upload" }));

    expect(await within(dialog).findByText("Choose a file to upload.")).toBeVisible();
    expect(api.writes).toEqual([]);
    // The refusal is about the File field, and the control a keyboard
    // reaches on that field is this button — so the refusal is reachable
    // from it rather than only findable by sight.
    const choose = within(dialog).getByRole("button", { name: "File Choose files" });
    expect(choose).toHaveAccessibleDescription("Choose a file to upload.");
  });

  it("appends the next version to a document from its own row", async () => {
    const api = documentsApi([DRAFT]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
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
    // The record reads as renamed, and the file's own name is untouched
    // — a rename changes what the record calls the document, never what
    // the stored file is called.
    expect(await within(section).findByRole("button", { name: "Orion Cloud — MSA" })).toBeVisible();
    expect(within(section).getByText("The main instrument.")).toBeVisible();
  });

  it("refuses to send a rename with no name in it", async () => {
    const api = documentsApi([DRAFT]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(
      within(section).getByRole("button", { name: /Show the 2 earlier versions of/ }),
    );
    // The signed copy is often not the last round: this contract was
    // signed in round two and redlined again in round three. A
    // superseded round's pin lives in its own row's menu (CTR-014).
    await user.click(
      within(section).getByRole("button", {
        name: "Actions for version 2 of Orion Cloud — master services agreement",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Mark as executed copy" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toEqual({
      url: "/api/v1/documents/doc-3/executed-version:POST",
      body: { versionId: "ver-b" },
    });
    expect(await within(section).findByText("Executed", { selector: "span" })).toBeVisible();

    // The same menu, and the item's own label carries the direction
    // now — "Unmark" once the round is pinned.
    await user.click(
      within(section).getByRole("button", {
        name: "Actions for version 2 of Orion Cloud — master services agreement",
      }),
    );
    await waitFor(async () =>
      expect(
        await screen.findByRole("menuitem", { name: "Unmark as executed copy" }),
      ).toBeVisible(),
    );
    await user.click(screen.getByRole("menuitem", { name: "Unmark as executed copy" }));

    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[1]!.url).toBe("/api/v1/documents/doc-3/executed-version:DELETE");
    // Every round is still there: the pin is one column on the
    // document, and clearing it takes nothing else with it.
    await waitFor(() =>
      expect(within(section).queryByText("Executed", { selector: "span" })).not.toBeInTheDocument(),
    );
    expect(within(section).getByRole("button", { name: "round_2.docx" })).toBeInTheDocument();
  });

  it("never reads the pin off a round's kind", async () => {
    const signed = {
      ...DRAFT,
      id: "doc-signed",
      title: "Orion_MSA_2026_signed.pdf",
      versions: [version({ id: "ver-signed", kind: "executed" })],
    };
    stubApi({ signedIn: MEMBER, extra: documentsApi([signed]).handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    // The kind is what the uploader called this round; the pin is what
    // the team decided, and nobody has decided yet. One "Executed" on
    // the row — the kind pill — and the menu still offers to mark it,
    // not unmark it.
    expect(within(section).getAllByText("Executed")).toHaveLength(1);
    expect(await menuVerbs(user, section, "Orion_MSA_2026_signed.pdf")).toContain(
      "Mark as executed copy",
    );
  });

  it("reports the seam's own refusal when a designation is turned down", async () => {
    const api = documentsApi([DRAFT, THEIRS], {
      designationFails: "That document is already the contract's primary document.",
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
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

  it("offers a Contributor only supporting upload actions", async () => {
    const api = documentsApi([DRAFT, THEIRS], {}, [
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
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(within(section).getByRole("button", { name: "Upload" }));
    const upload = await screen.findByRole("dialog");
    expect(within(upload).queryByRole("button", { name: "File Choose folder" })).toBeNull();
    await user.click(within(upload).getByRole("button", { name: "Cancel" }));
    // The primary chain has no write at all. The reached supporting
    // chain offers the one act DD-015 allows and no administration.
    expect(
      within(section).queryByRole("button", {
        name: "Actions for Orion_MSA_2026_draft.docx",
      }),
    ).not.toBeInTheDocument();
    expect(await menuVerbs(user, section, "Orion_MSA_2026_redline_orion.docx")).toEqual([
      "Add version",
    ]);
    await user.keyboard("{Escape}");
    expect(within(section).queryByRole("button", { name: "New folder" })).not.toBeInTheDocument();
    expect(within(section).queryByRole("combobox")).not.toBeInTheDocument();
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
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    expect(within(section).queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
    expect(within(section).queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
    expect(within(section).queryByRole("switch")).not.toBeInTheDocument();
    // Reading it is not editing it: the file opens and the marks stay.
    expect(
      within(section).getByRole("button", { name: "Orion_MSA_2026_draft.docx" }),
    ).toBeInTheDocument();
    expect(within(section).getByText("Primary")).toBeVisible();
  });

  it("archives a document off the list and out of the count", async () => {
    const api = documentsApi([DRAFT, THEIRS]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    expect(countBadge(section, "2 documents")).toBeVisible();
    // No confirmation: archiving destroys nothing, and Restore is the
    // way back (DOC-010).
    await act(user, section, "Orion_MSA_2026_redline_orion.docx", "Archive");

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.url).toBe("/api/v1/documents/doc-2/archive");
    await waitFor(() =>
      // A button, because the row's family is `word` and a file the
      // panel reads opens rather than downloads (M12/2). Asking for a
      // link here would pass whether or not the row went away.
      expect(
        within(section).queryByRole("button", { name: "Orion_MSA_2026_redline_orion.docx" }),
      ).not.toBeInTheDocument(),
    );
    expect(countBadge(section, "1 document")).toBeVisible();
  });

  it("shows the archived rows on demand and restores one back onto the list", async () => {
    const api = documentsApi([DRAFT, { ...THEIRS, archivedAt: "2026-08-13T09:00:00.000Z" }]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    // Off the list and out of the count until they are asked for.
    expect(countBadge(section, "1 document")).toBeVisible();
    expect(
      within(section).queryByRole("button", { name: "Orion_MSA_2026_redline_orion.docx" }),
    ).not.toBeInTheDocument();

    await user.click(within(section).getByRole("switch"));

    // Drawn beside the live ones, marked for what they are, and still
    // readable — nothing was destroyed.
    expect(
      await within(section).findByRole("button", { name: "Orion_MSA_2026_redline_orion.docx" }),
    ).toBeVisible();
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
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(within(section).getByRole("switch"));
    await within(section).findByText("Archived");

    // A Legal Team Member gets the one act the seam still takes. Every
    // other write on an archived document is refused until it is
    // restored, so a control for one would be a dead end — and the
    // erasure is the Administrator's, not theirs.
    expect(within(section).queryByRole("combobox")).not.toBeInTheDocument();
    expect(await menuVerbs(user, section, "Orion_MSA_2026_draft.docx")).toEqual(["Restore"]);
    await user.keyboard("{Escape}");
  });

  it("keeps the erasure off a Legal Team Member's menu", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([DRAFT]).handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    // They archive all day and destroy nothing (DOC-010). The seam
    // refuses them regardless; the menu is what keeps a control from
    // offering a dead end. The Administrator's own menu is asserted by
    // the typed-confirmation test below.
    const member = await documentsSection();
    expect(await menuVerbs(user, member, "Orion_MSA_2026_draft.docx")).toEqual([
      "Mark as executed copy",
      "Add version",
      "Edit details",
      // Filing is Member+, like every other write on the record's paper
      // (M13/3), and it is offered on a document at the record root
      // because moving one back out is the same act.
      "Move to folder",
      // They uploaded this one, so the flag is theirs to decide
      // (CTR-022). The next test is the row where it is not.
      "Mark confidential",
      "Archive",
    ]);
  });

  it("marks a confidential document, and draws nothing where one was left out", async () => {
    stubApi({ signedIn: MEMBER, extra: documentsApi([DRAFT, WALLED]).handler });
    renderAt("/contracts/42/documents");

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
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    expect(within(section).queryByRole("img", { name: "Confidential" })).not.toBeInTheDocument();
    expect(within(section).queryByText("board-memo.txt")).not.toBeInTheDocument();
    expect(countBadge(section, "1 document")).toBeVisible();
    expect(within(section).getAllByRole("row")).toHaveLength(2); // header + one
  });

  it("lets the person who uploaded a document mark it confidential, and clear it again", async () => {
    const api = documentsApi([DRAFT]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
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
      // A button, for the same reason the archive case asks for one.
      expect(
        within(section).queryByRole("button", { name: "Orion_MSA_2026_draft.docx" }),
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
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await act(user, section, "Orion_MSA_2026_draft.docx", "Archive");

    expect(await within(section).findByText("This document is already archived.")).toBeVisible();
    // Nothing moved: the section draws what the record says.
    expect(
      within(section).getByRole("button", { name: "Orion_MSA_2026_draft.docx" }),
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
        /** The API always sends a family (M12/2). `other` is what this
         * type routes to, and it is what makes these rows download
         * links — which is what the paging assertions read. */
        renderFamily: "other",
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
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
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

  /**
   * The record's three loader reads plus the paper, and — for a file
   * that has to be converted — the rendition read the panel polls
   * (M12/4). The preview itself is never stubbed: it is an address the
   * browser fetches, not a client call.
   *
   * `renditionStates` is read one answer per poll, and the last one
   * repeats — so a test states "pending, then ready" and the panel walks
   * it the way it would walk a real conversion.
   */
  function panelApi(rows: Record<string, unknown>[], renditionStates?: readonly string[]) {
    const record = recordApi(contractRow(), [person("u1", "creator"), person("u2", "member")]);
    let poll = 0;
    return (call: StubCall): Response | undefined => {
      if (call.url.pathname === "/api/v1/contracts/42/documents" && call.method === "GET") {
        return json(200, { documents: rows, nextCursor: null });
      }
      if (renditionStates && call.url.pathname.endsWith("/rendition") && call.method === "GET") {
        const state = renditionStates[Math.min(poll, renditionStates.length - 1)];
        poll += 1;
        return json(200, { rendition: { state, updatedAt: null } });
      }
      return record.handler(call);
    };
  }

  /** The same, plus the metadata edit and the archive — for the two
   * tests that change a document while its panel is open. */
  function editablePanelApi() {
    const record = recordApi(contractRow(), [person("u1", "creator"), person("u2", "member")]);
    let rows: Record<string, unknown>[] = [document()];
    return (call: StubCall): Response | undefined => {
      if (call.url.pathname === "/api/v1/contracts/42/documents" && call.method === "GET") {
        // Archived paper is off the live list (DOC-010), which is how a
        // document stops resolving under an open panel.
        return json(200, {
          documents: rows.filter((row) => row.archivedAt === null),
          nextCursor: null,
        });
      }
      const removed = /^\/api\/v1\/documents\/([^/]+)\/archive$/.exec(call.url.pathname);
      if (removed && call.method === "POST") {
        const next = { ...rows[0]!, archivedAt: "2026-08-14T10:00:00.000Z" };
        rows = [next];
        return json(200, { document: next });
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
    renderAt("/contracts/42/documents");
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

  it("finds and highlights PDF text, then steps with buttons and local Enter keys", async () => {
    stubApi({ signedIn: MEMBER, extra: panelApi([document()]) });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    await user.click(
      within(await section()).getByRole("button", {
        name: "Orion Cloud — master services agreement",
      }),
    );
    const reading = await panel(/master services agreement, version 1/);
    const openFind = await within(reading).findByRole("button", { name: "Find in document" });
    await user.click(openFind);
    const find = within(reading).getByRole("searchbox", { name: "Find in document" });
    await user.type(find, "termination");

    expect(await within(reading).findByText("1 of 3")).toBeVisible();
    await waitFor(() => {
      expect(
        within(reading).getByText("termination", {
          selector: "mark.bg-status-severe-bg",
        }),
      ).toHaveClass("bg-status-severe-bg");
    });

    const secondPage = reading.querySelector<HTMLElement>('[data-page-number="2"]')!;
    const secondPageScroll = vi.spyOn(secondPage, "scrollIntoView");
    await user.click(within(reading).getByRole("button", { name: "Next match" }));
    expect(within(reading).getByText("2 of 3")).toBeVisible();
    expect(secondPageScroll).toHaveBeenCalled();

    await user.click(find);
    await user.keyboard("{Enter}");
    expect(within(reading).getByText("3 of 3")).toBeVisible();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(within(reading).getByText("2 of 3")).toBeVisible();
    await user.click(within(reading).getByRole("button", { name: "Previous match" }));
    expect(within(reading).getByText("1 of 3")).toBeVisible();
    await user.click(within(reading).getByRole("button", { name: "Close find" }));
    expect(openFind).toHaveFocus();
  });

  it("opens the PDF find bar from a search landing, pre-filled at the first match", async () => {
    stubApi({ signedIn: MEMBER, extra: panelApi([document()]) });
    renderAt("/contracts/42/documents?doc=pdoc-1&version=pv-1&find=termination");

    const reading = await panel(/master services agreement, version 1/);
    expect(within(reading).getByRole("searchbox", { name: "Find in document" })).toHaveValue(
      "termination",
    );
    expect(await within(reading).findByText("1 of 3")).toBeVisible();
  });

  it("keeps the find bar and the open document across a docked tab change", async () => {
    stubApi({ signedIn: MEMBER, extra: panelApi([document()]) });
    renderAt("/contracts/42/documents?doc=pdoc-1&version=pv-1&find=termination");
    const user = userEvent.setup();

    const reading = await panel(/master services agreement, version 1/);
    expect(await within(reading).findByText("1 of 3")).toBeVisible();

    // jsdom reports no widths, so the panel reads as docked and a
    // section tab change leaves it open. That navigation drops the
    // landing's `?find=` from the address; the bar it opened must not
    // reset with it, and the document must not reload under the
    // reader. Only a new document reads the seed again.
    await user.click(screen.getByRole("link", { name: "Fields" }));
    await screen.findByRole("region", { name: "Fields" });

    // Flushed first, then read: the reset this guards against is
    // scheduled by an effect during the section swap and lands a tick
    // after the Fields region resolves. A read before the flush would
    // pass against the old bar.
    await act(async () => {});
    expect(within(reading).getByRole("searchbox", { name: "Find in document" })).toHaveValue(
      "termination",
    );
    expect(within(reading).getByText("1 of 3")).toBeVisible();
  });

  it("keeps the panel's header on the record's own words after a rename", async () => {
    stubApi({ signedIn: MEMBER, extra: editablePanelApi() });
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    await user.click(within(await section()).getByRole("button", { name: "Signature page" }));
    const reading = await panel(/Signature page, version 1/);
    // Inline, and read from the preview rather than the download: the
    // server sets the type and the disposition there.
    expect(within(reading).getByRole("img", { name: "signature-page.png" })).toHaveAttribute(
      "src",
      "/api/v1/documents/pdoc-img/versions/pv-img/preview",
    );
    expect(within(reading).queryByRole("button", { name: "Find in document" })).toBeNull();
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
    renderAt("/contracts/42/documents");

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
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
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
    renderAt("/contracts/42/documents");
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

  it("takes the panel with a document that leaves the list", async () => {
    // The panel's third exit, and the only one nobody presses. What it
    // draws is resolved from the record on every render, so a document
    // archived out of the live view stops resolving and the panel goes
    // with it — rather than staying on screen drawing paper the record
    // no longer has.
    stubApi({ signedIn: MEMBER, extra: editablePanelApi() });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const list = await section();
    const open = within(list).getByRole("button", {
      name: "Orion Cloud — master services agreement",
    });
    await user.click(open);
    await panel(/master services agreement, version 1/);

    await user.click(
      within(list).getByRole("button", {
        name: "Actions for Orion Cloud — master services agreement",
      }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: /master services agreement, version 1/ }),
      ).toBeNull(),
    );
    // And the row goes too, so there is nothing left to put focus back
    // on — this path drops the reference rather than restoring to a
    // control that is no longer there.
    expect(
      within(list).queryByRole("button", {
        name: "Orion Cloud — master services agreement",
        hidden: true,
      }),
    ).toBeNull();
  });

  it("lets a Contributor on the team read what they can already download", async () => {
    stubApi({ signedIn: CONTRIBUTOR, extra: panelApi([document()]) });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const list = await section();
    await user.click(
      within(list).getByRole("button", { name: "Orion Cloud — master services agreement" }),
    );
    // Read access means reading, on every surface: the panel is not a
    // write and is offered to everyone the record names.
    expect(await panel(/master services agreement, version 1/)).toBeVisible();
  });

  /**
   * Word and PowerPoint, converted for display (M12/4, DOC-004).
   *
   * The demand is the milestone's first sentence: a Legal Team Member
   * previews a Word draft in-app without downloading it. No browser
   * draws a DOCX, so what the panel promises this layer is the three
   * states of the conversion behind it — preparing while it runs, the
   * PDF surface when it lands, and an honest card with the download when
   * it gave up.
   *
   * The conversion's own fidelity is not asserted here and cannot be:
   * the tracked changes and comments live in bytes a real LibreOffice
   * produced, which is the doc-engine contract suite's subject, and the
   * demo spec is where the whole stack is watched drawing them.
   */
  const wordDraft = () =>
    document({
      id: "pdoc-w",
      title: "Counterparty redline",
      versions: [
        version({
          id: "pv-w",
          originalFilename: "nda-redline.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          renderFamily: "word",
        }),
      ],
    });

  it("shows a preparing state while a Word draft converts, and draws it when it lands", async () => {
    stubApi({ signedIn: MEMBER, extra: panelApi([wordDraft()], ["pending", "ready"]) });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const list = await section();
    // A Word draft reads in the app, so its name opens the panel rather
    // than saving the file.
    await user.click(within(list).getByRole("button", { name: "Counterparty redline" }));
    const reading = await panel(/Counterparty redline, version 1/);

    // While the conversion runs the panel says so, rather than showing
    // nothing or a broken surface.
    expect(await within(reading).findByText("Preparing this document for reading…")).toBeVisible();
    // And it keeps asking until the answer changes — live push is M30's
    // job, so this is a poll.
    await waitFor(
      () => expect(within(reading).queryByText("Preparing this document for reading…")).toBeNull(),
      { timeout: 5000 },
    );
    // No download card: the file is being drawn, not offered.
    expect(within(reading).queryByText(/could not be prepared/)).toBeNull();
    expect(await within(reading).findByRole("button", { name: "Find in document" })).toBeVisible();
  });

  it("offers the download when a conversion failed, and says so plainly", async () => {
    stubApi({ signedIn: MEMBER, extra: panelApi([wordDraft()], ["failed"]) });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const list = await section();
    await user.click(within(list).getByRole("button", { name: "Counterparty redline" }));
    const reading = await panel(/Counterparty redline, version 1/);

    // One click, not a support ticket: the card says what happened and
    // the download is on it.
    expect(
      await within(reading).findByText(
        "This file could not be prepared for reading here. Download it to read it.",
      ),
    ).toBeVisible();
    expect(within(reading).getAllByRole("link", { name: "Download" }).at(-1)).toHaveAttribute(
      "href",
      "/api/v1/documents/pdoc-w/versions/pv-w/download",
    );
    expect(within(reading).queryByRole("button", { name: "Find in document" })).toBeNull();
  });

  it("stops asking when nothing answers, and ends at the download", async () => {
    // The rendition read is stubbed away entirely, so every poll comes
    // back with nothing. A reader must never be left in front of a
    // preparing state that will never resolve: the asking is bounded and
    // ends where every path with no preview ends.
    stubApi({ signedIn: MEMBER, extra: panelApi([wordDraft()]) });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const list = await section();
    await user.click(within(list).getByRole("button", { name: "Counterparty redline" }));
    const reading = await panel(/Counterparty redline, version 1/);

    expect(
      await within(reading).findByText(
        "This file could not be prepared for reading here. Download it to read it.",
        undefined,
        { timeout: 15_000 },
      ),
    ).toBeVisible();
  }, 30_000);

  /**
   * Rendered emails (M12/5, DOC-004).
   *
   * The demand is one sentence: a Legal Team Member opens an uploaded
   * MSG or EML and reads a message — headers, body, attachment list —
   * rather than downloading a blob. What this layer asserts is the
   * surface around the parse: that the message is drawn, that the body
   * is drawn where it can reach nothing, that an attachment that reads
   * in the app opens here, that one that does not is a download, and
   * that a message nobody can read ends where every path with no
   * preview ends.
   *
   * The parse and the sanitizing are the server's, and they are
   * asserted there: this panel is handed a body that is already safe and
   * never sees a sender's own markup.
   */
  const thread = () =>
    document({
      id: "pdoc-m",
      title: "Delivery dispute — correspondence",
      versions: [
        version({
          id: "pv-m",
          originalFilename: "RE_delivery_dispute.msg",
          mimeType: "application/vnd.ms-outlook",
          renderFamily: "email",
        }),
      ],
    });

  /** The record's reads, plus the email read the panel makes. `email`
   * is what the server answered; `undefined` is a server that refused
   * it. */
  function emailApi(rows: Record<string, unknown>[], email?: Record<string, unknown>) {
    const base = panelApi(rows);
    return (call: StubCall): Response | undefined => {
      if (call.url.pathname.endsWith("/email") && call.method === "GET") {
        return email
          ? json(200, { email })
          : problem(422, "This email could not be read. Download it instead.");
      }
      return base(call);
    };
  }

  const message = (over: Record<string, unknown> = {}) => ({
    subject: "RE: delivery dispute — June shipment damage",
    from: { name: "Tom Alvarez", address: "t.alvarez@brightline.com" },
    to: [{ name: null, address: "legal@aldgate.co.uk" }],
    cc: [{ name: "Sarah Chen", address: "s.chen@aldgate.co.uk" }],
    bcc: [],
    date: "2026-08-07T16:12:00.000Z",
    html: null,
    text: "Sarah,\n\nAttaching the June delivery log.",
    attachments: [],
    ...over,
  });

  it("opens an uploaded email as a message, with its headers and its body", async () => {
    stubApi({ signedIn: MEMBER, extra: emailApi([thread()], message()) });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const list = await section();
    // An email reads in the app, so its name opens the panel rather
    // than saving the file.
    await user.click(
      within(list).getByRole("button", { name: "Delivery dispute — correspondence" }),
    );
    const reading = await panel(/Delivery dispute — correspondence, version 1/);

    expect(
      await within(reading).findByText("RE: delivery dispute — June shipment damage"),
    ).toBeVisible();
    expect(within(reading).getByText("Tom Alvarez <t.alvarez@brightline.com>")).toBeVisible();
    expect(within(reading).getByText("legal@aldgate.co.uk")).toBeVisible();
    expect(within(reading).getByText("Sarah Chen <s.chen@aldgate.co.uk>")).toBeVisible();
    expect(within(reading).getByText(/Attaching the June delivery log/)).toBeVisible();
    // No Bcc row for a message that carries none: an empty label would
    // read as a redaction.
    expect(within(reading).queryByText("Bcc")).toBeNull();
    // Never a download card: the message is being drawn, not offered.
    expect(within(reading).queryByText(/could not be prepared/)).toBeNull();
    expect(within(reading).queryByRole("button", { name: "Find in document" })).toBeNull();
  });

  it("shows who a message was blind-copied to, when the file says", async () => {
    // A MSG saved from the sender's own mailbox — Sent Items, not an
    // inbox — names its Bcc recipients, and hiding a recipient class the
    // server handed over would misread the message for whoever it
    // matters most to.
    stubApi({
      signedIn: MEMBER,
      extra: emailApi(
        [thread()],
        message({ bcc: [{ name: "Iris Auditor", address: "i.auditor@brightline.com" }] }),
      ),
    });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const list = await section();
    await user.click(
      within(list).getByRole("button", { name: "Delivery dispute — correspondence" }),
    );
    const reading = await panel(/Delivery dispute — correspondence, version 1/);

    expect(await within(reading).findByText("Bcc")).toBeVisible();
    expect(within(reading).getByText("Iris Auditor <i.auditor@brightline.com>")).toBeVisible();
  });

  it("draws an HTML body where it can reach nothing", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: emailApi([thread()], message({ html: "<p>Attaching the log.</p>", text: null })),
    });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const list = await section();
    await user.click(
      within(list).getByRole("button", { name: "Delivery dispute — correspondence" }),
    );
    const reading = await panel(/Delivery dispute — correspondence, version 1/);

    // The second wall. The server already cut the sender's markup down;
    // this frame is what makes a hole in that sanitizer cost nothing.
    const frame = await within(reading).findByTitle("Message body");
    expect(frame.tagName).toBe("IFRAME");
    // No `allow-scripts`, and no `allow-same-origin`: nothing in the
    // message runs, and nothing in it shares this origin.
    const sandbox = frame.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    // And the document it holds refuses every request it could make.
    expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
    expect(frame.getAttribute("srcdoc")).toContain("Attaching the log.");
  });

  it("opens an attachment that reads in the app, and comes back to the message", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: emailApi(
        [thread()],
        message({
          attachments: [
            {
              index: 0,
              filename: "warehouse-photo.png",
              mimeType: "image/png",
              byteSize: 240_000,
              renderFamily: "image",
              isInline: false,
            },
          ],
        }),
      ),
    });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const list = await section();
    await user.click(
      within(list).getByRole("button", { name: "Delivery dispute — correspondence" }),
    );
    const reading = await panel(/Delivery dispute — correspondence, version 1/);

    // A file that reads in the app is a button, not a download link.
    const open = await within(reading).findByRole("button", { name: /warehouse-photo\.png/ });
    await user.click(open);

    // Read in the panel, from the attachment's own preview address —
    // no round trip through a Downloads folder.
    expect(within(reading).getByRole("img", { name: "warehouse-photo.png" })).toHaveAttribute(
      "src",
      "/api/v1/documents/pdoc-m/versions/pv-m/attachments/0/preview",
    );
    // And one control back to the message it came from.
    await user.click(within(reading).getByRole("button", { name: "Back to the message" }));
    expect(within(reading).getByText(/Attaching the June delivery log/)).toBeVisible();
  });

  it("offers an attachment outside the render set as a download", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: emailApi(
        [thread()],
        message({
          attachments: [
            {
              index: 0,
              filename: "damage-photos.zip",
              mimeType: "application/zip",
              byteSize: 8_400_000,
              renderFamily: "other",
              isInline: false,
            },
          ],
        }),
      ),
    });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const list = await section();
    await user.click(
      within(list).getByRole("button", { name: "Delivery dispute — correspondence" }),
    );
    const reading = await panel(/Delivery dispute — correspondence, version 1/);

    // Nothing in the app can read an archive, so the chip is the
    // download it has to be — what a control looks like says what it
    // will do.
    expect(
      await within(reading).findByRole("link", { name: /damage-photos\.zip/ }),
    ).toHaveAttribute("href", "/api/v1/documents/pdoc-m/versions/pv-m/attachments/0/download");
  });

  it("ends at the download when the message cannot be read", async () => {
    stubApi({ signedIn: MEMBER, extra: emailApi([thread()]) });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const list = await section();
    await user.click(
      within(list).getByRole("button", { name: "Delivery dispute — correspondence" }),
    );
    const reading = await panel(/Delivery dispute — correspondence, version 1/);

    // The same honest card every path with no preview ends at.
    expect(
      await within(reading).findByText(
        "This file could not be prepared for reading here. Download it to read it.",
      ),
    ).toBeVisible();
    expect(within(reading).getAllByRole("link", { name: "Download" }).at(-1)).toHaveAttribute(
      "href",
      "/api/v1/documents/pdoc-m/versions/pv-m/download",
    );
  });

  it("draws a PowerPoint deck the same way", async () => {
    const deck = document({
      id: "pdoc-p",
      title: "Board pack",
      versions: [
        version({
          id: "pv-p",
          originalFilename: "board-pack.pptx",
          mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          renderFamily: "presentation",
        }),
      ],
    });
    stubApi({ signedIn: MEMBER, extra: panelApi([deck], ["pending"]) });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const list = await section();
    await user.click(within(list).getByRole("button", { name: "Board pack" }));
    const reading = await panel(/Board pack, version 1/);
    expect(await within(reading).findByText("Preparing this document for reading…")).toBeVisible();
  });
});

describe("the folder tree on the contract record (M13/2, DES-033)", () => {
  /** One folder as the API answers it. */
  const folder = (
    id: string,
    name: string,
    parentId: string | null = null,
    documentCount = 0,
  ): Record<string, unknown> => ({
    id,
    name,
    parentId,
    // How much this viewer can see filed here (M13/3, DD-014). Zero by
    // default, which is what the tree draws as "Empty".
    documentCount,
    createdAt: "2026-08-15T09:00:00.000Z",
    updatedAt: "2026-08-15T09:00:00.000Z",
  });

  /**
   * The record stub plus the folder read and the four folder writes.
   *
   * The tree is stateful and every write answers the whole set, exactly
   * as the seam does — a delete re-files the children it had, so more
   * rows move than the one that was addressed.
   */
  function foldersApi(
    initial: Record<string, unknown>[],
    options: { writeFails?: string } = {},
    team = [person("u1", "creator")],
  ) {
    const record = recordApi(contractRow(), team);
    /** Every folder write the section made, in order. */
    const writes: { url: string; method: string; body: unknown }[] = [];
    let tree = initial;
    /** Siblings by name without case, the way the seam answers them
     * (DES-033). */
    const sorted = () =>
      [...tree].sort((a, b) =>
        String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()),
      );
    const handler = (call: StubCall): Response | undefined => {
      const { pathname } = call.url;
      if (pathname === "/api/v1/contracts/42/folders" && call.method === "GET") {
        return json(200, { folders: sorted() });
      }
      if (pathname === "/api/v1/contracts/42/folders" && call.method === "POST") {
        writes.push({ url: pathname, method: call.method, body: call.body });
        if (options.writeFails) return problem(409, options.writeFails);
        const body = call.body as { name: string; parentId?: string };
        tree = [...tree, folder(`f-${tree.length + 1}`, body.name, body.parentId ?? null)];
        return json(201, { folders: sorted() });
      }
      const addressed = /^\/api\/v1\/folders\/([^/]+)$/.exec(pathname);
      if (addressed && call.method === "PATCH") {
        writes.push({ url: pathname, method: call.method, body: call.body });
        if (options.writeFails) return problem(409, options.writeFails);
        const patch = call.body as { name?: string; parentId?: string | null };
        tree = tree.map((row) => (row.id === addressed[1] ? { ...row, ...patch } : row));
        return json(200, { folders: sorted() });
      }
      if (addressed && call.method === "DELETE") {
        writes.push({ url: pathname, method: call.method, body: call.body });
        if (options.writeFails) return problem(409, options.writeFails);
        const removed = tree.find((row) => row.id === addressed[1]);
        // Dissolved, not destroyed: the children move up into what held
        // it (DOC-006).
        tree = tree
          .filter((row) => row.id !== addressed[1])
          .map((row) =>
            row.parentId === addressed[1] ? { ...row, parentId: removed!.parentId } : row,
          );
        return json(200, { folders: sorted() });
      }
      return record.handler(call);
    };
    return { handler, writes };
  }

  const documentsSection = () => screen.findByRole("region", { name: /^Documents/ });

  /** One act from a folder row's overflow menu, reached the way a person
   * reaches it. */
  async function act(
    user: ReturnType<typeof userEvent.setup>,
    section: HTMLElement,
    name: string,
    verb: string,
  ) {
    await user.click(
      within(section).getByRole("button", { name: `Actions for the ${name} folder` }),
    );
    await user.click(await screen.findByRole("menuitem", { name: verb }));
    return screen.findByRole("dialog");
  }

  /** The folder names on screen, in the order the table draws them. */
  const drawn = (section: HTMLElement) =>
    within(section)
      .getAllByRole("button", { name: /^Actions for the .* folder$/ })
      .map((trigger) => /^Actions for the (.*) folder$/.exec(trigger.ariaLabel ?? "")?.[1]);

  it("draws the record's folders as rows of the documents table", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: foldersApi([folder("f-1", "Executed"), folder("f-2", "Amendments")]).handler,
    });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    expect(await within(section).findByText("Amendments")).toBeVisible();
    expect(within(section).getByText("Executed")).toBeVisible();
    // A folder with nothing filed in it reads "Empty" rather than
    // "0 documents" — a plural form, not a special case (DES-033).
    expect(within(section).getAllByText("Empty")).toHaveLength(2);
  });

  it("orders siblings by name without case, the way a file manager lists a directory", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: foldersApi([
        folder("f-1", "Executed"),
        folder("f-2", "correspondence"),
        folder("f-3", "Amendments"),
      ]).handler,
    });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    await within(section).findByText("Amendments");
    // "correspondence" belongs between the two capitalized names; a
    // case-sensitive order would put it last.
    expect(drawn(section)).toEqual(["Amendments", "correspondence", "Executed"]);
  });

  it("draws a folder's children only while it is open, indented under it", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: foldersApi([folder("f-1", "Correspondence"), folder("f-2", "2026", "f-1")]).handler,
    });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await within(section).findByText("Correspondence");
    expect(within(section).queryByText("2026")).toBeNull();

    await user.click(within(section).getByRole("button", { name: "Expand Correspondence" }));

    expect(await within(section).findByText("2026")).toBeVisible();
    // Collapsing puts it away again — the tree is one press deep, not a
    // page of its own.
    await user.click(within(section).getByRole("button", { name: "Collapse Correspondence" }));
    expect(within(section).queryByText("2026")).toBeNull();
  });

  it("offers the chevron on a folder that reads Empty", async () => {
    stubApi({ signedIn: MEMBER, extra: foldersApi([folder("f-1", "Executed")]).handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    await within(section).findByRole("button", { name: "Expand Executed" });
    // Every folder opens (M13/3). "Empty" may be a folder whose
    // contents this viewer cannot see, so a chevron drawn only on the
    // folders that hold something would be the surface telling the two
    // apart — which is what DD-014 bars.
    expect(within(section).getByRole("button", { name: "Expand Executed" })).toBeVisible();
    expect(within(section).getByText("Empty")).toBeVisible();
  });

  it("makes a folder at the record root from the toolbar", async () => {
    const api = foldersApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(within(section).getByRole("button", { name: "New folder" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Executed");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      url: "/api/v1/contracts/42/folders",
      method: "POST",
      body: { name: "Executed" },
    });
    expect(await within(section).findByText("Executed")).toBeVisible();
  });

  it("makes a folder inside another one from its row menu", async () => {
    const api = foldersApi([folder("f-1", "Correspondence")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await within(section).findByText("Correspondence");
    const dialog = await act(user, section, "Correspondence", "New folder inside");
    await user.type(within(dialog).getByLabelText("Name"), "2026");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    // Where it lands is settled before the dialog opens, by the row the
    // menu was on — the dialog collects a name and nothing else.
    expect(api.writes[0]!.body).toEqual({ name: "2026", parentId: "f-1" });
    // And the parent opens, so the new folder is on screen. A write
    // that landed and left the table looking exactly as it did would
    // read as a write that did not.
    expect(await within(section).findByText("2026")).toBeVisible();
  });

  it("renames a folder in place", async () => {
    const api = foldersApi([folder("f-1", "Corespondence")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await within(section).findByText("Corespondence");
    const dialog = await act(user, section, "Corespondence", "Rename");
    const field = within(dialog).getByLabelText("Name");
    await user.clear(field);
    await user.type(field, "Correspondence");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      url: "/api/v1/folders/f-1",
      method: "PATCH",
      body: { name: "Correspondence" },
    });
    expect(await within(section).findByText("Correspondence")).toBeVisible();
  });

  it("moves a folder under a different parent, and back out to the record", async () => {
    const api = foldersApi([folder("f-1", "Amendments"), folder("f-2", "2026")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await within(section).findByText("2026");
    const dialog = await act(user, section, "2026", "Move");
    await user.selectOptions(within(dialog).getByLabelText("Move into"), "f-1");
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]!.body).toEqual({ parentId: "f-1" });

    // Back out again. The record itself is the empty option, because it
    // is the absence of a parent rather than a folder with an id.
    await user.click(within(section).getByRole("button", { name: "Expand Amendments" }));
    const back = await act(user, section, "2026", "Move");
    await user.selectOptions(within(back).getByLabelText("Move into"), "");
    await user.click(within(back).getByRole("button", { name: "Move" }));

    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[1]!.body).toEqual({ parentId: null });
  });

  it("offers no destination that would close a cycle", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: foldersApi([
        folder("f-1", "Correspondence"),
        folder("f-2", "2026", "f-1"),
        folder("f-3", "Amendments"),
      ]).handler,
    });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await within(section).findByText("Correspondence");
    const dialog = await act(user, section, "Correspondence", "Move");

    // Neither the folder itself nor anything under it: the seam refuses
    // both, and a control that cannot succeed is worse than none.
    expect(
      within(dialog)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["The contract itself", "Amendments"]);
  });

  it("dissolves a folder after saying where the contents go", async () => {
    const api = foldersApi([folder("f-1", "Correspondence"), folder("f-2", "2026", "f-1")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await within(section).findByText("Correspondence");
    await user.click(within(section).getByRole("button", { name: "Expand Correspondence" }));
    const dialog = await act(user, section, "2026", "Delete");

    // No typed name, unlike DOC-010's erasure: nothing is destroyed, so
    // the dialog states where the contents land and offers the verb.
    expect(
      within(dialog).getByText("Anything in it moves into Correspondence. Nothing is deleted."),
    ).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({ url: "/api/v1/folders/f-2", method: "DELETE" });
    expect(within(section).queryByText("2026")).toBeNull();
  });

  it("re-files a dissolved folder's children into its parent", async () => {
    const api = foldersApi([
      folder("f-1", "Correspondence"),
      folder("f-2", "2026", "f-1"),
      folder("f-3", "Q1", "f-2"),
    ]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(await within(section).findByRole("button", { name: "Expand Correspondence" }));
    await user.click(await within(section).findByRole("button", { name: "Expand 2026" }));
    const dialog = await act(user, section, "2026", "Delete");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    // Q1 moved up into what held its own parent. Nothing was destroyed,
    // and it is drawn straight away because Correspondence is still
    // open — dissolving a folder inside it did not close it.
    await waitFor(() => expect(within(section).queryByText("2026")).toBeNull());
    expect(within(section).getByText("Q1")).toBeVisible();
  });

  it("says what the seam said when a folder write is refused, and changes nothing", async () => {
    const api = foldersApi([folder("f-1", "Executed")], {
      writeFails: "A folder named Executed is already here.",
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await within(section).findByText("Executed");
    await user.click(within(section).getByRole("button", { name: "New folder" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "executed");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    // The dialog stays open with the server's own words in it, so the
    // person can fix the name rather than start again.
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "A folder named Executed is already here.",
    );
    // Nothing landed. The tree is read after the dialog closes, because
    // a modal takes the rest of the page out of the accessibility tree.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(drawn(section)).toEqual(["Executed"]);
  });

  it("refuses to send a blank name", async () => {
    const api = foldersApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(within(section).getByRole("button", { name: "New folder" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Give the folder a name.");
    expect(api.writes).toEqual([]);
  });

  it("shows a Contributor the tree and offers them no control on it", async () => {
    stubApi({
      signedIn: CONTRIBUTOR,
      extra: foldersApi([folder("f-1", "Correspondence"), folder("f-2", "2026", "f-1")], {}, [
        person("u1", "creator"),
        person("u3", "contributor"),
      ]).handler,
    });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    expect(await within(section).findByText("Correspondence")).toBeVisible();
    // Read-only means the controls are absent, not disabled — DES-025's
    // convention applied to a whole section.
    expect(within(section).queryByRole("button", { name: "New folder" })).toBeNull();
    expect(within(section).queryByRole("button", { name: /^Actions for the/ })).toBeNull();
    // The tree still opens: reading the structure is the whole point of
    // drawing it for them.
    await user.click(within(section).getByRole("button", { name: "Expand Correspondence" }));
    expect(await within(section).findByText("2026")).toBeVisible();
  });
});

/**
 * Filing a document into a folder (M13/3, DES-033).
 *
 * The section stops being one list and becomes several: the record root
 * draws what is filed nowhere, and each folder's documents are read when
 * it is opened, with the paging foot applying inside that folder. Move
 * files a document and moves it back out, from a control rather than
 * only from a drop.
 *
 * The count on a folder row is the seam's own number, drawn as it
 * arrives. Nothing here works one out, because a count the section
 * derived would be a second answer to a question DD-014 allows only one
 * of.
 */
describe("filing documents into folders (M13/3, DES-033)", () => {
  const version = (over: Record<string, unknown> = {}) => ({
    id: "ver-1",
    versionNumber: 1,
    kind: "draft_ours",
    note: null,
    originalFilename: "signed.pdf",
    mimeType: "text/plain",
    /** `other` keeps the row a plain download link, which is what these
     * assertions read. */
    renderFamily: "other",
    byteSize: 10,
    checksumSha256: "a".repeat(64),
    uploadedBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
    createdAt: "2026-08-11T09:00:00.000Z",
    isCurrent: true,
    isExecuted: false,
    ...over,
  });

  const document = (id: string, title: string, folderId: string | null = null) => ({
    id,
    title,
    description: null,
    isPrimary: false,
    versions: [version({ id: `ver-${id}`, originalFilename: title })],
    archivedAt: null,
    isConfidential: false,
    folderId,
    createdBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
    createdAt: "2026-08-11T09:00:00.000Z",
    updatedAt: "2026-08-11T09:00:00.000Z",
  });

  const folder = (id: string, name: string, parentId: string | null = null) => ({
    id,
    name,
    parentId,
    createdAt: "2026-08-15T09:00:00.000Z",
    updatedAt: "2026-08-15T09:00:00.000Z",
  });

  /**
   * A filed document the app can read in place.
   *
   * The rest of this suite files plain downloads, because that is what
   * its assertions are about. A PDF is what opens in the doc panel
   * (M12/2), and the panel is the record's — so this is the fixture the
   * "a filed document opens too" tests are stated over.
   */
  const readableFiled = (id: string, title: string, folderId: string) => ({
    ...document(id, title, folderId),
    versions: [
      version({
        id: `ver-${id}`,
        originalFilename: title,
        mimeType: "application/pdf",
        renderFamily: "pdf",
      }),
    ],
  });

  /**
   * The record, its folders, and its paper — with the filing the seam
   * really does.
   *
   * The list route answers one listing at a time: `folder=root` is what
   * is filed nowhere, a folder's id is what is filed in it, and each
   * page is counted inside that listing alone. The folder read answers
   * the count the same way the seam does, off the same rows, so a test
   * cannot pass with a count the section invented.
   */
  function filingApi(
    documents: Record<string, unknown>[],
    folders: Record<string, unknown>[],
    options: { pageSize?: number; moveFails?: string } = {},
    team = [person("u1", "creator")],
  ) {
    const record = recordApi(contractRow(), team);
    const reads: string[] = [];
    const writes: { url: string; body: unknown }[] = [];
    let paper = documents;
    /** One listing, in the order the seam answers it. */
    const listing = (folderId: string | null) =>
      paper.filter((row) => (row.folderId ?? null) === folderId);
    const handler = (call: StubCall): Response | undefined => {
      const { pathname } = call.url;
      if (pathname === "/api/v1/contracts/42/folders" && call.method === "GET") {
        return json(200, {
          folders: folders.map((row) => ({
            ...row,
            // Counted off the same rows the listing is answered from,
            // which is the seam's one predicate said once.
            documentCount: listing(row.id as string).length,
          })),
        });
      }
      if (pathname === "/api/v1/contracts/42/documents" && call.method === "GET") {
        const asked = call.url.searchParams.get("folder");
        reads.push(asked ?? "all");
        const rows = asked === null ? paper : listing(asked === "root" ? null : asked);
        const size = options.pageSize ?? rows.length;
        const cursor = call.url.searchParams.get("cursor");
        const from = cursor === null ? 0 : rows.findIndex((row) => row.id === cursor) + 1;
        const page = rows.slice(from, from + size);
        return json(200, {
          documents: page,
          nextCursor: from + size < rows.length ? (page.at(-1)?.id ?? null) : null,
        });
      }
      const addressed = /^\/api\/v1\/documents\/([^/]+)$/.exec(pathname);
      if (addressed && call.method === "PATCH") {
        writes.push({ url: pathname, body: call.body });
        if (options.moveFails) return problem(409, options.moveFails);
        const patch = call.body as { folderId?: string | null };
        const moved = { ...paper.find((row) => row.id === addressed[1])!, ...patch };
        paper = paper.map((row) => (row.id === addressed[1] ? moved : row));
        return json(200, { document: moved });
      }
      // Archiving takes a document off the live listing (DOC-010),
      // which is how a filed one stops being on screen.
      const removed = /^\/api\/v1\/documents\/([^/]+)\/archive$/.exec(pathname);
      if (removed && call.method === "POST") {
        const gone = {
          ...paper.find((row) => row.id === removed[1])!,
          archivedAt: "2026-08-15T10:00:00.000Z",
        };
        paper = paper.filter((row) => row.id !== removed[1]);
        return json(200, { document: gone });
      }
      return record.handler(call);
    };
    return { handler, reads, writes };
  }

  const documentsSection = () => screen.findByRole("region", { name: /^Documents/ });

  it("draws the record root as the documents filed nowhere", async () => {
    const api = filingApi(
      [document("doc-1", "loose.pdf"), document("doc-2", "signed.pdf", "f-1")],
      [folder("f-1", "Executed")],
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    expect(await within(section).findByText("loose.pdf")).toBeVisible();
    // The filed one belongs to its folder and is drawn there, not twice.
    expect(within(section).queryByText("signed.pdf")).toBeNull();
    // The folder row states its own count, which is the seam's number.
    expect(within(section).getByText("1 document")).toBeVisible();
    // And the section's badge is the total over both listings: one
    // document filed nowhere, plus the one the folder says it holds.
    expect(within(section).getByRole("img", { name: "2 documents" })).toBeVisible();
    expect(api.reads).toContain("root");
  });

  it("loads a folder's documents when it is opened, through the folder filter", async () => {
    const api = filingApi(
      [document("doc-1", "loose.pdf"), document("doc-2", "signed.pdf", "f-1")],
      [folder("f-1", "Executed")],
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await within(section).findByRole("button", { name: "Expand Executed" });
    // Nothing is read for a folder nobody opened: a heavy record stays a
    // short table until somebody asks.
    expect(api.reads).not.toContain("f-1");

    await user.click(within(section).getByRole("button", { name: "Expand Executed" }));

    expect(await within(section).findByText("signed.pdf")).toBeVisible();
    expect(api.reads).toContain("f-1");
  });

  it("opens a filed document in the doc panel, exactly as an unfiled one (M12/2)", async () => {
    // The panel is the record's and it resolves what it is reading out
    // of the paper the record holds — which is the record root alone, so
    // a filed document has to be told about or its name opens nothing.
    const api = filingApi(
      [readableFiled("doc-2", "signed.pdf", "f-1")],
      [folder("f-1", "Executed")],
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    await user.click(await within(section).findByRole("button", { name: "signed.pdf" }));

    expect(
      await screen.findByRole("complementary", { name: "signed.pdf, version 1" }),
    ).toBeVisible();
    // Beside the list it was opened from, not instead of it (DOC2).
    expect(screen.getByRole("region", { name: /^Documents/ })).toBeVisible();
  });

  it("keeps a filed document's panel open across a section tab round trip", async () => {
    // The section is mounted and unmounted by the tab strip (DES-032),
    // so it comes back holding no folder listing at all. A root
    // document's panel survives that trip because the record holds that
    // list itself, and a filed one has to survive it too.
    const api = filingApi(
      [readableFiled("doc-2", "signed.pdf", "f-1")],
      [folder("f-1", "Executed")],
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    await user.click(await within(section).findByRole("button", { name: "signed.pdf" }));
    await screen.findByRole("complementary", { name: "signed.pdf, version 1" });

    await user.click(screen.getByRole("link", { name: "Overview" }));
    await screen.findByLabelText("Title");
    const sections = within(await screen.findByRole("navigation", { name: "Contract sections" }));
    await user.click(sections.getByRole("link", { name: "Documents" }));
    // Still reading, and the list it was opened from is back beside it.
    expect(await documentsSection()).toBeVisible();

    expect(
      await screen.findByRole("complementary", { name: "signed.pdf, version 1" }),
    ).toBeVisible();
  });

  it("keeps the panel open on a tab other than Overview or Documents", async () => {
    const api = filingApi(
      [readableFiled("doc-2", "signed.pdf", "f-1")],
      [folder("f-1", "Executed")],
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    await user.click(await within(section).findByRole("button", { name: "signed.pdf" }));
    await screen.findByRole("complementary", { name: "signed.pdf, version 1" });

    await user.click(screen.getByRole("link", { name: "Fields" }));
    await screen.findByRole("region", { name: "Fields" });

    expect(screen.getByRole("complementary", { name: "signed.pdf, version 1" })).toBeVisible();
    // Docked above the threshold, it is the 720px column beside the
    // section rather than the layer over it.
    expect(screen.getByRole("complementary", { name: "signed.pdf, version 1" })).toHaveClass(
      "@min-[1400px]/record:w-(--width-docpanel)",
      "@min-[1400px]/record:shrink-0",
    );
  });

  /**
   * A `ResizeObserver` that hands its callback back, so a test can say
   * how wide the record-content region is.
   *
   * jsdom lays nothing out, so the project's own polyfill never fires
   * and every panel reads as docked. That is the right default for the
   * tests above, and useless for the one below — the overlay case only
   * exists at a width jsdom will never report on its own.
   */
  class RecordingResizeObserver implements ResizeObserver {
    static instances: RecordingResizeObserver[] = [];
    readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      RecordingResizeObserver.instances.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  it("closes the panel on a section tab change while it overlays the record", async () => {
    // The bug this is here for: below the docking threshold the panel
    // covers whatever section is showing, so a reader who clicked
    // Fields was left looking at the document and read the tab strip as
    // broken. Docked it stays open (the test above); overlaying it gets
    // out of the way.
    RecordingResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", RecordingResizeObserver);
    const api = filingApi(
      [readableFiled("doc-2", "signed.pdf", "f-1")],
      [folder("f-1", "Executed")],
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    await user.click(await within(section).findByRole("button", { name: "signed.pdf" }));
    await screen.findByRole("complementary", { name: "signed.pdf, version 1" });

    // Narrower than the 1400px the panel needs to dock into.
    const observer = RecordingResizeObserver.instances.at(-1)!;
    observer.callback(
      [{ contentRect: { width: 900 } }] as unknown as ResizeObserverEntry[],
      observer,
    );

    await user.click(screen.getByRole("link", { name: "Fields" }));
    await screen.findByRole("region", { name: "Fields" });

    // Waited for, not read once: the section swap and the close are two
    // separate renders. Routing draws Fields, and only the effect that
    // runs after that commit reads `readingDocked` and closes the panel
    // — so the Fields region above resolves one render before the close
    // lands. Waiting on the panel's own absence is waiting on the state
    // change this case is about, and it still fails inside the default
    // timeout if the panel never closes at all.
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "signed.pdf, version 1" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("opens an applet beside the document viewer rather than under it", async () => {
    // The panel used to overlay the whole row and cover any applet
    // that opened in it. Its containing block is the record-content
    // region now, which the applet panel and the activity bar are
    // outside of, so opening Team while a document is on screen leaves
    // both complementaries visible whether the panel docks or overlays.
    const api = filingApi(
      [readableFiled("doc-2", "signed.pdf", "f-1")],
      [folder("f-1", "Executed")],
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    await user.click(await within(section).findByRole("button", { name: "signed.pdf" }));
    const doc = await screen.findByRole("complementary", { name: "signed.pdf, version 1" });

    const bar = screen.getByRole("toolbar", { name: "Applets" });
    await user.click(within(bar).getByRole("button", { name: "Team" }));
    const applet = await screen.findByRole("complementary", { name: "Team" });

    expect(doc).toBeVisible();
    expect(applet).toBeVisible();
    // The applet is a sibling of the region the doc panel is drawn in,
    // never a child of it — so no z-index of the panel's can put it
    // underneath.
    expect(doc.parentElement).not.toContainElement(applet);
  });

  /**
   * The stub, with one folder's next re-read held open (M13/3).
   *
   * A write that re-reads the listings puts the folder into its
   * skeleton state until the read answers. The stub answers in a
   * microtask, so that state settles before a test can see it — held
   * open, the moment is real, which is the moment the tests below are
   * about: a folder being re-read has not stopped holding its
   * documents, and the panel over one of them must not close.
   */
  function heldFolderRead(api: ReturnType<typeof filingApi>, folderId: string) {
    let release: (() => void) | undefined;
    let armed = false;
    const handler = (call: StubCall): StubAnswer => {
      if (
        armed &&
        call.method === "GET" &&
        call.url.pathname === "/api/v1/contracts/42/documents" &&
        call.url.searchParams.get("folder") === folderId
      ) {
        armed = false;
        const answer = api.handler(call)!;
        return new Promise((resolve) => {
          release = () => resolve(answer);
        });
      }
      return api.handler(call);
    };
    return {
      handler,
      /** The next read of this folder is the one held open. */
      arm: () => {
        armed = true;
      },
      /** Lets the held read answer. */
      release: () => release?.(),
    };
  }

  it("keeps a filed document's panel open while an unrelated move re-reads the listings", async () => {
    // A move re-reads everything on screen, and a folder being re-read
    // draws its skeletons until the read answers. That moment is
    // presentation, not the document leaving the record — a panel that
    // closed on it would close on every write to any other row of the
    // paper, which is not what happens to a document at the record root.
    const api = filingApi(
      [document("doc-1", "loose.pdf"), readableFiled("doc-2", "signed.pdf", "f-1")],
      [folder("f-1", "Executed")],
    );
    const held = heldFolderRead(api, "f-1");
    stubApi({ signedIn: MEMBER, extra: held.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    await user.click(await within(section).findByRole("button", { name: "signed.pdf" }));
    await screen.findByRole("complementary", { name: "signed.pdf, version 1" });

    // File the other document into the same folder. The write itself
    // never touches signed.pdf.
    await user.click(await within(section).findByRole("button", { name: "Actions for loose.pdf" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to folder" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("File in"), "f-1");
    held.arm();
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    // The folder is in its skeleton moment now. The panel cannot be
    // asked for by role yet — the move dialog is still up over it until
    // the re-read answers — so what is held is asserted after release:
    // a panel this moment had closed stays closed.
    expect(within(section).getByText("Loading the documents in Executed")).toBeInTheDocument();

    held.release();
    // The re-read has landed: the moved row is drawn inside the folder
    // (as the download link its `other` family takes), and the panel
    // still holds.
    expect(await within(section).findByRole("link", { name: "loose.pdf" })).toBeVisible();
    expect(screen.getByRole("complementary", { name: "signed.pdf, version 1" })).toBeVisible();
  });

  it("keeps a filed document's panel open across the show-archived toggle", async () => {
    // The toggle re-reads every open folder in the view being switched
    // to, and a live document is in both views — so its panel has no
    // reason to close, any more than a root document's does.
    const api = filingApi(
      [readableFiled("doc-2", "signed.pdf", "f-1")],
      [folder("f-1", "Executed")],
    );
    const held = heldFolderRead(api, "f-1");
    stubApi({ signedIn: MEMBER, extra: held.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    await user.click(await within(section).findByRole("button", { name: "signed.pdf" }));
    await screen.findByRole("complementary", { name: "signed.pdf, version 1" });

    held.arm();
    await user.click(within(section).getByRole("switch", { name: "Show archived" }));

    // The folder is re-reading in the archived view, and the panel holds.
    expect(within(section).getByText("Loading the documents in Executed")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "signed.pdf, version 1" })).toBeVisible();

    held.release();
    // The re-read has landed: the folder draws its document again, and
    // the panel still holds.
    expect(await within(section).findByRole("button", { name: "signed.pdf" })).toBeVisible();
    expect(screen.getByRole("complementary", { name: "signed.pdf, version 1" })).toBeVisible();
  });

  it("keeps the panel while a folder is first expanded after a tab round trip", async () => {
    // Coming back from the Overview remounts the section with no
    // listing at all, and the round trip is survived by saying nothing
    // until there is something to say. Expanding the folder again must
    // not break that: its first read is "I have not looked yet", not
    // "the folder holds nothing", so the panel holds until the read
    // answers — and then holds still, because the document is in it.
    const api = filingApi(
      [readableFiled("doc-2", "signed.pdf", "f-1")],
      [folder("f-1", "Executed")],
    );
    const held = heldFolderRead(api, "f-1");
    stubApi({ signedIn: MEMBER, extra: held.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    await user.click(await within(section).findByRole("button", { name: "signed.pdf" }));
    await screen.findByRole("complementary", { name: "signed.pdf, version 1" });

    await user.click(screen.getByRole("link", { name: "Overview" }));
    await screen.findByLabelText("Title");
    const sections = within(await screen.findByRole("navigation", { name: "Contract sections" }));
    await user.click(sections.getByRole("link", { name: "Documents" }));
    const remounted = await documentsSection();

    held.arm();
    await user.click(await within(remounted).findByRole("button", { name: "Expand Executed" }));
    // The folder is in its first read, and the panel holds.
    expect(within(remounted).getByText("Loading the documents in Executed")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "signed.pdf, version 1" })).toBeVisible();

    held.release();
    expect(await within(remounted).findByRole("button", { name: "signed.pdf" })).toBeVisible();
    expect(screen.getByRole("complementary", { name: "signed.pdf, version 1" })).toBeVisible();
  });

  it("takes the panel with a filed document that leaves its folder's listing", async () => {
    // The other half of the same promise: the panel follows what is on
    // screen, so a filed document archived out of the live view closes
    // it — exactly as a document at the record root does.
    const api = filingApi(
      [readableFiled("doc-2", "signed.pdf", "f-1")],
      [folder("f-1", "Executed")],
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    await user.click(await within(section).findByRole("button", { name: "signed.pdf" }));
    await screen.findByRole("complementary", { name: "signed.pdf, version 1" });

    await user.click(within(section).getByRole("button", { name: "Actions for signed.pdf" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "signed.pdf, version 1" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("pages inside the folder it was pressed in", async () => {
    const api = filingApi(
      [
        document("doc-1", "first.pdf", "f-1"),
        document("doc-2", "second.pdf", "f-1"),
        document("doc-3", "loose.pdf"),
      ],
      [folder("f-1", "Executed")],
      { pageSize: 1 },
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    expect(await within(section).findByText("first.pdf")).toBeVisible();
    expect(within(section).queryByText("second.pdf")).toBeNull();

    // The foot belongs to the folder and says so, and pressing it
    // appends inside the folder rather than at the record root.
    await user.click(within(section).getByRole("button", { name: "Show more in Executed" }));

    expect(await within(section).findByText("second.pdf")).toBeVisible();
    expect(within(section).getByText("first.pdf")).toBeVisible();
  });

  it("files a document into a folder from its own menu", async () => {
    const api = filingApi([document("doc-1", "signed.pdf")], [folder("f-1", "Executed")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(
      await within(section).findByRole("button", { name: "Actions for signed.pdf" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Move to folder" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("File in"), "f-1");
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toEqual({ url: "/api/v1/documents/doc-1", body: { folderId: "f-1" } });
    // The row has left the record root, and the folder's count says so.
    await waitFor(() => expect(within(section).queryByText("signed.pdf")).toBeNull());
    expect(await within(section).findByText("1 document")).toBeVisible();
  });

  it("moves a filed document back out to the record root", async () => {
    const api = filingApi([document("doc-1", "signed.pdf", "f-1")], [folder("f-1", "Executed")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    await user.click(
      await within(section).findByRole("button", { name: "Actions for signed.pdf" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Move to folder" }));
    const dialog = await screen.findByRole("dialog");
    // The empty value is the record root, because it is the absence of a
    // folder rather than a folder with an id.
    await user.selectOptions(within(dialog).getByLabelText("File in"), "");
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toEqual({ url: "/api/v1/documents/doc-1", body: { folderId: null } });
    expect(await within(section).findByText("Empty")).toBeVisible();
  });

  it("keeps a refused move inside the dialog, in the server's own words", async () => {
    const api = filingApi([document("doc-1", "signed.pdf")], [folder("f-1", "Executed")], {
      moveFails: "This contract is archived. Restore it before changing its folders.",
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(
      await within(section).findByRole("button", { name: "Actions for signed.pdf" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Move to folder" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("File in"), "f-1");
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    // The refusal is a thing the person can act on, so it is said where
    // they are looking and the dialog stays open for them to cancel or
    // choose again.
    expect(
      await within(dialog).findByText(
        "This contract is archived. Restore it before changing its folders.",
      ),
    ).toBeVisible();
    expect(within(section).getByText("signed.pdf")).toBeVisible();
  });

  it("reads a closed folder fresh after a move filed something into it", async () => {
    const api = filingApi([document("doc-1", "signed.pdf")], [folder("f-1", "Executed")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    // Open the folder while it is empty, so the section holds a listing
    // for it, then close it again.
    const section = await documentsSection();
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    await within(section).findByText("Empty");
    await user.click(within(section).getByRole("button", { name: "Collapse Executed" }));

    // File the loose document into the closed folder.
    await user.click(
      await within(section).findByRole("button", { name: "Actions for signed.pdf" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Move to folder" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("File in"), "f-1");
    await user.click(within(dialog).getByRole("button", { name: "Move" }));
    await waitFor(() => expect(within(section).queryByText("signed.pdf")).toBeNull());

    // Reopening draws what the folder holds now, not the listing it held
    // before the move: a Move names any folder, open or not, so a cache
    // kept across the write would sit beside a count that has moved on.
    await user.click(within(section).getByRole("button", { name: "Expand Executed" }));
    expect(await within(section).findByText("signed.pdf")).toBeVisible();
  });

  it("names every destination by its whole path", async () => {
    const api = filingApi(
      [document("doc-1", "letter.pdf")],
      [folder("f-1", "Correspondence"), folder("f-2", "2026", "f-1")],
    );
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(
      await within(section).findByRole("button", { name: "Actions for letter.pdf" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Move to folder" }));

    const dialog = await screen.findByRole("dialog");
    // A bare "2026" says nothing when two groupings each have one.
    expect(
      within(dialog)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["The contract itself", "Correspondence", "Correspondence / 2026"]);
  });

  it("offers a Contributor only Version append inside the tree", async () => {
    const api = filingApi(
      [document("doc-1", "signed.pdf", "f-1")],
      [folder("f-1", "Executed")],
      {},
      [person("u1", "creator"), person("u3", "contributor")],
    );
    stubApi({ signedIn: CONTRIBUTOR, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    // The folder opens and its documents read: the record reads the same
    // for everyone on it (DD-015).
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    expect(await within(section).findByText("signed.pdf")).toBeVisible();
    // Appending a Version to this supporting chain is the only write.
    // Filing and folder administration remain absent rather than dead.
    await user.click(within(section).getByRole("button", { name: "Actions for signed.pdf" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Add version"]);
  });

  it("says a folder's documents are on their way while they load", async () => {
    const api = filingApi([document("doc-1", "signed.pdf", "f-1")], [folder("f-1", "Executed")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    // Fired rather than driven through userEvent: the read is what is
    // being asserted, and userEvent settles it before it can be seen.
    fireEvent.click(await within(section).findByRole("button", { name: "Expand Executed" }));

    // Said once for the folder, to a reader who cannot see the skeleton
    // rows (DES-033).
    expect(within(section).getByText("Loading the documents in Executed")).toBeInTheDocument();
    expect(await within(section).findByText("signed.pdf")).toBeVisible();
    // And it stops being said once they are there.
    expect(within(section).queryByText("Loading the documents in Executed")).toBeNull();
  });
});

describe("the multi-file batch on the contract record (M13/4, DOC-011, DES-033)", () => {
  const version = (over: Record<string, unknown> = {}) => ({
    id: "ver-1",
    versionNumber: 1,
    kind: "draft_ours",
    note: null,
    originalFilename: "signed.pdf",
    mimeType: "text/plain",
    renderFamily: "other",
    byteSize: 10,
    checksumSha256: "a".repeat(64),
    uploadedBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
    createdAt: "2026-08-11T09:00:00.000Z",
    isCurrent: true,
    isExecuted: false,
    ...over,
  });

  const document = (id: string, title: string, folderId: string | null = null) => ({
    id,
    title,
    description: null,
    isPrimary: false,
    versions: [version({ id: `ver-${id}`, originalFilename: title })],
    archivedAt: null,
    isConfidential: false,
    folderId,
    createdBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
    createdAt: "2026-08-11T09:00:00.000Z",
    updatedAt: "2026-08-11T09:00:00.000Z",
  });

  const folder = (id: string, name: string) => ({
    id,
    name,
    parentId: null,
    createdAt: "2026-08-15T09:00:00.000Z",
    updatedAt: "2026-08-15T09:00:00.000Z",
  });

  /**
   * The record, its folders, its paper, and the upload route a batch is
   * N calls to.
   *
   * The seam is the one a single upload already goes through, because
   * that is the whole decision: nothing on the server knows a batch
   * happened. So the stub keeps the rules that route keeps — the first
   * file on a record with no paper takes the primary designation
   * (CTR-014), and every file lands as a new document at version 1.
   */
  function batchApi(
    initial: Record<string, unknown>[],
    folders: Record<string, unknown>[] = [],
    options: {
      /** Filenames the seam refuses, and how. `413` is the deployment's
       * size ceiling, which no retry can get past. */
      refuse?: Record<string, { status: number; detail: string }>;
      /** Filenames refused on the first attempt only, so a retry can be
       * seen to land. */
      refuseOnce?: Record<string, { status: number; detail: string }>;
      /** Held open until the test releases them, so what is in flight
       * at once can be counted. */
      hold?: boolean;
    } = {},
    team = [person("u1", "creator")],
  ) {
    const record = recordApi(contractRow(), team);
    let paper = initial;
    /** Every upload the batch sent, in order: the filename it carried,
     * the kind that rode with it, and where it said the file goes
     * (M13/5). */
    const uploaded: {
      name: string;
      kind: string;
      folderId: string | null;
      folderPath: string | null;
    }[] = [];
    /** Every folder a drop asked for by path — the empty directories of
     * the dropped tree (DOC-011). */
    const recreated: { path: string; parentId: string | null }[] = [];
    /** The filenames whose answers are still being held. */
    const held: (() => void)[] = [];
    /** The most files that were ever in flight at one moment. */
    let inFlight = 0;
    let peak = 0;
    /** Where the last upload and the last folder read sit relative to
     * each other. A finished run re-reads the record's paper and its
     * folder set *after* it marks its last row, so a test that stopped
     * at the row would end with two fetches still in flight — and a
     * fetch that outlives the stub is a real request at a real port. */
    let sequence = 0;
    let lastUpload = 0;
    let lastFolderRead = 0;
    const attempts = new Map<string, number>();
    const listing = (folderId: string | null) =>
      paper.filter((row) => (row.folderId ?? null) === folderId);
    const handler = (call: StubCall): Response | undefined => {
      const { pathname } = call.url;
      if (pathname === "/api/v1/contracts/42/folders" && call.method === "GET") {
        lastFolderRead = ++sequence;
        return json(200, {
          folders: folders.map((row) => ({
            ...row,
            documentCount: listing(row.id as string).length,
          })),
        });
      }
      if (pathname === "/api/v1/contracts/42/documents" && call.method === "GET") {
        const asked = call.url.searchParams.get("folder");
        const rows = asked === null ? paper : listing(asked === "root" ? null : asked);
        return json(200, { documents: rows, nextCursor: null });
      }
      if (pathname === "/api/v1/contracts/42/folders" && call.method === "POST") {
        // The drop's own shape: a path rather than a name, which the
        // seam find-or-creates and narrates not at all (DOC-011).
        const body = call.body as { path?: string; parentId?: string };
        recreated.push({ path: String(body.path), parentId: body.parentId ?? null });
        return json(201, { folders });
      }
      if (pathname === "/api/v1/contracts/42/documents" && call.method === "POST") {
        const form = call.body as FormData;
        const file = form.get("file") as File;
        lastUpload = ++sequence;
        uploaded.push({
          name: file.name,
          kind: String(form.get("kind")),
          folderId: form.has("folderId") ? String(form.get("folderId")) : null,
          folderPath: form.has("folderPath") ? String(form.get("folderPath")) : null,
        });
        const tried = (attempts.get(file.name) ?? 0) + 1;
        attempts.set(file.name, tried);
        const refusal =
          options.refuse?.[file.name] ??
          (tried === 1 ? options.refuseOnce?.[file.name] : undefined);
        if (refusal) return problem(refusal.status, refusal.detail);
        const added = {
          ...document(`doc-${paper.length + 1}`, file.name),
          // The first document on a record is the instrument, and every
          // one after it is a loose attachment (CTR-014).
          isPrimary: paper.length === 0,
          versions: [version({ id: `ver-${file.name}`, originalFilename: file.name })],
        };
        paper = [added, ...paper];
        return json(201, { document: added });
      }
      return record.handler(call);
    };
    /** The upload answer, delayed when the test asked for it, so the
     * pool's bound is observable rather than inferred. */
    const gated = (call: StubCall): StubAnswer => {
      const isUpload =
        call.url.pathname === "/api/v1/contracts/42/documents" && call.method === "POST";
      if (!isUpload || !options.hold) return handler(call);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const answer = handler(call)!;
      return new Promise<Response>((resolve) => {
        held.push(() => {
          inFlight -= 1;
          resolve(answer);
        });
      });
    };
    return {
      handler: gated,
      uploaded,
      recreated,
      /** The filenames the batch sent, in order. */
      names: () => uploaded.map((one) => one.name),
      release: () => {
        const waiting = [...held];
        held.length = 0;
        for (const done of waiting) done();
      },
      peak: () => peak,
      paper: () => paper,
      /** Nothing the batch started is still on its way: either no file
       * was ever sent, or the re-read that follows the last one has
       * answered. */
      quiet: () => uploaded.length === 0 || lastFolderRead > lastUpload,
    };
  }

  const documentsSection = () => screen.findByRole("region", { name: /^Documents/ });

  const file = (name: string, bytes = "some bytes") =>
    new File([bytes], name, { type: "application/pdf" });

  it("opens one confirmation for a whole drop, and creates nothing until it is confirmed", async () => {
    const api = batchApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    dropOn(section, [file("MSA_2019_signed.pdf"), file("SOW1_2020_signed.pdf")]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Import 2 files" })).toBeVisible();
    // What will be created, named — and where it will land, stated
    // rather than offered as a choice: the drop already answered that.
    expect(within(dialog).getByText("MSA_2019_signed.pdf")).toBeVisible();
    expect(within(dialog).getByText("SOW1_2020_signed.pdf")).toBeVisible();
    expect(within(dialog).getByText("Record root")).toBeVisible();
    expect(within(dialog).getByText("Set by the drop")).toBeVisible();
    expect(within(dialog).getByText("Nothing is created until you import.")).toBeVisible();
    expect(api.uploaded).toEqual([]);
  });

  it("collects one kind for the whole batch and no note, and sends it with every file", async () => {
    const api = batchApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(section, [file("one.pdf"), file("two.pdf")]);
    const dialog = await screen.findByRole("dialog");
    // One control over the kinds, defaulting to our own draft, and no
    // per-file ceremony beside it (DOC-011).
    const kind = within(dialog).getByLabelText("Version kind");
    expect(kind).toHaveValue("draft_ours");
    expect(within(dialog).queryByLabelText("Note")).toBeNull();
    await user.selectOptions(kind, "executed");
    await user.click(within(dialog).getByRole("button", { name: "Import 2 files" }));

    await waitFor(() => expect(api.uploaded).toHaveLength(2));
    expect(api.names().toSorted()).toEqual(["one.pdf", "two.pdf"]);
    // One kind rode with every file of the batch, and it is the one the
    // dialog collected.
    expect(api.uploaded.map((one) => one.kind)).toEqual(["executed", "executed"]);
    // The dialog closes only on Done, so a reader who retried can see
    // whether the second attempt worked (DES-033 §11).
    await user.click(await within(dialog).findByRole("button", { name: "Done" }));
    // Both rows land, both as new documents at version 1, and the
    // section counts them.
    expect(await within(section).findByText("one.pdf")).toBeVisible();
    expect(within(section).getByRole("img", { name: "2 documents" })).toBeVisible();
    // The run re-reads the record's paper and its folders after its last
    // row settles. Waited out here, so no fetch outlives the stub.
    await waitFor(() => expect(api.quiet()).toBe(true));
  });

  it("cancels the batch, creating nothing", async () => {
    const api = batchApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(section, [file("one.pdf"), file("two.pdf")]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.uploaded).toEqual([]);
    expect(within(section).getByText("No documents on this contract yet.")).toBeVisible();
  });

  it("leaves exactly one primary when a batch lands on a record with no paper", async () => {
    const api = batchApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(section, [file("one.pdf"), file("two.pdf"), file("three.pdf")]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import 3 files" }));

    await waitFor(() => expect(api.uploaded).toHaveLength(3));
    await user.click(await within(dialog).findByRole("button", { name: "Done" }));
    // The designation is the seam's, taken by whichever file landed
    // first — the batch never asks for it and never sets it twice.
    expect(await within(section).findByText("three.pdf")).toBeVisible();
    expect(within(section).getAllByText("Primary")).toHaveLength(1);
    // The run re-reads the record's paper and its folders after its last
    // row settles. Waited out here, so no fetch outlives the stub.
    await waitFor(() => expect(api.quiet()).toBe(true));
  });

  it("reports a failed file on its own row and retries that file alone", async () => {
    const api = batchApi([], [], {
      refuseOnce: { "two.pdf": { status: 502, detail: "The storage driver did not answer." } },
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(section, [file("one.pdf"), file("two.pdf")]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import 2 files" }));

    // One file failed and says why, in the seam's own sentence. The
    // other one landed: a refusal costs its own file and nothing else.
    expect(await within(dialog).findByText("The storage driver did not answer.")).toBeVisible();
    expect(within(dialog).getByRole("heading", { name: "Imported 1 of 2 files" })).toBeVisible();
    expect(api.names().toSorted()).toEqual(["one.pdf", "two.pdf"]);

    await user.click(within(dialog).getByRole("button", { name: "Retry two.pdf" }));

    // Only the failed file went again, so nothing can land twice.
    await waitFor(() => expect(api.uploaded).toHaveLength(3));
    expect(api.names().at(-1)).toBe("two.pdf");
    expect(
      await within(dialog).findByRole("heading", { name: "Imported 2 of 2 files" }),
    ).toBeVisible();
    // The run re-reads the record's paper and its folders after its last
    // row settles. Waited out here, so no fetch outlives the stub.
    await waitFor(() => expect(api.quiet()).toBe(true));
  });

  it("names the deployment's limit on an oversized file, offers no retry, and lands the rest", async () => {
    const api = batchApi([], [], {
      refuse: {
        "enormous.pdf": {
          status: 413,
          detail: "That file is over the 100 MB upload limit.",
        },
      },
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(section, [file("enormous.pdf"), file("small.pdf")]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import 2 files" }));

    expect(
      await within(dialog).findByText("That file is over the 100 MB upload limit."),
    ).toBeVisible();
    // No retry anywhere: the same file earns the same answer, and a
    // control that cannot succeed reads as "try again" when the answer
    // will not change (DES-033 §11).
    expect(within(dialog).queryByRole("button", { name: /^Retry/ })).toBeNull();
    // The rest of the batch went on regardless — the ceiling is per
    // file, not per drop.
    expect(within(dialog).getByRole("heading", { name: "Imported 1 of 2 files" })).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(await within(section).findByText("small.pdf")).toBeVisible();
    // The run re-reads the record's paper and its folders after its last
    // row settles. Waited out here, so no fetch outlives the stub.
    await waitFor(() => expect(api.quiet()).toBe(true));
  });

  it("offers no retry on any refusal the file itself earned, not only the size one", async () => {
    const api = batchApi([], [], {
      refuse: {
        "bad_name.pdf": {
          status: 400,
          detail: "That file name is too long.",
        },
      },
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(section, [file("bad_name.pdf"), file("small.pdf")]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import 2 files" }));

    expect(await within(dialog).findByText("That file name is too long.")).toBeVisible();
    // The size ceiling is one instance of the rule, not the rule. The
    // seam refuses a name, a folder path and a version kind the same
    // way, and the same file earns the same answer every time, so no
    // retry is offered for any of them (DES-033 §11).
    expect(within(dialog).queryByRole("button", { name: /^Retry/ })).toBeNull();
    expect(within(dialog).getByRole("heading", { name: "Imported 1 of 2 files" })).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    // The run re-reads the record's paper and its folders after its last
    // row settles. Waited out here, so no fetch outlives the stub.
    await waitFor(() => expect(api.quiet()).toBe(true));
  });

  it("still offers retry when the seam refused for a reason the file did not earn", async () => {
    const api = batchApi([], [], {
      refuse: {
        "unlucky.pdf": {
          status: 503,
          detail: "The server is not taking uploads right now.",
        },
      },
    });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(section, [file("unlucky.pdf")]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import 1 file" }));

    expect(
      await within(dialog).findByText("The server is not taking uploads right now."),
    ).toBeVisible();
    // A bad minute on the server is a fact about the moment, not about
    // this file, so a second attempt genuinely can end differently.
    expect(within(dialog).getByRole("button", { name: "Retry unlucky.pdf" })).toBeVisible();
    await waitFor(() => expect(api.quiet()).toBe(true));
  });

  it("keeps at most three uploads in flight at once", async () => {
    const api = batchApi([], [], { hold: true });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(
      section,
      [1, 2, 3, 4, 5, 6].map((n) => file(`file-${n}.pdf`)),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import 6 files" }));

    // Three went, three are waiting for a worker: a 200-file import
    // does not open 200 connections.
    await waitFor(() => expect(api.uploaded).toHaveLength(3));
    expect(api.peak()).toBe(3);
    api.release();
    await waitFor(() => expect(api.uploaded).toHaveLength(6));
    api.release();
    expect(api.peak()).toBe(3);
    // The run re-reads the record's paper and its folders after its last
    // row settles. Waited out here, so no fetch outlives the stub.
    await waitFor(() => expect(api.quiet()).toBe(true));
  });

  it("hands a multi-file pick from the upload dialog to the same confirmation", async () => {
    const api = batchApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(within(section).getByRole("button", { name: "Upload" }));
    const composer = await screen.findByRole("dialog");
    // The drop's pointer-free twin: the picker takes many, and many is
    // a batch wherever it came from.
    await user.upload(within(composer).getByLabelText("File", { selector: "input" }), [
      file("one.pdf"),
      file("two.pdf"),
    ]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Import 2 files" })).toBeVisible();
    // The drop said where; a pick did not, so the line that says so is
    // absent rather than wrong.
    expect(within(dialog).queryByText("Set by the drop")).toBeNull();
    expect(api.uploaded).toEqual([]);
  });

  it("keeps a single pick in the composer, where the note still belongs", async () => {
    const api = batchApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(within(section).getByRole("button", { name: "Upload" }));
    const composer = await screen.findByRole("dialog");
    await user.upload(
      within(composer).getByLabelText("File", { selector: "input" }),
      file("one.pdf"),
    );

    // One file is one round, and a round takes a note.
    expect(within(composer).getByLabelText("Note")).toBeVisible();
    expect(within(composer).getByText("one.pdf")).toBeVisible();
    expect(within(composer).queryByRole("heading", { name: /^Import/ })).toBeNull();
  });

  it("re-reads every listing after a batch, including a folder that was closed", async () => {
    const api = batchApi([document("doc-1", "filed.pdf", "f-1")], [folder("f-1", "Executed")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    // Opened, then closed: the folder's listing is cached, and a write
    // that does not evict it would draw it as it stood before.
    await user.click(await within(section).findByRole("button", { name: "Expand Executed" }));
    expect(await within(section).findByText("filed.pdf")).toBeVisible();
    await user.click(within(section).getByRole("button", { name: "Collapse Executed" }));

    dropOn(section, [file("dropped.pdf")]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import 1 file" }));
    await waitFor(() => expect(api.uploaded).toHaveLength(1));
    await user.click(await within(dialog).findByRole("button", { name: "Done" }));

    // The record root has the new document, and the folder still
    // answers what is in it when it is opened again.
    expect(await within(section).findByText("dropped.pdf")).toBeVisible();
    await user.click(within(section).getByRole("button", { name: "Expand Executed" }));
    expect(await within(section).findByText("filed.pdf")).toBeVisible();
    expect(within(section).getByRole("img", { name: "2 documents" })).toBeVisible();
    // The run re-reads the record's paper and its folders after its last
    // row settles. Waited out here, so no fetch outlives the stub.
    await waitFor(() => expect(api.quiet()).toBe(true));
  });

  it("opens nothing for a drop carrying nothing at all", async () => {
    const api = batchApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    dropOn(section, []);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.uploaded).toEqual([]);
  });

  it("takes the loose files of a drop that also carried a directory, and the directory with them", async () => {
    const api = batchApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    dropOn(section, [file("loose.pdf"), dir("Legacy contracts", [file("MSA.pdf")])]);

    // Two files, not one: the directory is walked rather than left
    // alone, and the file inside it comes with it (DOC-011).
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Import 2 files" })).toBeVisible();
    expect(within(dialog).getByText("loose.pdf")).toBeVisible();
    expect(within(dialog).getByText("Legacy contracts")).toBeVisible();
    expect(within(dialog).getByText("MSA.pdf")).toBeVisible();
  });

  it("stops starting new uploads on Cancel remaining, and lets the ones in flight finish", async () => {
    const api = batchApi([], [], { hold: true });
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(
      section,
      [1, 2, 3, 4, 5].map((n) => file(`file-${n}.pdf`)),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import 5 files" }));
    await waitFor(() => expect(api.uploaded).toHaveLength(3));

    await user.click(within(dialog).getByRole("button", { name: "Cancel remaining" }));
    api.release();

    // A request that has left cannot be recalled, so the three in flight
    // land. The two nobody had started say so and offer the retry, which
    // is what a file nobody sent deserves.
    expect(
      await within(dialog).findByRole("heading", { name: "Imported 3 of 5 files" }),
    ).toBeVisible();
    expect(api.uploaded).toHaveLength(3);
    expect(within(dialog).getAllByText("Cancelled before it was uploaded.")).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: "Retry 2 files" })).toBeVisible();
    // The run re-reads the record's paper and its folders after its last
    // row settles. Waited out here, so no fetch outlives the stub.
    await waitFor(() => expect(api.quiet()).toBe(true));
  });

  it("takes no drop on an archived record", async () => {
    const record = recordApi(contractRow({ archivedAt: "2026-08-01T00:00:00.000Z" }), [
      person("u1", "creator"),
    ]);
    stubApi({ signedIn: MEMBER, extra: record.handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    dropOn(section, [file("one.pdf")]);

    // A frozen record's paper stays frozen, drop included.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(section).queryByText(/^Drop files here/)).toBeNull();
  });

  it("lists the first files of a long batch and says how many it did not draw", async () => {
    const api = batchApi([]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    dropOn(
      section,
      Array.from({ length: 10 }, (_, index) => file(`file-${index}.pdf`)),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Import 10 files" })).toBeVisible();
    expect(within(dialog).getByText("file-0.pdf")).toBeVisible();
    expect(within(dialog).queryByText("file-9.pdf")).toBeNull();
    expect(within(dialog).getByText("…and 4 more files")).toBeVisible();
  });

  it("takes a drop anywhere on the page, and files it at the record root", async () => {
    stubApi({ signedIn: MEMBER, extra: batchApi([]).handler });
    renderAt("/contracts/42/documents");

    // Somebody dragging a file into the window has already said what
    // they want; the section is not a target they should have to find.
    await documentsSection();
    dropOn(globalThis.document.body, [file("one.pdf")]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Import 1 file" })).toBeVisible();
    expect(within(dialog).getByText("Record root")).toBeVisible();
  });

  it("takes no drop on the page of an archived record", async () => {
    const record = recordApi(contractRow({ archivedAt: "2026-08-01T00:00:00.000Z" }), [
      person("u1", "creator"),
    ]);
    stubApi({ signedIn: MEMBER, extra: record.handler });
    renderAt("/contracts/42/documents");

    await documentsSection();
    dropOn(globalThis.document.body, [file("one.pdf")]);

    // Frozen is frozen off the section as well as on it.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves a drop that carries no file to the page it landed on", async () => {
    stubApi({ signedIn: MEMBER, extra: batchApi([]).handler });
    renderAt("/contracts/42/documents");

    await documentsSection();

    // Dragged text, or a dragged link — the section has no use for it.
    // It must not open the importer, and it must not take the drop away
    // from whatever else on the page would have answered for it.
    const dataTransfer = { types: ["text/plain"], files: [], items: [] };
    fireEvent.dragOver(globalThis.document.body, { dataTransfer });
    const dropped = fireEvent.drop(globalThis.document.body, { dataTransfer });

    expect(screen.queryByRole("dialog")).toBeNull();
    // `fireEvent` answers false when a listener called preventDefault.
    expect(dropped).toBe(true);
  });
});

/**
 * Folder drop (M13/5, DOC-011, DES-033): the structure survives.
 *
 * The traversal is exercised through the route tests like every other
 * interaction, per M13's seam decision. jsdom has neither drag nor the
 * directory-entry API, so a dropped tree is fed in as **synthetic
 * `DataTransfer` entry objects** — the shape the walk reads and nothing
 * else — and everything below is asserted at what the section drew and
 * what it sent.
 *
 * **The client never creates a folder for a file.** Each upload carries
 * its own path and the seam find-or-creates the chain under the owning
 * contract's row lock, which is what makes several files of one folder
 * converge on one folder. So what is asserted here is the path each
 * upload carried, not a folder call the client did not make. The only
 * folders asked for on their own are the empty directories, which no
 * upload would recreate.
 */
describe("dropping a folder tree on the contract record (M13/5, DOC-011, DES-033)", () => {
  const version = (over: Record<string, unknown> = {}) => ({
    id: "ver-1",
    versionNumber: 1,
    kind: "draft_ours",
    note: null,
    originalFilename: "signed.pdf",
    mimeType: "text/plain",
    renderFamily: "other",
    byteSize: 10,
    checksumSha256: "a".repeat(64),
    uploadedBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
    createdAt: "2026-08-11T09:00:00.000Z",
    isCurrent: true,
    isExecuted: false,
    ...over,
  });

  const document = (id: string, title: string, folderId: string | null = null) => ({
    id,
    title,
    description: null,
    isPrimary: false,
    versions: [version({ id: `ver-${id}`, originalFilename: title })],
    archivedAt: null,
    isConfidential: false,
    folderId,
    createdBy: { id: "u2", displayName: "Nadia Counsel", image: null, archived: false },
    createdAt: "2026-08-11T09:00:00.000Z",
    updatedAt: "2026-08-11T09:00:00.000Z",
  });

  const folderRow = (id: string, name: string, parentId: string | null = null) => ({
    id,
    name,
    parentId,
    documentCount: 0,
    createdAt: "2026-08-15T09:00:00.000Z",
    updatedAt: "2026-08-15T09:00:00.000Z",
  });

  /** The record, its paper, its folders, and every upload's destination
   * as it arrived. */
  function dropApi(folders: Record<string, unknown>[] = []) {
    const record = recordApi(contractRow(), [person("u1", "creator")]);
    let paper: Record<string, unknown>[] = [];
    const uploaded: { name: string; folderId: string | null; folderPath: string | null }[] = [];
    const recreated: { path: string; parentId: string | null }[] = [];
    let folderReads = 0;
    const handler = (call: StubCall): Response | undefined => {
      const { pathname } = call.url;
      if (pathname === "/api/v1/contracts/42/folders" && call.method === "GET") {
        folderReads += 1;
        return json(200, { folders });
      }
      if (pathname === "/api/v1/contracts/42/folders" && call.method === "POST") {
        const body = call.body as { path?: string; parentId?: string };
        recreated.push({ path: String(body.path), parentId: body.parentId ?? null });
        return json(201, { folders });
      }
      if (pathname === "/api/v1/contracts/42/documents" && call.method === "GET") {
        const asked = call.url.searchParams.get("folder");
        return json(200, {
          documents: asked === null || asked === "root" ? paper : [],
          nextCursor: null,
        });
      }
      if (pathname === "/api/v1/contracts/42/documents" && call.method === "POST") {
        const form = call.body as FormData;
        const file = form.get("file") as File;
        uploaded.push({
          name: file.name,
          folderId: form.has("folderId") ? String(form.get("folderId")) : null,
          folderPath: form.has("folderPath") ? String(form.get("folderPath")) : null,
        });
        const added = {
          ...document(`doc-${uploaded.length}`, file.name),
          isPrimary: uploaded.length === 1,
          versions: [version({ id: `ver-${file.name}`, originalFilename: file.name })],
        };
        paper = [added, ...paper];
        return json(201, { document: added });
      }
      return record.handler(call);
    };
    return {
      handler,
      uploaded,
      recreated,
      /** Where each named file said it was going. */
      pathOf: (name: string) => uploaded.find((one) => one.name === name)?.folderPath ?? null,
      folderReads: () => folderReads,
    };
  }

  const documentsSection = () => screen.findByRole("region", { name: /^Documents/ });

  const file = (name: string, bytes = "some bytes") =>
    new File([bytes], name, { type: "application/pdf" });

  /** The legacy book of the demo sentence: two levels of folders, files
   * at both, and one directory holding nothing. */
  const legacyBook = () =>
    dir("Legacy contracts", [
      dir("Executed", [file("MSA_2019_signed.pdf"), file("SOW1_2020_signed.pdf")]),
      dir("Correspondence", [dir("2019", [file("notice.pdf")])]),
      dir("Signature packets"),
      file("cover_letter.pdf"),
    ]);

  it("shows the folder tree it will create before it creates anything", async () => {
    const api = dropApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    dropOn(section, [legacyBook()]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Import 4 files" })).toBeVisible();
    // The structure, drawn as a structure (DES-033 §9): the dropped
    // directory, what it holds, and the files inside each level. Read
    // off the summary list itself, because the version-kind control
    // below it offers a kind called Executed too.
    const summary = within(dialog).getByRole("list", { name: "What this import will create" });
    expect(
      within(summary)
        .getAllByRole("listitem")
        .map((line) => line.textContent),
    ).toEqual([
      "Legacy contracts4 folders · 4 files",
      "Correspondence1 folder · 1 file",
      "20191 file",
      "notice.pdf10 byte",
      "Executed2 files",
      "MSA_2019_signed.pdf10 byte",
      "SOW1_2020_signed.pdf10 byte",
      // An empty directory of the dropped tree is drawn too, because it
      // is part of the structure that arrived and nothing else will
      // recreate it.
      "Signature packetsEmpty",
      "cover_letter.pdf10 byte",
    ]);
    expect(within(dialog).getByText("Folder structure is kept")).toBeVisible();
    // And nothing is created until it is confirmed.
    expect(api.uploaded).toEqual([]);
    expect(api.recreated).toEqual([]);
  });

  it("sends every file with the folder path it sat at in the dropped tree", async () => {
    const api = dropApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(section, [legacyBook()]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import 4 files" }));

    await waitFor(() => expect(api.uploaded).toHaveLength(4));
    // The path each file carried is the path it sat at, root-first —
    // the seam find-or-creates that chain under the contract's row lock,
    // so nothing here co-ordinates the folders and nothing here creates
    // one.
    expect(api.pathOf("MSA_2019_signed.pdf")).toBe("Legacy contracts/Executed");
    expect(api.pathOf("SOW1_2020_signed.pdf")).toBe("Legacy contracts/Executed");
    expect(api.pathOf("notice.pdf")).toBe("Legacy contracts/Correspondence/2019");
    expect(api.pathOf("cover_letter.pdf")).toBe("Legacy contracts");
    // Every file lands at the record root's own level of the tree, so
    // none of them names a folder that was already there.
    expect(api.uploaded.every((one) => one.folderId === null)).toBe(true);
  });

  it("recreates the empty directories of the dropped tree on their own", async () => {
    const api = dropApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(section, [legacyBook()]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import 4 files" }));

    // No upload would recreate a directory that held nothing, so it is
    // asked for by path — every level above it may be missing too, and
    // the seam makes the chain segment by segment (DOC-011).
    await waitFor(() => expect(api.recreated).toHaveLength(1));
    expect(api.recreated[0]).toEqual({
      path: "Legacy contracts/Signature packets",
      parentId: null,
    });
    // And the full ones are not asked for at all: their files made them.
    await waitFor(() => expect(api.uploaded).toHaveLength(4));
    expect(api.recreated).toHaveLength(1);
  });

  it("imports a drop that carried only structure — empty directories and not one file", async () => {
    const api = dropApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    // A tree of nothing but directories is a real gesture — somebody
    // scaffolding the folders before the paper arrives — and DOC-011
    // promises the structure that arrives is the structure that was
    // dropped, files or none.
    dropOn(section, [dir("Legacy contracts", [dir("Executed"), dir("Redlines")])]);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Import folders" })).toBeVisible();
    const before = api.folderReads();
    await user.click(within(dialog).getByRole("button", { name: "Import folders" }));

    // The deepest leaves carry their whole chain, so recreating them
    // recreates every level above — and no upload is sent, because
    // there is no file to send.
    await waitFor(() => expect(api.recreated).toHaveLength(2));
    expect(api.recreated).toEqual([
      { path: "Legacy contracts/Executed", parentId: null },
      { path: "Legacy contracts/Redlines", parentId: null },
    ]);
    expect(api.uploaded).toEqual([]);
    // Its work done, the dialog closes over a section that has read its
    // folders again: the tree behind it is the answer.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.folderReads()).toBeGreaterThan(before);
  });

  it("reads the record's folders again once the import settles", async () => {
    const api = dropApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    const before = api.folderReads();
    dropOn(section, [dir("Legacy", [file("MSA.pdf")])]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import 1 file" }));

    // The folders the import created are the seam's, so the section
    // cannot know them: it reads the set again rather than guessing at
    // what the drop made.
    await waitFor(() => expect(api.folderReads()).toBeGreaterThan(before));
  });

  it("creates nothing at all when the drop is cancelled, folders included", async () => {
    const api = dropApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(section, [legacyBook()]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.uploaded).toEqual([]);
    expect(api.recreated).toEqual([]);
  });

  it("files a drop onto a folder row into that folder, and a tree dropped there beneath it", async () => {
    const api = dropApi([folderRow("f-1", "Executed")]);
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    const row = (await within(section).findByText("Executed")).closest("tr")!;
    dropOn(row, [file("signed.pdf"), dir("2019", [file("notice.pdf")])]);

    const dialog = await screen.findByRole("dialog");
    // The readout names the folder the gesture landed on rather than the
    // record root, because that is where the drop said the files go.
    // Read off the readout strip itself, because the version-kind
    // control below it offers a kind called Executed too.
    const readout = within(dialog).getByText("Set by the drop").parentElement!;
    expect(within(readout).getByText("Executed")).toBeVisible();
    expect(within(dialog).queryByText("Record root")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Import 2 files" }));

    await waitFor(() => expect(api.uploaded).toHaveLength(2));
    // Both files name the folder they were dropped on. The one that sat
    // in a directory names the chain beneath it too, so a tree dropped
    // on a row is recreated inside that row.
    expect(api.uploaded.every((one) => one.folderId === "f-1")).toBe(true);
    expect(api.pathOf("signed.pdf")).toBeNull();
    expect(api.pathOf("notice.pdf")).toBe("2019");
  });

  it("draws each file's destination on its own row while the import runs", async () => {
    const api = dropApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(section, [dir("Legacy", [dir("Executed", [file("MSA.pdf")])])]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import 1 file" }));

    // The path before the name, so a long import of a nested tree reads
    // as the tree rather than as a list of names (DES-033 §11).
    expect(await within(dialog).findByText("Legacy/Executed/")).toBeVisible();
    await waitFor(() => expect(api.uploaded).toHaveLength(1));
  });

  it("refuses one bad path at the seam and lands the rest of the drop", async () => {
    const api = dropApi();
    const refusing = (call: StubCall): StubAnswer => {
      const isUpload =
        call.url.pathname === "/api/v1/contracts/42/documents" && call.method === "POST";
      if (isUpload) {
        const form = call.body as FormData;
        if (String(form.get("folderPath")).includes("Broken")) {
          return problem(400, "A folder path cannot have an empty segment.");
        }
      }
      return api.handler(call);
    };
    stubApi({ signedIn: MEMBER, extra: refusing });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    dropOn(section, [
      dir("Legacy", [dir("Executed", [file("good.pdf")]), dir("Broken", [file("bad.pdf")])]),
    ]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Import 2 files" }));

    // The refused file says why, in the seam's own sentence, and the
    // file beside it lands: a bad path costs its own file and never the
    // batch (DOC-011).
    expect(
      await within(dialog).findByText("A folder path cannot have an empty segment."),
    ).toBeVisible();
    expect(
      await within(dialog).findByText("1 file failed. The other 1 is on the contract."),
    ).toBeVisible();
    expect(api.uploaded.map((one) => one.name)).toEqual(["good.pdf"]);
  });

  it("takes a whole directory from the picker, structure and all, without a pointer", async () => {
    const api = dropApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");
    const user = userEvent.setup();

    const section = await documentsSection();
    await user.click(within(section).getByRole("button", { name: "Upload" }));
    const composer = await screen.findByRole("dialog");
    // The directory picker is folder drop's pointer-free twin (DES-033
    // §7): the browser puts the path each file sat at on the file
    // itself, so the structure survives a pick as it survives a drop.
    const picked = [file("MSA_2019_signed.pdf"), file("notice.pdf")];
    Object.defineProperty(picked[0]!, "webkitRelativePath", {
      value: "Legacy contracts/Executed/MSA_2019_signed.pdf",
    });
    Object.defineProperty(picked[1]!, "webkitRelativePath", {
      value: "Legacy contracts/Correspondence/notice.pdf",
    });
    // The control a keyboard reaches carries the field's own name, as
    // the file picker's does; the input behind it is what the pick lands
    // on.
    expect(within(composer).getByRole("button", { name: "File Choose folder" })).toBeVisible();
    await user.upload(within(composer).getByLabelText("Folder"), picked);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Legacy contracts")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Import 2 files" }));

    await waitFor(() => expect(api.uploaded).toHaveLength(2));
    expect(api.pathOf("MSA_2019_signed.pdf")).toBe("Legacy contracts/Executed");
    expect(api.pathOf("notice.pdf")).toBe("Legacy contracts/Correspondence");
  });

  it("says the drop may be short when a directory could not be read", async () => {
    const api = dropApi();
    stubApi({ signedIn: MEMBER, extra: api.handler });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    // A browser that refuses a directory hands back nothing rather than
    // an error, so a walk that could not read one must not call it
    // empty: a drop arriving short in silence is the one failure a bulk
    // import cannot afford.
    const refused = {
      isFile: false,
      isDirectory: true,
      name: "Locked",
      createReader: () => ({
        readEntries: (_resolve: unknown, reject: () => void) => reject(),
      }),
    };
    const dataTransfer = {
      types: ["Files"],
      files: [file("loose.pdf")],
      items: [
        {
          kind: "file",
          getAsFile: () => file("loose.pdf"),
          webkitGetAsEntry: () => entryOf(file("loose.pdf")),
        },
        { kind: "file", getAsFile: () => new File([], "Locked"), webkitGetAsEntry: () => refused },
      ],
    };
    fireEvent.dragOver(section, { dataTransfer });
    fireEvent.drop(section, { dataTransfer });

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "1 folder could not be read: Locked. Check the list below — it may be missing files.",
      ),
    ).toBeVisible();
    // And it is not recreated as an empty folder either: nothing here
    // knows it is empty.
    expect(within(dialog).queryByText("Empty")).toBeNull();
  });

  it("takes no drop at all on a folder row of an archived record", async () => {
    const api = dropApi([folderRow("f-1", "Executed")]);
    const record = recordApi({ ...contractRow(), archivedAt: "2026-08-01T09:00:00.000Z" }, [
      person("u1", "creator"),
    ]);
    stubApi({
      signedIn: MEMBER,
      extra: (call: StubCall) => {
        const { pathname } = call.url;
        if (pathname === "/api/v1/contracts/42/folders" && call.method === "GET") {
          return json(200, { folders: [folderRow("f-1", "Executed")] });
        }
        if (pathname === "/api/v1/contracts/42/documents" && call.method === "GET") {
          return json(200, { documents: [], nextCursor: null });
        }
        return record.handler(call);
      },
    });
    renderAt("/contracts/42/documents");

    const section = await documentsSection();
    const row = (await within(section).findByText("Executed")).closest("tr")!;
    dropOn(row, [file("signed.pdf")]);

    // A frozen record's paper stays frozen, organization included — so
    // the drop opens no confirmation at all rather than one that would
    // be refused a file at a time.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.uploaded).toEqual([]);
  });
});

describe("moving between two records on the same route (#372)", () => {
  it("reseeds every draft from the record in the URL", async () => {
    // The remount lives in the router now — `KeyedByParam` keys this
    // screen by `:contractNumber` — so this test guards that key the
    // way the page's own key used to guard itself.
    const first = recordApi(contractRow());
    const second = contractRow({
      id: "c2",
      number: 43,
      title: "Orion cloud subscription",
      description: "Twelve-month cloud subscription.",
      priority: "high",
    });
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        if (call.url.pathname === "/api/v1/contracts/43" && call.method === "GET") {
          return json(200, {
            contract: second,
            fields: [],
            customFieldRefs: { users: [], entities: [] },
            team: [person("u1", "creator")],
            counterparties: [],
            renewals: [],
          });
        }
        return first.handler(call);
      },
    });
    const { router } = renderAt("/contracts/42");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Acme master services agreement" }),
    ).toBeInTheDocument();

    await router.navigate("/contracts/43");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Orion cloud subscription" }),
    ).toBeInTheDocument();
    // Every seeded draft moves with the record, not just the heading.
    expect(screen.getByLabelText("Title")).toHaveValue("Orion cloud subscription");
    expect(screen.getByLabelText("Description")).toHaveValue("Twelve-month cloud subscription.");
    expect(screen.getByLabelText("Priority")).toHaveValue("high");
  });
});
