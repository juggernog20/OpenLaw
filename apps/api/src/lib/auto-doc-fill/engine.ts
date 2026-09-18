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
  /**
   * Fills now, or waits for a slot. Rejects with
   * {@link AutoDocFillBusyError} when every slot and queue place is taken.
   */
  fill(input: AutoDocFillInput): Promise<Buffer>;
  /**
   * Claims a place for one fill before the caller commits to it, so a
   * Generation that is refused for want of room records nothing. Throws
   * {@link AutoDocFillBusyError} when every slot and queue place is taken.
   */
  admit(): AutoDocFillAdmission;
}
/** One fill's claimed place. Fill once, or give the place back. */
export interface AutoDocFillAdmission {
  fill(input: AutoDocFillInput): Promise<Buffer>;
  /** Gives the place back. A no-op once the fill ran or the place was released. */
  release(): void;
}
/**
 * Every fill slot and every queue place in this process is taken. The
 * caller should answer 503 with Retry-After; nothing about the input is
 * at fault.
 */
export class AutoDocFillBusyError extends Error {
  constructor() {
    super("Every fill slot and every queue place is taken.");
    this.name = "AutoDocFillBusyError";
  }
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
