# OpenLaw — Tech Stack & Deployment Decision Record

Decisions about runtime, framework, database, file storage, deployment shape, and the developer experience for self-hosters and contributors. Platform product decisions live in `DECISIONS.md`; this file is the implementation counterpart.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `TECH-###`.

## Constraints inherited from `DECISIONS.md`

- **DD-001 / DD-009** — must be portable and single-tenant; no infrastructure that ties the project to a specific vendor.
- **PRODUCT.md success criterion** — a 5-person legal team should be able to self-host from a clean Linux VM in under an hour. The stack must be reachable for a non-specialist sysadmin.
- **DD-011** — AGPL v3; all dependencies must be license-compatible.

## Open questions queued for the next grill-me session

_None — queue cleared 2026-08-06 (TECH-001 through TECH-014). Every routed engine/integration question from the module grills is resolved. Emergent questions during the build queue here._

---

## TECH-001: Frontend stack — React + Tailwind CSS + shadcn/ui (copied) + Radix primitives

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

`DECISIONS-DESIGN.md` **DES-001** commits to three user-selectable themes via a CSS-variable substrate. **DES-003** anchors the design language on GitHub Primer geometry. **DES-004** records the component-substrate decision from a design angle: shadcn/ui + Tailwind + CSS variables + Radix primitives.

This decision records the same stack from a tech-stack angle — what dependencies, what license posture, what implications for portability and the self-host story.

### Decision

The frontend is built on:

- **React** as the UI framework. Locked as a downstream consequence of selecting shadcn/ui (which is React-only). The specific React meta-framework (Next.js / Remix / Vite + React Router / TanStack Start / plain Vite) is **deferred** until the backend choice is made — if the backend is Node/TypeScript, a server-rendered React framework (Next.js / Remix) is on the table; if the backend is non-JS, the frontend is most naturally a Vite-built SPA served statically from the backend.
- **Tailwind CSS** as the styling system — utility classes, build-time output, no runtime CSS-in-JS.
- **shadcn/ui** as the component library — copied into `components/ui/` as owned source code, not consumed as a dependency. Updated by re-copying or by manual diff application against upstream.
- **Radix UI primitives** as the headless interaction layer for any component requiring focus management, keyboard navigation, or screen-reader correctness. Consumed as a normal versioned npm dependency.

Initial geometry overrides applied to shadcn defaults (border radius 8px → 6px; focus ring tightened) are documented in DES-004.

### Rationale

1. **License posture clean for AGPL v3 (DD-011).** Tailwind is MIT, Radix is MIT, shadcn/ui is MIT — all compatible with AGPL v3 distribution. shadcn enters the project as source code under the project's license, not as an attribution-bearing dependency.
2. **Portability per DD-001 / DD-009.** Tailwind compiles to plain CSS; no runtime, no styled-system magic, no node_modules needed at runtime. A self-host contributor can read a component and understand its visuals without learning a CSS-in-JS framework. The build output is a single static bundle.
3. **Adoption ceiling.** React is the ecosystem floor for OSS contributors in 2026 — the largest contributor pool, the broadest hiring pool, the deepest documentation surface. Any v1 contribution from an external developer is most likely to arrive as a React PR.
4. **Accessibility floor for free.** Radix primitives ship correct focus management, keyboard navigation, and ARIA semantics. For a tool dealing with sensitive matters and a non-engineer reference persona, building these from scratch would consume months and still ship worse.
5. **shadcn-as-owned-source matches the project posture.** OpenLaw is a self-hosted tool whose authors should be able to read and modify every visual the user sees. A heavy component library (Mantine, Material-UI, Chakra) hides its visuals behind layers of theming abstraction; shadcn does not.

### Alternatives considered

- **Vue / Svelte / SolidJS.** Rejected; smaller OSS contributor pool than React, and shadcn-equivalent ecosystems exist but are less mature. Smaller adoption surface for a tool whose growth depends on community contribution.
- **HTMX + server-rendered HTML.** Rejected; server-rendered + sprinkles is a viable approach for a self-host CRUD tool, but the design language from DES-003 (right-rail dashboards, intake triage with optimistic updates, comment composer with tier selector) is heavy enough on rich interactive surfaces that the SPA story is materially better.
- **Mantine / Material-UI / Chakra.** Rejected per DES-004 — CSS-in-JS conflicts with Tailwind and the libraries' default shapes fight Primer geometry.
- **Bare Radix + Tailwind, no shadcn.** Rejected per DES-004 — re-implements what shadcn already wrote without payoff.

### Consequences

