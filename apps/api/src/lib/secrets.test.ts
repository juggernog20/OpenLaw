// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What credentials at rest promise (TECH-022,
 * [#259](https://github.com/juggernog20/OpenLaw/issues/259)).
 *
 * The claim this suite has to hold up is one sentence: somebody holding
 * a `pg_dump` and nothing else cannot read the DocuSign key, the
 * Connect secret, the SMTP relay URL, or the SSO client secret. So the
 * assertions go past the ORM and read the stored text with raw SQL —
 * asking Drizzle would only ever return what it had already opened.
 *
 * The other half is the upgrade. An install that stored these in the
 * clear must come up sealed, having asked nobody to retype anything,
 * and a key rotation must do the same. Both run through the same boot
 * pass, so both are exercised the same way: write the "before" state
 * with raw SQL, run the pass, read it back.
 */

import { afterAll, beforeAll, expect, it, describe } from "vitest";
import {
  eq,
  orgSettings,
  readSecretKeys,
  rewrapSecrets,
  sealSecret,
  signingConnectors,
  sql,
  useSecretKeys,
  SECRET_ENVELOPE_PREFIX,
  SECRET_KEY_VARIABLE,
  PREVIOUS_SECRET_KEY_VARIABLE,
  type Db,
} from "@openlaw/db";
import { startHarness, TEST_SECRET_KEY, type TestHarness } from "../testing/harness.js";

/** A private key shaped like the one an Administrator pastes, signing nothing real. */
const RSA_KEY = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIEowIBAAKCAQEAopenlawsecretsfixturekeyneverusedanywhereelseatall",
  "-----END RSA PRIVATE KEY-----",
].join("\n"); // NOSONAR — inert fixture, not a credential

const CONNECT_SECRET = "openlaw-fixture-connect-secret"; // NOSONAR — inert fixture, not a credential
const RELAY_URL = "smtp://fixture:fixture-password@mail.example.com:587"; // NOSONAR — inert fixture, not a credential

/** A second key, long enough to be accepted, standing in for a rotation. */
const OTHER_KEY = "openlaw-test-rotation-key-with-enough-entropy"; // NOSONAR — inert fixture, not a credential

describe("reading the key from the environment", () => {
  it("refuses an install with no key, and names the command that makes one", () => {
    expect(() => readSecretKeys({})).toThrow(SECRET_KEY_VARIABLE);
    expect(() => readSecretKeys({})).toThrow("openssl rand -base64 32");
  });

  it("refuses a key short enough to have been typed by hand", () => {
    expect(() => readSecretKeys({ [SECRET_KEY_VARIABLE]: "hunter2" })).toThrow(
      "shorter than 32 characters",
    );
  });

  it("refuses a rotation whose two keys are the same value", () => {
    expect(() =>
      readSecretKeys({
        [SECRET_KEY_VARIABLE]: TEST_SECRET_KEY,
        [PREVIOUS_SECRET_KEY_VARIABLE]: TEST_SECRET_KEY,
      }),
    ).toThrow(PREVIOUS_SECRET_KEY_VARIABLE);
  });

  it("accepts a rotation with a different retiring key", () => {
    const keys = readSecretKeys({
      [SECRET_KEY_VARIABLE]: TEST_SECRET_KEY,
      [PREVIOUS_SECRET_KEY_VARIABLE]: OTHER_KEY,
    });
    expect(keys.previous).not.toBeNull();
  });
});

let harness: TestHarness;
let db: Db;

beforeAll(async () => {
  harness = await startHarness();
  db = harness.db;
});

afterAll(async () => {
  // Whatever a rotation test left installed must not leak into another
  // suite in the same worker process.
  useSecretKeys(readSecretKeys({ [SECRET_KEY_VARIABLE]: TEST_SECRET_KEY }));
  await harness.stop();
});

/** The column as Postgres holds it, past the ORM — the dump reader's view. */
async function storedText(table: string, column: string): Promise<string | null> {
  // `sql.identifier`, not interpolation into `sql.raw`: every caller
  // here passes a literal, but a helper shaped like this attracts one
  // that does not, and quoting the identifier removes the question.
  const read = await db.execute<{ value: string | null }>(
    sql`SELECT ${sql.identifier(column)} AS value FROM ${sql.identifier(table)} LIMIT 1`,
  );
  return read.rows[0]?.value ?? null;
}

/** A sealed value *starts* with the envelope prefix. `toMatch` would
 * accept one that merely contains it, which is not the claim. */
function expectSealed(value: string | null): void {
  expect(value?.startsWith(SECRET_ENVELOPE_PREFIX)).toBe(true);
}

async function saveConnector(privateKey: string, webhookSecret: string): Promise<void> {
  await db.delete(signingConnectors);
  await db.insert(signingConnectors).values({
    provider: "docusign",
    environment: "demo",
    integrationKey: "fixture-integration-key",
    apiUserId: "fixture-api-user",
    privateKey,
    webhookSecret,
  });
}

