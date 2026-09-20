// SPDX-License-Identifier: AGPL-3.0-only

import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listAiModels } from "./models.js";
import { AI_PRESET_DEFINITIONS } from "./presets.js";

afterEach(() => vi.unstubAllGlobals());

function replies(...bodies: unknown[]) {
  const fetcher = vi.fn();
  for (const body of bodies) fetcher.mockResolvedValueOnce(Response.json(body));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function config(preset: "anthropic" | "openai" | "gemini" | "openrouter" | "ollama" | "groq") {
  const definition = AI_PRESET_DEFINITIONS[preset];
  return { ...definition, baseUrl: definition.baseUrl!, apiKey: "test-provider-key" };
}

describe("provider model discovery", () => {
  it("lists Anthropic pages with display names and exact IDs", async () => {
    const fetcher = replies(
      { data: [{ id: "claude-a", display_name: "Claude A" }], has_more: true, last_id: "claude-a" },
      { data: [{ id: "claude-b", display_name: "Claude B" }], has_more: false },
    );
    expect(await listAiModels(config("anthropic"))).toEqual({
      models: [
        { id: "claude-a", label: "Claude A" },
        { id: "claude-b", label: "Claude B" },
      ],
      truncated: false,
    });
    expect(String(fetcher.mock.calls[1]![0])).toContain("after_id=claude-a");
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { "x-api-key": "test-provider-key" },
    });
  });

  it("keeps Gemini generateContent models and follows page tokens", async () => {
    const fetcher = replies(
      {
        models: [{ name: "models/embed", supportedGenerationMethods: ["embedContent"] }],
        nextPageToken: "page/2",
      },
      {
        models: [
          {
            name: "models/gemini-test",
            displayName: "Gemini Test",
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      },
    );
    expect((await listAiModels(config("gemini"))).models).toEqual([
      { id: "gemini-test", label: "Gemini Test" },
    ]);
    expect(String(fetcher.mock.calls[1]![0])).toContain("pageToken=page%2F2");
    expect(String(fetcher.mock.calls[0]![0])).not.toContain("test-provider-key");
  });

  it("labels a Gemini model without a display name by its bare ID", async () => {
    replies({
      models: [
        {
          name: "models/gemini-unnamed",
          supportedGenerationMethods: ["generateContent"],
        },
      ],
    });
    expect((await listAiModels(config("gemini"))).models).toEqual([
      { id: "gemini-unnamed", label: "gemini-unnamed" },
    ]);
  });

  it.each(["openai", "ollama"] as const)(
    "lists %s IDs without inferring capabilities",
    async (preset) => {
      const fetcher = replies({ data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }] });
      expect((await listAiModels(config(preset))).models).toEqual([
        { id: "model-a", label: "model-a" },
        { id: "model-b", label: "model-b" },
      ]);
      expect(String(fetcher.mock.calls[0]![0])).toBe(`${config(preset).baseUrl}/models`);
    },
  );

  it("filters OpenRouter models that cannot take and return text", async () => {
    replies({
      data: [
        {
          id: "vendor/chat",
          name: "Vendor Chat",
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        },
        {
          id: "vendor/image",
          architecture: { input_modalities: ["text"], output_modalities: ["image"] },
        },
      ],
    });
    expect((await listAiModels(config("openrouter"))).models).toEqual([
      { id: "vendor/chat", label: "Vendor Chat" },
    ]);
  });

  const groqModels = [
    { id: "llama-3.3-70b-versatile", active: true },
    { id: "llama-3.1-8b-instant", active: false },
    { id: "whisper-large-v3", active: true },
    { id: "playai-tts", active: true },
    { id: "canopylabs/orpheus-v1-english", active: true },
    { id: "meta-llama/llama-guard-4-12b", active: true },
  ];

  it("lists only active Groq chat models, labelled by ID, in one authenticated request", async () => {
    const fetcher = replies({ data: groqModels });
    expect(await listAiModels(config("groq"))).toEqual({
      models: [{ id: "llama-3.3-70b-versatile", label: "llama-3.3-70b-versatile" }],
      truncated: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://api.groq.com/openai/v1/models");
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { authorization: "Bearer test-provider-key" },
    });
  });

  it.each(["openai", "custom"] as const)("does not apply Groq filters to %s", async (preset) => {
    replies({ data: groqModels });
    const result = await listAiModels({ ...config("openai"), preset });
    expect(result.models).toHaveLength(groqModels.length);
    expect(result.models).toEqual(
      expect.arrayContaining(groqModels.map(({ id }) => ({ id, label: id }))),
    );
  });

  it("keeps Groq models without an active flag and always uses their ID as the label", async () => {
    replies({ data: [{ id: "openai/gpt-oss-120b", name: "Name", display_name: "Display name" }] });
    expect((await listAiModels(config("groq"))).models).toEqual([
      { id: "openai/gpt-oss-120b", label: "openai/gpt-oss-120b" },
    ]);
  });

  it("ignores pagination metadata on Groq's flat list", async () => {
    const fetcher = replies({
      data: [{ id: "chat-model" }],
      has_more: true,
      last_id: "chat-model",
      nextPageToken: "page-2",
    });
    expect(await listAiModels(config("groq"))).toEqual({
      models: [{ id: "chat-model", label: "chat-model" }],
      truncated: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("replaces a custom inference path while retaining its query", async () => {
    const fetcher = replies({ data: [] });
    await listAiModels({
      ...config("openai"),
      preset: "custom",
      baseUrl: "https://provider.test/root/chat/completions?version=1",
    });
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://provider.test/root/models?version=1");
  });

  it("bounds repeated pagination and reports a partial list", async () => {
    replies(
      { data: [{ id: "a" }], has_more: true, last_id: "a" },
      { data: [{ id: "b" }], has_more: true, last_id: "a" },
    );
    expect((await listAiModels(config("anthropic"))).truncated).toBe(true);
  });

  it("refuses malformed data without exposing its contents", async () => {
    replies({ error: "test-provider-key" });
    await expect(listAiModels(config("openai"))).rejects.toThrow(
      "The provider returned an invalid model list.",
    );
  });

  it("reports HTTP failures without reflecting provider text or credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("test-provider-key", { status: 401 })),
    );
    await expect(listAiModels(config("openai"))).rejects.toThrow(
      "The provider refused model discovery with HTTP 401.",
    );
  });
});

describe("model discovery transport limits", () => {
  it("does not follow a real HTTP redirect with credentials", async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url ?? "");
      response.writeHead(302, { location: "/credential-sink" });
      response.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server port");
      await expect(
        listAiModels({
          ...config("openai"),
          preset: "custom",
          baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
        }),
      ).rejects.toThrow("could not be reached or read");
      expect(paths).toEqual(["/v1/models"]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("cancels an oversized model list body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(500_000));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(listAiModels(config("openai"))).rejects.toThrow("invalid model list");
    expect(cancelled).toBe(true);
  });

  it("reports a timeout during body reading without exposing its cause", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new DOMException("test-provider-key", "TimeoutError"));
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(listAiModels(config("openai"))).rejects.toThrow(
      "did not return its models in time",
    );
  });
});
