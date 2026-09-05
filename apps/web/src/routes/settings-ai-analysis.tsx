// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The AI analysis section (SET-008, #675): one Organization rail entry
 * at /settings/ai-analysis holding the DES-054 Provider card and the
 * Field prompts card. Its loader enforces the Administrator boundary
 * and the form preserves the API key as write-only.
 */

import { useRef, useState, type ReactNode, type SubmitEvent as FormSubmitEvent } from "react";
import { redirect, useLoaderData } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { AiFieldPromptsCard } from "../components/ai-field-prompts-card";
import { PageTitle } from "../components/page-title";
import { SettingsCard } from "../components/settings-card";
import { StatusNote, type FieldStatus } from "../components/status-note";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { aiPresetLabel } from "../lib/ai-presets";
import { api } from "../lib/api";
import { formatShortDate } from "../lib/format";
import { problem } from "../lib/problem";
import { requireUser } from "../lib/session";
import { cn } from "../lib/utils";

type Response =
  paths["/api/v1/ai-connector"]["get"]["responses"]["200"]["content"]["application/json"];
type Connector = Response["connector"];
type PresetOption = Response["presets"][number];
type Preset = PresetOption["preset"];
type Protocol = PresetOption["protocol"];
type Field = "connector" | "test" | "lifecycle";

export async function settingsAiAnalysisLoader() {
  const user = await requireUser();
  if (user.role !== "administrator") return redirect("/settings/profile");
  const [connector, prompts] = await Promise.all([
    api.GET("/api/v1/ai-connector"),
    api.GET("/api/v1/ai-field-prompts"),
  ]);
  if (!connector.data || !prompts.data) {
    throw new Error("The AI analysis settings could not be read.");
  }
  return { ...connector.data, ...prompts.data };
}

function FormField(props: Readonly<{ id: string; label: ReactNode; children: ReactNode }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children}
    </div>
  );
}

