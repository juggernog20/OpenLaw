// SPDX-License-Identifier: AGPL-3.0-only

/** Centered single-card shell shared by every pre-app auth screen. */

import { Outlet } from "react-router";
import { SkipLink } from "../components/skip-link";

export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-primary">
      <SkipLink />
      <main id="main" className="flex flex-1 items-center justify-center px-page-x py-page-y">
        <div className="w-full max-w-sm">
          <p className="mb-6 text-center text-lg font-semibold">OpenLaw</p>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
