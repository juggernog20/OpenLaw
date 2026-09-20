// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiProvider } from "./index.js";
import { EXTRACTION_BOUND } from "./http.js";
import {
  extractionBatches,
  extractionSchema,
  extractionTimeBudget,
  extractStructured,
} from "./structured-extraction.js";
import { AiResponseError, aiPreparationFailure } from "./provider.js";
import type { AiExtractionTarget } from "./provider.js";
import type { AiPreset, AiProtocol } from "@openlaw/db";

const SOURCES = [
  {
    id: "document:1",
    revision: "v1",
    kind: "document" as const,
    label: "Agreement",
    text: "Consent is required.",
  },
];
const TARGETS: AiExtractionTarget[] = [
  { slug: "consent", type: "boolean", prompt: "Whether consent is required." },
];
const VALID = {
  consent: { value: true, sourceId: "document:1", evidence: "Consent is required." },
};
type Wire = "openai" | "anthropic" | "gemini";
const protocols: Record<Wire, AiProtocol> = {
  openai: "openai_chat_completions",
  anthropic: "anthropic_messages",
  gemini: "gemini",
};

function envelope(wire: Wire, content: unknown = VALID, reason?: string) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  switch (wire) {
    case "openai":
      return { choices: [{ finish_reason: reason ?? "stop", message: { content: text } }] };
    case "anthropic":
      return { stop_reason: reason ?? "end_turn", content: [{ type: "text", text }] };
    case "gemini":
      return { candidates: [{ finishReason: reason ?? "STOP", content: { parts: [{ text }] } }] };
  }
}

function setup(
  wire: Wire,
  reply: (index: number, body: Record<string, unknown>) => Response,
  preset: AiPreset = wire,
  maxOutputTokens?: number,
) {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      bodies.push(body);
      return reply(bodies.length - 1, body);
    }),
  );
  return {
    bodies,
    provider: createAiProvider({
      preset,
      maxOutputTokens,
      protocol: protocols[wire],
      model: "test-model",
      baseUrl: "https://provider.test/v1",
      apiKey: "fixture",
    }),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("repairs ten text targets once and preserves the one invalid value and its evidence", async () => {
  const targets: AiExtractionTarget[] = Array.from({ length: 10 }, (_, index) => ({
    slug: `field_${index}`,
    type: "text",
    prompt: "Extract the position.",
  }));
  const entries = Object.fromEntries(
    targets.map(({ slug }, index) => [
      slug,
      {
        value: index === 4 ? "x".repeat(501) : "Consent required",
        sourceId: "document:1",
        evidence: "Consent is required.",
        citations: [{ sourceId: "document:1", quote: "Consent is required." }],
      },
    ]),
  );
  const complete = vi.fn<(prompt: string) => Promise<string>>(async () => JSON.stringify(entries));
  const answers = await extractStructured(SOURCES, targets, complete);
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete.mock.calls[1]?.[0]).toContain('"field":"field_4"');
  expect(answers).toEqual(
    targets.map(({ slug }) => ({
      slug,
      ...entries[slug],
      ...(slug === "field_4" ? { invalid: true } : {}),
    })),
  );
});

it.each([
  "null",
  "[]",
  JSON.stringify([VALID]),
  `Result: ${JSON.stringify([VALID])}`,
  `Result: ${JSON.stringify([VALID])} End of result.`,
  `\`\`\`json\n${JSON.stringify([VALID])}\n\`\`\``,
  JSON.stringify({ ...VALID, extra: { value: true } }),
  JSON.stringify({
    consent: { value: "yes", citations: [{ sourceId: "invented", quote: "Quote" }] },
  }),
  JSON.stringify({ consent: { evidence: "Consent is required." } }),
  JSON.stringify({ consent: { value: true, invalid: true } }),
])("still fails the batch after repairing a malformed reply: %s", async (reply) => {
  const complete = vi.fn(async () => reply);
  await expect(extractStructured(SOURCES, TARGETS, complete)).rejects.toBeInstanceOf(
    AiResponseError,
  );
  expect(complete).toHaveBeenCalledTimes(2);
});

it("accepts an object surrounded by prose", async () => {
  const complete = vi.fn(async () => `Result: ${JSON.stringify(VALID)} End of result.`);
  await expect(extractStructured(SOURCES, TARGETS, complete)).resolves.toEqual([
    { slug: "consent", ...VALID.consent },
  ]);
  expect(complete).toHaveBeenCalledOnce();
});

