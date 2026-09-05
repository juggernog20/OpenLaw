// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Welcome to OpenLaw", the SET-004 first-run onboarding wizard: the
 * organization's identity (#697), authentication mode, the DD-010
 * portal (magic-link toggle plus domain allowlist), SMTP setup (#37:
 * save a relay in the app unless the environment pins one; env always
 * wins), invites, and the DocuSign connector (#698). Every step writes
 * through the route its Settings pane already uses, because SET-001
 * keeps one pane at one address and a second writer would be a second
 * address.
 *
 * Every step is skippable and saves on Continue, in one request. That
 * is the wizard's own shape rather than a departure from DES-017.
 * Per-field commit on blur governs the Settings panes, where a field
 * stands alone. Here a step is the unit an Administrator moves through.
 *
 * Finishing or skipping out marks onboarding complete, and a completed
 * wizard never shows again.
 */

import {
  useId,
  useRef,
  useState,
  type ReactNode,
  type SubmitEvent as FormSubmitEvent,
} from "react";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { field } from "../lib/forms";
import { networkError } from "../lib/messages";
import { problem as readProblem } from "../lib/problem";
import { ROLE_MESSAGES } from "../lib/roles";
import { requireUser } from "../lib/session";
import { cn } from "../lib/utils";
import { PageTitle } from "../components/page-title";
import { SkipLink } from "../components/skip-link";
import { TimezonePicker } from "../components/timezone-picker";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

/** The one adapter v1 ships (CTR-013), as the pane names it too. */
const SIGNING_PROVIDER = "docusign" as const;

/** The estates DocuSign runs, as the API's own enum has them. */
const SIGNING_ENVIRONMENTS = ["demo", "production"] as const;

/** The connector as the API answers it. Never either secret. */
type SigningConnector =
  paths["/api/v1/signing-connectors/{provider}"]["get"]["responses"]["200"]["content"]["application/json"]["connector"];

export async function welcomeLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/");
  // Completion decides the redirect before anything else is fetched.
  // Most visits to this loader are bounces off a finished instance.
  const onboarding = await api.GET("/api/v1/onboarding");
  if (!onboarding.data) throw new Error("The onboarding state could not be read.");
  if (onboarding.data.completed) return redirect("/");
  const [general, methods, domains, email, signing] = await Promise.all([
    api.GET("/api/v1/org/general"),
    api.GET("/api/v1/auth/methods"),
    api.GET("/api/v1/auth/allowed-domains"),
    api.GET("/api/v1/email-settings"),
    api.GET("/api/v1/signing-connectors/{provider}", {
      params: { path: { provider: SIGNING_PROVIDER } },
    }),
  ]);
  if (!general.data || !methods.data || !domains.data || !email.data || !signing.data) {
    throw new Error("The onboarding state could not be read.");
  }
  return {
    // The email step's own answer, which honours TECH-011's precedence:
    // an environment-pinned relay counts exactly as an app-saved one.
    emailConfigured: onboarding.data.steps.email.done,
    general: general.data.general,
    methods: methods.data,
    domains: domains.data.domains,
    emailSettings: email.data,
    // Read here rather than derived from the onboarding status, because
    // the step draws the stored estate and integration key and needs
    // the row itself, not the one boolean the status carries.
    signingConnector: signing.data.connector,
  };
}

/** SET-004's order: who we are, then how people get in, then who they
 * are, then what we connect to. The splash configures nothing and opens
 * the flow. */
const STEPS = [
  "welcome",
  "organization",
  "authentication",
  "portal",
  "email",
  "invites",
  "e-signature",
] as const;
type Step = (typeof STEPS)[number];

const INVITE_ROLES = ["legal_team_member", "contributor", "administrator"] as const;
type InviteRole = (typeof INVITE_ROLES)[number];

/** The GET/PATCH /org/general payload, as the client sees it. */
interface General {
  name: string;
  logo: string | null;
  defaultLocale: "en-US";
  defaultTimezone: string;
}

/** ~256 KB of image; matches the API's cap on the encoded data: URI. */
const LOGO_BYTE_LIMIT = 256 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

/** The locales the UI ships, as the API's own enum has them (DES-013). */
const SHIPPED_LOCALES = ["en-US"] as const;

