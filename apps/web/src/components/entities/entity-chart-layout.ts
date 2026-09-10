// SPDX-License-Identifier: AGPL-3.0-only

/** A small Reingold-Tilford-style layered layout for ENT-003's majority forest. */
import type { EntityChart } from "../../lib/entities";

export const CHART_NODE_WIDTH = 220;
export const CHART_NODE_HEIGHT = 132;
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

/** Ancestors and descendants of the selected entity, without including its siblings. */
export function entityStructureChain(chart: EntityChart, selectedId: string): Set<string> {
  const chain = new Set([selectedId]);
  for (const direction of ["ancestors", "descendants"] as const) {
    const visited = new Set([selectedId]);
    const pending = [selectedId];
    while (pending.length) {
      const current = pending.pop()!;
      for (const edge of chart.edges) {
        const from = direction === "ancestors" ? edge.ownedEntityId : edge.ownerEntityId;
        const to = direction === "ancestors" ? edge.ownerEntityId : edge.ownedEntityId;
        if (from !== current || visited.has(to)) continue;
        visited.add(to);
        chain.add(to);
        pending.push(to);
      }
    }
  }
  return chain;
}

/**
 * The majority Holdings form a forest because the API rejects cycles and
 * chooses at most one primary owner per node. Leaves claim horizontal slots;
 * each parent sits over the midpoint of its first and last child. Separate
 * roots continue in the same row, and nodes with no Holding sit in a final row.
 * The returned nodes follow placement order (root, then its children, depth
 * first), so DOM and keyboard focus order follow the tree.
 */
export function layoutEntityChart(
  chart: EntityChart,
  { width: nodeWidth = CHART_NODE_WIDTH, height: nodeHeight = CHART_NODE_HEIGHT } = {},
): EntityChartLayout {
  const nameOf = (node: EntityChart["nodes"][number]) =>
    node.restricted ? node.id : node.legalName;
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
    held.sort((a, b) => nameOf(byId.get(a)!).localeCompare(nameOf(byId.get(b)!)));
  }

  const roots = chart.nodes
    .filter(
      (node) => connected.has(node.id) && (!node.primaryOwnerId || !byId.has(node.primaryOwnerId)),
    )
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const positions = new Map<string, { x: number; y: number }>();
  const order: string[] = [];
  let cursor = PADDING;
  let deepest = 0;

  function place(id: string, depth: number): number {
    order.push(id);
    deepest = Math.max(deepest, depth);
    const held = children.get(id) ?? [];
    let center: number;
    if (held.length === 0) {
      center = cursor + nodeWidth / 2;
      cursor += nodeWidth + HORIZONTAL_GAP;
    } else {
      const centers = held.map((child) => place(child, depth + 1));
      center = (centers[0]! + centers.at(-1)!) / 2;
    }
    positions.set(id, {
      x: center - nodeWidth / 2,
      y: PADDING + depth * (nodeHeight + VERTICAL_GAP),
    });
    return center;
  }

  for (const root of roots) {
    place(root.id, 0);
    cursor += HORIZONTAL_GAP;
  }

  const unconnected = chart.nodes
    .filter((node) => !connected.has(node.id))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const bottomY = PADDING + (roots.length > 0 ? deepest + 1 : 0) * (nodeHeight + VERTICAL_GAP);
  if (unconnected.length > 0) cursor = PADDING;
  for (const node of unconnected) {
    order.push(node.id);
    positions.set(node.id, { x: cursor, y: bottomY });
    cursor += nodeWidth + HORIZONTAL_GAP;
  }

  // Pre-order: each root, then its subtree, then the unconnected row. Nodes
  // the walk never reached (none, in practice) go last.
  const ordered = [
    ...order,
    ...chart.nodes.map((node) => node.id).filter((id) => !positions.has(id)),
  ];
  const nodes = ordered.map((id) => ({
    ...byId.get(id)!,
    ...(positions.get(id) ?? { x: PADDING, y: PADDING }),
    unconnected: !connected.has(id),
  }));
  const right = Math.max(PADDING, ...nodes.map((node) => node.x + nodeWidth));
  const bottom = Math.max(PADDING, ...nodes.map((node) => node.y + nodeHeight));
  return { nodes, width: right + PADDING, height: bottom + PADDING };
}
