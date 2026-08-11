// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Security · Authentication (#64), from the ST17/ST18
 * frames of settings.pen: the mode cards (built-in vs OIDC), the OIDC
 * provider form, and the Portal access card — the magic-link toggle
 * with its built-in-mode lock (DD-010), plus the allowed-email-domains
 * editor the SET-001 amendment moved onto this pane. Everything fronts
 * the M2 typed routes with SET-003 immediate apply and DES-017
 * micro-states; the API's 403 is the real refusal behind the loader's
 * SET-002 bounce.
 */

import { useState, type FormEvent, type ReactNode } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import { api } from "../lib/api";
import { currentUser, needsSetup } from "../lib/session";
import { cn } from "../lib/utils";
import { PageTitle } from "../components/page-title";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";

export async function settingsAuthenticationLoader() {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role !== "administrator") return redirect("/settings/appearance");
  const [methods, domains, providers] = await Promise.all([
    api.GET("/api/v1/auth/methods"),
    api.GET("/api/v1/auth/allowed-domains"),
    api.GET("/api/v1/auth/sso-providers"),
  ]);
  if (!methods.data || !domains.data || !providers.data) {
    throw new Error("The authentication settings could not be read.");
  }
  return {
    mode: methods.data.mode,
    magicLinkEnabled: methods.data.magicLinkEnabled,
    domains: domains.data.domains,
    // One org, one IdP: the pane manages the first (and only) provider.
    provider: providers.data.providers[0] ?? null,
  };
}

type AuthMode = "built_in" | "oidc";

interface Provider {
  id: string;
  providerId: string;
  issuer: string;
  domain: string;
  clientId: string | null;
}

/** The card chrome every settings pane shares (38px section header). */
function SettingsCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Card className="w-full max-w-[45rem]">
      <div className="flex h-[38px] items-center rounded-t-card border-b border-border-default bg-section-header px-4">
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </Card>
  );
}

/** A mode card from ST17: radio, title, description — one per mode. */
function ModeOption(props: {
  mode: AuthMode;
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-card border p-3",
        // The mock outlines the chosen mode with the CTA green ($cta).
        props.selected ? "border-cta-primary" : "border-border-default",
      )}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="radio"
          name="authMode"
          value={props.mode}
          checked={props.selected}
          onChange={props.onSelect}
          aria-labelledby={`mode-${props.mode}-title`}
          aria-describedby={`mode-${props.mode}-description`}
          className="mt-0.5 size-3.5 shrink-0 accent-cta-primary"
        />
        <span className="flex flex-col gap-0.5">
          <span id={`mode-${props.mode}-title`} className="text-base font-medium text-primary">
            {props.title}
          </span>
          <span id={`mode-${props.mode}-description`} className="text-sm text-muted">
            {props.description}
          </span>
        </span>
      </div>
      {props.children}
    </div>
  );
}

function FormField(props: { id: string; label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children}
    </div>
  );
}

