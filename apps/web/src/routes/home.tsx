// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Guarded landing page. Deliberately a placeholder — the application
 * shell arrives with the first module build; what matters here is the
 * guard (loader) and the session-holding surfaces auth itself needs:
 * who is signed in, sign out, and the two-factor enrolment entry point.
 */

import { Link, redirect, useNavigate, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { FormattedMessage } from "react-intl";
import { authClient } from "../lib/auth-client";
import { currentUser, needsSetup } from "../lib/session";
import { SkipLink } from "../components/skip-link";
import { Button } from "../components/ui/button";

export async function homeLoader({ request }: LoaderFunctionArgs) {
  // A failed magic-link redemption redirects here with an ?error= query
  // (the verify endpoint's callback URL is "/"). Forward it to the
  // expired-link page before the session check can bounce it to login.
  if (new URL(request.url).searchParams.get("error") !== null) {
    return redirect("/auth/link-expired");
  }
  const user = await currentUser();
  if (!user) {
    return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  }
  return { user };
}

export function HomePage() {
  const { user } = useLoaderData<typeof homeLoader>() as Exclude<
    Awaited<ReturnType<typeof homeLoader>>,
    Response
  >;
  const navigate = useNavigate();

  async function signOut() {
    await authClient.signOut();
    void navigate("/auth/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-canvas text-primary">
      <SkipLink />
      <header className="flex h-(--height-header) items-center justify-between bg-inverted px-page-x text-on-inverted">
        <span className="text-md font-semibold">OpenLaw</span>
        <div className="flex items-center gap-4">
          <span className="text-sm">{user.displayName}</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-on-inverted hover:bg-inverted hover:brightness-125"
            onClick={() => void signOut()}
          >
            <FormattedMessage id="auth.signOut" defaultMessage="Sign out" />
          </Button>
        </div>
      </header>
      <main id="main" className="px-page-x py-page-y">
        <h1 className="text-2xl font-semibold">
          <FormattedMessage id="home.title" defaultMessage="Home" />
        </h1>
        <p className="mt-2 text-muted">
          <FormattedMessage
            id="home.placeholder"
            defaultMessage="Modules arrive with their own builds. Account surfaces available now:"
          />
        </p>
        <div className="mt-4">
          <Button asChild variant="secondary">
            <Link to="/auth/two-factor/enroll">
              <FormattedMessage
                id="home.twoFactorLink"
                defaultMessage="Two-factor authentication"
              />
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
