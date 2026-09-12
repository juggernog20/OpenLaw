// SPDX-License-Identifier: AGPL-3.0-only

import type { paths } from "@openlaw/api-client";

export type Citation =
  paths["/api/v1/matters/{number}/conversion-evidence/{slug}"]["get"]["responses"]["200"]["content"]["application/json"]["citations"][number];

export function isRequestDescription(citation: Citation) {
  return citation.sourceId.startsWith("request:") && citation.sourceId.endsWith(":description");
}

export function groupCitations(citations: readonly Citation[]) {
  const sources = new Map<string, { source: Citation; passages: Citation[] }>();
  for (const citation of citations) {
    const group = sources.get(citation.sourceId);
    if (!group) sources.set(citation.sourceId, { source: citation, passages: [citation] });
    else if (!group.passages.some((passage) => passage.quote === citation.quote))
      group.passages.push(citation);
  }
  return [...sources.values()];
}
