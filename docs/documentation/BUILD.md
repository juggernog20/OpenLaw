# Build and validate the documentation

Task: [#726](https://github.com/juggernog20/OpenLaw/issues/726).
Use this maintainer guide to build and validate the
[publishing design](PUBLISHING.md). Publishing fixtures do not verify user articles.

## Inputs and outputs

Write canonical Markdown in `docs/user-guides/<article-id>.md`. The catalog in
[articles.json](articles.json) supplies its exact H1 title, audience, destinations,
section, and state. Local screenshots belong under `docs/user-guides/assets/` with
PNG, JPEG, WebP, or GIF filenames containing letters, numbers, hyphens, or underscores.
Use descriptive alt text. Raw HTML, MDX, task-list controls, remote images, executable
links, source-tree escapes, and symlinks are refused. Code fences need a language.

Headings start with the matching H1, never skip a level, and produce lowercase ASCII
hyphenated anchors. Repeated headings that would create the same anchor are refused.
Cross-article links use `article-id.md#heading-anchor`; same-page links use `#anchor`.
External references use explicit HTTP/HTTPS URLs or useful mail links. Relative links
never point into internal planning or evidence files. The reader reserves `docs-main`,
`edition`, and its search-control IDs; do not use those as authored heading anchors.

The Node compiler uses the pinned Marked and sanitize-html dependencies. It validates
and rewrites links/headings before applying its HTML allowlist. The app receives
sanitized HTML and plain search text. Both Help variants and the standalone edition
come from those same article bytes. Planning prose, reviewer identities, and evidence
locations are absent from the reader bundle.

Open `/documentation` for the public reader or `/documentation/<id>` for an article.
Read it without a session, completed setup, or API request. Open `/help` or
`/portal/help` for authenticated Help. Header links use a small
compiled topic registry; article bodies load when a reader opens Help. An explicit
`?edition=<id>` mismatch reports that the requested edition is not bundled rather
than switching to a mutable latest edition.

`/documentation-export/index.html` serves the standalone version, with the archive
at `/documentation-export/openlaw-documentation.tar.gz`. Extract and retain the archive
outside the instance before relying on it for recovery. Its relative links and local
scripts work under a static-host prefix and `file://`. Search needs JavaScript; the
complete available index and article prose do not. This does not make app operations
available offline. Missing export files return an actual 404; stable documentation
asset names revalidate after an upgrade.

## Development and preview

Use the workspace Node/pnpm versions and GNU tar (also present in the Docker build
image). These commands run from the repository root:

```sh
pnpm docs:check
pnpm docs:export
pnpm docs:fixture
```

`docs:check` performs incremental validation without writing output. `docs:export`
writes the normal standalone files and archive to ignored `.documentation-output/`.
`docs:fixture` writes an explicitly unverified example edition from
[scripts/documentation/fixtures](../../scripts/documentation/fixtures). The fixture
is publishing test material, not an OpenLaw procedure. It never joins the real catalog.

Normal builds include only `verified` or `published` articles with valid evidence.
An empty early edition says that no verified articles are available. `scoped` and
`ready` entries never produce placeholders. A draft/review preview is opt-in:

```sh
OPENLAW_DOCS_PREVIEW=true pnpm --filter @openlaw/web dev
OPENLAW_DOCS_PREVIEW=true OPENLAW_DOCS_FIXTURE=true pnpm --filter @openlaw/web dev
```

The second command uses the fixture catalog for pilot review of the reader. Every
preview carries a development notice; fixture mode requires preview mode. A release
channel cannot use preview. To use a separate loopback port, append
`--host 127.0.0.1 --port 43310 --strictPort` to the Vite command.

The Vite plugin watches canonical files and metadata. A valid edit refreshes the
reader and export. An invalid edit reports a build error; it does not quietly serve
an older export as current. Preview reports links to unpublished articles as visible
build notices. Normal publication refuses those links. All anchor targets, asset
paths, catalog IDs, scenario mappings, and redirect targets must resolve.

## Build identity and verification

[edition.json](edition.json) declares a stable edition ID, development/release
channel, supported app version and tested commit, publication target, and compatibility
review. The initial development edition has no supported tested commit because no
article is verified. Package version `0.0.1` is not treated as a unique build identity.

The compiler records the distribution commit separately. In a checkout it reads Git
and reports working changes. Docker excludes `.git`; supply `OPENLAW_BUILD_COMMIT` as
a build argument together with an explicit `OPENLAW_BUILD_DIRTY=false` for a clean
checkout or `OPENLAW_BUILD_DIRTY=true` for modified source. Missing or invalid dirty
flags are refused when a commit is injected. CI,
the documentation lab helper, and the local E2E launcher pass the relevant identity.
A source build through Compose accepts the same variables as build arguments. A
normal development build with no verified content may identify its commit as not
recorded; verified content and release builds cannot.

For verified articles, record the actual tested app commit in each evidence record.
Use [the evidence template](templates/verification.json); `status` is `pass` only
after its required scenarios pass. Content hashes are SHA-256 of the exact Markdown
bytes, not rendered output. Every mapped scenario needs its required method for each
listed role, with observed results and evidence locations. Automated feature tests
cannot replace required browser, operator, or live-provider walkthroughs. The
walkthrough reviewer must differ from the author.

A compatibility review in the edition contains:

```json
{
  "testedAppCommit": "the actual full tested commit",
  "applicationSha256": "the application source digest",
  "reviewer": "the reviewer identity",
  "reviewedAt": "an actual ISO timestamp",
  "summary": "the scope and result of the compatibility review"
}
```

Read the current digest with:

```sh
node --input-type=module -e 'import {applicationDigest} from "./scripts/documentation/build.mjs"; console.log(applicationDigest())'
```

The digest covers app/package/style sources and workspace dependency/configuration
inputs, excluding generated builds, dependencies, and environment files. The same
bytes are present in a checkout and a Docker context. A documentation-only commit
can retain the tested app identity when this reviewed digest still matches. A changed
application digest blocks verified publication until compatibility and affected
walkthrough evidence are reviewed; never copy a newer commit into old walkthroughs.
Working documentation edits can still render existing verified content when the
reviewed application bytes match. Release and complete-suite builds require a clean
distribution. Copy-only evidence retention must follow the editorial review rules;
the compiler does not infer semantic equivalence from similar text.

Turbo tracks documentation/compiler inputs and build flags. The web build is not
cached, because an otherwise identical documentation-only Git commit changes the
embedded distribution identity. API and worker build caches retain their existing
behavior. Docker admits only the reader catalog, edition, redirects, scenarios, and
evidence from internal documentation, plus canonical sources; broad planning files
remain outside its context.

## Complete-suite gate and stable links

```sh
pnpm docs:complete
```

This is separate from ordinary builds. It requires every catalog article and all
P0/P1 coverage to be verified, including both C17 articles. It also requires
`docs/documentation/evidence/publication.json` with matching `editionId`,
`contentDigest`, tested `appCommit`, `status: "pass"`, reviewer and review timestamp,
and passed `scenarios` for the shared Help/offline registry entries with each required
role/method and actual evidence. DOC-025/027 supply those results after real validation.
A missing provider account or failed restore is not an exception hidden by the build.

The current target is the feature review environment and retained export. This task
does not publish a production release or merge the feature branch into dev/main.

[redirects.json](redirects.json) contains an array of `{ "from": "old-id#old-anchor",
"to": "new-id#new-anchor" }` entries. The anchor is optional on either side. Alias
chains must terminate at an included article and existing anchor, with no cycles,
duplicate sources, or collisions with live IDs. Article aliases retain an incoming
fragment unless their target explicitly selects one. The standalone reader includes
scripted alias handling and explicit links when JavaScript is disabled.

## Checks

Run `pnpm test:ci-tools` for the compiler tests. Web route tests cover both Help shells, signed-out and failed-session recovery,
role discovery, preserved shortcuts, public reading,
search/Back, missing states, aliases, and safe rendering. API serving tests cover
public static files, stable-asset caching, and missing-export responses. The built
Compose E2E suite checks the actual reader and downloadable archive without cookies
or API reads. Fixture browser checks also cover themes, reflow, local search, source
watching, and file reading with JavaScript disabled. The [fixture readiness record](publishing-readiness.json) records the local browser
observations and their limits. These are publishing checks; they do not verify any
planned user article.
