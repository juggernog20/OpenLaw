// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Credentials at rest (TECH-022, superseding TECH-021,
 * [#259](https://github.com/juggernog20/OpenLaw/issues/259)).
 *
 * **The problem this exists for.** Four columns hold credentials an
 * Administrator pasted into Settings: the RSA private key that signs
 * DocuSign JWT assertions, the DocuSign Connect HMAC secret, the SMTP
 * relay URL with its password inline, and the SSO client secret inside
 * better-auth's OIDC config. Held in the clear, anybody with a
 * `pg_dump` can mint JWTs as the install's integration user, forge a
 * "this was signed" webhook delivery, and send mail as the
 * organisation. A backup file is a much lower bar than a live database,
 * and backups get copied to laptops.
 *
 * **What this module does.** Every one of those columns is declared
 * with {@link encryptedText} instead of `text`. The value is sealed on
 * the way to Postgres and opened on the way back, so no route, no job
 * and no resolver below the schema knows the difference — and no
 * caller can forget to do it. The column stays `text` in the DDL: what
 * changed is what is written into it, not the shape of the table.
 *
 * **Where the key comes from.** `OPENLAW_SECRET_KEY`, read once at
 * boot by the API and the worker, which refuse to start without it. It
 * is deliberately outside the database, because a key inside the
 * backup it protects is not a key. The whole reason TECH-021 refused to
 * ship the cheap version of this change is that an environment
 * variable alone moves the secret from one file the deployer backs up
 * to another file the deployer backs up — so the key-handling section
 * of `docs/DEPLOYMENT.md` is half of this feature, not documentation
 * of it.
 *
 * **The envelope says what it is.** A sealed value reads
 * `openlaw:v1:<base64>`. That prefix does three jobs. An install
 * upgrading from a version that stored plaintext has values with no
 * prefix, and they are opened as-is and rewritten on the first boot
 * (see `rewrap.ts`) — nobody re-enters a credential by hand. A version
 * number gives a later cipher change somewhere to live. And a human
 * looking at a dump can tell at a glance that the column is sealed.
 *
 * **A rotation is two variables and one boot.** Put the new key in
 * `OPENLAW_SECRET_KEY` and the old one in
 * `OPENLAW_SECRET_KEY_PREVIOUS`; the previous key is accepted for
 * reads only, the boot rewrap rewrites every value under the new key,
 * and the deployer then removes the old variable. Nothing is retyped.
 *
 * **A value no configured key opens reads as "not set".** It does not
 * throw. Every reader of these four columns already has an
 * unconfigured path — the Settings pane reports the credential as
 * absent, the mailer reports email as unconfigured, the SSO update
 * handler asks the Administrator to repair the row — and that path is
 * exactly the recovery an operator who lost the key needs: open
 * Settings and paste the credential again. A read that threw would
 * fail the pane they have to recover from.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { customType } from "drizzle-orm/pg-core";

/** The one required key. Named in every refusal so a boot failure is self-explaining. */
export const SECRET_KEY_VARIABLE = "OPENLAW_SECRET_KEY";

/**
 * The retiring key during a rotation, accepted for reads only. Set it
 * alongside the new key for one boot, then remove it.
 */
export const PREVIOUS_SECRET_KEY_VARIABLE = "OPENLAW_SECRET_KEY_PREVIOUS";

/**
 * The shortest key accepted, in characters. `openssl rand -base64 32`
 * — the command every refusal names — produces 44, so the floor only
 * catches a deployer who typed a word in instead.
 */
export const SECRET_KEY_MIN_LENGTH = 32;

/** What a sealed value starts with. See the module note on why it is self-describing. */
export const SECRET_ENVELOPE_PREFIX = "openlaw:v1:";

/** What a value no configured key opens reads as. See the module note. */
export const UNREADABLE_SECRET = "";

/** AES-256-GCM: a 12-byte nonce and a 16-byte tag, both carried in the envelope. */
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** The keys one process runs with. Both are already derived — see {@link readSecretKeys}. */
export interface SecretKeys {
  current: Buffer;
  /** NULL outside a rotation, which is almost always. */
  previous: Buffer | null;
}

/**
 * Turns a configured key into the 32 bytes AES-256 wants.
 *
 * Hashing rather than base64-decoding means any generator works — the
 * base64 the docs recommend, a hex string, a passphrase from a secret
 * manager — and none of them has to be exactly 32 bytes long. The
 * length floor above is what keeps a short one out.
 */
function deriveKey(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Reads the key (and, during a rotation, the retiring one) from the
 * environment, or throws with the command that fixes it.
 *
 * Called once per process at boot, so nothing below the entry point
 * reads the environment — the storage driver's rule, applied to the
 * one secret every credential column depends on.
 */
export function readSecretKeys(env: Record<string, string | undefined>): SecretKeys {
  const current = env[SECRET_KEY_VARIABLE]?.trim() ?? "";
  if (!current) {
    throw new Error(
      `${SECRET_KEY_VARIABLE} is required — it encrypts the stored DocuSign key, the ` +
        "Connect secret, the SMTP relay URL and the SSO client secret. Generate one with " +
        "`openssl rand -base64 32`, set it in .env, and keep it out of the same backup as " +
        "the database (see docs/DEPLOYMENT.md).",
    );
  }
  if (current.length < SECRET_KEY_MIN_LENGTH) {
    throw new Error(
      `${SECRET_KEY_VARIABLE} is shorter than ${SECRET_KEY_MIN_LENGTH} characters. ` +
        "Generate one with `openssl rand -base64 32`.",
    );
  }

  const previous = env[PREVIOUS_SECRET_KEY_VARIABLE]?.trim() ?? "";
  if (previous && previous.length < SECRET_KEY_MIN_LENGTH) {
    throw new Error(
      `${PREVIOUS_SECRET_KEY_VARIABLE} is shorter than ${SECRET_KEY_MIN_LENGTH} characters. ` +
        "Set it to the key being retired, or remove it once the rotation is finished.",
    );
  }
  if (previous && previous === current) {
    throw new Error(
      `${PREVIOUS_SECRET_KEY_VARIABLE} holds the same value as ${SECRET_KEY_VARIABLE}. ` +
        "A rotation needs the old key in one and the new key in the other; remove the " +
        "old variable once the rotation is finished.",
    );
  }

  return { current: deriveKey(current), previous: previous ? deriveKey(previous) : null };
}

/**
 * The keys this process seals and opens with.
 *
 * Module state, because Drizzle's custom types are pure value mappers
 * with nowhere to inject a dependency. The entry points set it before
 * anything can reach a credential column, and sealing without it
 * throws rather than writing something nobody can read back.
 */
let configured: SecretKeys | null = null;

/** Installs the keys for this process. Called at boot, once, by the API, the worker and the test harness. */
export function useSecretKeys(keys: SecretKeys): void {
  configured = keys;
}

function requireKeys(): SecretKeys {
  if (!configured) {
    throw new Error(
      `The credential encryption key is not configured. Read it with readSecretKeys(process.env) ` +
        `and install it with useSecretKeys() at boot; ${SECRET_KEY_VARIABLE} is required.`,
    );
  }
  return configured;
}

/**
 * Seals one value for one column.
 *
 * The column name is the additional authenticated data, so a sealed
 * value carried from one column to another fails to open. It costs
 * nothing and it means a dump edited by hand cannot promote the SMTP
 * password into the private-key column.
 */
export function sealSecret(value: string, column: string): string {
  const { current } = requireKeys();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", current, nonce);
  cipher.setAAD(Buffer.from(column, "utf8"));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const envelope = Buffer.concat([nonce, cipher.getAuthTag(), body]);
  return SECRET_ENVELOPE_PREFIX + envelope.toString("base64");
}

/** One attempt with one key. NULL means this key does not open it. */
function openWith(key: Buffer, sealed: string, column: string): string | null {
  const envelope = Buffer.from(sealed.slice(SECRET_ENVELOPE_PREFIX.length), "base64");
  if (envelope.length < NONCE_BYTES + TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, envelope.subarray(0, NONCE_BYTES));
    decipher.setAAD(Buffer.from(column, "utf8"));
    decipher.setAuthTag(envelope.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
    const opened = Buffer.concat([
      decipher.update(envelope.subarray(NONCE_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
    return opened.toString("utf8");
  } catch {
    // GCM authenticates on final(): a wrong key, a moved value and a
    // tampered one all land here, and none of them is distinguishable
    // from the others. That is the point of the tag.
    return null;
  }
}

/**
 * Opens a stored value, or NULL if no configured key does.
 *
 * A value with no envelope prefix is plaintext written by a version
 * before TECH-022 and is returned as it stands — that is what lets an
 * existing install upgrade without anybody re-entering a credential.
 */
export function openSecret(stored: string, column: string): string | null {
  if (!stored.startsWith(SECRET_ENVELOPE_PREFIX)) return stored;
  const { current, previous } = requireKeys();
  const opened = openWith(current, stored, column);
  if (opened !== null) return opened;
  return previous ? openWith(previous, stored, column) : null;
}

/** Whether this stored value is already sealed under the key in use — the rewrap's skip test. */
export function sealedByCurrentKey(stored: string, column: string): boolean {
  if (!stored.startsWith(SECRET_ENVELOPE_PREFIX)) return false;
  return openWith(requireKeys().current, stored, column) !== null;
}

/**
 * A `text` column whose contents are sealed at rest.
 *
 * The DDL is unchanged — `dataType` is `text` — so declaring a column
 * this way is not a migration. What changes is the value: sealed on
 * the way in, opened on the way out, invisibly to every caller.
 *
 * The name is passed rather than inferred because it is both the
 * column name Postgres sees and the additional authenticated data the
 * seal is bound to.
 */
export function encryptedText(name: string) {
  return customType<{ data: string; driverData: string }>({
    dataType: () => "text",
    toDriver: (value) => sealSecret(value, name),
    fromDriver: (value) => openSecret(value, name) ?? UNREADABLE_SECRET,
  })(name);
}
