// SPDX-License-Identifier: AGPL-3.0-only

/** The plugin verifies the signature. Keep its query bytes intact until then. */
export function oauthLoginSearch(search: string): string {
  const params = new URLSearchParams(search);
  if (!params.has("sig")) return search;
  const signedNames = new Set(params.getAll("ba_param"));
  const parts = search.replace(/^\?/, "").split("&");
  // Sign-in callbacks append diagnostics outside the plugin's signed parameters.
  while (parts.length) {
    const name = new URLSearchParams(parts.at(-1)).keys().next().value;
    if (!name || signedNames.has(name) || !["error", "method", "error_description"].includes(name))
      break;
    parts.pop();
  }
  return `?${parts.join("&")}`;
}

export function oauthAuthorizeReturn(search: string): string | undefined {
  return new URLSearchParams(search).has("sig")
    ? `/api/auth/oauth2/authorize${search.startsWith("?") ? search : `?${search}`}`
    : undefined;
}
