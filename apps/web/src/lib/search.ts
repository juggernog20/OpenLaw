// SPDX-License-Identifier: AGPL-3.0-only

/** Settled adapters for the header search and versioned question endpoints. */
import type { SearchQuestion } from "@openlaw/shared";
import type { paths } from "@openlaw/api-client";
import { resolveTimeZone } from "./format";
import { api } from "./api";
import { problem, type Problem } from "./problem";

type SearchResponse =
  paths["/api/v1/search"]["get"]["responses"]["200"]["content"]["application/json"];
type SearchQuery = paths["/api/v1/search"]["get"]["parameters"]["query"];

export type SearchResult = SearchResponse["results"][number];
export type SearchKind = NonNullable<SearchQuery["kind"]>;

export type SearchOutcome =
  { ok: true; results: SearchResult[]; nextCursor: string | null } | ({ ok: false } & Problem);

export interface SearchOptions {
  kind?: SearchKind;
  cursor?: string;
  /** Supplying a limit selects the flat results-page order. Omit all
   * options for the header's grouped answer. */
  limit?: number;
}

/** Search never rejects. A caller receives rows, or a refusal with the
 * problem detail when the server answered one. A transport failure
 * leaves `detail` unset, so the call site supplies its react-intl
 * fallback copy. One settled union serves both search surfaces. */
export async function search(query: string, options: SearchOptions = {}): Promise<SearchOutcome> {
  const result = await api
    .GET("/api/v1/search", {
      params: {
        query: {
          q: query,
          kind: options.kind,
          cursor: options.cursor,
          limit: options.limit,
        },
      },
    })
    .catch(() => undefined);
  return result?.data
    ? { ok: true, results: result.data.results, nextCursor: result.data.nextCursor }
    : { ok: false, ...(await problem(result)) };
}

export type QuestionSearchOutcome =
  | { ok: true; results: SearchResult[]; total: number; nextCursor: string | null }
  | ({ ok: false } & Problem);

export async function querySearch(
  question: SearchQuestion,
  options: { cursor?: string; limit?: number } = {},
): Promise<QuestionSearchOutcome> {
  const result = await api
    .POST("/api/v1/search/query", {
      body: { ...question, ...options, timeZone: resolveTimeZone() },
    })
    .catch(() => undefined);
  return result?.data ? { ok: true, ...result.data } : { ok: false, ...(await problem(result)) };
}
