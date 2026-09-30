// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { entityStructureChain } from "./entity-chart-layout";
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
    expect(entityStructureChain({ nodes, edges }, "selected")).toEqual(
      new Set(["selected", "parent", "grandparent", "secondary", "child", "grandchild"]),
    );
  });
});
