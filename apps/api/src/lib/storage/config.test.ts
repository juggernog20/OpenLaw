// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Choosing the driver from the environment (DOC-009).
 *
 * These assertions are about what an operator's `.env` means, so they
 * read the configuration rather than the store behind it — the driver
 * behaviour itself is the shared contract suite's job, once per driver.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { describeStorageAdapterContract } from "../../testing/storage-contract.js";
import { InvalidBlobRefError } from "./adapter.js";
import { AZURE_BLOB_DRIVER } from "./azure-blob.js";
import {
  StorageConfigError,
  UnconfiguredDriverError,
  createStorageFromEnv,
  readStorageConfig,
} from "./config.js";
import { DEFAULT_STORAGE_PATH, LOCAL_DRIVER } from "./local.js";
import { DEFAULT_S3_REGION, S3_DRIVER } from "./s3.js";

/** What a bucket-configured deployment sets, at its shortest. */
const S3_ENV = {
  STORAGE_DRIVER: "s3",
  S3_BUCKET: "openlaw-files",
} as const;

/** What a container-configured deployment sets, at its shortest. */
const AZURE_ENV = {
  STORAGE_DRIVER: "azure-blob",
  AZURE_BLOB_CONTAINER: "openlaw-files",
  AZURE_BLOB_ACCOUNT: "openlaw",
} as const;

describe("choosing the storage driver", () => {
  it("runs the local filesystem driver when nothing is set", () => {
    expect(readStorageConfig({})).toEqual({
      driver: LOCAL_DRIVER,
      root: DEFAULT_STORAGE_PATH,
    });
    expect(createStorageFromEnv({}).driver).toBe(LOCAL_DRIVER);
  });

  it("runs the local filesystem driver when the variable is present but empty", () => {
    // Under Compose every declared variable exists; empty means unset.
    expect(readStorageConfig({ STORAGE_DRIVER: "", STORAGE_PATH: "" })).toEqual({
      driver: LOCAL_DRIVER,
      root: DEFAULT_STORAGE_PATH,
    });
  });

  it("roots the local driver where STORAGE_PATH says", () => {
    expect(readStorageConfig({ STORAGE_PATH: "/srv/openlaw" })).toEqual({
      driver: LOCAL_DRIVER,
      root: "/srv/openlaw",
    });
  });

  it("runs the S3 driver when STORAGE_DRIVER names it", () => {
    expect(createStorageFromEnv(S3_ENV).driver).toBe(S3_DRIVER);
  });

  it("runs the Azure Blob driver when STORAGE_DRIVER names it", () => {
    expect(createStorageFromEnv(AZURE_ENV).driver).toBe(AZURE_BLOB_DRIVER);
  });

  it("refuses a driver name nothing implements", () => {
    expect(() => readStorageConfig({ STORAGE_DRIVER: "sharepoint" })).toThrow(StorageConfigError);
  });
});

