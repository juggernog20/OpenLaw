// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The record's Related contracts card on the Overview section (M17/2,
 * M17/4, CTR-015), at `/contracts/42`, through the real route table
 * with the standard fetch stub.
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
 * M17/4 adds link management: "Add link", "Set parent", per-row
 * "Remove link" / "Remove parent" buttons, the link dialog with its
 * picker, refusal rendering, and the CTR-018 confidentiality nudge.
 */

import { describe, expect, it } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        {
          restricted: false,
          number: 10,
          title: "Framework agreement",
          statusName: "Active",
          stage: "active",
        },
        {
          restricted: false,
          number: 20,
          title: "Sub-agreement",
          statusName: "Draft",
          stage: "draft",
        },
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
        {
          restricted: false,
          number: 20,
          title: "Sub-agreement",
          statusName: "Draft",
          stage: "draft",
        },
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
        {
          restricted: false,
          number: 100,
          title: "Child work order",
          statusName: "Review",
          stage: "review",
        },
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
          contract: {
            restricted: false,
            number: 5,
            title: "Old MSA",
            statusName: "Ended",
            stage: "ended",
          },
        },
        {
          relationType: "amends",
          direction: "incoming",
          contract: {
            restricted: false,
            number: 99,
            title: "Amendment 1",
            statusName: "Active",
            stage: "active",
          },
        },
        {
          relationType: "related",
          direction: "outgoing",
          contract: {
            restricted: false,
            number: 77,
            title: "Side letter",
            statusName: "Draft",
            stage: "draft",
          },
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
        {
          restricted: false,
          number: 101,
          title: "Visible child",
          statusName: "Draft",
          stage: "draft",
        },
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
        {
          restricted: false,
          number: 10,
          title: "Framework agreement",
          statusName: "Active",
          stage: "active",
        },
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
      parentChain: [{ restricted: true }],
      children: [],
      links: [],
    };
    stubApi({ signedIn: MEMBER, extra: recordApi(relations).handler });
    renderAt("/contracts/42");

    await screen.findByRole("heading", { name: "Acme master services agreement" });
    // Two surfaces say it: the breadcrumb's screen-reader text, and the
    // card's placeholder row. Both are the point.
    expect(screen.getAllByText("Restricted contract")).toHaveLength(2);
    expect(screen.getByText("…")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// M17/4: link management actions
// ---------------------------------------------------------------------------

describe("the card's link management actions (M17/4)", () => {
  it("shows Add link and Set parent buttons for a Member+", async () => {
    stubApi({ signedIn: MEMBER, extra: recordApi().handler });
    renderAt("/contracts/42");

    const card = await section();
    expect(card.getByRole("button", { name: "Add link" })).toBeInTheDocument();
    expect(card.getByRole("button", { name: "Set parent" })).toBeInTheDocument();
  });

  it("hides Set parent when the contract already has a parent", async () => {
    const relations: RelationsData = {
      parentChain: [
        {
          restricted: false,
          number: 10,
          title: "Framework",
          statusName: "Active",
          stage: "active",
        },
      ],
      children: [],
      links: [],
    };
    stubApi({ signedIn: MEMBER, extra: recordApi(relations).handler });
    renderAt("/contracts/42");

    const card = await section();
    expect(card.getByRole("button", { name: "Add link" })).toBeInTheDocument();
    expect(card.queryByRole("button", { name: "Set parent" })).not.toBeInTheDocument();
  });

  it("shows Remove link on a reachable link and not on a restricted one", async () => {
    const relations: RelationsData = {
      parentChain: [],
      children: [],
      links: [
        {
          relationType: "related",
          direction: "outgoing",
          contract: {
            restricted: false,
            number: 5,
            title: "Side letter",
            statusName: "Draft",
            stage: "draft",
          },
        },
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
    // One Remove link button for the reachable entry.
    const removeButtons = card.getAllByRole("button", { name: "Remove link" });
    expect(removeButtons).toHaveLength(1);
  });

  it("shows Remove parent on a reachable immediate parent", async () => {
    const relations: RelationsData = {
      parentChain: [
        {
          restricted: false,
          number: 10,
          title: "Framework",
          statusName: "Active",
          stage: "active",
        },
      ],
      children: [],
      links: [],
    };
    stubApi({ signedIn: MEMBER, extra: recordApi(relations).handler });
    renderAt("/contracts/42");

    const card = await section();
    expect(card.getByRole("button", { name: "Remove parent" })).toBeInTheDocument();
  });

  it("opens the link dialog when Add link is clicked", async () => {
    const base = recordApi();
    const handler = (call: StubCall) => {
      // Stub the candidates endpoint.
      if (call.url.pathname === "/api/v1/contracts/42/link-candidates" && call.method === "GET") {
        return json(200, { candidates: [] });
      }
      return base.handler(call);
    };
    stubApi({ signedIn: MEMBER, extra: handler });
    renderAt("/contracts/42");

    const card = await section();
    const user = userEvent.setup();
    await user.click(card.getByRole("button", { name: "Add link" }));

    // The dialog opens with the Link contract title.
    await screen.findByRole("heading", { name: "Link contract" });
  });

  it("renders a duplicate-link refusal as an inline alert", async () => {
    const base = recordApi();
    const handler = (call: StubCall) => {
      if (call.url.pathname === "/api/v1/contracts/42/link-candidates" && call.method === "GET") {
        return json(200, {
          candidates: [
            {
              number: 5,
              title: "Side letter",
              statusName: "Draft",
              stage: "draft",
              isConfidential: false,
            },
          ],
        });
      }
      if (call.url.pathname === "/api/v1/contracts/42/relations" && call.method === "POST") {
        return json(409, {
          type: "urn:openlaw:problem:contract-relation-exists",
          detail: "These two contracts are already linked that way.",
        });
      }
      return base.handler(call);
    };
    stubApi({ signedIn: MEMBER, extra: handler });
    renderAt("/contracts/42");

    const card = await section();
    const user = userEvent.setup();
    await user.click(card.getByRole("button", { name: "Add link" }));
    await screen.findByRole("heading", { name: "Link contract" });

    // Pick a candidate and submit.
    const input = screen.getByRole("textbox", { name: "Search by number or title…" });
    await user.type(input, "Side");
    const candidateButton = await screen.findByRole("button", { name: /C-5/ });
    await user.click(candidateButton);
    await user.click(screen.getByRole("button", { name: "Link contract" }));

    // The refusal appears as an inline alert.
    await screen.findByRole("alert");
    expect(
      screen.getByText("These two contracts are already linked that way."),
    ).toBeInTheDocument();
  });

  it("removes a link through the DELETE and redraws the card", async () => {
    const relations: RelationsData = {
      parentChain: [],
      children: [],
      links: [
        {
          relationType: "related",
          direction: "outgoing",
          contract: {
            restricted: false,
            number: 5,
            title: "Side letter",
            statusName: "Draft",
            stage: "draft",
          },
        },
      ],
    };
    const calls: StubCall[] = [];
    const base = recordApi(relations);
    const handler = (call: StubCall) => {
      calls.push(call);
      if (call.url.pathname === "/api/v1/contracts/42/relations" && call.method === "DELETE") {
        return json(200, { parentChain: [], children: [], links: [] });
      }
      return base.handler(call);
    };
    stubApi({ signedIn: MEMBER, extra: handler });
    renderAt("/contracts/42");

    const card = await section();
    const user = userEvent.setup();
    await user.click(card.getByRole("button", { name: "Remove link" }));

    // The card redraws from the write's answer.
    await waitFor(() => {
      expect(screen.getByText("No related contracts.")).toBeInTheDocument();
    });

    const del = calls.find(
      (call) => call.method === "DELETE" && call.url.pathname === "/api/v1/contracts/42/relations",
    );
    expect(del).toBeDefined();
    expect(del!.body).toEqual({ relatedContractNumber: 5, relationType: "related" });
  });

  it("removes the parent through the DELETE and redraws the card", async () => {
    const relations: RelationsData = {
      parentChain: [
        {
          restricted: false,
          number: 10,
          title: "Framework",
          statusName: "Active",
          stage: "active",
        },
      ],
      children: [],
      links: [],
    };
    const calls: StubCall[] = [];
    const base = recordApi(relations);
    const handler = (call: StubCall) => {
      calls.push(call);
      if (call.url.pathname === "/api/v1/contracts/42/parent" && call.method === "DELETE") {
        return json(200, { parentChain: [], children: [], links: [] });
      }
      return base.handler(call);
    };
    stubApi({ signedIn: MEMBER, extra: handler });
    renderAt("/contracts/42");

    const card = await section();
    const user = userEvent.setup();
    await user.click(card.getByRole("button", { name: "Remove parent" }));

    await waitFor(() => {
      expect(screen.getByText("No related contracts.")).toBeInTheDocument();
    });

    const del = calls.find(
      (call) => call.method === "DELETE" && call.url.pathname === "/api/v1/contracts/42/parent",
    );
    expect(del).toBeDefined();
  });
});

describe("the CTR-018 confidentiality nudge", () => {
  /**
   * Drives the dialog to the nudge: this record confidential, the
   * picked candidate open, the link write answered. Records every API
   * call so a test can assert what the nudge's buttons did and did
   * not send. `patchAnswer` is what flagging the open side answers.
   */
  async function openNudge(calls: StubCall[], patchAnswer: Response = json(200, {})) {
    const base = recordApi(
      { parentChain: [], children: [], links: [] },
      contractRow({ isConfidential: true }),
    );
    const handler = (call: StubCall) => {
      calls.push(call);
      if (call.url.pathname === "/api/v1/contracts/42/link-candidates" && call.method === "GET") {
        return json(200, {
          candidates: [
            {
              number: 99,
              title: "Open contract",
              statusName: "Draft",
              stage: "draft",
              isConfidential: false,
            },
          ],
        });
      }
      if (call.url.pathname === "/api/v1/contracts/42/relations" && call.method === "POST") {
        return json(201, {
          parentChain: [],
          children: [],
          links: [
            {
              relationType: "related",
              direction: "outgoing",
              contract: {
                restricted: false,
                number: 99,
                title: "Open contract",
                statusName: "Draft",
                stage: "draft",
              },
            },
          ],
        });
      }
      if (call.url.pathname === "/api/v1/contracts/99" && call.method === "PATCH") {
        return patchAnswer;
      }
      return base.handler(call);
    };
    stubApi({ signedIn: MEMBER, extra: handler });
    renderAt("/contracts/42");

    const card = await section();
    const user = userEvent.setup();
    await user.click(card.getByRole("button", { name: "Add link" }));

    // Wait for the dialog.
    await screen.findByRole("heading", { name: "Link contract" });

    // Type into the picker and select the candidate.
    const input = screen.getByRole("textbox", { name: "Search by number or title…" });
    await user.type(input, "Open");

    // Wait for the candidate to appear and click it.
    const candidateButton = await screen.findByRole("button", { name: /C-99/ });
    await user.click(candidateButton);

    // Submit the link.
    await user.click(screen.getByRole("button", { name: "Link contract" }));

    // The nudge dialog appears.
    await screen.findByRole("heading", { name: "Flag as confidential?" });
    return user;
  }

  it("shows the nudge when exactly one side is confidential after linking", async () => {
    await openNudge([]);
    expect(screen.getByRole("button", { name: "Flag as confidential" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No, leave it open" })).toBeInTheDocument();
  });

  it("accepting flags the open side by the ordinary confidentiality write", async () => {
    const calls: StubCall[] = [];
    const user = await openNudge(calls);

    await user.click(screen.getByRole("button", { name: "Flag as confidential" }));

    // The nudge closes once the write answers.
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Flag as confidential?" }),
      ).not.toBeInTheDocument();
    });

    const patch = calls.find(
      (call) => call.method === "PATCH" && call.url.pathname === "/api/v1/contracts/99",
    );
    expect(patch).toBeDefined();
    expect(patch!.body).toEqual({ isConfidential: true });
  });

  it("dismissing closes without any confidentiality write", async () => {
    const calls: StubCall[] = [];
    const user = await openNudge(calls);

    await user.click(screen.getByRole("button", { name: "No, leave it open" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Flag as confidential?" }),
      ).not.toBeInTheDocument();
    });

    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("stays open and says so when the confidentiality write is refused", async () => {
    const calls: StubCall[] = [];
    const user = await openNudge(
      calls,
      json(403, {
        type: "about:blank",
        title: "Error",
        status: 403,
        detail: "Not yours to change.",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Flag as confidential" }));

    // The nudge does not close as if the flag were set.
    await screen.findByRole("alert");
    expect(screen.getByRole("heading", { name: "Flag as confidential?" })).toBeInTheDocument();
    expect(screen.getByText("Could not flag C-99 as confidential.")).toBeInTheDocument();
  });
});
