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

function structureEdges(chart: EntityChart) {
  return [
    ...chart.edges,
    ...(chart.branchEdges ?? []).map((edge) => ({
      ownerEntityId: edge.headOfficeEntityId,
      ownedEntityId: edge.branchEntityId,
    })),
  ];
}

/** Order incoming connectors from left to right in the viewer and exports. */
export function entityChartIncomingOwners(
  chart: EntityChart,
  positions: ReadonlyMap<string, { x: number }>,
): Map<string, string[]> {
  const incoming = new Map<string, string[]>();
  for (const edge of structureEdges(chart)) {
    if (!positions.has(edge.ownerEntityId) || !positions.has(edge.ownedEntityId)) continue;
    const owners = incoming.get(edge.ownedEntityId) ?? [];
    owners.push(edge.ownerEntityId);
    incoming.set(edge.ownedEntityId, owners);
  }
  for (const owners of incoming.values()) {
    owners.sort((a, b) => positions.get(a)!.x - positions.get(b)!.x || a.localeCompare(b));
  }
  return incoming;
}

/** Ancestors and descendants of the selected entity, without including its siblings. */
export function entityStructureChain(chart: EntityChart, selectedId: string): Set<string> {
  const chain = new Set([selectedId]);
  for (const direction of ["ancestors", "descendants"] as const) {
    const visited = new Set([selectedId]);
    const pending = [selectedId];
    while (pending.length) {
      const current = pending.pop()!;
      for (const edge of structureEdges(chart)) {
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
  for (const edge of structureEdges(chart)) {
    connected.add(edge.ownerEntityId);
    connected.add(edge.ownedEntityId);
  }
  const terminalParties = new Set(
    chart.nodes.filter((node) => !node.restricted && node.kind === "party").map((node) => node.id),
  );
  const trusts = new Set((chart.roleEdges ?? []).map((edge) => edge.trustEntityId));
  for (const edge of chart.roleEdges ?? []) {
    if (!connected.has(edge.partyNodeId) && !trusts.has(edge.partyNodeId))
      terminalParties.add(edge.partyNodeId);
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

  const visited = new Set<string>();
  function place(id: string, depth: number): number {
    visited.add(id);
    order.push(id);
    deepest = Math.max(deepest, depth);
    const held = (children.get(id) ?? []).filter((child) => !visited.has(child));
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

  // Head-office and Holding graphs are individually acyclic, but their union need not be.
  for (const node of chart.nodes) {
    if (connected.has(node.id) && !visited.has(node.id)) {
      place(node.id, 0);
      cursor += HORIZONTAL_GAP;
    }
  }

  const unconnected = chart.nodes
    .filter((node) => !connected.has(node.id) && !terminalParties.has(node.id))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const bottomY = PADDING + (visited.size > 0 ? deepest + 1 : 0) * (nodeHeight + VERTICAL_GAP);
  if (unconnected.length > 0) cursor = PADDING;
  for (const node of unconnected) {
    order.push(node.id);
    positions.set(node.id, { x: cursor, y: bottomY });
    cursor += nodeWidth + HORIZONTAL_GAP;
  }

  const roleCounts = new Map<string, number>();
  for (const edge of chart.roleEdges ?? [])
    roleCounts.set(edge.trustEntityId, (roleCounts.get(edge.trustEntityId) ?? 0) + 1);
  const partyGap = Math.max(VERTICAL_GAP, 40 + Math.max(0, ...roleCounts.values()) * 20);
  const partyY = Math.max(
    PADDING,
    ...[...positions.values()].map((position) => position.y + nodeHeight + partyGap),
  );
  const groups = new Map<string, string[]>();
  for (const edge of chart.roleEdges ?? []) {
    if (!terminalParties.has(edge.partyNodeId)) continue;
    const group = groups.get(edge.trustEntityId) ?? [];
    if (!group.includes(edge.partyNodeId)) group.push(edge.partyNodeId);
    groups.set(edge.trustEntityId, group);
  }
  let partyRight = PADDING;
  const placedParties = new Set<string>();
  for (const [trustId, group] of [...groups].sort(
    ([a], [b]) => (positions.get(a)?.x ?? 0) - (positions.get(b)?.x ?? 0),
  )) {
    const parties = group.filter((id) => !placedParties.has(id));
    if (!parties.length) continue;
    const groupWidth = parties.length * (nodeWidth + HORIZONTAL_GAP) - HORIZONTAL_GAP;
    let x = Math.max(
      partyRight,
      (positions.get(trustId)?.x ?? PADDING) + nodeWidth / 2 - groupWidth / 2,
    );
    for (const id of parties) {
      placedParties.add(id);
      order.push(id);
      positions.set(id, { x, y: partyY });
      x += nodeWidth + HORIZONTAL_GAP;
    }
    partyRight = x;
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
    unconnected: !connected.has(id) && !terminalParties.has(id),
  }));
  const right = Math.max(PADDING, ...nodes.map((node) => node.x + nodeWidth));
  const bottom = Math.max(PADDING, ...nodes.map((node) => node.y + nodeHeight));
  return { nodes, width: right + PADDING, height: bottom + PADDING };
}

/** Non-ownership connectors share geometry between the live chart and every export. */
export function entityChartRelationships(
  chart: EntityChart,
  positions: ReadonlyMap<string, { x: number; y: number }>,
  width = CHART_NODE_WIDTH,
  height = CHART_NODE_HEIGHT,
) {
  const incoming = entityChartIncomingOwners(chart, positions);
  const edges = [
    ...(chart.branchEdges ?? []).map((edge) => ({
      kind: "branch" as const,
      fromId: edge.headOfficeEntityId,
      toId: edge.branchEntityId,
      role: null,
      roleLabel: null,
    })),
    ...(chart.roleEdges ?? []).map((edge) => ({
      kind: "role" as const,
      fromId: edge.partyNodeId,
      toId: edge.trustEntityId,
      role: edge.role,
      roleLabel: edge.roleLabel,
    })),
  ];
  return edges.flatMap((edge) => {
    const from = positions.get(edge.fromId);
    const to = positions.get(edge.toId);
    if (!from || !to) return [];
    const peers = edges.filter((other) => other.kind === edge.kind && other.toId === edge.toId);
    const owners = incoming.get(edge.toId) ?? [];
    const x1 = from.x + width / 2;
    const x2 =
      to.x +
      width *
        (edge.kind === "role"
          ? (peers.indexOf(edge) + 1) / (peers.length + 1)
          : (owners.indexOf(edge.fromId) + 1) / (owners.length + 1));
    const y1 = from.y + (edge.kind === "role" ? 0 : height);
    const y2 = to.y + (edge.kind === "role" ? height : 0);
    const middle =
      (y1 + y2) / 2 +
      (edge.kind === "role" ? (peers.indexOf(edge) - (peers.length - 1) / 2) * 20 : 0);
    return [
      {
        ...edge,
        points: [
          { x: x1, y: y1 },
          { x: x1, y: middle },
          { x: x2, y: middle },
          { x: x2, y: y2 },
        ],
        labelX: edge.kind === "role" ? (x1 + x2) / 2 + 5 : x2 + 5,
        labelY: edge.kind === "role" ? middle - 6 : y2 - 14,
      },
    ];
  });
}
