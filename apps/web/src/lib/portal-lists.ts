// SPDX-License-Identifier: AGPL-3.0-only

import type { LoaderFunctionArgs } from "react-router";
import { builtInLayout, type ColumnCatalogue, type Layout } from "./list-views";
import { filterQuery } from "./record-filters";

export function portalListLayout<Row>(
  catalogue: ColumnCatalogue<Row>,
  args: LoaderFunctionArgs,
  filters: readonly string[],
  sorts: readonly string[],
): Layout {
  const params = new URL(args.request.url).searchParams;
  const key = params.get("sort");
  return {
    ...builtInLayout(catalogue),
    filters: Object.fromEntries(
      filters.flatMap((name) => {
        const value = params.get(name)?.trim();
        return value ? [[name, value]] : [];
      }),
    ),
    sort:
      key && sorts.includes(key)
        ? { key, dir: params.get("dir") === "desc" ? "desc" : "asc" }
        : null,
  };
}
export function portalListQuery(layout: Layout, keys: readonly string[]) {
  return {
    ...filterQuery(layout.filters, keys),
    ...(layout.sort ? { sort: layout.sort.key, dir: layout.sort.dir } : {}),
  };
}
export function portalListSearch(layout: Layout, keys: readonly string[]) {
  const params = new URLSearchParams(portalListQuery(layout, keys));
  return params.size ? `?${params}` : "";
}
