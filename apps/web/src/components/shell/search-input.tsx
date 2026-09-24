// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Header search box and M25 grouped results listbox. The input remains
 * DES-010's `/` target while the local combobox owns Arrow, Enter, and
 * Escape.
 */

import { SearchQuestionSchema, simpleSearchQuestion } from "@openlaw/shared";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bookmark,
  History,
  LoaderCircle,
  SearchX,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import { defineMessages, FormattedMessage, useIntl, type MessageDescriptor } from "react-intl";
import { useLocation, useNavigate } from "react-router";
import { registerSearchTarget, SEARCH_KEY } from "../../lib/keyboard";
import { search, type SearchOutcome } from "../../lib/search";
import {
  SEARCH_KIND_ORDER,
  SearchResultRow,
  searchKindLabel,
  searchPagePath,
  searchResultPath,
} from "../search/search-result-row";

import { useAdvancedSearch } from "../search/advanced-search";
import { questionFromSearch, questionPath } from "../search/search-question";
import { useEmptySearchEntries } from "../search/empty-search-entries";

const SEARCH_DEBOUNCE_MS = 150;
const MIN_QUERY_LENGTH = 2;

const MESSAGES: Record<
  | "label"
  | "listLabel"
  | "placeholder"
  | "searching"
  | "searchingBody"
  | "noMatches"
  | "noMatchesBody"
  | "errorTitle"
  | "errorBody"
  | "seeAll"
  | "advanced"
  | "advancedTitle",
  MessageDescriptor
> = defineMessages({
  label: { id: "search.header.label", defaultMessage: "Search" },
  listLabel: { id: "search.header.listLabel", defaultMessage: "Search results" },
  placeholder: {
    id: "shell.search.placeholder",
    // Keep the shortcut interpolation in this established message. The
    // visible key stays in the chip, so this value is deliberately empty.
    defaultMessage: "Search contracts, matters, documents…{key}",
  },
  searching: { id: "search.searching", defaultMessage: "Searching…" },
  searchingBody: {
    id: "search.searchingBody",
    defaultMessage:
      "Looking across Contracts, Matters, Documents, Entities, Counterparties, and Requests.",
  },
  noMatches: { id: "search.noMatches", defaultMessage: "No matches" },
  noMatchesBody: {
    id: "search.noMatchesBody",
    defaultMessage: "No matches for “{query}”. Try another word or record number.",
  },
  errorTitle: { id: "search.error.title", defaultMessage: "Search could not load" },
  errorBody: {
    id: "search.error.body",
    defaultMessage: "The server did not answer. Try again in a moment.",
  },
  advanced: { id: "search.advanced.entry", defaultMessage: "Advanced search…" },
  advancedTitle: { id: "search.advanced.title", defaultMessage: "Advanced search" },
  seeAll: { id: "search.seeAll", defaultMessage: "See all results" },
});

function routeQuery(pathname: string, searchString: string): string {
  if (pathname !== "/search") return "";
  return questionFromSearch(searchString).words.all;
}

