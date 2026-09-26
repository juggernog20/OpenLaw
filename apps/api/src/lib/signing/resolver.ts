// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Read the Signing connector on every call. Cache its driver by row id and
 * update time so unchanged credentials reuse the provider's access token.
 * Disabled connectors refuse new sends and launches. Accounting and verified
 * Webhook deliveries still use the saved identity to record external outcomes.
 * Candidate credentials can be tested before the settings transaction saves them.
 */

import { eq, signingConnectors, type Db } from "@openlaw/db";
import { createDocuSignProvider, type DocuSignConfig } from "./docusign.js";
import type { SigningProvider } from "./provider.js";

/** The stored connector, as a driver factory needs it. */
export type SigningConnectorConfig = DocuSignConfig;

/** Builds a driver for one stored connector row. */
export type SigningDriverFactory = (config: SigningConnectorConfig) => SigningProvider;

/**
 * The app's signing composition point: the configured provider, or null
 * when this install has no connector.
 */
export type SigningResolver = (
  purpose?: "webhook" | "accounting",
  candidate?: SigningConnectorConfig,
) => Promise<SigningProvider | null>;

/**
 * Reads the stored connector on every call and builds a provider from
 * it. Only `docusign` is a known adapter in v1, so a row for anything
 * else resolves to nothing rather than to a driver we do not have.
 */
export function createSigningResolver(
  db: Db,
  buildDriver: SigningDriverFactory = createDocuSignProvider,
): SigningResolver {
  /** The driver last built, and the row state it was built from. */
  let cached: { key: string; driver: SigningProvider } | null = null;

  return async (purpose, candidate) => {
    if (candidate) return buildDriver(candidate);
    const [row] = await db
      .select()
      .from(signingConnectors)
      .where(eq(signingConnectors.provider, "docusign"))
      .limit(1);
    if (!row) {
      cached = null;
      return null;
    }
    // A disabled row refuses new sends and launches but keeps its driver.
    // Accounting and Webhook calls still reuse the token it holds, so a
    // Signatures page read while the connector is off does not make the
    // next sweep mint a new one.
    if (purpose === undefined && row.disabledAt) return null;
    // A delivery is answered only by a connector that asked for one.
    // Polling keeps the secret it was configured with, so the mode is
    // checked beside it. Neither an old secret nor a mode change alone
    // may leave an install verifying deliveries it no longer expects.
    if (purpose === "webhook" && (row.updateMode !== "webhook" || !row.webhookSecret)) return null;
    const key = `${row.id}:${row.updatedAt.getTime()}`;
    if (cached?.key === key) return cached.driver;
    const driver = buildDriver({
      environment: row.environment,
      integrationKey: row.integrationKey,
      apiUserId: row.apiUserId,
      privateKey: row.privateKey,
      webhookSecret: row.webhookSecret,
    });
    cached = { key, driver };
    return driver;
  };
}

/**
 * A resolver for a process that never signs: the OpenAPI emitter, and
 * the suites that build the app to test something else entirely. It
 * answers what an install with no connector answers, which is the
 * honest reading of "signing is not part of this process".
 *
 * It exists so the dependency stays required on {@link AppDeps}. A
 * default would let a real deployment forget to wire signing and
 * silently lose the send affordance instead of failing to compile.
 */
export function createUnconfiguredSigningResolver(): SigningResolver {
  return () => Promise.resolve(null);
}
