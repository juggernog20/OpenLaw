// SPDX-License-Identifier: AGPL-3.0-only

/** M27/5's Ownership tab and direct org-chart route. */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { json, renderAt, stubApi, type StubCall } from "../testing/helpers";

const MEMBER = {
  id: "u2",
  email: "member@example.com",
  displayName: "Nadia Counsel",
  role: "legal_team_member",
};

const rows = {
  parent: entity("parent", "Delaware Parent", "Delaware"),
  current: entity("current", "UK Subsidiary", "England & Wales"),
  secondary: entity("secondary", "Minority Owner", "New York"),
  child: entity("child", "UAE Subsidiary", "Dubai"),
  other: entity("other", "Other Candidate", "Singapore"),
};

function entity(id: string, legalName: string, jurisdiction: string) {
  return {
    id,
    legalName,
    entityTypeId: "t-corp",
    entityTypeName: "Corporation",
    registerKind: "shares",
    typeRegisterKind: "shares",
    registerKindSource: "type",
    registerKindLocked: false,
    registerKindLockReason: null,
    headOfficeEntityId: null,
    jurisdiction,
    formedOn: null,
    registrationNumber: null,
    taxId: null,
    registeredAgent: null,
    registeredAddress: null,
    status: "active",
    sharesAuthorized: null,
    sharesIssued: null,
    parValue: null,
    customFields: {},
    isConfidential: false,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function holding(owner: keyof typeof rows, owned: keyof typeof rows, ownershipPercent: number) {
  return {
    owner: { restricted: false, id: rows[owner].id, legalName: rows[owner].legalName },
    owned: { restricted: false, id: rows[owned].id, legalName: rows[owned].legalName },
    ownershipPercent,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function recordReads(call: StubCall): Response | undefined {
  if (call.url.pathname === "/api/v1/entities/current" && call.method === "GET") {
    return json(200, {
      entity: rows.current,
      fields: [],
      customFieldRefs: { users: [], entities: [] },
    });
  }
  if (call.url.pathname === "/api/v1/entities/child" && call.method === "GET") {
    return json(200, {
      entity: rows.child,
      fields: [],
      customFieldRefs: { users: [], entities: [] },
    });
  }
  if (call.url.pathname === "/api/v1/entities/types") {
    return json(200, {
      entityTypes: [{ id: "t-corp", slug: "corporation", displayName: "Corporation" }],
    });
  }
  if (call.url.pathname === "/api/v1/entities" && call.method === "GET") {
    return json(200, { entities: Object.values(rows) });
  }
  return undefined;
}

describe("the Entity Ownership tab", () => {
  it("uses the shared Restricted Entity cell for an unreachable side", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        const record = recordReads(call);
        if (record) return record;
        if (call.url.pathname === "/api/v1/entities/current/holdings") {
          return json(200, {
            owners: [],
            owned: [
              {
                owner: {
                  restricted: false,
                  id: "current",
                  legalName: "UK Subsidiary",
                },
                owned: { restricted: true },
                ownershipPercent: 100,
                createdAt: "2026-08-01T00:00:00.000Z",
                updatedAt: "2026-08-01T00:00:00.000Z",
              },
            ],
          });
        }
        return undefined;
      },
    });
    renderAt("/entities/current/ownership");
    expect(await screen.findByText("Restricted Entity")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Restricted Entity/ })).not.toBeInTheDocument();
  });

  it("lists Holdings in other Entities read-only, with no way to type a Holding", async () => {
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        const record = recordReads(call);
        if (record) return record;
        if (call.url.pathname === "/api/v1/entities/current/holdings" && call.method === "GET") {
          return json(200, {
            owners: [holding("parent", "current", 60)],
            owned: [holding("current", "child", 75.5)],
          });
        }
        return undefined;
      },
    });
    renderAt("/entities/current/ownership");

    // ENT-012: the register is the one source of a Holding. The owners
    // side is the Register of members; the owned side only reads.
    const owned = (
      await screen.findByRole("heading", { name: "Holdings in other Entities" })
    ).closest("section")!;
    expect(within(owned).getByRole("link", { name: "UAE Subsidiary" })).toHaveAttribute(
      "href",
      "/entities/child",
    );
    expect(within(owned).getByRole("link", { name: "From register" })).toHaveAttribute(
      "href",
      "/entities/child/ownership",
    );
    expect(within(owned).getByLabelText("UAE Subsidiary ownership percent")).toHaveTextContent(
      "75.5%",
    );
    expect(within(owned).queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(within(owned).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Holding" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Declared owners not in the register" }),
    ).not.toBeInTheDocument();

    // The record's sub-bar still names the majority owner from the projection.
    const subbar = screen.getByRole("region", { name: "UK Subsidiary" });
    expect(within(subbar).getByRole("link", { name: "Delaware Parent" })).toHaveAttribute(
      "href",
      "/entities/parent",
    );
  });
});

