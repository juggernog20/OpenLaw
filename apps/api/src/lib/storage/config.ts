// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Which storage driver an install runs, read from the environment
 * (DOC-009).
 *
 * The choice is made once, at startup, and the adapter is injected — no
 * module below this one reads the environment for storage, and no module
 * below this one knows there is more than one driver.
 *
 * The local filesystem driver is the default, because a self-hoster must
 * be able to store a file with no extra service to run. `STORAGE_DRIVER`
 * is what a deployment sets to point at an object store instead.
 */

import type { StorageAdapter } from "./adapter.js";
import { DEFAULT_STORAGE_PATH, LOCAL_DRIVER, createLocalStorage } from "./local.js";
import { DEFAULT_S3_REGION, S3_DRIVER, createS3Storage, type S3StorageOptions } from "./s3.js";

/** The driver an install runs when `STORAGE_DRIVER` is unset. */
export const DEFAULT_STORAGE_DRIVER = LOCAL_DRIVER;

/** The drivers `STORAGE_DRIVER` may name, in the order they are documented. */
export const STORAGE_DRIVERS = [LOCAL_DRIVER, S3_DRIVER] as const;

/** The process environment, or a stand-in for it in a test. */
export type StorageEnvironment = Readonly<Record<string, string | undefined>>;

/** What the environment asked for, before anything is built from it. */
export type StorageConfig =
  | ({ driver: typeof LOCAL_DRIVER } & { root: string })
  | ({ driver: typeof S3_DRIVER } & S3StorageOptions);

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
  throw new StorageConfigError(`${name} must be true or false, not ${JSON.stringify(value)}.`);
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

/**
 * Reads the storage configuration out of the environment, without
 * building anything from it.
 *
 * Throws {@link StorageConfigError} when the environment names a driver
 * that does not exist, or names one and leaves out what it needs.
 */
export function readStorageConfig(env: StorageEnvironment): StorageConfig {
  const driver = read(env, "STORAGE_DRIVER")?.toLowerCase() ?? DEFAULT_STORAGE_DRIVER;
  switch (driver) {
    case LOCAL_DRIVER:
      return { driver: LOCAL_DRIVER, root: read(env, "STORAGE_PATH") ?? DEFAULT_STORAGE_PATH };
    case S3_DRIVER:
      return readS3Config(env);
    default:
      throw new StorageConfigError(
        `STORAGE_DRIVER must name one of ${STORAGE_DRIVERS.join(", ")}, not ${JSON.stringify(driver)}.`,
      );
  }
}

/** Builds the storage adapter this install is configured for. */
export function createStorageFromEnv(env: StorageEnvironment): StorageAdapter {
  const config = readStorageConfig(env);
  return config.driver === LOCAL_DRIVER ? createLocalStorage(config) : createS3Storage(config);
}
