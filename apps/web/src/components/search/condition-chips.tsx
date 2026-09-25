// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The results page condition chips (DES-094 clause 4). Each chip shows
 * its kind, property, operator and value; its edit control reopens the
 * dialog on that row, and its remove control runs the question without
 * that condition.
 */

import { type SearchQuestion } from "@openlaw/shared";
import { Link } from "react-router";
import { X } from "lucide-react";
import { useIntl } from "react-intl";
import { useAdvancedSearch } from "./advanced-search";
import { conditionLabel, useConditionDefinitions } from "./condition-definitions";
import { questionPath } from "./search-question";

export function ConditionChips({ question }: Readonly<{ question: SearchQuestion }>) {
  const intl = useIntl();
  const { open } = useAdvancedSearch();
  const definitions = useConditionDefinitions(question.conditions.length ? question.kinds : []);
  return question.conditions.map((condition, index) => {
    const label = conditionLabel(intl, condition, definitions);
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
          <X size={16} aria-hidden="true" />
        </Link>
      </span>
    );
  });
}
