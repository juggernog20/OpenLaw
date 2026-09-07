// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads one compiled edition through public documentation or a Help shell.
 * DD-020 makes the formal manual public; TECH-026 supplies sanitized content.
 */
import { useEffect, useRef, type MouseEvent } from "react";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { Form, Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import generated from "virtual:openlaw-documentation";
import {
  searchDocumentation,
  documentationExcerpt,
  resolveDocumentationLink,
  type DocumentationAudience,
  type DocumentationBundle,
  type DocumentationDestination,
} from "../../../../../scripts/documentation/reader.mjs";
import { PageTitle } from "../page-title";
import "../../../../../scripts/documentation/reader.css";

const M = defineMessages({
  editionIdentity: { id: "docs.editionIdentity", defaultMessage: "{id} ({channel})" },
  supportedIdentity: { id: "docs.supportedIdentity", defaultMessage: "{version} / {commit}" },
  distributionIdentity: { id: "docs.distributionIdentity", defaultMessage: "{commit} ({state})" },
  development: { id: "docs.channel.development", defaultMessage: "Development" },
  release: { id: "docs.channel.release", defaultMessage: "Release" },
  title: { id: "docs.title", defaultMessage: "Documentation" },
  search: { id: "docs.search", defaultMessage: "Search documentation" },
  searchButton: { id: "docs.searchButton", defaultMessage: "Search" },
  audience: { id: "docs.audience", defaultMessage: "Audience" },
  allReaders: { id: "docs.allReaders", defaultMessage: "All readers" },
  all: { id: "docs.all", defaultMessage: "All documentation" },
  help: { id: "docs.help", defaultMessage: "Help" },
  forAudience: { id: "docs.forAudience", defaultMessage: "Guides for {audience}" },
  outsideAudience: {
    id: "docs.outsideAudience",
    defaultMessage:
      "This article is available in the full documentation. Check its audience and prerequisites before following the instructions.",
  },
  outline: { id: "docs.outline", defaultMessage: "On this page" },
  edition: { id: "docs.edition", defaultMessage: "Edition details" },
  unavailable: { id: "docs.unavailable", defaultMessage: "Article unavailable" },
  unavailableBody: {
    id: "docs.unavailableBody",
    defaultMessage:
      "This article is not available in the bundled edition. Search the available guides or return to the index.",
  },
  wrongEdition: {
    id: "docs.wrongEdition",
    defaultMessage:
      "The requested edition is not bundled with this instance. Open the current index or use your retained copy of that edition.",
  },
  preview: {
    id: "docs.preview",
    defaultMessage: "Development preview: draft and validation content is unverified.",
  },
  unverified: { id: "docs.unverified", defaultMessage: "Unverified article" },
  empty: {
    id: "docs.empty",
    defaultMessage: "No verified articles are available in this edition yet.",
  },
  noMatches: {
    id: "docs.noMatches",
    defaultMessage: "No matching articles. Try another word or return to the full index.",
  },
  missingSection: {
    id: "docs.missingSection",
    defaultMessage:
      "The requested section is unavailable. Use the page outline to find the current instructions.",
  },
  formal: { id: "docs.formal", defaultMessage: "Read this article in the full documentation" },
  download: { id: "docs.download", defaultMessage: "Download standalone edition" },
  standalone: { id: "docs.standalone", defaultMessage: "Open standalone edition" },
  retention: {
    id: "docs.retention",
    defaultMessage:
      "Keep an extracted copy outside this instance to read it when the app is unavailable.",
  },
  supported: { id: "docs.supported", defaultMessage: "Supported app" },
  distribution: { id: "docs.distribution", defaultMessage: "Distribution commit" },
  digest: { id: "docs.digest", defaultMessage: "Content digest" },
  target: { id: "docs.target", defaultMessage: "Publication target" },
  notVerified: { id: "docs.notVerified", defaultMessage: "Not yet verified" },
  notRecorded: { id: "docs.notRecorded", defaultMessage: "Not recorded" },
  dirty: { id: "docs.dirty", defaultMessage: "Working changes" },
  notice: { id: "docs.notice", defaultMessage: "Preview build notices" },
  admin: { id: "docs.role.admin", defaultMessage: "Administrator" },
  member: { id: "docs.role.member", defaultMessage: "Legal Team Member" },
  contributor: { id: "docs.role.contributor", defaultMessage: "Contributor" },
  business: { id: "docs.role.business", defaultMessage: "Business User" },
  operator: { id: "docs.role.operator", defaultMessage: "Deployment operator" },
});
const ROLES = {
  administrator: M.admin,
  legal_team_member: M.member,
  contributor: M.contributor,
  business_user: M.business,
  operator: M.operator,
};
const BASE = { formal: "/documentation", "staff-help": "/help", "portal-help": "/portal/help" };

export function DocumentationReader({
  bundle = generated,
  destination = "formal",
  audience,
}: {
  bundle?: DocumentationBundle;
  destination?: DocumentationDestination;
  audience?: DocumentationAudience;
}) {
  const intl = useIntl(),
    location = useLocation(),
    params = useParams();
  const main = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const Container = destination === "formal" ? "main" : "section";
  const id = params.articleId ?? params["*"] ?? "";
  const base = BASE[destination];
  const query = new URLSearchParams(location.search);
  const q = query.get("q") ?? "";
  const requestedAudience = query.get("audience") ?? "";
  const selectedAudience =
    audience ?? (Object.hasOwn(ROLES, requestedAudience) ? requestedAudience : "");
  const topics = [...new Set(query.getAll("topic").filter((key) => bundle.contexts.includes(key)))];
  let hash = location.hash;
  try {
    hash = decodeURIComponent(hash);
  } catch {
    hash = "#!invalid";
  }
  const resolved = resolveDocumentationLink(bundle, id, hash);
  const article = bundle.articles.find((a) => a.id === id);
  const wrongEdition = Boolean(query.get("edition") && query.get("edition") !== bundle.edition.id);
  const permitted =
    article?.destinations.includes(destination) &&
    (!audience || article.audiences.includes(audience));
  const missingSection = Boolean(
    article &&
    hash &&
    resolved === `${id}${hash}` &&
    !article.outline.some((h) => `#${h.id}` === hash),
  );
  const results = searchDocumentation(bundle, {
    query: q,
    destination,
    audience: selectedAudience,
    topics,
  });
  const title = wrongEdition
    ? intl.formatMessage(M.unavailable)
    : id
      ? (article?.title ?? intl.formatMessage(M.unavailable))
      : intl.formatMessage(destination === "formal" ? M.title : M.help);
  useEffect(() => {
    const target = hash
      ? document.getElementById(hash.slice(1))
      : main.current?.querySelector<HTMLElement>("h1");
    (target ?? main.current)?.focus();
    if (hash && target) target.scrollIntoView?.({ block: "start" });
  }, [location.pathname, location.search, hash]);
  if (!wrongEdition && resolved && resolved !== `${id}${hash}`) {
    const [target, fragment] = resolved.split("#");
    return (
      <Navigate
        replace
        to={`${base}/${target}${location.search}${fragment ? `#${fragment}` : ""}`}
      />
    );
  }
  function followArticleLink(event: MouseEvent<HTMLElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    const href = link?.getAttribute("href");
    if (!href || link?.hasAttribute("download") || link?.getAttribute("target")) return;
    if (!href.startsWith("#") && !/^\/(documentation|help|portal\/help)([/?#]|$)/.test(href))
      return;
    event.preventDefault();
    void navigate(href.startsWith("#") ? `${location.pathname}${location.search}${href}` : href);
  }
  const sectionTitle = (section: string) =>
    bundle.sections.find((s) => s.id === section)?.title ?? section;
  const resultList = (items: typeof results) => (
    <div className="docs-results">
      {items.map((a) => (
        <section className="docs-result" key={a.id}>
          <h2>
            <Link to={`${base}/${a.id}`}>{a.title}</Link>
          </h2>
          <p>{sectionTitle(a.section)}</p>
          {q && <p>{documentationExcerpt(a, q)}</p>}
          {a.unverified && <p>{intl.formatMessage(M.unverified)}</p>}
        </section>
      ))}
    </div>
  );
  return (
    <Container ref={main} id="docs-main" tabIndex={-1} className="docs-reader">
      <PageTitle title={title} />
      {bundle.preview && (
        <p className="docs-notice" role="status">
          {intl.formatMessage(M.preview)}
        </p>
      )}
      <nav aria-label={intl.formatMessage(M.title)}>
        <ul className="docs-inline-links">
          <li>
            <Link to={base}>{intl.formatMessage(destination === "formal" ? M.all : M.help)}</Link>
          </li>
          {destination !== "formal" && (
            <li>
              <Link to={article ? `/documentation/${article.id}${hash}` : "/documentation"}>
                {intl.formatMessage(article ? M.formal : M.all)}
              </Link>
            </li>
          )}
        </ul>
      </nav>
      <Form
        method="get"
        action={base}
        role="search"
        key={`${q}:${selectedAudience}:${topics.join(",")}`}
      >
        <div className="docs-search-field">
          <label htmlFor="docs-query">{intl.formatMessage(M.search)}</label>
          <input id="docs-query" name="q" type="search" defaultValue={q} />
        </div>
        {!audience && (
          <div className="docs-audience-field">
            <label htmlFor="docs-audience">{intl.formatMessage(M.audience)}</label>
            <select id="docs-audience" name="audience" defaultValue={selectedAudience}>
              <option value="">{intl.formatMessage(M.allReaders)}</option>
              {Object.entries(ROLES).map(([key, message]) => (
                <option key={key} value={key}>
                  {intl.formatMessage(message)}
                </option>
              ))}
            </select>
          </div>
        )}
        {topics.map((topic) => (
          <input key={topic} type="hidden" name="topic" value={topic} />
        ))}
        <button type="submit">{intl.formatMessage(M.searchButton)}</button>
      </Form>
      {wrongEdition || (id && !article) ? (
        <>
          <h1 tabIndex={-1}>{intl.formatMessage(M.unavailable)}</h1>
          <p>{intl.formatMessage(wrongEdition ? M.wrongEdition : M.unavailableBody)}</p>
        </>
      ) : article ? (
        !permitted ? (
          <>
            <h1 tabIndex={-1}>{article.title}</h1>
            <p>{intl.formatMessage(M.outsideAudience)}</p>
            <Link to={`/documentation/${article.id}${hash}`}>{intl.formatMessage(M.formal)}</Link>
          </>
        ) : (
          <>
            {article.unverified && (
              <p className="docs-notice">{intl.formatMessage(M.unverified)}</p>
            )}
            {missingSection && (
              <p role="status" className="docs-notice">
                {intl.formatMessage(M.missingSection)}
              </p>
            )}
            <div className="docs-columns">
              <nav className="docs-outline" aria-label={intl.formatMessage(M.outline)}>
                <p>{intl.formatMessage(M.outline)}</p>
                <ul>
                  {article.outline
                    .filter((h) => h.depth > 1)
                    .map((h) => (
                      <li key={h.id}>
                        <Link to={`${location.pathname}${location.search}#${h.id}`}>{h.text}</Link>
                      </li>
                    ))}
                </ul>
              </nav>
              <article
                onClick={followArticleLink}
                dangerouslySetInnerHTML={{ __html: article.html[destination] }}
              />
            </div>
          </>
        )
      ) : (
        <>
          <h1 tabIndex={-1}>{intl.formatMessage(destination === "formal" ? M.title : M.help)}</h1>
          {audience && (
            <p>
              {intl.formatMessage(M.forAudience, { audience: intl.formatMessage(ROLES[audience]) })}
            </p>
          )}
          {results.length === 0 ? (
            <p role="status">
              {intl.formatMessage(bundle.articles.length ? M.noMatches : M.empty)}
            </p>
          ) : q || (!audience && selectedAudience) || topics.length ? (
            resultList(results)
          ) : (
            bundle.sections.map((section) => {
              const articles = results.filter((a) => a.section === section.id);
              return articles.length ? (
                <section key={section.id}>
                  <h2>{section.title}</h2>
                  <ul>
                    {articles.map((a) => (
                      <li key={a.id}>
                        <Link to={`${base}/${a.id}`}>{a.title}</Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null;
            })
          )}
        </>
      )}
      {bundle.preview && bundle.warnings.length > 0 && (
        <details>
          <summary>{intl.formatMessage(M.notice)}</summary>
          <ul>
            {bundle.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <details id="edition">
        <summary>{intl.formatMessage(M.edition)}</summary>
        <dl>
          <dt>{intl.formatMessage(M.edition)}</dt>
          <dd>
            {intl.formatMessage(M.editionIdentity, {
              id: bundle.edition.id,
              channel: intl.formatMessage(
                bundle.edition.channel === "development" ? M.development : M.release,
              ),
            })}
          </dd>
          <dt>{intl.formatMessage(M.supported)}</dt>
          <dd>
            {intl.formatMessage(M.supportedIdentity, {
              version: bundle.edition.supportedAppVersion,
              commit: bundle.edition.supportedAppCommit ?? intl.formatMessage(M.notVerified),
            })}
          </dd>
          <dt>{intl.formatMessage(M.distribution)}</dt>
          <dd>
            {bundle.edition.workingChanges
              ? intl.formatMessage(M.distributionIdentity, {
                  commit: bundle.edition.distributionCommit ?? intl.formatMessage(M.notRecorded),
                  state: intl.formatMessage(M.dirty),
                })
              : (bundle.edition.distributionCommit ?? intl.formatMessage(M.notRecorded))}
          </dd>
          <dt>{intl.formatMessage(M.digest)}</dt>
          <dd>{bundle.edition.contentDigest}</dd>
          <dt>{intl.formatMessage(M.target)}</dt>
          <dd>{bundle.edition.publicationTarget}</dd>
        </dl>
        <ul className="docs-inline-links">
          <li>
            <a href="/documentation-export/index.html">{intl.formatMessage(M.standalone)}</a>
          </li>
          <li>
            <a href="/documentation-export/openlaw-documentation.tar.gz" download>
              {intl.formatMessage(M.download)}
            </a>
          </li>
        </ul>
        <p>{intl.formatMessage(M.retention)}</p>
      </details>
    </Container>
  );
}

export function FormalDocumentationPage() {
  return (
    <div className="docs-public">
      <a className="docs-skip" href="#docs-main">
        <FormattedMessage id="docs.skip" defaultMessage="Skip to content" />
      </a>
      <header>
        <Link to="/documentation">
          <FormattedMessage id="docs.brand" defaultMessage="OpenLaw documentation" />
        </Link>
      </header>
      <DocumentationReader />
    </div>
  );
}
