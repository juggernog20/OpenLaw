// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Auth screens share a light canvas and skip link. Sign-in and setup use
 * the branded 384 card; consent draws its own 520 card on the same canvas.
 */

import { HelpLink } from "../components/documentation/help-link";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { Outlet } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { SkipLink } from "../components/skip-link";
import { setDocumentTheme } from "../lib/theme";
import { useOrganizationBranding } from "../lib/organization-branding";

export function AuthCanvas({ children }: Readonly<{ children: ReactNode }>) {
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
        {children}
      </main>
    </div>
  );
}

export function AuthLayout({ children }: Readonly<{ children?: ReactNode }>) {
  const intl = useIntl();
  const branding = useOrganizationBranding();
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const name = branding?.name.trim();
  const logo = branding?.logo && branding.logo !== failedLogo ? branding.logo : null;
  return (
    <AuthCanvas>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {logo && (
            <img
              src={logo}
              alt={intl.formatMessage({ id: "auth.logo", defaultMessage: "Organization logo" })}
              className="max-h-32 max-w-full object-contain"
              onError={() => setFailedLogo(logo)}
            />
          )}
          <p className="max-w-full break-words text-lg font-semibold">
            {name || <FormattedMessage id="auth.brand" defaultMessage="OpenLaw" />}
          </p>
          <p className="text-md text-muted">
            <FormattedMessage id="auth.portalLabel" defaultMessage="Legal Portal" />
          </p>
          {name && (
            <p className="text-sm text-muted">
              <FormattedMessage id="auth.poweredBy" defaultMessage="Powered by OpenLaw" />
            </p>
          )}
        </div>
        {children ?? <Outlet />}
        <div className="mt-6 text-center">
          <HelpLink surface="formal" contextual />
        </div>
      </div>
    </AuthCanvas>
  );
}
