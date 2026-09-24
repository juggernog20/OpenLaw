// SPDX-License-Identifier: AGPL-3.0-only

import type { SearchQuestion } from "@openlaw/shared";
import { ChevronDown } from "lucide-react";
import { defineMessages, useIntl } from "react-intl";
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

const SORT_LABELS = defineMessages({
  relevance: { id: "search.sort.relevance", defaultMessage: "Relevance" },
  newest: { id: "search.sort.newest", defaultMessage: "Newest" },
  oldest: { id: "search.sort.oldest", defaultMessage: "Oldest" },
  expiry: { id: "search.sort.expiry", defaultMessage: "Expiry soonest" },
  title: { id: "search.sort.title", defaultMessage: "Title" },
});

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
        <Button variant="secondary" disabled={questionIsEmpty(question)}>
          {label}
          <ChevronDown size={16} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label={label}>
        <DropdownMenuRadioGroup
          value={question.sort}
          onValueChange={(value) => {
            const sort = (Object.keys(SORT_LABELS) as SearchQuestion["sort"][]).find(
              (key) => key === value,
            );
            if (sort && sort !== question.sort) void navigate(questionPath({ ...question, sort }));
          }}
        >
          {(Object.keys(SORT_LABELS) as SearchQuestion["sort"][]).map((sort) => (
            <DropdownMenuRadioItem key={sort} value={sort}>
              {intl.formatMessage(SORT_LABELS[sort])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
