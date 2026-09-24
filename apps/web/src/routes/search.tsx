// SPDX-License-Identifier: AGPL-3.0-only

/** Ranked results with the question held in the URL for reload, sharing and Back. */
import { DEFAULT_SEARCH_SCOPE, SearchQuestionSchema, type SearchQuestion } from "@openlaw/shared";
import { useEffect, useState } from "react";
import { Search as SearchIcon, X } from "lucide-react";
import { defineMessages, FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { Link, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import {
  querySearch,
  type SearchKind,
  type QuestionSearchOutcome,
  type SearchResult,
} from "../lib/search";
import { requireUser, useSignOut } from "../lib/session";
import { recordRecentSearch } from "../lib/recent-searches";
import { cn } from "../lib/utils";
import { PageTitle } from "../components/page-title";
import {
  SEARCH_KIND_ORDER,
  SearchResultRow,
  searchKindLabel,
} from "../components/search/search-result-row";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { Button } from "../components/ui/button";

import {
  readSearchFields,
  dropUnavailableFields,
  FIELD_NOTICES,
} from "../components/search/field-definitions";
import { ConditionChips } from "../components/search/condition-chips";
import { SearchSort } from "../components/search/search-sort";
import { AdvancedSearchButton } from "../components/search/advanced-search";
import {
  questionFromSearch,
  questionIsEmpty,
  questionPath,
  WORD_LABELS,
  SCOPE_LABELS,
  CHIP_CLASS,
  IDLE_CHIP_CLASS,
  SELECTED_CHIP_CLASS,
} from "../components/search/search-question";

const PAGE_SIZE = 25;

const MESSAGES: Record<
  | "prompt"
  | "results"
  | "resultsFor"
  | "allKinds"
  | "filterLabel"
  | "noMatches"
  | "noMatchesBody"
  | "error"
  | "moreError"
  | "showMore",
  MessageDescriptor
> = defineMessages({
  prompt: {
    id: "search.page.prompt",
    defaultMessage: "Search contracts, matters, documents, entities, counterparties, and requests",
  },
  results: { id: "search.page.results", defaultMessage: "Search results" },
  resultsFor: {
    id: "search.page.resultsFor",
    defaultMessage: "Search results for “{query}”",
  },
  allKinds: { id: "search.kind.all", defaultMessage: "All" },
  filterLabel: { id: "search.filter.label", defaultMessage: "Filter search results" },
  noMatches: { id: "search.noMatches", defaultMessage: "No matches" },
  noMatchesBody: {
    id: "search.noMatchesBody",
    defaultMessage: "No matches for “{query}”. Try another word or record number.",
  },
  error: { id: "search.page.error", defaultMessage: "Search could not load. Try again." },
  moreError: {
    id: "search.page.moreError",
    defaultMessage: "The next results could not be read. Try again.",
  },
  showMore: { id: "search.page.showMore", defaultMessage: "Show more" },
});

export async function searchLoader({ request }: LoaderFunctionArgs) {
  const user = await requireUser();
  if (user.role === "business_user") return redirect("/portal");

  const original = questionFromSearch(new URL(request.url).search);
  const catalog = original.conditions.some((condition) => condition.property.startsWith("field:"))
    ? await readSearchFields().catch(() => null)
    : null;
  const question = catalog ? dropUnavailableFields(original, catalog.fields) : original;
  const fieldsRemoved = question !== original;
  const query = Object.values(question.words).filter(Boolean).join(" ");
  const empty = questionIsEmpty(question);
  const outcome: QuestionSearchOutcome = empty
    ? { ok: true, results: [], total: 0, nextCursor: null }
    : await querySearch(question, { limit: PAGE_SIZE });
  return { user, query, question, empty, outcome, fieldsRemoved };
}

function QuestionFilters({ question }: Readonly<{ question: SearchQuestion }>) {
  const intl = useIntl();
  const chips: { key: string; label: string; question: SearchQuestion }[] = (
    Object.keys(WORD_LABELS) as (keyof typeof WORD_LABELS)[]
  )
    .filter((key) => question.words[key])
    .map((key) => ({
      key,
      label: intl.formatMessage(
        { id: "search.chip.words", defaultMessage: "{label}: {value}" },
        { label: intl.formatMessage(WORD_LABELS[key]), value: question.words[key] },
      ),
      question: { ...question, words: { ...question.words, [key]: "" } },
    }));
  if (!Object.values(question.scope).every(Boolean)) {
    const scope = (Object.keys(SCOPE_LABELS) as (keyof typeof SCOPE_LABELS)[])
      .filter((key) => question.scope[key])
      .map((key) => intl.formatMessage(SCOPE_LABELS[key]))
      .join(", ");
    chips.push({
      key: "scope",
      label: intl.formatMessage(
        { id: "search.scope.chip", defaultMessage: "Search in: {scope}" },
        { scope },
      ),
      question: { ...question, scope: { ...DEFAULT_SEARCH_SCOPE } },
    });
  }
  const choices: { kind?: SearchKind; label: string }[] = [
    { label: intl.formatMessage(MESSAGES.allKinds) },
    ...SEARCH_KIND_ORDER.map((kind) => ({ kind, label: searchKindLabel(intl, kind) })),
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Link
          key={chip.key}
          to={questionPath(chip.question)}
          className={cn(CHIP_CLASS, IDLE_CHIP_CLASS, "inline-flex items-center gap-1")}
          aria-label={intl.formatMessage(
            { id: "search.chip.remove", defaultMessage: "Remove {label}" },
            { label: chip.label },
          )}
        >
          {chip.label}
          <X size={14} aria-hidden="true" />
        </Link>
      ))}
      <ConditionChips question={question} />
      <nav aria-label={intl.formatMessage(MESSAGES.filterLabel)} className="flex flex-wrap gap-2">
        {choices.map(({ kind, label }) => {
          const selected = kind ? question.kinds.includes(kind) : question.kinds.length === 0;
          return (
            <Link
              key={kind ?? "all"}
              to={questionPath({
                ...question,
                kinds: kind ? [kind] : [],
                conditions: question.conditions.filter((condition) => condition.kind === kind),
              })}
              aria-current={selected ? "page" : undefined}
              className={cn(CHIP_CLASS, selected ? SELECTED_CHIP_CLASS : IDLE_CHIP_CLASS)}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function SearchAnswer({
  query,
  question,
  empty,
  initial,
}: Readonly<{
  query: string;
  question: SearchQuestion;
  empty: boolean;
  initial: QuestionSearchOutcome;
}>) {
  const intl = useIntl();
  const [rows, setRows] = useState<SearchResult[]>(initial.ok ? initial.results : []);
  const [cursor, setCursor] = useState<string | null>(initial.ok ? initial.nextCursor : null);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  async function showMore() {
    if (busy || cursor === null) return;
    setBusy(true);
    setPageError(null);
    const answer = await querySearch(question, { cursor, limit: PAGE_SIZE });
    setBusy(false);
    if (!answer.ok) {
      setPageError(answer.detail ?? intl.formatMessage(MESSAGES.moreError));
      return;
    }
    setRows((current) => [...current, ...answer.results]);
    setCursor(answer.nextCursor);
  }

  if (!initial.ok) {
    return (
      <p
        role="alert"
        className="rounded-card border border-status-danger-fg bg-raised px-4 py-3 text-sm text-status-danger-fg"
      >
        {initial.detail ?? intl.formatMessage(MESSAGES.error)}
      </p>
    );
  }

  if (empty) {
    return (
      <p className="rounded-card border border-border-default bg-raised px-6 py-12 text-center text-sm text-muted">
        <FormattedMessage {...MESSAGES.prompt} />
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-card border border-border-default bg-raised px-6 py-12 text-center">
        <h2 className="text-md font-semibold">
          <FormattedMessage {...MESSAGES.noMatches} />
        </h2>
        <p className="text-sm text-muted">
          {query ? (
            <FormattedMessage {...MESSAGES.noMatchesBody} values={{ query }} />
          ) : (
            <FormattedMessage
              id="search.question.noMatches"
              defaultMessage="No records match this question."
            />
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="overflow-hidden rounded-card border border-border-default bg-raised">
        {rows.map((result, index) => (
          <li key={`${result.kind}:${result.id}:${String(index)}`}>
            <SearchResultRow result={result} query={query} />
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-3">
        {pageError && (
          <p role="alert" className="text-xs text-status-danger-fg">
            {pageError}
          </p>
        )}
        {cursor !== null && (
          <Button variant="secondary" disabled={busy} onClick={() => void showMore()}>
            <FormattedMessage {...MESSAGES.showMore} />
          </Button>
        )}
      </div>
    </div>
  );
}

export function SearchPage() {
  const loaded = useLoaderData<typeof searchLoader>();
  const intl = useIntl();

  // Notify history readers after the route commits, so the storage update
  // cannot interrupt a pending navigation or record a cancelled one.
  useEffect(() => {
    if (!loaded.empty) recordRecentSearch(loaded.user.id, loaded.question);
  }, [loaded.user.id, loaded.question, loaded.empty]);

  const signOut = useSignOut("/auth/login");

  const title = loaded.empty
    ? intl.formatMessage(MESSAGES.prompt)
    : loaded.query
      ? intl.formatMessage(MESSAGES.resultsFor, { query: loaded.query })
      : intl.formatMessage(MESSAGES.results);
  return (
    <AppShell
      user={loaded.user}
      onSignOut={() => void signOut()}
      subbar={
        <PageSubBar
          title={
            <span className="flex items-center gap-2.5">
              <SearchIcon size={18} aria-hidden="true" className="text-muted" />
              {title}
            </span>
          }
          filters={
            <div className="flex flex-wrap items-start justify-between gap-3">
              {(loaded.empty || SearchQuestionSchema.safeParse(loaded.question).success) && (
                <QuestionFilters question={loaded.question} />
              )}
              <AdvancedSearchButton />
              {SearchQuestionSchema.safeParse(loaded.question).success && (
                <div className="ml-auto shrink-0">
                  <SearchSort question={loaded.question} />
                </div>
              )}
            </div>
          }
        />
      }
    >
      <PageTitle title={title} />
      {loaded.fieldsRemoved && (
        <p role="status" className="mb-3 text-sm text-muted">
          <FormattedMessage {...FIELD_NOTICES.removed} />
        </p>
      )}
      {loaded.outcome.ok && !loaded.empty && (
        <p className="mb-3 text-sm text-muted">
          <FormattedMessage
            id="search.total"
            defaultMessage="{total, plural, one {# match} other {# matches}}"
            values={{ total: loaded.outcome.total }}
          />
        </p>
      )}
      <SearchAnswer
        key={JSON.stringify(loaded.question)}
        query={loaded.query}
        question={loaded.question}
        empty={loaded.empty}
        initial={loaded.outcome}
      />
    </AppShell>
  );
}
