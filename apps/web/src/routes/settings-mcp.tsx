// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Organization MCP pane (DD-029, SET-014, DES-092). The loader admits only
 * Administrators (SET-002); each edited policy field saves immediately (SET-003).
 */
import { useRef, useState, type ReactNode } from "react";
import { Link as RouterLink, redirect, useLoaderData } from "react-router";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { Bot, Clock, Link, Shield, Users, type LucideIcon } from "lucide-react";
import { MCP_TOOLSETS, MCP_OAUTH_UNAVAILABLE_PROBLEM } from "@openlaw/shared";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { requireUser } from "../lib/session";
import { TOOLSET_MESSAGES } from "../lib/mcp";
import { PageTitle } from "../components/page-title";
import { AllowedClients } from "../components/allowed-clients";
import { ApiKeys } from "../components/api-keys";
import { SettingsCard } from "../components/settings-card";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";

export async function settingsMcpLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const { data } = await api.GET("/api/v1/mcp-settings");
  if (!data) throw new Error("MCP settings could not be read.");
  const { data: keys } = await api.GET("/api/v1/mcp-settings/api-keys");
  if (!keys) throw new Error("API key requests could not be read.");
  const { data: grants } = await api.GET("/api/v1/mcp-settings/oauth-grants");
  if (!grants) throw new Error("OAuth grants could not be read.");
  return { ...data, keys, grants };
}
type Change = NonNullable<
  paths["/api/v1/mcp-settings"]["patch"]["requestBody"]
