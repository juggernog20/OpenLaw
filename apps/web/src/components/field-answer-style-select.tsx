// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useImperativeHandle, useState, type Ref } from "react";
import { AI_ANSWER_STYLES, type AiAnswerStyle } from "@openlaw/shared";
import { FormattedMessage, useIntl } from "react-intl";
import { api } from "../lib/api";
import { answerStyleLabels } from "../lib/ai-answer-style";
import { Label } from "./ui/label";

export interface FieldAnswerStyleSelectHandle {
  dismissTooltip: () => boolean;
}

export function FieldAnswerStyleSelect({
  ref,
  value,
  onChange,
  shortText,
  disabled,
  className,
}: Readonly<{
  ref?: Ref<FieldAnswerStyleSelectHandle>;
  value: AiAnswerStyle | null;
  onChange: (value: AiAnswerStyle | null) => void;
  shortText: boolean;
  disabled: boolean;
  className: string;
}>) {
  const intl = useIntl();
  const [defaultStyle, setDefaultStyle] = useState<AiAnswerStyle | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const tooltipOpen = shortText && !dismissed && (hovered || focused);
  useImperativeHandle(
    ref,
    () => ({
      dismissTooltip: () => {
        if (!tooltipOpen) return false;
        setDismissed(true);
        return true;
      },
    }),
    [tooltipOpen],
  );
  useEffect(() => {
    let current = true;
    void api
      .GET("/api/v1/ai-connector")
      .then(({ data }) => {
        if (!current) return;
        if (data) setDefaultStyle(data.connector.answerStyle);
        else setLoadFailed(true);
      })
      .catch(() => {
        if (current) setLoadFailed(true);
      });
    return () => {
      current = false;
    };
  }, []);
  const reason = intl.formatMessage({
    id: "settings.contractFields.fullClauseNeedsLongText",
    defaultMessage: "Full clause text needs a long text Field.",
  });
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="field-answer-style">
        <FormattedMessage id="settings.aiAnalysis.answerStyle" defaultMessage="Answer style" />
      </Label>
      <div
        className="relative"
        onMouseEnter={() => {
          setHovered(true);
          setDismissed(false);
        }}
        onMouseLeave={() => setHovered(false)}
      >
        <select
          id="field-answer-style"
          className={className}
          value={value ?? ""}
          disabled={disabled}
          aria-describedby={shortText ? "field-answer-style-reason" : undefined}
          onChange={(event) =>
            onChange(event.target.value === "" ? null : (event.target.value as AiAnswerStyle))
          }
          onFocus={() => {
            setFocused(true);
            setDismissed(false);
          }}
          onBlur={() => setFocused(false)}
        >
          <option value="">
            {defaultStyle
              ? intl.formatMessage(
                  {
                    id: "settings.contractFields.organisationDefaultStyle",
                    defaultMessage: "Organisation default ({style})",
                  },
                  { style: intl.formatMessage(answerStyleLabels[defaultStyle]) },
                )
              : intl.formatMessage({
                  id: "settings.contractFields.organisationDefault",
                  defaultMessage: "Organisation default",
                })}
          </option>
          {AI_ANSWER_STYLES.map((style) => (
            <option
              key={style}
              value={style}
              disabled={shortText && style === "full_clause"}
              title={shortText && style === "full_clause" ? reason : undefined}
            >
              {intl.formatMessage(answerStyleLabels[style])}
            </option>
          ))}
        </select>
        {shortText && (
          <p
            id="field-answer-style-reason"
            role="tooltip"
            hidden={!tooltipOpen}
            className="absolute top-full z-10 mt-1 rounded-button border border-border-default bg-raised p-2 text-xs text-primary shadow-sm"
          >
            {reason}
          </p>
        )}
      </div>
      {loadFailed && (
        <p role="status" className="text-xs text-muted">
          <FormattedMessage
            id="settings.contractFields.styleDefaultLoadError"
            defaultMessage="The current organisation default could not be loaded."
          />
        </p>
      )}
    </div>
  );
}
