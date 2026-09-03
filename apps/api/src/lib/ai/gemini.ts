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
import type { AiProvider, AiProviderConfig } from "./provider.js";

export function createGeminiProvider(config: AiProviderConfig): AiProvider {
  const endpoint = protocolUrl(
    config.baseUrl,
    `models/${encodeURIComponent(config.model)}:generateContent`,
    `/${encodeURIComponent(config.model)}:generateContent`,
  );

  async function complete(prompt: string, bound: AiCallBound): Promise<string> {
    const response = await postJson(
      endpoint,
      { "x-goog-api-key": config.apiKey ?? "" },
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          // Gemini counts thinking tokens against this cap, so it stays generous.
          maxOutputTokens: bound.maxTokens,
          responseMimeType: "application/json",
        },
      },
      bound.timeoutMs,
    );
    return requireReply(stringAt(response, ["candidates", 0, "content", "parts", 0, "text"]));
  }

  return {
    preset: config.preset,
    protocol: "gemini",
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