- React is locked. Vue / Svelte / Solid are off the table without superseding this decision and rewriting `components/ui/`.
- The React meta-framework choice (Next.js / Remix / Vite / TanStack Start) is deferred and added to the open-questions list above. It blocks on the backend decision.
- Repository layout adds `components/ui/` (shadcn copies, owned source), `components/` (project components), `styles/themes/` (per-theme CSS-variable files).
- Frontend build pipeline assumes Node.js for build-time tooling (Tailwind compile, TypeScript compile, bundler). Self-hosters do not need Node at _runtime_ — only during build, or they consume a pre-built bundle from a release artifact.
- Frontend testing stack is deferred but should default to: Vitest for unit tests, React Testing Library for component tests, Playwright for E2E. To be confirmed in a future TECH decision.
- Updating shadcn means consciously re-copying or merging upstream changes, not running `npm update`. This is the trade-off of owning the source.
- The CSS theming system from DES-001 — `:root[data-theme="<name>"]` blocks defining CSS variables — is the only theming surface. Component code reads `bg-canvas` / `text-primary` Tailwind utilities; theme switch is a single attribute change on `<html>`.

---

## TECH-002: Backend — TypeScript on Node LTS

- **Status:** Accepted
- **Date:** 2026-08-06

### Context

The keystone pick; everything downstream (framework, ORM, jobs, contributor experience) cascades from it.

### Decision

The backend is **TypeScript on Node LTS**. One language end-to-end with the locked React frontend; shared types between API and UI. Bun noted as a possible later runtime optimization, not a v1 bet.

### Rationale

TECH-001's adoption-ceiling argument applies squarely: the largest OSS contributor pool, first-party SDKs for every routed integration (DocuSign, Anthropic, S3), mature Postgres tooling. The document pipeline runs as external processes under any language, so Go's single-binary advantage evaporates in practice.

### Alternatives considered

Go (best deploy story, but sidecars force Docker anyway; contributor context-split); Rails/Django (batteries included, but two ecosystems against a React SPA).

### Consequences

Monorepo is single-language. Node LTS version pinned per release. All engine integrations (Round 3) are child processes or sidecar services, not in-process libraries.

## TECH-003: Application shape — Fastify API + Vite React SPA (REST/OpenAPI)

- **Status:** Accepted
- **Date:** 2026-08-06

### Context

Full-stack framework vs API+SPA; also closes TECH-001's deferred React meta-framework question.

### Decision

A **Fastify** API server exposing **REST with an OpenAPI schema** (typed client generated for the SPA), serving the statically-built **Vite + React Router** SPA. The portal (INT-001) is part of the same SPA (separate route tree, magic-link session). No SSR.

### Rationale

One long-running process plus worker is the simplest thing a self-hoster can reason about; the API doubles as the third-party integration surface; self-hosted Next/App-Router churn is a maintenance surface an OSS project shouldn't carry for one SSR-worthy page.

### Alternatives considered

Next.js full-stack; Remix/TanStack Start (same SSR/self-host complexity, smaller pools).

### Consequences

TECH-001's meta-framework question closed: **Vite + React Router**. OpenAPI schema is a first-class artifact (client generation, docs). SEO-irrelevant app (auth-walled) so no-SSR costs nothing.

## TECH-004: Database — PostgreSQL only

- **Status:** Accepted
- **Date:** 2026-08-06

### Decision

**PostgreSQL 16+** is the only supported database. No SQLite tier. SCHEMA.md's Postgres-flavored assumptions (jsonb, timestamptz, FTS per DOC-009, Postgres-based job queue) become commitments. UUID v7 primary keys confirmed.

### Rationale

One migration path, one backup story (`pg_dump`), one FTS implementation; dual-dialect support taxes every jsonb/FTS/queue feature for a persona that can run the Compose file either way.

### Alternatives considered

Postgres + SQLite eval tier: doubles the test matrix, forbids or shims the features the schema leans on.

### Consequences

The Compose file ships a Postgres container (external/managed Postgres equally supported via `DATABASE_URL`).

## TECH-005: Deployment — Docker Compose as the blessed path

- **Status:** Accepted
- **Date:** 2026-08-06

### Decision

One documented **`docker compose up`** path: `app` (API+SPA), `worker` (background jobs), `postgres`, and the document-engine sidecar(s) (TECH Round 3). Versioned images on ghcr per release (semver); `.env` config; migrations run on start; first boot lands in the SET-004 onboarding wizard. Helm chart and bare-metal guides are community/future; no managed cloud in v1.

### Rationale

The under-an-hour promise (PRODUCT.md) for a non-specialist sysadmin is a Compose file, not a binary plus a system-deps install guide.

### Alternatives considered

