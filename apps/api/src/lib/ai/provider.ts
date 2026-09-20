// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The TECH-012 AI connector seam: protocol-neutral extraction and probing,
 * plus the error taxonomy used by the live resolver and later pipeline work.
 */

import type { AiPreset, AiProtocol, FieldType } from "@openlaw/db";

import type { AiAnswerStyle } from "@openlaw/shared";

export interface AiExtractionOptions {
  answerStyle?: AiAnswerStyle;
}

/** One field the provider should extract from the contract text. */
export interface AiExtractionTarget {
  slug: string;
  prompt: string;
  type?: FieldType | "term_type" | "integer" | "value" | "counterparty" | "key_dates";
  options?: readonly string[] | null;
  /** Conversion title and description keep their own length and wording instructions. */
  omitAnswerStyle?: boolean;
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
  maxOutputTokens?: number;
  preset: AiPreset;
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

/** The request fields an adapter knows how to drop when a model refuses them. */
export const AI_UNSUPPORTED_FIELDS = [
  "max_tokens",
  "temperature",
  "response_format",
  "output_config",
  "responseJsonSchema",
] as const;
export type AiUnsupportedField = (typeof AI_UNSUPPORTED_FIELDS)[number];

/**
 * What the provider answered when it refused. The status code is safe
 * to show. The summary is a short, redacted cut of the provider's own
 * body. It is for logs only: a provider can quote back the key it was
 * handed, or an HTML page nobody should see in Settings. Code never
 * reads the summary. When the refusal names a request field the model
 * does not take, `unsupportedField` carries it, read from the whole
 * bounded body before the summary is cut, so an adapter can decide
 * what to drop on structured data.
 */
export interface AiUpstreamRefusal {
  status: number;
  summary: string;
  unsupportedField?: AiUnsupportedField;
}

export interface AiErrorOptions {
  cause?: unknown;
  upstream?: AiUpstreamRefusal;
}

export class AiProviderError extends Error {
  /** Set when the provider answered with a refusal body. Never shown to a person. */
  readonly upstream?: AiUpstreamRefusal;
  progress?: { completedBatches: number; totalBatches: number };

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
export type AiResponseFailure =
  "invalid_response" | "invalid_shape" | "output_limit" | "refused" | "empty_response";

export class AiResponseError extends AiProviderError {
  readonly reason: AiResponseFailure;
  readonly issues?: readonly { field: string; rule: string }[];

  constructor(
    message: string,
    options?: AiErrorOptions & {
      reason?: AiResponseFailure;
      issues?: readonly { field: string; rule: string }[];
    },
  ) {
    super(message, options);
    this.name = "AiResponseError";
    this.reason = options?.reason ?? "invalid_response";
    this.issues = options?.issues;
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

/** Fixed application copy only: provider bodies and source text never enter a saved failure. */
export function aiPreparationFailure(error: unknown): string {
  if (error instanceof AiResponseError) {
    if (error.reason === "output_limit")
      return "The AI response reached the configured output token limit. Increase it in AI analysis settings, then retry, or continue manually.";
    if (error.reason === "refused")
      return "The AI provider declined to analyze these sources. Continue manually or review your provider settings.";
    return "The AI provider returned a response that did not match the required format. Retry or continue manually.";
  }
  if (error instanceof AiTimeoutError)
    return "The AI provider did not finish in time. Retry or continue manually.";
  if (error instanceof AiUnavailableError)
    return "The AI provider is unavailable or busy. Retry later or continue manually.";
  if (error instanceof AiConfigError)
    return "The AI provider rejected the configuration. Check the provider, model, and credentials in AI analysis settings.";
  return "Preparation could not finish. Retry or continue manually.";
}

/** The one seam all three TECH-012 protocol adapters implement. */
export interface AiProvider {
  readonly preset: AiPreset;
  readonly protocol: AiProtocol;
  readonly model: string;

  extract(
    text: string | readonly AiSource[],
    targets: readonly AiExtractionTarget[],
    options?: AiExtractionOptions,
  ): Promise<AiExtraction[]>;

  /** Makes one small model call to prove the stored configuration. */
  probe(): Promise<void>;
}
