// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Compiles only eligible canonical articles, with evidence and link checks before
 * reader data leaves the build. TECH-026 requires sanitization after rendering.
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { normalizeSearch, searchDocumentation, resolveDocumentationLink } from "./reader.mjs";

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const AUDIENCES = [
  "legal_team_member",
  "administrator",
  "contributor",
  "business_user",
  "operator",
];
const AUDIENCE_LABELS = {
  legal_team_member: "Legal Team Member",
  administrator: "Administrator",
  contributor: "Contributor",
  business_user: "Business User",
  operator: "Deployment operator",
};
const DESTINATIONS = ["formal", "staff-help", "portal-help"];
const RESERVED_ANCHORS = [
  "docs-main",
  "edition",
  "docs-query",
  "docs-audience",
  "docs-search",
  "docs-index",
  "docs-results",
  "docs-missing-section",
];
const STATES = ["scoped", "ready", "draft", "review", "verified", "published"];
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function requireThat(condition, message) {
  if (!condition) throw new Error(`Documentation: ${message}`);
}
function nonempty(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !/replace-with|^agent-or-human$/.test(value)
  );
}
function array(value, message) {
  requireThat(Array.isArray(value), message);
  return value;
}
function unique(values, message) {
  requireThat(new Set(values).size === values.length, message);
}
function strings(value, message, allowed) {
  array(value, message);
  requireThat(
    value.length > 0 && value.every((v) => nonempty(v) && (!allowed || allowed.includes(v))),
    message,
  );
  unique(value, message);
}
function readOwned(root, name) {
  const path = resolve(root, name),
    parent = resolve(root);
  requireThat(path.startsWith(parent + sep), `path outside source tree: ${name}`);
  requireThat(!lstatSync(parent).isSymbolicLink(), `source root symlink forbidden: ${root}`);
  let at = parent;
  for (const part of relative(parent, path).split(sep)) {
    at = join(at, part);
    requireThat(existsSync(at), `missing file: ${name}`);
    requireThat(!lstatSync(at).isSymbolicLink(), `symlink forbidden: ${name}`);
  }
  requireThat(lstatSync(path).isFile(), `not a file: ${name}`);
  return readFileSync(path);
}
function json(root, name) {
  return JSON.parse(readOwned(root, name).toString("utf8"));
}
function plain(html) {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) =>
      String.fromCodePoint(n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n)),
    )
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, n) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[n],
    )
    .replace(/\s+/g, " ")
    .trim();
}
function anchor(text) {
  return normalizeSearch(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function validDate(value) {
  return nonempty(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now();
}

function validateCatalog(catalog, scenarios, bindings) {
  requireThat(catalog.schemaVersion === 1, "unsupported catalog schema");
  array(catalog.sections, "sections required");
  array(catalog.articles, "articles required");
  unique(
    catalog.sections.map((s) => s.id),
    "duplicate section ID",
  );
  unique(
    catalog.articles.map((a) => a.id),
    "duplicate article ID",
  );
  for (const s of catalog.sections)
    requireThat(ID.test(s.id) && nonempty(s.title), "invalid section");
  for (const a of catalog.articles) {
    requireThat(ID.test(a.id) && a.id !== "index" && nonempty(a.title), "invalid article ID/title");
    requireThat(
      catalog.sections.some((s) => s.id === a.section),
      `unknown section: ${a.id}`,
    );
    requireThat(
      ["how-to", "explanation", "reference", "troubleshooting"].includes(a.kind) &&
        STATES.includes(a.status) &&
        ["P0", "P1"].includes(a.priority) &&
        /^DOC-\d{3}$/.test(a.ownerTask),
      `invalid article metadata: ${a.id}`,
    );
    strings(a.audiences, `invalid audiences: ${a.id}`, AUDIENCES);
    strings(a.destinations, `invalid destinations: ${a.id}`, DESTINATIONS);
    requireThat(a.destinations.includes("formal"), `formal destination required: ${a.id}`);
    strings(a.coverage, `coverage required: ${a.id}`);
    requireThat(
      a.coverage.every((c) => /^C\d{2}$/.test(c)),
      `invalid coverage: ${a.id}`,
    );
    array(a.contexts, `contexts required: ${a.id}`);
    unique(a.contexts, `duplicate contexts: ${a.id}`);
    requireThat(
      a.contexts.every((c) => /^[a-z][a-z0-9.-]*$/.test(c)),
      `invalid contexts: ${a.id}`,
    );
    requireThat(
      scenarios.some((s) => s.articles.includes(a.id)),
      `missing scenario: ${a.id}`,
    );
  }
  unique(
    scenarios.map((s) => s.id),
    "duplicate scenario ID",
  );
  for (const scenario of scenarios) {
    requireThat(nonempty(scenario.id), "scenario ID required");
    array(scenario.articles, "scenario articles required");
    array(scenario.coverage, "scenario coverage required");
    strings(scenario.roles, "scenario roles required", [...AUDIENCES, "anonymous"]);
    strings(scenario.requiredMethods, "scenario methods required", [
      "source-inspection",
      "browser-walkthrough",
      "automated-test",
      "container-operation",
      "live-provider-check",
    ]);
    requireThat(
      scenario.articles.every((id) => catalog.articles.some((a) => a.id === id)),
      "unknown scenario article",
    );
  }
  for (const article of catalog.articles) {
    const mapped = scenarios.filter((s) => s.articles.includes(article.id));
    requireThat(
      article.coverage.every((c) => mapped.some((s) => s.coverage.includes(c))) &&
        article.audiences.every((r) => mapped.some((s) => s.roles.includes(r))),
      `incomplete scenario coverage/roles: ${article.id}`,
    );
  }
  const contexts = [...new Set(catalog.articles.flatMap((a) => a.contexts))];
  for (const b of bindings) {
    strings(b.routes, "binding routes required");
    strings(b.contexts, "binding contexts required");
    requireThat(
      ["staff", "portal", "both", "formal"].includes(b.surface) &&
        typeof b.pilotEntry === "boolean",
      "invalid binding surface",
    );
    requireThat(
      b.contexts.every((c) => contexts.includes(c)),
      "unregistered Help context",
    );
  }
  requireThat(
    contexts.every((c) => bindings.some((b) => b.contexts.includes(c))),
    "unbound Help context",
  );
  return contexts;
}

function verifyEvidence(a, source, metadataRoot, edition, scenarios) {
  const e = json(metadataRoot, `evidence/${a.id}.json`);
  requireThat(
    e.articleId === a.id && e.contentSha256 === sha256(source),
    `evidence hash mismatch: ${a.id}`,
  );
  requireThat(e.status === "pass" && validDate(e.verifiedAt), `unverified evidence: ${a.id}`);
  requireThat(
    SHA.test(e.appCommit) && e.appCommit === edition.supportedAppCommit,
    `evidence app build mismatch: ${a.id}`,
  );
  for (const key of [
    "author",
    "technicalReviewer",
    "walkthroughReviewer",
    "environment",
    "buildId",
  ])
    requireThat(nonempty(e[key]), `missing evidence ${key}: ${a.id}`);
  requireThat(["agent", "human"].includes(e.reviewerKind), `reviewer kind required: ${a.id}`);
  requireThat(
    normalizeSearch(e.author) !== normalizeSearch(e.walkthroughReviewer),
    `independent walkthrough required: ${a.id}`,
  );
  strings(e.sources, `source evidence required: ${a.id}`);
  array(e.scenarios, `scenario evidence required: ${a.id}`);
  requireThat(
    e.scenarios.length > 0 &&
      e.scenarios.every(
        (s) =>
          s.result === "pass" &&
          nonempty(s.actual) &&
          nonempty(s.expected) &&
          Array.isArray(s.evidence) &&
          s.evidence.length &&
          s.evidence.every(nonempty),
      ),
    `failed or incomplete scenario: ${a.id}`,
  );
  const required = scenarios.filter((s) => s.articles.includes(a.id));
  for (const s of required)
    for (const role of s.roles)
      for (const method of s.requiredMethods) {
        requireThat(
          e.scenarios.some(
            (r) =>
              r.id === s.id &&
              r.role === role &&
              r.method === method &&
              a.coverage
                .filter((c) => s.coverage.includes(c))
                .every((c) => r.coverage?.includes(c)),
          ),
          `missing scenario ${s.id}/${role}/${method}: ${a.id}`,
        );
      }
  return e;
}

const sanitizeOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "ul",
    "ol",
    "li",
    "blockquote",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "pre",
    "code",
    "strong",
    "em",
    "del",
    "hr",
    "br",
    "a",
    "img",
    "div",
    "span",
  ],
  allowedAttributes: {
    h1: ["id", "tabindex"],
    h2: ["id", "tabindex"],
    h3: ["id", "tabindex"],
    h4: ["id", "tabindex"],
    h5: ["id", "tabindex"],
    h6: ["id", "tabindex"],
    a: ["href", "title", "rel"],
    img: ["src", "alt", "title", "loading"],
    ol: ["start"],
    th: ["scope"],
    div: ["class", "tabindex", "role", "aria-label"],
    span: ["id"],
  },
  allowedClasses: { div: ["docs-scroll"] },
  allowedSchemes: ["https", "http", "mailto"],
  allowedSchemesByTag: { img: [] },
  allowProtocolRelative: false,
};

/** Validates the whole catalog; returns only eligible reader data and safe export files. */
export function compileDocumentation({
  contentRoot,
  metadataRoot,
  build,
  preview = false,
  complete = false,
}) {
  const catalog = json(metadataRoot, "articles.json"),
    edition = json(metadataRoot, "edition.json");
  const scenarios = array(
    json(metadataRoot, "scenarios.json").scenarios,
    "scenario registry required",
  );
  const bindings = array(
    json(metadataRoot, "help-contexts.json").bindings,
    "Help bindings required",
  );
  const redirects = array(json(metadataRoot, "redirects.json").redirects, "redirects required");
  const contexts = validateCatalog(catalog, scenarios, bindings);
  requireThat(
    edition.schemaVersion === 1 &&
      ID.test(edition.id) &&
      ["development", "release"].includes(edition.channel) &&
      nonempty(edition.supportedAppVersion) &&
      nonempty(edition.publicationTarget),
    "invalid edition metadata",
  );
  requireThat(
    edition.supportedAppCommit === null || SHA.test(edition.supportedAppCommit),
    "invalid supported app commit",
  );
  requireThat(
    !preview || edition.channel === "development",
    "release cannot include preview content",
  );
  requireThat(!complete || !preview, "complete publication cannot use preview");
  requireThat(
    !complete || !build.dirty,
    "complete publication requires a clean distribution build",
  );
  requireThat(
    edition.channel !== "release" || (SHA.test(build.commit) && !build.dirty),
    "release needs an explicit clean distribution commit",
  );
  requireThat(build.commit === null || SHA.test(build.commit), "invalid distribution commit");
  requireThat(HASH.test(build.applicationSha256), "application digest required");
  const warnings = [],
    assetFiles = new Map(),
    parsed = new Map();
  const eligible = catalog.articles.filter(
    (a) =>
      ["verified", "published"].includes(a.status) ||
      (preview && ["draft", "review"].includes(a.status)),
  );
  const verified = eligible.filter((a) => ["verified", "published"].includes(a.status));
  if (verified.length) {
    const c = edition.compatibilityReview;
    requireThat(SHA.test(build.commit), "verified content needs a recorded app build");
    requireThat(
      c &&
        c.testedAppCommit === edition.supportedAppCommit &&
        c.applicationSha256 === build.applicationSha256 &&
        nonempty(c.reviewer) &&
        validDate(c.reviewedAt) &&
        nonempty(c.summary),
      "application compatibility review is missing or stale",
    );
  }
  const parser = new Marked({ gfm: true });
  for (const a of eligible) {
    const bytes = readOwned(contentRoot, `${a.id}.md`),
      source = bytes.toString("utf8");
    const unverified = !["verified", "published"].includes(a.status);
    if (!unverified) verifyEvidence(a, bytes, metadataRoot, edition, scenarios);
    const tokens = parser.lexer(source),
      outline = [],
      assets = [];
    let lastDepth = 0;
    parser.walkTokens(tokens, (token) => {
      requireThat(token.type !== "html", `raw HTML forbidden: ${a.id}`);
      if (token.type === "paragraph")
        requireThat(
          !/^\s*(?:import\s|export\s|\{)/m.test(token.text),
          `MDX imports/exports/expressions forbidden: ${a.id}`,
        );
      requireThat(!token.task, `interactive task lists forbidden: ${a.id}`);
      if (token.type === "heading") {
        const text = plain(parser.parseInline(token.text));
        requireThat(token.depth <= lastDepth + 1, `heading level skipped: ${a.id}`);
        requireThat(token.depth !== 1 || outline.length === 0, `single H1 required: ${a.id}`);
        const id = anchor(text);
        requireThat(
          id && !RESERVED_ANCHORS.includes(id) && !outline.some((h) => h.id === id),
          `duplicate, reserved or empty heading anchor: ${a.id}`,
        );
        token.anchor = id;
        outline.push({ id, text, depth: token.depth });
        lastDepth = token.depth;
      }
      if (token.type === "code")
        requireThat(nonempty(token.lang), `code fence language required: ${a.id}`);
      if (token.type === "image") {
        requireThat(
          /^assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp|gif)$/.test(
            token.href,
          ),
          `invalid local image path: ${a.id}`,
        );
        requireThat(nonempty(token.text), `image alt text required: ${a.id}`);
        const asset = readOwned(contentRoot, token.href);
        assetFiles.set(token.href, asset);
        assets.push({ path: token.href, sha256: sha256(asset) });
      }
    });
    requireThat(
      outline[0]?.depth === 1 && outline[0]?.text === a.title,
      `H1 title must match catalog: ${a.id}`,
    );
    parsed.set(a.id, { a, tokens, outline, unverified, contentSha256: sha256(bytes), assets });
  }
  unique(
    redirects.map((r) => r.from),
    "duplicate redirect alias",
  );
  const targetPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:#[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
  for (const r of redirects) {
    requireThat(
      targetPattern.test(r.from) && targetPattern.test(r.to) && r.from !== r.to,
      "invalid redirect",
    );
    const [id, hash] = r.from.split("#");
    requireThat(id !== "index" && !RESERVED_ANCHORS.includes(hash), "reserved redirect alias");
    requireThat(
      !hash || parsed.has(id) || redirects.some((alias) => alias.from === id),
      "redirect anchor has no source page",
    );
    requireThat(
      hash
        ? !parsed.get(id)?.outline.some((h) => h.id === hash)
        : !catalog.articles.some((a) => a.id === id),
      "redirect shadows current article or anchor",
    );
    const result = resolveDocumentationLink({ redirects }, r.from);
    const [target, fragment] = result?.split("#") ?? [];
    requireThat(
      target &&
        parsed.has(target) &&
        (!fragment || parsed.get(target).outline.some((h) => h.id === fragment)),
      `redirect loop or missing target: ${r.from}`,
    );
  }
  function link(href, from, destination) {
    if (/^(https?:\/\/|mailto:)/i.test(href)) {
      let url;
      try {
        url = new URL(href);
      } catch {
        requireThat(false, `invalid URL: ${from}`);
      }
      requireThat(
        // eslint-disable-next-line no-control-regex -- Refuse ASCII controls in authored URLs.
        !url.username && !url.password && !/[\u0000-\u0020\\]/.test(href),
        `invalid external URL: ${from}`,
      );
      return href;
    }
    const match = /^(?:([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.md)?(#[a-z0-9]+(?:-[a-z0-9]+)*)?$/.exec(
      href,
    );
    requireThat(match && (match[1] || match[2]), `invalid internal link or URL: ${from}`);
    const id = match[1] ?? from,
      resolved = resolveDocumentationLink({ redirects }, id, match[2] ?? "");
    requireThat(resolved, `redirect loop: ${href}`);
    const [target, fragment] = resolved.split("#"),
      found = parsed.get(target);
    if (!found) {
      requireThat(preview, `link to unpublished article ${target} from ${from}`);
      const warning = `${from}: unpublished target ${target}`;
      if (!warnings.includes(warning)) warnings.push(warning);
    } else
      requireThat(
        !fragment || found.outline.some((h) => h.id === fragment),
        `missing anchor ${href} from ${from}`,
      );
    const surface =
      destination !== "standalone" && found && !found.a.destinations.includes(destination)
        ? "formal"
        : destination;
    const prefix = {
      formal: "/documentation/",
      "staff-help": "/help/",
      "portal-help": "/portal/help/",
      standalone: "",
    }[surface];
    return `${prefix}${target}${surface === "standalone" ? ".html" : ""}${fragment ? `#${fragment}` : ""}`;
  }
  const articles = [];
  for (const { a, tokens, outline, unverified, contentSha256, assets } of parsed.values()) {
    const html = {};
    for (const destination of [...DESTINATIONS, "standalone"]) {
      const renderer = new Marked({
        gfm: true,
        renderer: {
          heading(token) {
            const aliases = redirects
              .filter(
                (r) =>
                  r.from.startsWith(`${a.id}#`) &&
                  resolveDocumentationLink({ redirects }, r.from) === `${a.id}#${token.anchor}`,
              )
              .map((r) => `<span id="${escape(r.from.split("#")[1])}"></span>`)
              .join("");
            return `${aliases}<h${token.depth} id="${token.anchor}" tabindex="-1">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
          },
          link(token) {
            return `<a href="${escape(link(token.href, a.id, destination))}"${token.title ? ` title="${escape(token.title)}"` : ""}>${this.parser.parseInline(token.tokens)}</a>`;
          },
          image(token) {
            return `<img src="${destination === "standalone" ? "" : "/documentation-export/"}${escape(token.href)}" alt="${escape(token.text)}" loading="lazy">`;
          },
          table(token) {
            const cell = (c, tag) =>
              `<${tag}${tag === "th" ? ' scope="col"' : ""}>${this.parser.parseInline(c.tokens)}</${tag}>`;
            return `<div class="docs-scroll" tabindex="0" role="region" aria-label="Table"><table><thead><tr>${token.header.map((c) => cell(c, "th")).join("")}</tr></thead><tbody>${token.rows.map((row) => `<tr>${row.map((c) => cell(c, "td")).join("")}</tr>`).join("")}</tbody></table></div>`;
          },
          code(token) {
            return `<div class="docs-scroll" tabindex="0" role="region" aria-label="Code example"><pre><code>${escape(token.text)}</code></pre></div>`;
          },
        },
      });
      html[destination] = sanitizeHtml(renderer.parser(tokens), sanitizeOptions);
    }
    articles.push({
      id: a.id,
      title: a.title,
      section: a.section,
      audiences: a.audiences,
      destinations: a.destinations,
      contexts: a.contexts,
      outline,
      html,
      text: plain(html.formal.replace(/<\/[^>]+>/g, "$& ")),
      unverified,
      contentSha256,
      assets,
    });
  }
  const coverage = [...new Set(catalog.articles.flatMap((a) => a.coverage))];
  const report = {
    required: catalog.articles.length,
    verified: verified.length,
    coverageRequired: coverage.length,
    coverageVerified: coverage.filter((c) =>
      catalog.articles.filter((a) => a.coverage.includes(c)).every((a) => verified.includes(a)),
    ).length,
  };
  requireThat(
    !complete ||
      (report.verified === report.required &&
        report.coverageVerified === report.coverageRequired &&
        warnings.length === 0),
    "complete suite still has unverified articles or coverage",
  );
  const contentDigest = sha256(
    JSON.stringify({
      articles,
      sections: catalog.sections,
      redirects,
      contexts,
      readerAssets: ["reader.css", "reader.mjs"].map((name) => ({
        name,
        sha256: sha256(readFileSync(join(dirname(fileURLToPath(import.meta.url)), name))),
      })),
    }),
  );
  if (complete) {
    const evidence = json(metadataRoot, "evidence/publication.json");
    requireThat(
      evidence.status === "pass" &&
        evidence.editionId === edition.id &&
        evidence.contentDigest === contentDigest &&
        evidence.appCommit === edition.supportedAppCommit &&
        nonempty(evidence.reviewer) &&
        validDate(evidence.reviewedAt),
      "complete publication evidence is missing or stale",
    );
    array(evidence.scenarios, "publication scenarios required");
    for (const scenario of scenarios.filter((s) => s.articles.length === 0))
      for (const role of scenario.roles)
        for (const method of scenario.requiredMethods) {
          requireThat(
            evidence.scenarios.some(
              (s) =>
                s.id === scenario.id &&
                s.role === role &&
                s.method === method &&
                s.result === "pass" &&
                nonempty(s.actual) &&
                Array.isArray(s.evidence) &&
                s.evidence.length > 0,
            ),
            `missing publication scenario ${scenario.id}/${role}/${method}`,
          );
        }
  }
  const bundle = {
    schemaVersion: 1,
    edition: {
      id: edition.id,
      channel: edition.channel,
      supportedAppVersion: edition.supportedAppVersion,
      supportedAppCommit: edition.supportedAppCommit,
      distributionCommit: build.commit,
      workingChanges: build.dirty,
      publicationTarget: edition.publicationTarget,
      contentDigest,
    },
    preview,
    sections: catalog.sections,
    contexts,
    bindings,
    redirects,
    articles,
    warnings,
    report,
  };
  return { bundle, files: standaloneFiles(bundle, assetFiles) };
}

function standaloneFiles(bundle, assets) {
  const files = new Map(assets);
  const articleList = (items) =>
    `<ul>${items.map((a) => `<li><a href="${a.id}.html">${escape(a.title)}</a></li>`).join("")}</ul>`;
  const sections = bundle.sections
    .map((s) => {
      const items = bundle.articles.filter((a) => a.section === s.id);
      return items.length
        ? `<section><h2>${escape(s.title)}</h2>${articleList(items)}</section>`
        : "";
    })
    .join("");
  const edition = `<details id="edition"><summary>Edition details</summary><dl><dt>Edition</dt><dd>${escape(bundle.edition.id)} (${bundle.edition.channel})</dd><dt>Supported app</dt><dd>${escape(bundle.edition.supportedAppVersion)} / ${escape(bundle.edition.supportedAppCommit ?? "Not yet verified")}</dd><dt>Distribution commit</dt><dd>${escape(bundle.edition.distributionCommit ?? "Not recorded")}${bundle.edition.workingChanges ? " (working changes)" : ""}</dd><dt>Content digest</dt><dd>${bundle.edition.contentDigest}</dd><dt>Publication target</dt><dd>${escape(bundle.edition.publicationTarget)}</dd></dl></details>`;
  const page = (title, content) =>
    `<!doctype html><html lang="en-US" class="docs-static"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escape(title)} · OpenLaw</title><link rel="stylesheet" href="reader.css"><script src="redirect.js" defer></script></head><body class="docs-public"><a class="docs-skip" href="#docs-main">Skip to content</a><header><a href="index.html">OpenLaw documentation</a></header><main id="docs-main" class="docs-reader" tabindex="-1">${bundle.preview ? '<p class="docs-notice">Development preview: unverified validation or draft content.</p>' : ""}${content}${edition}</main></body></html>`;
  files.set(
    "index.html",
    page(
      "Documentation",
      `<h1>OpenLaw documentation</h1><form id="docs-search" role="search"><div class="docs-search-field"><label for="docs-query">Search documentation</label><input id="docs-query" name="q" type="search"></div><div class="docs-audience-field"><label for="docs-audience">Audience</label><select id="docs-audience" name="audience"><option value="">All readers</option>${AUDIENCES.map((a) => `<option value="${a}">${escape(AUDIENCE_LABELS[a])}</option>`).join("")}</select></div><button>Search</button></form><noscript><p>Search requires JavaScript. All available articles are listed below.</p></noscript><div id="docs-results" aria-live="polite"></div><div id="docs-index">${sections || "<p>No verified articles are available in this edition yet.</p>"}</div><script src="search.js" defer></script>`,
    ),
  );
  for (const a of bundle.articles) {
    const outline = a.outline
      .filter((h) => h.depth > 1)
      .map((h) => `<li><a href="#${h.id}">${escape(h.text)}</a></li>`)
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
    files.set(
      `${a.id}.html`,
      page(
        a.title,
        `<nav aria-label="Article navigation"><a href="index.html">All documentation</a></nav>${a.unverified ? '<p class="docs-notice">Unverified article</p>' : ""}${outline ? `<nav aria-label="On this page"><ul>${outline}</ul></nav>` : ""}${moved}<article>${a.html.standalone}</article>`,
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
    articles: bundle.articles.map(
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
    `${normalizeSearch.toString()}\n${searchDocumentation.toString()}\nconst bundle=${JSON.stringify(searchBundle).replaceAll("<", "\\u003c")};\nconst form=document.getElementById('docs-search');const params=new URLSearchParams(location.search);form.elements.q.value=params.get('q')||'';form.elements.audience.value=params.get('audience')||'';function render(){const q=form.elements.q.value.trim(),audience=form.elements.audience.value;const results=document.getElementById('docs-results');results.replaceChildren();document.getElementById('docs-index').hidden=Boolean(q||audience);if(!q&&!audience)return;const found=searchDocumentation(bundle,{query:q,audience});const status=document.createElement('p');status.textContent=found.length?found.length+' articles found':'No matching articles. Clear the search to see the full index.';results.append(status);for(const article of found){const p=document.createElement('p'),a=document.createElement('a');a.href=article.id+'.html';a.textContent=article.title;p.append(a,document.createTextNode(' — '+article.text.slice(0,180)));results.append(p);}}form.addEventListener('submit',event=>{event.preventDefault();const query=new URLSearchParams();if(form.elements.q.value.trim())query.set('q',form.elements.q.value.trim());if(form.elements.audience.value)query.set('audience',form.elements.audience.value);history.pushState(null,'',location.pathname+(query.size?'?'+query:''));render();});addEventListener('popstate',()=>{const p=new URLSearchParams(location.search);form.elements.q.value=p.get('q')||'';form.elements.audience.value=p.get('audience')||'';render();});render();`,
  );
  files.set(
    "reader.css",
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "reader.css"), "utf8"),
  );
  return files;
}
