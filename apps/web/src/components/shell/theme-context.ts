// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The shell's theme seam. AppShell owns the theme state (server value
 * seeds it, a change applies instantly and persists via the preference
 * endpoint); pages that present a switcher — the Appearance pane —
 * reach it through this context instead of duplicating the state.
 */

import { createContext, useContext } from "react";
import type { Theme } from "../../lib/theme";

export interface ShellTheme {
  theme: Theme;
  changeTheme: (theme: Theme) => void;
}

export const ShellThemeContext = createContext<ShellTheme | null>(null);

export function useShellTheme(): ShellTheme {
  const value = useContext(ShellThemeContext);
  if (!value) throw new Error("useShellTheme must be used inside AppShell.");
  return value;
}
