// SPDX-License-Identifier: AGPL-3.0-only
/** Source-bound record conversion suggestions and unverified values (INT-008). */

/** A quoted passage bound to one immutable source revision. */
export interface ConversionCitation {
  sourceId: string;
  revision: string;
  quote: string;
}
/** INT-008: a proposal reviewed before ordinary conversion creates a record. */
export interface ConversionSuggestion {
  value: string | number | boolean | string[];
  citations: ConversionCitation[];
}
export interface ConversionProvenance {
  draftId: string;
  writtenAt: string;
  targetTypeId: string;
  keyDateId?: string;
}
export type ConversionProvenanceMap = Record<string, ConversionProvenance>;

/** A bounded read of one immutable attachment; storage references stay server-side. */
export interface ConversionAttachmentRead {
  sourceId: string;
  revision: string;
  label: string;
  status: "readable" | "unreadable" | "unsupported" | "truncated" | "omitted";
  reason?: "source_limit" | "byte_limit" | "character_limit" | "runtime_limit" | "restricted";
  /** Server-side extraction; only authorized matched citations expose source text. */
  text: string;
  mimeType?: string;
  method?: "native_layer" | "converted" | "ocr" | "email_body";
  /** Server-side storage reference, translated to an authorized attachment URL when read. */
  previewRef?: string;
  byteSize?: number;
}
