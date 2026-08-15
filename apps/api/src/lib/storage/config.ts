// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Which storage drivers an install runs, read from the environment
 * (DOC-009, DOC-014).
 *
 * The choice is made once, at startup, and the adapter is injected — no
 * module below this one reads the environment for storage, and no module
 * below this one knows there is more than one driver.
 *
 * The local filesystem driver is the default, because a self-hoster must
 * be able to store a file with no extra service to run. `STORAGE_DRIVER`
 * is what a deployment sets to point writes at an object store instead.
 *
 * Reads are wider than writes (DOC-014). What comes back from here is a
 * router over every configured driver: a read routes on the reference's
 * driver prefix, so an install that has switched drivers still reads —
 * and hard-deletes — what the old one wrote, permanently. The router
 * sits here, above the {@link StorageAdapter} interface; the drivers
 * never know it exists.
 */

import {
  BLOB_REF_SEPARATOR,
  InvalidBlobRefError,
  StorageError,
  type StorageAdapter,
} from "./adapter.js";
import {
  AZURE_BLOB_DRIVER,
  createAzureBlobStorage,
  type AzureBlobStorageOptions,
} from "./azure-blob.js";
import { DEFAULT_STORAGE_PATH, LOCAL_DRIVER, createLocalStorage } from "./local.js";
import { DEFAULT_S3_REGION, S3_DRIVER, createS3Storage, type S3StorageOptions } from "./s3.js";

/** The driver an install runs when `STORAGE_DRIVER` is unset. */
export const DEFAULT_STORAGE_DRIVER = LOCAL_DRIVER;

/** The drivers `STORAGE_DRIVER` may name, in the order they are documented. */
export const STORAGE_DRIVERS = [LOCAL_DRIVER, S3_DRIVER, AZURE_BLOB_DRIVER] as const;

/** The process environment, or a stand-in for it in a test. */
export type StorageEnvironment = Readonly<Record<string, string | undefined>>;

/** What the environment asked for, before anything is built from it. */
export type StorageConfig =
  | ({ driver: typeof LOCAL_DRIVER } & { root: string })
  | ({ driver: typeof S3_DRIVER } & S3StorageOptions)
  | ({ driver: typeof AZURE_BLOB_DRIVER } & AzureBlobStorageOptions);

/**
 * A configuration fault the operator has to fix. It is thrown rather
 * than defaulted around: an install that was told to use an object store
 * and cannot must stop, not fall back to a local disk and write files
 * where nobody will look for them.
 */
export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}

/**
 * The reference names a driver this install has not configured
 * (DOC-014). Distinct from not-found on purpose: the blob may well
 * exist, in a store this install can no longer reach, and the answer
 * has to say what to set rather than shrug.
 */
export class UnconfiguredDriverError extends StorageError {
  constructor(ref: string, driver: string, hint: string) {
    super(
      `${JSON.stringify(ref)} names the ${driver} driver, which is not configured here; ${hint}.`,
    );
    this.name = "UnconfiguredDriverError";
  }
}

/** What an operator sets to configure each driver, named in the error above. */
const CONFIGURATION_HINTS: Record<string, string> = {
  [S3_DRIVER]: "set S3_BUCKET and the other S3_* variables to reach its store",
  [AZURE_BLOB_DRIVER]:
    "set AZURE_BLOB_CONTAINER and the other AZURE_BLOB_* variables to reach its store",
};

/**
 * Reads one variable, treating empty as unset.
 *
 * Under Compose every declared variable exists and is empty when the
 * `.env` file leaves it out, so empty has to mean "not configured" here
 * as it does for `SMTP_URL` and `STORAGE_PATH`.
 */
