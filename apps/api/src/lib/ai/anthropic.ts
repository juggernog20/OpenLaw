// SPDX-License-Identifier: AGPL-3.0-only

import {
  EXTRACTION_BOUND,
  extractionPrompt,
  parseExtractionReply,
  postJson,
  PROBE_BOUND,
  protocolUrl,
  requireReply,
  type AiCallBound,
} from "./http.js";
import type { AiProvider, AiProviderConfig } from "./provider.js";

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

  async function complete(prompt: string, bound: AiCallBound): Promise<string> {
    const response = await postJson(
      endpoint,
      { "x-api-key": config.apiKey ?? "", "anthropic-version": "2023-06-01" },
      {
        model: config.model,
        max_tokens: bound.maxTokens,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      },
      bound.timeoutMs,
    );
    return requireReply(firstTextBlock(response));
  }

  return {
    preset: config.preset,
    protocol: "anthropic_messages",
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
