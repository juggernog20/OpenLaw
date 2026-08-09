// SPDX-License-Identifier: AGPL-3.0-only

/**
 * First-run setup: creates the initial Administrator while the instance
 * is empty. The server holds the real invariant (advisory-locked,
 * answers 409 forever after); this screen just fronts it and gets out
 * of the way once a user exists.
 */

import { useState, type FormEvent } from "react";
import { Link, redirect, useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { networkError } from "../lib/messages";
import { needsSetup } from "../lib/session";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function setupLoader() {
  if (!(await needsSetup())) return redirect("/auth/login");
  return null;
}

export function SetupPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
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
      const { response, error: problem } = await api.POST("/api/v1/auth/setup", {
        body: {
          email: String(form.get("email") ?? ""),
          displayName: String(form.get("displayName") ?? ""),
          password,
        },
      });
      if (response.status === 201) {
        // The response set the session cookie; land signed in.
        void navigate("/");
        return;
      }
      if (response.status === 409) {
        setAlreadyDone(true);
        return;
      }
      setError(
        (problem as { detail?: string } | undefined)?.detail ??
          intl.formatMessage({
            id: "auth.setup.error.generic",
            defaultMessage: "Setup failed. Try again.",
          }),
      );
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <FormattedMessage id="auth.setup.title" defaultMessage="Set up OpenLaw" />
        </CardTitle>
        <CardDescription>
          <FormattedMessage
            id="auth.setup.hint"
            defaultMessage="Create the first Administrator account. This screen disables itself once a user exists."
          />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {alreadyDone && (
          <Alert variant="info">
            <FormattedMessage
              id="auth.setup.alreadyDone"
              defaultMessage="Setup has already been completed."
            />{" "}
            <Link className="text-link underline-offset-4 hover:underline" to="/auth/login">
              <FormattedMessage id="auth.login.title" defaultMessage="Sign in" />
            </Link>
          </Alert>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName">
              <FormattedMessage id="auth.field.displayName" defaultMessage="Name" />
            </Label>
            <Input id="displayName" name="displayName" autoComplete="name" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">
              <FormattedMessage id="auth.field.email" defaultMessage="Email" />
            </Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">
              <FormattedMessage id="auth.field.password" defaultMessage="Password" />
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
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
            />
          </div>
          <Button type="submit" disabled={busy || alreadyDone}>
            <FormattedMessage id="auth.setup.submit" defaultMessage="Create Administrator" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
