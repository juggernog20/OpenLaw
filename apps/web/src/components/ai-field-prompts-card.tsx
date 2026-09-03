// SPDX-License-Identifier: AGPL-3.0-only

/** The seven editable core prompts used by the next Contract analysis run. */

import { useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { FormattedMessage, useIntl } from "react-intl";
import type { paths } from "@openlaw/api-client";
import { api } from "../lib/api";
import { CORE_ANALYSIS_LABELS } from "../lib/core-analysis-labels";
import { useFieldCommit } from "../lib/field-commit";
import { SettingsCard } from "./settings-card";
import { StatusNote } from "./status-note";
import { Button } from "./ui/button";
import { Label } from "./ui/label";

type PromptList =
  paths["/api/v1/ai-field-prompts"]["get"]["responses"]["200"]["content"]["application/json"];
type Prompt = PromptList["prompts"][number];
type Slug = Prompt["slug"];

function PromptRow({ prompt, adopt }: Readonly<{ prompt: Prompt; adopt: (row: Prompt) => void }>) {
  const intl = useIntl();
  const [draft, setDraft] = useState(prompt.prompt);
  const { status, error, commit, commitText, revertText } = useFieldCommit<Slug>();
  const label = intl.formatMessage(CORE_ANALYSIS_LABELS[prompt.slug]);
  const inputId = `ai-field-prompt-${prompt.slug}`;

  function take(updated: Prompt) {
    setDraft(updated.prompt);
    adopt(updated);
  }

  const field = {
    draft,
    saved: prompt.prompt,
    required: true,
    reset: setDraft,
    send: (value: string) =>
      commit(
        prompt.slug,
        () =>
          api.PUT("/api/v1/ai-field-prompts", {
            body: { slug: prompt.slug, prompt: value },
          }),
        (data) => take(data.prompt),
      ),
  };

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      revertText(prompt.slug, field);
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commitText(prompt.slug, field);
      event.currentTarget.blur();
    }
  }

  async function reset() {
    await commit(
      prompt.slug,
      () =>
        api.PUT("/api/v1/ai-field-prompts", {
          body: { slug: prompt.slug, prompt: null },
        }),
      (data) => take(data.prompt),
    );
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <Label htmlFor={inputId}>{label}</Label>
        <div className="flex items-center gap-2">
          {prompt.overridden && (
            <Button
              type="button"
              variant="link"
              size="sm"
              disabled={status[prompt.slug] === "saving"}
              aria-label={intl.formatMessage(
                {
                  id: "settings.aiAnalysis.prompts.resetLabel",
                  defaultMessage: "Reset {label} to default",
                },
                { label },
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void reset()}
            >
              <FormattedMessage
                id="settings.aiAnalysis.prompts.reset"
                defaultMessage="Reset to default"
              />
            </Button>
          )}
          <StatusNote status={status[prompt.slug] ?? "idle"} detail={error[prompt.slug]} />
        </div>
      </div>
      <textarea
        id={inputId}
        aria-label={intl.formatMessage(
          {
            id: "settings.aiAnalysis.prompts.inputLabel",
            defaultMessage: "{label} prompt",
          },
          { label },
        )}
        rows={2}
        maxLength={2_000}
        required
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commitText(prompt.slug, field)}
        onKeyDown={onKeyDown}
        className="w-full resize-y rounded-button border border-border-default bg-raised px-2 py-1.5 text-sm text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
      />
    </li>
  );
}

export function AiFieldPromptsCard({ initialPrompts }: Readonly<{ initialPrompts: Prompt[] }>) {
  const [prompts, setPrompts] = useState(initialPrompts);

  function adopt(updated: Prompt) {
    setPrompts((current) => current.map((row) => (row.slug === updated.slug ? updated : row)));
  }

  return (
    <SettingsCard
      title={
        <FormattedMessage id="settings.aiAnalysis.prompts.title" defaultMessage="Field prompts" />
      }
      flush
    >
      <ul className="divide-y divide-border-default">
        {prompts.map((prompt) => (
          <PromptRow key={prompt.slug} prompt={prompt} adopt={adopt} />
        ))}
      </ul>
      <p className="border-t border-border-default px-4 py-3 text-sm text-muted">
        <FormattedMessage
          id="settings.aiAnalysis.prompts.catalogPointer"
          defaultMessage="Catalog Fields keep their own analysis prompts in {fields}."
          values={{
            fields: (
              <Link
                className="font-medium text-link hover:underline"
                to="/settings/contracts/fields"
              >
                <FormattedMessage
                  id="settings.aiAnalysis.prompts.catalogLink"
                  defaultMessage="Contracts → Fields"
                />
              </Link>
            ),
          }}
        />
      </p>
    </SettingsCard>
  );
}
