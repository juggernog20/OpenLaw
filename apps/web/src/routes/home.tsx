// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The guarded staff landing page and M29 personal state summary.
 */

import { redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { requireUser, useSignOut } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { PageTitle } from "../components/page-title";
import { HomeApprovalsCard } from "../components/home/approvals-card";
import { HomeTasksCard } from "../components/home/tasks-card";
import { HomeWelcomeCard } from "../components/home/welcome-card";

export async function homeLoader({ request }: LoaderFunctionArgs) {
  // A failed magic-link redemption redirects here with an ?error= query
  // (the verify endpoint's callback URL is "/"). Forward it to the
  // expired-link page before the session check can bounce it to login.
  if (new URL(request.url).searchParams.get("error") !== null) {
    return redirect("/auth/link-expired");
  }
  const user = await requireUser();
  // Role-based landing (INT-001, #376): the portal is a Business User's
  // whole surface, so the staff application's front door forwards them
  // to it. This is also where a redeemed magic link lands — the verify
  // endpoint's callback is "/" — which is what puts a requester in the
  // portal without the issuance API having to know about the portal at
  // all, and keeps a staff break-glass link landing in the staff app.
  // Every staff destination bounces here when its role floor refuses, so
  // this one redirect covers the whole tree.
  if (user.role === "business_user") return redirect("/portal");
  // SET-004: the wizard runs on first Administrator login — any admin
  // landing here while onboarding is open belongs there instead. A
  // failed status read deliberately falls through to home: the wizard
  // is a convenience, and it must never make home unreachable.
  if (user.role === "administrator") {
    const { data } = await api.GET("/api/v1/onboarding");
    if (data && !data.completed) return redirect("/welcome");
  }
  const home = await api.GET("/api/v1/home");
  if (!home.data) throw new Error("Home could not be read.");
  return { user, sections: home.data.sections };
}

export function HomePage() {
  const { user, sections } = useLoaderData<typeof homeLoader>();
  const intl = useIntl();

  const signOut = useSignOut("/auth/login");

  return (
    <AppShell
      user={user}
      onSignOut={() => void signOut()}
      subbar={<PageSubBar title={<FormattedMessage id="home.title" defaultMessage="Home" />} />}
    >
      <PageTitle title={intl.formatMessage({ id: "home.title", defaultMessage: "Home" })} />
      {sections.length === 0 ? (
        <HomeWelcomeCard role={user.role} />
      ) : (
        <div className="grid grid-cols-1 gap-4 @4xl/page:grid-cols-2">
          {sections.map((section) => {
            switch (section.type) {
              case "approvals":
                return <HomeApprovalsCard key={section.type} section={section} />;
              case "tasks":
                return <HomeTasksCard key={section.type} section={section} />;
            }
          })}
        </div>
      )}
    </AppShell>
  );
}
