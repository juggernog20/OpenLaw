// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Azure Blob driver against an Azurite container: the same shared
 * contract suite the other two drivers pass, plus the few facts that
 * are only true of this driver (where the blob lands, that the losing
 * writer of a race is told already-exists).
 *
 * Azurite is Microsoft's own Blob emulator, run the way the S3 driver
 * runs MinIO — a container, never a mock — so the driver under test is
 * the one a deployment runs and the API it is held to is the real one.
 */

import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import { AzuriteContainer, type StartedAzuriteContainer } from "@testcontainers/azurite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeStorageAdapterContract } from "../../testing/storage-contract.js";
import { BlobExistsError, type StorageAdapter } from "./adapter.js";
import { AZURE_BLOB_DRIVER, createAzureBlobStorage } from "./azure-blob.js";

/**
 * Pinned, like every other image the suites run. A floating tag makes a
 * green run today and an unexplained red one tomorrow.
 */
const AZURITE_IMAGE = "mcr.microsoft.com/azure-storage/azurite:3.36.0";

/**
 * Pulling and booting a container is slower than making a directory, and
 * on a cold image cache slower than the package's own `hookTimeout` in
 * `vitest.config.ts`.
 */
const START_TIMEOUT_MS = 180_000;

interface StartedStore {
  azurite: StartedAzuriteContainer;
  container: string;
  client: BlobServiceClient;
}

async function startStore(): Promise<StartedStore> {
  // The emulator trails the SDK's service API version by a few months
  // and refuses the newer header outright; skipping its version check
  // is Microsoft's own documented answer to that lag. The operations
  // the driver uses are all years older than either version.
  const azurite = await new AzuriteContainer(AZURITE_IMAGE)
    .withInMemoryPersistence()
    .withSkipApiVersionCheck()
    .start();
  const container = `openlaw-test-${randomUUID()}`;
  const client = new BlobServiceClient(
    azurite.getBlobEndpoint(),
    new StorageSharedKeyCredential(azurite.getAccountName(), azurite.getAccountKey()),
  );
  await client.getContainerClient(container).create();
  return { azurite, container, client };
}

function adapterFor({ azurite, container }: StartedStore): StorageAdapter {
  return createAzureBlobStorage({
    container,
    endpoint: azurite.getBlobEndpoint(),
    credentials: { account: azurite.getAccountName(), key: azurite.getAccountKey() },
  });
}

describeStorageAdapterContract(
  AZURE_BLOB_DRIVER,
  async () => {
    const store = await startStore();
    return {
      adapter: adapterFor(store),
      stop: async () => {
        await store.azurite.stop();
      },
    };
  },
  { startTimeoutMs: START_TIMEOUT_MS },
);

describe("Azure Blob driver", () => {
  let store: StartedStore;
  let storage: StorageAdapter;

  beforeAll(async () => {
    store = await startStore();
    storage = adapterFor(store);
  }, START_TIMEOUT_MS);

  afterAll(async () => {
    // Guarded the way the contract suite guards its own harness: if
    // the start rejected, `store` was never assigned, and reaching
    // through it here would make a TypeError the thing the run
    // reports — burying the Azurite failure that actually happened.
    await store?.azurite.stop();
  });

  /** Everything a download yields, as one string. The body is optional
   * only for other runtimes, so a missing one is a failure here. */
  async function readAll(stream: NodeJS.ReadableStream | undefined): Promise<string> {
    if (!stream) throw new Error("The download answered no stream.");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString();
  }

  it("stores the blob as a blob at its key, with no prefix of its own", async () => {
    const key = `nested/${randomUUID()}`;

    await storage.put(key, Readable.from(["the executed copy"]));

    // Read back around the driver: the key is the blob name in the
    // container, so an operator looking in the container sees what the
    // database says is there.
    const blob = await store.client
      .getContainerClient(store.container)
      .getBlobClient(key)
      .download();
    expect(await readAll(blob.readableStreamBody)).toBe("the executed copy");
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
    // The winner's bytes are what is stored, whole — never a mix.
    const blob = await store.client
      .getContainerClient(store.container)
      .getBlobClient(key)
      .download();
    expect(["round one", "round two"]).toContain(await readAll(blob.readableStreamBody));
  });

  it("round-trips a blob larger than one staged block", async () => {
    // Over the driver's 5 MiB block size, so the upload stages more
    // than one block and the commit is what makes the blob appear —
    // the path an uploaded hundred-page scan takes.
    const large = Buffer.alloc(9 * 1024 * 1024, "x");
    const ref = await storage.put(randomUUID(), Readable.from([large]));

    const read = await storage.get(ref);
    const chunks: Buffer[] = [];
    for await (const chunk of read) chunks.push(Buffer.from(chunk));

    expect(Buffer.concat(chunks).equals(large)).toBe(true);
  });

  it("leaves no committed blob behind when a multi-block upload's source stream fails", async () => {
    // The shared contract suite already cuts off a small upload. This
    // one is over one staged block before it dies, so blocks have gone
    // to the store — and staged blocks are uncommitted, so nothing may
    // become readable at the key.
    const key = randomUUID();
    const failing = Readable.from(
      (async function* () {
        yield Buffer.alloc(9 * 1024 * 1024, "x");
        throw new Error("the upload was cut off");
      })(),
    );

    await expect(storage.put(key, failing)).rejects.toThrow("the upload was cut off");

    await expect(
      store.client.getContainerClient(store.container).getBlobClient(key).download(),
    ).rejects.toMatchObject({ statusCode: 404 });
    // Uncommitted blocks are invisible to every read and the service
    // reaps them on its own; unlike S3's multipart machinery there is
    // no upload object left to abandon, so invisibility is the whole
    // guarantee.
    const listed = [];
    for await (const blob of store.client.getContainerClient(store.container).listBlobsFlat()) {
      if (blob.name === key) listed.push(blob);
    }
    expect(listed).toEqual([]);
  });
});
