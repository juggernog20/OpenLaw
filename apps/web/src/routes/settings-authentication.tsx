// SPDX-License-Identifier: AGPL-3.0-only

/** Independent sign-in methods and second-factor requirements for each user group. */

import { useState, type ReactNode, type SubmitEvent as FormSubmitEvent } from "react";
import { redirect, useLoaderData, useRevalidator } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";
import {
  AuthenticationOptionsFields,
  type AuthenticationOptions,
} from "../components/authentication-options";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

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
    policy: methods.data.policy,
    domains: domains.data.domains,
    // One org, one IdP: the pane manages the first (and only) provider.
    provider: providers.data.providers[0] ?? null,
  };
}

interface Provider {
  id: string;
  providerId: string;
  issuer: string;
  domain: string;
  clientId: string | null;
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
  const revalidator = useRevalidator();

  const [policy, setPolicy] = useState(loaded.policy);
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
    Record<"legal" | "business" | "domains" | "provider", FieldStatus>
  >({ legal: "idle", business: "idle", domains: "idle", provider: "idle" });
  const [detail, setDetail] = useState<Record<keyof typeof status, string | undefined>>({
    legal: undefined,
    business: undefined,
    domains: undefined,
    provider: undefined,
  });

  function note(field: keyof typeof status, value: FieldStatus, message?: string) {
    setStatus((current) => ({ ...current, [field]: value }));
    setDetail((current) => ({ ...current, [field]: message }));
  }

  async function commitPolicy(group: "legal" | "business", value: AuthenticationOptions) {
    note(group, "saving");
    const result = await api
      .PATCH("/api/v1/auth/policy/{group}", { params: { path: { group } }, body: value })
      .catch(() => undefined);
    if (!result?.data) {
      note(group, "error", (await problem(result)).detail);
      return;
    }
    setPolicy(result.data);
    note(group, "saved");
    void revalidator.revalidate();
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
    } catch {
      note("provider", "error");
    }
  }

  const providerForm = (
    <form className="flex flex-col gap-3" onSubmit={(event) => void saveProvider(event)}>
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
        region
        title={
          <FormattedMessage
            id="settings.auth.authentication"
            defaultMessage="Legal User Authentication"
          />
        }
      >
        <AuthenticationOptionsFields
          value={policy.legal}
          onChange={(value) => void commitPolicy("legal", value)}
          disabled={status.legal === "saving" || status.business === "saving"}
          ssoConfigured={!!provider}
        />
        <StatusNote status={status.legal} detail={detail.legal} />
        <p className="text-sm text-muted">
          <FormattedMessage
            id="settings.auth.adminRecovery"
            defaultMessage="Administrators retain emergency password sign-in. Any required two-factor authentication still applies."
          />
        </p>
      </SettingsCard>

      <SettingsCard
        region
        title={
          <FormattedMessage
            id="settings.auth.portal"
            defaultMessage="Business Portal Authentication"
          />
        }
      >
        <AuthenticationOptionsFields
          value={policy.business}
          onChange={(value) => void commitPolicy("business", value)}
          disabled={status.legal === "saving" || status.business === "saving"}
          ssoConfigured={!!provider}
        />
        <StatusNote status={status.business} detail={detail.business} />

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
                defaultMessage="No domains allowed yet. Magic-link sign-in is unavailable."
              />
            </p>
          )}
        </div>
      </SettingsCard>
      <SettingsCard
        region
        title={
          <FormattedMessage
            id="settings.auth.identityProvider"
            defaultMessage="Identity provider"
          />
        }
      >
        {providerForm}
      </SettingsCard>
    </>
  );
}