describe("/entities?view=chart", () => {
  it("keeps a wide chart readable and restores actual size after fitting it", async () => {
    const children = Array.from({ length: 30 }, (_, index) => ({
      ...node(rows.child),
      id: `child-${index}`,
      legalName: `Subsidiary ${index}`,
      primaryOwnerId: "parent",
    }));
    const chart = {
      nodes: [{ ...node(rows.parent), primaryOwnerId: null }, ...children],
      edges: children.map((child) => ({
        ownerEntityId: "parent",
        ownedEntityId: child.id,
        ownershipPercent: 100,
      })),
    };
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/entities/chart" ? json(200, chart) : recordReads(call),
    });
    renderAt("/entities?view=chart");
    const user = userEvent.setup();
    const region = await screen.findByRole("region", { name: "Entity ownership chart" });
    expect(region).toHaveAttribute("data-zoom", "1");
    await user.click(screen.getByRole("button", { name: "Fit to window" }));
    expect(Number(region.getAttribute("data-zoom"))).toBeLessThan(0.2);
    await user.click(screen.getByRole("button", { name: "Reset zoom to 100%" }));
    expect(region).toHaveAttribute("data-zoom", "1");
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(Number(region.getAttribute("data-zoom"))).toBeGreaterThan(1);
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(region).toHaveAttribute("data-zoom", "1");
  });

  it("labels an unreachable Entity as confidential without exposing its name", async () => {
    const chart = {
      nodes: [
        { ...node(rows.parent), primaryOwnerId: null },
        { restricted: true, id: "secret", primaryOwnerId: "parent" },
      ],
      edges: [{ ownerEntityId: "parent", ownedEntityId: "secret", ownershipPercent: 100 }],
    };
    stubApi({
      signedIn: MEMBER,
      extra: (call) =>
        call.url.pathname === "/api/v1/entities/chart" ? json(200, chart) : recordReads(call),
    });
    renderAt("/entities?view=chart");
    expect(await screen.findByLabelText("Confidential Entity")).toHaveAttribute(
      "data-restricted",
      "true",
    );
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("renders the majority tree, secondary edge, unconnected row, click-through, and keyboard pan", async () => {
    const chart = {
      nodes: [
        { ...node(rows.parent), primaryOwnerId: null },
        { ...node(rows.secondary), primaryOwnerId: null },
        { ...node(rows.child), primaryOwnerId: "parent" },
        { ...node(rows.other), primaryOwnerId: null },
      ],
      edges: [
        { ownerEntityId: "parent", ownedEntityId: "child", ownershipPercent: 60 },
        { ownerEntityId: "secondary", ownedEntityId: "child", ownershipPercent: 40 },
      ],
    };
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        const record = recordReads(call);
        if (record) return record;
        if (call.url.pathname === "/api/v1/entities/chart") return json(200, chart);
        return undefined;
      },
    });
    const { router } = renderAt("/entities?view=chart");
    const user = userEvent.setup();

    const region = await screen.findByRole("region", { name: "Entity ownership chart" });
    expect(screen.getByRole("link", { name: "Open UAE Subsidiary" })).toHaveAttribute(
      "href",
      "/entities/child",
    );
    // Focus order follows the tree: root, its child, the next root, then the
    // unconnected row. Not the API's alphabetical order.
    expect(
      within(region)
        .getAllByRole("link")
        .map((link) => link.getAttribute("aria-label")),
    ).toEqual([
      "Open Delaware Parent",
      "Open UAE Subsidiary",
      "Open Minority Owner",
      "Open Other Candidate",
    ]);
    const switcher = screen.getByRole("navigation", { name: "Registry view" });
    expect(within(switcher).getByRole("link", { name: "Chart" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(switcher).getByRole("link", { name: "List" })).toHaveAttribute(
      "href",
      "/entities?view=list",
    );
    expect(document.querySelector('[data-edge-kind="secondary"]')).toBeInTheDocument();
    expect(document.querySelector('[data-unconnected="true"]')).toHaveTextContent(
      "Other Candidate",
    );

    const before = region.getAttribute("data-pan-x");
    region.focus();
    await user.keyboard("{ArrowRight}");
    expect(region.getAttribute("data-pan-x")).not.toBe(before);
    await user.click(screen.getByRole("button", { name: "Fit to window" }));

    const selected = screen.getByRole("link", { name: "Open UAE Subsidiary" });
    await user.click(selected);
    expect(router.state.location.pathname).toBe("/entities");
    expect(selected).toHaveAttribute("aria-current", "true");
    expect(selected.closest("g[data-highlighted]")).toHaveAttribute("data-highlighted", "true");
    expect(
      screen.getByRole("link", { name: "Open Delaware Parent" }).closest("g[data-highlighted]"),
    ).toHaveAttribute("data-highlighted", "true");
    expect(
      screen.getByRole("link", { name: "Open Minority Owner" }).closest("g[data-highlighted]"),
    ).toHaveAttribute("data-highlighted", "true");
    expect(
      screen.getByRole("link", { name: "Open Other Candidate" }).closest("g[data-highlighted]"),
    ).toHaveAttribute("data-highlighted", "false");
    await user.click(screen.getByRole("button", { name: "Clear highlight" }));
    expect(screen.queryByRole("button", { name: "Clear highlight" })).not.toBeInTheDocument();
    await user.dblClick(selected);
    await waitFor(() => expect(router.state.location.pathname).toBe("/entities/child"));
    expect(await screen.findByRole("heading", { level: 1, name: "UAE Subsidiary" })).toBeVisible();
  });
});

