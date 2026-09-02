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

  async function complete(prompt: string, maxTokens: number): Promise<string> {
    const response = await postJson(endpoint, headers, {
      model: config.model,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    });
    return requireReply(stringAt(response, ["choices", 0, "message", "content"]));
  }

  return {
    preset: config.preset,
    protocol: "openai_chat_completions",
    model: config.model,
    async extract(text, targets) {
      return parseExtractionReply(await complete(extractionPrompt(text, targets), 1024), targets);
    },
    async probe() {
      await complete('Reply with only the JSON object {"ok":true}.', 16);
    },
  };
}
