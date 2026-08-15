// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Azure Blob driver (DOC-013) — the third driver, for a deployment
 * that lives in the Microsoft world and wants its files in storage
 * Microsoft runs. The `s3` driver already reaches every S3-compatible
 * store through a custom endpoint; Azure Blob is the one major store
 * that is not S3-compatible, and this driver closes that gap.
 *
 * The driver name is `azure-blob`, so every reference it writes reads
 * `azure-blob:<key>`. The container is deliberately not part of the
 * reference: a reference names the driver and the key, and where that
 * driver points is configuration, exactly as the S3 driver's bucket is
 * (DOC-012). Fabric / OneLake exposes this same Blob API, so this
 * driver reaches OneLake with nothing added.
 *
 * Nothing Azure-shaped leaks upwards. The container, the credential,
 * and the block machinery below all stop at this file.
 */

import { Readable } from "node:stream";
import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  type ContainerClient,
} from "@azure/storage-blob";
import {
  BlobExistsError,
  BlobNotFoundError,
  StorageError,
  assertValidBlobKey,
  formatBlobRef,
  parseBlobRef,
  type StorageAdapter,
} from "./adapter.js";

/** The driver name this module registers under, and its reference prefix. */
export const AZURE_BLOB_DRIVER = "azure-blob";

export interface AzureBlobStorageOptions {
  /** The container every blob is stored in. */
  container: string;
  /**
   * The blob service URL — `https://<account>.blob.core.windows.net`
   * on Azure itself, or wherever else the same API answers (Azurite,
   * OneLake). Configuration resolves it from the account name when the
   * operator does not spell it out.
   */
  endpoint: string;
  /**
   * A shared-key credential. Unset, `DefaultAzureCredential` applies —
   * a managed identity or a workload identity, which is how a
   * deployment on Azure avoids holding a long-lived key at all.
   */
  credentials?: { account: string; key: string };
}

/** The HTTP status an Azure rejection carries, when it carries one. */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return undefined;
  const status = (error as { statusCode: unknown }).statusCode;
  return typeof status === "number" ? status : undefined;
}

/**
 * The service's own name for what went wrong, when it gave one.
 *
 * The storage SDK surfaces `x-ms-error-code` as `details.errorCode` on
 * the `RestError` it throws; some paths set `code` as well. The
 * service's name is read first: `code` also carries transport-level
 * names (`ENOTFOUND`, `REQUEST_SEND_ERROR`) and must not shadow what
 * the store itself said.
 */
function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code, details } = error as { code?: unknown; details?: unknown };
  if (typeof details === "object" && details !== null && "errorCode" in details) {
    const errorCode = (details as { errorCode: unknown }).errorCode;
    if (typeof errorCode === "string") return errorCode;
  }
  return typeof code === "string" ? code : undefined;
}

/**
 * Whether the store answered "no such blob".
 *
 * Only `BlobNotFound` counts. A bare 404 is not enough: a missing
 * *container* is also a 404, and that is an operator's configuration
 * fault, not a key that was never written — mapping it to not-found
 * would hide the fault behind an answer that looks routine.
 */
function isBlobNotFound(error: unknown): boolean {
  return errorCodeOf(error) === "BlobNotFound";
}

/**
 * Whether the store refused the write because the key was already
 * taken. `If-None-Match: *` failing is a 409 the service names
 * `BlobAlreadyExists`; a 412 is the same condition refused under the
 * generic name, and some proxies answer with that instead.
 */
function isAlreadyExists(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code === "BlobAlreadyExists" || code === "ConditionNotMet" || statusOf(error) === 412;
}

/**
 * Builds the Azure Blob driver over one container.
 *
 * The container is not created here, and its existence is not checked.
 * Startup only reads configuration — the same rule the other two
 * drivers follow — and provisioning a container is the operator's job,
 * as bucket creation is (DOC-012): an application that can create
 * containers is an application whose credentials can.
 */
export function createAzureBlobStorage(options: AzureBlobStorageOptions): StorageAdapter {
  const credential = options.credentials
    ? new StorageSharedKeyCredential(options.credentials.account, options.credentials.key)
    : new DefaultAzureCredential();
  const container: ContainerClient = new BlobServiceClient(
    options.endpoint,
    credential,
  ).getContainerClient(options.container);

  /** Whether a blob is already stored at `key`. */
  async function exists(key: string): Promise<boolean> {
    return container.getBlockBlobClient(key).exists();
  }

  return {
    driver: AZURE_BLOB_DRIVER,

    async put(key, body) {
      assertValidBlobKey(key);
      const ref = formatBlobRef(AZURE_BLOB_DRIVER, key);

      // Asked first, so a key that is already written is refused by
      // name rather than by whatever the store calls a failed
      // condition. It also answers for a store that quietly ignores
      // the condition below, which is why both locks are here and not
      // one — the same two locks the S3 driver holds.
      if (await exists(key)) throw new BlobExistsError(ref);

      // `If-None-Match: *` is the store-side half: write only if
      // nothing is there. It closes the window between the question
      // above and the write, so two writers of one key cannot both
      // believe they won and overwrite an immutable blob.
      //
      // The upload is a stream of unknown length — the request body is
      // still arriving — so it goes through the SDK's streaming
      // uploader, which stages it as blocks and commits them in one
      // final step. The condition rides on that commit, so the blob
      // appears atomically or not at all; a stream that dies part way
      // leaves only uncommitted blocks, which no read can see and the
      // service reaps on its own within a week. Block machinery stops
      // here: the interface above knows nothing about it.
      try {
        await container
          .getBlockBlobClient(key)
          .uploadStream(body, undefined, undefined, { conditions: { ifNoneMatch: "*" } });
      } catch (error) {
        if (isAlreadyExists(error)) throw new BlobExistsError(ref);
        throw error;
      }

      return ref;
    },

    async get(ref): Promise<Readable> {
      const key = parseBlobRef(ref, AZURE_BLOB_DRIVER);
      let response;
      try {
        response = await container.getBlobClient(key).download();
      } catch (error) {
        if (isBlobNotFound(error)) throw new BlobNotFoundError(ref);
        throw error;
      }
      // On Node the SDK hands back the response stream itself.
      // Anything else means the client was built for another runtime,
      // which is a wiring fault and not a caller's problem to handle.
      if (!(response.readableStreamBody instanceof Readable)) {
        throw new StorageError(`The store answered ${ref} with something that is not a stream.`);
      }
      return response.readableStreamBody;
    },

    async delete(ref) {
      const key = parseBlobRef(ref, AZURE_BLOB_DRIVER);
      // `deleteIfExists` makes a missing blob a no-op, which is the
      // contract: hard deletion (DOC-010) must be repeatable after a
      // partial failure. Snapshots go with the blob — OpenLaw never
      // takes one, but a backup tool may have, and a delete the store
      // refuses over a snapshot is a hard delete that cannot converge.
      // What this cannot reach: account-level versioning or soft
      // delete, which retain copies after a successful delete — an
      // operator owing DOC-010 an erasure must know that (DEPLOYMENT).
      await container.getBlobClient(key).deleteIfExists({ deleteSnapshots: "include" });
    },
  };
}
