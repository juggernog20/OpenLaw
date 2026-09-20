// SPDX-License-Identifier: AGPL-3.0-only

import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeAiProviderContract } from "../../testing/ai-provider-contract.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { EXTRACTION_BOUND, DEFAULT_EXTRACTION_RULES, extractionPrompt } from "./http.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
import { AiUnavailableError, type AiExtractionTarget } from "./provider.js";

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
      response.end(JSON.stringify({ error: { message: refusal, type: "invalid_request_error" } }));
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
  expect(prompt).toContain(
    '- term_type: The contract term type. Return exactly "fixed" for a fixed term, "auto_renew" for automatic renewal, or "evergreen" for an indefinite term.\n',
  );
  expect(prompt).toContain(
    "- effective_date: The date the contract starts. Return a date as YYYY-MM-DD.\n",
  );
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

for (const protocol of ["anthropic", "openai", "gemini"] as const) {
  it.each(["analysis", "conversion"] as const)(
    `${protocol} sends custom Field formats for %s`,
    async (flow) => {
      const targets: AiExtractionTarget[] = [
        { slug: "summary", type: "long_text", prompt: "Extract the position." },
        {
          slug: "jurisdictions",
          type: "multi_select",
          options: ["England", "France"],
          prompt: "Extract jurisdictions.",
        },
      ];
      const harness = await protocolHarness(
        protocol,
        JSON.stringify({
          summary: { value: null },
          jurisdictions: { value: null },
        }),
      );
      try {
        await harness.provider.extract(
          flow === "analysis"
            ? "Source"
            : [
                {
                  id: "request:1",
                  revision: "1",
                  label: "Request",
                  kind: "request",
                  text: "Source",
                },
              ],
          targets,
          { answerStyle: "few_words" },
        );
        const body = harness.requests.at(-1)!.body;
        const prompt =
          protocol === "gemini"
            ? (body.contents as { parts: { text: string }[] }[])[0]!.parts[0]!.text
            : (body.messages as { content: string }[])[0]!.content;
        expect(prompt).toContain(
          "- summary: Extract the position. Return text up to 10000 characters. Answer in a few words that name the position, at most 80 characters.\n",
        );
        expect(prompt).toContain(
          '- jurisdictions: Extract jurisdictions. Return an array of the allowed options: ["England","France"].\n',
        );
      } finally {
        await harness.stop();
      }
    },
  );
}

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

it("keeps the four code-owned rule paragraphs in order", () => {
  const prompt = extractionPrompt("A fixed term", [{ slug: "term_type", prompt: "Extract term" }]);
  expect(DEFAULT_EXTRACTION_RULES).toHaveLength(4);
  const indexes = DEFAULT_EXTRACTION_RULES.map((rule) => prompt.indexOf(rule));
  expect(indexes.every((index) => index >= 0)).toBe(true);
  expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  expect(prompt).not.toContain("Example answers:");
  expect(prompt).toContain(
    "The citations carry the wording unless the answer style asks for the full clause.",
  );
});

it.each([
  ["few_words", "Answer in a few words that name the position, at most 80 characters."],
  [
    "sentence",
    "Answer in one or two short sentences that state the position, at most 200 characters.",
  ],
  ["full_clause", "Quote the provision verbatim."],
] as const)("adds the %s style to every text target", (answerStyle, sentence) => {
  const prompt = extractionPrompt(
    "A fixed term",
    [
      { slug: "short", type: "text", prompt: "Extract short." },
      { slug: "long", type: "long_text", prompt: "Extract long." },
      { slug: "date", type: "date", prompt: "Extract date." },
      { slug: "title", type: "text", prompt: "Propose a title.", omitAnswerStyle: true },
      {
        slug: "description",
        type: "long_text",
        prompt: "Propose a description.",
        omitAnswerStyle: true,
      },
    ],
    answerStyle,
  );
  const shortStyle =
    answerStyle === "full_clause"
      ? "Answer in one or two short sentences that state the position, at most 200 characters."
      : sentence;
  expect(prompt).toContain(`- short: Extract short. Return a short text. ${shortStyle}\n`);
  expect(prompt).toContain(
    `- long: Extract long. Return text up to 10000 characters. ${sentence}\n`,
  );
  expect(prompt).toContain("- date: Extract date. Return a date as YYYY-MM-DD.\n");
  expect(prompt).toContain(
    "- title: Propose a title. Return a short text of at most 200 characters.\n",
  );
  expect(prompt).toContain(
    "- description: Propose a description. Return text up to 10000 characters.\n",
  );
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

it("uses each Field's style before the organisation default", () => {
  const prompt = extractionPrompt(
    "The assignment provision.",
    [
      {
        slug: "clause",
        type: "long_text",
        prompt: "Extract clause.",
        aiAnswerStyle: "full_clause",
      },
      { slug: "summary", type: "long_text", prompt: "Extract summary.", aiAnswerStyle: null },
      { slug: "short", type: "text", prompt: "Extract short.", aiAnswerStyle: "few_words" },
    ],
    "sentence",
  );
  expect(prompt).toContain(
    "- clause: Extract clause. Return text up to 10000 characters. Quote the provision verbatim.\n",
  );
  expect(prompt).toContain(
    "- summary: Extract summary. Return text up to 10000 characters. Answer in one or two short sentences that state the position, at most 200 characters.\n",
  );
  expect(prompt).toContain(
    "- short: Extract short. Return a short text. Answer in a few words that name the position, at most 80 characters.\n",
  );
});
