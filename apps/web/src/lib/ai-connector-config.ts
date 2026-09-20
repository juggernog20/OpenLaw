// SPDX-License-Identifier: AGPL-3.0-only

import type { paths } from "@openlaw/api-client";
import { normalizeAiBaseUrl } from "@openlaw/shared";

type Connector =
  paths["/api/v1/ai-connector"]["get"]["responses"][200]["content"]["application/json"]["connector"];
type Destination = { preset: string; protocol: string; baseUrl: string };

export function findSavedAiKey(
  savedKeys: Connector["savedKeys"],
  { preset, protocol, baseUrl }: Destination,
): Connector["savedKeys"][number] | undefined {
  try {
    const normalized = normalizeAiBaseUrl(baseUrl);
    return savedKeys.find(
      (key) =>
        key.hasApiKey &&
        key.preset === preset &&
        key.protocol === protocol &&
        normalizeAiBaseUrl(key.baseUrl) === normalized,
    );
  } catch {
    return undefined;
  }
}
