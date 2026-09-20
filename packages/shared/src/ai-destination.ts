// SPDX-License-Identifier: AGPL-3.0-only

/** The destination identity used by Saved keys in the API and web forms (SET-008). */
export function normalizeAiBaseUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  url.searchParams.sort();
  return url.toString();
}
