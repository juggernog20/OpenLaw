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
import { normalizeSearch, resolveDocumentationLink } from "./reader.mjs";
import { standaloneFiles } from "./standalone.mjs";
import { readOwnedFile } from "./owned-file.mjs";

export const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const AUDIENCES = [
  "legal_team_member",
  "administrator",
  "contributor",
  "business_user",
  "operator",
];
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
  "docs-theme",
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
export function readOwned(root, name) {
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
  // The checks above approve the names on the way down. This opens the last
  // one once and asks the descriptor, so the bytes an evidence record is
  // bound to are the bytes that passed the type check, not whatever the name
  // resolved to on a second lookup.
  try {
    return readOwnedFile(path, name);
  } catch (error) {
    return requireThat(false, error.message);
  }
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
  if (!nonempty(value)) return false;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!parts) return false;
  const [, year, month, day] = parts.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return false;
  return Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now();
}

export function validateCatalog(catalog, scenarios, bindings) {
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
    requireThat(
      !catalog.sections.some((s) => a.id === `section-${s.id}`),
      "article ID collides with a collection page",
    );
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

export function verifyApplicationCompatibility(edition, build) {
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

export function verifyArticleEvidence(a, source, metadataRoot, edition, scenarios) {
  const e = json(metadataRoot, `evidence/${a.id}.json`);
  requireThat(
    e.articleId === a.id && e.contentSha256 === sha256(source),
    `evidence hash mismatch: ${a.id}`,
  );
  requireThat(e.status === "pass" && validDate(e.verifiedAt), `unverified evidence: ${a.id}`);
  requireThat(SHA.test(e.appCommit), `invalid evidence app build: ${a.id}`);
  if (e.appCommit !== edition.supportedAppCommit) {
    const c = e.compatibilityReview;
    requireThat(c, `evidence app build mismatch: ${a.id}`);
    requireThat(
      c.fromAppCommit === e.appCommit &&
        SHA.test(c.toAppCommit) &&
        c.toAppCommit === edition.supportedAppCommit &&
        c.contentSha256 === e.contentSha256 &&
        HASH.test(c.applicationSha256) &&
        c.applicationSha256 === edition.compatibilityReview?.applicationSha256 &&
        nonempty(c.reviewer) &&
        ["agent", "human"].includes(c.reviewerKind) &&
        validDate(c.reviewedAt) &&
        Date.parse(c.reviewedAt) >= Date.parse(e.verifiedAt) &&
        nonempty(c.summary) &&
        Array.isArray(c.evidence) &&
        c.evidence.length > 0,
      `missing or stale article compatibility review: ${a.id}`,
    );
    requireThat(
      nonempty(e.author) && normalizeSearch(c.reviewer) !== normalizeSearch(e.author),
      `independent compatibility review required: ${a.id}`,
    );
    for (const record of c.evidence) {
      requireThat(
        record && nonempty(record.path) && HASH.test(record.sha256),
        `invalid compatibility evidence: ${a.id}`,
      );
      requireThat(
        sha256(readOwned(metadataRoot, record.path)) === record.sha256,
        `compatibility evidence hash mismatch: ${a.id}`,
      );
    }
  }
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
/** TECH-027 keeps the owner's publication decision separate from verification. */
function developmentPublication(edition, catalog) {
  const entries = new Map();
  const publication = edition.publication;
  if (publication === undefined) return entries;
  requireThat(edition.channel === "development", "publication requires a development edition");
  requireThat(
    publication &&
      publication.status === "validation-pending" &&
      nonempty(publication.approvedBy) &&
      validDate(publication.approvedAt) &&
      SHA.test(publication.sourceCommit) &&
      nonempty(publication.reason),
    "invalid development publication authorization",
  );
  array(publication.articles, "publication articles required");
  requireThat(publication.articles.length > 0, "publication articles required");
  for (const entry of publication.articles) {
    requireThat(
      entry && ID.test(entry.id) && HASH.test(entry.contentSha256) && !entries.has(entry.id),
      "invalid or duplicate publication article",
    );
    const article = catalog.articles.find((a) => a.id === entry.id);
    requireThat(
      article && ["draft", "review"].includes(article.status),
      `publication article must be a draft or review: ${entry.id}`,
    );
    entries.set(entry.id, entry.contentSha256);
  }
  return entries;
}

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
    !redirects.some((r) =>
      catalog.sections.some(
        (s) => typeof r.from === "string" && r.from.split("#")[0] === `section-${s.id}`,
      ),
    ),
    "redirect collides with a collection page",
  );
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
  const publication = developmentPublication(edition, catalog);
  const eligible = catalog.articles.filter(
    (a) =>
      ["verified", "published"].includes(a.status) ||
      ((preview || publication.has(a.id)) && ["draft", "review"].includes(a.status)),
  );
  const verified = eligible.filter((a) => ["verified", "published"].includes(a.status));
  if (verified.length) verifyApplicationCompatibility(edition, build);
  const parser = new Marked({ gfm: true });
  for (const a of eligible) {
    const bytes = readOwned(contentRoot, `${a.id}.md`),
      source = bytes.toString("utf8");
    const unverified = !["verified", "published"].includes(a.status);
    if (!preview && publication.has(a.id))
      requireThat(sha256(bytes) === publication.get(a.id), `publication source changed: ${a.id}`);
    if (!unverified) verifyArticleEvidence(a, bytes, metadataRoot, edition, scenarios);
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
  const validationPending = !preview && publication.size > 0;
  const contentDigest = sha256(
    JSON.stringify({
      articles,
      validationPending,
      sections: catalog.sections,
      redirects,
      contexts,
      readerAssets: [
        "reader.css",
        "reader.mjs",
        "standalone.mjs",
        "standalone-browser.mjs",
        "../../styles/themes/light.css",
        "../../styles/themes/warm.css",
        "../../styles/themes/dark.css",
        "../../apps/web/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
      ].map((name) => ({
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
    validationPending,
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
