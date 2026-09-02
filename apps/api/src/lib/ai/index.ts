// SPDX-License-Identifier: AGPL-3.0-only

import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible.js";
import type { AiProvider, AiProviderConfig } from "./provider.js";

export function createAiProvider(config: AiProviderConfig): AiProvider {
  switch (config.protocol) {
    case "anthropic_messages":
      return createAnthropicProvider(config);
    case "openai_chat_completions":
      return createOpenAiCompatibleProvider(config);
    case "gemini":
      return createGeminiProvider(config);
  }
}

export * from "./provider.js";
export * from "./presets.js";
