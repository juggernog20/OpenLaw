// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The S3-compatible driver (DOC-009, TECH-014) — the alternative to the
 * local filesystem driver, for a deployment whose files must live where
 * its infrastructure already is: AWS S3, MinIO, or any store that speaks
 * the same API.
 *
 * The driver name is `s3`, so every reference it writes reads
 * `s3:<key>`. The bucket is deliberately not part of the reference: a
 * reference names the driver and the key, and where that driver points
 * is configuration, exactly as the local driver's root is.
 *
 * Nothing S3-shaped leaks upwards. The bucket, the endpoint, and the
 * multipart machinery below all stop at this file, so the interface
 * stays one a future Microsoft Graph driver can also honour.
 */

import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
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
export const S3_DRIVER = "s3";

/**
 * The region sent when none is configured. Every request must carry one
 * to be signed, and a MinIO-class store ignores what it is told, so an
 * operator running one has no region to look up.
 */
export const DEFAULT_S3_REGION = "us-east-1";

export interface S3StorageOptions {
  /** The bucket every blob is stored in. */
  bucket: string;
  /** The signing region. Defaults to {@link DEFAULT_S3_REGION}. */
  region?: string;
  /** The service endpoint. Unset means AWS S3 for the region. */
  endpoint?: string;
  /**
   * Whether to address the bucket as a path (`host/bucket/key`) instead
   * of as a subdomain (`bucket.host/key`). MinIO-class stores need this.
   */
  forcePathStyle?: boolean;
  /**
   * Static credentials. Unset, the AWS SDK's own chain applies — an
   * instance profile or an IRSA role, which is how a deployment on AWS
   * avoids holding a long-lived key at all.
   */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

/** The HTTP status an S3 rejection carries, when it carries one. */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) return undefined;
  const metadata = (error as { $metadata: unknown }).$metadata;
  if (typeof metadata !== "object" || metadata === null || !("httpStatusCode" in metadata)) {
    return undefined;
  }
  const status = (metadata as { httpStatusCode: unknown }).httpStatusCode;
  return typeof status === "number" ? status : undefined;
}

/**
 * Whether the store answered "no such object".
 *
 * `GetObject` names it `NoSuchKey` and `HeadObject` answers a bare 404
 * with no body to name anything, so both the name and the status are
 * read. Stores differ in which they send.
 */
function isNotFound(error: unknown): boolean {
  return (
    (error instanceof Error && (error.name === "NoSuchKey" || error.name === "NotFound")) ||
    statusOf(error) === 404
  );
}

/** Whether the store refused the write because the key was already taken. */
function isPreconditionFailed(error: unknown): boolean {
  return (error instanceof Error && error.name === "PreconditionFailed") || statusOf(error) === 412;
}

/**
 * Builds the S3-compatible driver over one bucket.
 *
 * The bucket is not created here, and its existence is not checked.
 * Startup only reads configuration — the same rule the local driver
 * follows — and provisioning a bucket is the operator's job, not the
 * application's.
 */
export function createS3Storage(options: S3StorageOptions): StorageAdapter {
  const { bucket } = options;
  const client = new S3Client({
    region: options.region || DEFAULT_S3_REGION,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    forcePathStyle: options.forcePathStyle ?? false,
    ...(options.credentials ? { credentials: options.credentials } : {}),
  });

  /** Whether a blob is already stored at `key`. */
  async function exists(key: string): Promise<boolean> {
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  return {
    driver: S3_DRIVER,

    async put(key, body) {
      assertValidBlobKey(key);
      const ref = formatBlobRef(S3_DRIVER, key);

      // Asked first, so a key that is already written is refused by name
      // rather than by whatever the store calls a failed condition. It
      // also answers for a store that quietly ignores the condition
      // below, which is why both locks are here and not one.
      if (await exists(key)) throw new BlobExistsError(ref);

      // `If-None-Match: *` is the store-side half: write only if nothing
      // is there. It closes the window between the question above and
      // the write, so two writers of one key cannot both believe they
      // won and overwrite an immutable blob.
      //
      // The upload is a stream of unknown length — the request body is
      // still arriving — so it goes through the SDK's uploader, which
      // splits it into parts once it outgrows one. Part numbers stop
      // here: the interface above knows nothing about them.
      try {
        await new Upload({
          client,
          params: { Bucket: bucket, Key: key, Body: body, IfNoneMatch: "*" },
        }).done();
      } catch (error) {
        if (isPreconditionFailed(error)) throw new BlobExistsError(ref);
        throw error;
      }

      return ref;
    },

    async get(ref): Promise<Readable> {
      const key = parseBlobRef(ref, S3_DRIVER);
      let response;
      try {
        response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        if (isNotFound(error)) throw new BlobNotFoundError(ref);
        throw error;
      }
      // On Node the SDK hands back the response stream itself. Anything
      // else means the client was built for another runtime, which is a
      // wiring fault and not a caller's problem to handle.
      if (!(response.Body instanceof Readable)) {
        throw new StorageError(`The store answered ${ref} with something that is not a stream.`);
      }
      return response.Body;
    },

    async delete(ref) {
      const key = parseBlobRef(ref, S3_DRIVER);
      // S3 deletion is already the contract's deletion: removing a key
      // that was never written succeeds, so hard deletion (DOC-010) is
      // repeatable after a partial failure with nothing added here.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
