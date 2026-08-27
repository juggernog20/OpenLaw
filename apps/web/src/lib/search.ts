// SPDX-License-Identifier: AGPL-3.0-only

/** The settled client adapter for M25's one search endpoint. */
import type { paths } from "@openlaw/api-client";
import { api } from "./api";
import { problemDetail } from "./messages";

type SearchResponse =
  paths["/api/v1/search"]["get"]["responses"]["200"]["content"]["application/json"];
type SearchQuery = paths["/api/v1/search"]["get"]["parameters"]["query"];

export type SearchResult = SearchResponse["results"][number];
export type SearchKind = NonNullable<SearchQuery["kind"]>;

export type SearchOutcome =
  { ok: true; results: SearchResult[]; nextCursor: string | null } | { ok: false; detail?: string };

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
  const { data, error } = await api
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
    .catch(() => ({ data: undefined, error: undefined }));
  return data
    ? { ok: true, results: data.results, nextCursor: data.nextCursor }
    : { ok: false, detail: problemDetail(error) };
}