function read(env: StorageEnvironment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/** Reads a variable that may only say yes or no. */
function readFlag(env: StorageEnvironment, name: string): boolean | undefined {
  const value = read(env, name)?.toLowerCase();
  if (value === undefined) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  // The name and what it accepts, never what it was given. This message
  // reaches stderr at boot, and a value read out of the environment is
  // not ours to print — the operator knows what they set.
  throw new StorageConfigError(`${name} must be true, false, 1, or 0.`);
}

/** The local driver's configuration — always present, because it has a default. */
function readLocalConfig(env: StorageEnvironment): StorageConfig {
  return { driver: LOCAL_DRIVER, root: read(env, "STORAGE_PATH") ?? DEFAULT_STORAGE_PATH };
}

/** The S3 driver's configuration, as the environment states it. */
function readS3Config(env: StorageEnvironment): StorageConfig {
  const bucket = read(env, "S3_BUCKET");
  if (!bucket) {
    throw new StorageConfigError(`Set S3_BUCKET when STORAGE_DRIVER is ${S3_DRIVER}.`);
  }

  const accessKeyId = read(env, "S3_ACCESS_KEY_ID");
  const secretAccessKey = read(env, "S3_SECRET_ACCESS_KEY");
  // Half a key pair is a typo, not a deployment. Left to the AWS
  // credential chain it would look like "no credentials configured" and
  // fail later with an error that names none of this.
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new StorageConfigError(
      "Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither — with neither, the AWS credential chain applies.",
    );
  }

  const endpoint = read(env, "S3_ENDPOINT");
  return {
    driver: S3_DRIVER,
    bucket,
    // Every request has to be signed for some region. A MinIO-class
    // store ignores which, so an operator running one has none to look
    // up and sets nothing.
    region: read(env, "S3_REGION") ?? DEFAULT_S3_REGION,
    endpoint,
    // A custom endpoint means a store that is not AWS, and those are
    // reached path-style: MinIO has no wildcard DNS to put a bucket name
    // in front of its host. The operator can still say otherwise.
    forcePathStyle: readFlag(env, "S3_FORCE_PATH_STYLE") ?? endpoint !== undefined,
    ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
  };
}

/** The Azure Blob driver's configuration, as the environment states it. */
function readAzureBlobConfig(env: StorageEnvironment): StorageConfig {
  const container = read(env, "AZURE_BLOB_CONTAINER");
  if (!container) {
    throw new StorageConfigError(
      `Set AZURE_BLOB_CONTAINER when STORAGE_DRIVER is ${AZURE_BLOB_DRIVER}.`,
    );
  }

  const account = read(env, "AZURE_BLOB_ACCOUNT");
  const key = read(env, "AZURE_BLOB_ACCOUNT_KEY");
  // A key with no account is half a credential: unlike the account
  // name, which stands alone (it names the store, and the Azure
  // credential chain can sign for it), the key signs *as* an account
  // and means nothing without one.
  if (key && !account) {
    throw new StorageConfigError(
      "Set AZURE_BLOB_ACCOUNT when AZURE_BLOB_ACCOUNT_KEY is set — a key signs as an account.",
    );
  }

  // Azure itself answers at a well-known address per account, so an
  // operator on Azure sets no endpoint — the mirror of S3_ENDPOINT
  // staying unset for AWS. Anything else (Azurite, OneLake) is spelled
  // out. With neither, there is no store to reach.
  const endpoint = read(env, "AZURE_BLOB_ENDPOINT");
  if (!endpoint && !account) {
    throw new StorageConfigError(
      "Set AZURE_BLOB_ACCOUNT (Azure answers at the account's own address) or AZURE_BLOB_ENDPOINT.",
    );
  }

  return {
    driver: AZURE_BLOB_DRIVER,
    container,
    endpoint: endpoint ?? `https://${account}.blob.core.windows.net`,
    // No key means the Azure credential chain — a managed identity or
    // a workload identity, the way a deployment on Azure avoids
    // holding a long-lived key at all.
    ...(account && key ? { credentials: { account, key } } : {}),
  };
}

/**
 * Reads the write driver's configuration out of the environment,
 * without building anything from it.
 *
 * Throws {@link StorageConfigError} when the environment names a driver
 * that does not exist, or names one and leaves out what it needs.
 */
export function readStorageConfig(env: StorageEnvironment): StorageConfig {
  const driver = read(env, "STORAGE_DRIVER")?.toLowerCase() ?? DEFAULT_STORAGE_DRIVER;
  switch (driver) {
    case LOCAL_DRIVER:
      return readLocalConfig(env);
    case S3_DRIVER:
      return readS3Config(env);
    case AZURE_BLOB_DRIVER:
      return readAzureBlobConfig(env);
    default:
      throw new StorageConfigError(
        `STORAGE_DRIVER must name one of ${STORAGE_DRIVERS.join(", ")}, not ${JSON.stringify(driver)}.`,
      );
  }
}

