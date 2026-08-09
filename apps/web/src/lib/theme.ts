// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Theme application (#44). The server value on the user record is the
 * source of truth; a localStorage mirror lets the inline boot script in
 * index.html set the root attribute before first paint, and the shell
 * reconciles with the server value once /me answers. No theme provider:
 * switching is one attribute write on <html> (DES-005).
 */

/** The three shipped UI themes (DES-001); Light is the default (DES-002). */
export const THEMES = ["light", "warm", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** Narrowing guard for strings arriving from outside the type system
 * (Radix menu values, storage reads). */
export function isTheme(value: string): value is Theme {
  return (THEMES as readonly string[]).includes(value);
}

/** Read by the pre-paint script in index.html — keep the two in sync. */
const MIRROR_KEY = "openlaw.theme";

/** Sets the presentation attribute only. The pre-login screens use this
 * to force Light without touching the person's stored preference. */
export function setDocumentTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Applies a signed-in user's preference: root attribute plus the local
 * mirror the next load's pre-paint script reads. */
export function applyPreferredTheme(theme: Theme): void {
  setDocumentTheme(theme);
  try {
    localStorage.setItem(MIRROR_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); the attribute still
    // applied, so only the next load's pre-paint mirror is lost.
  }
}
