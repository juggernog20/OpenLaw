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
            warnings: [],
          });
        }
        return undefined;
      },
    });
    renderAt("/entities/current/ownership");
    expect(await screen.findByText("Restricted Entity")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Restricted Entity/ })).not.toBeInTheDocument();
  });

  it("shows both directions, edits and removes inline, adds through the combobox, and warns", async () => {
    const originalOwner = holding("parent", "current", 60);
    const originalChild = holding("current", "child", 100);
    let owners = [originalOwner];
    let owned = [originalChild];
    let warnings: Array<Record<string, unknown>> = [];
    const writes: Array<{ method: string; path: string; body: unknown }> = [];
    stubApi({
      signedIn: MEMBER,
      extra: (call) => {
        const record = recordReads(call);
        if (record) return record;
        if (call.url.pathname === "/api/v1/entities/current/holdings" && call.method === "GET") {
          return json(200, { owners, owned, warnings });
        }
        if (
          call.url.pathname === "/api/v1/entities/current/holdings/parent" &&
          call.method === "PATCH"
        ) {
          writes.push({ method: call.method, path: call.url.pathname, body: call.body });
          owners = [{ ...originalOwner, ...(call.body as object) }];
          return json(200, { holding: owners[0], warnings: [] });
        }
        if (
          call.url.pathname === "/api/v1/entities/current/holdings/child" &&
          call.method === "DELETE"
        ) {
          writes.push({ method: call.method, path: call.url.pathname, body: call.body });
          owned = [];
          return new Response(null, { status: 204 });
        }
        if (call.url.pathname === "/api/v1/entities/current/holdings" && call.method === "POST") {
          writes.push({ method: call.method, path: call.url.pathname, body: call.body });
          const created = holding("other", "current", 50);
          owners = [...owners, created];
          warnings = [
            {
              code: "ownership-over-100",
              ownedEntityId: "current",
              legalName: "UK Subsidiary",
              totalPercent: 110,
            },
          ];
          return json(201, { holding: created, warnings });
        }
        return undefined;
      },
    });
    renderAt("/entities/current/ownership");
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "Owners" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Owned Entities" })).toBeInTheDocument();
    expect(screen.getAllByText("Delaware Parent")).toHaveLength(2);
    expect(screen.getByText("UAE Subsidiary")).toBeInTheDocument();

    const subbar = screen.getByRole("region", { name: "UK Subsidiary" });
    expect(within(subbar).getByRole("link", { name: "Delaware Parent" })).toHaveAttribute(
      "href",
      "/entities/parent",
    );

    const percent = screen.getByLabelText("Delaware Parent ownership percent");
    await user.clear(percent);
    await user.type(percent, "55");
    await user.tab();
    await waitFor(() => expect(writes[0]?.body).toEqual({ ownershipPercent: 55 }));

    await user.click(screen.getByRole("button", { name: "Remove UAE Subsidiary" }));
    await waitFor(() => expect(writes[1]?.method).toBe("DELETE"));
    expect(screen.queryByText("UAE Subsidiary")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add Holding" }));
    const picker = screen.getByRole("combobox", { name: "Entity" });
    expect(picker).toHaveAttribute("aria-controls");
    expect(picker).toHaveAttribute("aria-expanded", "false");
    await user.type(picker, "Other");
    expect(picker).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.clear(screen.getByLabelText("Ownership percent"));
    await user.type(screen.getByLabelText("Ownership percent"), "50");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Ownership totals 110% for UK Subsidiary.")).toBeInTheDocument();
    expect(writes[2]?.body).toEqual({
      direction: "owner",
      relatedEntityId: "other",
      ownershipPercent: 50,
    });
  });
});

describe("/entities?view=chart", () => {
  it("draws a muted nameless node for an unreachable Entity", async () => {
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
    expect(await screen.findByLabelText("Restricted Entity")).toHaveAttribute(
      "data-restricted",
      "true",
    );
    expect(screen.queryByText("Invisible Acquisition Vehicle")).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("link", { name: "Open UAE Subsidiary" }));
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
