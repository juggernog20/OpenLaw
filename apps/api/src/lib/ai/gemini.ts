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

export function createGeminiProvider(config: AiProviderConfig): AiProvider {
  const endpoint = protocolUrl(
    config.baseUrl,
    `models/${encodeURIComponent(config.model)}:generateContent`,
    `/${encodeURIComponent(config.model)}:generateContent`,
  );

  let structured = true;
  async function send(
    prompt: string,
    bound: AiCallBound,
    schema?: Record<string, unknown>,
  ): Promise<string> {
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
          ...(schema && structured ? { responseJsonSchema: schema } : {}),
        },
      },
      bound.timeoutMs,
    );
    checkCompletionReason(
      stringAt(response, ["candidates", 0, "finishReason"]),
      Boolean(stringAt(response, ["promptFeedback", "blockReason"])),
    );
    const parts = (
      response as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      }
    )?.candidates?.[0]?.content?.parts;
    return requireReply(
      Array.isArray(parts)
        ? parts
            .filter(
              (part) =>
                part !== null &&
                typeof part === "object" &&
                part.thought !== true &&
                typeof part.text === "string",
            )
            .map((part) => part.text)
            .join("")
        : "",
    );
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
        error.upstream?.unsupportedField !== "responseJsonSchema"
      )
        throw error;
      structured = false;
      return send(prompt, remainingCallBound(bound, deadline), schema);
    }
  }

  return {
    preset: config.preset,
    protocol: "gemini",
    model: config.model,
    async extract(text, targets, options) {
      return extractStructured(text, targets, complete, config.maxOutputTokens, options);
    },
    async probe() {
      await complete('Reply with only the JSON object {"ok":true}.', PROBE_BOUND);
    },
  };
}
