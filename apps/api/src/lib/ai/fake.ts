// SPDX-License-Identifier: AGPL-3.0-only

import {
  AiConfigError,
  AiUnavailableError,
  type AiExtraction,
  type AiExtractionTarget,
  type AiProvider,
} from "./provider.js";
import type { AiPreset, AiProtocol } from "@openlaw/db";

export const FAKE_VALID_AI_KEY = "openlaw-fake-ai-key";

export interface FakeAiProviderOptions {
  preset?: AiPreset;
  protocol?: AiProtocol;
  apiKey?: string | null;
  model?: string;
  answers?: Readonly<Record<string, { value: unknown; evidence?: string }>>;
}

/** A deterministic provider for API and pipeline suites. */
export class FakeAiProvider implements AiProvider {
  readonly preset: AiPreset;
  readonly protocol: AiProtocol;
  readonly model: string;
  readonly extractions: { text: string; targets: readonly AiExtractionTarget[] }[] = [];

  private readonly apiKey: string | null;
  private readonly answers: FakeAiProviderOptions["answers"];
  private reachable = true;

  constructor(options: FakeAiProviderOptions = {}) {
    this.preset = options.preset ?? "custom";
    this.protocol = options.protocol ?? "openai_chat_completions";
    this.apiKey = options.apiKey === undefined ? FAKE_VALID_AI_KEY : options.apiKey;
    this.model = options.model ?? "openlaw-fake-model";
    this.answers = options.answers;
  }

  async extract(text: string, targets: readonly AiExtractionTarget[]): Promise<AiExtraction[]> {
    await this.requireReady();
    this.extractions.push({ text, targets: targets.map((target) => ({ ...target })) });
    return targets.map((target, index) => {
      const answer = this.answers?.[target.slug];
      if (answer) return { slug: target.slug, ...answer };
      return {
        slug: target.slug,
        value: `fake-${target.slug}`,
        ...(index === 0 ? { evidence: text.slice(0, 40) } : {}),
      };
    });
  }

  async probe(): Promise<void> {
    await this.requireReady();
  }

  outage(active = true): void {
    this.reachable = !active;
  }

  private async requireReady(): Promise<void> {
    await Promise.resolve();
    if (!this.reachable) throw new AiUnavailableError("The fake AI provider is unavailable.");
    if (this.apiKey !== null && this.apiKey !== FAKE_VALID_AI_KEY) {
      throw new AiConfigError("The provider refused the API key.");
    }
  }
}

export function createFakeAiProvider(options: FakeAiProviderOptions = {}): FakeAiProvider {
  return new FakeAiProvider(options);
}
