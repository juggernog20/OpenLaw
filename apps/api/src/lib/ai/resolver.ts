// SPDX-License-Identifier: AGPL-3.0-only

import { aiConnector, isNull, type Db } from "@openlaw/db";
import { createAiProvider } from "./index.js";
import type { AiProvider, AiProviderConfig } from "./provider.js";

export type AiDriverFactory = (config: AiProviderConfig) => AiProvider;
export type AiResolver = () => Promise<AiProvider | null>;

/** Reads the singleton row on every call and reuses a driver until that row changes. */
export function createAiResolver(
  db: Db,
  buildDriver: AiDriverFactory = createAiProvider,
): AiResolver {
  let cached: { key: string; driver: AiProvider } | null = null;
  return async () => {
    const [row] = await db
      .select()
      .from(aiConnector)
      .where(isNull(aiConnector.disabledAt))
      .limit(1);
    if (!row) {
      cached = null;
      return null;
    }
    const key = `${row.id}:${row.updatedAt.getTime()}`;
    if (cached?.key === key) return cached.driver;
    const driver = buildDriver({
      preset: row.preset,
      protocol: row.protocol,
      baseUrl: row.baseUrl,
      apiKey: row.apiKey,
      model: row.model,
    });
    cached = { key, driver };
    return driver;
  };
}

/** The inert default for processes and suites that never analyze a Contract. */
export function createUnconfiguredAiResolver(): AiResolver {
  return () => Promise.resolve(null);
}
