// SPDX-License-Identifier: AGPL-3.0-only
import { isRelativeDateOperator, type SearchQuestion } from "@openlaw/shared";
import { Link } from "react-router";
import { X } from "lucide-react";
import { defineMessages, useIntl, type MessageDescriptor } from "react-intl";
import { useAdvancedSearch } from "./advanced-search";
import { operatorLabel, propertyLabel, useConditionDefinitions } from "./condition-definitions";
import { searchKindLabel } from "./search-result-row";
import { questionPath } from "./search-question";

const CHIP_LABELS: Record<"absolute" | "relative", MessageDescriptor> = defineMessages({
  absolute: { id: "search.condition.chip", defaultMessage: "{kind} {property} {operator} {value}" },
  relative: { id: "search.condition.relativeChip", defaultMessage: "{kind} {property} {operator}" },
});

export function ConditionChips({ question }: Readonly<{ question: SearchQuestion }>) {
  const intl = useIntl();
  const { open } = useAdvancedSearch();
  const { choices } = useConditionDefinitions(question.conditions.length ? question.kinds : []);
  return question.conditions.map((condition, index) => {
    const options = choices(condition);
    const value = Array.isArray(condition.value)
      ? condition.value
          .map(
            (value) => options.find((option) => option.id === value)?.displayName ?? String(value),
          )
          .join(", ")
      : typeof condition.value === "boolean"
        ? condition.value
          ? intl.formatMessage({ id: "search.condition.yes", defaultMessage: "Yes" })
          : intl.formatMessage({ id: "search.condition.no", defaultMessage: "No" })
        : String(condition.value);
    const relative = isRelativeDateOperator(condition.operator);
    const label = intl.formatMessage(relative ? CHIP_LABELS.relative : CHIP_LABELS.absolute, {
      kind: searchKindLabel(intl, condition.kind),
      property: propertyLabel(intl, condition.kind, condition.property),
      operator: operatorLabel(
        intl,
        condition.operator,
        typeof condition.value === "number" ? condition.value : "N",
      ),
      value,
    });
    return (
      <span
        key={index}
        className="inline-flex max-w-full items-center rounded-chip border border-border-default bg-control text-sm"
      >
        <button
          type="button"
          className="min-h-8 truncate rounded-s-chip px-2.5 text-start hover:text-primary focus-visible:outline-2 focus-visible:outline-link"
          aria-label={intl.formatMessage(
            { id: "search.chip.edit", defaultMessage: "Edit {label}" },
            { label },
          )}
          onClick={() => open(question, index)}
        >
          {label}
        </button>
        <Link
          className="flex min-h-8 w-8 shrink-0 items-center justify-center rounded-e-chip border-s border-border-default text-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-link"
          to={questionPath({
            ...question,
            conditions: question.conditions.filter((_, at) => at !== index),
          })}
          aria-label={intl.formatMessage(
            { id: "search.chip.remove", defaultMessage: "Remove {label}" },
            { label },
          )}
        >
          <X size={14} aria-hidden="true" />
        </Link>
      </span>
    );
  });
}
