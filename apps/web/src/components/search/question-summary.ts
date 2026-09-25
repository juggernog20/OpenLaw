// SPDX-License-Identifier: AGPL-3.0-only

/** Compiles S1 and S5's recent-question summaries using the same property,
 * choice, and relative-date labels as the results-page condition chips. */

import type { SearchQuestion } from "@openlaw/shared";
import { defineMessages, useIntl, type MessageDescriptor } from "react-intl";
import { conditionParts, useConditionDefinitions } from "./condition-definitions";
import { SCOPE_LABELS, WORD_LABELS } from "./search-question";
import { SORT_LABELS } from "./search-sort";

// S5 reads a condition as "Matter Manager is Me": the kind is already the
// question's kinds part, so the chip's kind prefix would only repeat it.
const CONDITION_LABELS: Record<"absolute" | "relative", MessageDescriptor> = defineMessages({
  absolute: { id: "search.summary.condition", defaultMessage: "{property} {operator} {value}" },
  relative: { id: "search.summary.relativeCondition", defaultMessage: "{property} {operator}" },
});

const KIND_LABELS = defineMessages({
  contract: { id: "search.summary.contract", defaultMessage: "Contracts" },
  matter: { id: "search.summary.matter", defaultMessage: "Matters" },
  document: { id: "search.summary.document", defaultMessage: "Documents" },
  entity: { id: "search.summary.entity", defaultMessage: "Entities" },
  counterparty: { id: "search.summary.counterparty", defaultMessage: "Counterparties" },
  request: { id: "search.summary.request", defaultMessage: "Requests" },
  knowledge_item: { id: "search.summary.knowledge", defaultMessage: "Knowledge Items" },
});

export function useQuestionSummaries(questions: SearchQuestion[]): string[] {
  const intl = useIntl();
  const definitions = useConditionDefinitions([
    ...new Set(
      questions.flatMap((question) => question.conditions.map((condition) => condition.kind)),
    ),
  ]);
  return questions.map((question) => {
    const parts = (Object.keys(WORD_LABELS) as (keyof typeof WORD_LABELS)[])
      .filter((key) => question.words[key])
      .map((key) =>
        key === "all"
          ? question.words[key]
          : intl.formatMessage(
              { id: "search.chip.words", defaultMessage: "{label}: {value}" },
              { label: intl.formatMessage(WORD_LABELS[key]), value: question.words[key] },
            ),
      );
    if (question.kinds.length)
      parts.push(question.kinds.map((kind) => intl.formatMessage(KIND_LABELS[kind])).join(" + "));
    if (!Object.values(question.scope).every(Boolean)) {
      parts.push(
        (Object.keys(SCOPE_LABELS) as (keyof typeof SCOPE_LABELS)[])
          .filter((key) => question.scope[key])
          .map((key) => intl.formatMessage(SCOPE_LABELS[key]))
          .join(" + "),
      );
    }
    // Match all is the default and reads as S5's plain "·" list; match any
    // spells its joiner so two questions that differ only there look different.
    const conditions = question.conditions.map((condition) => {
      const { relative, ...values } = conditionParts(intl, condition, definitions);
      return intl.formatMessage(
        relative ? CONDITION_LABELS.relative : CONDITION_LABELS.absolute,
        values,
      );
    });
    if (conditions.length)
      parts.push(
        conditions.join(
          question.match === "any"
            ? ` ${intl.formatMessage({ id: "search.summary.or", defaultMessage: "OR" })} `
            : " · ",
        ),
      );
    if (question.sort !== "relevance")
      parts.push(
        intl.formatMessage(
          { id: "search.sort.label", defaultMessage: "Sort: {sort}" },
          { sort: intl.formatMessage(SORT_LABELS[question.sort]) },
        ),
      );
    return parts.filter(Boolean).join(" · ");
  });
}
