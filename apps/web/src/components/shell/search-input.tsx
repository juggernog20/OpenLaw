// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Header search box and M25 grouped results listbox. The input remains
 * DES-010's `/` target while the local combobox owns Arrow, Enter, and
 * Escape.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, SearchX, TriangleAlert } from "lucide-react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
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

const SEARCH_DEBOUNCE_MS = 150;
const MIN_QUERY_LENGTH = 2;

const MESSAGES = defineMessages({
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
  seeAll: { id: "search.seeAll", defaultMessage: "See all results" },
});

function routeQuery(pathname: string, searchString: string): string {
  return pathname === "/search" ? (new URLSearchParams(searchString).get("q") ?? "") : "";
}

export function SearchInput() {
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState(() => routeQuery(location.pathname, location.search));
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const popoverId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const trimmed = query.trim();
  const listOpen = open && trimmed.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!listOpen) return;
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
  }, [listOpen, trimmed]);

  const results = useMemo(() => {
    if (!outcome?.ok) return [];
    return SEARCH_KIND_ORDER.flatMap((kind) => outcome.results.filter((row) => row.kind === kind));
  }, [outcome]);
  const optionCount = results.length > 0 ? results.length + 1 : 0;
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

  function openOption(index: number) {
    const result = results[index];
    const path = result ? searchResultPath(result, trimmed) : searchPagePath(trimmed);
    close();
    void navigate(path);
  }

  return (
    <div className="relative w-full min-w-0 max-w-155">
      <input
        type="search"
        role="combobox"
        ref={(element) => (element ? registerSearchTarget(element) : undefined)}
        aria-label={intl.formatMessage(MESSAGES.label)}
        aria-expanded={listOpen}
        aria-controls={popoverId}
        aria-activedescendant={listOpen && optionCount > 0 ? activeOptionId : undefined}
        aria-autocomplete="list"
        aria-busy={searching}
        autoComplete="off"
        spellCheck={false}
        placeholder={intl.formatMessage(MESSAGES.placeholder, { key: "" })}
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setActiveIndex(0);
          setOutcome(null);
          const hasQuery = next.trim().length >= MIN_QUERY_LENGTH;
          setSearching(hasQuery);
          setOpen(hasQuery);
        }}
        onFocus={() => {
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
            if (trimmed.length >= MIN_QUERY_LENGTH && !listOpen) {
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
          if (event.key === "Escape" && listOpen) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        className="h-7.5 w-full rounded-button border border-border-on-inverted bg-(--chrome-search-bg) pe-10 ps-3 text-base text-on-inverted placeholder:text-subtle"
      />
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
          {searching && (
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
          {!searching && outcome?.ok && results.length === 0 && (
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
          {!searching && outcome && !outcome.ok && (
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
          {!searching && outcome?.ok && results.length > 0 && (
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
              <div
                id={optionId(results.length)}
                role="option"
                aria-selected={active === results.length}
                className={`flex h-11 cursor-default items-center justify-between px-3 text-sm font-semibold text-link ${active === results.length ? "bg-status-info-bg" : "bg-raised"}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  openOption(results.length);
                }}
                onMouseMove={() => setActiveIndex(results.length)}
              >
                <FormattedMessage {...MESSAGES.seeAll} />
                <ArrowRight size={14} aria-hidden="true" />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
