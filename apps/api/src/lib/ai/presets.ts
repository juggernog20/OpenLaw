// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Server-owned TECH-012 provider presets. Each preset fixes its wire protocol,
 * host where one is shared, default model, and credential requirement.
 */

import type { AiPreset, AiProtocol } from "@openlaw/db";

export interface AiPresetDefinition {
  preset: AiPreset;
  label: string;
  protocol: AiProtocol;
  /** NULL only where the Administrator must supply an endpoint. */
  baseUrl: string | null;
  defaultModel: string;
  requiresApiKey: boolean;
  requiresBaseUrl: boolean;
}

/** Server-owned preset values. A client choice cannot change their protocol or fixed host. */
export const AI_PRESET_DEFINITIONS: Readonly<Record<AiPreset, AiPresetDefinition>> = {
  anthropic: {
    preset: "anthropic",
    label: "Anthropic",
    protocol: "anthropic_messages",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5",
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  openai: {
    preset: "openai",
    label: "OpenAI",
    protocol: "openai_chat_completions",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6-luna",
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  azure_openai: {
    preset: "azure_openai",
    label: "Azure OpenAI",
    protocol: "openai_chat_completions",
    // Azure has no shared host. The full deployment endpoint is the one
    // preset value an Administrator supplies, while the protocol and
    // api-key authentication remain pinned here.
    baseUrl: null,
    defaultModel: "gpt-5.6-luna",
    requiresApiKey: true,
    requiresBaseUrl: true,
  },
  gemini: {
    preset: "gemini",
    label: "Gemini",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.6-flash",
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  openrouter: {
    preset: "openrouter",
    label: "OpenRouter",
    protocol: "openai_chat_completions",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "~openai/gpt-latest",
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  ollama: {
    preset: "ollama",
    label: "Ollama",
    protocol: "openai_chat_completions",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    requiresApiKey: false,
    requiresBaseUrl: false,
  },
  custom: {
    preset: "custom",
    label: "Custom endpoint",
    protocol: "openai_chat_completions",
    baseUrl: null,
    defaultModel: "",
    requiresApiKey: true,
    requiresBaseUrl: true,
  },
};

export const AI_PRESET_OPTIONS = Object.values(AI_PRESET_DEFINITIONS);
