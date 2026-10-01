// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { EntityChart } from "../../lib/entities";
import {
  CHART_NODE_HEIGHT,
  entityChartRelationships,
  layoutEntityChart,
  entityStructureChain,
} from "./entity-chart-layout";
import { fitChart, zoomChart } from "./entity-chart-viewport";

describe("entity chart navigation", () => {
  it("fits a very wide structure inside the viewport without imposing a zoom floor", () => {
    const content = { width: 20_000, height: 700 };
    const viewport = { width: 1100, height: 480 };
    const view = fitChart(content, viewport);
    expect(view.x).toBeGreaterThanOrEqual(24);
    expect(view.y).toBeGreaterThanOrEqual(24);
    expect(view.x + content.width * view.scale).toBeLessThanOrEqual(viewport.width - 24);
    expect(view.y + content.height * view.scale).toBeLessThanOrEqual(viewport.height - 24);
  });

  it("zooms from an overview to actual size while keeping the point under the pointer fixed", () => {
    const original = { x: 20, y: 100, scale: 0.05 };
    const anchor = { x: 550, y: 240 };
    const worldPoint = {
      x: (anchor.x - original.x) / original.scale,
      y: (anchor.y - original.y) / original.scale,
    };
    const zoomed = zoomChart(original, 1, anchor);
    expect(zoomed.scale).toBe(1);
    expect(worldPoint.x * zoomed.scale + zoomed.x).toBeCloseTo(anchor.x);
    expect(worldPoint.y * zoomed.scale + zoomed.y).toBeCloseTo(anchor.y);
    expect(zoomChart(zoomed, original.scale, anchor)).toEqual(original);
  });
});

describe("entity structure highlighting", () => {
  it("includes ancestors and descendants while excluding sibling branches", () => {
    const edges = [
      ["grandparent", "parent"],
      ["parent", "selected"],
      ["parent", "sibling"],
      ["selected", "child"],
      ["child", "grandchild"],
      ["secondary", "selected"],
    ].map(([ownerEntityId, ownedEntityId]) => ({
      ownerEntityId: ownerEntityId!,
      ownedEntityId: ownedEntityId!,
      ownershipPercent: 100,
    }));
    const nodes = [
      ...new Set(edges.flatMap((edge) => [edge.ownerEntityId, edge.ownedEntityId])),
    ].map((id) => ({ restricted: true as const, id, primaryOwnerId: null }));
    expect(
      entityStructureChain({ nodes, edges, roleEdges: [], branchEdges: [] }, "selected"),
    ).toEqual(new Set(["selected", "parent", "grandparent", "secondary", "child", "grandchild"]));
  });
});

it("places branches below head offices and adds trust parties without moving the ownership spine", () => {
  const node = (id: string, primaryOwnerId: string | null = null) => ({
    id,
    restricted: true as const,
    primaryOwnerId,
  });
  const chart: EntityChart = {
    nodes: [
      node("head"),
      node("branch", "head"),
      node("trust"),
      node("child", "trust"),
      node("unconnected"),
    ],
    edges: [{ ownerEntityId: "trust", ownedEntityId: "child", ownershipPercent: 100 }],
    branchEdges: [{ headOfficeEntityId: "head", branchEntityId: "branch" }],
    roleEdges: [],
  };
  const before = layoutEntityChart(chart);
  chart.nodes.push({
    id: "party:one",
    restricted: false,
    kind: "party",
    partyKind: "class",
    trustEntityId: "trust",
    legalName: "Descendants",
    type: "Class",
    status: null,
    jurisdiction: null,
    primaryOwnerId: null,
  });
  chart.roleEdges.push({
    partyNodeId: "party:one",
    trustEntityId: "trust",
    role: "beneficiary",
    roleLabel: null,
  });
  const after = layoutEntityChart(chart);
  expect(after.nodes.slice(0, before.nodes.length)).toEqual(before.nodes);
  const positions = new Map(after.nodes.map((n) => [n.id, n]));
  expect(positions.get("branch")!.y).toBeGreaterThan(positions.get("head")!.y);
  expect(positions.get("branch")!.x).toBe(positions.get("head")!.x);
  expect(positions.get("party:one")!.y).toBeGreaterThan(positions.get("trust")!.y);
  expect(positions.get("party:one")!.x).toBe(positions.get("trust")!.x);
  expect(entityStructureChain(chart, "branch")).toEqual(new Set(["head", "branch"]));
  expect(entityStructureChain(chart, "trust")).toEqual(new Set(["trust", "child"]));
});

it("keeps party groups apart and terminates a mixed branch and Holding cycle", () => {
  const nodes: EntityChart["nodes"] = [
    { id: "head", restricted: true, primaryOwnerId: "branch" },
    { id: "branch", restricted: true, primaryOwnerId: "head" },
  ];
  const roleEdges: EntityChart["roleEdges"] = [];
  for (const trustEntityId of ["head", "branch"]) {
    for (let i = 0; i < 3; i++) {
      const id = `party:${trustEntityId}:${i}`;
      nodes.push({
        id,
        restricted: false,
        kind: "party",
        partyKind: "individual",
        trustEntityId,
        legalName: id,
        type: "Individual",
        jurisdiction: null,
        status: null,
        primaryOwnerId: null,
      });
      roleEdges.push({ partyNodeId: id, trustEntityId, role: "beneficiary", roleLabel: null });
    }
  }
  const layout = layoutEntityChart({
    nodes,
    roleEdges,
    edges: [{ ownerEntityId: "branch", ownedEntityId: "head", ownershipPercent: 100 }],
    branchEdges: [{ headOfficeEntityId: "head", branchEntityId: "branch" }],
  });
  expect(new Set(layout.nodes.map((node) => node.id)).size).toBe(nodes.length);
  const parties = layout.nodes.filter((node) => !node.restricted && node.kind === "party");
  for (let i = 1; i < parties.length; i++)
    expect(parties[i]!.x).toBeGreaterThan(parties[i - 1]!.x + 220);
  expect(layout.width).toBeGreaterThan(parties.at(-1)!.x + 220);
});

