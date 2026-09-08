// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Centered single-card shell shared by every pre-app auth screen.
 *
 * It is a route layout for the /auth tree and a plain wrapper anywhere
 * else: the portal entry screen (#376) sits in its own route tree but is
 * the same pre-session card, and one shell is what keeps the two from
 * drifting apart.
 */

import { HelpLink } from "../components/documentation/help-link";
import { useLayoutEffect, type ReactNode } from "react";
import { Outlet } from "react-router";
import { FormattedMessage } from "react-intl";
import { SkipLink } from "../components/skip-link";
import { setDocumentTheme } from "../lib/theme";

export function AuthLayout({ children }: Readonly<{ children?: ReactNode }>) {
  // Pre-login screens render Light unconditionally (#44): presentation
  // only — the person's stored preference and its local mirror survive,
  // and the shell re-applies them after sign-in. The index.html boot
  // script skips /auth for the same reason.
  useLayoutEffect(() => {
    setDocumentTheme("light");
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-primary">
      <SkipLink />
      <main id="main" className="flex flex-1 items-center justify-center px-page-x py-page-y">
        <div className="w-full max-w-sm">
          <p className="mb-6 text-center text-lg font-semibold">
            <FormattedMessage id="auth.brand" defaultMessage="OpenLaw" />
          </p>
          {children ?? <Outlet />}
          <div className="mt-6 text-center">
            <HelpLink surface="formal" contextual />
          </div>
        </div>
      </main>
    </div>
  );
}
