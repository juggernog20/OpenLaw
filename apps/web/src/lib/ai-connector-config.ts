// SPDX-License-Identifier: AGPL-3.0-only

import type { paths } from "@openlaw/api-client";

type Connector =
  paths["/api/v1/ai-connector"]["get"]["responses"][200]["content"]["application/json"]["connector"];
type Destination = { preset: string; protocol: string; baseUrl: string };

/** A stored key can only be reused for the destination it was saved with. */
export function canReuseAiKey(
  connector: Connector,
  { preset, protocol, baseUrl }: Destination,
): boolean {
  if (
    !connector.hasApiKey ||
    connector.preset !== preset ||
    connector.protocol !== protocol ||
    !connector.baseUrl
  )
    return false;
  try {
    const normalize = (value: string) => {
      const url = new URL(value);
      url.hash = "";
      url.pathname = url.pathname.replace(/\/$/, "");
      url.searchParams.sort();
      return url.toString();
    };
    return normalize(connector.baseUrl) === normalize(baseUrl);
  } catch {
    return false;
  }
}
