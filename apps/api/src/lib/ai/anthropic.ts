// SPDX-License-Identifier: AGPL-3.0-only

import {
  extractionPrompt,
  parseExtractionReply,
  postJson,
  protocolUrl,
  requireReply,
  stringAt,
} from "./http.js";
import type { AiProvider, AiProviderConfig } from "./provider.js";

export function createAnthropicProvider(config: AiProviderConfig): AiProvider {
  const endpoint = protocolUrl(config.baseUrl, "messages", "/messages");

  async function complete(prompt: string, maxTokens: number): Promise<string> {
    const response = await postJson(
      endpoint,
      { "x-api-key": config.apiKey ?? "", "anthropic-version": "2023-06-01" },
      {
        model: config.model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      },
    );
    return requireReply(stringAt(response, ["content", 0, "text"]));
  }

  return {
    preset: config.preset,
    protocol: "anthropic_messages",
    model: config.model,
    async extract(text, targets) {
      return parseExtractionReply(await complete(extractionPrompt(text, targets), 1024), targets);
    },
    async probe() {
      await complete('Reply with only the JSON object {"ok":true}.', 16);
    },
  };
}