export function SettingsAiAnalysisPage() {
  const loaded = useLoaderData<typeof settingsAiAnalysisLoader>();
  const intl = useIntl();
  const [connector, setConnector] = useState<Connector>(loaded.connector);
  const [preset, setPreset] = useState<Preset>(connector.preset ?? "anthropic");
  const initial = loaded.presets.find((option) => option.preset === preset)!;
  const [protocol, setProtocol] = useState<Protocol>(connector.protocol ?? initial.protocol);
  const [baseUrl, setBaseUrl] = useState(connector.baseUrl ?? initial.baseUrl ?? "");
  const [model, setModel] = useState(connector.model ?? initial.defaultModel);
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<Record<Field, FieldStatus>>({
    connector: "idle",
    test: "idle",
    lifecycle: "idle",
  });
  const [detail, setDetail] = useState<Record<Field, string | undefined>>({
    connector: undefined,
    test: undefined,
    lifecycle: undefined,
  });
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const saving = useRef(false);
  const testing = useRef(false);
  const changingLifecycle = useRef(false);
  const selected = loaded.presets.find((option) => option.preset === preset)!;

  function note(field: Field, value: FieldStatus, message?: string) {
    setStatus((current) => ({ ...current, [field]: value }));
    setDetail((current) => ({ ...current, [field]: message }));
  }

  function choosePreset(next: Preset): void {
    const option = loaded.presets.find((candidate) => candidate.preset === next)!;
    setPreset(next);
    setProtocol(option.protocol);
    setBaseUrl(option.baseUrl ?? "");
    setModel(option.defaultModel);
    setApiKey("");
    note("connector", "idle");
    note("test", "idle");
  }

  async function save(event: FormSubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    note("connector", "saving");
    note("test", "idle");
    try {
      const result = await api.PUT("/api/v1/ai-connector", {
        body: {
          preset,
          model,
          ...(preset === "custom" ? { protocol } : {}),
          ...(selected.requiresBaseUrl ? { baseUrl } : {}),
          ...(apiKey === "" ? {} : { apiKey }),
        },
      });
      if (!result.data) {
        note("connector", "error", (await problem(result)).detail);
        return;
      }
      setConnector(result.data.connector);
      setApiKey("");
      note("connector", "saved");
    } catch {
      note("connector", "error");
    } finally {
      saving.current = false;
    }
  }

  async function testConnection(): Promise<void> {
    if (testing.current) return;
    testing.current = true;
    note("test", "saving");
    try {
      const result = await api.POST("/api/v1/ai-connector/test");
      if (!result.data) {
        note("test", "error", (await problem(result)).detail);
        return;
      }
      note("test", "saved");
    } catch {
      note("test", "error");
    } finally {
      testing.current = false;
    }
  }

  async function setEnabled(next: boolean): Promise<void> {
    if (changingLifecycle.current) return;
    changingLifecycle.current = true;
    note("lifecycle", "saving");
    note("test", "idle");
    try {
      const result = await api.POST(
        next ? "/api/v1/ai-connector/enable" : "/api/v1/ai-connector/disable",
      );
      if (!result.data) {
        note("lifecycle", "error", (await problem(result)).detail);
        return;
      }
      setConnector(result.data.connector);
      note("lifecycle", "saved");
    } catch {
      note("lifecycle", "error");
    } finally {
      changingLifecycle.current = false;
    }
  }

  async function remove(): Promise<void> {
    if (changingLifecycle.current) return;
    changingLifecycle.current = true;
    note("lifecycle", "saving");
    note("test", "idle");
    try {
      const result = await api.DELETE("/api/v1/ai-connector");
      if (!result.data) {
        note("lifecycle", "error", (await problem(result)).detail);
        return;
      }
      setConnector(result.data.connector);
      choosePreset("anthropic");
      note("lifecycle", "saved");
    } catch {
      note("lifecycle", "error");
    } finally {
      changingLifecycle.current = false;
      setConfirmingRemove(false);
    }
  }

  return (
    <>
      <PageTitle
        title={intl.formatMessage({
          id: "settings.aiAnalysis.pageTitle",
          defaultMessage: "AI analysis",
        })}
      />
      <SettingsCard
        title={<FormattedMessage id="settings.aiAnalysis.providerCard" defaultMessage="Provider" />}
        collapsible
        defaultOpen={false}
        actions={<ConnectionChip connector={connector} />}
      >
        <p className="text-sm text-muted">
          <FormattedMessage
            id="settings.aiAnalysis.intro"
            defaultMessage="Connect your own AI provider for contract analysis. OpenLaw sends contract text only when an analysis runs."
          />
        </p>
        <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
          <FormField
            id="ai-preset"
            label={<FormattedMessage id="settings.aiAnalysis.provider" defaultMessage="Provider" />}
          >
            <select
              id="ai-preset"
              value={preset}
              onChange={(event) => choosePreset(event.target.value as Preset)}
              className="h-8 w-80 max-w-full rounded-button border border-border-default bg-raised px-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
            >
              {loaded.presets.map((option) => (
                <option key={option.preset} value={option.preset}>
                  {aiPresetLabel(intl, option.preset)}
                </option>
              ))}
            </select>
          </FormField>

          {preset === "custom" && (
            <FormField
              id="ai-protocol"
              label={
                <FormattedMessage id="settings.aiAnalysis.protocol" defaultMessage="Protocol" />
              }
            >
              <select
                id="ai-protocol"
                value={protocol}
                onChange={(event) => setProtocol(event.target.value as Protocol)}
                className="h-8 w-80 max-w-full rounded-button border border-border-default bg-raised px-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
              >
                <option value="anthropic_messages">
                  {intl.formatMessage({
                    id: "settings.aiAnalysis.protocol.anthropic",
                    defaultMessage: "Anthropic Messages",
                  })}
                </option>
                <option value="openai_chat_completions">
                  {intl.formatMessage({
                    id: "settings.aiAnalysis.protocol.openai",
                    defaultMessage: "OpenAI-compatible chat completions",
                  })}
                </option>
                <option value="gemini">
                  {intl.formatMessage({
                    id: "settings.aiAnalysis.protocol.gemini",
                    defaultMessage: "Gemini",
                  })}
                </option>
              </select>
            </FormField>
          )}

          {selected.requiresBaseUrl && (
            <FormField
              id="ai-base-url"
              label={
                preset === "azure_openai" ? (
                  <FormattedMessage
                    id="settings.aiAnalysis.deploymentEndpoint"
                    defaultMessage="Deployment endpoint"
                  />
                ) : (
                  <FormattedMessage id="settings.aiAnalysis.baseUrl" defaultMessage="Base URL" />
                )
              }
            >
              <Input
                id="ai-base-url"
                className="w-120 max-w-full"
                type="url"
                required
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </FormField>
          )}

          <FormField
            id="ai-api-key"
            label={<FormattedMessage id="settings.aiAnalysis.apiKey" defaultMessage="API key" />}
          >
            <Input
              id="ai-api-key"
              className="w-80"
              type="password"
              required={selected.requiresApiKey && !connector.hasApiKey}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={intl.formatMessage({
                id: "settings.aiAnalysis.apiKey.placeholder",
                defaultMessage: "••••••••••••••••",
              })}
            />
            <p className="text-xs text-muted">
              {connector.hasApiKey ? (
                <FormattedMessage
                  id="settings.aiAnalysis.apiKey.keep"
                  defaultMessage="Leave blank to keep the current key. Paste a new one to rotate."
                />
              ) : selected.requiresApiKey ? (
                <FormattedMessage
                  id="settings.aiAnalysis.apiKey.required"
                  defaultMessage="Required for this provider. The key is write-only and encrypted at rest."
                />
              ) : (
                <FormattedMessage
                  id="settings.aiAnalysis.apiKey.optional"
                  defaultMessage="Ollama does not require an API key."
                />
              )}
            </p>
          </FormField>

          <FormField
            id="ai-model"
            label={<FormattedMessage id="settings.aiAnalysis.model" defaultMessage="Model" />}
          >
            <Input
              id="ai-model"
              className="w-80"
              required
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </FormField>

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={status.connector === "saving"}
            >
              <FormattedMessage id="settings.aiAnalysis.save" defaultMessage="Save connector" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!connector.enabled || status.test === "saving"}
              onClick={() => void testConnection()}
            >
              <FormattedMessage id="settings.aiAnalysis.test" defaultMessage="Test connection" />
            </Button>
            <StatusNote status={status.connector} detail={detail.connector} />
          </div>
          <p aria-live="polite" className="text-sm">
            {status.test === "saving" && (
              <span className="text-muted">
                <FormattedMessage
                  id="settings.aiAnalysis.testing"
                  defaultMessage="Testing the connection…"
                />
              </span>
            )}
            {status.test === "saved" && (
              <span className="text-status-success-fg">
                <FormattedMessage
                  id="settings.aiAnalysis.connected"
                  defaultMessage="Connection successful."
                />
              </span>
            )}
            {status.test === "error" && (
              <span className="text-status-danger-fg">
                {detail.test ?? (
                  <FormattedMessage
                    id="settings.aiAnalysis.testFailed"
                    defaultMessage="The connection test failed. Check the connector and try again."
                  />
                )}
              </span>
            )}
          </p>
        </form>

        {connector.configured && (
          <div className="flex flex-col gap-4 border-t border-border-default pt-4">
            <div className="flex items-start gap-3">
              <Switch
                id="ai-enabled"
                checked={connector.enabled}
                disabled={status.lifecycle === "saving"}
                onCheckedChange={(next) => void setEnabled(next)}
                aria-labelledby="ai-enabled-label"
                aria-describedby="ai-enabled-hint"
              />
              <div className="flex flex-col gap-1">
                <Label id="ai-enabled-label" htmlFor="ai-enabled">
                  <FormattedMessage
                    id="settings.aiAnalysis.enabled"
                    defaultMessage="Use AI analysis"
                  />
                </Label>
                <p id="ai-enabled-hint" className="text-xs text-muted">
                  {connector.disabledAt === null ? (
                    <FormattedMessage
                      id="settings.aiAnalysis.enabled.on"
                      defaultMessage="Turn this off to hide AI analysis without deleting the connector."
                    />
                  ) : (
                    <FormattedMessage
                      id="settings.aiAnalysis.enabled.off"
                      defaultMessage="Off since {when}. Turn it on to make AI analysis available again."
                      values={{ when: formatShortDate(connector.disabledAt) }}
                    />
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmingRemove(true)}
              >
                <FormattedMessage
                  id="settings.aiAnalysis.remove"
                  defaultMessage="Remove connector"
                />
              </Button>
              <StatusNote status={status.lifecycle} detail={detail.lifecycle} />
            </div>
          </div>
        )}
      </SettingsCard>
      <AiFieldPromptsCard initialPrompts={loaded.prompts} />
      {confirmingRemove && (
        <Dialog open onOpenChange={(open) => !open && setConfirmingRemove(false)}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>
              <FormattedMessage
                id="settings.aiAnalysis.removeTitle"
                defaultMessage="Remove the AI connector"
              />
            </DialogTitle>
            <div className="mt-4 flex flex-col gap-4">
              <p className="text-sm text-muted">
                <FormattedMessage
                  id="settings.aiAnalysis.removeBody"
                  defaultMessage="The API key is deleted with the connector. Reconnecting means entering it again."
                />
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmingRemove(false)}
                >
                  <FormattedMessage id="action.cancel" defaultMessage="Cancel" />
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={status.lifecycle === "saving"}
                  onClick={() => void remove()}
                >
                  <FormattedMessage
                    id="settings.aiAnalysis.removeConfirm"
                    defaultMessage="Remove connector"
                  />
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function ConnectionChip({ connector }: Readonly<{ connector: Connector }>) {
  const [label, tone] = !connector.configured
    ? [
        <FormattedMessage
          key="none"
          id="settings.aiAnalysis.chip.notConnected"
          defaultMessage="Not connected"
        />,
        "bg-status-neutral-bg text-status-neutral-fg",
      ]
    : connector.enabled
      ? [
          <FormattedMessage
            key="on"
            id="settings.aiAnalysis.chip.connected"
            defaultMessage="Connected"
          />,
          "bg-status-success-bg text-status-success-fg",
        ]
      : [
          <FormattedMessage
            key="off"
            id="settings.aiAnalysis.chip.turnedOff"
            defaultMessage="Turned off"
          />,
          "bg-status-onhold-bg text-status-onhold-fg",
        ];
  return <span className={cn("rounded-pill px-2 py-0.5 text-xs font-medium", tone)}>{label}</span>;
}
