// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record's Related contracts card on the Overview section (M17/2,
 * CTR-015), at `/contracts/42`, through the real route table with the
 * standard fetch stub.
 *
 * What the card draws: the parent chain root-first, the children, and
 * the typed links this contract carries — each reachable relative as a
 * link carrying its reference, title, and status pill; each restricted
 * relative as a muted placeholder that says only "Restricted contract".
 *
 * What the breadcrumb draws: every parent in the chain between
 * "Contracts" and the current contract's reference — reachable parents
 * as links, restricted parents as an ellipsis.
 *
 * What it must not draw: no controls, no add-link dialog, no remove
 * menu. The card is read-only in M17/2; link management is a later
 * milestone.
 */

import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

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
  contractTypes: [{ id: "t-msa", slug: "msa", displayName: "MSA", fields: [] }],
  contractStatuses: [{ id: "s-draft", slug: "draft", displayName: "Draft", stage: "draft" }],
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
    termType: "auto_renew",
    effectiveDate: "2026-01-01",
    expiryDate: "2026-12-31",
    renewalPeriodMonths: 12,
    noticePeriodDays: 90,
    noticeDeadline: "2026-10-02",
    daysRemaining: 120,
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

// ---------------------------------------------------------------------------
// Relations API fixtures
// ---------------------------------------------------------------------------

interface RelationsData {
  parentChain: Record<string, unknown>[];
  children: Record<string, unknown>[];
  links: Record<string, unknown>[];
}

function recordApi(
  relations: RelationsData = { parentChain: [], children: [], links: [] },
  row: Record<string, unknown> = contractRow(),
) {
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
        team: [{ ...PEOPLE[0], role: "creator" }],
        counterparties: [],
        renewals: [],
      });
    }
    if (call.url.pathname === "/api/v1/contracts/42/relations" && call.method === "GET") {
      return json(200, relations);
    }
    return undefined;
  };
  return { handler };
}

/** The Related contracts card, once the loader has answered. */
const section = async () =>
  within(await screen.findByRole("region", { name: "Related contracts" }));

