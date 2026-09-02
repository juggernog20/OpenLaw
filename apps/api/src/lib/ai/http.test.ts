// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";
import { postJson } from "./http.js";
import { AiConfigError, AiTimeoutError } from "./provider.js";

afterEach(() => vi.unstubAllGlobals());

describe("AI provider HTTP bounds", () => {
  it("cancels an oversized refusal without buffering the complete body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(400)));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 400, statusText: "Bad request" })),
    );

    await expect(postJson(new URL("https://provider.test"), {}, {})).rejects.toEqual(
      expect.objectContaining<Partial<AiConfigError>>({
        name: "AiConfigError",
        message: "Bad request",
      }),
    );
    expect(cancelled).toBe(true);
  });

  it("classifies a timeout while reading a successful response body", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new DOMException("The operation timed out", "TimeoutError"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
        ),
    );

    await expect(postJson(new URL("https://provider.test"), {}, {})).rejects.toBeInstanceOf(
      AiTimeoutError,
    );
  });
});