describe("the S3 driver's environment", () => {
  it("takes the bucket, endpoint, region, and credentials", () => {
    expect(
      readStorageConfig({
        ...S3_ENV,
        S3_ENDPOINT: "https://s3.example.com",
        S3_REGION: "eu-west-1",
        S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
        S3_SECRET_ACCESS_KEY: "not-a-real-secret", // NOSONAR — fixture
      }),
    ).toEqual({
      driver: S3_DRIVER,
      bucket: "openlaw-files",
      endpoint: "https://s3.example.com",
      region: "eu-west-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "not-a-real-secret", // NOSONAR — fixture
      },
    });
  });

  it("leaves the credentials to the AWS chain when neither key is set", () => {
    expect(readStorageConfig(S3_ENV)).not.toHaveProperty("credentials");
  });

  it("refuses half a key pair", () => {
    expect(() => readStorageConfig({ ...S3_ENV, S3_ACCESS_KEY_ID: "AKIAEXAMPLE" })).toThrow(
      StorageConfigError,
    );
    expect(
      () => readStorageConfig({ ...S3_ENV, S3_SECRET_ACCESS_KEY: "not-a-real-secret" }), // NOSONAR — fixture
    ).toThrow(StorageConfigError);
  });

  it("refuses a driver with no bucket", () => {
    expect(() => readStorageConfig({ STORAGE_DRIVER: "s3" })).toThrow(StorageConfigError);
  });

  it("addresses AWS itself as a subdomain, and a custom endpoint as a path", () => {
    expect(readStorageConfig(S3_ENV)).toMatchObject({ forcePathStyle: false });
    expect(readStorageConfig({ ...S3_ENV, S3_ENDPOINT: "http://minio:9000" })).toMatchObject({
      forcePathStyle: true,
    });
  });

  it("lets the operator override the addressing either way", () => {
    expect(
      readStorageConfig({
        ...S3_ENV,
        S3_ENDPOINT: "https://s3.example.com",
        S3_FORCE_PATH_STYLE: "false",
      }),
    ).toMatchObject({ forcePathStyle: false });
    expect(readStorageConfig({ ...S3_ENV, S3_FORCE_PATH_STYLE: "true" })).toMatchObject({
      forcePathStyle: true,
    });
  });

  it("refuses addressing that says neither yes nor no, without repeating what it was given", () => {
    // The message reaches stderr at boot. It names the variable and what
    // the variable accepts, and it does not echo a value read out of the
    // environment back into the log.
    expect(() => readStorageConfig({ ...S3_ENV, S3_FORCE_PATH_STYLE: "maybe" })).toThrow(
      StorageConfigError,
    );
    expect(() => readStorageConfig({ ...S3_ENV, S3_FORCE_PATH_STYLE: "maybe" })).toThrow(
      /^S3_FORCE_PATH_STYLE must be true, false, 1, or 0\.$/,
    );
  });

  it("signs with a default region, so a MinIO-class store needs none set", () => {
    expect(readStorageConfig(S3_ENV)).toMatchObject({ region: DEFAULT_S3_REGION });
  });
});

describe("the Azure Blob driver's environment", () => {
  it("takes the container, endpoint, and credentials", () => {
    expect(
      readStorageConfig({
        ...AZURE_ENV,
        AZURE_BLOB_ENDPOINT: "https://blob.example.com",
        AZURE_BLOB_ACCOUNT_KEY: "bm90LWEtcmVhbC1rZXk=", // NOSONAR — fixture
      }),
    ).toEqual({
      driver: AZURE_BLOB_DRIVER,
      container: "openlaw-files",
      endpoint: "https://blob.example.com",
      credentials: {
        account: "openlaw",
        key: "bm90LWEtcmVhbC1rZXk=", // NOSONAR — fixture
      },
    });
  });

  it("reaches Azure at the account's own address when no endpoint is set", () => {
    expect(readStorageConfig(AZURE_ENV)).toMatchObject({
      endpoint: "https://openlaw.blob.core.windows.net",
    });
  });

  it("leaves the credentials to the Azure chain when no key is set", () => {
    expect(readStorageConfig(AZURE_ENV)).not.toHaveProperty("credentials");
  });

  it("refuses a key with no account to sign as", () => {
    expect(() =>
      readStorageConfig({
        STORAGE_DRIVER: "azure-blob",
        AZURE_BLOB_CONTAINER: "openlaw-files",
        AZURE_BLOB_ENDPOINT: "https://blob.example.com",
        AZURE_BLOB_ACCOUNT_KEY: "bm90LWEtcmVhbC1rZXk=", // NOSONAR — fixture
      }),
    ).toThrow(StorageConfigError);
  });

  it("refuses a driver with no container", () => {
    expect(() => readStorageConfig({ STORAGE_DRIVER: "azure-blob" })).toThrow(StorageConfigError);
  });

  it("refuses an account name Azure could never issue", () => {
    // The name is interpolated into the store's address, so a bad one
    // would become a quietly wrong URL rather than a named fault.
    expect(() => readStorageConfig({ ...AZURE_ENV, AZURE_BLOB_ACCOUNT: "Not-An-Account" })).toThrow(
      StorageConfigError,
    );
  });

  it("refuses a plain-http endpoint with no key, where a bearer token would travel unencrypted", () => {
    expect(() =>
      readStorageConfig({ ...AZURE_ENV, AZURE_BLOB_ENDPOINT: "http://azurite:10000/openlaw" }),
    ).toThrow(StorageConfigError);
    // With a key the same endpoint is fine — that is exactly how
    // Azurite is reached.
    expect(
      readStorageConfig({
        ...AZURE_ENV,
        AZURE_BLOB_ENDPOINT: "http://azurite:10000/openlaw",
        AZURE_BLOB_ACCOUNT_KEY: "bm90LWEtcmVhbC1rZXk=", // NOSONAR — fixture
      }),
    ).toMatchObject({ endpoint: "http://azurite:10000/openlaw" });
  });

  it("refuses a driver with neither an account nor an endpoint to reach", () => {
    expect(() =>
      readStorageConfig({ STORAGE_DRIVER: "azure-blob", AZURE_BLOB_CONTAINER: "openlaw-files" }),
    ).toThrow(StorageConfigError);
  });
});

