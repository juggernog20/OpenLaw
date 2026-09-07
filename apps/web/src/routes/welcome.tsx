// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Welcome to OpenLaw", the SET-004 first-run onboarding wizard,
 * scoped to the steps whose features exist (issue #34): authentication
 * mode, the DD-010 portal (magic-link toggle plus domain allowlist),
 * SMTP setup (#37: save a relay in the app unless the environment pins
 * one; env always wins), and invites. Every step is skippable. Finishing
 * or skipping out marks onboarding complete, and a completed wizard
 * never shows again.
 */

import { HelpLink } from "../components/documentation/help-link";
import { useState, type ReactNode, type SubmitEvent as FormSubmitEvent } from "react";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import { api } from "../lib/api";
import { field } from "../lib/forms";
import { networkError } from "../lib/messages";
import { problem as readProblem } from "../lib/problem";
import { ROLE_MESSAGES } from "../lib/roles";
import { requireUser } from "../lib/session";
import { cn } from "../lib/utils";
import { PageTitle } from "../components/page-title";
import { SkipLink } from "../components/skip-link";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function welcomeLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/");
  // Completion decides the redirect before anything else is fetched.
  // Most visits to this loader are bounces off a finished instance.
  const onboarding = await api.GET("/api/v1/onboarding");
  if (!onboarding.data) throw new Error("The onboarding state could not be read.");
  if (onboarding.data.completed) return redirect("/");
  const [methods, domains, email] = await Promise.all([
    api.GET("/api/v1/auth/methods"),
    api.GET("/api/v1/auth/allowed-domains"),
    api.GET("/api/v1/email-settings"),
  ]);
  if (!methods.data || !domains.data || !email.data) {
    throw new Error("The onboarding state could not be read.");
  }
  return {
    emailConfigured: onboarding.data.emailConfigured,
    methods: methods.data,
    domains: domains.data.domains,
    emailSettings: email.data,
  };
}

const STEPS = ["welcome", "authentication", "portal", "email", "invites"] as const;
type Step = (typeof STEPS)[number];

const INVITE_ROLES = ["legal_team_member", "contributor", "administrator"] as const;
type InviteRole = (typeof INVITE_ROLES)[number];

/** Selectable option row (aria-pressed carries the state for readers). */
function OptionButton(
  props: Readonly<{
    selected: boolean;
    onClick: () => void;
    title: ReactNode;
    description: ReactNode;
  }>,
) {
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onClick}
      className={cn(
        "rounded-card border bg-raised p-4 text-start focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link",
        props.selected ? "border-link" : "border-border-default hover:bg-control",
      )}
    >
      <span className="block text-md font-medium text-primary">{props.title}</span>
      <span className="mt-1 block text-sm text-muted">{props.description}</span>
    </button>
  );
}

