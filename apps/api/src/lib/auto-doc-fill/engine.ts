// SPDX-License-Identifier: AGPL-3.0-only

/** TECH-028: a fill returns a complete package or fails before storage is touched. */
import type { AutoDocFormDefinition, CustomFieldValue } from "@openlaw/db";

export interface AutoDocFillInput {
  template: Buffer;
  definition: AutoDocFormDefinition;
  answers: Record<string, CustomFieldValue>;
  /** Entity ids stay in the answers; their names print in the document. */
  displayValues?: Record<string, string>;
}
export interface AutoDocFillEngine {
  fill(input: AutoDocFillInput): Promise<Buffer>;
}
/** The most a template may inflate to inside the fill worker. PizZip
 * inflates every part at once, so this bounds the worker's typed-array
 * memory, which its heap cap does not count. The upload screen and the
 * fill both check it. */
export const MAX_EXPANDED_TEMPLATE_BYTES = 32 * 1024 * 1024;
export class AutoDocFillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutoDocFillError";
  }
}
