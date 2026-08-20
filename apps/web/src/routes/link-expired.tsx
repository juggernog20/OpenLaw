// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where a failed magic-link redemption lands: the verify endpoint
 * redirects to "/" with an ?error= query, and the root guard forwards
 * that here. Tokens are single-use with a 5-minute life, so "expired or
 * already used" covers every variant.
 *
 * The page offers the fresh link itself (#376) rather than sending the
 * reader back to a sign-in screen for it. A Business User arrives here
 * from a stale email with no account and no password, and the sign-in
 * screen is not their surface — the one thing they need is another link,
 * so the one thing this page asks for is the address to send it to.
 * When the Administrator's magic-link toggle is off (or the instance
 * cannot send mail) there is no fresh link to offer, and the page falls
 * back to pointing at sign-in.
 */

import { Link, useLoaderData } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { MagicLinkRequest } from "../components/magic-link-request";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

const TITLES = defineMessages({
  expired: { id: "auth.linkExpired.title", defaultMessage: "Sign-in link expired" },
});

export async function linkExpiredLoader() {
  const { data, response } = await api.GET("/api/v1/auth/methods");
  if (!data) throw new Error(`The sign-in methods could not be read (${response.status}).`);
  return { methods: data };
}

export function LinkExpiredPage() {
  const { methods } = useLoaderData<typeof linkExpiredLoader>();
  const intl = useIntl();

  if (methods.magicLinkEnabled && methods.emailConfigured) {
    return (
      <MagicLinkRequest
        title={TITLES.expired}
        description={
          <FormattedMessage
            id="auth.linkExpired.retry"
            defaultMessage="The link has expired or was already used. Enter your email to get a fresh one."
          />
        }
      />
    );
  }

  return (
    <Card>
      <PageTitle title={intl.formatMessage(TITLES.expired)} />
      <CardHeader>
        <CardTitle>
          <FormattedMessage {...TITLES.expired} />
        </CardTitle>
        <CardDescription>
          <FormattedMessage
            id="auth.linkExpired.body"
            defaultMessage="The link has expired or was already used. Request a new one from the sign-in page."
          />
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/auth/login">
            <FormattedMessage id="auth.backToSignIn" defaultMessage="Back to sign-in" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
