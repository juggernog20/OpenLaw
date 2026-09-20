// SPDX-License-Identifier: AGPL-3.0-only

import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { AI_ANSWER_STYLES, type AiAnswerStyle } from "@openlaw/shared";
import { api } from "../lib/api";
import { useFieldCommit } from "../lib/field-commit";
import { SettingsCard } from "./settings-card";
import { StatusNote } from "./status-note";

const OPTIONS = {
  few_words: {
    label: defineMessage({
      id: "settings.aiAnalysis.style.fewWords",
      defaultMessage: "Few word summary",
    }),
    description: defineMessage({
      id: "settings.aiAnalysis.style.fewWordsDescription",
      defaultMessage: "A few words that name the position, at most 80 characters.",
    }),
  },
  sentence: {
    label: defineMessage({
      id: "settings.aiAnalysis.style.sentence",
      defaultMessage: "1-2 sentence summary",
    }),
    description: defineMessage({
      id: "settings.aiAnalysis.style.sentenceDescription",
      defaultMessage: "One or two short sentences that state the position, at most 200 characters.",
    }),
  },
  full_clause: {
    label: defineMessage({
      id: "settings.aiAnalysis.style.fullClause",
      defaultMessage: "Full clause text",
    }),
    description: defineMessage({
      id: "settings.aiAnalysis.style.fullClauseDescription",
      defaultMessage:
        "The provision quoted verbatim; short text Fields use a 1-2 sentence summary.",
    }),
  },
};

export function AiAnswerStyleCard({
  value,
  configured,
  onSaved,
}: Readonly<{
  value: AiAnswerStyle;
  configured: boolean;
  onSaved: (value: AiAnswerStyle) => void;
}>) {
  const intl = useIntl();
  const { status, error, commit } = useFieldCommit<"answerStyle">();
  return (
    <SettingsCard
      title={
        <FormattedMessage id="settings.aiAnalysis.answerStyle" defaultMessage="Answer style" />
      }
      collapsible
      defaultOpen={false}
      region
    >
      <fieldset
        className="flex flex-col gap-4"
        disabled={!configured || status.answerStyle === "saving"}
      >
        <legend className="sr-only">
          <FormattedMessage id="settings.aiAnalysis.answerStyle" defaultMessage="Answer style" />
        </legend>
        {AI_ANSWER_STYLES.map((style) => (
          <div key={style} className="flex items-start gap-2">
            <input
              id={`answer-style-${style}`}
              type="radio"
              name="answer-style"
              value={style}
              checked={value === style}
              aria-describedby={`answer-style-${style}-description`}
              className="mt-0.5 size-3.5 accent-cta-primary"
              onChange={() =>
                void commit(
                  "answerStyle",
                  () => api.PATCH("/api/v1/ai-connector", { body: { answerStyle: style } }),
                  (data) => onSaved(data.connector.answerStyle),
                )
              }
            />
            <div>
              <label htmlFor={`answer-style-${style}`} className="text-sm font-medium">
                {intl.formatMessage(OPTIONS[style].label)}
              </label>
              <p id={`answer-style-${style}-description`} className="text-sm text-muted">
                {intl.formatMessage(OPTIONS[style].description)}
              </p>
            </div>
          </div>
        ))}
      </fieldset>
      {!configured && (
        <p className="text-sm text-muted">
          <FormattedMessage
            id="settings.aiAnalysis.style.configureFirst"
            defaultMessage="Connect an AI provider to choose an answer style."
          />
        </p>
      )}
      <StatusNote status={status.answerStyle ?? "idle"} detail={error.answerStyle} />
    </SettingsCard>
  );
}
