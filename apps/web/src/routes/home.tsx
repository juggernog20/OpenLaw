// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The guarded staff landing page and M29 personal state summary.
 */

import { useEffect, useState } from "react";
import {
  redirect,
  useLoaderData,
  useLocation,
  useRevalidator,
  type LoaderFunctionArgs,
} from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { requireUser, useSignOut } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { PageTitle } from "../components/page-title";
import { HomeApprovalsCard } from "../components/home/approvals-card";
import { HomeTasksCard } from "../components/home/tasks-card";
import { HomeDatesCard } from "../components/home/dates-card";
import { HomeInboxCard } from "../components/home/inbox-card";
import { HomeObligationsCard } from "../components/home/obligations-card";
import { HomeWelcomeCard } from "../components/home/welcome-card";
import { HomeContractsCard } from "../components/home/contracts-card";
import { HomeMattersCard } from "../components/home/matters-card";
import { subscribeLiveEvents } from "../lib/events";

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
  const { user, sections: loadedSections } = useLoaderData<typeof homeLoader>();
  const [inboxPatch, setInboxPatch] = useState<{
    locationKey: string;
    total: number;
  } | null>(null);
  const location = useLocation();
  const { revalidate } = useRevalidator();
  const intl = useIntl();

  const signOut = useSignOut("/auth/login");

  // A patch belongs to the navigation that drew its card. A reconnect
  // read keeps that identity, so a newer frame can win if it lands while
  // the read is in flight. A real navigation gets a new key and its own
  // loader answer.
  const sections =
    inboxPatch?.locationKey === location.key
      ? loadedSections.map((section) =>
          section.type === "inbox" ? { ...section, total: inboxPatch.total } : section,
        )
      : loadedSections;
  useEffect(
    () =>
      subscribeLiveEvents((event) => {
        if (event.kind === "open") {
          // The read starts after the last known live fact. A frame that
          // follows this point is newer and stays over its answer.
          setInboxPatch(null);
          void revalidate();
          return;
        }
        if (event.kind !== "inbox") return;
        if (!loadedSections.some((section) => section.type === "inbox")) return;
        setInboxPatch({ locationKey: location.key, total: event.total });
      }),
    [loadedSections, location.key, revalidate],
  );

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
              case "dates":
                return <HomeDatesCard key={section.type} section={section} />;
              case "obligations":
                return <HomeObligationsCard key={section.type} section={section} />;
              case "inbox":
                return <HomeInboxCard key={section.type} section={section} />;
              case "contracts":
                return <HomeContractsCard key={section.type} section={section} />;
              case "matters":
                return <HomeMattersCard key={section.type} section={section} />;
            }
          })}
        </div>
      )}
    </AppShell>
  );
}
