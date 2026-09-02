// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The authenticated application shell (M4 spec, #40): skip link,
 * header, top nav, then the page's sub-bar and main content. Two
 * container contexts start here, `shell` on the shell column and `page`
 * on the main region, so content components query their container,
 * never the viewport (DES-012).
 *
 * One slot sits between the nav and the sub-bar: the record banner
 * (DES-009 Tier 2). It is a slot on the shell rather than the first
 * thing a page draws because it is chrome. It belongs with the nav
 * above it and the sub-bar below it, and the C8 mock stacks the three
 * in exactly that order.
 *
 * The shell owns the scroll, and gives it to `main` alone (DES-030).
 * The column is exactly one viewport tall and never scrolls itself. The
 * four strips above `main` each hold their own height and cannot be
 * pushed off it. DES-009 Tier 2 and DES-028 already claim this, a
 * statement that stays put through a long record. The document-scrolling
 * shell they were written against never delivered it. A page that wants
 * a finer split says `flush` and builds its own containers inside a
 * `main` that is already bounded. That is how the record body scrolls
 * under a fixed activity bar (DES-016).
 */

import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { useRetainedLiveEvents, type LiveEventRecordScope } from "../../lib/events";
import { useGlobalKeys } from "../../lib/keyboard";
import { cn } from "../../lib/utils";
import { applyPreferredTheme, type Theme } from "../../lib/theme";
import type { FieldStatus } from "../status-note";
import { SkipLink } from "../skip-link";
import { AppHeader } from "./app-header";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts";
import { ShellThemeContext } from "./theme-context";
import { TopNav } from "./top-nav";
import type { ShellUser } from "./user-menu";

export function AppShell({
  user,
  onSignOut,
  banner,
  subbar,
  flush = false,
  recordScope,
  children,
}: Readonly<{
  user: ShellUser;
  onSignOut: () => void;
  /** Chrome between the nav and the sub-bar. DES-009's confidentiality
   * banner today, and nothing else. It is persistent by contract: the
   * shell renders whatever it is given and offers no way to close it. */
  banner?: ReactNode;
  subbar?: ReactNode;
  /** The record this shell's live connection must pass through the open gate for. */
  recordScope?: LiveEventRecordScope;
  /** Edge-to-edge main region for pages that own their gutters (the settings rail). */
  flush?: boolean;
  children: ReactNode;
}>) {
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

  // The authenticated shell owns the tab's one live connection. The
  // shared module keeps it through route-to-route shell replacement.
  useRetainedLiveEvents(recordScope);

  const [themeStatus, setThemeStatus] = useState<FieldStatus>("idle");
  const changeTheme = useCallback((next: Theme) => {
    // The state change applies the attribute at once via the effect;
    // persistence rides behind it. A failed write is not reverted on
    // purpose. The server value wins again on the next load. The failure
    // is reported, so the user knows the choice did not stick.
    setTheme(next);
    setThemeStatus("saving");
    api
      .PATCH("/api/v1/me/preferences", { body: { theme: next } })
      .then(({ data }) => setThemeStatus(data ? "saved" : "error"))
      .catch(() => setThemeStatus("error"));
  }, []);
  const shellTheme = useMemo(
    () => ({ theme, changeTheme, themeStatus }),
    [theme, changeTheme, themeStatus],
  );

  return (
    <ShellThemeContext.Provider value={shellTheme}>
      {/* `h-dvh`, not `h-screen`: on a phone the viewport is the one the
          browser's own bars leave behind, and `vh` measures the one
          before they arrive. `overflow-hidden` is what makes the chrome
          fixed. There is no document scroll left for it to ride. */}
      <div className="@container/shell flex h-dvh flex-col overflow-hidden bg-canvas text-primary">
        <SkipLink />
        <AppHeader user={user} onSignOut={onSignOut} />
        <TopNav role={user.role} />
        {banner}
        {subbar}
        {/* tabIndex={-1} makes the skip-link target programmatically
            focusable, so activating the link moves keyboard focus here in
            every browser, not only the ones that reset the sequential
            focus start point on fragment navigation. */}
        {/* `min-h-0` is what lets it shrink: a flex item's floor is its
            content, so without this the region grows past the column and
            takes the scroll back to the document. */}
        <main
          id="main"
          tabIndex={-1}
          className={cn(
            "@container/page min-h-0 flex-1 overflow-y-auto",
            flush ? "flex flex-col" : "px-page-x py-page-y",
          )}
        >
          {children}
        </main>
        <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </div>
    </ShellThemeContext.Provider>
  );
}
