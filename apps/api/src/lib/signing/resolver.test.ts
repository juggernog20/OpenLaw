// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What the signing resolver promises about the driver it hands back
 * (CTR-013, [#278](https://github.com/juggernog20/OpenLaw/issues/278)).
 *
 * Two properties, and they pull against each other. A driver caches the
 * access token it minted, so resolving twice must not build twice — or
 * every round of the reconciliation sweep mints a fresh JWT and throws
 * away one that had not expired. And a credential an Administrator
 * rotated a second ago must be the credential the next call uses, with
 * no restart, which is the reason the resolver reads the row live in the
 * first place.
 *
 * The driver factory here counts and labels its calls. That is the whole
 * instrument: the assertions are about how many drivers were built and
 * from what, never about what a driver then did.
 */

import { afterAll, beforeAll, expect, it, describe } from "vitest";
import { eq, signingConnectors, type Db } from "@openlaw/db";
import { startHarness, type TestHarness } from "../../testing/harness.js";
import type { SigningProvider } from "./provider.js";
import { createSigningResolver, type SigningConnectorConfig } from "./resolver.js";

let harness: TestHarness;
let db: Db;

beforeAll(async () => {
  harness = await startHarness();
  db = harness.db;
}, 120_000);

afterAll(async () => {
  await harness.stop();
});

/** A private key shaped like the one an Administrator pastes. It is a
 * fixture for a throwaway container and signs nothing real. */
const RSA_KEY = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEAopenlawresolverfixturekeyneverusedanywhereelseatall",
  "-----END RSA PRIVATE KEY-----",
].join("\n"); // NOSONAR — inert fixture, not a credential

const ROTATED_RSA_KEY = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEArotatedresolverfixturekeyneverusedanywhereelseatall",
  "-----END RSA PRIVATE KEY-----",
].join("\n"); // NOSONAR — inert fixture, not a credential

/**
 * A factory that builds nothing but a label, and remembers what it was
 * asked to build from.
 *
 * The driver it answers is inert on purpose: a resolver test that
 * reached a provider would be testing the provider.
 */
function countingFactory() {
  const built: SigningConnectorConfig[] = [];
  const factory = (config: SigningConnectorConfig): SigningProvider => {
    built.push(config);
    return { provider: "docusign" } as unknown as SigningProvider;
  };
  return { built, factory };
}

/** Puts one connector row in place, replacing whatever was there. */
async function storeConnector(privateKey: string): Promise<void> {
  await db.delete(signingConnectors).where(eq(signingConnectors.provider, "docusign"));
  await db.insert(signingConnectors).values({
    provider: "docusign",
    environment: "demo",
    integrationKey: "resolver-suite-integration-key",
    apiUserId: "11111111-2222-3333-4444-555555555555",
    privateKey,
    webhookSecret: "resolver-suite-hmac", // NOSONAR — inert fixture
  });
}

describe("the signing resolver", () => {
  it("builds one driver for an unchanged connector, however often it is asked", async () => {
    // The sweep's shape: one resolution per page, several pages per
    // round. Before the cache this was one JWT grant per page against
    // the endpoint DocuSign rate-limits hardest.
    await storeConnector(RSA_KEY);
    const { built, factory } = countingFactory();
    const resolve = createSigningResolver(db, factory);

    const first = await resolve();
    const second = await resolve();
    const third = await resolve();

    expect(built).toHaveLength(1);
    // The same instance, which is what carries the minted token and the
    // account discovery from one call to the next.
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("applies a rotated credential to the next call, with no restart", async () => {
    // The promise the resolver exists for, and the one a cache is most
    // likely to break. The row is still read every time; only the build
    // is skipped.
    await storeConnector(RSA_KEY);
    const { built, factory } = countingFactory();
    const resolve = createSigningResolver(db, factory);

    const before = await resolve();
    await storeConnector(ROTATED_RSA_KEY);
    const after = await resolve();

    expect(built).toHaveLength(2);
    expect(after).not.toBe(before);
    expect(built[1]?.privateKey).toBe(ROTATED_RSA_KEY);
  });

  it("answers nothing, and holds nothing, once the connector is gone", async () => {
    // A driver kept past its row would be credentials this install has
    // said it no longer holds.
    await storeConnector(RSA_KEY);
    const { built, factory } = countingFactory();
    const resolve = createSigningResolver(db, factory);

    await resolve();
    await db.delete(signingConnectors).where(eq(signingConnectors.provider, "docusign"));
    expect(await resolve()).toBeNull();

    // Re-configured, it builds again rather than answering the driver it
    // was holding before the removal.
    await storeConnector(RSA_KEY);
    await resolve();
    expect(built).toHaveLength(2);
  });
});
