// SPDX-License-Identifier: AGPL-3.0-only

import {
  decodeSearchQuestion,
  encodeSearchQuestion,
  simpleSearchQuestion,
  type SearchQuestion,
} from "@openlaw/shared";
import { defineMessages } from "react-intl";
import { SEARCH_KIND_ORDER } from "./search-result-row";

export function questionFromSearch(search: string): SearchQuestion {
  const params = new URLSearchParams(search);
  const kind = SEARCH_KIND_ORDER.find((value) => value === params.get("kind"));
  return (
    decodeSearchQuestion(params.get("aq") ?? "") ??
    simpleSearchQuestion((params.get("q") ?? "").trim(), kind ? [kind] : [])
  );
}

export function questionIsEmpty(question: SearchQuestion): boolean {
  return (
    !Object.values(question.words).some((words) => words.trim()) &&
    !question.kinds.length &&
    !question.conditions.length
  );
}

export function questionPath(question: SearchQuestion): string {
  return questionIsEmpty(question) ? "/search" : `/search?aq=${encodeSearchQuestion(question)}`;
}

export const WORD_LABELS = defineMessages({
  all: { id: "search.words.all", defaultMessage: "All of these words" },
  phrase: { id: "search.words.phrase", defaultMessage: "This exact phrase" },
  any: { id: "search.words.any", defaultMessage: "Any of these words" },
  none: { id: "search.words.none", defaultMessage: "None of these words" },
});
export const SCOPE_LABELS = defineMessages({
  titles: { id: "search.scope.titles", defaultMessage: "Titles and numbers" },
  text: { id: "search.scope.text", defaultMessage: "Record text" },
  contents: { id: "search.scope.contents", defaultMessage: "Document contents" },
});
export const CHIP_CLASS =
  "rounded-chip border px-2.5 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link";
export const IDLE_CHIP_CLASS = "border-border-default bg-control text-muted hover:text-primary";
export const SELECTED_CHIP_CLASS =
  "border-status-info-fg bg-status-info-bg font-semibold text-status-info-fg";