it("accepts a value corrected by the repair without an invalid marker", async () => {
  const complete = vi
    .fn()
    .mockResolvedValueOnce(JSON.stringify({ consent: { value: "yes" } }))
    .mockResolvedValueOnce(JSON.stringify(VALID));
  await expect(extractStructured(SOURCES, TARGETS, complete)).resolves.toEqual([
    { slug: "consent", ...VALID.consent },
  ]);
});

it("splits large schemas while preserving every target in order", async () => {
  const targets = Array.from({ length: 29 }, (_, index) => ({
    slug: `field_${index}`,
    type: "boolean" as const,
    prompt: "Extract consent",
  }));
  const batches = extractionBatches(targets, SOURCES);
  expect(batches.map((batch) => batch.length)).toEqual([12, 12, 5]);
  let active = 0;
  let peak = 0;
  const complete = vi.fn(async (_prompt, _bound, schema) => {
    peak = Math.max(peak, ++active);
    await Promise.resolve();
    active--;
    return JSON.stringify(
      Object.fromEntries(Object.keys(schema.properties).map((slug) => [slug, VALID.consent])),
    );
  });
  const answers = await extractStructured(SOURCES, targets, complete);
  expect(complete).toHaveBeenCalledTimes(3);
  expect(peak).toBe(2);
  expect(answers.map((answer) => answer.slug)).toEqual(targets.map((target) => target.slug));
  for (const batch of batches) {
    const json = JSON.stringify(extractionSchema(batch, SOURCES));
    expect((json.match(/"anyOf"/g) ?? []).length).toBeLessThanOrEqual(16);
  }
});

it("does not return partial answers or start more batches after a failure", async () => {
  const targets = Array.from({ length: 29 }, (_, index) => ({
    slug: `field_${index}`,
    type: "boolean" as const,
    prompt: "Extract consent",
  }));
  const complete = vi.fn(async (_prompt, _bound, schema) => {
    if ("field_0" in schema.properties)
      throw new AiResponseError("Declined", { reason: "refused" });
    return JSON.stringify(
      Object.fromEntries(Object.keys(schema.properties).map((slug) => [slug, VALID.consent])),
    );
  });
  await expect(extractStructured(SOURCES, targets, complete)).rejects.toMatchObject({
    reason: "refused",
    progress: { completedBatches: 1, totalBatches: 3 },
  });
  expect(complete).toHaveBeenCalledTimes(2);
});

it("keeps batches with mixed-type values under Claude's union limit", () => {
  const targets = Array.from({ length: 25 }, (_, index) => ({
    slug: `field_${index}`,
    prompt: "Extract",
  }));
  const batches = extractionBatches(targets, SOURCES);
  expect(batches.flat()).toEqual(targets);
  for (const batch of batches)
    expect(
      (JSON.stringify(extractionSchema(batch, SOURCES)).match(/"anyOf"/g) ?? []).length,
    ).toBeLessThanOrEqual(16);
});

it("scales the time budget with batch rounds and caps it at fifteen minutes", () => {
  const targets = Array.from({ length: 100 }, (_, index) => ({
    slug: `field_${index}`,
    type: "boolean" as const,
    prompt: "Extract",
  }));
  expect(extractionTimeBudget(targets.slice(0, 12), SOURCES)).toBe(300_000);
  expect(extractionTimeBudget(targets.slice(0, 29), SOURCES)).toBe(600_000);
  expect(extractionTimeBudget(targets, SOURCES)).toBe(900_000);
});

it("gives later batches their own window without extending an individual batch", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const targets = Array.from({ length: 29 }, (_, index) => ({
    slug: `field_${index}`,
    type: "boolean" as const,
    prompt: "Extract",
  }));
  const complete = vi.fn(async (_prompt, bound, schema) => {
    expect(bound.timeoutMs).toBeLessThanOrEqual(EXTRACTION_BOUND.timeoutMs);
    if ("field_0" in schema.properties) now = 240_000;
    return JSON.stringify(
      Object.fromEntries(Object.keys(schema.properties).map((slug) => [slug, VALID.consent])),
    );
  });
  await expect(extractStructured(SOURCES, targets, complete)).resolves.toHaveLength(29);
  expect(complete.mock.calls[2]![1].timeoutMs).toBe(EXTRACTION_BOUND.timeoutMs);
});

it("does not start another attempt once the total time budget is spent", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const complete = vi.fn(async () => {
    now += EXTRACTION_BOUND.timeoutMs + 1;
    throw new AiResponseError("Unusable");
  });
  await expect(extractStructured(SOURCES, TARGETS, complete)).rejects.toMatchObject({
    name: "AiTimeoutError",
  });
  expect(complete).toHaveBeenCalledOnce();
});

