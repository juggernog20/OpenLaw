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

- Backend language / runtime (Node/TypeScript / Python / Go / Ruby / Elixir / Rust — adoption ceiling vs ecosystem fit vs single-binary deployability)
- Backend framework (full-stack like Rails/Django/Phoenix/Laravel, or split with API + frontend like NestJS/FastAPI + React)
- Database (Postgres only? SQLite for tiny deployments? both via abstraction)
- ORM / data access layer (Prisma / Drizzle / SQLAlchemy / Ecto / raw SQL)
- File storage abstraction (local filesystem, S3, S3-compatible — single adapter interface)
- Background job runner (in-process worker / Sidekiq-style / Postgres-based queue / Temporal)
- Search (Postgres FTS / SQLite FTS5 / dedicated like Tantivy / Meilisearch)
- Email sending (SMTP / Postmark / SES / Resend abstracted via adapter)
- Email receiving (referenced in `DECISIONS-INTAKE.md`; same adapter shape question)
- Authentication (cookie session / JWT / Passkeys; magic-link library; OAuth providers as v2)
- Real-time updates (polling / SSE / WebSockets; required for v1 or not)
- Deployment shape (Docker Compose for self-host / single binary / k8s helm chart / managed cloud option)
- Migration story (built-in CLI / per-framework conventions)
- Testing stack (unit / integration / E2E — frameworks and conventions; frontend testing per TECH-001)
- Monorepo vs polyrepo (likely monorepo; tooling — Nx / Turborepo / pnpm workspaces / cargo workspace)
- CI / release process (GitHub Actions; release cadence; semver discipline)
- Telemetry / opt-in usage analytics (PostHog self-host / Plausible / nothing)
- Observability for self-hosters (structured logs format, metrics endpoint, OpenTelemetry support)
- React meta-framework choice (Next.js / Remix / Vite + React Router / TanStack Start / plain Vite SPA — gated by the backend choice; if Next.js, server-side concerns blur with backend)

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

## Index of decisions

| # | Decision | Status |
|---|---|---|
| TECH-001 | Frontend stack — React + Tailwind CSS + shadcn/ui (copied) + Radix primitives | Accepted |
