// SPDX-License-Identifier: AGPL-3.0-only

/**
 * TECH-008 recovery for expired or spent magic links. The originating sign-in
 * group controls whether a fresh link is offered and its return destination.
 */

import { Link, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { MagicLinkRequest } from "../components/magic-link-request";
import { PageTitle } from "../components/page-title";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

const TITLES = defineMessages({
  expired: { id: "auth.linkExpired.title", defaultMessage: "Sign-in link expired" },
});

export async function linkExpiredLoader({ request }: LoaderFunctionArgs) {
  const group: "legal" | "business" =
    new URL(request.url).searchParams.get("portal") === "1" ? "business" : "legal";
  const { data, response } = await api.GET("/api/v1/auth/methods");
  if (!data) throw new Error(`The sign-in methods could not be read (${response.status}).`);
  return { methods: data, group };
}

export function LinkExpiredPage() {
  const { methods, group } = useLoaderData<typeof linkExpiredLoader>();
  const intl = useIntl();

  if (methods.policy[group].magicLink && methods.emailConfigured) {
    return (
      <MagicLinkRequest
        group={group}
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
          <Link to={group === "business" ? "/portal/login" : "/auth/login"}>
            <FormattedMessage id="auth.backToSignIn" defaultMessage="Back to sign-in" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
