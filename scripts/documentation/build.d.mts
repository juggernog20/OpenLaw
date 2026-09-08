// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The build-only compiler/export contract for the Vite integration, per TECH-026.
 */

import type { DocumentationBundle } from "./reader.mjs";
export const repository: string;
export function applicationDigest(root?: string): string;
export function buildIdentity(root?: string): {
  commit: string | null;
  dirty: boolean;
  applicationSha256: string;
};
export interface Compilation {
  bundle: DocumentationBundle;
  files: Map<string, string | Uint8Array>;
}
export function compileWorkspace(options?: {
  preview?: boolean;
  fixture?: boolean;
  complete?: boolean;
}): Compilation;
export function exportFiles(result: Compilation): Map<string, string | Uint8Array>;
