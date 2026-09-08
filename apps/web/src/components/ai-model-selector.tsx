// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { problem } from "../lib/problem";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Discovery = paths["/api/v1/ai-connector/models"]["post"];
type ModelList = Discovery["responses"]["200"]["content"]["application/json"];
type Config = Discovery["requestBody"]["content"]["application/json"];

/** The parent remounts this control when credentials or the destination change. */
export function AiModelSelector({
  config,
  canLoad,
  value,
  onChange,
}: Readonly<{
  config: Config;
  canLoad: boolean;
  value: string;
  onChange: (value: string) => void;
}>) {
  const intl = useIntl();
  const azure = config.preset === "azure_openai";
  const [manual, setManual] = useState(azure);
  const [query, setQuery] = useState("");
  const [list, setList] = useState<ModelList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );

  async function load() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await api.POST("/api/v1/ai-connector/models", {
        body: config,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (result.data) setList(result.data);
      else {
        const failure = await problem(result);
        if (!controller.signal.aborted)
          setError(
            failure.detail ??
              intl.formatMessage({
                id: "settings.aiAnalysis.models.failed",
                defaultMessage:
                  "Models could not be loaded. Try again or enter the model ID manually.",
              }),
          );
      }
    } catch {
      if (!controller.signal.aborted)
        setError(
          intl.formatMessage({
            id: "settings.aiAnalysis.models.failed",
            defaultMessage: "Models could not be loaded. Try again or enter the model ID manually.",
          }),
        );
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        active.current = null;
      }
    }
  }

  const models = list?.models ?? [];
  const filtered = models.filter(
    (option) =>
      `${option.label} ${option.id}`.toLowerCase().includes(query.trim().toLowerCase()) ||
      option.id === value,
  );
  const absent = value !== "" && !models.some((option) => option.id === value);

  return (
    <div className="flex max-w-full flex-col gap-2">
      <Label htmlFor="ai-model">
        <FormattedMessage id="settings.aiAnalysis.model" defaultMessage="Model" />
      </Label>
      {manual ? (
        <Input
          id="ai-model"
          className="w-80 max-w-full"
          required
          maxLength={300}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <>
          {models.length > 0 && (
            <Input
              type="search"
              className="w-80 max-w-full"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={intl.formatMessage({
                id: "settings.aiAnalysis.models.search",
                defaultMessage: "Search models",
              })}
              placeholder={intl.formatMessage({
                id: "settings.aiAnalysis.models.search",
                defaultMessage: "Search models",
              })}
            />
          )}
          <select
            id="ai-model"
            required
            className="h-8 w-120 max-w-full rounded-button border border-border-default bg-raised px-2 text-sm"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="" disabled>
              {intl.formatMessage({
                id: "settings.aiAnalysis.models.choose",
                defaultMessage: "Choose a model",
              })}
            </option>
            {absent && <option value={value}>{value}</option>}
            {filtered.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label === option.id ? option.id : `${option.label} · ${option.id}`}
              </option>
            ))}
          </select>
          {list && absent && (
            <p className="text-xs text-muted">
              <FormattedMessage
                id="settings.aiAnalysis.models.absent"
                defaultMessage="The selected model was not returned in this list. It is kept until you choose another model."
              />
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!azure && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canLoad || loading}
            onClick={() => void load()}
          >
            {loading ? (
              <FormattedMessage
                id="settings.aiAnalysis.models.loading"
                defaultMessage="Loading models…"
              />
            ) : list ? (
              <FormattedMessage
                id="settings.aiAnalysis.models.refresh"
                defaultMessage="Refresh models"
              />
            ) : (
              <FormattedMessage id="settings.aiAnalysis.models.load" defaultMessage="Load models" />
            )}
          </Button>
        )}
        {!azure && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setManual(!manual)}>
            {manual ? (
              <FormattedMessage
                id="settings.aiAnalysis.models.useList"
                defaultMessage="Choose from list"
              />
            ) : (
              <FormattedMessage
                id="settings.aiAnalysis.models.manual"
                defaultMessage="Enter model ID manually"
              />
            )}
          </Button>
        )}
      </div>
      <div aria-live="polite" className="text-xs text-muted">
        {error && <p className="text-status-danger-fg">{error}</p>}
        {list?.models.length === 0 && (
          <p>
            <FormattedMessage
              id="settings.aiAnalysis.models.empty"
              defaultMessage="The provider returned no models for this list. You can enter a model ID manually."
            />
          </p>
        )}
        {list?.truncated && (
          <p>
            <FormattedMessage
              id="settings.aiAnalysis.models.partial"
              defaultMessage="This is a partial model list. Enter the model ID manually if it is missing."
            />
          </p>
        )}
      </div>
      <p className="text-xs text-muted">
        {azure ? (
          <FormattedMessage
            id="settings.aiAnalysis.models.azure"
            defaultMessage="Enter the deployment name from Azure. The deployment endpoint does not provide a list of deployments."
          />
        ) : config.preset === "ollama" ? (
          <FormattedMessage
            id="settings.aiAnalysis.models.ollama"
            defaultMessage="Load models installed in Ollama. This does not download models."
          />
        ) : (
          <FormattedMessage
            id="settings.aiAnalysis.models.hint"
            defaultMessage="Enter the provider key and endpoint, if required, then load models. Loading does not save the connector or send Contract data."
          />
        )}
      </p>
      <p className="text-xs text-muted">
        <FormattedMessage
          id="settings.aiAnalysis.models.testHint"
          defaultMessage="A listed model may not support Contract analysis. Save your choice and use Test connection before running an analysis."
        />
      </p>
    </div>
  );
}