it("places a role-only Entity party once around its trusts while leaving a connected party on its spine", () => {
  const chart: EntityChart = {
    nodes: [
      { id: "trust", restricted: true, primaryOwnerId: null },
      { id: "trust-two", restricted: true, primaryOwnerId: null },
      { id: "party-entity", restricted: true, primaryOwnerId: null },
      { id: "issuer", restricted: true, primaryOwnerId: "trust" },
    ],
    edges: [{ ownerEntityId: "trust", ownedEntityId: "issuer", ownershipPercent: 100 }],
    branchEdges: [],
    roleEdges: [],
  };
  const before = layoutEntityChart(chart);
  chart.roleEdges = [
    { partyNodeId: "party-entity", trustEntityId: "trust", role: "trustee", roleLabel: null },
    { partyNodeId: "party-entity", trustEntityId: "trust-two", role: "trustee", roleLabel: null },
    { partyNodeId: "issuer", trustEntityId: "trust", role: "protector", roleLabel: null },
  ];
  const after = layoutEntityChart(chart);
  for (const id of ["trust", "issuer"])
    expect(after.nodes.find((node) => node.id === id)).toEqual(
      before.nodes.find((node) => node.id === id),
    );
  expect(after.nodes.filter((node) => node.id === "party-entity")).toHaveLength(1);
  expect(after.nodes.at(-1)?.id).toBe("party-entity");
  expect(after.nodes.at(-1)!.y).toBeGreaterThan(
    after.nodes.find((node) => node.id === "trust-two")!.y,
  );
});

it("routes a role edge on the side of the party that faces the trust", () => {
  const party = (id: string, trustEntityId: string) => ({
    id,
    restricted: false as const,
    kind: "party" as const,
    partyKind: "individual" as const,
    trustEntityId,
    legalName: id,
    type: "Individual",
    jurisdiction: null,
    status: null,
    primaryOwnerId: null,
  });
  const chart: EntityChart = {
    nodes: [
      { id: "holdco", restricted: true, primaryOwnerId: null },
      { id: "trust", restricted: true, primaryOwnerId: "holdco" },
      { id: "services", restricted: true, primaryOwnerId: null },
      { id: "trustee", restricted: true, primaryOwnerId: "services" },
      { id: "sub", restricted: true, primaryOwnerId: "trust" },
      party("party:one", "trust"),
    ],
    edges: [
      { ownerEntityId: "holdco", ownedEntityId: "trust", ownershipPercent: 100 },
      { ownerEntityId: "trust", ownedEntityId: "sub", ownershipPercent: 100 },
      { ownerEntityId: "services", ownedEntityId: "trustee", ownershipPercent: 100 },
    ],
    branchEdges: [],
    roleEdges: [
      { partyNodeId: "holdco", trustEntityId: "trust", role: "settlor", roleLabel: null },
      { partyNodeId: "trustee", trustEntityId: "trust", role: "trustee", roleLabel: null },
      { partyNodeId: "party:one", trustEntityId: "trust", role: "beneficiary", roleLabel: null },
    ],
  };
  const layout = layoutEntityChart(chart);
  const positions = new Map(layout.nodes.map((node) => [node.id, node]));
  const trust = positions.get("trust")!;
  const edges = new Map(
    entityChartRelationships(chart, positions).map((edge) => [edge.fromId, edge]),
  );
  // The settlor sits above the trust: bottom of the settlor to top of the trust.
  const settlor = edges.get("holdco")!;
  expect(settlor.points[0]!.y).toBe(positions.get("holdco")!.y + CHART_NODE_HEIGHT);
  expect(settlor.points.at(-1)!.y).toBe(trust.y);
  // The beneficiary sits in the terminal row: top of the party to bottom of the trust.
  const beneficiary = edges.get("party:one")!;
  expect(beneficiary.points[0]!.y).toBe(positions.get("party:one")!.y);
  expect(beneficiary.points.at(-1)!.y).toBe(trust.y + CHART_NODE_HEIGHT);
  // The trustee shares the trust's row: both ends leave the bottom and the
  // line stays below the row.
  const trustee = edges.get("trustee")!;
  expect(positions.get("trustee")!.y).toBe(trust.y);
  expect(trustee.points[0]!.y).toBe(trust.y + CHART_NODE_HEIGHT);
  expect(trustee.points.at(-1)!.y).toBe(trust.y + CHART_NODE_HEIGHT);
  for (const point of trustee.points)
    expect(point.y).toBeGreaterThanOrEqual(trust.y + CHART_NODE_HEIGHT);
});
