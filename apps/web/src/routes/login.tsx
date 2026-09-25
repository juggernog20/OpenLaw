// SPDX-License-Identifier: AGPL-3.0-only

/** Separate Legal User and Business Portal URLs share the configured sign-in methods (TECH-008). */

import { useState, type SubmitEvent as FormSubmitEvent } from "react";
import {
  redirect,
  redirectDocument,
  Link,
  useLoaderData,
  useNavigate,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import { defineMessages, FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { oauthAuthorizeReturn, oauthLoginSearch } from "../lib/oauth-return";
import { api } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { field } from "../lib/forms";
import { networkError } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { PageTitle } from "../components/page-title";

const PAGE_TITLES: Record<"login" | "magic" | "magicSent", MessageDescriptor> = defineMessages({
  login: { id: "auth.login.title", defaultMessage: "Sign in" },
  magic: { id: "auth.magic.title", defaultMessage: "Get a sign-in link" },
  magicSent: { id: "auth.magicSent.title", defaultMessage: "Check your email" },
});

export async function loginLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const group: "legal" | "business" =
    url.pathname.replace(/\/+$/, "") === "/portal/login" ? "business" : "legal";
  const oauthSearch = oauthLoginSearch(url.search);
  const oauthReturn = oauthAuthorizeReturn(oauthSearch);
  const loginURL = `${group === "business" ? "/portal/login" : "/auth/login"}${oauthReturn ? oauthSearch : ""}`;
  if (url.searchParams.get("error") === "INVALID_TOKEN")
    return redirect(`/auth/link-expired${group === "business" ? "?portal=1" : ""}`);
  let user;
  try {
    user = await currentUser();
  } catch (error) {
    if (oauthReturn && error instanceof Response) {
      const target = error.headers.get("Location");
      if (target?.startsWith("/auth/two-factor")) {
        const destination = new URL(target, url.origin);
        destination.searchParams.set("oauth_query", oauthSearch.slice(1));
        throw redirect(destination.pathname + destination.search);
      }
    }
    throw error;
  }
  if (user && oauthReturn) return redirectDocument(oauthReturn);
  if (user)
    return redirect(user.role === "business_user" || group === "business" ? "/portal" : "/");
  if (await needsSetup()) return redirect("/auth/setup");
  const { data, response } = await api.GET("/api/v1/auth/methods");
  if (!data) throw new Error(`The sign-in methods could not be read (${response.status}).`);
  return { methods: data, group, oauthReturn, loginURL };
}

type View =
  "unavailable" | "password" | "sso" | "magic" | "magicSent" | "passwordSetup" | "passwordSent";

export function LoginPage() {
  const { methods, group, oauthReturn, loginURL } = useLoaderData<typeof loginLoader>() as Exclude<
    Awaited<ReturnType<typeof loginLoader>>,
    Response
  >;
  const intl = useIntl();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // The SSO callback and magic-link verify both land back here with an
  // ?error= query when the round trip failed.
  const arrivedWithError = searchParams.get("error") !== null;

  const options = methods.policy[group];
  const magicLinkOffered = options.magicLink && methods.emailConfigured;
  const initialView = (target: "legal" | "business"): View => {
    const policy = methods.policy[target];
    return policy.sso
      ? "sso"
      : policy.password
        ? "password"
        : policy.magicLink && methods.emailConfigured
          ? "magic"
          : "unavailable";
  };
  const primaryView = initialView(group);
  const [view, setView] = useState<View>(primaryView);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function show(next: View) {
    setError(null);
    setView(next);
  }

  async function submitPassword(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.signIn.email({
        email,
        password: field(form, "password"),
      });
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
        const destination = new URL("/auth/two-factor", window.location.origin);
        if (group === "business") destination.searchParams.set("portal", "1");
        if (oauthReturn)
          destination.searchParams.set(
            "oauth_query",
            new URL(loginURL, window.location.origin).search.slice(1),
          );
        void navigate(destination.pathname + destination.search);
        return;
      }
      if (oauthReturn) {
        // Re-enter the loader so required second-factor setup keeps its return too.
        void navigate(loginURL, { replace: true });
        return;
      }
      const signedInUser = (res.data as { user?: { role?: string } } | null)?.user;
      void navigate(
        signedInUser?.role === "business_user" || group === "business" ? "/portal" : "/",
        { replace: true },
      );
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  async function submitMagicLink(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { response, error: problem } = await api.POST("/api/v1/auth/magic-link", {
        body: { email, group, ...(oauthReturn ? { callbackURL: loginURL } : {}) },
      });
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
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  async function requestPassword(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.POST("/api/v1/auth/password-setup", { body: { email } });
      if (result.response.status === 202) setView("passwordSent");
      else setError(result.error?.detail ?? networkError(intl));
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  async function startSso() {
    if (!methods.ssoProviderId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.signIn.sso({
        providerId: methods.ssoProviderId,
        callbackURL: oauthReturn ? loginURL : group === "business" ? "/portal" : "/",
        errorCallbackURL: `${loginURL}${oauthReturn ? "&" : "?"}error=sso`,
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
      // busy stays set on purpose: the browser is leaving for the IdP.
      window.location.assign(res.data.url);
    } catch {
      setBusy(false);
      setError(networkError(intl));
    }
  }

  // The magic-link views swap the visible heading; the document
  // title follows it (DES-011).
  const pageTitleKey = view === "magicSent" || view === "magic" ? view : "login";
  const pageTitle = (
    <PageTitle
      title={intl.formatMessage(
        group === "business" && pageTitleKey === "login"
          ? { id: "auth.portalLogin.title", defaultMessage: "Business Portal sign-in" }
          : PAGE_TITLES[pageTitleKey],
      )}
    />
  );

  if (view === "magicSent" || view === "passwordSent") {
    return (
      <Card>
        {pageTitle}
        <CardHeader>
          <CardTitle>
            <FormattedMessage id="auth.magicSent.title" defaultMessage="Check your email" />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-md text-muted">
            {view === "passwordSent" ? (
              <FormattedMessage
                id="auth.passwordSetup.sent"
                defaultMessage="If your email address is eligible, a password setup link is on its way. It expires in one hour."
              />
            ) : (
              <FormattedMessage
                id="auth.magicSent.body"
                defaultMessage="If {email} is eligible, a sign-in link is on its way. It expires in 5 minutes and works once."
                values={{ email: <span className="text-primary">{email}</span> }}
              />
            )}
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
      {pageTitle}
      <CardHeader>
        <CardTitle>
          {view === "magic" ? (
            <FormattedMessage id="auth.magic.title" defaultMessage="Get a sign-in link" />
          ) : group === "business" ? (
            <FormattedMessage
              id="auth.portalLogin.title"
              defaultMessage="Business Portal sign-in"
            />
          ) : (
            <FormattedMessage id="auth.login.title" defaultMessage="Sign in" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view === "unavailable" && (
          <Alert variant="danger">
            <FormattedMessage
              id="auth.login.unavailable"
              defaultMessage="Sign-in is unavailable. Contact your administrator."
            />
          </Alert>
        )}
        {view === "passwordSetup" && (
          <form className="flex flex-col gap-4" onSubmit={(event) => void requestPassword(event)}>
            <Label htmlFor="setup-email">
              <FormattedMessage id="auth.field.email" defaultMessage="Email" />
            </Label>
            <Input
              id="setup-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button disabled={busy} type="submit">
              <FormattedMessage
                id="auth.passwordSetup.send"
                defaultMessage="Send password setup link"
              />
            </Button>
            <Button type="button" variant="link" onClick={() => show(primaryView)}>
              <FormattedMessage id="auth.backToSignIn" defaultMessage="Back to sign-in" />
            </Button>
          </form>
        )}
        {arrivedWithError && (
          <Alert variant="danger">
            {searchParams.get("method") === "magic-link" || searchParams.get("error") === "link" ? (
              <FormattedMessage
                id="auth.login.error.linkCallback"
                defaultMessage="This sign-in link could not be used. Request a new link or contact your administrator."
              />
            ) : (
              <FormattedMessage
                id="auth.login.error.ssoCallback"
                defaultMessage="Single sign-on failed. Try again."
              />
            )}
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
              {magicLinkOffered && (
                <Button variant="link" onClick={() => show("magic")}>
                  <FormattedMessage
                    id="auth.login.magicLink"
                    defaultMessage="Email me a sign-in link"
                  />
                </Button>
              )}
              {(options.password || group === "legal") && (
                <Button variant="link" onClick={() => show("password")}>
                  {options.password ? (
                    <FormattedMessage
                      id="auth.login.withPassword"
                      defaultMessage="Sign in with a password"
                    />
                  ) : (
                    <FormattedMessage
                      id="auth.login.breakGlass"
                      defaultMessage="Administrator sign-in"
                    />
                  )}
                </Button>
              )}
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
              {methods.emailConfigured && (
                <Button variant="link" onClick={() => show("passwordSetup")}>
                  <FormattedMessage
                    id="auth.passwordSetup.open"
                    defaultMessage="Set up or reset your password"
                  />
                </Button>
              )}
              {magicLinkOffered && (
                <Button variant="link" onClick={() => show("magic")}>
                  <FormattedMessage
                    id="auth.login.magicLink"
                    defaultMessage="Email me a sign-in link"
                  />
                </Button>
              )}
              {options.sso && (
                <Button variant="link" onClick={() => show("sso")}>
                  <FormattedMessage
                    id="auth.login.sso"
                    defaultMessage="Continue with single sign-on"
                  />
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
            {options.password && (
              <Button variant="link" onClick={() => show("password")}>
                <FormattedMessage
                  id="auth.login.withPassword"
                  defaultMessage="Sign in with a password"
                />
              </Button>
            )}
            {group === "legal" && !options.password && (
              <Button variant="link" onClick={() => show("password")}>
                <FormattedMessage
                  id="auth.login.breakGlass"
                  defaultMessage="Administrator sign-in"
                />
              </Button>
            )}
            <Button variant="link" className="self-start" onClick={() => show(primaryView)}>
              <FormattedMessage id="auth.backToSignIn" defaultMessage="Back to sign-in" />
            </Button>
          </>
        )}
        {oauthReturn && (
          <Link
            className="text-sm text-link underline"
            to={`${group === "legal" ? "/portal/login" : "/auth/login"}${new URL(loginURL, window.location.origin).search}`}
          >
            {group === "legal" ? (
              <FormattedMessage
                id="auth.portalLogin.title"
                defaultMessage="Business Portal sign-in"
              />
            ) : (
              <FormattedMessage id="auth.legalLogin" defaultMessage="Legal User sign-in" />
            )}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
