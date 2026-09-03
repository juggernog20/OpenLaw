// SPDX-License-Identifier: AGPL-3.0-only

import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeAiProviderContract } from "../../testing/ai-provider-contract.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { EXTRACTION_BOUND } from "./http.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
import { AiUnavailableError } from "./provider.js";

const VALID_KEY = "valid-api-key"; // NOSONAR - inert local-server fixture
const INVALID_KEY = "wrong-api-key"; // NOSONAR - inert local-server fixture
const MODEL = "contract-suite-model";
const FENCED_REPLY = [
  "Here is the requested object:",
  "```json",
  '{"term_type":{"value":"fixed","evidence":"has a fixed term"},',
  '"effective_date":{"value":"2026-09-01"}}',
  "```",
].join("\n");

type Protocol = "anthropic" | "openai" | "gemini";

interface CapturedRequest {
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

/** Names the request field a stricter model refuses, in OpenAI's own words. */
type Refusal = (body: Record<string, unknown>) => string | null;

async function startServer(protocol: Protocol, refuse: Refusal = () => null) {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    requests.push({ url: request.url ?? "", headers: request.headers, body });

    const offered =
      protocol === "anthropic"
        ? request.headers["x-api-key"]
        : protocol === "gemini"
          ? request.headers["x-goog-api-key"]
          : (request.headers.authorization?.replace(/^Bearer /, "") ?? request.headers["api-key"]);
    response.setHeader("content-type", "application/json");
    if (offered !== undefined && offered !== VALID_KEY) {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: { message: "The provider rejected the API key." } }));
      return;
    }
    if (request.url?.includes("wrong")) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { message: "No model endpoint exists here." } }));
      return;
    }
    const refusal = refuse(body);
    if (refusal) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: { message: refusal, type: "invalid_request_error" } }));
      return;
    }

    const serialized = JSON.stringify(body);
    const reply = serialized.includes("Contract text:") ? FENCED_REPLY : '{"ok":true}';
    response.statusCode = 200;
    response.end(
      JSON.stringify(
        protocol === "anthropic"
          ? { content: [{ type: "text", text: reply }] }
          : protocol === "gemini"
            ? { candidates: [{ content: { parts: [{ text: reply }] } }] }
            : { choices: [{ message: { role: "assistant", content: reply } }] },
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("AI test server did not bind");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    stop: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

function sharedAssertions(protocol: Protocol, request: CapturedRequest | undefined): void {
  expect(request).toBeDefined();
  const body = request!.body;
  if (protocol === "anthropic") {
    expect(request!.headers["x-api-key"]).toBe(VALID_KEY);
    expect(request!.headers["anthropic-version"]).toBe("2023-06-01");
    expect(request!.url).toBe("/messages");
    expect(body).toMatchObject({
      model: MODEL,
      temperature: 0,
      max_tokens: EXTRACTION_BOUND.maxTokens,
    });
    expect(body.messages).toEqual([
      expect.objectContaining({ role: "user", content: expect.stringContaining("term_type") }),
    ]);
  } else if (protocol === "openai") {
    expect(request!.headers.authorization).toBe(`Bearer ${VALID_KEY}`);
    expect(request!.url).toBe("/chat/completions");
    expect(body).toMatchObject({
      model: MODEL,
      temperature: 0,
      max_completion_tokens: EXTRACTION_BOUND.maxTokens,
      response_format: { type: "json_object" },
    });
    expect(body).not.toHaveProperty("max_tokens");
  } else {
    expect(request!.headers["x-goog-api-key"]).toBe(VALID_KEY);
    expect(request!.url).toContain(`/models/${MODEL}:generateContent`);
    expect(body).toMatchObject({
      generationConfig: {
        temperature: 0,
        maxOutputTokens: EXTRACTION_BOUND.maxTokens,
        responseMimeType: "application/json",
      },
    });
  }
}

async function protocolHarness(protocol: Protocol) {
  const server = await startServer(protocol);
  const config = {
    preset: protocol === "openai" ? ("openai" as const) : protocol,
    protocol:
      protocol === "anthropic"
        ? ("anthropic_messages" as const)
        : protocol === "openai"
          ? ("openai_chat_completions" as const)
          : ("gemini" as const),
    baseUrl: server.baseUrl,
    apiKey: VALID_KEY,
    model: MODEL,
  };
  const build =
    protocol === "anthropic"
      ? createAnthropicProvider
      : protocol === "openai"
        ? createOpenAiCompatibleProvider
        : createGeminiProvider;
  return {
    provider: build(config),
    refusingProvider: build({ ...config, apiKey: INVALID_KEY }),
    assertLastExtractionRequest: () => sharedAssertions(protocol, server.requests.at(-1)),
    stop: server.stop,
  };
}

describeAiProviderContract("Anthropic Messages", () => protocolHarness("anthropic"));
describeAiProviderContract("OpenAI-compatible chat completions", () => protocolHarness("openai"));
describeAiProviderContract("Gemini", () => protocolHarness("gemini"));

describe("OpenAI-compatible preset authentication", () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    server = await startServer("openai");
  });

  afterAll(async () => {
    await server.stop();
  });

  function provider(overrides: Partial<Parameters<typeof createOpenAiCompatibleProvider>[0]> = {}) {
    return createOpenAiCompatibleProvider({
      preset: "openai",
      protocol: "openai_chat_completions",
      baseUrl: server.baseUrl,
      apiKey: VALID_KEY,
      model: MODEL,
      ...overrides,
    });
  }

  it("uses the api-key header and the full Azure deployment endpoint", async () => {
    const endpoint = `${server.baseUrl}/openai/deployments/legal/chat/completions?api-version=2026-01-01`;
    await provider({ preset: "azure_openai", baseUrl: endpoint }).probe();
    const request = server.requests.at(-1)!;
    expect(request.url).toBe("/openai/deployments/legal/chat/completions?api-version=2026-01-01");
    expect(request.headers["api-key"]).toBe(VALID_KEY);
    expect(request.headers.authorization).toBeUndefined();
  });

  it("uses bearer authorization for OpenRouter", async () => {
    await provider({ preset: "openrouter" }).probe();
    const request = server.requests.at(-1)!;
    expect(request.headers.authorization).toBe(`Bearer ${VALID_KEY}`);
    expect(request.headers["api-key"]).toBeUndefined();
  });

  it("omits authorization when Ollama has no key", async () => {
    await provider({ preset: "ollama", apiKey: null }).probe();
    expect(server.requests.at(-1)!.headers.authorization).toBeUndefined();
  });

  it("uses bearer authorization when Ollama is behind an authenticated proxy", async () => {
    await provider({ preset: "ollama" }).probe();
    expect(server.requests.at(-1)!.headers.authorization).toBe(`Bearer ${VALID_KEY}`);
  });

  it("sends max_tokens and temperature zero to a compatible server", async () => {
    await provider({ preset: "ollama", apiKey: null }).probe();
    const body = server.requests.at(-1)!.body;
    expect(body).toMatchObject({ temperature: 0, max_tokens: expect.any(Number) });
    expect(body).not.toHaveProperty("max_completion_tokens");
  });

  it("sends max_completion_tokens to OpenAI's own hosts", async () => {
    await provider().probe();
    expect(server.requests.at(-1)!.body).not.toHaveProperty("max_tokens");
    expect(server.requests.at(-1)!.body).toHaveProperty("max_completion_tokens");
    const endpoint = `${server.baseUrl}/openai/deployments/legal/chat/completions?api-version=2026-01-01`;
    await provider({ preset: "azure_openai", baseUrl: endpoint }).probe();
    expect(server.requests.at(-1)!.body).not.toHaveProperty("max_tokens");
    expect(server.requests.at(-1)!.body).toHaveProperty("max_completion_tokens");
  });

  it("keeps the provider's reason for a wrong endpoint", async () => {
    await expect(provider({ baseUrl: `${server.baseUrl}/wrong` }).probe()).rejects.toEqual(
      expect.objectContaining({
        name: "AiConfigError",
        message: "No model endpoint exists here.",
      }),
    );
  });

  it("classifies a host it cannot reach as unavailable", async () => {
    await expect(provider({ baseUrl: "http://127.0.0.1:1" }).probe()).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
  });
});

