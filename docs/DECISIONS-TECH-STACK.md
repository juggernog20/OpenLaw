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
- Frontend build pipeline assumes Node.js for build-time tooling (Tailwind compile, TypeScript compile, bundler). Self-hosters do not need Node at *runtime* — only during build, or they consume a pre-built bundle from a release artifact.
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
Repo scaffold order: monorepo shell → drizzle schema from SCHEMA.md → Fastify + OpenAPI → auth → Compose. The build phasing itself (which module first — CLM per PRODUCT.md) is unchanged.

## Index of decisions

| # | Decision | Status |
|---|---|---|
| TECH-001 | Frontend stack — React + Tailwind CSS + shadcn/ui (copied) + Radix primitives | Accepted |
| TECH-002 | Backend — TypeScript on Node LTS | Accepted |
| TECH-003 | Application shape — Fastify API + Vite React SPA (REST/OpenAPI) | Accepted |
| TECH-004 | Database — PostgreSQL only | Accepted |
| TECH-005 | Deployment — Docker Compose as the blessed path | Accepted |
| TECH-006 | ORM — Drizzle (+ drizzle-kit migrations) | Accepted |
| TECH-007 | Background jobs — pg-boss on Postgres | Accepted |
| TECH-008 | Authentication — onboarding-selectable: built-in basic or BYO IdP (OIDC) | Accepted |
| TECH-009 | Real-time — SSE on live surfaces | Accepted |
| TECH-010 | Document engines — one LibreOffice + OCR sidecar | Accepted |
| TECH-011 | Email sending — SMTP first + provider adapter | Accepted |
| TECH-012 | AI providers — three protocol adapters, presets, custom option | Accepted |
| TECH-013 | DocuSign auth — JWT grant (service integration) | Accepted |
| TECH-014 | DX housekeeping — repo, CI, testing, observability, telemetry, storage/search | Accepted |
