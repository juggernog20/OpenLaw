// SPDX-License-Identifier: AGPL-3.0-only

import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { postJson, PROBE_BOUND } from "./http.js";
import { AiConfigError, AiTimeoutError, AiUnavailableError } from "./provider.js";

afterEach(() => vi.unstubAllGlobals());

const KEY = "test-provider-key-0123456789";

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

    await expect(
      postJson(new URL("https://provider.test"), {}, {}, PROBE_BOUND.timeoutMs),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AiConfigError>>({
        name: "AiConfigError",
        message: "The provider refused the request with HTTP 400.",
        upstream: { status: 400, summary: "Bad request" },
      }),
    );
    expect(cancelled).toBe(true);
  });

  it("keeps the provider's refusal body out of the message and redacts the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: `Invalid key ${KEY} for this endpoint` } },
            { status: 401 },
          ),
        ),
    );
    const refused = postJson(
      new URL("https://provider.test"),
      { authorization: `Bearer ${KEY}` },
      {},
      PROBE_BOUND.timeoutMs,
    );
    await expect(refused).rejects.toBeInstanceOf(AiConfigError);
    await expect(refused).rejects.toMatchObject({
      message: "The provider refused the request with HTTP 401.",
      upstream: { status: 401, summary: "Invalid key [redacted] for this endpoint" },
    });
  });

  it("reads a 5xx refusal as unavailable with the same shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>overloaded</html>", { status: 503 })),
    );
    await expect(
      postJson(new URL("https://provider.test"), {}, {}, PROBE_BOUND.timeoutMs),
    ).rejects.toMatchObject({
      name: "AiUnavailableError",
      message: "The provider refused the request with HTTP 503.",
      upstream: { status: 503, summary: "<html>overloaded</html>" },
    });
  });

  it("does not follow a redirect with the API key", async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url ?? "");
      response.writeHead(307, { location: "/credential-sink" });
      response.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server port");
      await expect(
        postJson(
          new URL(`http://127.0.0.1:${String(address.port)}/v1/chat/completions`),
          { authorization: `Bearer ${KEY}` },
          {},
          PROBE_BOUND.timeoutMs,
        ),
      ).rejects.toBeInstanceOf(AiUnavailableError);
      expect(paths).toEqual(["/v1/chat/completions"]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
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

    await expect(
      postJson(new URL("https://provider.test"), {}, {}, PROBE_BOUND.timeoutMs),
    ).rejects.toBeInstanceOf(AiTimeoutError);
  });
});
