// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The results-page sort menu writes the URL question. The trigger shows the
 * active sort's name, as the S4 mock does, with DES-046's trailing chevron;
 * its accessible name adds the "Sort:" prefix so the menu says what it sorts.
 */

import { SearchQuestionSchema, type SearchQuestion } from "@openlaw/shared";
import { ChevronDown } from "lucide-react";
import { defineMessages, useIntl, type MessageDescriptor } from "react-intl";
import { useNavigate } from "react-router";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { questionIsEmpty, questionPath } from "./search-question";

const SORT_KEYS = SearchQuestionSchema.shape.sort.options;
const SORT_LABELS = defineMessages({
  relevance: { id: "search.sort.relevance", defaultMessage: "Relevance" },
  newest: { id: "search.sort.newest", defaultMessage: "Newest" },
  oldest: { id: "search.sort.oldest", defaultMessage: "Oldest" },
  expiry: { id: "search.sort.expiry", defaultMessage: "Expiry soonest" },
  title: { id: "search.sort.title", defaultMessage: "Title" },
} satisfies Record<SearchQuestion["sort"], MessageDescriptor>);

export function SearchSort({ question }: Readonly<{ question: SearchQuestion }>) {
  const intl = useIntl();
  const navigate = useNavigate();
  const label = intl.formatMessage(
    { id: "search.sort.label", defaultMessage: "Sort: {sort}" },
    { sort: intl.formatMessage(SORT_LABELS[question.sort]) },
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" disabled={questionIsEmpty(question)} aria-label={label}>
          {intl.formatMessage(SORT_LABELS[question.sort])}
          <ChevronDown size={16} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label={label}>
        <DropdownMenuRadioGroup
          value={question.sort}
          onValueChange={(value) => {
            const sort = SORT_KEYS.find((key) => key === value);
            if (sort && sort !== question.sort) void navigate(questionPath({ ...question, sort }));
          }}
        >
          {SORT_KEYS.map((sort) => (
            <DropdownMenuRadioItem key={sort} value={sort}>
              {intl.formatMessage(SORT_LABELS[sort])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
