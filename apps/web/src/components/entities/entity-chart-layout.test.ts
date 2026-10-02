// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { EntityChart } from "../../lib/entities";
import { layoutEntityChart } from "./entity-chart-layout";

const node = (id: string, primaryOwnerId: string | null = null) => ({
  id,
  restricted: true as const,
  primaryOwnerId,
});

function separateStructures(): EntityChart {
  return {
    nodes: [
      node("owner"),
      node("company", "owner"),
      node("subsidiary", "company"),
      node("branch", "company"),
      node("trust"),
      node("trustee"),
      node("beneficiary"),
      node("isolated"),
    ],
    edges: [
      { ownerEntityId: "owner", ownedEntityId: "company", ownershipPercent: 100 },
      { ownerEntityId: "company", ownedEntityId: "subsidiary", ownershipPercent: 100 },
    ],
    branchEdges: [{ headOfficeEntityId: "company", branchEntityId: "branch" }],
    roleEdges: [
      { trustEntityId: "trust", partyNodeId: "trustee", role: "trustee", roleLabel: null },
      {
        trustEntityId: "trust",
        partyNodeId: "beneficiary",
        role: "beneficiary",
        roleLabel: null,
      },
    ],
  };
}

describe("disconnected chart structures", () => {
  it.each([
    { width: 220, height: 132 },
    { width: 360, height: 260 },
  ])("packs whole structures beside each other with $width × $height cards", (size) => {
    const chart = separateStructures();
    const layout = layoutEntityChart(chart, size);
    const positions = new Map(layout.nodes.map((item) => [item.id, item]));
    const corporation = ["owner", "company", "subsidiary", "branch"].map((id) =>
      positions.get(id)!,
    );
    const trust = ["trust", "trustee", "beneficiary"].map((id) => positions.get(id)!);
    const corporationRight = Math.max(...corporation.map((item) => item.x + size.width));
    const trustLeft = Math.min(...trust.map((item) => item.x));
    const trustRight = Math.max(...trust.map((item) => item.x + size.width));
    expect(trustLeft).toBeGreaterThan(corporationRight);
    const isolated = positions.get("isolated")!;
    expect(isolated.x).toBeGreaterThan(corporationRight);
    expect(isolated.x + size.width < trustLeft || isolated.x > trustRight).toBe(true);
    expect(positions.get("trust")!.y).toBe(positions.get("owner")!.y);
    expect(positions.get("isolated")!.y).toBe(positions.get("owner")!.y);
    expect(positions.get("trustee")!.y).toBeGreaterThan(positions.get("trust")!.y);
    expect(positions.get("beneficiary")!.y).toBe(positions.get("trustee")!.y);
    expect(positions.get("branch")!.y).toBe(positions.get("subsidiary")!.y);
    expect(new Set(layout.nodes.map((item) => item.id)).size).toBe(chart.nodes.length);
    for (const item of layout.nodes) {
      expect(item.x).toBeGreaterThanOrEqual(40);
      expect(item.y).toBeGreaterThanOrEqual(40);
      expect(item.x + size.width).toBeLessThan(layout.width);
      expect(item.y + size.height).toBeLessThan(layout.height);
    }
  });

  it("keeps a corporate structure and trust together when a role links them", () => {
    const chart = separateStructures();
    chart.roleEdges.push({
      trustEntityId: "trust",
      partyNodeId: "company",
      role: "settlor",
      roleLabel: null,
    });
    const positions = new Map(layoutEntityChart(chart).nodes.map((item) => [item.id, item]));
    expect(positions.get("trust")!.y).toBeGreaterThan(positions.get("owner")!.y);
    expect(positions.get("company")!.y).toBeGreaterThan(positions.get("owner")!.y);
    expect(positions.get("trustee")!.y).toBeGreaterThan(positions.get("trust")!.y);
  });
});
