// SPDX-License-Identifier: AGPL-3.0-only

import type { AiPreset, AiProtocol } from "@openlaw/db";

/** One field the provider should extract from the contract text. */
export interface AiExtractionTarget {
  slug: string;
  prompt: string;
}

/** One answer from the provider. Evidence may be absent in a weak model's reply. */
export interface AiExtraction {
  slug: string;
  value: unknown;
  evidence?: string;
}

/** The stored connector values needed to build one protocol adapter. */
export interface AiProviderConfig {
  preset: AiPreset;
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

export class AiProviderError extends Error {}

/** The provider refused the key, model, endpoint, or request. */
export class AiConfigError extends AiProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiConfigError";
  }
}

/** The provider answered, but not with a usable model reply. */
export class AiResponseError extends AiProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiResponseError";
  }
}

/** The provider could not be reached. */
export class AiUnavailableError extends AiProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiUnavailableError";
  }
}

/** The provider did not answer inside the call bound. */
export class AiTimeoutError extends AiProviderError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiTimeoutError";
  }
}

/** Credential and reply faults do not improve when a worker retries them. */
export function isTerminalAiError(error: unknown): boolean {
  return error instanceof AiConfigError || error instanceof AiResponseError;
}

/** The one seam all three TECH-012 protocol adapters implement. */
export interface AiProvider {
  readonly preset: AiPreset;
  readonly protocol: AiProtocol;
  readonly model: string;

  extract(text: string, targets: readonly AiExtractionTarget[]): Promise<AiExtraction[]>;

  /** Makes one small model call to prove the stored configuration. */
  probe(): Promise<void>;
}
