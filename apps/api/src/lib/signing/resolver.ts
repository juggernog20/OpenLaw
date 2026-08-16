// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where the signing provider comes from (CTR-013, TECH-013).
 *
 * Unlike storage and the doc engine, the signing connector is **org
 * data, not deployment environment**: an Administrator configures it in
 * Settings, and it changes while the process runs. So the app is
 * injected with a resolver rather than with a provider — the #37
 * mailer-resolver pattern — and every use reads the stored row live. A
 * rotated key applies to the next call with no restart and no cache to
 * invalidate.
 *
 * **An unconfigured install resolves to nothing.** `null` is the whole
 * answer for "no connector", which is what lets the record surfaces
 * leave the send control out rather than draw it disabled (DES-035's
 * absence rule), and what the manual hand-off path depends on: CTR-013
 * promises OpenLaw works before anyone configures anything.
 *
 * The driver factory is a parameter so the test harness can build the
 * deterministic fake from the same stored row the production resolver
 * reads. The resolution itself — read the row, decide configured or not
 * — is production code in both, which is the point: an install with no
 * row behaves the same under test as it does in the field.
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
export type SigningResolver = () => Promise<SigningProvider | null>;

/**
 * Reads the stored connector on every call and builds a provider from
 * it. Only `docusign` is a known adapter in v1, so a row for anything
 * else resolves to nothing rather than to a driver we do not have.
 */
export function createSigningResolver(
  db: Db,
  buildDriver: SigningDriverFactory = createDocuSignProvider,
): SigningResolver {
  return async () => {
    // Keyed on the adapter, not "whatever row is first": a second
    // provider's row must never be handed to the DocuSign driver.
    const [row] = await db
      .select()
      .from(signingConnectors)
      .where(eq(signingConnectors.provider, "docusign"))
      .limit(1);
    if (!row) return null;
    return buildDriver({
      environment: row.environment,
      integrationKey: row.integrationKey,
      apiUserId: row.apiUserId,
      privateKey: row.privateKey,
      webhookSecret: row.webhookSecret,
    });
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
