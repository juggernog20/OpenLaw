// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared local search and stable-link resolution for the app and standalone reader.
 * TECH-026 keeps both consumers on the same matching rules.
 */

export function normalizeSearch(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

/** Shared by the app and the standalone script; it performs no I/O. */
export function searchDocumentation(
  bundle,
  { query = "", destination = "formal", audience = "", topic = "" } = {},
) {
  const words = [...new Set(normalizeSearch(query).split(" ").filter(Boolean))];
  const registered = bundle.contexts.includes(topic) ? topic : "";
  return bundle.articles
    .filter(
      (a) =>
        a.destinations.includes(destination) &&
        (!audience || a.audiences.includes(audience)) &&
        (!registered || a.contexts.includes(registered)),
    )
    .map((article) => {
      const title = normalizeSearch(article.title),
        headings = normalizeSearch(article.outline.map((h) => h.text).join(" "));
      const all = normalizeSearch(
        `${article.title} ${headings} ${article.text} ${article.section} ${article.audiences.join(" ")}`,
      );
      return {
        article,
        score: words.every((w) => all.includes(w))
          ? words.reduce((n, w) => n + (title.includes(w) ? 10 : headings.includes(w) ? 5 : 1), 0)
          : -1,
      };
    })
    .filter((hit) => hit.score >= 0)
    .sort((a, b) => b.score - a.score || a.article.title.localeCompare(b.article.title, "en-US"))
    .map((hit) => hit.article);
}

export function resolveDocumentationLink(bundle, id, hash = "") {
  let value = `${id}${hash}`;
  const visited = new Set();
  while (!visited.has(value)) {
    visited.add(value);
    const [article, anchor] = value.split("#");
    const exact = bundle.redirects.find((r) => r.from === value);
    const alias = bundle.redirects.find((r) => r.from === article);
    if (exact) value = exact.to;
    else if (alias) value = alias.to.includes("#") || !anchor ? alias.to : `${alias.to}#${anchor}`;
    else return value;
  }
  return null;
}

export function documentationExcerpt(article, query, length = 200) {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  const body = normalizeSearch(article.text);
  const positions = words.map((w) => body.indexOf(w)).filter((p) => p >= 0);
  const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 50);
  return `${start ? "…" : ""}${article.text.slice(start, start + length)}${article.text.length > start + length ? "…" : ""}`;
}
