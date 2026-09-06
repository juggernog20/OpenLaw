// SPDX-License-Identifier: AGPL-3.0-only

import type { LoaderFunctionArgs } from "react-router";
import type { Layout, SavedView } from "./list-views";

export const CONTRACT_FILTER_KEYS = [
  "owner",
  "status",
  "type",
  "effectiveFrom",
  "effectiveTo",
  "expiryFrom",
  "expiryTo",
  "includeEnded",
  "includeArchived",
] as const;
export const MATTER_FILTER_KEYS = [
  "manager",
  "status",
  "type",
  "priority",
  "risk",
  "openedFrom",
  "openedTo",
  "deadlineFrom",
  "deadlineTo",
  "includeClosed",
  "includeArchived",
] as const;
export const INBOX_FILTER_KEYS = [
  "status",
  "type",
  "urgency",
  "requester",
  "receivedFrom",
  "receivedTo",
] as const;
const FLAGS = new Set(["includeEnded", "includeArchived", "includeClosed"]);

export function filterQuery(
  filters: Layout["filters"],
  keys: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = filters[key];
      if (FLAGS.has(key)) return value === true ? [[key, "true"]] : [];
      return typeof value === "string" && value ? [[key, value]] : [];
    }),
  );
}

export function initialView(views: SavedView[], args?: LoaderFunctionArgs): SavedView | null {
  const id = args && new URL(args.request.url).searchParams.get("view");
  return id
    ? (views.find((view) => view.id === id) ?? null)
    : (views.find((view) => view.isDefault) ?? null);
}

export function layoutFromUrl(
  layout: Layout,
  args: LoaderFunctionArgs | undefined,
  keys: readonly string[],
  sortKeys: readonly string[],
): Layout {
  if (!args) return layout;
  const params = new URL(args.request.url).searchParams;
  if (!params.has("filters") && !keys.some((key) => params.has(key))) return layout;
  const filters: Layout["filters"] = {};
  for (const key of keys) {
    const value = params.get(key);
    if (!value) continue;
    filters[key] = FLAGS.has(key) ? value === "true" : value;
  }
  const sort = params.get("sort");
  return {
    ...layout,
    filters,
    sort:
      sort && sortKeys.includes(sort)
        ? { key: sort, dir: params.get("dir") === "desc" ? "desc" : "asc" }
        : null,
  };
}

export function filterSearch(layout: Layout, keys: readonly string[], view: string | null): string {
  const params = new URLSearchParams({
    filters: "1",
    view: view ?? "all",
    ...filterQuery(layout.filters, keys),
  });
  if (layout.sort) {
    params.set("sort", layout.sort.key);
    params.set("dir", layout.sort.dir);
  }
  return `?${params}`;
}