describe("what a database dump holds", () => {
  it("holds no readable DocuSign key or Connect secret", async () => {
    await saveConnector(RSA_KEY, CONNECT_SECRET);

    const storedKey = await storedText("signing_connectors", "private_key");
    const storedSecret = await storedText("signing_connectors", "webhook_secret");

    expectSealed(storedKey);
    expect(storedKey).not.toContain("BEGIN RSA PRIVATE KEY");
    expectSealed(storedSecret);
    expect(storedSecret).not.toContain(CONNECT_SECRET);
  });

  it("holds no readable SMTP relay password", async () => {
    await db.update(orgSettings).set({ smtpUrl: RELAY_URL, smtpFrom: "OpenLaw <o@example.com>" });

    const stored = await storedText("org_settings", "smtp_url");
    expectSealed(stored);
    expect(stored).not.toContain("fixture-password");
  });

  it("hands the credential back whole to the code that needs it", async () => {
    await saveConnector(RSA_KEY, CONNECT_SECRET);
    const [row] = await db
      .select()
      .from(signingConnectors)
      .where(eq(signingConnectors.provider, "docusign"))
      .limit(1);

    expect(row?.privateKey).toBe(RSA_KEY);
    expect(row?.webhookSecret).toBe(CONNECT_SECRET);
  });

  it("leaves a column nobody has configured as NULL rather than sealing nothing", async () => {
    await db.update(orgSettings).set({ smtpUrl: null, smtpFrom: null });

    expect(await storedText("org_settings", "smtp_url")).toBeNull();
    const [row] = await db.select({ smtpUrl: orgSettings.smtpUrl }).from(orgSettings).limit(1);
    expect(row?.smtpUrl).toBeNull();
  });

  it("cannot open a sealed value moved into another column", async () => {
    await saveConnector(RSA_KEY, CONNECT_SECRET);
    // The RSA key, sealed for its own column, written into the Connect
    // secret's. The seal is bound to the column name, so this reads as
    // an unset credential rather than as the key.
    await db.execute(
      sql`UPDATE signing_connectors SET webhook_secret = ${sealSecret(RSA_KEY, "private_key")}`,
    );

    const [row] = await db.select().from(signingConnectors).limit(1);
    expect(row?.webhookSecret).toBe("");
  });
});

describe("upgrading an install that stored credentials in the clear", () => {
  it("seals what is there, asking nobody to retype it", async () => {
    await saveConnector(RSA_KEY, CONNECT_SECRET);
    // What a version before TECH-022 left in the table.
    await db.execute(
      sql`UPDATE signing_connectors SET private_key = ${RSA_KEY}, webhook_secret = ${CONNECT_SECRET}`,
    );
    await db.execute(sql`UPDATE org_settings SET smtp_url = ${RELAY_URL}`);

    const report = await rewrapSecrets(db);

    expect(report.resealed).toEqual({ private_key: 1, webhook_secret: 1, smtp_url: 1 });
    expect(report.unreadable).toEqual({});
    expectSealed(await storedText("signing_connectors", "private_key"));
    const [row] = await db.select().from(signingConnectors).limit(1);
    expect(row?.privateKey).toBe(RSA_KEY);
    expect(row?.webhookSecret).toBe(CONNECT_SECRET);
  });

  it("does nothing at all on the boot after that", async () => {
    const report = await rewrapSecrets(db);
    expect(report.resealed).toEqual({});
    expect(report.unreadable).toEqual({});
  });

  it("leaves the connector's updatedAt alone, because resealing is not a rotation", async () => {
    await saveConnector(RSA_KEY, CONNECT_SECRET);
    await db.execute(sql`UPDATE signing_connectors SET private_key = ${RSA_KEY}`);
    const [before] = await db.select().from(signingConnectors).limit(1);

    await rewrapSecrets(db);

    const [after] = await db.select().from(signingConnectors).limit(1);
    expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
  });
});

describe("rotating the key", () => {
  it("moves every credential onto the new key in one boot", async () => {
    await saveConnector(RSA_KEY, CONNECT_SECRET);
    await db.update(orgSettings).set({ smtpUrl: RELAY_URL, smtpFrom: "OpenLaw <o@example.com>" });

    // The boot the deploy docs describe: the new key in one variable,
    // the retiring one in the other.
    useSecretKeys(
      readSecretKeys({
        [SECRET_KEY_VARIABLE]: OTHER_KEY,
        [PREVIOUS_SECRET_KEY_VARIABLE]: TEST_SECRET_KEY,
      }),
    );
    const report = await rewrapSecrets(db);
    expect(report.unreadable).toEqual({});
    expect(report.resealed.private_key).toBe(1);

    // And the boot after, with the old variable removed.
    useSecretKeys(readSecretKeys({ [SECRET_KEY_VARIABLE]: OTHER_KEY }));
    const [row] = await db.select().from(signingConnectors).limit(1);
    expect(row?.privateKey).toBe(RSA_KEY);
    expect(await rewrapSecrets(db)).toEqual({ resealed: {}, unreadable: {} });
  });

  it("reads a credential it cannot open as unset, and leaves the value alone", async () => {
    // The operator who lost the key: the rows are sealed under one this
    // process does not have.
    useSecretKeys(readSecretKeys({ [SECRET_KEY_VARIABLE]: TEST_SECRET_KEY }));
    const sealed = await storedText("signing_connectors", "private_key");

    const [row] = await db.select().from(signingConnectors).limit(1);
    expect(row?.privateKey).toBe("");

    const report = await rewrapSecrets(db);
    expect(report.unreadable.private_key).toBe(1);
    expect(report.resealed).toEqual({});
    // Untouched, so putting the right key back still recovers it.
    expect(await storedText("signing_connectors", "private_key")).toBe(sealed);
  });

  it("recovers everything once the right key is back", async () => {
    useSecretKeys(readSecretKeys({ [SECRET_KEY_VARIABLE]: OTHER_KEY }));
    const [row] = await db.select().from(signingConnectors).limit(1);
    expect(row?.privateKey).toBe(RSA_KEY);
  });
});
