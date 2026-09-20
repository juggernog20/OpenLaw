// SPDX-License-Identifier: AGPL-3.0-only

import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeAiProviderContract } from "../../testing/ai-provider-contract.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { EXTRACTION_BOUND, DEFAULT_EXTRACTION_RULES, extractionPrompt } from "./http.js";
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

type Refusal = (
  body: Record<string, unknown>,
) => string | { message: string; code: string; failed_generation?: string } | null;

async function startServer(
  protocol: Protocol,
  refuse: Refusal = () => null,
  extractionReply = FENCED_REPLY,
) {
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
      response.end(
        JSON.stringify({
          error: {
            ...(typeof refusal === "string" ? { message: refusal } : refusal),
            type: "invalid_request_error",
          },
        }),
      );
      return;
    }

    const serialized = JSON.stringify(body);
    const reply =
      serialized.includes("Sources:") || serialized.includes("Contract text:")
        ? extractionReply
        : '{"ok":true}';
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
  const messages = body.messages as { role: string; content: string }[] | undefined;
  const contents = body.contents as { role: string; parts: { text: string }[] }[] | undefined;
  const prompt = protocol === "gemini" ? contents?.[0]?.parts[0]?.text : messages?.[0]?.content;
  expect(prompt).toContain("Use null when a value is missing, ambiguous, or unsupported");
  expect(prompt).toContain("Boolean false requires explicit support");
  expect(protocol === "gemini" ? contents : messages).toHaveLength(1);
  expect(protocol === "gemini" ? contents?.[0]?.role : messages?.[0]?.role).toBe("user");
  expect(body).not.toHaveProperty("system");
  expect(body).not.toHaveProperty("systemInstruction");
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
      response_format: { type: "json_schema", json_schema: { strict: true } },
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

async function protocolHarness(protocol: Protocol, extractionReply = FENCED_REPLY) {
  const server = await startServer(protocol, () => null, extractionReply);
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
    requests: server.requests,
    provider: build(config),
    refusingProvider: build({ ...config, apiKey: INVALID_KEY }),
    assertLastExtractionRequest: () => sharedAssertions(protocol, server.requests.at(-1)),
    stop: server.stop,
  };
}

describeAiProviderContract("Anthropic Messages", () => protocolHarness("anthropic"));
describeAiProviderContract("OpenAI-compatible chat completions", () => protocolHarness("openai"));
describeAiProviderContract("Gemini", () => protocolHarness("gemini"));

