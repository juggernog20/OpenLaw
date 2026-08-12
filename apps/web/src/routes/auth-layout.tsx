// SPDX-License-Identifier: AGPL-3.0-only

/** Centered single-card shell shared by every pre-app auth screen. */

import { useLayoutEffect } from "react";
import { Outlet } from "react-router";
import { FormattedMessage } from "react-intl";
import { SkipLink } from "../components/skip-link";
import { setDocumentTheme } from "../lib/theme";

export function AuthLayout() {
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
          <Outlet />
        </div>
      </main>
    </div>
  );
}