describe("the record's Related contracts card (CTR-015)", () => {
  it("hides the card when the relations endpoint fails", async () => {
    // Override the relations endpoint to return a server error. The
    // loader's catch converts this to null, and the card is absent.
    const base = recordApi();
    const handler = (call: StubCall) => {
      if (call.url.pathname === "/api/v1/contracts/42/relations" && call.method === "GET") {
        return new Response("Internal Server Error", { status: 500 });
      }
      return base.handler(call);
    };
    stubApi({ signedIn: MEMBER, extra: handler });
    renderAt("/contracts/42");

    // The record still renders.
    await screen.findByRole("heading", { name: "Acme master services agreement" });
    // The Related contracts card is absent.
    expect(screen.queryByRole("region", { name: "Related contracts" })).not.toBeInTheDocument();
  });

  it("draws an empty state when the contract has no relations", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42");

    const card = await section();
    expect(card.getByText("No related contracts.")).toBeInTheDocument();
  });

  it("draws the parent chain root-first, each as a link", async () => {
    const relations: RelationsData = {
      parentChain: [
        { restricted: false, number: 10, title: "Framework agreement", statusName: "Active", stage: "active" },
        { restricted: false, number: 20, title: "Sub-agreement", statusName: "Draft", stage: "draft" },
      ],
      children: [],
      links: [],
    };
    stubApi({ signedIn: MEMBER, extra: recordApi(relations).handler });
    renderAt("/contracts/42");

    const card = await section();
    // The Parent subsection shows the two ancestors in root-first order.
    const links = card.getAllByRole("link");
    expect(links[0]).toHaveTextContent("C-10");
    expect(links[0]).toHaveTextContent("Framework agreement");
    expect(links[1]).toHaveTextContent("C-20");
    expect(links[1]).toHaveTextContent("Sub-agreement");
  });

  it("draws restricted parents as a placeholder, not a link", async () => {
    const relations: RelationsData = {
      parentChain: [
        { restricted: true },
        { restricted: false, number: 20, title: "Sub-agreement", statusName: "Draft", stage: "draft" },
      ],
      children: [],
      links: [],
    };
    stubApi({ signedIn: MEMBER, extra: recordApi(relations).handler });
    renderAt("/contracts/42");

    const card = await section();
    expect(card.getByText("Restricted contract")).toBeInTheDocument();
    // The restricted entry is not a link.
    const links = card.getAllByRole("link");
    const restrictedLink = links.find((a) => a.textContent?.includes("Restricted"));
    expect(restrictedLink).toBeUndefined();
  });

  it("draws children as links", async () => {
    const relations: RelationsData = {
      parentChain: [],
      children: [
        { restricted: false, number: 100, title: "Child work order", statusName: "Review", stage: "review" },
      ],
      links: [],
    };
    stubApi({ signedIn: MEMBER, extra: recordApi(relations).handler });
    renderAt("/contracts/42");

    const card = await section();
    const link = card.getByRole("link", { name: /C-100/ });
    expect(link).toHaveTextContent("Child work order");
  });

  it("draws typed links grouped by direction label", async () => {
    const relations: RelationsData = {
      parentChain: [],
      children: [],
      links: [
        {
          relationType: "renews",
          direction: "outgoing",
          contract: { restricted: false, number: 5, title: "Old MSA", statusName: "Ended", stage: "ended" },
        },
        {
          relationType: "amends",
          direction: "incoming",
          contract: { restricted: false, number: 99, title: "Amendment 1", statusName: "Active", stage: "active" },
        },
        {
          relationType: "related",
          direction: "outgoing",
          contract: { restricted: false, number: 77, title: "Side letter", statusName: "Draft", stage: "draft" },
        },
      ],
    };
    stubApi({ signedIn: MEMBER, extra: recordApi(relations).handler });
    renderAt("/contracts/42");

    const card = await section();
    // The Renews heading and its entry.
    expect(card.getByText("Renews")).toBeInTheDocument();
    expect(card.getByRole("link", { name: /C-5/ })).toHaveTextContent("Old MSA");
    // The Amended by heading (incoming amends) and its entry.
    expect(card.getByText("Amended by")).toBeInTheDocument();
    expect(card.getByRole("link", { name: /C-99/ })).toHaveTextContent("Amendment 1");
    // The Related heading and its entry.
    expect(card.getByText("Related")).toBeInTheDocument();
    expect(card.getByRole("link", { name: /C-77/ })).toHaveTextContent("Side letter");
  });

  it("draws a restricted child as a placeholder", async () => {
    const relations: RelationsData = {
      parentChain: [],
      children: [
        { restricted: true },
        { restricted: false, number: 101, title: "Visible child", statusName: "Draft", stage: "draft" },
      ],
      links: [],
    };
    stubApi({ signedIn: MEMBER, extra: recordApi(relations).handler });
    renderAt("/contracts/42");

    const card = await section();
    expect(card.getByText("Restricted contract")).toBeInTheDocument();
    expect(card.getByRole("link", { name: /C-101/ })).toBeInTheDocument();
  });

  it("draws a restricted link target as a placeholder", async () => {
    const relations: RelationsData = {
      parentChain: [],
      children: [],
      links: [
        {
          relationType: "renews",
          direction: "outgoing",
          contract: { restricted: true },
        },
      ],
    };
    stubApi({ signedIn: MEMBER, extra: recordApi(relations).handler });
    renderAt("/contracts/42");

    const card = await section();
    expect(card.getByText("Renews")).toBeInTheDocument();
    expect(card.getByText("Restricted contract")).toBeInTheDocument();
  });
});

describe("the breadcrumb's parent chain (CTR-015)", () => {
  it("shows no parent segments when the contract has no parents", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42");

    // Wait for the page to render.
    await screen.findByRole("heading", { name: "Acme master services agreement" });
    // The breadcrumb has "Contracts" as a link but no parent references.
    const breadcrumbLinks = screen.getAllByRole("link", { name: "Contracts" });
    expect(breadcrumbLinks.length).toBeGreaterThanOrEqual(1);
    // No parent references like C-10 or C-20 in the breadcrumb.
    expect(screen.queryByRole("link", { name: /C-10/ })).not.toBeInTheDocument();
  });

  it("shows reachable parents as links in the breadcrumb", async () => {
    const relations: RelationsData = {
      parentChain: [
        { restricted: false, number: 10, title: "Framework agreement", statusName: "Active", stage: "active" },
      ],
      children: [],
      links: [],
    };
    stubApi({ signedIn: MEMBER, extra: recordApi(relations).handler });
    renderAt("/contracts/42");

    await screen.findByRole("heading", { name: "Acme master services agreement" });
    // The parent link appears in the breadcrumb.
    const parentLink = screen.getByRole("link", { name: "C-10" });
    expect(parentLink).toBeInTheDocument();
    expect(parentLink).toHaveAttribute("href", "/contracts/10");
  });

  it("shows restricted parents as an ellipsis in the breadcrumb", async () => {
    const relations: RelationsData = {
      parentChain: [
        { restricted: true },
      ],
      children: [],
      links: [],
    };
    stubApi({ signedIn: MEMBER, extra: recordApi(relations).handler });
    renderAt("/contracts/42");

    await screen.findByRole("heading", { name: "Acme master services agreement" });
    // The restricted parent renders as an ellipsis with screen-reader text.
    // Both the breadcrumb and the card contain "Restricted contract", so
    // the assertion uses getAllByText to accept both.
    expect(screen.getAllByText("Restricted contract").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("…")).toBeInTheDocument();
  });
});
