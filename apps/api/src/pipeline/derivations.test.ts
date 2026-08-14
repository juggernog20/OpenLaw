// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one decision every derivation job makes about a failure, stated on
 * its own.
 *
 * Text extraction and display conversion both branch on it, and both
 * branch the same way: mark the derivation failed, or hand the job back
 * to the queue. It is a rule with a boundary, and a boundary is cheaper
 * to pin with an error than with an upload. What the jobs actually do
 * end to end is asserted at the HTTP seam, in the documents module's
 * suites.
 */

import { describe, expect, it } from "vitest";
import {
  DocEngineTimeoutError,
  DocEngineUnavailableError,
  SourceUnreadableError,
  unsupportedFormat,
} from "../lib/doc-engine/engine.js";
import { BlobNotFoundError, InvalidBlobRefError } from "../lib/storage/adapter.js";
import { isTerminalFailure } from "./derivations.js";

describe("is this failure the file's fault or the moment's?", () => {
  it("gives up on a format no engine converts", () => {
    expect(isTerminalFailure(unsupportedFormat("xlsx"))).toBe(true);
  });

  it("gives up on bytes that are not the document they claim to be", () => {
    expect(isTerminalFailure(new SourceUnreadableError("The source is not a PDF."))).toBe(true);
  });

  it("gives up when the stored blob is not there", () => {
    // No retry puts bytes back.
    expect(isTerminalFailure(new BlobNotFoundError("local:documents/a/b"))).toBe(true);
    expect(isTerminalFailure(new InvalidBlobRefError("not a reference"))).toBe(true);
  });

  it("tries again after a timeout", () => {
    expect(isTerminalFailure(new DocEngineTimeoutError("OCR ran past its bound."))).toBe(false);
  });

  it("tries again when the engine could not be reached", () => {
    // A sidecar restarting during a deploy is exactly what a retry
    // heals.
    expect(isTerminalFailure(new DocEngineUnavailableError("connect ECONNREFUSED"))).toBe(false);
  });

  it("tries again after anything nobody has classified", () => {
    // Retrying something permanent wastes a couple of attempts and then
    // records the failure anyway; giving up on something temporary loses
    // a document's text — or its preview — until somebody notices.
    expect(isTerminalFailure(new Error("the pool is exhausted"))).toBe(false);
    expect(isTerminalFailure("something threw a string")).toBe(false);
  });
});