Single binary (Postgres/LibreOffice/Tesseract can't be absorbed into it); managed-cloud alongside v1 (a business, not a feature).

### Consequences

Release artifact = images + compose.yml + .env.example. Upgrade story = pull new tag, `compose up` re-runs migrations.

## TECH-006: ORM — Drizzle (+ drizzle-kit migrations)

- **Status:** Accepted
- **Date:** 2026-08-06

### Decision

**Drizzle ORM**: schema-as-TypeScript mirroring SCHEMA.md ~1:1, SQL-shaped queries, first-class Postgres surfaces (jsonb, FTS, `parties_view`), `sql`-tag escape hatch as a normal tool. **Migrations via drizzle-kit** — generated SQL files, reviewable in PRs, run on container start per TECH-005. (This also answers the queued migration-story question.)

### Alternatives considered

Prisma (codegen layer; Postgres-specific surfaces fight the abstraction); Kysely/raw SQL (hand-rolled conventions, higher onboarding cost).

## TECH-007: Background jobs — pg-boss on Postgres

- **Status:** Accepted
- **Date:** 2026-08-06

### Decision

**pg-boss**: queue, retries, and cron-style scheduling on Postgres — no Redis. Carries the committed workload: OCR (DOC-005), conversion/compare (DOC-003/004), AI analysis (CTR-008), search indexing (DOC-009), notification digest + reminder offsets (NOT-003/004), obligation reminders (ENT-006). The `worker` container is the same image with a worker entrypoint.

### Alternatives considered

BullMQ+Redis (an extra service for load a 10-person team never generates); in-process timers (lost jobs on restart; conversion blocking the API).

## TECH-008: Authentication — onboarding-selectable: built-in basic or bring-your-own IdP (OIDC)

- **Status:** Accepted
- **Date:** 2026-08-06

### Context

Recommended built-in sessions+passwords+magic-links. Blair widened it for the legal-function audience: "as part of the onboarding flow we can provide auth options like basic (auth.js) or their own (workos, okta, etc)."

### Decision

- **Auth mode is chosen in the SET-004 onboarding wizard** (new wizard step; switchable later in Settings → Organization):
  1. **Built-in (basic)** — email + password (Argon2id) for staff, optional TOTP 2FA.
  2. **Bring-your-own IdP** — generic **OIDC** configuration (issuer, client ID/secret): works with Okta, Entra, Google Workspace, Keycloak, Authentik. Staff sign in via SSO; business users may also use SSO when the IdP covers them.
- **Magic-link portal access remains the floor in both modes** (DD-010/INT-001) — requesters never need IdP membership; host can disable it if SSO-only is policy.
- **Sessions are ours in both modes**: server-side session table, httpOnly cookies, revocable — the IdP only authenticates; it never becomes the session model.
- SAML and aggregators (WorkOS) are future adapters behind the same auth-mode interface. Working implementation default: **better-auth** (framework-agnostic, email/password + OIDC + magic-link + TOTP) — an implementation detail behind our session model, swappable.

### Rationale

Legal departments at Series A–C companies increasingly sit behind Okta/Entra; SSO-at-setup removes a real adoption blocker. Generic OIDC (not per-vendor connectors) keeps the OSS surface small.

### Consequences

SET-004 wizard gains an auth step (annotated there). `users` gains credential/OIDC-subject columns per mode. Settings → Organization → Authentication surface added to the inventory.

### Addendum (2026-08-09) — implementation shipped; ecosystem and pattern record

Recorded at feature close (auth spec, issues #4–#10). The decision stands as written; this captures what the implementation research settled.

- **Ecosystem shift.** The Context above name-drops Auth.js as the "basic" option; that landscape moved. Auth.js joined the better-auth org in September 2025 and its own guidance now directs new projects to better-auth; better-auth itself joined Vercel but remains MIT. Governance risk is mitigated by the license and by our guard-interface wrapping — the "implementation detail, swappable" stance stands unchanged.
- **Settled integration pattern** (from official docs, production OSS, and context7 research): better-auth's handler is mounted **natively on a catch-all auth prefix** (Fetch-Request rebuild inside a scoped Fastify plugin that bypasses content-type parsing for that prefix) and owns every browser-facing auth flow; a composable **guard chain** (`requireAuth` + role variants) resolves the session via `auth.api.getSession` and attaches `{ user, session }` to each request; **our own zod-typed routes exist only where OpenLaw's authorization model diverges** (first-run setup, invites, SSO provider registration, magic-link issuance, auth-mode switching, method discovery); the OpenAPI contract and better-auth's routes remain **parallel surfaces** — no spec merging, and auth flows are consumed by better-auth's React client, not the generated api-client.
- **Schema channel.** Table/column naming is achieved through Drizzle property keys plus better-auth's model/field mapping. better-auth's CLI and auto-migration are never used; drizzle-kit generated SQL migrations are the only schema channel (TECH-006/TECH-014).
- **SSO client secret at rest.** The sso plugin stores the OIDC client secret inside the provider row's config JSON. v1 accepts DB-at-rest storage (single-tenant, self-hosted, the DB already holds privileged material); **flagged for a future secrets-encryption pass** — deliberate, not accidental.
- **Version pin.** better-auth pinned to **1.6.x** (≥ 1.6.22 for the two-factor lockout columns; currently 1.6.26). 1.7 renames/changes some plugin options (two-factor enable signature, SSO option names) — treat its upgrade guide as a known, small chore, not a drop-in bump.

### Addendum (2026-08-10) — settings home and cross-user session revocation (M5 grill)

- The "switchable later in Settings → Organization" phrase above now has a concrete home: **Settings → Organization → Security → Authentication** (SET-001 amendment). The pane holds auth mode, OIDC provider config, the DD-010 allowed-email-domains list, and the magic-link portal toggle — the same surfaces the M2 typed routes already serve.
- **Cross-user session revocation** (an Administrator cutting another user off, SET-005) is **our own typed Admin route**, consistent with the settled pattern above — typed routes exist where OpenLaw's authorization model diverges. better-auth's `/api/auth/admin/*` endpoints remain closed; the zero-permission roles map stays as it is.

## TECH-009: Real-time — SSE on live surfaces

- **Status:** Accepted
- **Date:** 2026-08-06

### Decision

Server-Sent Events (`/api/events`) push to the live surfaces: notification bell (NOT-005), open comment threads (CMT-004), Inbox counts (INT-006). All writes remain normal requests; everything else refetches on navigation. No WebSockets in v1 (no duplex feature exists).

### Alternatives considered

Polling (dead-feeling chat/bell); WebSockets (infra without a consumer).

## TECH-010: Document engines — one LibreOffice + OCR sidecar

- **Status:** Accepted
- **Date:** 2026-08-06

### Decision

A single **doc-engine sidecar container** in the Compose file: headless **LibreOffice** for DOCX/PPTX → PDF display conversion (tracked changes and comments rendered per DOC-004) and for **compare** (emits the track-changes .docx per DOC-003; the in-app Workshare-style view renders the compared output); **OCRmyPDF/Tesseract** for image-only PDFs (DOC-005). MSG/EML parsing is an in-process Node library. All jobs run through pg-boss (TECH-007).

### Rationale

All AGPL-compatible OSS; one sidecar keeps the Compose file at four services.

### Consequences

**Known risk, flagged for early build validation:** LibreOffice compare fidelity on complex Word documents. The engine sits behind an interface; a commercial SDK (Aspose-class) is the documented swap-in if fidelity fails — as an optional licensed add-on, never a required dependency (AGPL install path stays free).

## TECH-011: Email sending — SMTP first + provider adapter

- **Status:** Accepted
- **Date:** 2026-08-06

### Decision

SMTP (Nodemailer-class) as the universal default — every org's existing relay works — behind a thin sender interface with optional API-provider adapters (Postmark / SES / Resend). Configured in the SET-004 wizard. Notification/digest templates (NOT-002/003) in a maintainable email-template layer, copy per DES-015.

### Alternatives considered

API providers only: forces a SaaS mail account on regulated self-hosters.

## TECH-012: AI providers — three protocol adapters, provider presets, custom option

- **Status:** Accepted
- **Date:** 2026-08-06

### Context

Recommended Anthropic-first + OpenAI-compatible second. Blair widened: "a list of providers, including aggregators, Anthropic, OpenAI, Gemini, OpenRouter, others? Allow them to add custom provider?"

### Decision

- **Three protocol adapters** implement the CTR-008 extraction interface (`extract(doc, fields[]) → {slug, value, evidence}[]`):
  1. **Anthropic Messages API**
  2. **OpenAI-compatible chat completions** — one adapter covering OpenAI, Azure OpenAI, **OpenRouter**, Ollama/vLLM (local models), Groq, Mistral, Together, and any compatible endpoint
  3. **Google Gemini API**
- **Provider presets** in Settings → Contracts → AI Analysis: Anthropic, OpenAI, Azure OpenAI, Gemini, OpenRouter, Ollama (local) — each preset pins protocol + base URL and asks only for key + model.
- **Custom provider**: protocol picker + base URL + API key + model string — any current or future endpoint without a code change.
- BYO key per CTR-008; no provider configured → AI surfaces hidden. Default model strings maintained per preset (e.g. `claude-sonnet-5` for Anthropic); always user-editable.

### Rationale

The provider universe collapses to three wire protocols; presets give the named list, custom gives the long tail (including corporate proxies and local models — the self-host crowd's first ask) with zero adapter sprawl.

### Consequences

A "Test connection" affordance in settings. Extraction prompt/schema behavior must tolerate model variance — evidence-snippet validation guards against weak models hallucinating fields (values without matching document text get flagged, not written).

## TECH-013: DocuSign auth — JWT grant (service integration)

- **Status:** Accepted
- **Date:** 2026-08-06

### Decision

DocuSign **JWT grant**: org admin creates the DocuSign app, one-time consent; OpenLaw signs JWT assertions with the configured RSA key and mints tokens server-to-server. Envelopes send under the org's integration user; **DocuSign Connect** webhook delivers envelope status (CTR-013). Settings surface: integration key, user ID, RSA key, environment, test button.

### Alternatives considered

Per-user OAuth: every sender needs a seat + connection flow; background sends have no user context.

## TECH-014: Developer-experience housekeeping — repo, CI, testing, observability, telemetry, storage/search confirmations

- **Status:** Accepted
- **Date:** 2026-08-06

### Decision

Recorded as working defaults without a grill (all convention, no open design content):

- **Monorepo** — pnpm workspaces + Turborepo: `apps/api`, `apps/web` (SPA incl. portal routes), `apps/worker`, `packages/` (shared types, OpenAPI client, config).
- **CI/release** — GitHub Actions: lint + typecheck + test on PR; release = semver tag → ghcr images + compose.yml + .env.example artifacts (TECH-005). Conventional commits; CHANGELOG generated.
- **Testing** — confirms TECH-001's deferred default: **Vitest** (unit), **React Testing Library** (component), **Playwright** (E2E incl. the portal magic-link flow); API integration tests against a real Postgres container (testcontainers-class).
- **Observability** — structured JSON logs (pino) with request IDs; `/healthz` (liveness) + `/readyz` (DB/queue checks); metrics/OpenTelemetry deferred until someone asks.
- **Telemetry** — **none in v1.** No phone-home of any kind — the right default for a self-hosted legal tool; any future opt-in usage stats would be a separate, explicit decision.
- **File storage** — confirms DOC-009: storage adapter with **local-filesystem driver default** (a Compose volume) and **S3-compatible driver**; `file_ref` = driver-prefixed key.
- **Search** — confirms DOC-009: **Postgres FTS** (tsvector columns + GIN, indexing jobs on pg-boss); dedicated engine only if relevance/scale ever demands it.

### Consequences

Repo scaffold order: monorepo shell → Fastify + OpenAPI → auth (brings `packages/db` and its first tables) → Compose. _Revised 2026-08-08: there is no up-front "drizzle schema from SCHEMA.md" phase — the schema grows incrementally; tables land in the same change as the feature that reads and writes them, each with its own drizzle-kit migration, with SCHEMA.md as the naming/relationship reference._ The build phasing itself (which module first — CLM per PRODUCT.md) is unchanged.

## TECH-015: TypeScript 7 native compiler + TS 6 API shim for typescript-eslint

- **Status:** Accepted — **temporary by design; see sunset trigger below**
- **Date:** 2026-08-07

### Context

TypeScript 7.0 (the native Go compiler, ~10× faster) went GA 2026-07-08 but ships **without a stable programmatic API** — that lands in 7.1. typescript-eslint hard-errors on TS 7 and tracks support in [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940). Microsoft publishes `@typescript/typescript6`, a compat package re-exporting the TS 6.0 API (semantically aligned with 7.0) for exactly this gap.

### Decision

Use Microsoft's official side-by-side pattern in the root `package.json`:

```json
"@typescript/native": "npm:typescript@^7.0.2",
"typescript": "npm:@typescript/typescript6@^6.0.2"
```

- `tsc` (from `@typescript/native`) = TS 7 — all typecheck and build scripts.
- The npm name `typescript` resolves to the TS 6 API compat package — typescript-eslint and any other API consumer (editor tsserver included) load it transparently; its CLI is named `tsc6`, so there is no bin collision.

Because 6.0 and 7.0 are feature-aligned, lint and compile cannot disagree about language semantics.

### Sunset trigger

Tracked as [OpenLaw#1](https://github.com/juggernog20/OpenLaw/issues/1). **When typescript-eslint ships TS 7.1 API support ([#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)): delete both aliases, install plain `typescript@^7.1`, and remove this shim** (supersede this decision with a one-line note). Do not "simplify" the alias pair before then — removing it silently breaks lint.

### Alternatives considered

- **TS 6.0.3 only** — fully supported bridge, but forgoes the native compiler's build speed for no semantic gain.
- **oxlint + tsgolint** — a TS7-native linter (type-aware mode stable 2026-07-22, 59/61 of typescript-eslint's type-aware rules). Rejected for now in favor of the ESLint ecosystem's contributor familiarity; a reasonable revisit if the shim outlives its welcome.
- **TS 5.9** — a generation behind the bridge release; no advantage over 6.0.

### Consequences

- Contributors' editors that resolve the workspace `typescript` get the 6.0 tsserver — semantically identical to 7.0, just slower; pointing the editor at `@typescript/native` is an optional local tweak.
- Renovate/dependabot-style updates of typescript-eslint will not auto-remove the shim; the sunset is manual and owned by this record.

## TECH-016: API validation vocabulary — Zod as the single schema source

- **Status:** Accepted
- **Date:** 2026-08-08

### Context

TECH-003 makes the OpenAPI document a first-class artifact. Fastify needs a schema layer that yields runtime validation, static types, and OpenAPI generation from one definition, chosen once before the first route lands.

### Decision

**Zod (v4)** via `fastify-type-provider-zod`: every route declares request/response schemas in Zod; the same definitions drive validation, inference, and the OpenAPI 3.1 document (`@fastify/swagger`). Schemas shared with the SPA (form validation, shared types) live in `packages/shared`.

### Alternatives considered

**TypeBox** (`@fastify/type-provider-typebox`) — Fastify's native JSON-schema flavor, marginally faster validation, but its schemas are not reusable in the web app the way Zod's are, and Zod is the broader ecosystem lingua franca (better-auth, drizzle-zod, react-hook-form resolvers).

### Consequences

Zod is the validation vocabulary everywhere — API routes, shared package, frontend forms. No hand-written OpenAPI YAML, ever; the document is generated. The typed SPA client is generated from the emitted document (`openapi-typescript` + `openapi-fetch`), committed, and CI-checked for staleness.

## TECH-017: Compose topology — single app container, BYO reverse proxy, incremental service growth

- **Status:** Accepted
- **Date:** 2026-08-09

### Context

TECH-005 blessed `docker compose up` and named the destination service set — `app (API+SPA)`, `worker`, `postgres`, doc-engine sidecar — but the topology mechanics were never pinned: who serves the SPA, whether a reverse proxy ships in the box, and which services exist from day one. M3 (the Compose stack) is pulled forward because the auth epic's acceptance requires a browser E2E pass against a deployer-faithful instance, and that instance becomes the de facto reference deployment for every later epic. Grilled 2026-08-09.

### Decision

1. **Single app container serves the SPA.** Fastify serves `apps/web/dist` via `@fastify/static` with an SPA fallback (non-`/api` misses → `index.html`). A multi-stage Dockerfile builds the web bundle and copies it into the API image. The `worker` container remains the same image with a worker entrypoint (TECH-007).
2. **Bring-your-own reverse proxy.** No proxy container ships. Compose exposes the app on a host port (default 3000), plain HTTP. The deploy docs define the proxy contract: deployer terminates TLS, sets `BASE_URL` to the public origin, passes `Origin`/`Host` through unmodified, no path rewriting, no response buffering on `/api/events` (SSE, TECH-009). A copy-paste Caddyfile example lives in docs, not in the stack.
3. **Compose grows incrementally.** `compose.yml` ships now with exactly `app` + `postgres`. A service lands in `compose.yml` in the same change as the feature that first needs it — the compose counterpart of TECH-014's incremental-schema rule. TECH-005's four-service set is the destination, not the starting lineup (`worker` joins with the first pg-boss job, doc-engine with the first DOC feature).
4. **Mail catcher via dev overlay only.** `compose.dev.yml` (repo root, merged with `-f`) adds a **Mailpit** service and points the app's `SMTP_URL`/`SMTP_FROM` at it. The production `compose.yml` never contains a catcher.

Working defaults: `compose.yml`/`compose.dev.yml` at repo root next to `.env.example`; app env from `.env` via `env_file`; `postgres:16` pinned to the major, `pg_isready` healthcheck, `depends_on: condition: service_healthy` on app; pg data on a named volume (`openlaw-pgdata`); app service carries both `image: ghcr.io/…` and `build:` so the same file serves deployers (pull) and local builds.

### Rationale

- **Same-origin becomes structural, not configurational.** The auth epic's cookie/CSRF model (httpOnly session cookie, Origin checked against `BASE_URL`, TECH-008 addendum) cannot be broken by deployment config when SPA and API are one server on one port. A separate web/nginx container turns that guarantee into routing config that can silently drift.
- **One upstream keeps the proxy contract one line** — and the self-hosting audience (the Okta-era orgs TECH-008 targets) has existing ingress; a bundled Caddy needs a real domain to do anything (defeating the clean-VM M3 demo) and gets ripped out by everyone else.
- **A shipped mail catcher is a dangerous default**: it accepts and silently swallows real invites/magic links, and its unauthenticated web UI would expose live credential links in a legal tool. TECH-011's posture — unset SMTP loudly reports unconfigured — stays intact.
- **No stubbed services** (IMPLEMENTATION-PLAN doctrine): the worker is an empty entrypoint today; containerizing a no-op adds surface without a demo.

### Alternatives considered

- **Separate web container (nginx static + `/api` routing)** — best-in-class static serving nobody needs at 10 users; two images in lockstep; same-origin becomes config; three-service floor.
- **Bundled Caddy with auto-HTTPS** — needs DNS to demo; double-proxy for orgs with ingress.
- **All four TECH-005 services from day one** — idle worker and unused doc-engine violate no-stubbed-demos.
- **Mailpit in `compose.yml` (commented or live)** — the dangerous-default problem above.

### Consequences

- Release artifact (TECH-005) gains its concrete shape: `compose.yml` + `compose.dev.yml` + `.env.example` + ghcr images.
- `apps/api` takes `@fastify/static` and the SPA-fallback route; the Vite dev proxy (with its Origin rewrite) remains a dev-only affordance.
- The M3 demo reaches `http://<vm-ip>:3000` directly — TLS is the deployer's proxy's job.
- Every future service addition is a reviewable compose diff riding its feature's PR.

## TECH-018: Deployment fidelity — hybrid dev loop, hard E2E gate on built images, `e2e/` workspace

- **Status:** Accepted
- **Date:** 2026-08-09

### Context

IMPLEMENTATION-PLAN says development happens "the way a deployer would," but deployers run built images and iteration requires unbuilt code — no dev loop is actually deployer-faithful. The question is where fidelity is enforced. Grilled 2026-08-09 alongside TECH-017.

### Decision

1. **Hybrid dev loop.** Infra services (postgres, mailpit, later sidecars) always run from compose; `apps/api`/`apps/web` run as local watch processes (tsx / vite) during iteration.
2. **Hard fidelity gate.** All browser E2E and every milestone acceptance run against the real artifacts: images built by the real Dockerfiles, brought up by `compose.yml` + `compose.dev.yml`. CI enforces the same gate on PRs ([#18](https://github.com/juggernog20/OpenLaw/issues/18)).
3. **`e2e/` workspace package** holds the Playwright suite (`@playwright/test`, own config). Its lint/typecheck ride in root `pnpm check`; the browser run is excluded (needs the live stack) and runs via its own script against the stack's origin.
4. **The persistent local instance is the blessed stack itself** — `compose.yml` + dev overlay, locally built images, named volumes; state persists across runs and epics, so each epic's E2E builds on the accumulated instance. Suites use per-run unique fixtures (e.g. `staff+<ts>@…`) so reruns are clean and accumulation is harmless. _Revised (2026-08-09): the suite's persistent instance is its **own** compose project (`openlaw-e2e`, app on 3100, Mailpit on 8125), orchestrated by `pnpm e2e:local`. The default-project stack on 3000/8025 is the human testing ground — E2E never runs against it, so manual acceptance state and suite fixtures (each instance's own Administrator) can't collide. Both stay persistent; the accumulated-state property lives with each._

### Rationale

The works-on-my-machine failures this guards against — dev-server masking build breaks, origin/CSRF topology differences, migrations-on-boot behavior, env wiring — are properties of the _built stack_, so that is what gets checked, on every E2E run and every PR. Fully containerized dev (bind-mounts + in-container watch) has the worst DX and is still not the production image path — a deployer costume, not fidelity.

### Alternatives considered

- **`docker compose watch` as the blessed loop** — genuinely faithful (image rebuild per change) but the rebuild latency makes people stop running the app; remains available via a `develop: watch` block for those who want it.
- **Bind-mount containerized dev** — slow _and_ unfaithful.
- **Fresh instance per E2E run** — loses the accumulated-state property that makes the persistent instance a standing reference deployment; CI still uses fresh volumes (the suite's bootstrap probe handles both).

### Consequences

- A first-run-vs-existing bootstrap probe is a structural requirement of the E2E suite (fresh CI volumes vs persistent local state).
- The magic-link E2E needs the domain allowlist reachable through the front door: an Administrator-only `GET`/`PUT /api/v1/auth/allowed-domains` (read + replace-whole-list) lands with this workstream — the surface a future SET-004 settings pane consumes.
- Playwright joins the dependency set (TECH-014's E2E confirmation becomes concrete).

## TECH-019: Code documentation — module-granular doc comments, no coverage percentage

- **Status:** Accepted
- **Date:** 2026-08-09

### Context

CodeRabbit's `docstrings` pre-merge check reported 36.05% coverage against its stock 80% threshold. Nothing in the repo requested that check — it is a CodeRabbit default, and at `warning` it gates nothing — but the number invited a repo-wide comment sweep, so the convention it was measuring against needed pinning. A survey of the 58 TypeScript sources found 47 carrying a module-level doc block (the 11 without are 6 test files, `vite.config.ts`, `drizzle.config.ts`, `main.tsx`, `testing/setup.ts`, and one genuine gap since closed) and 70 decision-record citations sitting in source comments.

### Decision

1. **Document at module granularity.** Every non-test, non-config source file opens with a `/** ... */` block stating what the module is for and citing the decision record that governs it. This is the primary unit of documentation.
2. **Comment the members a type cannot describe** — invariants, lifecycle and ordering constraints, why an empty or defaulted value means what it means, deliberate departures from the obvious alternative. Not every export.
3. **No coverage percentage.** `.coderabbit.yaml` sets `reviews.pre_merge_checks.docstrings.mode: off`, and a `path_instructions` entry teaches the reviewer the convention above — including that a comment restating its signature is a finding, not a contribution.
4. **Generated artifacts are excluded from review** via `path_filters`: `packages/api-client/src/schema.ts` and `apps/api/openapi.json`, whose fixes always belong upstream in the emitter. Migrations are not excluded — drizzle emits them, but they are hand-consolidated and are the highest-consequence SQL in the repo.

### Rationale

- **The metric is anti-correlated with the practice here.** Per-exported-symbol counting scored a codebase with near-universal module docs and 70 decision citations at 36%, because the information sits in one block per file rather than one per symbol. The only way to move the number is to add comments that restate signatures.
- **TypeScript already carries what a docstring carries elsewhere.** The 80% default is calibrated for ecosystems where a bare signature says nothing. `getMatter(id: MatterId): Promise<Matter | null>` documents its inputs, output, and that it can miss.
- **A signature-restating comment is worse than no comment**: it rots when the signature changes and then actively misleads.
- **Agent navigability is the real reason to write them.** An agent greps into one file without the surrounding context a human carries; nobody reads `DECISIONS-CONTRACTS.md` before editing one function. The module block is where a decision record becomes reachable at the point of use — which is why the citation, not the coverage, is the thing worth enforcing.

### Alternatives considered

- **Write to 80%** — ~44 points of filler over a well-documented codebase; large diff, lower signal.
- **Lower the threshold to just under current (30–40)** — keeps a metric nobody believes and ratchets on the wrong axis; a real regression against the actual convention (a new module with no block) would still pass.
- **`mode: error`** — makes a default nobody chose into a merge gate.
- **Leave it at defaults** — a standing warning that is not a defect trains the team to ignore pre-merge checks.

### Consequences

- `.coderabbit.yaml` enters the repo and becomes the place review policy is expressed; future custom checks belong there.
- The convention is enforced by review instruction rather than by tooling — no linter measures it, deliberately.
- New modules are expected to cite a decision record; where none applies, that is a signal the decision has not been recorded yet.

## Index of decisions

| #        | Decision                                                                      | Status               |
| -------- | ----------------------------------------------------------------------------- | -------------------- |
| TECH-001 | Frontend stack — React + Tailwind CSS + shadcn/ui (copied) + Radix primitives | Accepted             |
| TECH-002 | Backend — TypeScript on Node LTS                                              | Accepted             |
| TECH-003 | Application shape — Fastify API + Vite React SPA (REST/OpenAPI)               | Accepted             |
| TECH-004 | Database — PostgreSQL only                                                    | Accepted             |
| TECH-005 | Deployment — Docker Compose as the blessed path                               | Accepted             |
| TECH-006 | ORM — Drizzle (+ drizzle-kit migrations)                                      | Accepted             |
| TECH-007 | Background jobs — pg-boss on Postgres                                         | Accepted             |
| TECH-008 | Authentication — onboarding-selectable: built-in basic or BYO IdP (OIDC)      | Accepted             |
| TECH-009 | Real-time — SSE on live surfaces                                              | Accepted             |
| TECH-010 | Document engines — one LibreOffice + OCR sidecar                              | Accepted             |
| TECH-011 | Email sending — SMTP first + provider adapter                                 | Accepted             |
| TECH-012 | AI providers — three protocol adapters, presets, custom option                | Accepted             |
| TECH-013 | DocuSign auth — JWT grant (service integration)                               | Accepted             |
| TECH-014 | DX housekeeping — repo, CI, testing, observability, telemetry, storage/search | Accepted             |
| TECH-015 | TypeScript 7 native compiler + TS 6 API shim for typescript-eslint            | Accepted (temporary) |
| TECH-016 | API validation vocabulary — Zod as the single schema source                   | Accepted             |
| TECH-017 | Compose topology — single app container, BYO proxy, incremental growth        | Accepted             |
| TECH-018 | Deployment fidelity — hybrid dev loop, E2E gate on built images, `e2e/` pkg   | Accepted             |
| TECH-019 | Code documentation — module-granular doc comments, no coverage percentage     | Accepted             |
