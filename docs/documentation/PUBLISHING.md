# Publishing and Help design

Task: [#724](https://github.com/juggernog20/OpenLaw/issues/724).
Decisions: DD-020, DES-073, and TECH-026 in the existing decision records.
Status: implementation specification for DOC-006/007, not a deployed service.

## Delivery choice

Keep the canonical articles in this repository as Markdown. Compile them during
the app build and use that output for the full documentation and both Help
surfaces. Also produce a standalone HTML edition that can be opened without the
app, a database, an account, or an internet connection.

Serve the formal documentation at `/documentation` on the operator's existing
OpenLaw origin. Use the existing domain without a hosted documentation subscription.
Make the standalone edition available for copying to an operator's static server
or opening from a downloaded archive. Reuse that edition for any future public
mirror; leave public-domain selection and deployment to a separate release action.

| Requirement                               | Implementation choice                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| One authoritative procedure               | One Markdown source per article ID; shared compilation for every destination                 |
| Help on an isolated network               | Ship prose, images, styling, and search data with the app                                    |
| Recovery while the app is down            | Standalone HTML directory and downloadable archive, retained outside the instance            |
| Documentation for the installed app       | Bundle the edition in the same image and display its supported app/build identity            |
| Familiar maintenance                      | Node build tooling, the existing Vite/React app, and GitHub review                           |
| Full navigation and discovery             | Section index, audience starting paths, local text search, and article links                 |
| Public instructions without record access | Public formal reader; authenticated Help shells; no data APIs in the content/search compiler |

Do not promise offline app operations. The Help bundle needs a reachable instance
unless its assets are already available; only the standalone edition is guaranteed
to work with the instance stopped. No service worker or persistent offline app
cache is added by this feature.

## Sources and compiler

Use these locations:

| Path                                    | Purpose                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| `docs/user-guides/<article-id>.md`      | Canonical reader content                                        |
| `docs/user-guides/assets/`              | Fictional-data screenshots and other local reader assets        |
| `docs/documentation/articles.json`      | Existing discovery and coverage catalog                         |
| `docs/documentation/help-contexts.json` | App route/topic bindings                                        |
| `docs/documentation/evidence/`          | Per-article verification records; never reader content          |
| `docs/documentation/edition.json`       | Edition channel and supported-build declaration                 |
| `docs/documentation/redirects.json`     | Deliberate aliases for retired article IDs or anchors           |
| `scripts/documentation/`                | Compiler, validators, search preparation, and standalone export |

The last four implementation locations are created by DOC-006 or the content
tasks. Their absence in this design task is intentional. Planning files, templates,
source references, reviewer identities, and evidence logs do not enter the public
bundle. Publish only the reader metadata needed to identify the edition and choose
an article.

Use **Marked** to parse ordinary Markdown with GFM tables and **sanitize-html** to
sanitize the compiled HTML at build time. Pin the actual dependencies through the
workspace lockfile when implementing DOC-006, and run the repository's dependency
checks. Marked documents that its output is not sanitized; this design therefore
requires both content validation and HTML sanitization. [Marked documentation](https://marked.js.org/)
and [sanitize-html documentation](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html)
describe the respective compiler and allowlist controls.

Reject authored raw HTML, scripts, MDX, embedded frames, executable URL schemes,
remote images, and paths outside the reader-source tree. Use a small explicit HTML
tag/attribute allowlist for headings, paragraphs, lists, quotes, tables, code,
links, and images. Forbid form controls, event handlers, inline styles, SVG, and
MathML. Escape code examples as text. Sanitize after transforming links and
headings so later output changes cannot reintroduce unsafe markup.

Generate stable heading anchors, a page outline, and plain search text from the
same parsed content. Validate duplicate IDs, malformed metadata, missing assets,
internal links, and anchor targets. An article's single H1 must match its catalog
title; subsequent headings form a valid outline. Cross-article source links use
`article-id.md#anchor`; the compiler resolves them for the destination. External
links use explicit HTTPS/HTTP addresses, with mail links allowed only when useful.

The app consumes generated sanitized content and search data. The standalone
export uses the same compiler and articles, with relative `.html` links and local
assets. Do not extend the Knowledge renderer for this: its shifted heading levels,
limited Markdown grammar, and always-new-tab links serve a different product
surface. Do not ship a second browser Markdown parser.

Use a small Vite integration to generate the content during dev/build, watch its
sources in development, and include generated assets in the app output. Vite's
[plugin API](https://vite.dev/guide/api-plugin.html) provides the integration
points; DOC-006 tests the actual build behavior. Add canonical content, metadata,
and compiler inputs to Turbo's dependency graph. Update `.dockerignore`, which
currently excludes all `docs`, to admit only the required documentation inputs.
Docker builds exclude `.git`, so release build identity must be supplied explicitly
and retained in the output rather than guessed from a missing checkout.

## URLs, access, and failure behavior

| Surface              | Index            | Article                       | Access                                              |
| -------------------- | ---------------- | ----------------------------- | --------------------------------------------------- |
| Formal documentation | `/documentation` | `/documentation/<article-id>` | Public, without app session/setup/API prerequisites |
| Staff Help           | `/help`          | `/help/<article-id>`          | Existing staff-session rules; includes Contributors |
| Business Portal Help | `/portal/help`   | `/portal/help/<article-id>`   | Existing portal-session rules                       |
| Standalone edition   | `index.html`     | `<article-id>.html`           | Static files, no app account                        |

Public means that anyone who can reach the instance can read the formal manual.
It contains generic product instructions and fictional examples, including operator
and Administrator instructions. It contains no organization records or private
configuration. Reading instructions grants no app permissions. Keep all existing
record, role, and setup guards on app actions.

A signed-out Help deep link redirects to the corresponding public formal article,
preserving the ID and fragment. Sign-in and first-run screens link directly to
formal account/setup guidance. Help must remain reachable when sign-in is the
problem. The public reader must not fetch a session or organization configuration
to render its content.

Show articles eligible for the current Help destination and audience. The formal
reader always offers the full table of contents, with optional audience filtering.
An out-of-audience Help link points to the public formal article with its stated
prerequisites; it does not masquerade as an authorization error. An unknown or
unavailable article shows a clear unavailable state with search and index links.
Unknown topic keys fall back to the appropriate Help index.

Keep article IDs stable when titles change. Maintain explicit, validated aliases
when an ID or published anchor must change; reject loops, duplicate aliases, and
aliases whose targets do not exist. Never silently redirect an unavailable article
to a different procedure. The app needs a documentation-specific missing-page
state because its server currently sends the SPA shell for non-API paths.

No external documentation service is in the reading path. A failed external
reference or support site leaves the local article usable. An unavailable instance
requires the operator's retained standalone edition; an app-hosted download cannot
rescue an instance that is already down. Explain that retention in the operations
guides. Static hosts may choose their own directory prefix; export links must work
under that prefix and under `file://` without an API or search-data fetch.

## Editions and publication states

An edition identifies its channel (`development` or `release`), supported app
version/build, content digest, and publication target. Display these facts in the
formal reader and Help's edition details. The package version alone is insufficient:
the current development app still declares `0.0.1` across many commits.

Record the tested app commit separately from the article's content hash and the
distribution commit. Documentation-only commits can change the distribution commit
without changing app behavior. Require a recorded compatibility review of that
range before publication; app behavior changes require affected walkthroughs again.
DOC-005 establishes the reproducible verification build and DOC-025 verifies final
coverage. Do not relabel old evidence as having run against a newer build.

The normal reader includes only `verified` and `published` articles whose evidence
matches their bytes. An explicit development preview may include `draft` and
`review` articles and must identify them as unverified. A source-less `scoped` or
`ready` catalog entry never becomes a placeholder article. An empty early build
shows an honest availability state, not fabricated content.

The builder supports ordinary incremental checks and a separate complete-suite
publication check. Incremental builds can succeed while writing is in progress;
the complete-suite check requires all P0/P1 coverage, valid evidence, and working
destinations. A link to an unpublished target is a publication error, even if that
target exists in the planning catalog. Preview can expose the missing dependency
while the related article is being written.

Release editions use immutable identifiers and artifacts; development editions
are visibly development editions. An installed older app continues to read its
bundled edition and never defaults to a mutable external "latest" manual. Retain
standalone editions with release artifacts. Builds predating Help require their
corresponding source documentation or retained exports; this feature does not
invent historical coverage.

This project delivers into `feat/documentation`, so DOC-027 publishes and validates
the complete suite in the feature's review environment and export artifact. Record
that publication target explicitly. Publishing a production release or merging the
feature into `dev`/`main` remains a separate release action. Do not describe a feature
preview as the production documentation site.

## Help presentation and topic bindings

Add a persistent Help entry in the staff header and portal header. On narrow
screens it may use an icon with an accessible Help label; it must remain reachable
without adding a work module to the portal. The staff Help index lives in the
existing AppShell. Portal Help uses PortalShell. Formal documentation uses its own
lightweight public frame and requires no signed-in shell.

Each index has a clear title, a labeled documentation search field, role starting
paths, section navigation, and a link to the full documentation. Each article has
its title, prerequisites in the canonical prose, an outline when useful, related
guides, an edition link, and a route back to its index. Use the existing typography,
spacing, colors, and focus tokens. Reader content is en-US; app chrome uses the
existing message catalog.

[help-contexts.json](help-contexts.json) binds the catalog's topic keys to current
routes. Bindings describe available recommendations; they do not require a Help
button beside every Field. General Help uses the current route to suggest relevant
articles and falls back to the index. The intake pilot additionally places visible
contextual links on the portal home, submission form, and Request pages and the
staff Inbox and Request detail. In DOC-007 these links may lead to a topic result
until their DOC-008 articles are verified; never link to a source-less article as
if it exists.

Use `?topic=<context-key>` for a topic result and `?q=<words>` for documentation
search. Carry only registered topic keys into Help, never record IDs or the raw
originating URL. In the binding registry, `staff` and `portal` name Help surfaces,
`both` includes both, and `formal` names public entry guidance. `*` is the shared
fallback. Combine matching route bindings, rank specific route topics before shared
fallbacks, and then apply article destination/audience eligibility. Optional `:tab?`
segments follow the current router's matching behavior.

Preserve `?` for the existing keyboard-shortcuts sheet, `/` for existing app search,
and Escape for the current overlay behavior. Documentation search has its own
label and normal keyboard focus. It does not take over the global shortcut. Use
normal links and buttons, preserve Back/Forward and modified-click behavior, and
give navigation an appropriate page title and focus target. At small widths, stack
navigation above the article; wide code and tables scroll within their own region.
Verify keyboard use, 200% zoom, narrow layouts, and Light/Dark/Warm themes.

## Search and support

Build a local index from eligible article titles, headings, body text, and catalog
metadata. Match case-insensitively, require all entered words, rank title/heading
matches ahead of body matches, and show the title, section, and a useful excerpt.
Use the same ranking in Help and formal documentation, with destination/audience
filters applied before displaying results. Empty search shows the index; no match
offers the full index and relevant troubleshooting/support guidance. Keep the query
in the page URL for Back/Forward and sharing.

The index never includes records, comments, Knowledge Items, account details,
evidence, or raw request paths/identifiers. Search runs locally and sends no query
to the API, an external search service, or analytics. The standalone edition embeds
its search data in local scripts so `file://` reading needs no fetch. Reading and
the full index still work when JavaScript is unavailable.

Support instructions first direct organization-specific access/configuration
questions to the reader's Administrator. Product defects and documentation
corrections can link to the existing public
[GitHub issue tracker](https://github.com/juggernog20/OpenLaw/issues).
Do not invent a support email address, configure a customer helpdesk, or submit
reports automatically. Explain that the public tracker must not receive private
records or credentials; give an edition identifier and reproducible fictional
steps as useful report details. DOC-024 writes this reader guidance.

## Ownership and validation

The web/platform engineer owns the compiler, Help, and export. The documentation
lead owns the catalog and content review. The release maintainer owns immutable
edition artifacts and their inclusion in the app image. Current named allocations
remain in [AUDIT.md](AUDIT.md); they do not imply that product-owner acceptance or a
human walkthrough has already occurred.

DOC-006 proves compilation, safe rendering, evidence filtering, stable links,
search, input invalidation, and standalone export. DOC-007 proves Help discovery,
audience handling, signed-out access, keyboard/mobile behavior, and theme support.
DOC-008 tests real intake discovery with canonical articles. DOC-025/027 prove the
complete suite against its recorded build and publication target, including an
internet-blocked reader and a standalone reader while the app is stopped.

## Alternatives considered

| Option                                         | Decision                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| External hosted docs and search                | Adds a service and internet dependency without meeting local recovery by itself                                 |
| Separate documentation framework/site          | Adds another runtime/build/theming path; retain it as a future option if publishing needs outgrow this compiler |
| Knowledge Items as product Help                | Organization-authored content and its access/publishing rules differ from versioned product instructions        |
| Extend the current Knowledge Markdown renderer | Its grammar and heading/link behavior do not meet the formal reader's needs                                     |
| Raw Markdown only                              | Useful source format, but insufficient for in-app discovery, accessible reading, and self-contained recovery    |

The selected compiler adds build dependencies and an export to maintain. It avoids
a second content store and keeps documentation available within each deployment.
