// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where the signing provider comes from (CTR-013, TECH-013).
 *
 * Unlike storage and the doc engine, the signing connector is **org
 * data, not deployment environment**: an Administrator configures it in
 * Settings, and it changes while the process runs. So the app is
 * injected with a resolver rather than with a provider — the #37
 * mailer-resolver pattern — and every use reads the stored row live. A
 * rotated key applies to the next call with no restart.
 *
 * **The row is read every time; the driver is not rebuilt every time.**
 * A `DocuSignProvider` caches the access token it minted and the account
 * it discovered, on the instance. Building a fresh one per resolution
 * threw both away, so a burst through one instance cost one JWT grant
 * and two resolutions cost two — against the endpoint DocuSign rate
 * limits hardest. The reconciliation sweep made that visible: it
 * resolves once per page, so a five-minute round on a self-hosted
 * install minted a fresh token every five minutes and discarded one that
 * had not expired.
 *
 * The cache is keyed on **the row's identity and its `updatedAt`**,
 * which is what keeps the rotation promise intact rather than trading it
 * away. A save changes `updatedAt` (the column's own `$onUpdate`), so
 * the very next call reads a key that does not match and builds a driver
 * from the new credentials. An unchanged row reuses the token it already
 * has. The read is not skipped — that is the part that must stay live,
 * because it is what notices the rotation.
 *
 * **No lifetime of its own.** The driver refreshes its own token when it
 * expires, so a ceiling here would throw away a working driver to
 * rebuild an identical one. The entry is replaced when the row changes
 * and dropped when the row goes, and there is at most one of it, because
 * the table holds at most one row per adapter.
 *
 * A rotation that lands in the same millisecond as the previous one
 * would not be noticed. Two saves are serialized by the route's own row
 * lock, so this needs two Administrators pressing Save inside one
 * millisecond, and it costs one stale driver until the next save.
 *
 * **An unconfigured install resolves to nothing.** `null` is the whole
 * answer for "no connector", which is what lets the record surfaces
 * leave the send control out rather than draw it disabled (DES-035's
 * absence rule), and what the manual hand-off path depends on: CTR-013
 * promises OpenLaw works before anyone configures anything.
 *
 * **A connector an Administrator turned off resolves to nothing too**,
 * and that is the whole of what the switch does (#273). Every surface
 * then answers as it did before the connector existed, which is what
 * puts the manual hand-off back within reach for an install that has
 * configured one. There is deliberately no third answer between
 * "configured" and "not": a `disabled` state that callers had to branch
 * on would be a second rule to keep in step at every seam, for a
 * distinction only the settings pane is interested in.
 *
 * The driver factory is a parameter so the test harness can build the
 * deterministic fake from the same stored row the production resolver
 * reads. The resolution itself — read the row, decide configured or not
 * — is production code in both, which is the point: an install with no
 * row behaves the same under test as it does in the field.
 */

import { and, eq, isNull, signingConnectors, type Db } from "@openlaw/db";
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
  /** The driver last built, and the row state it was built from. */
  let cached: { key: string; driver: SigningProvider } | null = null;

  return async () => {
    // Keyed on the adapter, not "whatever row is first": a second
    // provider's row must never be handed to the DocuSign driver.
    const [row] = await db
      .select()
      .from(signingConnectors)
      .where(and(eq(signingConnectors.provider, "docusign"), isNull(signingConnectors.disabledAt)))
      .limit(1);
    if (!row) {
      // No connector, or one that is turned off. Dropped rather than
      // left behind: a driver kept past its row is credentials this
      // install has said it no longer holds, and a driver kept past a
      // disable would keep sending after the switch was thrown.
      cached = null;
      return null;
    }
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
