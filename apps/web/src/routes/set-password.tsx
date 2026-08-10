// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Set-password activation: the landing page for invite emails and
 * forgotten-password resets alike (both ride the reset-password flow,
 * TECH-008). The token arrives in the query string and is posted to
 * better-auth's reset endpoint; it proves inbox control, so no session
 * is required here.
 */

import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { authClient } from "../lib/auth-client";
import { networkError } from "../lib/messages";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { PageTitle } from "../components/page-title";

export function SetPasswordPage() {
  const intl = useIntl();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password") ?? "");
    if (newPassword !== String(form.get("confirm") ?? "")) {
      setError(
        intl.formatMessage({
          id: "auth.setPassword.error.mismatch",
          defaultMessage: "The passwords do not match.",
        }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.resetPassword({ newPassword, token });
      if (res.error) {
        // Only a dead token gets the expired copy; anything else (e.g. a
        // password the server refuses) explains itself.
        setError(
          res.error.code === "INVALID_TOKEN"
            ? intl.formatMessage({
                id: "auth.setPassword.error.token",
                defaultMessage: "This link has expired or was already used. Ask for a new one.",
              })
            : (res.error.message ??
                intl.formatMessage({
                  id: "auth.setPassword.error.generic",
                  defaultMessage: "The password could not be set. Try again.",
                })),
        );
        return;
      }
      setDone(true);
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  const pageTitle = (
    <PageTitle
      title={intl.formatMessage({
        id: "auth.setPassword.title",
        defaultMessage: "Set your password",
      })}
    />
  );

  if (done) {
    return (
      <Card>
        {pageTitle}
        <CardHeader>
          <CardTitle>
            <FormattedMessage id="auth.setPassword.doneTitle" defaultMessage="Password set" />
          </CardTitle>
          <CardDescription>
            <FormattedMessage
              id="auth.setPassword.doneBody"
              defaultMessage="Sign in with your new password."
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
    );
  }

  return (
    <Card>
      {pageTitle}
      <CardHeader>
        <CardTitle>
          <FormattedMessage id="auth.setPassword.title" defaultMessage="Set your password" />
        </CardTitle>
        <CardDescription>
          <FormattedMessage id="auth.setPassword.hint" defaultMessage="At least 8 characters." />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!token && (
          <Alert variant="danger">
            <FormattedMessage
              id="auth.setPassword.error.missingToken"
              defaultMessage="This link is not valid. Ask for a new invitation or password reset."
            />
          </Alert>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">
              <FormattedMessage id="auth.setPassword.newPassword" defaultMessage="New password" />
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              disabled={!token}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm">
              <FormattedMessage
                id="auth.setPassword.confirmPassword"
                defaultMessage="Confirm password"
              />
            </Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              disabled={!token}
            />
          </div>
          <Button type="submit" disabled={busy || !token}>
            <FormattedMessage id="auth.setPassword.submit" defaultMessage="Set password" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
