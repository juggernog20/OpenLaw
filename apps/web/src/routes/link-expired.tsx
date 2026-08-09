// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where a failed magic-link redemption lands: the verify endpoint
 * redirects to "/" with an ?error= query, and the root guard forwards
 * that here. Tokens are single-use with a 5-minute life, so "expired or
 * already used" covers every variant.
 */

import { Link } from "react-router";
import { FormattedMessage } from "react-intl";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

export function LinkExpiredPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <FormattedMessage id="auth.linkExpired.title" defaultMessage="Sign-in link expired" />
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
