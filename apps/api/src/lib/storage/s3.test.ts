// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The S3-compatible driver against a MinIO container: the same shared
 * contract suite the local filesystem driver passes, plus the few facts
 * that are only true of this driver (where the object lands, what a
 * reference for another bucket's driver does).
 *
 * MinIO is a real S3-compatible store, run the way TECH-014 runs
 * Postgres: a container, never a mock. So the driver under test is the
 * one a deployment runs and the API it is held to is the real one.
 */

import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  GetObjectCommand,
  ListMultipartUploadsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { MinioContainer, type StartedMinioContainer } from "@testcontainers/minio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeStorageAdapterContract } from "../../testing/storage-contract.js";
import { BlobExistsError, type StorageAdapter } from "./adapter.js";
import { S3_DRIVER, createS3Storage } from "./s3.js";

/**
 * Pinned, like every other image the suites run. A floating tag makes a
 * green run today and an unexplained red one tomorrow.
 */
const MINIO_IMAGE = "minio/minio:RELEASE.2025-09-07T16-13-09Z";

/**
 * Pulling and booting a container is slower than making a directory, and
 * on a cold image cache slower than the package's own `hookTimeout` in
 * `vitest.config.ts`.
 */
const START_TIMEOUT_MS = 180_000;

interface StartedStore {
  container: StartedMinioContainer;
  bucket: string;
  /** A client on the same store, for the assertions the adapter cannot make. */
  client: S3Client;
}

/** Boots MinIO and creates one empty bucket in it. */
async function startStore(): Promise<StartedStore> {
  const container = await new MinioContainer(MINIO_IMAGE).start();
  const bucket = `openlaw-test-${randomUUID()}`;
  const client = new S3Client({
    region: "us-east-1",
    endpoint: container.getConnectionUrl(),
    forcePathStyle: true,
    credentials: {
      accessKeyId: container.getUsername(),
      secretAccessKey: container.getPassword(),
    },
  });
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  return { container, bucket, client };
}

/** The driver a deployment would build over a started store. */
function adapterFor({ container, bucket }: StartedStore): StorageAdapter {
  return createS3Storage({
    bucket,
    endpoint: container.getConnectionUrl(),
    forcePathStyle: true,
    credentials: {
      accessKeyId: container.getUsername(),
      secretAccessKey: container.getPassword(),
    },
  });
}

describeStorageAdapterContract(
  S3_DRIVER,
  async () => {
    const store = await startStore();
    return {
      adapter: adapterFor(store),
      stop: async () => {
        store.client.destroy();
        await store.container.stop();
      },
    };
  },
  { startTimeoutMs: START_TIMEOUT_MS },
);

describe("S3-compatible driver", () => {
  let store: StartedStore;
  let storage: StorageAdapter;

  beforeAll(async () => {
    store = await startStore();
    storage = adapterFor(store);
  }, START_TIMEOUT_MS);

  afterAll(async () => {
    store.client.destroy();
    await store.container.stop();
  });

  /** Everything a stream yields, as one string. */
  async function readAll(stream: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString();
  }

  it("stores the blob as an object at its key, with no prefix of its own", async () => {
    const key = `nested/${randomUUID()}`;

    await storage.put(key, Readable.from(["the executed copy"]));

    // Read back around the driver: the key is the object name in the
    // bucket, so an operator looking in the bucket sees what the
    // database says is there.
    const object = await store.client.send(
      new GetObjectCommand({ Bucket: store.bucket, Key: key }),
    );
    expect(await readAll(object.Body as Readable)).toBe("the executed copy");
  });

  it("leaves no object behind when a multipart upload's source stream fails", async () => {
    // The shared contract suite already cuts off a small upload, which
    // never leaves one part. This one is over the 5 MiB minimum part
    // size before it dies, so parts have gone to the store and the
    // upload has to be abandoned rather than completed.
    const key = randomUUID();
    const failing = Readable.from(
      (async function* () {
        yield Buffer.alloc(6 * 1024 * 1024, "x");
        throw new Error("the upload was cut off");
      })(),
    );

    await expect(storage.put(key, failing)).rejects.toThrow("the upload was cut off");

    await expect(
      store.client.send(new GetObjectCommand({ Bucket: store.bucket, Key: key })),
    ).rejects.toThrow();
    // No completed object is only half of "left nothing behind": an
    // uncompleted multipart upload is invisible to GetObject whether it
    // was aborted or leaked, and a leaked one keeps its parts in the
    // store until a lifecycle rule reaps them. The store must show the
    // upload itself gone.
    const inProgress = await store.client.send(
      new ListMultipartUploadsCommand({ Bucket: store.bucket }),
    );
    expect(inProgress.Uploads ?? []).toEqual([]);
  });

  it("lets exactly one of two writers of the same key win", async () => {
    const key = randomUUID();

    const results = await Promise.allSettled([
      storage.put(key, Readable.from(["round one"])),
      storage.put(key, Readable.from(["round two"])),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(BlobExistsError);
    // The winner's bytes are what is stored, whole, never a mix.
    const object = await store.client.send(
      new GetObjectCommand({ Bucket: store.bucket, Key: key }),
    );
    expect(["round one", "round two"]).toContain(await readAll(object.Body as Readable));
  });

  it("round-trips a blob larger than one upload part", async () => {
    // Over the 5 MiB minimum part size, so the SDK takes its multipart
    // path, the one an uploaded hundred-page scan takes.
    const large = Buffer.alloc(6 * 1024 * 1024, "x");
    const ref = await storage.put(randomUUID(), Readable.from([large]));

    const read = await storage.get(ref);
    const chunks: Buffer[] = [];
    for await (const chunk of read) chunks.push(Buffer.from(chunk));

    expect(Buffer.concat(chunks).equals(large)).toBe(true);
  });
});