describe("Groq extraction recovery", () => {
  const targets = [
    { slug: "term_type", prompt: "Find the term type." },
    { slug: "effective_date", prompt: "Find the effective date." },
  ];
  const text = "This contract has a fixed term.";
  const expected = [
    { slug: "term_type", value: "fixed", evidence: "has a fixed term" },
    { slug: "effective_date", value: "2026-09-01" },
  ];
  const schemaFailure =
    "Generated JSON does not match the expected schema. Please adjust your prompt.";
  const validationFailures = [
    schemaFailure,
    {
      message: "Generation failed.",
      code: "json_validate_failed",
      failed_generation: "Private Contract output",
    },
  ];

  function provider(baseUrl: string) {
    return createOpenAiCompatibleProvider({
      preset: "groq",
      protocol: "openai_chat_completions",
      baseUrl,
      apiKey: VALID_KEY,
      model: "llama-3.3-70b-versatile",
    });
  }

  it("repeats a refused schema in JSON object mode and keeps it for later extractions", async () => {
    const server = await startServer("openai", (body) =>
      (body.response_format as { type: string }).type === "json_schema"
        ? "response_format json_schema is only available on supported models"
        : null,
    );
    try {
      const groq = provider(server.baseUrl);
      await expect(groq.extract(text, targets)).resolves.toEqual(expected);
      await expect(groq.extract(text, targets)).resolves.toEqual(expected);
      expect(server.requests.map(({ body }) => body.response_format)).toEqual([
        expect.objectContaining({ type: "json_schema" }),
        { type: "json_object" },
        { type: "json_object" },
      ]);
      expect(server.requests[1]!.body.messages).toEqual(server.requests[0]!.body.messages);
    } finally {
      await server.stop();
    }
  });

  it.each(validationFailures)(
    "corrects a schema validation failure without downgrading: %j",
    async (failure) => {
      const server = await startServer("openai", (body) =>
        JSON.stringify(body.messages).includes("Your previous response could not be used")
          ? null
          : failure,
      );
      try {
        await expect(provider(server.baseUrl).extract(text, targets)).resolves.toEqual(expected);
        expect(server.requests).toHaveLength(2);
        const [first, corrected] = server.requests.map(({ body }) => body);
        expect(corrected!.response_format).toEqual(first!.response_format);
        const firstPrompt = (first!.messages as { content: string }[])[0]!.content;
        const correctedPrompt = (corrected!.messages as { content: string }[])[0]!.content;
        expect(correctedPrompt).toContain(
          `${firstPrompt}\nYour previous response could not be used (invalid_shape).`,
        );
        expect(correctedPrompt).not.toContain(schemaFailure);
        expect(correctedPrompt).not.toContain("Private Contract output");
      } finally {
        await server.stop();
      }
    },
  );

  it.each(validationFailures)(
    "ends repeated schema validation failures as response failures: %j",
    async (failure) => {
      const server = await startServer("openai", () => failure);
      try {
        await expect(provider(server.baseUrl).extract(text, targets)).rejects.toMatchObject({
          name: "AiResponseError",
          reason: "invalid_shape",
          upstream: {
            status: 400,
            jsonValidationFailed: true,
            summary: typeof failure === "string" ? failure : failure.message,
          },
        });
        expect(server.requests).toHaveLength(2);
      } finally {
        await server.stop();
      }
    },
  );

  it("keeps an invalid model id a configuration refusal without retrying", async () => {
    const server = await startServer("openai", () => "Invalid model id.");
    try {
      await expect(provider(server.baseUrl).extract(text, targets)).rejects.toMatchObject({
        name: "AiConfigError",
        upstream: { status: 400 },
      });
      expect(server.requests).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });
});

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

  it("uses bearer auth and max_completion_tokens from the first Groq probe and extraction", async () => {
    const start = server.requests.length;
    const groq = provider({ preset: "groq", model: "openai/gpt-oss-120b" });
    await groq.probe();
    await groq.extract("This contract has a fixed term.", [
      { slug: "term_type", prompt: "Find the term type." },
      { slug: "effective_date", prompt: "Find the effective date." },
    ]);
    const requests = server.requests.slice(start);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url).toBe("/chat/completions");
      expect(request.headers.authorization).toBe(`Bearer ${VALID_KEY}`);
      expect(request.headers["api-key"]).toBeUndefined();
      expect(request.body).toMatchObject({
        model: "openai/gpt-oss-120b",
        temperature: 0,
        max_completion_tokens: expect.any(Number),
      });
      expect(request.body).not.toHaveProperty("max_tokens");
    }
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

  it("keeps the provider's reason for a wrong endpoint in the log summary, not the message", async () => {
    await expect(provider({ baseUrl: `${server.baseUrl}/wrong` }).probe()).rejects.toEqual(
      expect.objectContaining({
        name: "AiConfigError",
        message: "The provider refused the request with HTTP 404.",
        upstream: { status: 404, summary: "No model endpoint exists here." },
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

  it("relearns from a refusal that names the field after the summary cut", async () => {
    const preamble = "The request could not be completed as sent. ".repeat(5);
    expect(preamble.length).toBeGreaterThan(200);
    const wordy = await startServer("openai", (body) =>
      "max_tokens" in body
        ? `${preamble}Unsupported parameter: 'max_tokens' is not supported with this model.`
        : null,
    );
    try {
      const provider = createOpenAiCompatibleProvider({
        preset: "custom",
        protocol: "openai_chat_completions",
        baseUrl: wordy.baseUrl,
        apiKey: VALID_KEY,
        model: MODEL,
      });
      await provider.probe();
      expect(wordy.requests.map((request) => Object.keys(request.body).sort())).toEqual([
        ["max_tokens", "messages", "model", "response_format", "temperature"],
        ["max_completion_tokens", "messages", "model", "response_format", "temperature"],
      ]);
    } finally {
      await wordy.stop();
    }
  });

  it("stops after the provider also refuses the prompt-only fallback", async () => {
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
        message: "The provider refused the request with HTTP 400.",
        upstream: { status: 400, summary: expect.stringContaining("response_format") },
      });
      expect(strict.requests).toHaveLength(2);
    } finally {
      await strict.stop();
    }
  });
});

for (const protocol of ["anthropic", "openai", "gemini"] as const) {
  it(`${protocol} preserves source boundaries and named citations`, async () => {
    const harness = await protocolHarness(
      protocol,
      JSON.stringify({
        term_type: {
          value: "fixed",
          sourceId: "source-b",
          evidence: "fixed term",
          justification: "The later message explicitly specifies a fixed term.",
          citations: [{ sourceId: "source-b", quote: "fixed term" }],
        },
      }),
    );
    try {
      const result = await harness.provider.extract(
        [
          {
            id: "source-a",
            revision: "rev-a",
            label: "Request answer",
            kind: "request",
            text: "The agreement is required.",
          },
          {
            id: "source-b",
            revision: "rev-b",
            label: "Conversation correction",
            kind: "message",
            author: "Counsel",
            createdAt: "2026-09-11T00:00:00Z",
            text: "Correction: use a fixed term.",
          },
        ],
        [{ slug: "term_type", prompt: "Extract the term type." }],
      );
      expect(result).toEqual([
        {
          slug: "term_type",
          value: "fixed",
          sourceId: "source-b",
          evidence: "fixed term",
          justification: "The later message explicitly specifies a fixed term.",
          citations: [{ sourceId: "source-b", quote: "fixed term" }],
        },
      ]);
      const request = JSON.stringify(harness.requests.at(-1)?.body);
      expect(request).toContain("source-a");
      expect(request).toContain("source-b");
      expect(request).toContain("rev-b");
      expect(request).toContain("Counsel");
      expect(request).toContain("Use null when a value is missing, ambiguous, or unsupported");
      expect(request).toContain("Boolean false requires explicit support");
    } finally {
      await harness.stop();
    }
  });
}

it("carries the supplied rule paragraphs in place of the built-in ones, and keeps the format lines", () => {
  const targets = [{ slug: "term_type", prompt: "Extract term" }];
  const prompt = extractionPrompt("A fixed term", targets, ["Answer in one sentence."]);
  expect(prompt).toContain("Answer in one sentence.");
  expect(prompt).not.toContain("Use null when a value is missing");
  expect(prompt).toContain("Return one JSON object keyed by the exact slug.");
  expect(prompt).toContain("- term_type: Extract term");
  // No rules read means the built-in text, in the built-in order.
  const fallback = extractionPrompt("A fixed term", targets);
  const indexes = DEFAULT_EXTRACTION_RULES.map((rule) => fallback.indexOf(rule));
  expect(indexes.every((index) => index >= 0)).toBe(true);
  expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
});

it("does not request source IDs from legacy unaddressed text", () => {
  const prompt = extractionPrompt("A fixed term", [{ slug: "term_type", prompt: "Extract term" }]);
  expect(prompt).toContain("Contract text:");
  expect(prompt).not.toContain("sourceId");
});

it("names the exact evidence properties for source-addressed extraction", () => {
  const prompt = extractionPrompt(
    [
      {
        id: "request:one",
        revision: "v1",
        kind: "request",
        label: "Summary",
        text: "Due October 2",
      },
    ],
    [{ slug: "needed_by", prompt: "Extract date" }],
  );
  expect(prompt).toContain('"evidence":');
  expect(prompt).toContain('"sourceId":');
  expect(prompt).toContain('"citations":');
});

for (const protocol of ["anthropic", "openai", "gemini"] as const) {
  it(`${protocol} preserves a conflict without a proposed value`, async () => {
    const citations = [{ sourceId: "request:one", quote: "fixed or evergreen" }];
    const harness = await protocolHarness(
      protocol,
      JSON.stringify({ term_type: { conflict: true, citations } }),
    );
    try {
      expect(
        await harness.provider.extract("fixed or evergreen", [
          { slug: "term_type", prompt: "Extract term" },
        ]),
      ).toEqual([{ slug: "term_type", value: null, conflict: true, citations }]);
    } finally {
      await harness.stop();
    }
  });
  for (const citations of ["not a list", [{ sourceId: "request:one" }]]) {
    it(`${protocol} refuses malformed citations ${JSON.stringify(citations)}`, async () => {
      const harness = await protocolHarness(
        protocol,
        JSON.stringify({ term_type: { conflict: true, citations } }),
      );
      try {
        await expect(
          harness.provider.extract("fixed", [{ slug: "term_type", prompt: "Extract term" }]),
        ).rejects.toMatchObject({ name: "AiResponseError" });
      } finally {
        await harness.stop();
      }
    });
  }
}
