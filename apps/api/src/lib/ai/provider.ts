// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The TECH-012 AI connector seam: protocol-neutral extraction and probing,
 * plus the error taxonomy used by the live resolver and later pipeline work.
 */

import type { AiPreset, AiProtocol } from "@openlaw/db";

/** One field the provider should extract from the contract text. */
export interface AiExtractionTarget {
  slug: string;
  prompt: string;
}

export interface AiSource {
  id: string;
  revision: string;
  label: string;
  text: string;
  kind: "request" | "field" | "message" | "document";
  author?: string;
  createdAt?: string;
}

/** One answer from the provider. Evidence may be absent in a weak model's reply. */
export interface AiExtraction {
  slug: string;
  value: unknown;
  evidence?: string;
  sourceId?: string;
  citations?: { sourceId: string; quote: string }[];
  conflict?: boolean;
  /** Short user-facing explanation grounded in the cited facts. */
  justification?: string;
}

/** The stored connector values needed to build one protocol adapter. */
export interface AiProviderConfig {
  preset: AiPreset;
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

/**
 * What the provider answered when it refused. The status code is safe
 * to show. The summary is a short, redacted cut of the provider's own
 * body. It is for logs only: a provider can quote back the key it was
 * handed, or an HTML page nobody should see in Settings.
 */
export interface AiUpstreamRefusal {
  status: number;
  summary: string;
}

export interface AiErrorOptions {
  cause?: unknown;
  upstream?: AiUpstreamRefusal;
}

export class AiProviderError extends Error {
  /** Set when the provider answered with a refusal body. Never shown to a person. */
  readonly upstream?: AiUpstreamRefusal;

  constructor(message: string, options?: AiErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    if (options?.upstream) this.upstream = options.upstream;
  }
}

/** The provider refused the key, model, endpoint, or request. */
export class AiConfigError extends AiProviderError {
  constructor(message: string, options?: AiErrorOptions) {
    super(message, options);
    this.name = "AiConfigError";
  }
}

/** The provider answered, but not with a usable model reply. */
export class AiResponseError extends AiProviderError {
  constructor(message: string, options?: AiErrorOptions) {
    super(message, options);
    this.name = "AiResponseError";
  }
}

/** The provider could not be reached. */
export class AiUnavailableError extends AiProviderError {
  constructor(message: string, options?: AiErrorOptions) {
    super(message, options);
    this.name = "AiUnavailableError";
  }
}

/** The provider did not answer inside the call bound. */
export class AiTimeoutError extends AiProviderError {
  constructor(message: string, options?: AiErrorOptions) {
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

  extract(
    text: string | readonly AiSource[],
    targets: readonly AiExtractionTarget[],
  ): Promise<AiExtraction[]>;

  /** Makes one small model call to prove the stored configuration. */
  probe(): Promise<void>;
}
