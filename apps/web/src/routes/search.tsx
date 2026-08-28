// SPDX-License-Identifier: AGPL-3.0-only

/**
 * M25's flat ranked answer, with kind and query held in the URL so a
 * reload or a shared link answers the same. Reads the one search
 * endpoint through the generated client (TECH-003); `/` reaches it per
 * DES-010.
 */
import { useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { Link, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from "react-router";
import { authClient } from "../lib/auth-client";
import { search, type SearchKind, type SearchOutcome, type SearchResult } from "../lib/search";
import { currentUser, needsSetup } from "../lib/session";
import { cn } from "../lib/utils";
import { PageTitle } from "../components/page-title";
import {
  SEARCH_KIND_ORDER,
  SearchResultRow,
  searchKindLabel,
  searchPagePath,
} from "../components/search/search-result-row";
import { AppShell } from "../components/shell/app-shell";
import { PageSubBar } from "../components/shell/page-subbar";
import { Button } from "../components/ui/button";

const PAGE_SIZE = 25;

const MESSAGES = defineMessages({
  prompt: {
    id: "search.page.prompt",
    defaultMessage: "Search contracts, matters, documents, entities, counterparties, and requests",
  },
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

function isSearchKind(value: string | null): value is SearchKind {
  return SEARCH_KIND_ORDER.some((kind) => kind === value);
}

export async function searchLoader({ request }: LoaderFunctionArgs) {
  const user = await currentUser();
  if (!user) return redirect((await needsSetup()) ? "/auth/setup" : "/auth/login");
  if (user.role === "business_user") return redirect("/portal");

  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();
  const rawKind = params.get("kind");
  const kind = isSearchKind(rawKind) ? rawKind : undefined;
  const outcome: SearchOutcome =
    query === ""
      ? { ok: true, results: [], nextCursor: null }
      : await search(query, { kind, limit: PAGE_SIZE });
  return { user, query, kind, outcome };
}

function KindFilters({ query, active }: Readonly<{ query: string; active?: SearchKind }>) {
  const intl = useIntl();
  const choices: { kind?: SearchKind; label: string }[] = [
    { label: intl.formatMessage(MESSAGES.allKinds) },
    ...SEARCH_KIND_ORDER.map((kind) => ({ kind, label: searchKindLabel(intl, kind) })),
  ];
  return (
    <nav aria-label={intl.formatMessage(MESSAGES.filterLabel)} className="flex flex-wrap gap-2">
      {choices.map(({ kind, label }) => {
        const selected = kind === active;
        return (
          <Link
            key={kind ?? "all"}
            to={searchPagePath(query, kind)}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "rounded-chip border px-2.5 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link",
              selected
                ? "border-status-info-fg bg-status-info-bg font-semibold text-status-info-fg"
                : "border-border-default bg-control text-muted hover:text-primary",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function SearchAnswer({
  query,
  kind,
  initial,
}: Readonly<{ query: string; kind?: SearchKind; initial: SearchOutcome }>) {
  const intl = useIntl();
  const [rows, setRows] = useState<SearchResult[]>(initial.ok ? initial.results : []);
  const [cursor, setCursor] = useState<string | null>(initial.ok ? initial.nextCursor : null);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  async function showMore() {
    if (busy || cursor === null) return;
    setBusy(true);
    setPageError(null);
    const answer = await search(query, { kind, cursor, limit: PAGE_SIZE });
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

  if (query === "") {
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
          <FormattedMessage {...MESSAGES.noMatchesBody} values={{ query }} />
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
  const navigate = useNavigate();

  async function signOut() {
    await authClient.signOut();
    void navigate("/auth/login", { replace: true });
  }

  const title =
    loaded.query === ""
      ? intl.formatMessage(MESSAGES.prompt)
      : intl.formatMessage(MESSAGES.resultsFor, { query: loaded.query });
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
          filters={<KindFilters query={loaded.query} active={loaded.kind} />}
        />
      }
    >
      <PageTitle title={title} />
      <SearchAnswer
        key={`${loaded.query}:${loaded.kind ?? "all"}`}
        query={loaded.query}
        kind={loaded.kind}
        initial={loaded.outcome}
      />
    </AppShell>
  );
}
