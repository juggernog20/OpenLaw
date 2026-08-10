// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Guarded landing page inside the application shell (M4). The page
 * body stays a placeholder — dashboards arrive in M29 — but the chrome
 * around it is the real shell: header, nav, sub-bar. The account
 * surfaces auth needs (sign out, two-factor enrolment) live in the
 * header user menu.
 */

import { redirect, useNavigate, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { currentUser, needsSetup } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { PageTitle } from "../components/page-title";

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
  // SET-004: the wizard runs on first Administrator login — any admin
  // landing here while onboarding is open belongs there instead. A
  // failed status read deliberately falls through to home: the wizard
  // is a convenience, and it must never make home unreachable.
  if (user.role === "administrator") {
    const { data } = await api.GET("/api/v1/onboarding");
    if (data && !data.completed) return redirect("/welcome");
  }
  return { user };
}

export function HomePage() {
  const { user } = useLoaderData<typeof homeLoader>();
  const intl = useIntl();
  const navigate = useNavigate();

  async function signOut() {
    await authClient.signOut();
    void navigate("/auth/login", { replace: true });
  }

  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
      subbar={<PageSubBar title={<FormattedMessage id="home.title" defaultMessage="Home" />} />}
    >
      <PageTitle title={intl.formatMessage({ id: "home.title", defaultMessage: "Home" })} />
      <p className="text-muted">
        <FormattedMessage
          id="home.placeholder"
          defaultMessage="Modules arrive with their own builds."
        />
      </p>
    </AppShell>
  );
}
