// SPDX-License-Identifier: AGPL-3.0-only
/** Source-bound Matter conversion suggestions and unverified values (INT-008). */

/** INT-008: a proposal reviewed before the ordinary conversion creates a record. */
export interface ConversionCitation {
  sourceId: string;
  revision: string;
  quote: string;
}
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
  text: string;
  mimeType?: string;
  method?: "native_layer" | "converted" | "ocr" | "email_body";
  previewRef?: string;
  byteSize?: number;
}
