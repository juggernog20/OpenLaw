// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeSearch,
  searchDocumentation,
  documentationExcerpt,
  resolveDocumentationLink,
  documentationIcon,
} from "./reader.mjs";
import { initializeReader } from "./standalone-browser.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const ROLES = {
  legal_team_member: "Legal Team Member",
  administrator: "Administrator",
  contributor: "Contributor",
  business_user: "Business User",
  operator: "Deployment operator",
};
const DESCRIPTIONS = {
  start: "Find your way around, sign in, and make OpenLaw yours.",
  portal: "Ask Legal for help and follow your Requests.",
  "working-with-legal": "Share context, collaborate, and keep work moving.",
  contracts: "Take a Contract from first draft to signature and renewal.",
  matters: "Organize legal work, people, Tasks, and Key dates.",
  documents: "Find, organize, and work with your team's Documents.",
  entities: "Keep corporate records and Obligations in order.",
  knowledge: "Build and share the team's practical know-how.",
  administration: "Set up your workspace, people, and connected services.",
  operations: "Deploy, maintain, and recover your OpenLaw instance.",
  reference: "Look up a term or find a way through a problem.",
};
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const icon = (path, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const book = icon(
  '<path d="M12 7v14m-9-3V3h4a5 5 0 0 1 5 4 5 5 0 0 1 5-4h4v15h-4a5 5 0 0 0-5 3 5 5 0 0 0-5-3Z"/>',
);
const arrow = icon('<path d="M5 12h14m-5-5 5 5-5 5"/>', 16);
const scale = icon(
  '<path d="M12 3v17m-5 1h10M4 7h16M4 7l-3 7a4 4 0 0 0 6 0L4 7Zm16 0-3 7a4 4 0 0 0 6 0l-3-7Z"/>',
  24,
);

/** The retained edition uses relative links and the same theme tokens as the app. */
export function standaloneFiles(bundle, assets) {
  const files = new Map(assets);
  const available = searchDocumentation(bundle);
  const validationBadge = bundle.validationPending
    ? "Validation in progress"
    : "Unverified article";
  const sections = bundle.sections.filter((s) => available.some((a) => a.section === s.id));
  const collectionHref = (id) => `section-${id}.html`;
  const label = (id) => bundle.sections.find((s) => s.id === id)?.title ?? id;
  const articleList = (items) =>
    `<div class="docs-results">${items.map((a) => `<section class="docs-result"><div><span class="docs-eyebrow">${escape(label(a.section))}</span><h2><a href="${a.id}.html">${escape(a.title)}</a></h2><p>${escape(documentationExcerpt(a, "", 180))}</p>${a.unverified ? `<span class="docs-badge">${validationBadge}</span>` : ""}</div>${arrow}</section>`).join("")}</div>`;
  const sidebar = (article, section) =>
    `<aside class="docs-sidebar"><details class="docs-navigation" open><summary>Browse guides</summary><nav aria-label="Guide navigation"><a class="docs-overview" href="index.html"${!article && !section ? ' aria-current="page"' : ""}>${book}Overview</a><p class="docs-nav-label">Browse guides</p><ul>${sections
      .map(
        (s) =>
          `<li><a href="${collectionHref(s.id)}"${section === s.id ? ' aria-current="page"' : ""}>${escape(s.title)}</a>${
            article?.section === s.id
              ? `<ul class="docs-article-links">${available
                  .filter((a) => a.section === s.id)
                  .map(
                    (a) =>
                      `<li><a href="${a.id}.html"${a.id === article.id ? ' aria-current="page"' : ""}>${escape(a.title)}</a></li>`,
                  )
                  .join("")}</ul>`
              : ""
          }</li>`,
      )
      .join(
        "",
      )}</ul></nav></details><div class="docs-sidebar-footer"><a href="index.html">All documentation</a></div></aside>`;
  const edition = `<details id="edition"><summary>Edition details</summary><dl><dt>Edition</dt><dd>${escape(bundle.edition.id)} (${bundle.edition.channel})</dd><dt>Supported app</dt><dd>${escape(bundle.edition.supportedAppVersion)} / ${escape(bundle.edition.supportedAppCommit ?? "Not yet verified")}</dd><dt>Distribution commit</dt><dd>${escape(bundle.edition.distributionCommit ?? "Not recorded")}${bundle.edition.workingChanges ? " (working changes)" : ""}</dd><dt>Content digest</dt><dd>${bundle.edition.contentDigest}</dd><dt>Publication target</dt><dd>${escape(bundle.edition.publicationTarget)}</dd></dl></details>`;
  const searchForm = `<form id="docs-search" role="search" action="index.html" method="get"><div class="docs-search-field"><label class="docs-sr-only" for="docs-query">Search documentation</label>${icon('<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>', 20)}<input id="docs-query" name="q" type="search" placeholder="Search documentation"></div><div class="docs-audience-field"><label class="docs-sr-only" for="docs-audience">Audience</label><select id="docs-audience" name="audience"><option value="">All readers</option>${Object.entries(
    ROLES,
  )
    .map(([a, title]) => `<option value="${a}">${title}</option>`)
    .join(
      "",
    )}</select></div><button class="docs-search-button" type="submit">Search</button></form>`;
  const hero = (title, description) =>
    `<div class="docs-hero"><p class="docs-eyebrow">Find the guide you need.</p><h1 tabindex="-1">${escape(title)}</h1><p class="docs-intro">${escape(description)}</p>${searchForm}</div>`;
  const page = (title, content, article = null, section = null) =>
    `<!doctype html><html lang="en-US" data-theme="light" class="docs-static"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · OpenLaw</title><link rel="stylesheet" href="themes.css"><link rel="stylesheet" href="reader.css"><script src="redirect.js" defer></script><script src="search.js" defer></script></head><body class="docs-public"><a class="docs-skip" href="#docs-main">Skip to content</a><header class="docs-header"><a class="docs-brand" href="index.html" aria-label="OpenLaw documentation"><span class="docs-brand-mark">${scale}</span><strong>openlaw</strong><span class="docs-brand-divider" aria-hidden="true">/</span><span>Documentation</span></a><div class="docs-header-actions"><label class="docs-sr-only" for="docs-theme">Documentation theme</label><select id="docs-theme"><option value="light">Light</option><option value="warm">Warm</option><option value="dark">Dark</option></select><span>Standalone edition</span></div></header><main id="docs-main" class="docs-reader ${article ? "docs-reading" : ""}" tabindex="-1">${bundle.preview ? '<p class="docs-notice">Development preview: unverified validation or draft content.</p>' : bundle.validationPending ? '<p class="docs-notice">Guide validation is in progress. Some instructions may change.</p>' : ""}<div class="docs-layout">${sidebar(article, section)}<div class="docs-content">${content}</div></div>${edition}</main></body></html>`;
  files.set(
    "index.html",
    page(
      "Documentation",
      `${hero("Documentation", "Practical guides for your legal work, your team, and your workspace.")}<noscript><p>Search requires JavaScript. Browse the guide collections below to read every available article.</p></noscript><div id="docs-results" aria-live="polite"></div><div id="docs-index"><div class="docs-section-heading"><div><h2>Explore the guides</h2><p>Choose a topic to find the right place to start.</p></div></div>${
        sections.length
          ? `<div class="docs-collections">${sections
              .map((s) => {
                const items = available.filter((a) => a.section === s.id);
                return `<a class="docs-collection" href="${collectionHref(s.id)}">${icon(`<path d="${documentationIcon(s.id)}"/>`, 24)}<h3>${escape(s.title)}</h3><p>${escape(DESCRIPTIONS[s.id] ?? items.map((a) => a.title).join(" · "))}</p><span>${items.length} ${items.length === 1 ? "guide" : "guides"}${arrow}</span></a>`;
              })
              .join("")}</div>`
          : '<div class="docs-empty"><p>No verified articles are available in this edition yet.</p></div>'
      }</div>`,
    ),
  );
  for (const s of sections) {
    const items = available.filter((a) => a.section === s.id);
    files.set(
      collectionHref(s.id),
      page(
        s.title,
        `${hero(s.title, DESCRIPTIONS[s.id] ?? "Browse the guides in this collection.")}<div class="docs-section-heading"><p>${items.length} ${items.length === 1 ? "guide" : "guides"}</p></div>${articleList(items)}`,
        null,
        s.id,
      ),
    );
  }
  for (const a of available) {
    const outline = a.outline
      .filter((h) => h.depth > 1)
      .map((h) => `<li data-depth="${h.depth}"><a href="#${h.id}">${escape(h.text)}</a></li>`)
      .join("");
    const moved = bundle.redirects
      .filter(
        (r) =>
          r.from.startsWith(a.id + "#") &&
          !resolveDocumentationLink(bundle, r.from).startsWith(a.id + "#"),
      )
      .map((r) => {
        const [target, hash] = resolveDocumentationLink(bundle, r.from).split("#");
        return `<p id="${r.from.split("#")[1]}">Section moved: <a href="${target}.html${hash ? "#" + hash : ""}">Read the current section</a>.</p>`;
      })
      .join("");
    const siblings = available.filter((other) => other.section === a.section);
    const position = siblings.findIndex((other) => other.id === a.id);
    const adjacent = [siblings[position - 1], siblings[position + 1]]
      .map((other, i) =>
        other
          ? `<a href="${other.id}.html"><span>${i === 0 ? "Previous guide" : "Next guide"}</span><strong>${escape(other.title)}</strong>${arrow}</a>`
          : "<span></span>",
      )
      .join("");
    files.set(
      `${a.id}.html`,
      page(
        a.title,
        `<div class="docs-search-bar">${searchForm}</div><nav class="docs-breadcrumb" aria-label="Breadcrumb"><a href="index.html">Documentation</a><span aria-hidden="true">/</span><a href="${collectionHref(a.section)}">${escape(label(a.section))}</a></nav><div class="docs-article-meta"><span>For ${a.audiences.map((r) => ROLES[r]).join(" · ")}</span>${a.unverified ? `<span class="docs-badge">${validationBadge}</span>` : ""}</div>${moved}<div class="docs-columns"><article>${a.html.standalone}</article>${outline ? `<nav class="docs-outline" aria-label="On this page"><details open><summary>On this page</summary><ul>${outline}</ul></details></nav>` : ""}</div><nav class="docs-adjacent" aria-label="Article navigation">${adjacent}</nav>`,
        a,
      ),
    );
  }
  for (const r of bundle.redirects.filter((r) => !r.from.includes("#"))) {
    const resolved = resolveDocumentationLink(bundle, r.from),
      [id, hash] = resolved.split("#");
    const target = `${id}.html${hash ? `#${hash}` : ""}`;
    files.set(
      `${r.from}.html`,
      page(
        "Article moved",
        `<h1>Article moved</h1><p><a id="docs-redirect" href="${target}">Read the current article</a></p>`,
      ),
    );
  }
  files.set(
    "redirect.js",
    `${resolveDocumentationLink.toString()}\nconst redirects=${JSON.stringify(bundle.redirects)};const id=decodeURIComponent(location.pathname.split('/').pop()).replace(/\\.html$/,'');function follow(){let fragment=location.hash;try{fragment=decodeURIComponent(fragment);}catch{}const original=id+fragment;const resolved=resolveDocumentationLink({redirects},id,fragment);if(resolved&&resolved!==original){const [target,hash]=resolved.split('#');location.replace(target+'.html'+location.search+(hash?'#'+hash:''));return;}document.getElementById('docs-missing-section')?.remove();if(fragment&&!document.getElementById(fragment.slice(1))){const notice=document.createElement('p');notice.id='docs-missing-section';notice.className='docs-notice';notice.setAttribute('role','status');notice.textContent='The requested section is unavailable. Use the page outline or the documentation index.';document.getElementById('docs-main').prepend(notice);}}addEventListener('hashchange',follow);follow();`,
  );

  const searchBundle = {
    contexts: bundle.contexts,
    sections: bundle.sections,
    articles: available.map(
      ({ id, title, section, audiences, destinations, contexts, outline, text }) => ({
        id,
        title,
        section,
        audiences,
        destinations,
        contexts,
        outline,
        text,
      }),
    ),
  };
  files.set(
    "search.js",
    `${normalizeSearch.toString()}\n${searchDocumentation.toString()}\n${documentationExcerpt.toString()}\n(${initializeReader.toString()})(${JSON.stringify(searchBundle).replaceAll("<", "\\u003c")}, searchDocumentation, documentationExcerpt);`,
  );
  files.set("reader.css", readFileSync(join(directory, "reader.css"), "utf8"));
  const themes = ["light", "warm", "dark"]
    .map((theme) => readFileSync(join(directory, `../../styles/themes/${theme}.css`), "utf8"))
    .join("\n");
  files.set(
    "themes.css",
    `@font-face{font-family:'Inter Variable';font-style:normal;font-weight:100 900;font-display:swap;src:url('inter.woff2') format('woff2');}\n${themes}`,
  );
  files.set(
    "inter.woff2",
    readFileSync(
      join(
        directory,
        "../../apps/web/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
      ),
    ),
  );
  files.set(
    "inter-LICENSE.txt",
    readFileSync(join(directory, "../../apps/web/node_modules/@fontsource-variable/inter/LICENSE")),
  );
  return files;
}
