// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The authenticated application shell (M4 spec, #40): skip link,
 * header, top nav, then the page's sub-bar and main content. Two
 * container contexts are established here — `shell` on the shell
 * column and `page` on the main region — so content components query
 * their container, never the viewport (DES-012).
 */

import type { ReactNode } from "react";
import { SkipLink } from "../skip-link";
import { AppHeader } from "./app-header";
import { TopNav } from "./top-nav";
import type { ShellUser } from "./user-menu";

export function AppShell({
  user,
  onSignOut,
  subbar,
  children,
}: {
  user: ShellUser;
  onSignOut: () => void;
  subbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="@container/shell flex min-h-screen flex-col bg-canvas text-primary">
      <SkipLink />
      <AppHeader user={user} onSignOut={onSignOut} />
      <TopNav />
      {subbar}
      <main id="main" className="@container/page flex-1 px-page-x py-page-y">
        {children}
      </main>
    </div>
  );
}
