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
import { eq, signingConnectors, type Db, type SigningEnvironment } from "@openlaw/db";
import { startHarness, type TestHarness } from "../../testing/harness.js";
import type { SigningProvider } from "./provider.js";
import { createSigningResolver, type SigningConnectorConfig } from "./resolver.js";

let harness: TestHarness;
let db: Db;

beforeAll(async () => {
  harness = await startHarness();
  db = harness.db;
});

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
 * A driver that answers the interface and does nothing.
 *
 * Written out in full rather than cast into place: a cast would let
 * `SigningProvider` grow a member without this file noticing, and the
 * compiler catching that is the point of having the interface. Every
 * method rejects, because a resolver test that reached a provider would
 * be testing the provider.
 */
function inertDriver(environment: SigningEnvironment): SigningProvider {
  const unreached = () => Promise.reject(new Error("the resolver suite never calls a driver"));
  return {
    provider: "docusign",
    environment,
    testConnection: unreached,
    sendEnvelope: unreached,
    voidEnvelope: unreached,
    readEnvelope: unreached,
    fetchExecutedDocument: unreached,
    verifyWebhook: () => {
      throw new Error("the resolver suite never calls a driver");
    },
  };
}

/**
 * A factory that builds an inert driver and remembers what it was asked
 * to build from. Each call answers a distinct object, so the assertions
 * below can compare identity.
 */
function countingFactory() {
  const built: SigningConnectorConfig[] = [];
  const factory = (config: SigningConnectorConfig): SigningProvider => {
    built.push(config);
    return inertDriver(config.environment);
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

  it("answers nothing while the connector is turned off, and again once it is back on", async () => {
    // The switch is the reversible half of #273, and this filter is the
    // whole mechanism behind it: a disabled row has to resolve exactly
    // as a missing one does, or every surface that reads "unconfigured"
    // from a null resolution would keep offering to send.
    await storeConnector(RSA_KEY);
    const { built, factory } = countingFactory();
    const resolve = createSigningResolver(db, factory);

    expect(await resolve()).not.toBeNull();

    await db
      .update(signingConnectors)
      .set({ disabledAt: new Date() })
      .where(eq(signingConnectors.provider, "docusign"));
    expect(await resolve()).toBeNull();

    // Turning it back on builds from the credentials the row kept —
    // which is the difference from deleting it.
    await db
      .update(signingConnectors)
      .set({ disabledAt: null })
      .where(eq(signingConnectors.provider, "docusign"));
    expect(await resolve()).not.toBeNull();
    expect(built).toHaveLength(2);
    expect(built[1]?.privateKey).toBe(RSA_KEY);
  });
});
