// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Portal entry screen (INT-001, DD-010): the front door for a
 * Business User who has no account and no password. A work address in,
 * a single-use link out, and the same answer whether or not the domain
 * is on the Administrator's allowlist.
 *
 * The email step appears only when the deployment can actually send the
 * link — the Administrator's magic-link toggle says the org wants the
 * portal floor, and `emailConfigured` says the instance can deliver it.
 * With either off there is no floor to offer, so the screen says so and
 * points at the organization's own sign-in instead of leaving a dead
 * affordance on the page.
 */

import { redirect, useLoaderData, Link } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { currentUser } from "../lib/session";
import { AuthLayout } from "./auth-layout";
import { MagicLinkRequest } from "../components/magic-link-request";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

const TITLES = defineMessages({
  entry: { id: "portal.entry.title", defaultMessage: "Legal request portal" },
});

export async function portalEntryLoader() {
  // A session holder has no business on the door: send them inside.
  if (await currentUser()) return redirect("/portal");
  const { data, response } = await api.GET("/api/v1/auth/methods");
  if (!data) throw new Error(`The sign-in methods could not be read (${response.status}).`);
  return { methods: data };
}

export function PortalEntryPage() {
  const { methods } = useLoaderData<typeof portalEntryLoader>();
  const intl = useIntl();

  if (methods.magicLinkEnabled && methods.emailConfigured) {
    return (
      <AuthLayout>
        <MagicLinkRequest
          title={TITLES.entry}
          description={
            <FormattedMessage
              id="portal.entry.lead"
              defaultMessage="Enter your work email to get a single-use link into the portal. No account and no password."
            />
          }
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card>
        <PageTitle title={intl.formatMessage(TITLES.entry)} />
        <CardHeader>
          <CardTitle>
            <FormattedMessage {...TITLES.entry} />
          </CardTitle>
          <CardDescription>
            <FormattedMessage
              id="portal.entry.closed"
              defaultMessage="Sign-in links are switched off. Use your organization's sign-in to reach the portal."
            />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/auth/login">
              <FormattedMessage id="auth.login.title" defaultMessage="Sign in" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
