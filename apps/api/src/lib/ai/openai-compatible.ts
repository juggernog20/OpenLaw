// SPDX-License-Identifier: AGPL-3.0-only

import {
  EXTRACTION_BOUND,
  extractionPrompt,
  parseExtractionReply,
  postJson,
  PROBE_BOUND,
  protocolUrl,
  requireReply,
  stringAt,
  type AiCallBound,
} from "./http.js";
import { AiConfigError, type AiProvider, type AiProviderConfig } from "./provider.js";
import type { AiPreset } from "@openlaw/db";

/** OpenAI's own hosts. Their current models take `max_completion_tokens` and refuse `max_tokens`. */
const OPENAI_HOSTED_PRESETS: ReadonlySet<AiPreset> = new Set<AiPreset>(["openai", "azure_openai"]);

/**
 * OpenAI's refusal for a request field its model does not take, for example
 * "Unsupported parameter: 'max_tokens' is not supported with this model" or
 * "Unsupported value: 'temperature' does not support 0 with this model".
 */
const UNSUPPORTED_FIELD = /unsupported (?:parameter|value)[^']*'(max_tokens|temperature)'/i;

export function createOpenAiCompatibleProvider(config: AiProviderConfig): AiProvider {
  const endpoint =
    config.preset === "azure_openai"
      ? new URL(config.baseUrl)
      : protocolUrl(config.baseUrl, "chat/completions", "/chat/completions");
  const headers: Record<string, string> =
    config.preset === "azure_openai"
      ? { "api-key": config.apiKey ?? "" }
      : config.apiKey
        ? { authorization: `Bearer ${config.apiKey}` }
        : {};

  // What this endpoint accepts, learned once per provider and kept for
  // its lifetime. Compatible servers such as Ollama, vLLM, and OpenRouter
  // take `max_tokens` and honor temperature zero. OpenAI's reasoning
  // models refuse both, so a refusal that names the field switches the
  // wire shape and the call is made again without it.
  const wire = {
    tokenField: OPENAI_HOSTED_PRESETS.has(config.preset) ? "max_completion_tokens" : "max_tokens",
    temperature: true,
  };

  function relearn(error: unknown): boolean {
    if (!(error instanceof AiConfigError)) return false;
    const field = UNSUPPORTED_FIELD.exec(error.message)?.[1]?.toLowerCase();
    if (field === "max_tokens" && wire.tokenField === "max_tokens") {
      wire.tokenField = "max_completion_tokens";
      return true;
    }
    if (field === "temperature" && wire.temperature) {
      wire.temperature = false;
      return true;
    }
    return false;
  }

  async function send(prompt: string, bound: AiCallBound): Promise<string> {
    const response = await postJson(
      endpoint,
      headers,
      {
        model: config.model,
        ...(wire.temperature ? { temperature: 0 } : {}),
        [wire.tokenField]: bound.maxTokens,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      },
      bound.timeoutMs,
    );
    return requireReply(stringAt(response, ["choices", 0, "message", "content"]));
  }

  async function complete(prompt: string, bound: AiCallBound): Promise<string> {
    // Each relearn step is one-way, so this loop runs at most three times.
    for (;;) {
      try {
        return await send(prompt, bound);
      } catch (error) {
        if (!relearn(error)) throw error;
      }
    }
  }

  return {
    preset: config.preset,
    protocol: "openai_chat_completions",
    model: config.model,
    async extract(text, targets) {
      return parseExtractionReply(
        await complete(extractionPrompt(text, targets), EXTRACTION_BOUND),
        targets,
      );
    },
    async probe() {
      await complete('Reply with only the JSON object {"ok":true}.', PROBE_BOUND);
    },
  };
}
