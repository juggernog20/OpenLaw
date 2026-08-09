// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Welcome to OpenLaw" — the SET-004 first-run onboarding wizard,
 * scoped to the steps whose features exist (issue #34): authentication
 * mode, the DD-010 portal (magic-link toggle + domain allowlist), email
 * status (TECH-011: SMTP is env-carried, so this step only reports), and
 * invites. Every step is skippable; finishing — or skipping out — marks
 * onboarding complete, and a completed wizard never shows again.
 */

import { useState, type FormEvent, type ReactNode } from "react";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import { api } from "../lib/api";
import { networkError } from "../lib/messages";
import { currentUser, needsSetup } from "../lib/session";
import { cn } from "../lib/utils";
import { SkipLink } from "../components/skip-link";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export async function welcomeLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/");
  // Completion decides the redirect before anything else is fetched —
  // most visits to this loader are bounces off a finished instance.
  const onboarding = await api.GET("/api/v1/onboarding");
  if (!onboarding.data) throw new Error("The onboarding state could not be read.");
  if (onboarding.data.completed) return redirect("/");
  const [methods, domains] = await Promise.all([
    api.GET("/api/v1/auth/methods"),
    api.GET("/api/v1/auth/allowed-domains"),
  ]);
  if (!methods.data || !domains.data) {
    throw new Error("The onboarding state could not be read.");
  }
  return {
    emailConfigured: onboarding.data.emailConfigured,
    methods: methods.data,
    domains: domains.data.domains,
  };
}

const STEPS = ["welcome", "authentication", "portal", "email", "invites"] as const;
type Step = (typeof STEPS)[number];

const INVITE_ROLES = ["legal_team_member", "contributor", "administrator"] as const;
type InviteRole = (typeof INVITE_ROLES)[number];

/** Selectable option row (aria-pressed carries the state for readers). */
function OptionButton(props: {
  selected: boolean;
  onClick: () => void;
  title: ReactNode;
  description: ReactNode;
}) {
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
  const [mode, setMode] = useState(loaded.methods.mode);
  const [ssoProviderId, setSsoProviderId] = useState(loaded.methods.ssoProviderId);
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);

  // Portal step.
  const [magicLinkEnabled, setMagicLinkEnabled] = useState(loaded.methods.magicLinkEnabled);
  const [domains, setDomains] = useState<string[]>(loaded.domains);
  const [domainInput, setDomainInput] = useState("");

  // Invites step.
  const [inviteRole, setInviteRole] = useState<InviteRole>("legal_team_member");
  const [invited, setInvited] = useState<string[]>([]);

  const stepIndex = STEPS.indexOf(step);

  function goTo(next: Step) {
    setError(null);
    setStep(next);
  }

  function problemDetail(problem: unknown, fallback: string): string {
    return (problem as { detail?: string } | undefined)?.detail ?? fallback;
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

  async function registerProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem } = await api.POST("/api/v1/auth/sso-providers", {
        body: {
          providerId: String(form.get("providerId") ?? ""),
          issuer: String(form.get("issuer") ?? ""),
          domain: String(form.get("idpDomain") ?? ""),
          clientId: String(form.get("clientId") ?? ""),
          clientSecret: String(form.get("clientSecret") ?? ""),
        },
      });
      if (data) {
        setSsoProviderId(data.provider.providerId);
        setCallbackUrl(data.callbackUrl);
        return;
      }
      setError(
        problemDetail(
          problem,
          intl.formatMessage({
            id: "welcome.auth.error.register",
            defaultMessage: "The identity provider could not be registered.",
          }),
        ),
      );
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  async function applyAuthentication() {
    // Switching to OIDC without a registered IdP would leave everyone but
    // Administrators without a sign-in method — refuse client-side.
    if (mode === "oidc" && !ssoProviderId) {
      setError(
        intl.formatMessage({
          id: "welcome.auth.error.noProvider",
          defaultMessage: "Register an identity provider before switching to single sign-on.",
        }),
      );
      return;
    }
    if (mode === loaded.methods.mode) {
      goTo("portal");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem } = await api.PATCH("/api/v1/auth/mode", { body: { mode } });
      if (data) {
        loaded.methods.mode = data.mode;
        goTo("portal");
        return;
      }
      setError(
        problemDetail(
          problem,
          intl.formatMessage({
            id: "welcome.auth.error.mode",
            defaultMessage: "The authentication mode could not be saved.",
          }),
        ),
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
          problemDetail(
            domainsPut.error,
            intl.formatMessage({
              id: "welcome.portal.error.domains",
              defaultMessage: "The domain allowlist could not be saved.",
            }),
          ),
        );
        return;
      }
      if (magicLinkEnabled !== loaded.methods.magicLinkEnabled) {
        const toggled = await api.PATCH("/api/v1/auth/portal", { body: { magicLinkEnabled } });
        if (!toggled.data) {
          setError(
            problemDetail(
              toggled.error,
              intl.formatMessage({
                id: "welcome.portal.error.toggle",
                defaultMessage: "The magic-link setting could not be saved.",
              }),
            ),
          );
          return;
        }
        loaded.methods.magicLinkEnabled = toggled.data.magicLinkEnabled;
      }
      goTo("email");
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const email = String(fields.get("inviteEmail") ?? "");
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem } = await api.POST("/api/v1/auth/invites", {
        body: {
          email,
          displayName: String(fields.get("inviteName") ?? ""),
          role: inviteRole,
        },
      });
      if (data) {
        setInvited([...invited, data.user.email]);
        form.reset();
        return;
      }
      setError(
        problemDetail(
          problem,
          intl.formatMessage({
            id: "welcome.invites.error",
            defaultMessage: "The invite could not be sent.",
          }),
        ),
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
                        <Input id="providerId" name="providerId" required placeholder="okta" />
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
                          placeholder="https://idp.example.com"
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
                          placeholder="acme.example"
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
                        placeholder="acme.example"
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
                  {loaded.emailConfigured ? (
                    <Alert variant="success">
                      <FormattedMessage
                        id="welcome.email.configured"
                        defaultMessage="Outbound email is configured. Invites and magic links will be delivered."
                      />
                    </Alert>
                  ) : (
                    <Alert variant="warning">
                      <FormattedMessage
                        id="welcome.email.unconfigured"
                        defaultMessage="Outbound email is not configured. Invites and magic links cannot be delivered until SMTP_URL and SMTP_FROM are set in the deployment environment."
                      />
                    </Alert>
                  )}
                  <p className="text-md text-muted">
                    <FormattedMessage
                      id="welcome.email.hint"
                      defaultMessage="Email settings live in the deployment environment, not in the app — see the deployment guide."
                    />
                  </p>
                </>
              )}

              {step === "invites" && (
                <>
                  {!loaded.emailConfigured && (
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
                            {role === "legal_team_member" ? (
                              <FormattedMessage
                                id="role.legalTeamMember"
                                defaultMessage="Legal team member"
                              />
                            ) : role === "contributor" ? (
                              <FormattedMessage
                                id="role.contributor"
                                defaultMessage="Contributor"
                              />
                            ) : (
                              <FormattedMessage
                                id="role.administrator"
                                defaultMessage="Administrator"
                              />
                            )}
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
                    {/* Every step defers, none is required (SET-004) —
                        only the Administrator account is, and that was
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