function node(row: ReturnType<typeof entity>) {
  return {
    restricted: false as const,
    id: row.id,
    legalName: row.legalName,
    type: row.entityTypeName,
    jurisdiction: row.jurisdiction,
    status: row.status,
  };
}

it("labels an individual in the chart and opens their Holding instead of a nonexistent Entity", async () => {
  const chart = {
    nodes: [
      {
        ...node(rows.parent),
        id: "individual:alex",
        kind: "individual",
        legalName: "Alex Morgan",
        type: "Individual",
        status: null,
        jurisdiction: null,
        primaryOwnerId: null,
      },
      { ...node(rows.current), primaryOwnerId: "individual:alex" },
    ],
    edges: [{ ownerEntityId: "individual:alex", ownedEntityId: "current", ownershipPercent: 100 }],
  };
  stubApi({
    signedIn: MEMBER,
    extra: (call) =>
      call.url.pathname === "/api/v1/entities/chart" ? json(200, chart) : recordReads(call),
  });
  renderAt("/entities?view=chart");
  expect(await screen.findByRole("link", { name: "Open Alex Morgan" })).toHaveAttribute(
    "href",
    "/entities/current/ownership",
  );
  expect(
    within(screen.getByRole("region", { name: "Entity ownership chart" })).getByText("Individual"),
  ).toBeVisible();
});

it("renders trust roles, branch lines, terminal parties and the DES-095 legend", async () => {
  const chart = {
    nodes: [
      { ...node(rows.parent), primaryOwnerId: null },
      { ...node(rows.child), primaryOwnerId: "parent" },
      { ...node(rows.current), primaryOwnerId: null },
      { ...node(rows.other), primaryOwnerId: "parent" },
      {
        id: "party:person",
        restricted: false,
        kind: "party",
        partyKind: "individual",
        trustEntityId: "current",
        legalName: "Avery Trustee",
        type: "Individual",
        jurisdiction: null,
        status: null,
        primaryOwnerId: null,
      },
      {
        id: "party:class",
        restricted: false,
        kind: "party",
        partyKind: "class",
        trustEntityId: "current",
        legalName: "Settlor descendants",
        type: "Class",
        jurisdiction: null,
        status: null,
        primaryOwnerId: null,
      },
    ],
    edges: [{ ownerEntityId: "parent", ownedEntityId: "child", ownershipPercent: 100 }],
    roleEdges: [
      { partyNodeId: "party:person", trustEntityId: "current", role: "trustee", roleLabel: null },
      {
        partyNodeId: "party:class",
        trustEntityId: "current",
        role: "beneficiary",
        roleLabel: null,
      },
    ],
    branchEdges: [{ headOfficeEntityId: "parent", branchEntityId: "other" }],
  };
  stubApi({
    signedIn: MEMBER,
    extra: (call) =>
      call.url.pathname === "/api/v1/entities/chart" ? json(200, chart) : recordReads(call),
  });
  renderAt("/entities?view=chart");
  const region = await screen.findByRole("region", { name: "Entity ownership chart" });
  const roles = region.querySelectorAll('[data-edge-kind="role"]');
  expect(roles).toHaveLength(2);
  for (const edge of roles) {
    expect(edge).toHaveAttribute("stroke-dasharray", "3 4");
    expect(edge.parentElement?.textContent).not.toContain("%");
  }
  expect(region.querySelector('[data-edge-kind="branch"]')).not.toHaveAttribute("stroke-dasharray");
  expect(within(region).getByText("Branch")).toBeInTheDocument();
  expect(within(region).getByText("Trustee")).toBeInTheDocument();
  const party = within(region).getByRole("link", { name: "Open Settlor descendants" });
  expect(party).toHaveAttribute("href", "/entities/current/ownership");
  expect(party.querySelector("rect")).toHaveAttribute("stroke-dasharray", "2 4");
  expect(
    within(region)
      .getAllByRole("link")
      .slice(-2)
      .map((link) => link.getAttribute("href")),
  ).toEqual(["/entities/current/ownership", "/entities/current/ownership"]);
  const legend = screen.getByRole("group", { name: "Chart legend" });
  for (const text of ["Trust role", "Branch", "Individual", "Class"])
    expect(within(legend).getByText(text)).toBeInTheDocument();
  await userEvent.setup().click(within(region).getByRole("link", { name: "Open UK Subsidiary" }));
  expect(party.parentElement).toHaveAttribute("data-highlighted", "true");
});
