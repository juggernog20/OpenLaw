// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization · Security · Authentication (#64), from the ST17/ST18
 * frames of settings.pen: the mode cards (built-in vs OIDC), the OIDC
 * provider form, and the Portal access card. That card holds the
 * magic-link toggle with its built-in-mode lock (DD-010), plus the
 * allowed-email-domains editor the SET-001 amendment moved onto this
 * pane. Everything fronts the M2 typed routes with SET-003 immediate
 * apply and DES-017 micro-states. The API's 403 is the real refusal
 * behind the loader's SET-002 bounce.
 */

import { useState, type ReactNode, type SubmitEvent as FormSubmitEvent } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";
import { cn } from "../lib/utils";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";

export async function settingsAuthenticationLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
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

/** A mode card from ST17: radio, title, description. One per mode. */
function ModeOption(
  props: Readonly<{
    mode: AuthMode;
    selected: boolean;
    onSelect: () => void;
    title: ReactNode;
    description: ReactNode;
    children?: ReactNode;
  }>,
) {
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

/** The PATCH body as the generated contract types it. A misspelled key
 * is a compile error, not a field the Zod schema silently strips. */
type ProviderPatch = NonNullable<
  paths["/api/v1/auth/sso-providers/{providerId}"]["patch"]["requestBody"]
>["content"]["application/json"];

/**
 * Only the provider fields the admin actually changed: each one becomes
 * its own DD-017 entry, so an untouched field must not resave (or
 * re-log). An empty secret draft means "keep the stored secret".
 */
function changedProviderFields(
  provider: Provider,
  drafts: { issuer: string; domain: string; clientId: string; secret: string },
): ProviderPatch {
  const body: ProviderPatch = {};
  if (drafts.issuer !== provider.issuer) body.issuer = drafts.issuer;
  if (drafts.domain !== provider.domain) body.domain = drafts.domain;
  if (drafts.clientId !== (provider.clientId ?? "")) body.clientId = drafts.clientId;
  if (drafts.secret !== "") body.clientSecret = drafts.secret;
  return body;
}

function FormField(props: Readonly<{ id: string; label: ReactNode; children: ReactNode }>) {
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

  // The ST18 provider form drafts. The secret is write-only and starts
  // blank; an empty field means "keep the stored one".
  const [providerIdDraft, setProviderIdDraft] = useState("");
  const [issuerDraft, setIssuerDraft] = useState(loaded.provider?.issuer ?? "");
  const [domainDraft, setDomainDraft] = useState(loaded.provider?.domain ?? "");
  const [clientIdDraft, setClientIdDraft] = useState(loaded.provider?.clientId ?? "");
  const [secretDraft, setSecretDraft] = useState("");

  const [status, setStatus] = useState<
    Record<"mode" | "portal" | "domains" | "provider", FieldStatus>
  >({ mode: "idle", portal: "idle", domains: "idle", provider: "idle" });
  const [detail, setDetail] = useState<Record<keyof typeof status, string | undefined>>({
    mode: undefined,
    portal: undefined,
    domains: undefined,
    provider: undefined,
  });

  function note(field: keyof typeof status, value: FieldStatus, message?: string) {
    setStatus((current) => ({ ...current, [field]: value }));
    setDetail((current) => ({ ...current, [field]: message }));
  }

  const selectedMode = modeDraft ?? mode;

  async function commitMode(next: AuthMode): Promise<void> {
    note("mode", "saving");
    try {
      const result = await api.PATCH("/api/v1/auth/mode", { body: { mode: next } });
      const { data } = result;
      if (!data) {
        setModeDraft(null);
        note("mode", "error", (await problem(result)).detail);
        return;
      }
      setMode(data.mode);
      setModeDraft(null);
      note("mode", "saved");
      // The DD-010 floor as state, not only a disabled switch. Magic
      // links could be off from OIDC mode, and built-in mode locks the
      // toggle. Without this restore the portal would be shut with no
      // control left to reopen it.
      if (data.mode === "built_in" && !magicLinkEnabled) await commitPortal(true);
    } catch {
      setModeDraft(null);
      note("mode", "error");
    }
  }

  function pickMode(next: AuthMode) {
    if (next === selectedMode) return;
    // Switching to OIDC without a registered IdP would leave everyone
    // but Administrators without a sign-in method. The switch waits
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
    // The radio flips optimistically (SET-003 immediate apply). A
    // failed PATCH snaps it back with the error micro-state.
    setModeDraft(next);
    void commitMode(next);
  }

  async function commitPortal(next: boolean): Promise<void> {
    note("portal", "saving");
    try {
      const result = await api.PATCH("/api/v1/auth/portal", {
        body: { magicLinkEnabled: next },
      });
      const { data } = result;
      if (!data) {
        note("portal", "error", (await problem(result)).detail);
        return;
      }
      setMagicLinkEnabled(data.magicLinkEnabled);
      note("portal", "saved");
    } catch {
      note("portal", "error");
    }
  }

  /** Resolves with whether the list landed, so callers can sequence on
   * the outcome (the input clears only on success). */
  async function commitDomains(next: string[]): Promise<boolean> {
    note("domains", "saving");
    try {
      const result = await api.PUT("/api/v1/auth/allowed-domains", {
        body: { domains: next },
      });
      const { data } = result;
      if (!data) {
        note("domains", "error", (await problem(result)).detail);
        return false;
      }
      setDomains(data.domains);
      note("domains", "saved");
      return true;
    } catch {
      note("domains", "error");
      return false;
    }
  }

  function addDomain() {
    const domain = domainInput.trim().toLowerCase();
    if (!domain || domains.includes(domain)) {
      setDomainInput("");
      return;
    }
    // The typed domain survives a failed request. Clearing it early
    // would leave retyping as the only recovery.
    void commitDomains([...domains, domain]).then((saved) => {
      if (saved) setDomainInput("");
    });
  }

  async function saveProvider(event: FormSubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    note("provider", "saving");
    try {
      if (provider) {
        const body = changedProviderFields(provider, {
          issuer: issuerDraft,
          domain: domainDraft,
          clientId: clientIdDraft,
          secret: secretDraft,
        });
        if (Object.keys(body).length === 0) {
          note("provider", "idle");
          return;
        }
        const result = await api.PATCH("/api/v1/auth/sso-providers/{providerId}", {
          params: { path: { providerId: provider.providerId } },
          body,
        });
        const { data } = result;
        if (!data) {
          note("provider", "error", (await problem(result)).detail);
          return;
        }
        setProvider({ ...data.provider, clientId: clientIdDraft });
        setCallbackUrl(data.callbackUrl);
        setSecretDraft("");
        note("provider", "saved");
        return;
      }
      const result = await api.POST("/api/v1/auth/sso-providers", {
        body: {
          providerId: providerIdDraft,
          issuer: issuerDraft,
          domain: domainDraft,
          clientId: clientIdDraft,
          clientSecret: secretDraft,
        },
      });
      const { data } = result;
      if (!data) {
        note("provider", "error", (await problem(result)).detail);
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
            placeholder={intl.formatMessage({
              id: "settings.auth.providerIdPlaceholder",
              defaultMessage: "okta",
            })}
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
          placeholder={intl.formatMessage({
            id: "settings.auth.issuerPlaceholder",
            defaultMessage: "https://idp.example.com",
          })}
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
          placeholder={intl.formatMessage({
            id: "settings.auth.domainPlaceholder",
            defaultMessage: "acme.example",
          })}
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
          placeholder={intl.formatMessage({
            id: "settings.auth.secretPlaceholder",
            // A visual mask, not copy. It still rides the catalog so a
            // locale can swap the glyph.
            defaultMessage: "••••••••••••••••",
          })}
          value={secretDraft}
          onChange={(event) => setSecretDraft(event.target.value)}
        />
        {provider && (
          <p className="text-xs text-muted">
            <FormattedMessage
              id="settings.auth.secret.hint"
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
        <StatusNote status={status.provider} detail={detail.provider} />
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
          <StatusNote status={status.mode} detail={detail.mode} />
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
            <StatusNote status={status.portal} detail={detail.portal} />
            <Switch
              checked={magicLinkEnabled}
              // The DD-010 floor: in built-in mode magic links cannot be
              // turned off. The API would accept it; the product says no.
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
            <StatusNote status={status.domains} detail={detail.domains} />
          </div>
          <div className="flex gap-2">
            <Input
              id="allowed-domain"
              className="w-80"
              value={domainInput}
              placeholder={intl.formatMessage({
                id: "settings.auth.domainPlaceholder",
                defaultMessage: "acme.example",
              })}
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
