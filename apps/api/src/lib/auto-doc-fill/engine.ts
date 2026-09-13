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
export class AutoDocFillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutoDocFillError";
  }
}
