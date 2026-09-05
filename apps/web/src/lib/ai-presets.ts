// SPDX-License-Identifier: AGPL-3.0-only

/**
 * How each TECH-012 provider preset reads. The presets themselves are
 * server-owned: the API fixes each one's protocol, host, default model,
 * and credential requirement, and answers the list on
 * `GET /api/v1/ai-connector`. Only the wording is here.
 *
 * Two surfaces name a preset: the AI analysis pane (SET-008) and the
 * first-run wizard's AI analysis step (#699). One copy is what keeps
 * "Custom endpoint" from becoming "Custom Endpoint" on one of them. The
 * message ids predate this file, so the catalog did not change when the
 * map moved here.
 */

import { defineMessages, type IntlShape, type MessageDescriptor } from "react-intl";
import type { paths } from "@openlaw/api-client";

/** Taken off the generated client, so a preset the API adds fails the
 * build here until it has wording. */
export type AiPreset =
  paths["/api/v1/ai-connector"]["get"]["responses"]["200"]["content"]["application/json"]["presets"][number]["preset"];

export const AI_PRESET_MESSAGES: Readonly<Record<AiPreset, MessageDescriptor>> = defineMessages({
  anthropic: { id: "settings.aiAnalysis.provider.anthropic", defaultMessage: "Anthropic" },
  openai: { id: "settings.aiAnalysis.provider.openai", defaultMessage: "OpenAI" },
  azure_openai: { id: "settings.aiAnalysis.provider.azureOpenAi", defaultMessage: "Azure OpenAI" },
  gemini: { id: "settings.aiAnalysis.provider.gemini", defaultMessage: "Gemini" },
  openrouter: { id: "settings.aiAnalysis.provider.openRouter", defaultMessage: "OpenRouter" },
  ollama: { id: "settings.aiAnalysis.provider.ollama", defaultMessage: "Ollama" },
  custom: { id: "settings.aiAnalysis.provider.custom", defaultMessage: "Custom endpoint" },
});

/**
 * A preset as plain text, for an option element or a narrated sentence.
 * A slug outside the union reads as itself: the server owns the list,
 * so a build can meet a preset it does not yet have wording for.
 */
export function aiPresetLabel(intl: IntlShape, preset: string): string {
  const catalog: Readonly<Partial<Record<string, MessageDescriptor>>> = AI_PRESET_MESSAGES;
  const message = catalog[preset];
  return message ? intl.formatMessage(message) : preset;
}
