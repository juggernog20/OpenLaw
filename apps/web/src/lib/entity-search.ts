// SPDX-License-Identifier: AGPL-3.0-only

import type { EntityChart } from "./entities";
import { entityStructureChain } from "../components/entities/entity-chart-layout";

export function matchesEntityName(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.trim().toLowerCase());
}

/** Preserve ownership context around matching, reachable entities. */
export function searchEntityChart(chart: EntityChart, query: string): EntityChart {
  if (!query.trim()) return chart;
  const included = new Set<string>();
  for (const node of chart.nodes) {
    if (node.restricted || !matchesEntityName(node.legalName, query)) continue;
    for (const id of entityStructureChain(chart, node.id)) included.add(id);
  }
  return {
    nodes: chart.nodes.filter((node) => included.has(node.id)),
    edges: chart.edges.filter(
      (edge) => included.has(edge.ownerEntityId) && included.has(edge.ownedEntityId),
    ),
  };
}