export function SettingsAuthenticationPage() {
  const loaded = useLoaderData<typeof settingsAuthenticationLoader>();
  const intl = useIntl();

  const [mode, setMode] = useState<AuthMode>(loaded.mode);
  // OIDC picked with no provider yet: the switch waits for registration.
  const [modeDraft, setModeDraft] = useState<AuthMode | null>(null);
  const [magicLinkEnabled, setMagicLinkEnabled] = useState(loaded.magicLinkEnabled);
  const [domains, setDomains] = useState(loaded.domains);
  const [domainInput, setDomainInput] = useState("");
  const [provider, setProvider] = useState<Provider | null>(loaded.provider);
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);

  // The ST18 provider form drafts; the secret is write-only and starts
  // blank — an empty field means "keep the stored one".
  const [providerIdDraft, setProviderIdDraft] = useState("");
  const [issuerDraft, setIssuerDraft] = useState(loaded.provider?.issuer ?? "");
  const [domainDraft, setDomainDraft] = useState(loaded.provider?.domain ?? "");
  const [clientIdDraft, setClientIdDraft] = useState(loaded.provider?.clientId ?? "");
  const [secretDraft, setSecretDraft] = useState("");

  const [status, setStatus] = useState<
    Record<"mode" | "portal" | "domains" | "provider", FieldStatus>
  >({ mode: "idle", portal: "idle", domains: "idle", provider: "idle" });

  function note(field: keyof typeof status, value: FieldStatus) {
    setStatus((current) => ({ ...current, [field]: value }));
  }

  const selectedMode = modeDraft ?? mode;

  async function commitMode(next: AuthMode): Promise<void> {
    note("mode", "saving");
    try {
      const { data } = await api.PATCH("/api/v1/auth/mode", { body: { mode: next } });
      if (!data) {
        setModeDraft(null);
        note("mode", "error");
        return;
      }
      setMode(data.mode);
      setModeDraft(null);
      note("mode", "saved");
    } catch {
      setModeDraft(null);
      note("mode", "error");
    }
  }

  function pickMode(next: AuthMode) {
    if (next === selectedMode) return;
    // Switching to OIDC without a registered IdP would leave everyone
    // but Administrators without a sign-in method — the switch waits
    // for the registration below (wizard precedent, #34).
    if (next === "oidc" && !provider) {
      setModeDraft("oidc");
      return;
    }
    // Backing out of an uncommitted draft needs no request.
    if (next === mode) {
      setModeDraft(null);
      return;
    }
    // The radio flips optimistically (SET-003 immediate apply); a
    // failed PATCH snaps it back with the error micro-state.
    setModeDraft(next);
    void commitMode(next);
  }

  async function commitPortal(next: boolean): Promise<void> {
    note("portal", "saving");
    try {
      const { data } = await api.PATCH("/api/v1/auth/portal", {
        body: { magicLinkEnabled: next },
      });
      if (!data) {
        note("portal", "error");
        return;
      }
      setMagicLinkEnabled(data.magicLinkEnabled);
      note("portal", "saved");
    } catch {
      note("portal", "error");
    }
  }

  async function commitDomains(next: string[]): Promise<void> {
    note("domains", "saving");
    try {
      const { data } = await api.PUT("/api/v1/auth/allowed-domains", {
        body: { domains: next },
      });
      if (!data) {
        note("domains", "error");
        return;
      }
      setDomains(data.domains);
      note("domains", "saved");
    } catch {
      note("domains", "error");
    }
  }

  function addDomain() {
    const domain = domainInput.trim().toLowerCase();
    setDomainInput("");
    if (!domain || domains.includes(domain)) return;
    void commitDomains([...domains, domain]);
  }

  async function saveProvider(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    note("provider", "saving");
    try {
      if (provider) {
        // Send only what changed: each field becomes its own DD-017
        // entry, so an untouched field must not resave (or re-log).
        const body: Record<string, string> = {};
        if (issuerDraft !== provider.issuer) body.issuer = issuerDraft;
        if (domainDraft !== provider.domain) body.domain = domainDraft;
        if (clientIdDraft !== (provider.clientId ?? "")) body.clientId = clientIdDraft;
        if (secretDraft !== "") body.clientSecret = secretDraft;
        if (Object.keys(body).length === 0) {
          note("provider", "idle");
          return;
        }
        const { data } = await api.PATCH("/api/v1/auth/sso-providers/{providerId}", {
          params: { path: { providerId: provider.providerId } },
          body,
        });
        if (!data) {
          note("provider", "error");
          return;
        }
        setProvider({ ...data.provider, clientId: clientIdDraft });
        setCallbackUrl(data.callbackUrl);
        setSecretDraft("");
        note("provider", "saved");
        return;
      }
      const { data } = await api.POST("/api/v1/auth/sso-providers", {
        body: {
          providerId: providerIdDraft,
          issuer: issuerDraft,
          domain: domainDraft,
          clientId: clientIdDraft,
          clientSecret: secretDraft,
        },
      });
      if (!data) {
        note("provider", "error");
        return;
      }
      setProvider({ ...data.provider, clientId: clientIdDraft });
      setCallbackUrl(data.callbackUrl);
      setSecretDraft("");
      note("provider", "saved");
      // Registration finishes a drafted switch to OIDC.
      if (modeDraft === "oidc") await commitMode("oidc");
    } catch {
      note("provider", "error");
    }
  }

  const providerForm = (
    <form className="flex flex-col gap-3" onSubmit={(event) => void saveProvider(event)}>
      {modeDraft === "oidc" && (
        <p className="text-sm text-status-info-fg">
          <FormattedMessage
            id="settings.auth.registerToSwitch"
            defaultMessage="Register your identity provider to finish the switch."
          />
        </p>
      )}
      {!provider && (
        <FormField
          id="sso-provider-id"
          label={<FormattedMessage id="settings.auth.providerId" defaultMessage="Provider ID" />}
        >
          <Input
            id="sso-provider-id"
            className="w-80"
            required
            placeholder="okta"
            value={providerIdDraft}
            onChange={(event) => setProviderIdDraft(event.target.value)}
          />
        </FormField>
      )}
      <FormField
        id="sso-issuer"
        label={<FormattedMessage id="settings.auth.issuer" defaultMessage="Issuer URL" />}
      >
        <Input
          id="sso-issuer"
          className="w-80"
          type="url"
          required
          placeholder="https://idp.example.com"
          value={issuerDraft}
          onChange={(event) => setIssuerDraft(event.target.value)}
        />
      </FormField>
      <FormField
        id="sso-domain"
        label={<FormattedMessage id="settings.auth.domain" defaultMessage="Email domain" />}
      >
        <Input
          id="sso-domain"
          className="w-80"
          required
          placeholder="acme.example"
          value={domainDraft}
          onChange={(event) => setDomainDraft(event.target.value)}
        />
      </FormField>
      <FormField
        id="sso-client-id"
        label={<FormattedMessage id="settings.auth.clientId" defaultMessage="Client ID" />}
      >
        <Input
          id="sso-client-id"
          className="w-80"
          required
          value={clientIdDraft}
          onChange={(event) => setClientIdDraft(event.target.value)}
        />
      </FormField>
      <FormField
        id="sso-client-secret"
        label={<FormattedMessage id="settings.auth.clientSecret" defaultMessage="Client secret" />}
      >
        <Input
          id="sso-client-secret"
          className="w-80"
          type="password"
          required={!provider}
          placeholder="••••••••••••••••"
          value={secretDraft}
          onChange={(event) => setSecretDraft(event.target.value)}
        />
        {provider && (
          <p className="text-xs text-muted">
            <FormattedMessage
              id="settings.auth.secretHint"
              defaultMessage="Leave blank to keep the current secret. Paste a new value to rotate."
            />
          </p>
        )}
      </FormField>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" size="sm">
          {provider ? (
            <FormattedMessage id="settings.auth.saveProvider" defaultMessage="Save provider" />
          ) : (
            <FormattedMessage
              id="settings.auth.registerProvider"
              defaultMessage="Register provider"
            />
          )}
        </Button>
        <StatusNote status={status.provider} />
      </div>
      {callbackUrl && (
        <p className="text-sm text-muted">
          <FormattedMessage
            id="settings.auth.callback"
            defaultMessage="Paste this callback URL into your IdP console: {url}"
            values={{ url: <code className="break-all">{callbackUrl}</code> }}
          />
        </p>
      )}
    </form>
  );

  return (
    <>
      <PageTitle
        title={intl.formatMessage({
          id: "settings.section.authentication",
          defaultMessage: "Authentication",
        })}
      />
      <SettingsCard
        title={
          <FormattedMessage id="settings.auth.authentication" defaultMessage="Authentication" />
        }
      >
        <ModeOption
          mode="built_in"
          selected={selectedMode === "built_in"}
          onSelect={() => pickMode("built_in")}
          title={<FormattedMessage id="settings.auth.builtIn" defaultMessage="Built-in" />}
          description={
            <FormattedMessage
              id="settings.auth.builtIn.hint"
              defaultMessage="Staff sign in with email and password. Each user can add two-factor authentication (TOTP) from their profile."
            />
          }
        />
        <ModeOption
          mode="oidc"
          selected={selectedMode === "oidc"}
          onSelect={() => pickMode("oidc")}
          title={
            <FormattedMessage id="settings.auth.oidc" defaultMessage="Identity provider (OIDC)" />
          }
          description={
            <FormattedMessage
              id="settings.auth.oidc.hint"
              defaultMessage="Staff sign in through your identity provider — works with Okta, Microsoft Entra, Google Workspace, Keycloak, and Authentik."
            />
          }
        >
          {selectedMode === "oidc" && providerForm}
        </ModeOption>
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted">
            {selectedMode === "oidc" ? (
              <FormattedMessage
                id="settings.auth.sessionsCaption"
                defaultMessage="The identity provider only authenticates — sessions stay in OpenLaw and remain revocable."
              />
            ) : (
              <FormattedMessage
                id="settings.auth.modeCaption"
                defaultMessage="Switching modes applies immediately and is recorded in the activity log."
              />
            )}
          </p>
          <StatusNote status={status.mode} />
        </div>
      </SettingsCard>

      <SettingsCard
        title={<FormattedMessage id="settings.auth.portal" defaultMessage="Portal access" />}
      >
        <div className="flex items-start justify-between gap-4">
          <span className="flex flex-col gap-0.5">
            <span id="portal-toggle-label" className="text-base font-medium text-primary">
              <FormattedMessage id="settings.auth.magicLink" defaultMessage="Magic-link sign-in" />
            </span>
            <span id="portal-toggle-description" className="text-sm text-muted">
              <FormattedMessage
                id="settings.auth.magicLink.hint"
                defaultMessage="Business users sign in through emailed magic links — no password or IdP account needed."
              />
            </span>
          </span>
          <span className="flex items-center gap-2 pt-0.5">
            <StatusNote status={status.portal} />
            <Switch
              checked={magicLinkEnabled}
              // The DD-010 floor: in built-in mode magic links cannot be
              // turned off — the API would accept it, the product says no.
              disabled={mode === "built_in"}
              onCheckedChange={(next) => void commitPortal(next)}
              aria-labelledby="portal-toggle-label"
              aria-describedby="portal-toggle-description"
            />
          </span>
        </div>
        <p className="text-xs text-muted">
          {mode === "built_in" ? (
            <FormattedMessage
              id="settings.auth.portalLocked"
              defaultMessage="Magic links are the only portal sign-in method in built-in mode, so they can't be turned off."
            />
          ) : (
            <FormattedMessage
              id="settings.auth.portalOptional"
              defaultMessage="Turn off to require SSO for everyone. Requesters would then need accounts in your identity provider to reach the portal."
            />
          )}
        </p>

        <div className="flex flex-col gap-1.5 border-t border-border-default pt-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="allowed-domain">
              <FormattedMessage id="settings.auth.domains" defaultMessage="Allowed email domains" />
            </Label>
            <StatusNote status={status.domains} />
          </div>
          <div className="flex gap-2">
            <Input
              id="allowed-domain"
              className="w-80"
              value={domainInput}
              placeholder="acme.example"
              onChange={(event) => setDomainInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addDomain();
                }
              }}
            />
            <Button type="button" variant="secondary" size="sm" onClick={addDomain}>
              <FormattedMessage id="settings.auth.addDomain" defaultMessage="Add" />
            </Button>
          </div>
          {domains.length > 0 ? (
            <ul className="flex flex-wrap gap-2 pt-1">
              {domains.map((domain) => (
                <li
                  key={domain}
                  className="flex items-center gap-1 rounded-chip border border-border-default bg-control px-2 py-0.5 text-sm"
                >
                  {domain}
                  <button
                    type="button"
                    aria-label={intl.formatMessage(
                      { id: "settings.auth.removeDomain", defaultMessage: "Remove {domain}" },
                      { domain },
                    )}
                    className="p-1 text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
                    onClick={() => void commitDomains(domains.filter((d) => d !== domain))}
                  >
                    <X size={16} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              <FormattedMessage
                id="settings.auth.noDomains"
                defaultMessage="No domains allowed yet — the portal is closed."
              />
            </p>
          )}
        </div>
      </SettingsCard>
    </>
  );
}
