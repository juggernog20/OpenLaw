// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sign-in return for the OAuth flow: keeps the plugin's signed query through
 * sign-in and re-enters the authorize endpoint with it. See DD-029.
 */
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

/**
 * The address that resumes the authorize under the session.
 *
 * A GET on the authorize endpoint does not check the signature; it reads
 * the parameters and signs a fresh query for the consent page. Two of them
 * would send a signed-in person straight back to the login page, forever:
 * `prompt=login` (and `create`) and `max_age`. The return drops them. The
 * app does not honour a forced re-authentication yet.
 */
export function oauthAuthorizeReturn(search: string): string | undefined {
  if (new URLSearchParams(search).get("signing_return") === "1") return "/signing/return";
  if (!new URLSearchParams(search).has("sig")) return undefined;
  const parts = search
    .replace(/^\?/, "")
    .split("&")
    .flatMap((part) => {
      const name = new URLSearchParams(part).keys().next().value;
      if (name === "max_age") return [];
      if (name !== "prompt") return [part];
      const kept = (new URLSearchParams(part).get("prompt") ?? "")
        .split(" ")
        .filter((prompt) => prompt && prompt !== "login" && prompt !== "create");
      return kept.length ? [`prompt=${encodeURIComponent(kept.join(" "))}`] : [];
    });
  return `/api/auth/oauth2/authorize?${parts.join("&")}`;
}
