// SPDX-License-Identifier: AGPL-3.0-only

/** Independent sign-in methods and second-factor requirements for each user group. */

import { useRef, useState, type ReactNode, type SubmitEvent as FormSubmitEvent } from "react";
import { redirect, useLoaderData, useRevalidator } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import { Pencil, X } from "lucide-react";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { networkError } from "../lib/messages";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";
import {
  AuthenticationOptionsFields,
  type AuthenticationOptions,
} from "../components/authentication-options";
import { ListEditor } from "../components/list-editor";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
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
    providers: providers.data.providers,
  };
}

type Provider =
  paths["/api/v1/auth/sso-providers"]["get"]["responses"][200]["content"]["application/json"]["providers"][number];

/** The PATCH body as the generated contract types it. A misspelled key
 * is a compile error, not a field the Zod schema silently strips. */
type ProviderPatch = NonNullable<
  paths["/api/v1/auth/sso-providers/{providerId}"]["patch"]["requestBody"]
>["content"]["application/json"];

interface ProviderDraft {
  name: string;
  providerId: string;
  issuer: string;
  domain: string;
  clientId: string;
  secret: string;
}

const EMPTY_DRAFT: ProviderDraft = {
  name: "",
  providerId: "",
  issuer: "",
  domain: "",
  clientId: "",
  secret: "",
};

function draftOf(provider: Provider): ProviderDraft {
  return {
    name: provider.name,
    providerId: provider.providerId,
    issuer: provider.issuer,
    domain: provider.domains.join(", "),
    clientId: provider.clientId ?? "",
    secret: "",
  };
}

/**
 * Only the provider fields the admin actually changed: each one becomes
 * its own DD-017 entry, so an untouched field must not resave (or
 * re-log). An empty secret draft means "keep the stored secret".
 */
function changedProviderFields(provider: Provider, draft: ProviderDraft): ProviderPatch {
  const body: ProviderPatch = {};
  if (draft.name.trim() !== provider.name) body.name = draft.name.trim();
  if (draft.issuer !== provider.issuer) body.issuer = draft.issuer;
  if (draft.domain !== provider.domains.join(", ")) body.domain = draft.domain;
  if (draft.clientId !== (provider.clientId ?? "")) body.clientId = draft.clientId;
  if (draft.secret !== "") body.clientSecret = draft.secret;
  return body;
}

function FormField(
  props: Readonly<{ id: string; label: ReactNode; help?: ReactNode; children: ReactNode }>,
) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.id} help={props.help}>
        {props.label}
      </Label>
      {props.children}
    </div>
  );
}

/**
 * The register / edit dialog for one identity provider. The Provider ID
 * is fixed once registered (it names the provider in every account row
 * and callback), so the edit face leaves it out. The secret is
 * write-only and starts blank; on edit an empty field keeps the stored
 * one.
 */
