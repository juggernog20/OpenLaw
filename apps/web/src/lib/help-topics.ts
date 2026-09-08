// SPDX-License-Identifier: AGPL-3.0-only

/** DES-073 maps route patterns to public topic keys, never record identifiers. */
import { matchPath } from "react-router";
import type {
  DocumentationAudience,
  HelpMetadata,
} from "../../../../scripts/documentation/reader.mjs";

export type HelpSurface = "staff" | "portal" | "formal";
export const HELP_BASE = { staff: "/help", portal: "/portal/help", formal: "/documentation" };

export function topicsForRoute(metadata: HelpMetadata, pathname: string, surface: HelpSurface) {
  const matching = metadata.bindings
    .filter(
      (binding) =>
        binding.surface === surface || (surface !== "formal" && binding.surface === "both"),
    )
    .flatMap((binding) =>
      binding.routes
        .filter((route) => matchPath({ path: route, end: true }, pathname))
        .map((route) => ({
          binding,
          rank:
            route === "*"
              ? -1
              : route
                  .split("/")
                  .reduce(
                    (score, segment) => score + (segment.startsWith(":") ? 1 : segment ? 3 : 0),
                    0,
                  ),
        })),
    )
    .sort((a, b) => b.rank - a.rank || a.binding.routes.length - b.binding.routes.length);
  return [...new Set(matching.flatMap(({ binding }) => binding.contexts))].filter((topic) =>
    metadata.contexts.includes(topic),
  );
}

export function helpHref(
  metadata: HelpMetadata,
  pathname: string,
  surface: HelpSurface,
  audience?: DocumentationAudience,
) {
  const base = HELP_BASE[surface];
  if (pathname === base || pathname.startsWith(base + "/")) return base;
  const destination =
    surface === "formal" ? "formal" : surface === "staff" ? "staff-help" : "portal-help";
  const topics = topicsForRoute(metadata, pathname, surface).filter((topic) =>
    metadata.articles.some(
      (article) =>
        article.contexts.includes(topic) &&
        article.destinations.includes(destination) &&
        (!audience || article.audiences.includes(audience)),
    ),
  );
  const query = new URLSearchParams(topics.map((topic) => ["topic", topic]));
  return `${base}${topics.length ? `?${query}` : ""}`;
}
