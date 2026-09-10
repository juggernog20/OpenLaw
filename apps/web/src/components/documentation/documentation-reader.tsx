// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads one compiled edition through public documentation or a Help shell.
 * DD-020 makes the formal manual public; TECH-026 supplies sanitized content.
 */
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { FormattedMessage, useIntl } from "react-intl";
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
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Search,
  Scale,
  Compass,
  MessageSquare,
  Users,
  FileText,
  BriefcaseBusiness,
  Files,
  Building2,
  Library,
  SlidersHorizontal,
  Server,
  LifeBuoy,
  type LucideIcon,
} from "lucide-react";
import { isTheme, setDocumentTheme, THEMES, type Theme } from "../../lib/theme";
import { M, ROLES, DESCRIPTIONS } from "./documentation-messages";
import { PageTitle } from "../page-title";
import "../../../../../scripts/documentation/reader.css";

const SECTION_ICONS: Record<string, LucideIcon> = {
  start: Compass,
  portal: MessageSquare,
  "working-with-legal": Users,
  contracts: FileText,
  matters: BriefcaseBusiness,
  documents: Files,
  entities: Building2,
  knowledge: Library,
  administration: SlidersHorizontal,
  operations: Server,
  reference: LifeBuoy,
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
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(true);
  useEffect(() => {
    if (typeof ResizeObserver !== "function" || !main.current) return;
    let previousBreakpoint = "";
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = entry.contentRect.width;
      const breakpoint = `${width >= 880}:${width >= 1152}`;
      if (breakpoint === previousBreakpoint) return;
      previousBreakpoint = breakpoint;
      setNavigationOpen(width >= 880);
      setOutlineOpen(width >= 1152);
    });
    observer.observe(main.current);
    return () => observer.disconnect();
  }, []);
  const navigate = useNavigate();
  const Container = destination === "formal" ? "main" : "section";
  const id = params.articleId ?? params["*"] ?? "";
  const base = BASE[destination];
  const query = new URLSearchParams(location.search);
  const q = query.get("q") ?? "";
  const selectedSection = bundle.sections.find((s) => s.id === query.get("section"));
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
    section: selectedSection?.id,
  });
  const available = searchDocumentation(bundle, { destination, audience: selectedAudience });
  const hasFilters = Boolean(
    q || (!audience && selectedAudience) || topics.length || selectedSection,
  );
  const sections = bundle.sections.filter((s) => available.some((a) => a.section === s.id));
  const siblings = available.filter((a) => a.section === article?.section);
  const position = siblings.findIndex((a) => a.id === id);
  const adjacent = position < 0 ? [] : [siblings[position - 1], siblings[position + 1]];
  const title = wrongEdition
    ? intl.formatMessage(M.unavailable)
    : id
      ? (article?.title ?? intl.formatMessage(M.unavailable))
      : intl.formatMessage(destination === "formal" ? M.title : M.help);
  useEffect(() => {
    const target = hash
      ? document.getElementById(hash.slice(1))
      : main.current?.querySelector<HTMLElement>("h1");
    (target ?? main.current)?.focus({ preventScroll: !hash });
    if (!hash) {
      if (destination === "formal") document.documentElement.scrollTo?.({ top: 0 });
      else {
        const scroll = main.current?.closest("main");
        if (scroll) scroll.scrollTop = 0;
      }
    }
    if (hash && target) target.scrollIntoView?.({ block: "start" });
    // location.key: an outline link to the section already in the address
    // still moves focus, as the browser would for a native fragment link.
  }, [location.key, location.pathname, location.search, hash, destination]);
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
  const collectionHref = (section: string) => {
    const search = new URLSearchParams({ section });
    if (!audience && selectedAudience) search.set("audience", selectedAudience);
    return `${base}?${search}`;
  };
  const badge = bundle.validationPending ? M.validationBadge : M.unverified;
  const resultList = (items: typeof results) => (
    <div className="docs-results">
      {items.map((a) => (
        <section className="docs-result" key={a.id}>
          <div>
            <span className="docs-eyebrow">{sectionTitle(a.section)}</span>
            <h2>
              <Link to={`${base}/${a.id}`}>{a.title}</Link>
            </h2>
            <p>{documentationExcerpt(a, q, 180)}</p>
            {a.unverified && <span className="docs-badge">{intl.formatMessage(badge)}</span>}
          </div>
          <ChevronRight size={20} aria-hidden="true" />
        </section>
      ))}
    </div>
  );
  return (
    <Container
      ref={main}
      id="docs-main"
      tabIndex={-1}
      className={`docs-reader ${article ? "docs-reading" : ""}`}
    >
      <PageTitle title={title} />
      {bundle.preview && (
        <p className="docs-notice" role="status">
          {intl.formatMessage(M.preview)}
        </p>
      )}
      <div className="docs-layout">
        <aside className="docs-sidebar">
          <details
            className="docs-navigation"
            open={navigationOpen}
            onToggle={(event) => setNavigationOpen(event.currentTarget.open)}
          >
            <summary>{intl.formatMessage(M.browse)}</summary>
            <nav aria-label={intl.formatMessage(M.guideNavigation)}>
              <Link
                className="docs-overview"
                to={base}
                aria-current={!id && !selectedSection ? "page" : undefined}
              >
                <BookOpen size={16} aria-hidden="true" />
                {intl.formatMessage(M.overview)}
              </Link>
              <p className="docs-nav-label">{intl.formatMessage(M.browse)}</p>
              <ul>
                {sections.map((section) => (
                  <li key={section.id}>
                    <Link
                      to={collectionHref(section.id)}
                      aria-current={selectedSection?.id === section.id ? "page" : undefined}
                    >
                      {section.title}
                    </Link>
                    {article?.section === section.id && (
                      <ul className="docs-article-links">
                        {available
                          .filter((a) => a.section === section.id)
                          .map((a) => (
                            <li key={a.id}>
                              <Link
                                to={`${base}/${a.id}`}
                                aria-current={a.id === id ? "page" : undefined}
                              >
                                {a.title}
                              </Link>
                            </li>
                          ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          </details>
          <nav className="docs-sidebar-footer" aria-label={intl.formatMessage(M.title)}>
            <Link to={base}>{intl.formatMessage(destination === "formal" ? M.all : M.help)}</Link>
            {destination !== "formal" && (
              <Link to="/documentation">{intl.formatMessage(M.all)}</Link>
            )}
          </nav>
        </aside>
        <div className="docs-content">
          <div className={id || wrongEdition ? "docs-search-bar" : "docs-hero"}>
            {!id && !wrongEdition && (
              <>
                <p className="docs-eyebrow">
                  {intl.formatMessage(destination === "formal" ? M.intro : M.forAudience, {
                    audience: audience ? intl.formatMessage(ROLES[audience]) : "",
                  })}
                </p>
                <h1 tabIndex={-1}>
                  {intl.formatMessage(destination === "formal" ? M.title : M.help)}
                </h1>
                <p className="docs-intro">
                  {intl.formatMessage(destination === "formal" ? M.introBody : M.helpBody)}
                </p>
              </>
            )}
            <Form
              method="get"
              action={base}
              role="search"
              key={`${q}:${selectedAudience}:${topics.join(",")}:${selectedSection?.id}`}
            >
              <div className="docs-search-field">
                <label className="docs-sr-only" htmlFor="docs-query">
                  {intl.formatMessage(M.search)}
                </label>
                <Search size={20} aria-hidden="true" />
                <input
                  id="docs-query"
                  name="q"
                  type="search"
                  defaultValue={q}
                  placeholder={intl.formatMessage(M.search)}
                />
              </div>
              {!audience && (
                <div className="docs-audience-field">
                  <label className="docs-sr-only" htmlFor="docs-audience">
                    {intl.formatMessage(M.audience)}
                  </label>
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
              {selectedSection && <input type="hidden" name="section" value={selectedSection.id} />}
              <button className="docs-search-button" type="submit">
                {intl.formatMessage(M.searchButton)}
              </button>
            </Form>
          </div>
          {wrongEdition || (id && !article) ? (
            <div className="docs-empty">
              <BookOpen size={24} aria-hidden="true" />
              <h1 tabIndex={-1}>{intl.formatMessage(M.unavailable)}</h1>
              <p>{intl.formatMessage(wrongEdition ? M.wrongEdition : M.unavailableBody)}</p>
              <Link to={base}>
                {intl.formatMessage(M.overview)}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          ) : article ? (
            !permitted ? (
              <div className="docs-empty">
                <h1 tabIndex={-1}>{article.title}</h1>
                <p>{intl.formatMessage(M.outsideAudience)}</p>
                <Link to={`/documentation/${article.id}${hash}`}>
                  {intl.formatMessage(M.formal)}
                </Link>
              </div>
            ) : (
              <>
                <nav className="docs-breadcrumb" aria-label={intl.formatMessage(M.breadcrumb)}>
                  <Link to={base}>
                    {intl.formatMessage(destination === "formal" ? M.title : M.help)}
                  </Link>
                  <ChevronRight size={16} aria-hidden="true" />
                  <Link to={collectionHref(article.section)}>{sectionTitle(article.section)}</Link>
                </nav>
                <div className="docs-article-meta">
                  <span>
                    {intl.formatMessage(M.writtenFor, {
                      roles: article.audiences
                        .map((role) => intl.formatMessage(ROLES[role]))
                        .join(" · "),
                    })}
                  </span>
                  {article.unverified && (
                    <span className="docs-badge">{intl.formatMessage(badge)}</span>
                  )}
                </div>
                {missingSection && (
                  <p role="status" className="docs-notice">
                    {intl.formatMessage(M.missingSection)}
                  </p>
                )}
                <div className="docs-columns">
                  <article
                    onClick={followArticleLink}
                    dangerouslySetInnerHTML={{ __html: article.html[destination] }}
                  />
                  {article.outline.some((h) => h.depth > 1) && (
                    <nav className="docs-outline" aria-label={intl.formatMessage(M.outline)}>
                      <details
                        open={outlineOpen}
                        onToggle={(event) => setOutlineOpen(event.currentTarget.open)}
                      >
                        <summary>{intl.formatMessage(M.outline)}</summary>
                        <ul>
                          {article.outline
                            .filter((h) => h.depth > 1)
                            .map((h) => (
                              <li key={h.id} data-depth={h.depth}>
                                <Link
                                  to={`${location.pathname}${location.search}#${h.id}`}
                                  aria-current={hash === `#${h.id}` ? "location" : undefined}
                                >
                                  {h.text}
                                </Link>
                              </li>
                            ))}
                        </ul>
                      </details>
                    </nav>
                  )}
                </div>
                <nav className="docs-adjacent" aria-label={intl.formatMessage(M.articleNavigation)}>
                  {adjacent.map((a, index) =>
                    a ? (
                      <Link key={a.id} to={`${base}/${a.id}`}>
                        <span>{intl.formatMessage(index === 0 ? M.previous : M.next)}</span>
                        <strong>{a.title}</strong>
                        <ArrowRight size={16} aria-hidden="true" />
                      </Link>
                    ) : (
                      <span key={index} />
                    ),
                  )}
                </nav>
              </>
            )
          ) : (
            <>
              <div className="docs-section-heading">
                <div>
                  <h2>{selectedSection?.title ?? intl.formatMessage(M.collections)}</h2>
                  <p>
                    {hasFilters
                      ? intl.formatMessage(M.resultCount, { count: results.length })
                      : intl.formatMessage(M.collectionBody)}
                  </p>
                </div>
                {hasFilters && <Link to={base}>{intl.formatMessage(M.clear)}</Link>}
              </div>
              {results.length === 0 ? (
                <div className="docs-empty" role="status">
                  <BookOpen size={24} aria-hidden="true" />
                  <p>{intl.formatMessage(bundle.articles.length ? M.noMatches : M.empty)}</p>
                </div>
              ) : hasFilters ? (
                resultList(results)
              ) : (
                <div className="docs-collections">
                  {sections.map((section) => {
                    const items = results.filter((a) => a.section === section.id);
                    const description = DESCRIPTIONS[section.id as keyof typeof DESCRIPTIONS];
                    const Icon = SECTION_ICONS[section.id] ?? BookOpen;
                    return (
                      <Link
                        className="docs-collection"
                        key={section.id}
                        to={collectionHref(section.id)}
                      >
                        <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
                        <h3>{section.title}</h3>
                        <p>
                          {description
                            ? intl.formatMessage(description)
                            : items.map((a) => a.title).join(" · ")}
                        </p>
                        <span>
                          {intl.formatMessage(M.count, { count: items.length })}
                          <ArrowRight size={16} aria-hidden="true" />
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
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
  const intl = useIntl();
  const [theme, setTheme] = useState<Theme>(() => {
    const value = document.documentElement.dataset.theme ?? "light";
    return isTheme(value) ? value : "light";
  });
  return (
    <div className="docs-public">
      <a className="docs-skip" href="#docs-main">
        <FormattedMessage id="docs.skip" defaultMessage="Skip to content" />
      </a>
      <header className="docs-header">
        <Link
          className="docs-brand"
          to="/documentation"
          aria-label={intl.formatMessage({
            id: "docs.brand",
            defaultMessage: "OpenLaw documentation",
          })}
        >
          <span className="docs-brand-mark" aria-hidden="true">
            <Scale size={24} />
          </span>
          <strong>
            <FormattedMessage id="shell.brand" defaultMessage="openlaw" />
          </strong>
          <span className="docs-brand-divider" aria-hidden="true">
            /
          </span>
          <span>{intl.formatMessage(M.title)}</span>
        </Link>
        <div className="docs-header-actions">
          <label className="docs-sr-only" htmlFor="docs-theme">
            {intl.formatMessage(M.theme)}
          </label>
          <select
            id="docs-theme"
            value={theme}
            onChange={(event) => {
              if (isTheme(event.target.value)) {
                setTheme(event.target.value);
                setDocumentTheme(event.target.value);
              }
            }}
          >
            {THEMES.map((value) => (
              <option key={value} value={value}>
                {intl.formatMessage(M[value])}
              </option>
            ))}
          </select>
          <Link className="docs-open-app" to="/">
            {intl.formatMessage(M.openApp)}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </header>
      <DocumentationReader />
    </div>
  );
}
