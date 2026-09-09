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
  { query = "", destination = "formal", audience = "", topic = "", topics = [], section = "" } = {},
) {
  const words = [...new Set(normalizeSearch(query).split(" ").filter(Boolean))];
  const registered = [
    ...new Set([topic, ...topics].filter((key) => bundle.contexts.includes(key))),
  ];
  return bundle.articles
    .filter(
      (a) =>
        a.destinations.includes(destination) &&
        (!section || a.section === section) &&
        (!audience || a.audiences.includes(audience)) &&
        (!registered.length || registered.some((key) => a.contexts.includes(key))),
    )
    .map((article) => {
      const title = normalizeSearch(article.title),
        headings = normalizeSearch(article.outline.map((h) => h.text).join(" "));
      const all = normalizeSearch(
        `${article.title} ${headings} ${article.text} ${article.section} ${article.audiences.join(" ")}`,
      );
      return {
        article,
        topicRank: registered.length
          ? registered.findIndex((key) => article.contexts.includes(key))
          : 0,
        score: words.every((w) => all.includes(w))
          ? words.reduce((n, w) => n + (title.includes(w) ? 10 : headings.includes(w) ? 5 : 1), 0)
          : -1,
      };
    })
    .filter((hit) => hit.score >= 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.topicRank - b.topicRank ||
        a.article.title.localeCompare(b.article.title, "en-US"),
    )
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

/** Section symbols for the retained HTML edition. */
export function documentationIcon(section) {
  const icons = {
    start: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4 6-2 6-6 2 2-6 6-2Z",
    portal: "M21 11a8 8 0 0 1-8 8H7l-5 3V7a5 5 0 0 1 5-5h9a5 5 0 0 1 5 5v4ZM7 7h9M7 12h6",
    "working-with-legal":
      "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-2a6 6 0 0 1 12 0v2M17 3a4 4 0 0 1 0 8m1 4a5 5 0 0 1 4 4v2",
    contracts: "M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14V7l-5-5Zm0 0v6h5M7 12h8M7 16h5",
    matters: "M8 7V4h8v3M3 7h18v14H3V7Zm0 6a25 25 0 0 0 18 0M10 12h4v4h-4v-4Z",
    documents: "M8 3h13v15H8V3ZM4 7H2v15h13v-2",
    entities: "M4 22V2h12v20M16 10h5v12M8 6h4M8 10h4M8 14h4M8 22v-4h4v4M1 22h22",
    knowledge: "M3 3v18M7 3v18M11 3v18M16 3l5 17M1 21h22",
    administration:
      "M4 3v7m0 4v7M12 3v11m0 4v3M20 3v3m0 4v11M1 10h6v4H1v-4Zm8 4h6v4H9v-4Zm8-8h6v4h-6V6Z",
    operations: "M3 3h18v7H3V3Zm0 11h18v7H3v-7ZM7 6v1m0 10v1M12 6h5m-5 11h5",
    reference:
      "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM5 5l4 4m6 6 4 4M5 19l4-4m6-6 4-4",
  };
  return icons[section] ?? "M3 3h6l3 3 3-3h6v16h-6l-3 2-3-2H3V3Zm9 3v15";
}
