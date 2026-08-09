// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Login (TECH-008 mode semantics): offers exactly what the public
 * discovery endpoint allows. `built_in` leads with the password form;
 * `oidc` leads with the SSO button and keeps password sign-in reachable
 * behind "Administrator sign-in" — break-glass is never hidden entirely,
 * because a dead IdP must not lock the org out. The magic-link request
 * rides its own toggle in both modes (DD-010 portal floor).
 */

import { useState, type FormEvent } from "react";
import { redirect, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { currentUser, needsSetup } from "../lib/session";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function loginLoader() {
  if (await currentUser()) return redirect("/");
  if (await needsSetup()) return redirect("/auth/setup");
  const { data, response } = await api.GET("/api/v1/auth/methods");
  if (!data) throw new Error(`The sign-in methods could not be read (${response.status}).`);
  return { methods: data };
}

type View = "password" | "sso" | "magic" | "magicSent";

export function LoginPage() {
  const { methods } = useLoaderData<typeof loginLoader>() as Exclude<
    Awaited<ReturnType<typeof loginLoader>>,
    Response
  >;
  const intl = useIntl();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // The SSO callback and magic-link verify both land back here with an
  // ?error= query when the round trip failed.
  const arrivedWithError = searchParams.get("error") !== null;

  const primaryView: View = methods.mode === "oidc" ? "sso" : "password";
  const [view, setView] = useState<View>(primaryView);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function show(next: View) {
    setError(null);
    setView(next);
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.email({
      email,
      password: String(form.get("password") ?? ""),
    });
    setBusy(false);
    if (res.error) {
      // 401 is the deliberately unrevealing wrong-credentials answer;
      // other refusals (mode closed, archived) carry their own message.
      setError(
        res.error.status === 401
          ? intl.formatMessage({
              id: "auth.login.error.invalidCredentials",
              defaultMessage: "Check your email and password.",
            })
          : (res.error.message ??
              intl.formatMessage({
                id: "auth.login.error.generic",
                defaultMessage: "Sign-in failed. Try again.",
              })),
      );
      return;
    }
    if ((res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      void navigate("/auth/two-factor");
      return;
    }
    void navigate("/");
  }

  async function submitMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { response, error: problem } = await api.POST("/api/v1/auth/magic-link", {
      body: { email },
    });
    setBusy(false);
    if (response.status === 202) {
      setView("magicSent");
      return;
    }
    setError(
      (problem as { detail?: string } | undefined)?.detail ??
        intl.formatMessage({
          id: "auth.login.error.magicLink",
          defaultMessage: "The link could not be sent. Try again.",
        }),
    );
  }

  async function startSso() {
    if (!methods.ssoProviderId) return;
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.sso({
      providerId: methods.ssoProviderId,
      callbackURL: "/",
      errorCallbackURL: "/auth/login?error=sso",
    });
    if (res.error || !res.data?.url) {
      setBusy(false);
      setError(
        res.error?.message ??
          intl.formatMessage({
            id: "auth.login.error.sso",
            defaultMessage: "Single sign-on could not start. Try again.",
          }),
      );
      return;
    }
    window.location.assign(res.data.url);
  }

  if (view === "magicSent") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <FormattedMessage id="auth.magicSent.title" defaultMessage="Check your email" />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-md text-muted">
            <FormattedMessage
              id="auth.magicSent.body"
              defaultMessage="If {email} is eligible, a sign-in link is on its way. It expires in 5 minutes and works once."
              values={{ email: <span className="text-primary">{email}</span> }}
            />
          </p>
          <Button variant="link" className="self-start" onClick={() => show(primaryView)}>
            <FormattedMessage id="auth.backToSignIn" defaultMessage="Back to sign-in" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {view === "magic" ? (
            <FormattedMessage id="auth.magic.title" defaultMessage="Get a sign-in link" />
          ) : (
            <FormattedMessage id="auth.login.title" defaultMessage="Sign in" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {arrivedWithError && (
          <Alert variant="danger">
            <FormattedMessage
              id="auth.login.error.ssoCallback"
              defaultMessage="Single sign-on failed. Try again."
            />
          </Alert>
        )}
        {error && <Alert variant="danger">{error}</Alert>}

        {view === "sso" && (
          <>
            {methods.ssoProviderId ? (
              <Button className="w-full" onClick={() => void startSso()} disabled={busy}>
                <FormattedMessage
                  id="auth.login.sso"
                  defaultMessage="Continue with single sign-on"
                />
              </Button>
            ) : (
              <Alert variant="info">
                <FormattedMessage
                  id="auth.login.ssoUnconfigured"
                  defaultMessage="Single sign-on is not configured yet. Use administrator sign-in."
                />
              </Alert>
            )}
            <div className="flex flex-col items-start gap-1">
              {methods.magicLinkEnabled && (
                <Button variant="link" onClick={() => show("magic")}>
                  <FormattedMessage
                    id="auth.login.magicLink"
                    defaultMessage="Email me a sign-in link"
                  />
                </Button>
              )}
              <Button variant="link" onClick={() => show("password")}>
                <FormattedMessage
                  id="auth.login.breakGlass"
                  defaultMessage="Administrator sign-in"
                />
              </Button>
            </div>
          </>
        )}

        {view === "password" && (
          <>
            <form className="flex flex-col gap-4" onSubmit={(e) => void submitPassword(e)}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">
                  <FormattedMessage id="auth.field.email" defaultMessage="Email" />
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">
                  <FormattedMessage id="auth.field.password" defaultMessage="Password" />
                </Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              <Button type="submit" disabled={busy}>
                <FormattedMessage id="auth.login.submit" defaultMessage="Sign in" />
              </Button>
            </form>
            <div className="flex flex-col items-start gap-1">
              {methods.mode === "built_in" && methods.magicLinkEnabled && (
                <Button variant="link" onClick={() => show("magic")}>
                  <FormattedMessage
                    id="auth.login.magicLink"
                    defaultMessage="Email me a sign-in link"
                  />
                </Button>
              )}
              {methods.mode === "oidc" && (
                <Button variant="link" onClick={() => show("sso")}>
                  <FormattedMessage id="auth.login.backToSso" defaultMessage="Back" />
                </Button>
              )}
            </div>
          </>
        )}

        {view === "magic" && (
          <>
            <p className="text-md text-muted">
              <FormattedMessage
                id="auth.magic.body"
                defaultMessage="Enter your work email to get a single-use sign-in link."
              />
            </p>
            <form className="flex flex-col gap-4" onSubmit={(e) => void submitMagicLink(e)}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="magic-email">
                  <FormattedMessage id="auth.field.email" defaultMessage="Email" />
                </Label>
                <Input
                  id="magic-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={busy}>
                <FormattedMessage id="auth.magic.submit" defaultMessage="Send link" />
              </Button>
            </form>
            <Button variant="link" className="self-start" onClick={() => show(primaryView)}>
              <FormattedMessage id="auth.backToSignIn" defaultMessage="Back to sign-in" />
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
