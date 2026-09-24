// SPDX-License-Identifier: AGPL-3.0-only

/** Compiles S1 and S5's recent-question summaries using the same property,
 * choice, and relative-date labels as the results-page condition chips. */

import type { SearchQuestion } from "@openlaw/shared";
import { defineMessages, useIntl } from "react-intl";
import { conditionLabel, useConditionDefinitions } from "./condition-definitions";
import { SCOPE_LABELS, WORD_LABELS } from "./search-question";
import { SORT_LABELS } from "./search-sort";

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
    const conditions = question.conditions.map((condition) =>
      conditionLabel(intl, condition, definitions),
    );
    if (conditions.length)
      parts.push(
        conditions.join(
          ` ${
            question.match === "any"
              ? intl.formatMessage({ id: "search.summary.or", defaultMessage: "OR" })
              : intl.formatMessage({ id: "search.summary.and", defaultMessage: "AND" })
          } `,
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
