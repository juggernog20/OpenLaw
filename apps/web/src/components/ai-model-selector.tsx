// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Provider card's model control (SET-008, #791). One combobox does
 * the choosing: focus opens the loaded list, typing narrows it by display
 * name or model ID, Arrow keys walk it, Enter commits, Escape reverts.
 * Hand-rolled on the WAI-ARIA combobox pattern like the DES-014 timezone
 * picker, because a native select cannot search-narrow and Radix has no
 * combobox primitive.
 *
 * The parent remounts this control when credentials or the destination
 * change, which drops the loaded list. Manual entry is the Administrator's
 * own choice, so the parent holds it and it survives that remount.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { CONTROL_CLASS } from "../lib/form-controls";
import { problem } from "../lib/problem";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Discovery = paths["/api/v1/ai-connector/models"]["post"];
type ModelList = Discovery["responses"]["200"]["content"]["application/json"];
type Config = Discovery["requestBody"]["content"]["application/json"];

function optionText(option: { id: string; label: string }) {
  return option.label === option.id ? option.id : `${option.label} · ${option.id}`;
}

export function AiModelSelector({
  config,
  canLoad,
  value,
  onChange,
  manualEntry,
  onManualEntryChange,
}: Readonly<{
  config: Config;
  canLoad: boolean;
  value: string;
  onChange: (value: string) => void;
  manualEntry: boolean;
  onManualEntryChange: (manual: boolean) => void;
}>) {
  const intl = useIntl();
  const azure = config.preset === "azure_openai";
  const manual = azure || manualEntry;
  const [list, setList] = useState<ModelList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ query: string; activeIndex: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
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

  const models = useMemo(() => list?.models ?? [], [list]);
  const filtered = useMemo(() => {
    const query = editing?.query.trim().toLowerCase() ?? "";
    if (!query) return models;
    return models.filter((option) => `${option.label} ${option.id}`.toLowerCase().includes(query));
  }, [editing, models]);
  const activeIndex = editing ? Math.min(editing.activeIndex, filtered.length - 1) : -1;
  const activeOption = activeIndex >= 0 ? filtered[activeIndex] : undefined;
  const optionId = (index: number) => `${listboxId}-${index}`;
  const absent = value !== "" && !models.some((option) => option.id === value);

  function open() {
    const current = models.findIndex((option) => option.id === value);
    setEditing({ query: "", activeIndex: Math.max(current, 0) });
  }

  function commit(id: string) {
    setEditing(null);
    if (id !== value) onChange(id);
    inputRef.current?.blur();
  }

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
          <div className="relative w-120 max-w-full">
            <input
              ref={inputRef}
              id="ai-model"
              role="combobox"
              required
              aria-expanded={editing !== null}
              aria-controls={listboxId}
              aria-activedescendant={activeOption ? optionId(activeIndex) : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              placeholder={
                list
                  ? intl.formatMessage({
                      id: "settings.aiAnalysis.models.search",
                      defaultMessage: "Search models",
                    })
                  : intl.formatMessage({
                      id: "settings.aiAnalysis.models.choose",
                      defaultMessage: "Choose a model",
                    })
              }
              className={CONTROL_CLASS}
              value={editing ? editing.query : value}
              onFocus={open}
              onChange={(event) => setEditing({ query: event.target.value, activeIndex: 0 })}
              // Focus loss reverts to the committed model (DES-017); rows
              // commit on pointerdown, ahead of the blur.
              onBlur={() => setEditing(null)}
              onKeyDown={(event) => {
                if (!editing) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const count = filtered.length;
                  if (count === 0) return;
                  const delta = event.key === "ArrowDown" ? 1 : -1;
                  setEditing({
                    query: editing.query,
                    activeIndex: (activeIndex + delta + count) % count,
                  });
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (activeOption) commit(activeOption.id);
                }
                if (event.key === "Escape") {
                  // Local dismiss, as DES-010 reserves the key for.
                  event.preventDefault();
                  event.stopPropagation();
                  setEditing(null);
                  inputRef.current?.blur();
                }
              }}
            />
            <ul // NOSONAR — a select/datalist cannot search-narrow (DES-014)
              id={listboxId}
              role="listbox"
              aria-label={intl.formatMessage({
                id: "settings.aiAnalysis.models.list",
                defaultMessage: "Models",
              })}
              className={cn(
                "absolute top-full z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-card border border-border-default bg-raised py-1",
                editing === null && "hidden",
              )}
            >
              {editing !== null &&
                filtered.map((option, index) => (
                  <li
                    key={option.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={option.id === value}
                    className={cn(
                      "cursor-default truncate px-2 py-1 text-sm text-primary",
                      index === activeIndex && "bg-control",
                    )}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      commit(option.id);
                    }}
                    onMouseMove={() => {
                      if (activeIndex !== index)
                        setEditing({ query: editing.query, activeIndex: index });
                    }}
                  >
                    {optionText(option)}
                  </li>
                ))}
              {/* A disabled option, not role="presentation": non-option children
                  of a listbox are not reliably exposed, so an empty list would
                  read as silence to assistive technology. */}
              {editing !== null && filtered.length === 0 && (
                <li
                  className="px-2 py-1 text-sm text-muted"
                  role="option"
                  aria-disabled="true"
                  aria-selected={false}
                >
                  {list ? (
                    <FormattedMessage
                      id="settings.aiAnalysis.models.noMatches"
                      defaultMessage="No matching models."
                    />
                  ) : (
                    <FormattedMessage
                      id="settings.aiAnalysis.models.unloaded"
                      defaultMessage="Load models to choose from a list, or enter the model ID manually."
                    />
                  )}
                </li>
              )}
            </ul>
          </div>
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onManualEntryChange(!manual)}
          >
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
      {azure && (
        <p className="text-xs text-muted">
          <FormattedMessage
            id="settings.aiAnalysis.models.azure"
            defaultMessage="Enter the deployment name from Azure. The deployment endpoint does not provide a list of deployments."
          />
        </p>
      )}
      {config.preset === "groq" && (
        <p className="text-xs text-muted">
          <FormattedMessage
            id="settings.aiAnalysis.models.groq"
            defaultMessage="Groq models are filtered by model family. Use Test connection to check the selected model."
          />
        </p>
      )}
      {config.preset === "ollama" && (
        <p className="text-xs text-muted">
          <FormattedMessage
            id="settings.aiAnalysis.models.ollama"
            defaultMessage="Load models installed in Ollama. This does not download models."
          />
        </p>
      )}
    </div>
  );
}
