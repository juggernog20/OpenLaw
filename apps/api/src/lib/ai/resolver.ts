// SPDX-License-Identifier: AGPL-3.0-only

import { aiConnector, aiSavedKeys, eq, isNull, type Db } from "@openlaw/db";
import { normalizeAiBaseUrl } from "@openlaw/shared";
import { createAiProvider } from "./index.js";
import type { AiProvider, AiProviderConfig } from "./provider.js";

export type AiDriverFactory = (config: AiProviderConfig) => AiProvider;
export type AiResolver = () => Promise<AiProvider | null>;

/** Reads the singleton row on every call and reuses a driver until its effective config changes. */
export function createAiResolver(
  db: Db,
  buildDriver: AiDriverFactory = createAiProvider,
): AiResolver {
  let cached: { key: string; driver: AiProvider } | null = null;
  return async () => {
    const [joined] = await db
      .select({ connector: aiConnector, savedKey: aiSavedKeys })
      .from(aiConnector)
      .leftJoin(aiSavedKeys, eq(aiConnector.savedKeyId, aiSavedKeys.id))
      .where(isNull(aiConnector.disabledAt))
      .limit(1);
    if (!joined) {
      cached = null;
      return null;
    }
    const { connector: row, savedKey } = joined;
    const baseUrl = normalizeAiBaseUrl(row.baseUrl);
    const apiKey =
      savedKey &&
      savedKey.preset === row.preset &&
      savedKey.protocol === row.protocol &&
      normalizeAiBaseUrl(savedKey.baseUrl) === baseUrl
        ? savedKey.apiKey
        : null;
    const key = JSON.stringify([
      row.id,
      row.preset,
      row.protocol,
      baseUrl,
      apiKey,
      row.model,
      row.maxOutputTokens,
      row.updatedAt.toISOString(),
    ]);
    if (cached?.key === key) return cached.driver;
    const driver = buildDriver({
      preset: row.preset,
      protocol: row.protocol,
      baseUrl,
      apiKey,
      model: row.model,
      maxOutputTokens: row.maxOutputTokens,
    });
    cached = { key, driver };
    return driver;
  };
}

/** The inert default for processes and suites that never analyze a Contract. */
export function createUnconfiguredAiResolver(): AiResolver {
  return () => Promise.resolve(null);
}
