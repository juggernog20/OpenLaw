// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Choosing the driver from the environment (DOC-009).
 *
 * These assertions are about what an operator's `.env` means, so they
 * read the configuration rather than the store behind it — the driver
 * behaviour itself is the shared contract suite's job, once per driver.
 */

import { describe, expect, it } from "vitest";
import { StorageConfigError, createStorageFromEnv, readStorageConfig } from "./config.js";
import { DEFAULT_STORAGE_PATH, LOCAL_DRIVER } from "./local.js";
import { DEFAULT_S3_REGION, S3_DRIVER } from "./s3.js";

/** What a bucket-configured deployment sets, at its shortest. */
const S3_ENV = {
  STORAGE_DRIVER: "s3",
  S3_BUCKET: "openlaw-files",
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

  it("refuses addressing that says neither yes nor no", () => {
    expect(() => readStorageConfig({ ...S3_ENV, S3_FORCE_PATH_STYLE: "maybe" })).toThrow(
      StorageConfigError,
    );
  });

  it("signs with a default region, so a MinIO-class store needs none set", () => {
    expect(readStorageConfig(S3_ENV)).toMatchObject({ region: DEFAULT_S3_REGION });
  });
});
