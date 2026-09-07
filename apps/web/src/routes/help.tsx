// SPDX-License-Identifier: AGPL-3.0-only

/** DD-020 preserves the authenticated shells and a public way to read Help. */
import { useEffect, useRef } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Link, Navigate, useLoaderData, useLocation } from "react-router";
import { currentUser, useSignOut } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PortalShell } from "../components/portal/portal-shell";
import { DocumentationReader } from "../components/documentation/documentation-reader";
import { PageTitle } from "../components/page-title";

export async function helpLoader() {
  return { user: await currentUser() };
}

function useHelpLocation() {
  const location = useLocation();
  const portal = location.pathname.startsWith("/portal/help");
  const suffix = location.pathname.slice(portal ? "/portal/help".length : "/help".length);
  return { portal, suffix: `${suffix}${location.search}${location.hash}` };
}

export function HelpPage() {
  const { user } = useLoaderData<typeof helpLoader>();
  const { portal, suffix } = useHelpLocation();
  const signOut = useSignOut(portal ? "/portal/enter" : "/auth/login");
  // Keep the fragment in the component. Loader Requests do not retain it.
  if (!user) return <Navigate replace to={`/documentation${suffix}`} />;
  if (!portal && user.role === "business_user")
    return <Navigate replace to={`/portal/help${suffix}`} />;
  return portal ? (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <DocumentationReader destination="portal-help" audience="business_user" />
    </PortalShell>
  ) : (
    <AppShell user={user} onSignOut={() => void signOut()}>
      <DocumentationReader destination="staff-help" audience={user.role} />
    </AppShell>
  );
}

export function HelpErrorPage() {
  const { suffix } = useHelpLocation();
  const intl = useIntl();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <main className="mx-auto max-w-prose space-y-4 p-8">
      <PageTitle
        title={intl.formatMessage({
          id: "docs.sessionUnavailable",
          defaultMessage: "Help session unavailable",
        })}
      />
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        <FormattedMessage id="docs.sessionUnavailable" defaultMessage="Help session unavailable" />
      </h1>
      <p>
        <FormattedMessage
          id="docs.sessionUnavailableBody"
          defaultMessage="The app could not check your session. You can read the full documentation without signing in."
        />
      </p>
      <Link className="text-link underline" to={`/documentation${suffix}`}>
        <FormattedMessage id="docs.all" defaultMessage="All documentation" />
      </Link>
    </main>
  );
}
