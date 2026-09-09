// SPDX-License-Identifier: AGPL-3.0-only
/* global document, localStorage, ResizeObserver, URLSearchParams, location, history, addEventListener */

/** Serialized into the retained edition. All data and assets come from that edition. */
export function initializeReader(bundle, searchDocumentation, documentationExcerpt) {
  const theme = document.getElementById("docs-theme");
  const themeKey = "openlaw.documentation.theme";
  try {
    const saved = localStorage.getItem(themeKey);
    if (["light", "warm", "dark"].includes(saved)) theme.value = saved;
  } catch {
    /* The local-file reader also works when browser storage is unavailable. */
  }
  document.documentElement.dataset.theme = theme.value;
  theme.addEventListener("change", () => {
    if (!["light", "warm", "dark"].includes(theme.value)) return;
    document.documentElement.dataset.theme = theme.value;
    try {
      localStorage.setItem(themeKey, theme.value);
    } catch {
      /* Current-page theme still applies. */
    }
  });
  const navigation = document.querySelector(".docs-navigation");
  if (typeof ResizeObserver === "function" && navigation) {
    let previousBreakpoint = "";
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = entry.contentRect.width;
      const breakpoint = `${width >= 880}:${width >= 1152}`;
      if (breakpoint === previousBreakpoint) return;
      previousBreakpoint = breakpoint;
      navigation.open = width >= 880;
      const outline = document.querySelector(".docs-outline details");
      if (outline) outline.open = width >= 1152;
    });
    observer.observe(document.getElementById("docs-main"));
  }
  const form = document.getElementById("docs-search");
  const results = document.getElementById("docs-results");
  const index = document.getElementById("docs-index");
  if (!form || !results || !index) return;
  function readLocation() {
    const params = new URLSearchParams(location.search);
    form.elements.q.value = params.get("q") || "";
    form.elements.audience.value = params.get("audience") || "";
  }
  function render() {
    const query = form.elements.q.value.trim(),
      audience = form.elements.audience.value;
    results.replaceChildren();
    index.hidden = Boolean(query || audience);
    if (!query && !audience) return;
    const found = searchDocumentation(bundle, { query, audience });
    const heading = document.createElement("div");
    heading.className = "docs-section-heading";
    const status = document.createElement("h2");
    status.textContent = `${found.length} ${found.length === 1 ? "result" : "results"}`;
    const clear = document.createElement("a");
    clear.href = "index.html";
    clear.textContent = "Clear filters";
    heading.append(status, clear);
    results.append(heading);
    if (!found.length) {
      const empty = document.createElement("p");
      empty.className = "docs-empty";
      empty.textContent = "No matching articles. Clear the search to see the full index.";
      results.append(empty);
    }
    for (const article of found) {
      const row = document.createElement("section"),
        body = document.createElement("div");
      row.className = "docs-result";
      const label = document.createElement("span");
      label.className = "docs-eyebrow";
      label.textContent =
        bundle.sections.find((s) => s.id === article.section)?.title ?? article.section;
      const title = document.createElement("h2"),
        link = document.createElement("a");
      link.href = `${article.id}.html`;
      link.textContent = article.title;
      title.append(link);
      const excerpt = document.createElement("p");
      excerpt.textContent = documentationExcerpt(article, query, 180);
      body.append(label, title, excerpt);
      row.append(body);
      results.append(row);
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (form.elements.q.value.trim()) params.set("q", form.elements.q.value.trim());
    if (form.elements.audience.value) params.set("audience", form.elements.audience.value);
    const query = params.toString();
    history.pushState(null, "", location.pathname + (query ? `?${query}` : ""));
    render();
    document.querySelector("h1")?.focus();
  });
  addEventListener("popstate", () => {
    readLocation();
    render();
  });
  readLocation();
  render();
}