>["content"]["application/json"];
const errorMessages = defineMessages({
  forbidden: {
    id: "settings.mcp.forbidden",
    defaultMessage: "Only an Administrator can change MCP settings. Reload to check your access.",
  },
  invalidLifetime: {
    id: "settings.mcp.invalidLifetime",
    defaultMessage: "API key lifetime must be a whole number from 1 to 365 days.",
  },
  saveFailed: {
    id: "settings.mcp.saveFailed",
    defaultMessage: "MCP settings could not be saved. Try again.",
  },
});
const checkNames = defineMessages({
  https: { id: "settings.mcp.checkHttps", defaultMessage: "HTTPS scheme" },
  ipv4: { id: "settings.mcp.checkIpv4", defaultMessage: "IPv4 record" },
  public_ipv4: { id: "settings.mcp.checkPublicIpv4", defaultMessage: "Public IPv4 address" },
});
function OAuthCaption() {
  return (
    <div>
      <FormattedMessage
        id="settings.mcp.oauthHelp"
        defaultMessage="OAuth Clients expose /mcp, /.well-known/oauth-*, /.well-known/openid-configuration, /api/auth/oauth2/*, /api/auth/jwks and /auth/consent. See the <note>publicly reachable</note> deployment note."
        values={{
          note: (text) => (
            <RouterLink
              className="text-link hover:underline"
              to="/help/deployment-configuration#publicly-reachable"
            >
              {text}
            </RouterLink>
          ),
        }}
      />
    </div>
  );
}
function PolicyRow({
  icon: Icon,
  title,
  caption,
  children,
}: {
  icon: LucideIcon;
  title: ReactNode;
  caption: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-button bg-control text-muted">
        <Icon size={16} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-sm break-words text-muted">{caption}</div>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
export function SettingsMcpPage() {
  const loaded = useLoaderData<typeof settingsMcpLoader>();
  const [policy, setPolicy] = useState(loaded);
  const [refusedChecks, setRefusedChecks] = useState<typeof loaded.reachability>(null);
  const [lifetime, setLifetime] = useState(String(loaded.apiKeyLifetimeDays));
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const intl = useIntl();
  const title = intl.formatMessage({ id: "settings.section.mcp", defaultMessage: "MCP" });
  async function save(body: Change) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const result = await api.PATCH("/api/v1/mcp-settings", { body });
      if (!result.data) {
        if (
          result.error?.type === MCP_OAUTH_UNAVAILABLE_PROBLEM &&
          "reachability" in result.error
        ) {
          setRefusedChecks(result.error.reachability ?? null);
          return;
        }
        setError(
          intl.formatMessage(
            result.response.status === 401 || result.response.status === 403
              ? errorMessages.forbidden
              : result.error?.errors?.some((issue) => issue.path === "apiKeyLifetimeDays")
                ? errorMessages.invalidLifetime
                : errorMessages.saveFailed,
          ),
        );
        return;
      }
      setRefusedChecks(null);
      setPolicy({ ...result.data, keys: loaded.keys, grants: loaded.grants });
      setSaved(true);
    } catch {
      setError(intl.formatMessage(errorMessages.saveFailed));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function saveLifetime() {
    const days = Number(lifetime);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setSaved(false);
      setError(intl.formatMessage(errorMessages.invalidLifetime));
      return;
    }
    if (days !== policy.apiKeyLifetimeDays) void save({ apiKeyLifetimeDays: days });
  }
  const lifetimeLabel = intl.formatMessage({
    id: "settings.mcp.lifetime",
    defaultMessage: "API key lifetime (days)",
  });
  const checks =
    refusedChecks ??
    (policy.legalOAuthClientsEnabled || policy.businessOAuthClientsEnabled
      ? policy.reachability
      : null);
  const failed = checks?.filter((check) => !check.passed) ?? [];
  return (
    <>
      <PageTitle title={title} />
      <SettingsCard title={title} collapsible>
        <div className="divide-y divide-border-default">
          <PolicyRow
            icon={Bot}
            title={
              <FormattedMessage
                id="settings.mcp.masterState"
                defaultMessage="MCP is {enabled, select, true {on} other {off}}"
                values={{ enabled: String(policy.enabled) }}
              />
            }
            caption={
              <FormattedMessage
                id="settings.mcp.masterHelp"
                defaultMessage="Connected Clients act as the person who signed in and never see more than that person can."
              />
            }
          >
            <Switch
              checked={policy.enabled}
              disabled={busy}
              aria-label={intl.formatMessage({
                id: "settings.mcp.enable",
                defaultMessage: "Enable MCP",
              })}
              onCheckedChange={(enabled) => void save({ enabled })}
            />
          </PolicyRow>
          <PolicyRow
            icon={Link}
            title={
              <FormattedMessage id="settings.mcp.serverAddress" defaultMessage="Server address" />
            }
            caption={
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="font-mono">{policy.serverAddress}</span>
                {checks && (
                  <span
                    role="status"
                    className={
                      failed.length
                        ? "rounded-full bg-status-warning-bg px-2 py-0.5 text-xs text-status-warning-fg"
                        : "rounded-full bg-status-success-bg px-2 py-0.5 text-xs text-status-success-fg"
                    }
                  >
                    {failed.length ? (
                      <FormattedMessage
                        id="settings.mcp.notReachable"
                        defaultMessage="Not reachable · {checks}"
                        values={{
                          checks: failed
                            .map((check) => intl.formatMessage(checkNames[check.name]))
                            .join(", "),
                        }}
                      />
                    ) : (
                      <FormattedMessage id="settings.mcp.reachable" defaultMessage="Reachable" />
                    )}
                  </span>
                )}
              </span>
            }
          >
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard
                  .writeText(policy.serverAddress)
                  .then(() => setCopied(true))
                  .catch(() =>
                    setError(
                      intl.formatMessage({
                        id: "settings.mcp.copyFailed",
                        defaultMessage:
                          "The address could not be copied. Select and copy it above.",
                      }),
                    ),
                  );
              }}
            >
              {copied ? (
                <FormattedMessage id="settings.mcp.copied" defaultMessage="Copied" />
              ) : (
                <FormattedMessage id="settings.mcp.copy" defaultMessage="Copy address" />
              )}
            </Button>
          </PolicyRow>
          <PolicyRow
            icon={Users}
            title={<FormattedMessage id="settings.mcp.legal" defaultMessage="Legal Users" />}
            caption={
              <>
                <FormattedMessage
                  id="settings.mcp.legalHelp"
                  defaultMessage="Administrators and Legal Team Members. Every Toolset in the ceiling."
                />
                <OAuthCaption />
              </>
            }
          >
            <label htmlFor="mcp-legal-oauth-clients">
              <FormattedMessage id="settings.mcp.oauthClients" defaultMessage="OAuth Clients" />
            </label>
            <Switch
              id="mcp-legal-oauth-clients"
              checked={policy.legalOAuthClientsEnabled}
              disabled={busy}
              aria-label={intl.formatMessage({
                id: "settings.mcp.legalOAuth",
                defaultMessage: "Legal Users OAuth Clients",
              })}
              onCheckedChange={(legalOAuthClientsEnabled) =>
                void save({ legalOAuthClientsEnabled })
              }
            />
            <label htmlFor="mcp-legal-api-keys">
              <FormattedMessage id="settings.mcp.apiKeys" defaultMessage="API keys" />
            </label>
            <Switch
              id="mcp-legal-api-keys"
              checked={policy.legalApiKeysEnabled}
              disabled={busy}
              aria-label={intl.formatMessage({
                id: "settings.mcp.legalKeys",
                defaultMessage: "Legal Users API keys",
              })}
              onCheckedChange={(legalApiKeysEnabled) => void save({ legalApiKeysEnabled })}
            />
          </PolicyRow>
          <PolicyRow
            icon={Users}
            title={<FormattedMessage id="settings.mcp.business" defaultMessage="Business Users" />}
            caption={
              <>
                <FormattedMessage
                  id="settings.mcp.businessHelp"
                  defaultMessage="Their own Requests, Auto-Docs, portal Knowledge and the records they are on."
                />
                <OAuthCaption />
              </>
            }
          >
            <label htmlFor="mcp-business-oauth-clients">
              <FormattedMessage id="settings.mcp.oauthClients" defaultMessage="OAuth Clients" />
            </label>
            <Switch
              id="mcp-business-oauth-clients"
              checked={policy.businessOAuthClientsEnabled}
              disabled={busy}
              aria-label={intl.formatMessage({
                id: "settings.mcp.businessOAuth",
                defaultMessage: "Business Users OAuth Clients",
              })}
              onCheckedChange={(businessOAuthClientsEnabled) =>
                void save({ businessOAuthClientsEnabled })
              }
            />
            <label htmlFor="mcp-business-api-keys">
              <FormattedMessage id="settings.mcp.apiKeys" defaultMessage="API keys" />
            </label>
            <Switch
              id="mcp-business-api-keys"
              checked={policy.businessApiKeysEnabled}
              disabled={busy}
              aria-label={intl.formatMessage({
                id: "settings.mcp.businessKeys",
                defaultMessage: "Business Users API keys",
              })}
              onCheckedChange={(businessApiKeysEnabled) => void save({ businessApiKeysEnabled })}
            />
          </PolicyRow>
        </div>
      </SettingsCard>
      <AllowedClients
        initial={loaded.allowedClients}
        dynamicEnabled={policy.dynamicClientRegistrationEnabled}
        policyBusy={busy}
        onDynamicChange={(dynamicClientRegistrationEnabled) =>
          void save({ dynamicClientRegistrationEnabled })
        }
      />
      <SettingsCard
        title={<FormattedMessage id="settings.mcp.ceiling" defaultMessage="Toolset ceiling" />}
        collapsible
        defaultOpen={false}
        actions={
          <span className="text-xs text-muted">
            <FormattedMessage
              id="settings.mcp.ceilingSummary"
              defaultMessage="{count} of {total} Toolsets · {readOnly, select, true {read-only} other {read and write allowed}}"
              values={{
                count: policy.toolsetCeiling.length,
                total: MCP_TOOLSETS.length,
                readOnly: String(policy.readOnly),
              }}
            />
          </span>
        }
      >
        <div className="grid grid-cols-1 gap-3 @lg/page:grid-cols-3">
          {MCP_TOOLSETS.map((id) => (
            <label key={id} className="flex items-start gap-2">
              <Checkbox
                aria-label={intl.formatMessage(TOOLSET_MESSAGES[id])}
                aria-describedby={
                  id === "team" || id === "administration" ? `mcp-${id}-caption` : undefined
                }
                checked={policy.toolsetCeiling.includes(id)}
                disabled={busy}
                onCheckedChange={(checked) =>
                  void save({
                    toolsetCeiling: MCP_TOOLSETS.filter((item) =>
                      item === id ? checked === true : policy.toolsetCeiling.includes(item),
                    ),
                  })
                }
              />
              <span>
                {intl.formatMessage(TOOLSET_MESSAGES[id])}
                {id === "team" && (
                  <span id="mcp-team-caption" className="block text-xs text-muted">
                    <FormattedMessage id="settings.mcp.teamCaption" defaultMessage="Starts off." />
                  </span>
                )}
                {id === "administration" && (
                  <span id="mcp-administration-caption" className="block text-xs text-muted">
                    <FormattedMessage
                      id="settings.mcp.administrationCaption"
                      defaultMessage="Starts off. Administrators only."
                    />
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
        <PolicyRow
          icon={Shield}
          title={<FormattedMessage id="settings.mcp.readOnly" defaultMessage="Read-only" />}
          caption={
            <FormattedMessage
              id="settings.mcp.readOnlyHelp"
              defaultMessage="No Client may write, even if its API key allows writes."
            />
          }
        >
          <Switch
            checked={policy.readOnly}
            disabled={busy}
            aria-label={intl.formatMessage({
              id: "settings.mcp.readOnly",
              defaultMessage: "Read-only",
            })}
            onCheckedChange={(readOnly) => void save({ readOnly })}
          />
        </PolicyRow>
      </SettingsCard>
      <SettingsCard
        title={
          <FormattedMessage id="settings.mcp.lifetimeCard" defaultMessage="API key lifetime" />
        }
        collapsible
      >
        <PolicyRow
          icon={Clock}
          title={<label htmlFor="mcp-lifetime">{lifetimeLabel}</label>}
          caption={
            <FormattedMessage
              id="settings.mcp.lifetimeHelp"
              defaultMessage="New API keys expire after this many days. Choose 1 to 365 days."
            />
          }
        >
          <Input
            id="mcp-lifetime"
            className="w-24"
            type="number"
            min={1}
            max={365}
            step={1}
            required
            value={lifetime}
            disabled={busy}
            onChange={(event) => {
              setLifetime(event.target.value);
              setSaved(false);
            }}
            onBlur={saveLifetime}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </PolicyRow>
      </SettingsCard>
      {error && (
        <p role="alert" className="text-status-danger-fg">
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status">
          <FormattedMessage id="settings.mcp.saved" defaultMessage="Settings saved." />
        </p>
      )}
      <Button asChild variant="secondary" className="self-start">
        <RouterLink to="/settings/audit-log/tool-calls?range=last-day">
          <FormattedMessage
            id="settings.mcp.toolCalls"
            defaultMessage="Tool calls in the last day"
          />
        </RouterLink>
      </Button>
      <ApiKeys
        initialGrants={loaded.grants}
        organization
        initial={{
          requests: loaded.keys,
          policy: {
            enabled: policy.enabled,
            groupEnabled: policy.legalApiKeysEnabled,
            toolsets: [],
            readOnly: policy.readOnly,
            apiKeyLifetimeDays: policy.apiKeyLifetimeDays,
          },
        }}
      />
    </>
  );
}
