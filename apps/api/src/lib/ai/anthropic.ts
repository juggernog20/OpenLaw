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

/** The first `text` block of a Messages reply. A model with thinking on
 * answers with a thinking block first, so index 0 is not the answer. */
function firstTextBlock(response: unknown): string {
  const content =
    typeof response === "object" && response !== null
      ? (response as { content?: unknown }).content
      : undefined;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (type === "text" && typeof text === "string") return text;
  }
  return "";
}

export function createAnthropicProvider(config: AiProviderConfig): AiProvider {
  const endpoint = protocolUrl(config.baseUrl, "messages", "/messages");

  let structured = true;
  async function send(
    prompt: string,
    bound: AiCallBound,
    schema?: Record<string, unknown>,
  ): Promise<string> {
    const response = await postJson(
      endpoint,
      { "x-api-key": config.apiKey ?? "", "anthropic-version": "2023-06-01" },
      {
        model: config.model,
        max_tokens: bound.maxTokens,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
        ...(schema && structured
          ? { output_config: { format: { type: "json_schema", schema } } }
          : {}),
      },
      bound.timeoutMs,
    );
    checkCompletionReason(stringAt(response, ["stop_reason"]));
    return requireReply(firstTextBlock(response));
  }

  async function complete(prompt: string, bound: AiCallBound, schema?: Record<string, unknown>) {
    const deadline = Date.now() + bound.timeoutMs;
    const sentStructured = structured;
    try {
      return await send(prompt, bound, schema);
    } catch (error) {
      if (
        !schema ||
        !sentStructured ||
        !(error instanceof AiConfigError) ||
        ![400, 422].includes(error.upstream?.status ?? 0) ||
        error.upstream?.unsupportedField !== "output_config"
      )
        throw error;
      structured = false;
      return send(prompt, remainingCallBound(bound, deadline), schema);
    }
  }

  return {
    preset: config.preset,
    protocol: "anthropic_messages",
    model: config.model,
    async extract(text, targets, options) {
      return extractStructured(text, targets, complete, config.maxOutputTokens, options);
    },
    async probe() {
      await complete('Reply with only the JSON object {"ok":true}.', PROBE_BOUND);
    },
  };
}
