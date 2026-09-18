// SPDX-License-Identifier: AGPL-3.0-only

import {
  postJson,
  PROBE_BOUND,
  protocolUrl,
  requireReply,
  stringAt,
  type AiCallBound,
} from "./http.js";
import { AiConfigError, type AiProvider, type AiProviderConfig } from "./provider.js";
import {
  checkCompletionReason,
  extractStructured,
  remainingCallBound,
} from "./structured-extraction.js";
import type { AiPreset } from "@openlaw/db";

/** OpenAI's own hosts. Their current models take `max_completion_tokens` and refuse `max_tokens`. */
const OPENAI_HOSTED_PRESETS: ReadonlySet<AiPreset> = new Set<AiPreset>(["openai", "azure_openai"]);

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
    output: "schema" as "schema" | "json" | "prompt",
  };

  function relearn(error: unknown, extraction: boolean, sent: typeof wire): boolean {
    if (!(error instanceof AiConfigError) || ![400, 422].includes(error.upstream?.status ?? 0))
      return false;
    // The transport reads the refused field from the whole bounded body.
    // The summary is a cut for the log and is never read here.
    const field = error.upstream?.unsupportedField;
    if (field === "max_tokens" && sent.tokenField === "max_tokens") {
      wire.tokenField = "max_completion_tokens";
      return true;
    }
    if (field === "temperature" && sent.temperature) {
      wire.temperature = false;
      return true;
    }
    if (field === "response_format" && sent.output !== "prompt") {
      if (wire.output === sent.output)
        wire.output = extraction && wire.output === "schema" ? "json" : "prompt";
      return true;
    }
    return false;
  }

  async function send(
    prompt: string,
    bound: AiCallBound,
    schema?: Record<string, unknown>,
  ): Promise<string> {
    const response = await postJson(
      endpoint,
      headers,
      {
        model: config.model,
        ...(wire.temperature ? { temperature: 0 } : {}),
        [wire.tokenField]: bound.maxTokens,
        ...(schema && wire.output === "schema"
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: "extraction", strict: true, schema },
              },
              ...(config.preset === "openrouter" ? { provider: { require_parameters: true } } : {}),
            }
          : wire.output !== "prompt"
            ? { response_format: { type: "json_object" } }
            : {}),
        messages: [{ role: "user", content: prompt }],
      },
      bound.timeoutMs,
    );
    checkCompletionReason(
      stringAt(response, ["choices", 0, "finish_reason"]),
      Boolean(stringAt(response, ["choices", 0, "message", "refusal"])),
    );
    return requireReply(stringAt(response, ["choices", 0, "message", "content"]));
  }

  async function complete(
    prompt: string,
    bound: AiCallBound,
    schema?: Record<string, unknown>,
  ): Promise<string> {
    // Each compatibility downgrade is one-way and stays inside the call deadline.
    const deadline = Date.now() + bound.timeoutMs;
    for (;;) {
      const sent = { ...wire };
      try {
        return await send(prompt, remainingCallBound(bound, deadline), schema);
      } catch (error) {
        if (!relearn(error, schema !== undefined, sent)) throw error;
      }
    }
  }

  return {
    preset: config.preset,
    protocol: "openai_chat_completions",
    model: config.model,
    async extract(text, targets) {
      return extractStructured(text, targets, complete, config.maxOutputTokens);
    },
    async probe() {
      await complete('Reply with only the JSON object {"ok":true}.', PROBE_BOUND);
    },
  };
}
