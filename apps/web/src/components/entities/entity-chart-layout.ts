// SPDX-License-Identifier: AGPL-3.0-only

/** A small Reingold-Tilford-style layered layout for ENT-003's majority forest. */
import type { EntityChart } from "../../lib/entities";

export const CHART_NODE_WIDTH = 220;
export const CHART_NODE_HEIGHT = 112;
const HORIZONTAL_GAP = 48;
const VERTICAL_GAP = 76;
const PADDING = 40;

export type PositionedChartNode = EntityChart["nodes"][number] & {
  x: number;
  y: number;
  unconnected: boolean;
};

export interface EntityChartLayout {
  nodes: PositionedChartNode[];
  width: number;
  height: number;
}

/**
 * The majority Holdings form a forest because the API rejects cycles and
 * chooses at most one primary owner per node. Leaves claim horizontal slots;
 * each parent sits over the midpoint of its first and last child. Separate
 * roots continue in the same row, and nodes with no Holding sit in a final row.
 */
export function layoutEntityChart(chart: EntityChart): EntityChartLayout {
  const byId = new Map(chart.nodes.map((node) => [node.id, node]));
  const connected = new Set<string>();
  for (const edge of chart.edges) {
    connected.add(edge.ownerEntityId);
    connected.add(edge.ownedEntityId);
  }
  const children = new Map<string, string[]>();
  for (const node of chart.nodes) {
    if (!connected.has(node.id) || !node.primaryOwnerId || !byId.has(node.primaryOwnerId)) continue;
    const held = children.get(node.primaryOwnerId) ?? [];
    held.push(node.id);
    children.set(node.primaryOwnerId, held);
  }
  for (const held of children.values()) {
    held.sort((a, b) => byId.get(a)!.legalName.localeCompare(byId.get(b)!.legalName));
  }

  const roots = chart.nodes
    .filter(
      (node) => connected.has(node.id) && (!node.primaryOwnerId || !byId.has(node.primaryOwnerId)),
    )
    .sort((a, b) => a.legalName.localeCompare(b.legalName));
  const positions = new Map<string, { x: number; y: number }>();
  let cursor = PADDING;
  let deepest = 0;

  function place(id: string, depth: number): number {
    deepest = Math.max(deepest, depth);
    const held = children.get(id) ?? [];
    let center: number;
    if (held.length === 0) {
      center = cursor + CHART_NODE_WIDTH / 2;
      cursor += CHART_NODE_WIDTH + HORIZONTAL_GAP;
    } else {
      const centers = held.map((child) => place(child, depth + 1));
      center = (centers[0]! + centers.at(-1)!) / 2;
    }
    positions.set(id, {
      x: center - CHART_NODE_WIDTH / 2,
      y: PADDING + depth * (CHART_NODE_HEIGHT + VERTICAL_GAP),
    });
    return center;
  }

  for (const root of roots) {
    place(root.id, 0);
    cursor += HORIZONTAL_GAP;
  }

  const unconnected = chart.nodes
    .filter((node) => !connected.has(node.id))
    .sort((a, b) => a.legalName.localeCompare(b.legalName));
  const bottomY =
    PADDING + (roots.length > 0 ? deepest + 1 : 0) * (CHART_NODE_HEIGHT + VERTICAL_GAP);
  if (unconnected.length > 0) cursor = PADDING;
  for (const node of unconnected) {
    positions.set(node.id, { x: cursor, y: bottomY });
    cursor += CHART_NODE_WIDTH + HORIZONTAL_GAP;
  }

  const nodes = chart.nodes.map((node) => ({
    ...node,
    ...(positions.get(node.id) ?? { x: PADDING, y: PADDING }),
    unconnected: !connected.has(node.id),
  }));
  const right = Math.max(PADDING, ...nodes.map((node) => node.x + CHART_NODE_WIDTH));
  const bottom = Math.max(PADDING, ...nodes.map((node) => node.y + CHART_NODE_HEIGHT));
  return { nodes, width: right + PADDING, height: bottom + PADDING };
}