it("stores application-owned diagnostics without provider text", () => {
  const error = new AiResponseError("Sensitive provider text", { reason: "output_limit" });
  expect(aiPreparationFailure(error)).toContain("output token limit");
  expect(aiPreparationFailure(error)).not.toContain("Sensitive");
});

it("preserves field names that happen to match JSON Schema keywords", () => {
  const names = ["pattern", "minimum", "maximum", "maxLength", "type"];
  const schema = extractionSchema(
    names.map((slug) => ({ slug, prompt: "Extract", type: "text" })),
    SOURCES,
  );
  expect(Object.keys(schema.properties as object)).toEqual(names);
});

for (const wire of ["openai", "anthropic", "gemini"] as const) {
  describe(`${wire} structured extraction`, () => {
    it("shares learned format support safely between concurrent calls", async () => {
      const name =
        wire === "openai"
          ? "response_format"
          : wire === "anthropic"
            ? "output_config"
            : "responseJsonSchema";
      const { provider, bodies } = setup(wire, (_index, body) => {
        const schema =
          wire === "openai"
            ? (body.response_format as { type?: string })?.type === "json_schema"
            : wire === "anthropic"
              ? Boolean(body.output_config)
              : Boolean((body.generationConfig as Record<string, unknown>)?.responseJsonSchema);
        return schema
          ? Response.json(
              { error: { message: `Unsupported parameter: '${name}' is not supported.` } },
              { status: 400 },
            )
          : Response.json(envelope(wire));
      });
      const results = await Promise.all([
        provider.extract(SOURCES, TARGETS),
        provider.extract(SOURCES, TARGETS),
      ]);
      expect(results).toHaveLength(2);
      expect(bodies).toHaveLength(4);
      if (wire === "openai")
        expect(bodies.slice(2)).toEqual([
          expect.objectContaining({ response_format: { type: "json_object" } }),
          expect.objectContaining({ response_format: { type: "json_object" } }),
        ]);
    });
    it("sends the same typed schema through the protocol's native parameter", async () => {
      const { provider, bodies } = setup(wire, () => Response.json(envelope(wire)));
      await expect(provider.extract(SOURCES, TARGETS)).resolves.toEqual([
        { slug: "consent", ...VALID.consent },
      ]);
      const schema = extractionSchema(TARGETS, SOURCES);
      if (wire === "openai")
        expect(bodies[0]).toMatchObject({
          response_format: { type: "json_schema", json_schema: { strict: true, schema } },
        });
      if (wire === "anthropic")
        expect(bodies[0]).toMatchObject({
          output_config: { format: { type: "json_schema", schema } },
        });
      if (wire === "gemini")
        expect(bodies[0]).toMatchObject({ generationConfig: { responseJsonSchema: schema } });
    });

    for (const bad of [
      "not JSON",
      { consent: { value: "yes" } },
      {
        consent: {
          value: true,
          citations: [{ sourceId: "invented", quote: "Consent is required." }],
        },
      },
      { consent: { value: true, evidence: 42 } },
      { consent: { value: true, justification: "x".repeat(1001) } },
      { consent: { value: true }, unrequested: { value: "injected" } },
      {},
    ]) {
      it(`repairs an unusable reply once: ${JSON.stringify(bad).slice(0, 80)}`, async () => {
        const { provider, bodies } = setup(wire, (index) =>
          Response.json(envelope(wire, index === 0 ? bad : VALID)),
        );
        await expect(provider.extract(SOURCES, TARGETS)).resolves.toEqual([
          { slug: "consent", ...VALID.consent },
        ]);
        expect(bodies).toHaveLength(2);
        expect(JSON.stringify(bodies[1])).toContain("Your previous response could not be used");
        expect(JSON.stringify(bodies[1])).not.toContain("injected");
      });
    }

    it("stops after two unusable responses", async () => {
      const { provider, bodies } = setup(wire, () => Response.json(envelope(wire, "broken")));
      await expect(provider.extract(SOURCES, TARGETS)).rejects.toMatchObject({
        name: "AiResponseError",
      });
      expect(bodies).toHaveLength(2);
    });

    it("respects the saved output ceiling on both the initial call and corrective retry", async () => {
      const reason =
        wire === "openai" ? "length" : wire === "anthropic" ? "max_tokens" : "MAX_TOKENS";
      const { provider, bodies } = setup(
        wire,
        (index) => Response.json(envelope(wire, VALID, index === 0 ? reason : undefined)),
        wire,
        65536,
      );
      await provider.extract(SOURCES, TARGETS);
      expect(bodies).toHaveLength(2);
      const budget =
        wire === "gemini"
          ? (bodies[1]!.generationConfig as Record<string, unknown>).maxOutputTokens
          : bodies[1]![wire === "openai" ? "max_completion_tokens" : "max_tokens"];
      expect(budget).toBe(65536);
      const first =
        wire === "gemini"
          ? (bodies[0]!.generationConfig as Record<string, unknown>).maxOutputTokens
          : bodies[0]![wire === "openai" ? "max_completion_tokens" : "max_tokens"];
      expect(first).toBe(65536);
    });

    it("does not retry a content refusal", async () => {
      const reason =
        wire === "openai" ? "content_filter" : wire === "anthropic" ? "refusal" : "SAFETY";
      const { provider, bodies } = setup(wire, () =>
        Response.json(envelope(wire, "Declined", reason)),
      );
      await expect(provider.extract(SOURCES, TARGETS)).rejects.toMatchObject({
        name: "AiResponseError",
        reason: "refused",
      });
      expect(bodies).toHaveLength(1);
    });

    it.each([400, 401, 403, 404, 429, 500])(
      "does not downgrade or repair an unrelated HTTP %s failure",
      async (status) => {
        const { provider, bodies } = setup(wire, () =>
          Response.json({ error: { message: "Account or configuration problem" } }, { status }),
        );
        await expect(provider.extract(SOURCES, TARGETS)).rejects.toThrow();
        expect(bodies).toHaveLength(1);
      },
    );

    it("falls back only when the output-format parameter is explicitly unsupported, then remembers it", async () => {
      const name =
        wire === "openai"
          ? "response_format"
          : wire === "anthropic"
            ? "output_config"
            : "responseJsonSchema";
      const { provider, bodies } = setup(wire, (index) =>
        index === 0
          ? Response.json(
              {
                error: {
                  message: `Unsupported parameter: '${name}' is not supported with this model.`,
                },
              },
              { status: 400 },
            )
          : Response.json(envelope(wire)),
      );
      await provider.extract(SOURCES, TARGETS);
      await provider.extract(SOURCES, TARGETS);
      expect(bodies).toHaveLength(3);
      for (const body of bodies.slice(1)) {
        if (wire === "openai")
          expect(body).toMatchObject({ response_format: { type: "json_object" } });
        if (wire === "anthropic") expect(body).not.toHaveProperty("output_config");
        if (wire === "gemini")
          expect(body.generationConfig).not.toHaveProperty("responseJsonSchema");
        expect(JSON.stringify(body)).toContain("Response JSON Schema");
      }
    });
  });
}