export function WelcomePage() {
  const loaded = useLoaderData<typeof welcomeLoader>() as Exclude<
    Awaited<ReturnType<typeof welcomeLoader>>,
    Response
  >;
  const intl = useIntl();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("welcome");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Authentication step.
  // What the server holds right now. Starts from the loader and moves
  // only when a save lands, so a step revisit compares against the
  // saved answer and not the loader's stale copy.
  const [savedMethods, setSavedMethods] = useState(loaded.methods);
  const [mode, setMode] = useState(loaded.methods.mode);
  const [ssoProviderId, setSsoProviderId] = useState(loaded.methods.ssoProviderId);
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);

  // Portal step.
  const [magicLinkEnabled, setMagicLinkEnabled] = useState(loaded.methods.magicLinkEnabled);
  const [domains, setDomains] = useState<string[]>(loaded.domains);
  const [domainInput, setDomainInput] = useState("");

  // Email step (#37): the resolved SMTP state drives which of the three
  // faces shows: set by environment (read-only), set in the app, or a
  // setup form. Saves update it in place, so the step and the invites
  // warning track what the instance can deliver.
  const [emailState, setEmailState] = useState(loaded.emailSettings);
  const [emailConfigured, setEmailConfigured] = useState(loaded.emailConfigured);
  const [replacingRelay, setReplacingRelay] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

  // Invites step.
  const [inviteRole, setInviteRole] = useState<InviteRole>("legal_team_member");
  const [invited, setInvited] = useState<string[]>([]);

  const stepIndex = STEPS.indexOf(step);

  function goTo(next: Step) {
    setError(null);
    setEmailNotice(null);
    setStep(next);
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      const { response } = await api.POST("/api/v1/onboarding/complete");
      if (response.ok) {
        void navigate("/", { replace: true });
        return;
      }
      setError(
        intl.formatMessage({
          id: "welcome.error.complete",
          defaultMessage: "Onboarding could not be marked finished. Try again.",
        }),
      );
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  async function registerProvider(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await api.POST("/api/v1/auth/sso-providers", {
        body: {
          providerId: field(form, "providerId"),
          issuer: field(form, "issuer"),
          domain: field(form, "idpDomain"),
          clientId: field(form, "clientId"),
          clientSecret: field(form, "clientSecret"),
        },
      });
      const { data } = result;
      if (data) {
        setSsoProviderId(data.provider.providerId);
        setCallbackUrl(data.callbackUrl);
        return;
      }
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "welcome.auth.error.register",
            defaultMessage: "The identity provider could not be registered.",
          }),
      );
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  async function applyAuthentication() {
    // Switching to OIDC without a registered IdP would leave everyone but
    // Administrators without a sign-in method. Refuse client-side.
    if (mode === "oidc" && !ssoProviderId) {
      setError(
        intl.formatMessage({
          id: "welcome.auth.error.noProvider",
          defaultMessage: "Register an identity provider before switching to single sign-on.",
        }),
      );
      return;
    }
    if (mode === savedMethods.mode) {
      goTo("portal");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.PATCH("/api/v1/auth/mode", { body: { mode } });
      const { data } = result;
      if (data) {
        setSavedMethods((current) => ({ ...current, mode: data.mode }));
        goTo("portal");
        return;
      }
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "welcome.auth.error.mode",
            defaultMessage: "The authentication mode could not be saved.",
          }),
      );
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  function addDomain() {
    const domain = domainInput.trim().toLowerCase();
    if (!domain) return;
    if (!domains.includes(domain)) setDomains([...domains, domain]);
    setDomainInput("");
  }

  async function applyPortal() {
    setBusy(true);
    setError(null);
    try {
      const domainsPut = await api.PUT("/api/v1/auth/allowed-domains", { body: { domains } });
      if (!domainsPut.data) {
        setError(
          (await readProblem(domainsPut)).detail ??
            intl.formatMessage({
              id: "welcome.portal.error.domains",
              defaultMessage: "The domain allowlist could not be saved.",
            }),
        );
        return;
      }
      if (magicLinkEnabled !== savedMethods.magicLinkEnabled) {
        const toggled = await api.PATCH("/api/v1/auth/portal", { body: { magicLinkEnabled } });
        if (!toggled.data) {
          setError(
            (await readProblem(toggled)).detail ??
              intl.formatMessage({
                id: "welcome.portal.error.toggle",
                defaultMessage: "The magic-link setting could not be saved.",
              }),
          );
          return;
        }
        const saved = toggled.data.magicLinkEnabled;
        setSavedMethods((current) => ({ ...current, magicLinkEnabled: saved }));
      }
      goTo("email");
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  async function saveEmailSettings(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setEmailNotice(null);
    try {
      const result = await api.PUT("/api/v1/email-settings", {
        body: {
          smtpUrl: String(form.get("smtpUrl") ?? ""),
          smtpFrom: String(form.get("smtpFrom") ?? ""),
        },
      });
      const { data } = result;
      if (data) {
        setEmailState(data);
        setEmailConfigured(data.source !== "unset");
        setReplacingRelay(false);
        setEmailNotice(
          intl.formatMessage({
            id: "welcome.email.saved",
            defaultMessage: "Relay saved. The next email this instance sends will use it.",
          }),
        );
        return;
      }
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "welcome.email.error.save",
            defaultMessage: "The relay could not be saved.",
          }),
      );
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  async function clearEmailSettings() {
    setBusy(true);
    setError(null);
    setEmailNotice(null);
    try {
      const result = await api.PUT("/api/v1/email-settings", {
        body: { smtpUrl: null, smtpFrom: null },
      });
      const { data } = result;
      if (data) {
        setEmailState(data);
        setEmailConfigured(data.source !== "unset");
        setEmailNotice(
          intl.formatMessage({
            id: "welcome.email.cleared",
            defaultMessage: "Relay cleared. This instance can no longer send email.",
          }),
        );
        return;
      }
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "welcome.email.error.clear",
            defaultMessage: "The relay could not be cleared.",
          }),
      );
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  async function sendTestEmail() {
    setBusy(true);
    setError(null);
    setEmailNotice(null);
    try {
      const result = await api.POST("/api/v1/email-settings/test");
      const { data } = result;
      if (data) {
        setEmailNotice(
          intl.formatMessage(
            {
              id: "welcome.email.testSent",
              defaultMessage: "Test email sent to {email}. Check your inbox.",
            },
            { email: data.to },
          ),
        );
        return;
      }
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "welcome.email.error.test",
            defaultMessage: "The test email could not be sent.",
          }),
      );
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const email = field(fields, "inviteEmail");
    setBusy(true);
    setError(null);
    try {
      const result = await api.POST("/api/v1/auth/invites", {
        body: {
          email,
          displayName: field(fields, "inviteName"),
          role: inviteRole,
        },
      });
      const { data } = result;
      if (data) {
        setInvited([...invited, data.user.email]);
        form.reset();
        return;
      }
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "welcome.invites.error",
            defaultMessage: "The invite could not be sent.",
          }),
      );
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  const stepTitles: Record<Step, ReactNode> = {
    welcome: <FormattedMessage id="welcome.step.welcome" defaultMessage="Welcome to OpenLaw" />,
    authentication: (
      <FormattedMessage id="welcome.step.authentication" defaultMessage="Authentication" />
    ),
    portal: <FormattedMessage id="welcome.step.portal" defaultMessage="Business-user portal" />,
    email: <FormattedMessage id="welcome.step.email" defaultMessage="Outbound email" />,
    invites: <FormattedMessage id="welcome.step.invites" defaultMessage="Invite your team" />,
  };

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-primary">
      <PageTitle
        title={intl.formatMessage({ id: "welcome.pageTitle", defaultMessage: "Welcome" })}
      />
      <SkipLink />
      <main id="main" className="flex flex-1 items-start justify-center px-page-x py-page-y">
        <div className="w-full max-w-xl">
          <p className="mb-2 text-center text-sm text-muted">
            <FormattedMessage
              id="welcome.progress"
              defaultMessage="Step {current} of {total}"
              values={{ current: stepIndex + 1, total: STEPS.length }}
            />
          </p>
          <div className="mb-4 flex justify-center">
            <HelpLink surface="formal" contextual />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{stepTitles[step]}</CardTitle>
              {step === "welcome" && (
                <CardDescription>
                  <FormattedMessage
                    id="welcome.intro"
                    defaultMessage="A few choices get this instance ready for your team. Every step is skippable and stays editable later."
                  />
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {error && <Alert variant="danger">{error}</Alert>}

              {step === "welcome" && (
                <div className="flex items-center gap-3">
                  <Button onClick={() => goTo("authentication")}>
                    <FormattedMessage id="welcome.start" defaultMessage="Get started" />
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void finish()}>
                    <FormattedMessage id="welcome.skipAll" defaultMessage="Set up later" />
                  </Button>
                </div>
              )}

              {step === "authentication" && (
                <>
                  <div className="flex flex-col gap-2">
                    <OptionButton
                      selected={mode === "built_in"}
                      onClick={() => setMode("built_in")}
                      title={
                        <FormattedMessage
                          id="welcome.auth.builtIn"
                          defaultMessage="Built-in sign-in"
                        />
                      }
                      description={
                        <FormattedMessage
                          id="welcome.auth.builtIn.hint"
                          defaultMessage="Email and password, with optional two-factor authentication. The default."
                        />
                      }
                    />
                    <OptionButton
                      selected={mode === "oidc"}
                      onClick={() => setMode("oidc")}
                      title={
                        <FormattedMessage
                          id="welcome.auth.oidc"
                          defaultMessage="Single sign-on (OIDC)"
                        />
                      }
                      description={
                        <FormattedMessage
                          id="welcome.auth.oidc.hint"
                          defaultMessage="Bring your own identity provider. Administrators keep password sign-in as break-glass."
                        />
                      }
                    />
                  </div>

                  {mode === "oidc" && !ssoProviderId && (
                    <form
                      className="flex flex-col gap-3 rounded-card border border-border-default p-4"
                      onSubmit={(e) => void registerProvider(e)}
                    >
                      <p className="text-md font-medium">
                        <FormattedMessage
                          id="welcome.auth.register.title"
                          defaultMessage="Register your identity provider"
                        />
                      </p>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="providerId">
                          <FormattedMessage
                            id="welcome.auth.field.providerId"
                            defaultMessage="Provider ID"
                          />
                        </Label>
                        <Input
                          id="providerId"
                          name="providerId"
                          required
                          placeholder={intl.formatMessage({
                            id: "welcome.auth.field.providerIdPlaceholder",
                            defaultMessage: "okta",
                          })}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="issuer">
                          <FormattedMessage
                            id="welcome.auth.field.issuer"
                            defaultMessage="Issuer URL"
                          />
                        </Label>
                        <Input
                          id="issuer"
                          name="issuer"
                          type="url"
                          required
                          placeholder={intl.formatMessage({
                            id: "welcome.auth.field.issuerPlaceholder",
                            defaultMessage: "https://idp.example.com",
                          })}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="idpDomain">
                          <FormattedMessage
                            id="welcome.auth.field.domain"
                            defaultMessage="Email domain"
                          />
                        </Label>
                        <Input
                          id="idpDomain"
                          name="idpDomain"
                          required
                          placeholder={intl.formatMessage({
                            id: "welcome.auth.field.domainPlaceholder",
                            defaultMessage: "acme.example",
                          })}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="clientId">
                          <FormattedMessage
                            id="welcome.auth.field.clientId"
                            defaultMessage="Client ID"
                          />
                        </Label>
                        <Input id="clientId" name="clientId" required />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="clientSecret">
                          <FormattedMessage
                            id="welcome.auth.field.clientSecret"
                            defaultMessage="Client secret"
                          />
                        </Label>
                        <Input id="clientSecret" name="clientSecret" type="password" required />
                      </div>
                      <Button type="submit" variant="secondary" disabled={busy}>
                        <FormattedMessage
                          id="welcome.auth.register.submit"
                          defaultMessage="Register provider"
                        />
                      </Button>
                    </form>
                  )}

                  {mode === "oidc" && ssoProviderId && (
                    <Alert variant="success">
                      <FormattedMessage
                        id="welcome.auth.registered"
                        defaultMessage="Identity provider {providerId} is registered."
                        values={{ providerId: ssoProviderId }}
                      />
                      {callbackUrl && (
                        <span className="mt-1 block">
                          <FormattedMessage
                            id="welcome.auth.callback"
                            defaultMessage="Paste this callback URL into your IdP console: {url}"
                            values={{ url: <code className="break-all">{callbackUrl}</code> }}
                          />
                        </span>
                      )}
                    </Alert>
                  )}
                </>
              )}

              {step === "portal" && (
                <>
                  <CardDescription>
                    <FormattedMessage
                      id="welcome.portal.hint"
                      defaultMessage="Business users sign in with emailed magic links, restricted to the domains you allow. An empty list admits nobody."
                    />
                  </CardDescription>
                  <OptionButton
                    selected={magicLinkEnabled}
                    onClick={() => setMagicLinkEnabled(!magicLinkEnabled)}
                    title={
                      magicLinkEnabled ? (
                        <FormattedMessage
                          id="welcome.portal.enabled"
                          defaultMessage="Magic-link sign-in is on"
                        />
                      ) : (
                        <FormattedMessage
                          id="welcome.portal.disabled"
                          defaultMessage="Magic-link sign-in is off"
                        />
                      )
                    }
                    description={
                      <FormattedMessage
                        id="welcome.portal.toggle.hint"
                        defaultMessage="Select to change. Off closes the portal entirely, even for allowed domains."
                      />
                    }
                  />
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="domain">
                      <FormattedMessage
                        id="welcome.portal.domains"
                        defaultMessage="Allowed email domains"
                      />
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="domain"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addDomain();
                          }
                        }}
                        placeholder={intl.formatMessage({
                          id: "welcome.auth.field.domainPlaceholder",
                          defaultMessage: "acme.example",
                        })}
                      />
                      <Button type="button" variant="secondary" onClick={addDomain}>
                        <FormattedMessage id="welcome.portal.add" defaultMessage="Add" />
                      </Button>
                    </div>
                  </div>
                  {domains.length > 0 ? (
                    <ul className="flex flex-wrap gap-2">
                      {domains.map((domain) => (
                        <li
                          key={domain}
                          className="flex items-center gap-1 rounded-chip border border-border-default bg-control px-2 py-0.5 text-sm"
                        >
                          {domain}
                          <button
                            type="button"
                            aria-label={intl.formatMessage(
                              {
                                id: "welcome.portal.remove",
                                defaultMessage: "Remove {domain}",
                              },
                              { domain },
                            )}
                            className="p-1 text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
                            onClick={() => setDomains(domains.filter((d) => d !== domain))}
                          >
                            <X size={16} aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">
                      <FormattedMessage
                        id="welcome.portal.empty"
                        defaultMessage="No domains allowed yet — the portal is closed."
                      />
                    </p>
                  )}
                </>
              )}

              {step === "email" && (
                <>
                  {emailNotice && <Alert variant="success">{emailNotice}</Alert>}

                  {emailState.source === "env" && (
                    <>
                      {emailState.fromAddress ? (
                        <Alert variant="success">
                          <FormattedMessage
                            id="welcome.email.env"
                            defaultMessage="Outbound email is set by the deployment environment. Mail is sent from {from}."
                            values={{ from: emailState.fromAddress }}
                          />
                        </Alert>
                      ) : (
                        <Alert variant="warning">
                          <FormattedMessage
                            id="welcome.email.env.incomplete"
                            defaultMessage="The deployment environment sets SMTP_URL but not SMTP_FROM, so mail cannot be sent. Set SMTP_FROM in the environment."
                          />
                        </Alert>
                      )}
                      <p className="text-md text-muted">
                        <FormattedMessage
                          id="welcome.email.env.hint"
                          defaultMessage="Settings saved here would never apply — the environment always wins. To change the relay, change SMTP_URL and SMTP_FROM in the deployment environment (see the deployment guide)."
                        />
                      </p>
                    </>
                  )}

                  {emailState.source === "app" && !replacingRelay && (
                    <>
                      <Alert variant="success">
                        <FormattedMessage
                          id="welcome.email.app"
                          defaultMessage="Outbound email is set in the app. Mail is sent from {from}."
                          values={{ from: emailState.fromAddress }}
                        />
                      </Alert>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void sendTestEmail()}
                        >
                          <FormattedMessage
                            id="welcome.email.test"
                            defaultMessage="Send test email"
                          />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setEmailNotice(null);
                            setReplacingRelay(true);
                          }}
                        >
                          <FormattedMessage
                            id="welcome.email.replace"
                            defaultMessage="Replace relay"
                          />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void clearEmailSettings()}
                        >
                          <FormattedMessage id="welcome.email.clear" defaultMessage="Clear relay" />
                        </Button>
                      </div>
                    </>
                  )}

                  {(emailState.source === "unset" || replacingRelay) && (
                    <>
                      {emailState.source === "unset" && (
                        <Alert variant="warning">
                          <FormattedMessage
                            id="welcome.email.unset"
                            defaultMessage="Outbound email is not set up. Invites and sign-in links cannot be delivered until you save an SMTP relay."
                          />
                        </Alert>
                      )}
                      <form
                        className="flex flex-col gap-3"
                        onSubmit={(e) => void saveEmailSettings(e)}
                      >
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="smtpUrl">
                            <FormattedMessage
                              id="welcome.email.field.url"
                              defaultMessage="SMTP relay URL"
                            />
                          </Label>
                          <Input
                            id="smtpUrl"
                            name="smtpUrl"
                            autoComplete="off"
                            required
                            placeholder={intl.formatMessage({
                              id: "welcome.email.field.urlPlaceholder",
                              defaultMessage: "smtp://user:password@mail.example.com:587",
                            })}
                          />
                          <p className="text-sm text-muted">
                            <FormattedMessage
                              id="welcome.email.field.url.hint"
                              defaultMessage="Starts with smtp:// or smtps://; credentials go in the URL. It is stored, never shown again."
                            />
                          </p>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="smtpFrom">
                            <FormattedMessage
                              id="welcome.email.field.from"
                              defaultMessage="From address"
                            />
                          </Label>
                          <Input
                            id="smtpFrom"
                            name="smtpFrom"
                            autoComplete="off"
                            required
                            placeholder={intl.formatMessage({
                              id: "welcome.email.field.fromPlaceholder",
                              // ICU MessageFormat parses bare `<...>` as a
                              // rich-text tag; escape the angle brackets so
                              // the literal placeholder text survives.
                              defaultMessage: "OpenLaw '<'openlaw@example.com'>'",
                            })}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button type="submit" variant="secondary" disabled={busy}>
                            <FormattedMessage id="welcome.email.save" defaultMessage="Save relay" />
                          </Button>
                          {replacingRelay && (
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => setReplacingRelay(false)}
                            >
                              <FormattedMessage
                                id="welcome.email.replace.cancel"
                                defaultMessage="Keep current relay"
                              />
                            </Button>
                          )}
                        </div>
                      </form>
                    </>
                  )}
                </>
              )}

              {step === "invites" && (
                <>
                  {!emailConfigured && (
                    <Alert variant="warning">
                      <FormattedMessage
                        id="welcome.invites.noEmail"
                        defaultMessage="Without outbound email, invited people will not receive their set-password link."
                      />
                    </Alert>
                  )}
                  <form className="flex flex-col gap-3" onSubmit={(e) => void sendInvite(e)}>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="inviteName">
                        <FormattedMessage id="auth.field.displayName" defaultMessage="Name" />
                      </Label>
                      <Input id="inviteName" name="inviteName" autoComplete="off" required />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="inviteEmail">
                        <FormattedMessage id="auth.field.email" defaultMessage="Email" />
                      </Label>
                      <Input
                        id="inviteEmail"
                        name="inviteEmail"
                        type="email"
                        autoComplete="off"
                        required
                      />
                    </div>
                    <fieldset className="flex flex-col gap-1.5">
                      <legend className="mb-1.5 text-sm font-medium">
                        <FormattedMessage id="welcome.invites.role" defaultMessage="Role" />
                      </legend>
                      <div className="flex flex-wrap gap-2">
                        {INVITE_ROLES.map((role) => (
                          <Button
                            key={role}
                            type="button"
                            size="sm"
                            variant={inviteRole === role ? "primary" : "secondary"}
                            aria-pressed={inviteRole === role}
                            onClick={() => setInviteRole(role)}
                          >
                            <FormattedMessage {...ROLE_MESSAGES[role]} />
                          </Button>
                        ))}
                      </div>
                    </fieldset>
                    <Button type="submit" variant="secondary" disabled={busy}>
                      <FormattedMessage id="welcome.invites.submit" defaultMessage="Send invite" />
                    </Button>
                  </form>
                  {invited.length > 0 && (
                    <Alert variant="success">
                      <FormattedMessage
                        id="welcome.invites.sent"
                        defaultMessage="{count, plural, one {# invite sent:} other {# invites sent:}} {emails}"
                        values={{ count: invited.length, emails: invited.join(", ") }}
                      />
                    </Alert>
                  )}
                </>
              )}

              {step !== "welcome" && (
                <div className="flex items-center justify-between border-t border-border-default pt-4">
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => goTo(STEPS[stepIndex - 1] ?? "welcome")}
                  >
                    <FormattedMessage id="welcome.back" defaultMessage="Back" />
                  </Button>
                  <div className="flex items-center gap-2">
                    {/* Every step defers, none is required (SET-004).
                        Only the Administrator account is, and that was
                        first-run setup, before this flow. */}
                    {step !== "invites" ? (
                      <>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => goTo(STEPS[stepIndex + 1] ?? "invites")}
                        >
                          <FormattedMessage id="welcome.skip" defaultMessage="Set up later" />
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => {
                            if (step === "authentication") void applyAuthentication();
                            else if (step === "portal") void applyPortal();
                            else goTo(STEPS[stepIndex + 1] ?? "invites");
                          }}
                        >
                          <FormattedMessage id="welcome.continue" defaultMessage="Continue" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" disabled={busy} onClick={() => void finish()}>
                          <FormattedMessage id="welcome.skip" defaultMessage="Set up later" />
                        </Button>
                        <Button disabled={busy} onClick={() => void finish()}>
                          <FormattedMessage id="welcome.finish" defaultMessage="Finish" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