const selectClassName =
  "h-8 w-full rounded-button border border-border-default bg-raised px-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link disabled:pointer-events-none disabled:opacity-50";

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
  const stepTitleId = useId();

  // Organization step (#697): the same org_settings row the General
  // pane writes. Held as a draft and sent on Continue in one PATCH,
  // which is the wizard's unit of movement.
  const [savedGeneral, setSavedGeneral] = useState<General>(loaded.general);
  const [orgDraft, setOrgDraft] = useState<General>(loaded.general);
  const logoInput = useRef<HTMLInputElement>(null);

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

  // E-signature step (#698): the DocuSign connector, through the PUT
  // the Integrations pane already uses. Both secrets are write-only, so
  // their boxes start blank on a configured connector too — blank keeps
  // what is stored, and this step never receives either one to resend.
  const [signingConnector, setSigningConnector] = useState<SigningConnector>(
    loaded.signingConnector,
  );
  const [signingEnvironment, setSigningEnvironment] = useState<
    (typeof SIGNING_ENVIRONMENTS)[number]
  >(loaded.signingConnector.environment ?? "demo");
  const [integrationKey, setIntegrationKey] = useState(
    loaded.signingConnector.integrationKey ?? "",
  );
  const [apiUserId, setApiUserId] = useState(loaded.signingConnector.apiUserId ?? "");
  const [privateKey, setPrivateKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  /** Whether a configured connector's form is open for new credentials.
   * A configured connector reads as configured until it is. */
  const [replacingConnector, setReplacingConnector] = useState(false);
  const signingFormOpen = !signingConnector.configured || replacingConnector;

  const stepIndex = STEPS.indexOf(step);
  const isLastStep = stepIndex === STEPS.length - 1;

  function goTo(next: Step) {
    setError(null);
    setEmailNotice(null);
    setStep(next);
  }

  /** Onward from this step: the next one, or the end of the wizard. */
  async function advance() {
    const next = STEPS[stepIndex + 1];
    if (!next) {
      await finish();
      return;
    }
    goTo(next);
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

  function readLogo(file: File | undefined) {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type) || file.size > LOGO_BYTE_LIMIT) {
      setError(
        intl.formatMessage({
          id: "welcome.org.logo.rejected",
          defaultMessage:
            "That logo must be a PNG, JPEG, WebP, or SVG image under 256 KB. Pick another file.",
        }),
      );
      return;
    }
    setBusy(true);
    const unreadable = () => {
      setError(
        intl.formatMessage({
          id: "welcome.org.logo.unreadable",
          defaultMessage: "That file could not be read. Pick another one.",
        }),
      );
      setBusy(false);
    };
    const reader = new FileReader();
    reader.onload = () => {
      // readAsDataURL resolves to a string, but the API takes a data:
      // URI and nothing else, so anything else is a read that failed.
      const dataUri = reader.result;
      if (typeof dataUri !== "string") {
        unreadable();
        return;
      }
      setError(null);
      setOrgDraft((current) => ({ ...current, logo: dataUri }));
      setBusy(false);
    };
    reader.onerror = unreadable;
    reader.onabort = unreadable;
    try {
      reader.readAsDataURL(file);
    } catch {
      unreadable();
    }
  }

  async function applyOrganization() {
    // Only what moved: an untouched field sends nothing and the
    // activity log stays a record of changes (DD-017). A changed blank
    // name still reaches the route, whose validation refuses it; the
    // wizard must not silently retain the old name while advancing.
    const name = orgDraft.name.trim();
    const patch = {
      ...(name !== savedGeneral.name ? { name } : {}),
      ...(orgDraft.logo !== savedGeneral.logo ? { logo: orgDraft.logo } : {}),
      ...(orgDraft.defaultLocale !== savedGeneral.defaultLocale
        ? { defaultLocale: orgDraft.defaultLocale }
        : {}),
      ...(orgDraft.defaultTimezone !== savedGeneral.defaultTimezone
        ? { defaultTimezone: orgDraft.defaultTimezone }
        : {}),
    };
    if (Object.keys(patch).length === 0) {
      // Revert presentation-only whitespace trimmed above, so Back
      // shows the saved row rather than a draft that was never sent.
      setOrgDraft(savedGeneral);
      await advance();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.PATCH("/api/v1/org/general", { body: patch });
      const { data } = result;
      if (data) {
        setSavedGeneral(data.general);
        setOrgDraft(data.general);
        await advance();
        return;
      }
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "welcome.org.error.save",
            defaultMessage: "The organization details could not be saved.",
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
      await advance();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.PATCH("/api/v1/auth/mode", { body: { mode } });
      const { data } = result;
      if (data) {
        setSavedMethods((current) => ({ ...current, mode: data.mode }));
        await advance();
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
      await advance();
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

  /**
   * Saves the connector on Continue, if there is anything to save.
   *
   * Leaving the boxes as they were is how this step is skipped from the
   * Continue button, and it writes nothing: an install with no
   * connector keeps the manual hand-off, which is the whole promise
   * (CTR-013). Both secrets are omitted when blank rather than sent
   * empty, so a configured connector is never asked for a credential it
   * already holds.
   */
  async function applyESignature() {
    if (!signingFormOpen) {
      await advance();
      return;
    }
    const key = integrationKey.trim();
    const userId = apiUserId.trim();
    const untouched =
      signingEnvironment === (signingConnector.environment ?? "demo") &&
      key === (signingConnector.integrationKey ?? "") &&
      userId === (signingConnector.apiUserId ?? "") &&
      privateKey.trim() === "" &&
      webhookSecret.trim() === "";
    if (untouched) {
      await advance();
      return;
    }
    // The route refuses a blank integration key with a schema message,
    // which reads like a wire fault rather than an instruction. The two
    // secrets are left to the route, whose refusals are written for an
    // Administrator to act on.
    if (!key || !userId) {
      setError(
        intl.formatMessage({
          id: "welcome.eSignature.error.incomplete",
          defaultMessage:
            "Enter the integration key and the user ID from your DocuSign integration, or choose Set up later.",
        }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.PUT("/api/v1/signing-connectors/{provider}", {
        params: { path: { provider: SIGNING_PROVIDER } },
        body: {
          environment: signingEnvironment,
          integrationKey: key,
          apiUserId: userId,
          ...(privateKey.trim() === "" ? {} : { privateKey }),
          ...(webhookSecret.trim() === "" ? {} : { webhookSecret }),
        },
      });
      const { data } = result;
      if (data) {
        setSigningConnector(data.connector);
        // The boxes go back to blank because that is what they mean on
        // a stored connector: keep what is there.
        setPrivateKey("");
        setWebhookSecret("");
        setReplacingConnector(false);
        await advance();
        return;
      }
      setError(
        (await readProblem(result)).detail ??
          intl.formatMessage({
            id: "welcome.eSignature.error.save",
            defaultMessage: "The e-signature connector could not be saved.",
          }),
      );
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  /** What Continue does on this step, before it moves on. */
  async function continueStep() {
    if (step === "organization") return applyOrganization();
    if (step === "authentication") return applyAuthentication();
    if (step === "portal") return applyPortal();
    if (step === "e-signature") return applyESignature();
    return advance();
  }

  const stepTitles: Record<Step, ReactNode> = {
    welcome: <FormattedMessage id="welcome.step.welcome" defaultMessage="Welcome to OpenLaw" />,
    organization: (
      <FormattedMessage id="welcome.step.organization" defaultMessage="Your organization" />
    ),
    authentication: (
      <FormattedMessage id="welcome.step.authentication" defaultMessage="Authentication" />
    ),
    portal: <FormattedMessage id="welcome.step.portal" defaultMessage="Business-user portal" />,
    email: <FormattedMessage id="welcome.step.email" defaultMessage="Outbound email" />,
    invites: <FormattedMessage id="welcome.step.invites" defaultMessage="Invite your team" />,
    "e-signature": <FormattedMessage id="welcome.step.eSignature" defaultMessage="E-signature" />,
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
          <Card>
            <CardHeader>
              <CardTitle id={stepTitleId}>{stepTitles[step]}</CardTitle>
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

              {/* Each step is its own region, named by the card's
                  heading, so a screen reader reaches the step's fields
                  as one labelled group (DES-011). */}
              <section aria-labelledby={stepTitleId} className="flex flex-col gap-4">
                {step === "welcome" && (
                  <div className="flex items-center gap-3">
                    <Button onClick={() => goTo("organization")}>
                      <FormattedMessage id="welcome.start" defaultMessage="Get started" />
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => void finish()}>
                      <FormattedMessage id="welcome.skipAll" defaultMessage="Set up later" />
                    </Button>
                  </div>
                )}

                {step === "organization" && (
                  <>
                    <CardDescription>
                      <FormattedMessage
                        id="welcome.org.hint"
                        defaultMessage="Your name and logo appear in the header. The locale and timezone defaults decide how dates read until somebody sets their own."
                      />
                    </CardDescription>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="org-name">
                        <FormattedMessage
                          id="settings.general.name"
                          defaultMessage="Organization name"
                        />
                      </Label>
                      <Input
                        id="org-name"
                        value={orgDraft.name}
                        autoComplete="organization"
                        onChange={(event) =>
                          setOrgDraft((current) => ({ ...current, name: event.target.value }))
                        }
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-primary">
                        <FormattedMessage id="settings.general.logo" defaultMessage="Logo" />
                      </span>
                      <div className="flex items-center gap-3">
                        {orgDraft.logo ? (
                          // Named rather than decorative: on this step
                          // the preview is the confirmation that the
                          // upload landed, so a reader needs it too.
                          <img
                            src={orgDraft.logo}
                            alt={intl.formatMessage({
                              id: "welcome.org.logo.preview",
                              defaultMessage: "Organization logo",
                            })}
                            className="size-10 rounded-button border border-border-default object-contain"
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="flex size-10 items-center justify-center rounded-button bg-control text-lg font-semibold text-primary"
                          >
                            {(orgDraft.name || "O").charAt(0).toUpperCase()}
                          </span>
                        )}
                        <input
                          ref={logoInput}
                          type="file"
                          disabled={busy}
                          accept={LOGO_TYPES.join(",")}
                          // Visually hidden but still in the accessibility
                          // tree, so it carries its own name (the Upload
                          // button drives it).
                          aria-label={intl.formatMessage({
                            id: "settings.general.uploadLogo",
                            defaultMessage: "Upload a logo",
                          })}
                          className="sr-only"
                          onChange={(event) => {
                            readLogo(event.target.files?.[0]);
                            event.target.value = "";
                          }}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => logoInput.current?.click()}
                        >
                          <FormattedMessage id="settings.general.upload" defaultMessage="Upload" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="org-locale">
                        <FormattedMessage
                          id="settings.general.locale"
                          defaultMessage="Default locale"
                        />
                      </Label>
                      <select
                        id="org-locale"
                        className={selectClassName}
                        value={orgDraft.defaultLocale}
                        onChange={(event) => {
                          // A lookup, not a cast: a value outside the
                          // shipped set is not a locale we can save.
                          const locale = SHIPPED_LOCALES.find(
                            (shipped) => shipped === event.target.value,
                          );
                          if (locale) {
                            setOrgDraft((current) => ({ ...current, defaultLocale: locale }));
                          }
                        }}
                      >
                        <option value="en-US">
                          {intl.formatMessage({
                            id: "settings.general.locale.enUS",
                            defaultMessage: "English (United States)",
                          })}
                        </option>
                      </select>
                      {/* One option today is honest, not broken: DES-013
                        ships en-US alone, and the select comes alive
                        with locale #2. */}
                      <p className="text-sm text-muted">
                        <FormattedMessage
                          id="settings.general.locale.hint"
                          defaultMessage="English (United States) is the only available locale for now."
                        />
                      </p>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="org-timezone">
                        <FormattedMessage
                          id="settings.general.timezone"
                          defaultMessage="Default timezone"
                        />
                      </Label>
                      <TimezonePicker
                        id="org-timezone"
                        className="w-full"
                        value={orgDraft.defaultTimezone}
                        onCommit={(zone) => {
                          if (zone)
                            setOrgDraft((current) => ({ ...current, defaultTimezone: zone }));
                        }}
                      />
                      <p className="text-sm text-muted">
                        <FormattedMessage
                          id="settings.general.timezone.hint"
                          defaultMessage="Used for the daily digest and date displays until a user signs in."
                        />
                      </p>
                    </div>
                  </>
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
                            <FormattedMessage
                              id="welcome.email.clear"
                              defaultMessage="Clear relay"
                            />
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
                              <FormattedMessage
                                id="welcome.email.save"
                                defaultMessage="Save relay"
                              />
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
                        <FormattedMessage
                          id="welcome.invites.submit"
                          defaultMessage="Send invite"
                        />
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

                {step === "e-signature" && (
                  <>
                    <CardDescription>
                      <FormattedMessage
                        id="welcome.eSignature.hint"
                        defaultMessage="Optional. Connect DocuSign and contracts are sent for signature from their own records. Skip it and nothing else is lost. The manual hand-off stays the path, so you send the paper yourself, then upload the executed PDF and pin it to the record."
                      />
                    </CardDescription>

                    {/* A configured connector reads as configured. A
                        resumed wizard must never ask for a credential
                        the install already holds. */}
                    {signingConnector.configured && !replacingConnector && (
                      <>
                        <Alert variant={signingConnector.enabled ? "success" : "warning"}>
                          {signingConnector.enabled ? (
                            <FormattedMessage
                              id="welcome.eSignature.configured"
                              defaultMessage="DocuSign is connected in the {environment, select, production {production} other {demo}} environment, as integration key {integrationKey}."
                              values={{
                                environment: signingConnector.environment ?? "demo",
                                integrationKey: signingConnector.integrationKey ?? "",
                              }}
                            />
                          ) : (
                            <FormattedMessage
                              id="welcome.eSignature.configured.disabled"
                              defaultMessage="DocuSign is configured in the {environment, select, production {production} other {demo}} environment, as integration key {integrationKey}, but sending from records is turned off. Contracts use the manual hand-off until it is turned back on."
                              values={{
                                environment: signingConnector.environment ?? "demo",
                                integrationKey: signingConnector.integrationKey ?? "",
                              }}
                            />
                          )}
                        </Alert>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="welcome-ds-webhook-url">
                            <FormattedMessage
                              id="settings.eSignature.webhookUrl"
                              defaultMessage="Webhook URL"
                            />
                          </Label>
                          <Input
                            id="welcome-ds-webhook-url"
                            readOnly
                            value={signingConnector.webhookUrl}
                          />
                          <p className="text-sm text-muted">
                            <FormattedMessage
                              id="settings.eSignature.webhookUrl.hint"
                              defaultMessage="Paste this into a DocuSign Connect configuration so envelope status reaches this install."
                            />
                          </p>
                        </div>
                        <div>
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setReplacingConnector(true)}
                          >
                            <FormattedMessage
                              id="welcome.eSignature.replace"
                              defaultMessage="Replace credentials"
                            />
                          </Button>
                        </div>
                      </>
                    )}

                    {signingFormOpen && (
                      <>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="welcome-ds-environment">
                            <FormattedMessage
                              id="settings.eSignature.environment"
                              defaultMessage="Environment"
                            />
                          </Label>
                          <select
                            id="welcome-ds-environment"
                            className={selectClassName}
                            value={signingEnvironment}
                            onChange={(event) => {
                              // A lookup, not a cast: a value outside
                              // the two estates is not one we can save.
                              const chosen = SIGNING_ENVIRONMENTS.find(
                                (estate) => estate === event.target.value,
                              );
                              if (chosen) setSigningEnvironment(chosen);
                            }}
                          >
                            <option value="demo">
                              {intl.formatMessage({
                                id: "settings.eSignature.environment.demo",
                                defaultMessage: "Demo",
                              })}
                            </option>
                            <option value="production">
                              {intl.formatMessage({
                                id: "settings.eSignature.environment.production",
                                defaultMessage: "Production",
                              })}
                            </option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="welcome-ds-integration-key">
                            <FormattedMessage
                              id="settings.eSignature.integrationKey"
                              defaultMessage="Integration key"
                            />
                          </Label>
                          <Input
                            id="welcome-ds-integration-key"
                            autoComplete="off"
                            value={integrationKey}
                            onChange={(event) => setIntegrationKey(event.target.value)}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="welcome-ds-user-id">
                            <FormattedMessage
                              id="settings.eSignature.userId"
                              defaultMessage="User ID"
                            />
                          </Label>
                          <Input
                            id="welcome-ds-user-id"
                            autoComplete="off"
                            value={apiUserId}
                            onChange={(event) => setApiUserId(event.target.value)}
                          />
                          <p className="text-sm text-muted">
                            <FormattedMessage
                              id="settings.eSignature.userId.hint"
                              defaultMessage="The DocuSign user envelopes are sent as. Grant that user consent to the integration once, from the DocuSign console."
                            />
                          </p>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="welcome-ds-private-key">
                            <FormattedMessage
                              id="settings.eSignature.privateKey"
                              defaultMessage="RSA private key"
                            />
                          </Label>
                          <textarea
                            id="welcome-ds-private-key"
                            rows={4}
                            value={privateKey}
                            onChange={(event) => setPrivateKey(event.target.value)}
                            placeholder={intl.formatMessage({
                              id: "settings.eSignature.privateKey.placeholder",
                              defaultMessage: "-----BEGIN RSA PRIVATE KEY-----",
                            })}
                            className="w-full rounded-button border border-border-default bg-raised px-2.5 py-1.5 text-sm text-primary placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
                          />
                          {signingConnector.hasPrivateKey && (
                            <p className="text-sm text-muted">
                              <FormattedMessage
                                id="settings.eSignature.secret.hint"
                                defaultMessage="Leave blank to keep the current value. Paste a new one to rotate."
                              />
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="welcome-ds-webhook-secret">
                            <FormattedMessage
                              id="settings.eSignature.webhookSecret"
                              defaultMessage="Connect HMAC secret"
                            />
                          </Label>
                          <Input
                            id="welcome-ds-webhook-secret"
                            type="password"
                            autoComplete="off"
                            value={webhookSecret}
                            onChange={(event) => setWebhookSecret(event.target.value)}
                          />
                          <p className="text-sm text-muted">
                            {signingConnector.hasWebhookSecret ? (
                              <FormattedMessage
                                id="settings.eSignature.secret.hint"
                                defaultMessage="Leave blank to keep the current value. Paste a new one to rotate."
                              />
                            ) : (
                              <FormattedMessage
                                id="settings.eSignature.webhookSecret.hint"
                                defaultMessage="Required. OpenLaw checks it on every delivery, so nothing unsigned can change a record."
                              />
                            )}
                          </p>
                        </div>

                        {/* The way back from Replace credentials, the
                            email step's own shape. Without it the
                            configured summary is gone for the rest of
                            the wizard, because Back does not reset it. */}
                        {signingConnector.configured && (
                          <div>
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => {
                                setReplacingConnector(false);
                                setSigningEnvironment(signingConnector.environment ?? "demo");
                                setIntegrationKey(signingConnector.integrationKey ?? "");
                                setApiUserId(signingConnector.apiUserId ?? "");
                                setPrivateKey("");
                                setWebhookSecret("");
                              }}
                            >
                              <FormattedMessage
                                id="welcome.eSignature.replace.cancel"
                                defaultMessage="Keep current credentials"
                              />
                            </Button>
                          </div>
                        )}
                      </>
                    )}

                    {/* Named rather than linked: leaving the wizard for
                        Settings mid-flow is not the offer. An
                        Administrator who skips needs the address, and
                        SET-001 says there is exactly one. */}
                    <p className="text-sm text-muted">
                      <FormattedMessage
                        id="welcome.eSignature.address"
                        defaultMessage="This connector lives at Settings → Organization → Integrations → E-signature. Set it up there whenever you like."
                      />
                    </p>
                  </>
                )}
              </section>

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
                        first-run setup, before this flow. Deferring the
                        last step ends the wizard, which is what the two
                        buttons share there. */}
                    <Button variant="ghost" disabled={busy} onClick={() => void advance()}>
                      <FormattedMessage id="welcome.skip" defaultMessage="Set up later" />
                    </Button>
                    <Button disabled={busy} onClick={() => void continueStep()}>
                      {isLastStep ? (
                        <FormattedMessage id="welcome.finish" defaultMessage="Finish" />
                      ) : (
                        <FormattedMessage id="welcome.continue" defaultMessage="Continue" />
                      )}
                    </Button>
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