describe("OpenAI reasoning-model request fields", () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    server = await startServer("openai", (body) => {
      if ("max_tokens" in body) {
        return "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";
      }
      if ("temperature" in body) {
        return "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.";
      }
      return null;
    });
  });

  afterAll(async () => {
    await server.stop();
  });

  it("relearns the wire shape from the refusal and keeps it for the next call", async () => {
    const provider = createOpenAiCompatibleProvider({
      preset: "custom",
      protocol: "openai_chat_completions",
      baseUrl: server.baseUrl,
      apiKey: VALID_KEY,
      model: MODEL,
    });
    await provider.probe();
    expect(server.requests.map((request) => Object.keys(request.body).sort())).toEqual([
      ["max_tokens", "messages", "model", "response_format", "temperature"],
      ["max_completion_tokens", "messages", "model", "response_format", "temperature"],
      ["max_completion_tokens", "messages", "model", "response_format"],
    ]);

    await provider.probe();
    expect(server.requests).toHaveLength(4);
    expect(server.requests.at(-1)!.body).not.toHaveProperty("temperature");
  });

  it("still surfaces a refusal it cannot learn from", async () => {
    const strict = await startServer(
      "openai",
      () => "Unsupported value: 'response_format' is not supported with this model.",
    );
    try {
      const provider = createOpenAiCompatibleProvider({
        preset: "openai",
        protocol: "openai_chat_completions",
        baseUrl: strict.baseUrl,
        apiKey: VALID_KEY,
        model: MODEL,
      });
      await expect(provider.probe()).rejects.toMatchObject({
        name: "AiConfigError",
        message: expect.stringContaining("response_format"),
      });
      expect(strict.requests).toHaveLength(1);
    } finally {
      await strict.stop();
    }
  });
});
