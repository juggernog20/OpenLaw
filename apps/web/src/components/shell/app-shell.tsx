// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The authenticated application shell (M4 spec, #40): skip link,
 * header, top nav, then the page's sub-bar and main content. Two
 * container contexts are established here — `shell` on the shell
 * column and `page` on the main region — so content components query
 * their container, never the viewport (DES-012).
 */

import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { useGlobalKeys } from "../../lib/keyboard";
import { cn } from "../../lib/utils";
import { applyPreferredTheme, type Theme } from "../../lib/theme";
import { SkipLink } from "../skip-link";
import { AppHeader } from "./app-header";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts";
import { ShellThemeContext } from "./theme-context";
import { TopNav } from "./top-nav";
import type { ShellUser } from "./user-menu";

export function AppShell({
  user,
  onSignOut,
  subbar,
  flush = false,
  children,
}: {
  user: ShellUser;
  onSignOut: () => void;
  subbar?: ReactNode;
  /** Edge-to-edge main region for pages that own their gutters (the settings rail). */
  flush?: boolean;
  children: ReactNode;
}) {
  // Server value first: the loader's /me answer seeds the state, and the
  // effect reconciles the pre-paint mirror with it (#44). Layout effect
  // so a switch repaints in the new theme on the very next frame.
  const [theme, setTheme] = useState<Theme>(user.theme);
  useLayoutEffect(() => {
    applyPreferredTheme(theme);
  }, [theme]);

  // The global keyboard contract (DES-010, #45) lives on the shell:
  // pre-login screens have no search input and no overlays to serve.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useGlobalKeys({ onOpenCheatSheet: () => setShortcutsOpen(true) });

  const changeTheme = useCallback((next: Theme) => {
    // The state change applies the attribute instantly via the effect;
    // persistence rides behind it. A failed write is deliberately not
    // reverted — the server value simply wins again on the next load.
    setTheme(next);
    void api.PATCH("/api/v1/me/preferences", { body: { theme: next } });
  }, []);
  const shellTheme = useMemo(() => ({ theme, changeTheme }), [theme, changeTheme]);

  return (
    <ShellThemeContext.Provider value={shellTheme}>
      <div className="@container/shell flex min-h-screen flex-col bg-canvas text-primary">
        <SkipLink />
        <AppHeader user={user} onSignOut={onSignOut} />
        <TopNav />
        {subbar}
        {/* tabIndex={-1} makes the skip-link target programmatically
            focusable, so activating the link moves keyboard focus here in
            every browser — not only the ones that reset the sequential
            focus start point on fragment navigation. */}
        <main
          id="main"
          tabIndex={-1}
          className={cn("@container/page flex-1", flush ? "flex flex-col" : "px-page-x py-page-y")}
        >
          {children}
        </main>
        <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </div>
    </ShellThemeContext.Provider>
  );
}