function ProviderDialog({
  target,
  onClose,
  onSaved,
}: Readonly<{
  target: Provider | null;
  onClose: () => void;
  onSaved: (provider: Provider, callbackUrl: string) => void;
}>) {
  const intl = useIntl();
  const [draft, setDraft] = useState<ProviderDraft>(target ? draftOf(target) : EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<Key extends keyof ProviderDraft>(key: Key, value: ProviderDraft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (error !== null) setError(null);
  }

  async function submit(event: FormSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (target) {
        const body = changedProviderFields(target, draft);
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        const result = await api.PATCH("/api/v1/auth/sso-providers/{providerId}", {
          params: { path: { providerId: target.providerId } },
          body,
        });
        if (!result.data) {
          setError((await problem(result)).detail ?? networkError(intl));
          return;
        }
        onSaved({ ...result.data.provider, clientId: draft.clientId }, result.data.callbackUrl);
        return;
      }
      const name = draft.name.trim();
      const result = await api.POST("/api/v1/auth/sso-providers", {
        body: {
          ...(name ? { name } : {}),
          providerId: draft.providerId.trim(),
          issuer: draft.issuer,
          domain: draft.domain,
          clientId: draft.clientId,
          clientSecret: draft.secret,
        },
      });
      if (!result.data) {
        setError((await problem(result)).detail ?? networkError(intl));
        return;
      }
      onSaved({ ...result.data.provider, clientId: draft.clientId }, result.data.callbackUrl);
    } catch {
      setError(networkError(intl));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>
          {target ? (
            <FormattedMessage
              id="settings.auth.editProvider"
              defaultMessage="Edit {name}"
              values={{ name: target.name }}
            />
          ) : (
            <FormattedMessage id="settings.auth.addProvider" defaultMessage="Add provider" />
          )}
        </DialogTitle>
        <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
          <FormField
            id="sso-name"
            label={
              <FormattedMessage id="settings.auth.providerName" defaultMessage="Display name" />
            }
            help={
              <FormattedMessage
                id="settings.auth.providerNameHint"
                defaultMessage="Shown to Administrators. Defaults to the Provider ID."
              />
            }
          >
            <Input
              id="sso-name"
              value={draft.name}
              maxLength={120}
              placeholder={intl.formatMessage({
                id: "settings.auth.providerNamePlaceholder",
                defaultMessage: "Acme identity provider",
              })}
              onChange={(event) => set("name", event.target.value)}
            />
          </FormField>
          {!target && (
            <FormField
              id="sso-provider-id"
              label={
                <FormattedMessage id="settings.auth.providerId" defaultMessage="Provider ID" />
              }
              help={
                <FormattedMessage
                  id="settings.auth.providerIdHint"
                  defaultMessage="Lowercase letters, digits and hyphens. Fixed after registration."
                />
              }
            >
              <Input
                id="sso-provider-id"
                required
                placeholder={intl.formatMessage({
                  id: "settings.auth.providerIdPlaceholder",
                  defaultMessage: "okta",
                })}
                value={draft.providerId}
                onChange={(event) => set("providerId", event.target.value)}
              />
            </FormField>
          )}
          <FormField
            id="sso-issuer"
            label={<FormattedMessage id="settings.auth.issuer" defaultMessage="Issuer URL" />}
          >
            <Input
              id="sso-issuer"
              type="url"
              required
              placeholder={intl.formatMessage({
                id: "settings.auth.issuerPlaceholder",
                defaultMessage: "https://idp.example.com",
              })}
              value={draft.issuer}
              onChange={(event) => set("issuer", event.target.value)}
            />
          </FormField>
          <FormField
            id="sso-domain"
            label={
              <FormattedMessage id="settings.auth.providerDomains" defaultMessage="Email domains" />
            }
            help={
              <FormattedMessage
                id="settings.auth.domainsHint"
                defaultMessage="Separate several domains with commas. Sign-in routes by the email domain a person enters, so each domain can belong to one provider."
              />
            }
          >
            <Input
              id="sso-domain"
              required
              placeholder={intl.formatMessage({
                id: "settings.auth.domainsPlaceholder",
                defaultMessage: "acme.example, acme-group.example",
              })}
              value={draft.domain}
              onChange={(event) => set("domain", event.target.value)}
            />
          </FormField>
          <FormField
            id="sso-client-id"
            label={<FormattedMessage id="settings.auth.clientId" defaultMessage="Client ID" />}
          >
            <Input
              id="sso-client-id"
              required
              value={draft.clientId}
              onChange={(event) => set("clientId", event.target.value)}
            />
          </FormField>
          <FormField
            id="sso-client-secret"
            label={
              <FormattedMessage id="settings.auth.clientSecret" defaultMessage="Client secret" />
            }
            help={
              target && (
                <FormattedMessage
                  id="settings.auth.secret.hint"
                  defaultMessage="Leave blank to keep the current secret. Paste a new value to rotate."
                />
              )
            }
          >
            <Input
              id="sso-client-secret"
              type="password"
              required={!target}
              placeholder={intl.formatMessage({
                id: "settings.auth.secretPlaceholder",
                // A visual mask, not copy. It still rides the catalog so a
                // locale can swap the glyph.
                defaultMessage: "••••••••••••••••",
              })}
              value={draft.secret}
              onChange={(event) => set("secret", event.target.value)}
            />
          </FormField>
          {error && (
            <p role="alert" className="text-xs text-status-danger-fg">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
            </Button>
            <Button type="submit" disabled={busy}>
              {target ? (
                <FormattedMessage id="settings.auth.saveProvider" defaultMessage="Save provider" />
              ) : (
                <FormattedMessage
                  id="settings.auth.registerProvider"
                  defaultMessage="Register provider"
                />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsAuthenticationPage() {
  const loaded = useLoaderData<typeof settingsAuthenticationLoader>();
  const intl = useIntl();
  const revalidator = useRevalidator();

  const [policy, setPolicy] = useState(loaded.policy);
  const [domains, setDomains] = useState(loaded.domains);
  const [domainInput, setDomainInput] = useState("");
  const [providers, setProviders] = useState<Provider[]>(loaded.providers);
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  /** The provider dialog: closed, create mode, or an edit target. */
  const [editor, setEditor] = useState<{ target: Provider | null } | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, FieldStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string | undefined>>({});
  const listRef = useRef<HTMLUListElement>(null);

  const [status, setStatus] = useState<Record<"legal" | "business" | "domains", FieldStatus>>({
    legal: "idle",
    business: "idle",
    domains: "idle",
  });
  const [detail, setDetail] = useState<Record<keyof typeof status, string | undefined>>({
    legal: undefined,
    business: undefined,
    domains: undefined,
  });

  function note(field: keyof typeof status, value: FieldStatus, message?: string) {
    setStatus((current) => ({ ...current, [field]: value }));
    setDetail((current) => ({ ...current, [field]: message }));
  }

  function noteRow(id: string, value: FieldStatus, message?: string) {
    setRowStatus((current) => ({ ...current, [id]: value }));
    setRowError((current) => ({ ...current, [id]: message }));
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

  function providerSaved(provider: Provider, url: string) {
    setProviders((current) =>
      current.some((row) => row.id === provider.id)
        ? current.map((row) => (row.id === provider.id ? provider : row))
        : [...current, provider],
    );
    setCallbackUrl(url);
    noteRow(provider.id, "saved");
    setEditor(null);
  }

  /**
   * Takes one provider off the list. The pressed button goes with the
   * row, so focus moves to the list (DES-020's `listRef`) only when the
   * row actually left; a refused removal keeps the button and the focus.
   */
  async function removeProvider(provider: Provider) {
    noteRow(provider.id, "saving");
    const result = await api
      .DELETE("/api/v1/auth/sso-providers/{providerId}", {
        params: { path: { providerId: provider.providerId } },
      })
      .catch(() => undefined);
    if (result?.response.ok !== true) {
      noteRow(provider.id, "error", (await problem(result)).detail ?? networkError(intl));
      return;
    }
    setProviders((current) => current.filter((row) => row.id !== provider.id));
    listRef.current?.focus();
    void revalidator.revalidate();
  }

  const rows = providers.map((provider) => ({
    ...provider,
    displayName: provider.name,
    archivedAt: null,
  }));

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
          ssoConfigured={providers.length > 0}
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
          ssoConfigured={providers.length > 0}
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
                defaultMessage="No domains allowed yet. New users must be invited individually."
              />
            </p>
          )}
        </div>
      </SettingsCard>

      <ListEditor
        region
        rows={rows}
        listRef={listRef}
        title={
          <FormattedMessage
            id="settings.auth.identityProviders"
            defaultMessage="Identity providers"
          />
        }
        count={
          <FormattedMessage
            id="settings.auth.providerCount"
            defaultMessage="{count, plural, one {# provider} other {# providers}}"
            values={{ count: rows.length }}
          />
        }
        addLabel={<FormattedMessage id="settings.auth.addProvider" defaultMessage="Add provider" />}
        onAdd={() => setEditor({ target: null })}
        help={
          <>
            <FormattedMessage
              id="settings.auth.providersHelp"
              defaultMessage="Sign-in routes by the email domain a person enters, so each domain belongs to one provider. Removing a provider deletes its configuration; accounts keep their rows."
            />
            {callbackUrl && (
              <>
                {" "}
                <FormattedMessage
                  id="settings.auth.callback"
                  defaultMessage="Paste this callback URL into your IdP console: {url}"
                  values={{ url: <code className="break-all">{callbackUrl}</code> }}
                />
              </>
            )}
          </>
        }
        rowStatus={rowStatus}
        rowError={rowError}
        nameSlotClassName="min-w-0 flex-1"
        renameLabel={() => null}
        rowCaption={(row) => <span>{row.domains.join(", ")}</span>}
        rowDetails={(row) => (
          <span className="w-40 shrink-0">
            {row.clientId ? (
              <span className="inline-flex max-w-full rounded-chip bg-status-success-bg px-2 py-0.5 text-xs font-semibold text-status-success-fg">
                <FormattedMessage
                  id="settings.auth.providerConfigured"
                  defaultMessage="Configured"
                />
              </span>
            ) : (
              <span className="inline-flex max-w-full rounded-chip bg-status-warning-bg px-2 py-0.5 text-xs font-semibold text-status-warning-fg">
                <FormattedMessage
                  id="settings.auth.providerMissingCredentials"
                  defaultMessage="Missing credentials"
                />
              </span>
            )}
          </span>
        )}
        rowActions={(row) => (
          <Button
            variant="ghost"
            size="sm"
            className="px-1.5"
            disabled={rowStatus[row.id] === "saving"}
            aria-label={intl.formatMessage(
              { id: "settings.auth.editProvider", defaultMessage: "Edit {name}" },
              { name: row.name },
            )}
            onClick={() => setEditor({ target: row })}
          >
            <Pencil size={16} aria-hidden="true" className="text-muted" />
          </Button>
        )}
        removeLabel={(row) =>
          intl.formatMessage(
            { id: "settings.auth.removeProvider", defaultMessage: "Remove {name}" },
            { name: row.name },
          )
        }
        onRemove={(row) => void removeProvider(row)}
      />
      {editor && (
        <ProviderDialog
          target={editor.target}
          onClose={() => setEditor(null)}
          onSaved={providerSaved}
        />
      )}
    </>
  );
}