describe("the read router (DOC-014)", () => {
  /** A local-driver install rooted in a throwaway directory. */
  async function localInstall(extra: Record<string, string> = {}) {
    const root = await mkdtemp(join(tmpdir(), "openlaw-router-"));
    return {
      storage: createStorageFromEnv({ STORAGE_PATH: root, ...extra }),
      root,
      stop: () => rm(root, { recursive: true, force: true }),
    };
  }

  it("routes a read to the driver the reference names, not the write driver", async () => {
    // An install that moved from local to azure-blob: the write driver
    // changed, and a reference the local driver wrote must still read.
    const install = await localInstall(AZURE_ENV);
    try {
      await writeFile(join(install.root, "an-old-upload"), "written before the driver switch");

      const stream = await install.storage.get("local:an-old-upload");
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks).toString()).toBe("written before the driver switch");
    } finally {
      await install.stop();
    }
  });

  it("writes through the one driver STORAGE_DRIVER names", async () => {
    const install = await localInstall();
    try {
      const ref = await install.storage.put("a-fresh-upload", Readable.from(["the draft"]));
      expect(ref).toBe("local:a-fresh-upload");
    } finally {
      await install.stop();
    }
  });

  it("answers an unconfigured driver's reference with what to set, not with not-found", async () => {
    const install = await localInstall();
    try {
      const readIt = install.storage.get("s3:somewhere/a-blob");
      await expect(readIt).rejects.toBeInstanceOf(UnconfiguredDriverError);
      await expect(readIt).rejects.toThrow(/names the s3 driver/);
      await expect(readIt).rejects.toThrow(/S3_BUCKET/);

      const deleteIt = install.storage.delete("azure-blob:somewhere/a-blob");
      await expect(deleteIt).rejects.toBeInstanceOf(UnconfiguredDriverError);
      await expect(deleteIt).rejects.toThrow(/AZURE_BLOB_CONTAINER/);
    } finally {
      await install.stop();
    }
  });

  it("refuses a reference naming a driver that does not exist", async () => {
    const install = await localInstall();
    try {
      await expect(install.storage.get("sharepoint:somewhere/a-blob")).rejects.toBeInstanceOf(
        InvalidBlobRefError,
      );
    } finally {
      await install.stop();
    }
  });

  it("refuses a driver name that is an Object.prototype property", async () => {
    // The driver name comes out of a stored reference. A plain-object
    // hint lookup would answer `Object.prototype.constructor` for
    // this one and misreport it as an unconfigured driver.
    const install = await localInstall();
    try {
      await expect(install.storage.get("constructor:somewhere/a-blob")).rejects.toBeInstanceOf(
        InvalidBlobRefError,
      );
    } finally {
      await install.stop();
    }
  });

  it("stops the boot when a configured reader is misconfigured, even off the write path", () => {
    // Half an S3 key pair beside a local write driver: before DOC-014
    // the S3 variables were ignored; now a named bucket makes S3 a
    // reader, and a reader that cannot reach its store is a fault to
    // fix at boot, not at the first old reference.
    expect(() =>
      createStorageFromEnv({
        S3_BUCKET: "openlaw-files",
        S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
      }),
    ).toThrow(StorageConfigError);
  });
});

// The router is what the app factory is handed, so it must be a storage
// adapter in full — the same shared contract every driver passes,
// proving the routing layer adds nothing and takes nothing away.
describeStorageAdapterContract(LOCAL_DRIVER, async () => {
  const root = await mkdtemp(join(tmpdir(), "openlaw-router-contract-"));
  return {
    adapter: createStorageFromEnv({ STORAGE_PATH: root }),
    stop: () => rm(root, { recursive: true, force: true }),
  };
});
