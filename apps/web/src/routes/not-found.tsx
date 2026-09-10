// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The not-found pages. An address that names no route lands here inside
 * the chrome the visitor already has: the staff shell, the settings
 * layout, or the portal. Each page offers one way back.
 *
 * A record read that answers 404 lands on `RecordNotFoundPage` from its
 * own route. The API answers 404 for a record that does not exist and
 * for one the viewer cannot open alike (DD-013, DD-014), so the copy
 * says both and picks neither.
 *
 * Voice per DES-015: terse, second person, no apology.
 */

import type { ReactNode } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { currentUser, requireUser, useSignOut, type SessionUser } from "../lib/session";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { PortalShell } from "../components/portal/portal-shell";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";

export const NOT_FOUND_PAGE_TITLE = defineMessage({
  id: "notFound.pageTitle",
  defaultMessage: "Page not found",
});
export const NOT_FOUND_TITLE = defineMessage({
  id: "notFound.title",
  defaultMessage: "Page not found",
});
export const NOT_FOUND_BODY = defineMessage({
  id: "notFound.body",
  defaultMessage: "There is nothing at this address.",
});
export const NOT_FOUND_HOME = defineMessage({
  id: "notFound.home",
  defaultMessage: "Back to Home",
});

/** What a record loader returns instead of its data when the record read answers 404. */
export interface RecordNotFound {
  notFound: true;
}

/** The body and the one way back, shared by every not-found page. */
export function NotFoundCopy({
  body,
  backTo,
  backLabel,
}: Readonly<{ body: ReactNode; backTo: string; backLabel: ReactNode }>) {
  return (
    <div className="flex max-w-prose flex-col items-start gap-4">
      <p className="text-md text-muted">{body}</p>
      <Button asChild variant="secondary">
        <Link to={backTo}>{backLabel}</Link>
      </Button>
    </div>
  );
}

/** The root splat: a signed-in staff address nothing answers to. */
export async function notFoundLoader() {
  const user = await requireUser();
  // INT-001: a signed-in Business User is always at the portal.
  if (user.role === "business_user") return redirect("/portal");
  return { user };
}

export function NotFoundPage() {
  const { user } = useLoaderData<typeof notFoundLoader>();
  const intl = useIntl();
  const signOut = useSignOut("/auth/login");
  const title = intl.formatMessage(NOT_FOUND_TITLE);
  return (
    <AppShell user={user} onSignOut={() => void signOut()} subbar={<PageSubBar title={title} />}>
      <PageTitle title={intl.formatMessage(NOT_FOUND_PAGE_TITLE)} />
      <NotFoundCopy
        body={<FormattedMessage {...NOT_FOUND_BODY} />}
        backTo="/"
        backLabel={<FormattedMessage {...NOT_FOUND_HOME} />}
      />
    </AppShell>
  );
}

/** The /settings splat: a pane address nothing answers to, drawn beside the rail. */
export function SettingsNotFoundPane() {
  const intl = useIntl();
  return (
    <>
      <PageTitle title={intl.formatMessage(NOT_FOUND_PAGE_TITLE)} />
      <h2 className="text-lg font-semibold">
        <FormattedMessage {...NOT_FOUND_TITLE} />
      </h2>
      <NotFoundCopy
        body={<FormattedMessage {...NOT_FOUND_BODY} />}
        backTo="/"
        backLabel={<FormattedMessage {...NOT_FOUND_HOME} />}
      />
    </>
  );
}

/** The /portal splat. Signed-out visitors go to the portal door, as every portal loader sends them. */
export async function portalNotFoundLoader() {
  const user = await currentUser();
  if (!user) return redirect("/portal/enter");
  return { user };
}

export function PortalNotFoundPage() {
  const { user } = useLoaderData<typeof portalNotFoundLoader>();
  const intl = useIntl();
  const signOut = useSignOut("/portal/enter");
  return (
    <PortalShell user={user} onSignOut={() => void signOut()}>
      <PageTitle title={intl.formatMessage(NOT_FOUND_PAGE_TITLE)} />
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">
          <FormattedMessage {...NOT_FOUND_TITLE} />
        </h1>
        <NotFoundCopy
          body={<FormattedMessage {...NOT_FOUND_BODY} />}
          backTo="/portal"
          backLabel={
            <FormattedMessage id="notFound.portalHome" defaultMessage="Back to the portal" />
          }
        />
      </div>
    </PortalShell>
  );
}

/** A record route's answer to a 404: the module's shell, a title, and the way back to its list. */
export function RecordNotFoundPage({
  user,
  title,
  body,
  backTo,
  backLabel,
}: Readonly<{
  user: SessionUser;
  title: string;
  body: ReactNode;
  backTo: string;
  backLabel: ReactNode;
}>) {
  const signOut = useSignOut("/auth/login");
  return (
    <AppShell user={user} onSignOut={() => void signOut()} subbar={<PageSubBar title={title} />}>
      <PageTitle title={title} />
      <NotFoundCopy body={body} backTo={backTo} backLabel={backLabel} />
    </AppShell>
  );
}
