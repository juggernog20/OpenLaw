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

  /** A body that sends one chunk and then breaks on the next read. */
  function brokenBody(): ReadableStream<Uint8Array> {
    let pulls = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new TextEncoder().encode('{"error":{"message":"partial'));
          return;
        }
        controller.error(new TypeError("terminated"));
      },
    });
  }

  it("keeps a 401 a configuration fault when its body breaks mid-read", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(brokenBody(), { status: 401, statusText: "Unauthorized" })),
    );
    await expect(
      postJson(new URL("https://provider.test"), {}, {}, PROBE_BOUND.timeoutMs),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AiConfigError>>({
        name: "AiConfigError",
        message: "The provider refused the request with HTTP 401.",
        upstream: { status: 401, summary: "Unauthorized" },
      }),
    );
  });

  it("keeps a 503 unavailable when its body breaks mid-read", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(brokenBody(), { status: 503, statusText: "Service Unavailable" }),
        ),
    );
    await expect(
      postJson(new URL("https://provider.test"), {}, {}, PROBE_BOUND.timeoutMs),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AiUnavailableError>>({
        name: "AiUnavailableError",
        message: "The provider refused the request with HTTP 503.",
        upstream: { status: 503, summary: "Service Unavailable" },
      }),
    );
  });

  it("names the refused field from the whole body, past the summary cut", async () => {
    const preamble = "The request could not be completed as sent. ".repeat(5);
    expect(preamble.length).toBeGreaterThan(200);
    const reason = `${preamble}Unsupported parameter: 'max_tokens' is not supported with this model.`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: { message: reason } }, { status: 400 })),
    );
    await expect(
      postJson(new URL("https://provider.test"), {}, {}, PROBE_BOUND.timeoutMs),
    ).rejects.toMatchObject({
      name: "AiConfigError",
      upstream: {
        status: 400,
        summary: reason.slice(0, 200),
        unsupportedField: "max_tokens",
      },
    });
  });

  it("leaves the refused field unset when it is not one an adapter can drop", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: "Unsupported value: 'response_format' is not supported." } },
            { status: 400 },
          ),
        ),
    );
    await expect(
      postJson(new URL("https://provider.test"), {}, {}, PROBE_BOUND.timeoutMs),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AiConfigError>>({
        upstream: {
          status: 400,
          summary: "Unsupported value: 'response_format' is not supported.",
        },
      }),
    );
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