export function SearchInput() {
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const advanced = useAdvancedSearch();
  const [query, setQuery] = useState(() => routeQuery(location.pathname, location.search));
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const popoverId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  // Stable across renders: an inline callback would re-run every render
  // (React 19 reruns a changed ref callback), pushing this input past a
  // page-level one in the `/` dispatch order. DES-010 keys precedence
  // to mount order.
  const searchTargetRef = useCallback(
    (element: HTMLInputElement | null) => (element ? registerSearchTarget(element) : undefined),
    [],
  );
  const trimmed = query.trim();
  const emptyBox = query.length === 0;
  const groups = useEmptySearchEntries(open && emptyBox && !advanced.draft);
  const entries = groups.flatMap((group) => group.entries);
  const resultsOpen = open && !advanced.draft && trimmed.length >= MIN_QUERY_LENGTH;
  const historyOpen = open && !advanced.draft && emptyBox && entries.length > 0;
  const listOpen = resultsOpen || historyOpen;

  useEffect(() => {
    if (!resultsOpen) return;
    let live = true;
    const timer = setTimeout(() => {
      void search(trimmed).then((answer) => {
        if (!live) return;
        setOutcome(answer);
        setSearching(false);
        setActiveIndex(0);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [resultsOpen, trimmed]);

  const results = useMemo(() => {
    if (!outcome?.ok) return [];
    return SEARCH_KIND_ORDER.flatMap((kind) => outcome.results.filter((row) => row.kind === kind));
  }, [outcome]);
  const visibleResults = searching || emptyBox ? [] : results;
  const optionCount = emptyBox ? entries.length + 1 : visibleResults.length + 2;
  const active = Math.min(activeIndex, Math.max(optionCount - 1, 0));
  const optionId = (index: number) => `${popoverId}-option-${String(index)}`;
  const activeOptionId = optionId(active);

  useEffect(() => {
    if (!listOpen || optionCount === 0) return;
    document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId, listOpen, optionCount]);

  function close() {
    setOpen(false);
    setSearching(false);
  }

  function currentQuestion() {
    const base =
      location.pathname === "/search"
        ? questionFromSearch(location.search)
        : simpleSearchQuestion();
    return { ...base, words: { ...base.words, all: query } };
  }

  function openAdvanced() {
    close();
    advanced.open(currentQuestion());
  }

  function openOption(index: number) {
    if (historyOpen) {
      const entry = entries[index];
      if (entry) {
        close();
        void navigate(questionPath(entry.question));
      } else openAdvanced();
      return;
    }
    if (index === visibleResults.length + 1) {
      openAdvanced();
      return;
    }
    const result = visibleResults[index];
    const question = currentQuestion();
    if (
      !result &&
      location.pathname === "/search" &&
      !SearchQuestionSchema.safeParse(question).success
    ) {
      openAdvanced();
      return;
    }
    const path = result
      ? searchResultPath(result, trimmed)
      : location.pathname === "/search"
        ? questionPath(question)
        : searchPagePath(trimmed);
    close();
    void navigate(path);
  }

  return (
    <div className="relative w-full min-w-0 max-w-155">
      <input
        type="search"
        role="combobox"
        ref={searchTargetRef}
        aria-label={intl.formatMessage(MESSAGES.label)}
        aria-expanded={listOpen}
        aria-controls={popoverId}
        aria-activedescendant={listOpen && optionCount > 0 ? activeOptionId : undefined}
        aria-autocomplete="list"
        aria-busy={searching}
        autoComplete="off"
        spellCheck={false}
        placeholder={intl.formatMessage(MESSAGES.placeholder, { key: "" })}
        value={location.pathname === "/search" && advanced.draft ? advanced.draft.words.all : query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          const nextTrimmed = next.trim();
          const hasQuery = nextTrimmed.length >= MIN_QUERY_LENGTH;
          setOpen(hasQuery || next.length === 0);
          if (next.length === 0) setActiveIndex(0);
          if (nextTrimmed !== trimmed) {
            setActiveIndex(0);
            setOutcome(null);
            setSearching(hasQuery);
          } else if (hasQuery && !open) {
            // Same trimmed query, list closed (Esc, then a whitespace
            // keystroke): refetch, as the focus handler does.
            setOutcome(null);
            setSearching(true);
          }
          // Same trimmed query with the list open: keep the current
          // answer. The fetch effect keys on the trimmed value, so
          // clearing it here would strand the spinner.
        }}
        onFocus={() => {
          if (emptyBox) {
            setActiveIndex(0);
            setOpen(true);
          }
          if (trimmed.length >= MIN_QUERY_LENGTH) {
            setOutcome(null);
            setSearching(true);
            setOpen(true);
          }
        }}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (emptyBox && !listOpen) setOpen(true);
            else if (trimmed.length >= MIN_QUERY_LENGTH && !listOpen) {
              setOutcome(null);
              setSearching(true);
              setOpen(true);
            }
            if (optionCount === 0) return;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((active + delta + optionCount) % optionCount);
            return;
          }
          if (event.key === "Enter" && listOpen && optionCount > 0) {
            event.preventDefault();
            openOption(active);
            return;
          }
          if (event.key === "Escape" && (listOpen || (open && emptyBox))) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        className="h-7.5 w-full rounded-button border border-border-on-inverted bg-(--chrome-search-bg) pe-18 ps-3 text-base text-on-inverted [--text-placeholder:var(--chrome-search-placeholder)]"
      />
      <button
        type="button"
        aria-label={intl.formatMessage(MESSAGES.advancedTitle)}
        aria-haspopup="dialog"
        onClick={openAdvanced}
        className="absolute end-9 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-button text-on-inverted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-link"
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
      </button>
      <kbd
        aria-hidden="true"
        className="absolute end-2 top-1/2 flex h-5 w-6 -translate-y-1/2 items-center justify-center rounded-chip border border-border-on-inverted text-xs font-semibold text-subtle"
      >
        {SEARCH_KEY}
      </kbd>
      {listOpen && (
        <div
          ref={listRef}
          id={popoverId}
          role="listbox"
          aria-label={intl.formatMessage(MESSAGES.listLabel)}
          aria-live="polite"
          aria-busy={searching}
          className="absolute top-full z-50 mt-1 max-h-[min(38rem,calc(100vh-5rem))] w-full overflow-y-auto rounded-card border border-border-default bg-raised text-primary shadow-xl"
        >
          {historyOpen &&
            groups.map((group, groupIndex) => {
              if (!group.entries.length) return null;
              const offset = groups
                .slice(0, groupIndex)
                .reduce((count, previous) => count + previous.entries.length, 0);
              const Icon = group.key === "saved" ? Bookmark : History;
              return (
                <div key={group.key} role="group" aria-label={group.label}>
                  <div className="border-t border-border-muted px-3 pb-1 pt-3 text-sm font-semibold text-muted">
                    {group.label}
                  </div>
                  {group.entries.map((entry, at) => {
                    const index = offset + at;
                    return (
                      <div
                        key={entry.key}
                        id={optionId(index)}
                        role="option"
                        aria-selected={active === index}
                        className={`flex h-10 cursor-default items-center gap-2 px-3 text-sm ${active === index ? "bg-status-info-bg" : "bg-raised"}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          openOption(index);
                        }}
                        onMouseMove={() => setActiveIndex(index)}
                      >
                        <Icon size={16} aria-hidden="true" className="shrink-0 text-muted" />
                        <span className="truncate" title={entry.label}>
                          {entry.label}
                        </span>
                        {active === index && (
                          <span aria-hidden="true" className="ms-auto text-xs text-muted">
                            <FormattedMessage id="search.header.enter" defaultMessage="Enter" />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          {!historyOpen && searching && (
            <div role="status" className="flex flex-col items-center gap-2 px-5 py-6 text-center">
              <LoaderCircle size={20} aria-hidden="true" className="animate-spin text-muted" />
              <p className="text-sm font-semibold">
                <FormattedMessage {...MESSAGES.searching} />
              </p>
              <p className="text-xs text-muted">
                <FormattedMessage {...MESSAGES.searchingBody} />
              </p>
            </div>
          )}
          {!historyOpen && !searching && outcome?.ok && results.length === 0 && (
            <div role="status" className="flex flex-col items-center gap-2 px-5 py-6 text-center">
              <SearchX size={20} aria-hidden="true" className="text-muted" />
              <p className="text-sm font-semibold">
                <FormattedMessage {...MESSAGES.noMatches} />
              </p>
              <p className="text-xs text-muted">
                <FormattedMessage {...MESSAGES.noMatchesBody} values={{ query: trimmed }} />
              </p>
            </div>
          )}
          {!historyOpen && !searching && outcome && !outcome.ok && (
            <div role="alert" className="flex flex-col items-center gap-2 px-5 py-6 text-center">
              <TriangleAlert size={20} aria-hidden="true" className="text-status-danger-fg" />
              <p className="text-sm font-semibold">
                <FormattedMessage {...MESSAGES.errorTitle} />
              </p>
              <p className="text-xs text-muted">
                {outcome.detail ?? intl.formatMessage(MESSAGES.errorBody)}
              </p>
            </div>
          )}
          {!historyOpen && !searching && outcome?.ok && results.length > 0 && (
            <>
              {SEARCH_KIND_ORDER.map((kind) => {
                const grouped = results
                  .map((result, index) => ({ result, index }))
                  .filter(({ result }) => result.kind === kind);
                if (grouped.length === 0) return null;
                return (
                  <div key={kind} role="group" aria-label={searchKindLabel(intl, kind)}>
                    <div className="flex h-6.5 items-center bg-section-header px-3 text-xs font-semibold text-muted">
                      {searchKindLabel(intl, kind)}
                    </div>
                    {grouped.map(({ result, index }) => (
                      <SearchResultRow
                        key={`${result.kind}:${result.id}`}
                        result={result}
                        query={trimmed}
                        option={{
                          id: optionId(index),
                          active: active === index,
                          onActivate: () => openOption(index),
                          onPoint: () => setActiveIndex(index),
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </>
          )}
          {[MESSAGES.seeAll, MESSAGES.advanced].map((message, offset) => {
            const disabled = historyOpen && offset === 0;
            const index = historyOpen ? entries.length : visibleResults.length + offset;
            const Icon = offset === 0 ? ArrowRight : SlidersHorizontal;
            return (
              <div
                key={message.id}
                id={disabled ? undefined : optionId(index)}
                role="option"
                aria-disabled={disabled || undefined}
                aria-selected={!disabled && active === index}
                className={`flex h-11 cursor-default items-center justify-between border-t border-border-muted px-3 text-sm font-semibold ${disabled ? "text-muted opacity-50" : "text-link"} ${!disabled && active === index ? "bg-status-info-bg" : "bg-raised"}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  if (!disabled) openOption(index);
                }}
                onMouseMove={() => {
                  if (!disabled) setActiveIndex(index);
                }}
              >
                <FormattedMessage {...message} />
                <Icon size={16} aria-hidden="true" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
