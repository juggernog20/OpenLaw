// SPDX-License-Identifier: AGPL-3.0-only

/** The plugin verifies the signature. Keep its query bytes intact until then. */
export function oauthAuthorizeReturn(search: string): string | undefined {
  return new URLSearchParams(search).has("sig")
    ? `/api/auth/oauth2/authorize${search.startsWith("?") ? search : `?${search}`}`
    : undefined;
}
