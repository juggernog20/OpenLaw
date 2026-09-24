// SPDX-License-Identifier: AGPL-3.0-only

/** S1's Recent searches list restores a dialog draft. The reader runs it
 * with Search after inspecting or editing the restored question. */

import type { SearchQuestion } from "@openlaw/shared";
import { History } from "lucide-react";
import { useId } from "react";
import { FormattedMessage } from "react-intl";
import { Button } from "../ui/button";
import { useQuestionSummaries } from "./question-summary";

export function RecentSearchList({
  questions,
  onSelect,
  disabled,
}: Readonly<{
  questions: SearchQuestion[];
  onSelect: (question: SearchQuestion) => void;
  disabled: boolean;
}>) {
  const heading = useId();
  const summaries = useQuestionSummaries(questions);
  return (
    <section aria-labelledby={heading} className="min-h-12">
      <h2 id={heading} className="font-semibold">
        <FormattedMessage id="search.recent" defaultMessage="Recent searches" />
      </h2>
      <ul className="mt-1">
        {questions.map((question, index) => (
          <li key={JSON.stringify(question)}>
            <Button
              variant="ghost"
              disabled={disabled}
              className="h-8 w-full justify-start px-0 text-sm font-normal"
              onClick={() => onSelect(question)}
            >
              <History size={16} aria-hidden="true" className="shrink-0 text-muted" />
              <span className="truncate" title={summaries[index]}>
                {summaries[index]}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