/**
 * Every driver the environment configures, keyed by name (DOC-014).
 *
 * The local driver is always here — it has a default root, which is
 * what makes the zero-configuration install work at all. An object
 * store is configured the moment its bucket or container is named,
 * whether or not it is the write driver; naming one and misconfiguring
 * the rest is a boot-stopping fault either way, because a reader that
 * cannot reach its store is not a reader.
 */
function readConfiguredDrivers(env: StorageEnvironment): Map<string, StorageConfig> {
  const configured = new Map<string, StorageConfig>([[LOCAL_DRIVER, readLocalConfig(env)]]);
  if (read(env, "S3_BUCKET")) configured.set(S3_DRIVER, readS3Config(env));
  if (read(env, "AZURE_BLOB_CONTAINER")) {
    configured.set(AZURE_BLOB_DRIVER, readAzureBlobConfig(env));
  }
  return configured;
}

/** Builds one driver from what the environment said about it. */
function createDriver(config: StorageConfig): StorageAdapter {
  switch (config.driver) {
    case LOCAL_DRIVER:
      return createLocalStorage(config);
    case S3_DRIVER:
      return createS3Storage(config);
    case AZURE_BLOB_DRIVER:
      return createAzureBlobStorage(config);
  }
}

/**
 * The router (DOC-014): one {@link StorageAdapter} over every
 * configured driver. Writes go to the one driver `STORAGE_DRIVER`
 * names; a read or a delete routes on its reference's driver prefix,
 * so history written under a previous driver stays reachable. Nothing
 * below the interface changes — each driver still validates the full
 * reference it is handed.
 */
function createStorageRouter(
  write: StorageAdapter,
  configured: Map<string, StorageAdapter>,
): StorageAdapter {
  function routed(ref: string): StorageAdapter {
    const separator = ref.indexOf(BLOB_REF_SEPARATOR);
    if (separator < 0) {
      throw new InvalidBlobRefError(
        `${JSON.stringify(ref)} is not a blob reference; the form is <driver>:<key>.`,
      );
    }
    const driver = ref.slice(0, separator);
    const adapter = configured.get(driver);
    if (adapter) return adapter;
    // A driver this build knows but this install has not configured is
    // answered with what to set — never with not-found, which would
    // read as "the blob is gone" when the truth is "you cannot see it
    // from here" (DOC-014).
    const hint = CONFIGURATION_HINTS[driver];
    if (hint) throw new UnconfiguredDriverError(ref, driver, hint);
    throw new InvalidBlobRefError(
      `${JSON.stringify(ref)} names the ${JSON.stringify(driver)} driver, and the drivers are ${STORAGE_DRIVERS.join(", ")}.`,
    );
  }

  // `async`, so a routing refusal is a rejection like every other
  // failure the interface defines — never a synchronous throw only a
  // `try` around the call itself would catch.
  return {
    driver: write.driver,
    put: (key, body) => write.put(key, body),
    async get(ref) {
      return routed(ref).get(ref);
    },
    async delete(ref) {
      return routed(ref).delete(ref);
    },
  };
}

/**
 * Builds the storage this install is configured for: the write driver
 * `STORAGE_DRIVER` names, wrapped in the read router over every
 * configured driver (DOC-014).
 */
export function createStorageFromEnv(env: StorageEnvironment): StorageAdapter {
  const write = readStorageConfig(env);
  const configured = new Map<string, StorageAdapter>();
  for (const [driver, config] of readConfiguredDrivers(env)) {
    configured.set(driver, createDriver(config));
  }
  // The write driver is always among the configured: local always is,
  // and `readStorageConfig` has already refused an object-store driver
  // whose bucket or container is unnamed.
  const writer = configured.get(write.driver);
  if (!writer) {
    throw new StorageConfigError(`The ${write.driver} driver is not configured.`);
  }
  return createStorageRouter(writer, configured);
}
