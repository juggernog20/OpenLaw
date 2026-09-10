// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { matchesEntityName, searchEntityChart } from "./entity-search";
import type { EntityChart } from "./entities";

const chart: EntityChart = {
  nodes: [
    {
      id: "parent",
      legalName: "Holding Company",
      restricted: false,
      primaryOwnerId: null,
      type: "Corporation",
      jurisdiction: null,
      status: "active",
    },
    {
      id: "match",
      legalName: "Acme UK Ltd",
      restricted: false,
      primaryOwnerId: "parent",
      type: "Corporation",
      jurisdiction: null,
      status: "active",
    },
    {
      id: "sibling",
      legalName: "Unrelated Subsidiary",
      restricted: false,
      primaryOwnerId: "parent",
      type: "Corporation",
      jurisdiction: null,
      status: "active",
    },
    { id: "restricted-acme", restricted: true, primaryOwnerId: "match" },
  ],
  edges: [
    { ownerEntityId: "parent", ownedEntityId: "match", ownershipPercent: 100 },
    { ownerEntityId: "parent", ownedEntityId: "sibling", ownershipPercent: 100 },
    { ownerEntityId: "match", ownedEntityId: "restricted-acme", ownershipPercent: 100 },
  ],
};

describe("entity search", () => {
  it("matches names case-insensitively and treats punctuation literally", () => {
    expect(matchesEntityName("Acme UK Ltd", " acME ")).toBe(true);
    expect(matchesEntityName("Acme UK Ltd", "%")).toBe(false);
  });

  it("keeps a match's ownership chain without sibling branches", () => {
    const found = searchEntityChart(chart, "uk");
    expect(found.nodes.map((node) => node.id)).toEqual(["parent", "match", "restricted-acme"]);
    expect(found.edges).toHaveLength(2);
  });

  it("never matches restricted identifiers and restores the complete chart when cleared", () => {
    expect(searchEntityChart(chart, "restricted-acme")).toEqual({ nodes: [], edges: [] });
    expect(searchEntityChart(chart, "")).toBe(chart);
  });
});
