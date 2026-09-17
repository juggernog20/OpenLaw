// SPDX-License-Identifier: AGPL-3.0-only

/** Readable fallback for historical identifiers whose display name is unavailable. */
export function identifierLabel(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.:-]+/g, " ")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