it("constrains select values, dates, currency objects, key dates, and nullable missing values", () => {
  const schema = extractionSchema(
    [
      { slug: "kind", prompt: "Kind", type: "single_select", options: ["A", "B"] },
      { slug: "amount", prompt: "Value", type: "value" },
      { slug: "dates", prompt: "Milestones", type: "key_dates" },
      { slug: "date", prompt: "Date", type: "date" },
    ],
    SOURCES,
  );
  const json = JSON.stringify(schema);
  expect(json).toContain('"enum":["A","B"]');
  expect(json).toContain('"format":"date"');
  expect(json).toContain('"type":"null"');
  expect(json).toContain('"additionalProperties":false');
  expect(json).not.toContain('"maxLength"');
  expect(json).not.toContain('"maximum"');
});

it("requires OpenRouter to route schema requests to compatible endpoints", async () => {
  const { provider, bodies } = setup(
    "openai",
    () => Response.json(envelope("openai")),
    "openrouter",
  );
  await provider.extract(SOURCES, TARGETS);
  expect(bodies[0]).toMatchObject({ provider: { require_parameters: true } });
});

it.each(["ollama", "custom"] as const)(
  "supports %s servers without either structured output or JSON mode",
  async (preset) => {
    const { provider, bodies } = setup(
      "openai",
      (_index, body) =>
        body.response_format
          ? Response.json(
              { error: { message: "Unsupported parameter: 'response_format' is not supported." } },
              { status: 400 },
            )
          : Response.json(envelope("openai")),
      preset,
    );
    await provider.extract(SOURCES, TARGETS);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).not.toHaveProperty("response_format");
  },
);

it("skips Gemini thought parts and joins all answer parts", async () => {
  const reply = JSON.stringify(VALID);
  const { provider } = setup("gemini", () =>
    Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              null,
              { thought: true, text: "private deliberation" },
              { text: reply.slice(0, 15) },
              { text: reply.slice(15) },
            ],
          },
        },
      ],
    }),
  );
  await expect(provider.extract(SOURCES, TARGETS)).resolves.toEqual([
    { slug: "consent", ...VALID.consent },
  ]);
});
