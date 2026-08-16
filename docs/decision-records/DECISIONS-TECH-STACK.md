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

### Addendum (2026-08-15) — settled in M12/3: the pipeline, and what a job is

The queue and the worker container this decision named both shipped, with text extraction (DOC-005) as their first real job. What was open was only the mechanism, and this is what it is.

**The seam is `JobQueue`**, injected into the app factory beside the database, the mailer, storage, and the doc engine. It carries one method per thing the domain asks for — `requestTextExtraction` today — rather than a generic `enqueue(name, payload)`, so a route names what it wants and never learns that pg-boss is behind it. Handlers live in the API package (`apps/api/src/pipeline/`) and the worker imports them: the worker is the same image with a different command, so a handler is written once and which process runs it is a deployment choice, not a code boundary.

**One `startPipeline` call brings up both shapes.** A process that passes handler dependencies works the queue; a process that does not only sends. The API sends and the worker works, and pg-boss's own upkeep runs where the work does, so an install with several API replicas has one maintainer rather than one per replica.

**The derivation row is the record of work owed; the queue is only the wake-up.** The `pending` row is written inside the upload's own transaction, so a rolled-back upload asks for nothing and a committed one always leaves the request on the record. The queue send happens **after** the commit and its failure is logged, never raised: an upload must complete at M11's speed and must not fail because a worker is down (M12 story 11). A lost send therefore leaves a pending row rather than a version nobody will ever read, which is exactly what M12/6's backfill sweep is for. Sending inside the transaction — pg-boss supports it — was the alternative; it was declined because it makes the queue's availability a condition of the upload's success.

**A job's failure has one question: the file's fault, or the moment's.** An unsupported format, an unreadable source, and a missing blob are terminal — a retry reads the same bytes and fails the same way — so the derivation is marked `failed` and the job is done. Everything else, including errors nobody has classified, is treated as transient and retried, because retrying something permanent wastes two attempts and then records the failure anyway, while giving up on something temporary loses a document's text until somebody notices. Bounds live on the queue, not on the send: fifteen minutes per attempt (room for two doc-engine calls of up to five minutes each — read the text layer, then OCR), three attempts, thirty seconds and then a minute between them.

**Queues opt into LISTEN/NOTIFY, with polling underneath.** A worker is woken the moment a job is sent rather than at its next poll, because somebody who has just uploaded a scan is watching the record. It costs the worker one dedicated connection, and polling stays as the correctness floor — a dropped listener slows the pipeline and never stops it. Repeated requests for the same version collapse while the job is still waiting (pg-boss's `short` policy, keyed on the version), so an upload and the backfill sweep naming the same version leave one job.

**The test harness runs the real queue and the real handlers in-process.** pg-boss installs its schema in about a tenth of a second on the harness's Postgres testcontainer, so every API suite runs the production pipeline rather than a double that would have to be kept in step with it. Suites upload over HTTP and poll the same read the panel polls; only the doc engine is faked.

### Addendum (2026-08-15) — settled in M12/4: what makes a second queue

Display conversion (DOC-004) is the pipeline's second job, and it took a **queue of its own** rather than a branch inside extraction. The line is what a job produces, not what it reads: extraction answers text and writes no blob, conversion writes a blob the panel then reads, and the two have bounds an operator may want to move independently — an install that finds LibreOffice slow on a 300-page deed should be able to raise the conversion ceiling without also telling every OCR pass it may run longer. So the bounds are stated twice rather than shared.

The seam grew one method, `requestDisplayConversion`, on the same rule: one method per thing the domain asks for. **An upload asks for exactly one job.** A PDF asks for extraction; a Word document or a deck asks for conversion, and the conversion job reads its rendition's text at the end of its own work — that is the only moment anything knows the rendition exists, and chaining a second queue send from a handler would put a queue failure between a rendition and its text. What every derivation job shares — the four dependencies, the terminal-or-transient question, opening a stored blob without leaking a handle — moved into one module both handlers import, so a third derivation starts from it unchanged.

### Addendum (2026-08-15) — settled in M12/6: the upgrade backfill sweep, and what a pending row means

The sweep this milestone promised (M12 story 23) runs in the worker, at boot, after the handlers are registered — so an install with a large back catalogue is already taking new jobs while the old paper is walked. It is started, not awaited, and it never raises: a sweep is best effort, and a worker that refused to boot because it could not finish one would be the worse answer. A signal stops it between versions, and whatever it did not reach is still owed at the next boot, because it reads the record rather than a cursor it kept.

**The sweep asks; it never derives.** It sends the same two jobs an upload sends, to the same two queues, and the same handlers do the work — there is no second code path for old paper, so a backfilled version gets exactly what a freshly uploaded one gets. It picks the job by family on the upload path's rule: one job per version, and a Word document or a deck asks for conversion because that job delivers both its derivations.

**A missing row and a pending row are the same fact: work owed.** This is the decision the milestone left open, and it settles the loose end M12/3 recorded. A version that predates the derivation tables has no row. A version whose queue send was lost has a `pending` row. So does a version whose job expired against a wedged worker on its **last** attempt — pg-boss fails the job, the handler never runs its catch, and nothing is written. The sweep cannot tell these three apart and does not need to: all three want to be asked again, and asking is the only thing that could have been right for any of them. The alternative — closing a stale pending row as `failed` after some age — was declined, because it would turn a lost send into a permanent loss of a document's text, which is the failure DOC-005 exists to prevent.

**A derivation that gave up is settled.** A `failed` row is the outcome of a job that ran and decided no retry would read the same bytes differently, so the sweep walks past it at every boot. A conversion that failed closes the version for good, its text included: the text was only ever going to be read out of that rendition, so a text row still owed beside a `failed` rendition is not a reason to convert the same bytes again. This is the one state the sweep will not re-ask for, and it is what keeps a boot from putting a permanently broken file through the doc engine for ever.

**Asking twice is free, so the sweep is not clever about it.** pg-boss's `short` policy collapses a second request for a version whose job is still waiting, and both handlers stop early when the derivation is already there. Two workers booting together, or one booting while an upload is in flight, therefore cost one job between them — which is what makes an unconditional sweep at every boot safe. No lock, no leader election, and no "have I swept before" flag: the derivation rows already say what is owed, and a second source of that truth would be a second thing to get wrong.

**A backlog is drained, not polled through.** The sweep is the first thing in this system that asks for many jobs at once, and it found the wake-up path tuned for one at a time. pg-boss relaxes its polling backstop to thirty seconds once a queue is woken by notification, on the reasoning that the notification delivers the job — but notifications sent while a worker is busy coalesce, so a burst left jobs waiting half a minute each. The M12/3 addendum above already called polling the correctness floor; thirty seconds is not one. So the workers now burst while more than one job is ready — fetching again the moment they finish, rather than waiting — and the poll underneath is two seconds. A queue with one job at a time, which is the ordinary upload, is untouched by either. Raising the batch size was the alternative and was declined: a job is active from the moment it is fetched, so a batch of two would run the second one's fifteen-minute expiry clock while the first one's conversion was still going.

**The sweep reads the version table in pages.** Which family a file belongs to is decided from its declared type and its filename (DOC-004), and no database can answer that, so every version is looked at. Keyset paging on the version id — a uuidv7, and so already in the order it was minted — keeps one boot from holding a result set over a large back catalogue.

### Addendum (2026-08-16) — settled in M15/6: the one sweep that repeats

The reconciliation sweep (CTR-013) is the third sweep on the worker, and the first one that does not run once. The other two **recover work the rows already say is owed**, so one walk at boot is the whole job. This one is a **feed**: it is waiting for somebody to sign, which no single walk can see. So it keeps the M12/6 shape — keyset paging on the envelope id, a refusal bound, a signal that stops it between rows, and no cursor kept anywhere — and repeats it on an interval.

**Five minutes between rounds, and the rounds do not overlap.** The wait starts when a round ends, so a slow provider stretches the gap instead of stacking rounds on top of each other. The interval is measured against what the sweep is for — "somebody signed and nobody has told us" — and not against the webhook's seconds; an install that has Connect never notices the sweep at all, because every round finds the record already converged and asks nobody anything.

**A provider outage is the round's, not the envelope's.** Nothing is marked failed, no envelope is given up on, and the next round asks again — the executed-copy sweep's `failed` state has no counterpart here, because a status that could not be read is not a status this install may invent. The refusal bound then stops a round after a few unreachable answers in a row, for the backfill sweep's reason: a provider that is down is down for all of them, and asking once per live envelope costs a round trip each to learn the same thing. Credentials the provider refuses end the round at once, because they are install-wide.

### Addendum (2026-08-16, [#277](https://github.com/juggernog20/OpenLaw/issues/277)) — a repeating sweep is a scheduled job, not a timer

The addendum above gave the reconciliation sweep an in-process interval loop on the worker. **That makes replica count multiply the provider requests.** Two worker replicas each walked every live envelope and each asked the provider about it, every round — against the endpoint DocuSign rate-limits hardest. Nothing was corrupted by it: the sweep is a reader and `applyEnvelopeStatus` makes a second application a no-op. The cost was requests, not correctness.

**It is now a scheduled pg-boss job on `*/5 * * * *`, the shape the backfill sweep already had.** pg-boss elects one cron worker per queue, so an install running N workers gets one round. The queue is `singleton`, so a tick landing while a round is still walking waits for it rather than joining it — which is the loop's non-overlap property, kept. The interval and the refusal bound moved with it unchanged.

**The rule this settles is wider than one sweep, and it is the boot-versus-schedule line.** A sweep that runs **once** recovers work the rows already say is owed, so a second replica walks the same table, finds nothing left to ask for, and costs one query. A sweep that **repeats** is asking somebody the same question over and over, and a second replica doubles that. So: anything that runs once may live in the worker's boot; anything that repeats belongs on pg-boss's clock. The two boot sweeps stay where they are.

**What it costs is a round at boot.** The loop swept immediately on start; the schedule waits for the next tick, so a worker that has just restarted can be up to five minutes behind. That is the right trade for a fallback feed measured in minutes, and the alternative — a boot round per replica beside the schedule — puts the duplication straight back on every rolling deploy, which is the one moment replica count is guaranteed to be greater than one.

**Alternatives considered.** _Document a single worker replica and pin it in `compose.yml`_ — cheaper, and it makes correct scaling a thing an operator can silently break with no error and no sign. _A leader-election flag of our own_ — a second source of the truth pg-boss already holds, and TECH-007's own M12/6 note declines exactly that reasoning for the backfill sweep.

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
- **SSO client secret at rest.** The sso plugin stores the OIDC client secret inside the provider row's config JSON. v1 accepts DB-at-rest storage (single-tenant, self-hosted, the DB already holds privileged material); **flagged for a future secrets-encryption pass** — deliberate, not accidental. _(2026-08-16, M15/1: the DocuSign RSA private key and the Connect HMAC secret in `signing_connectors` are the **second entry** on that same pass, under the same accepted posture — see CTR-013's M15 addendum.)_
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

### Addendum (2026-08-14) — settled in M12/1: the sidecar and the `DocEngine` seam

The sidecar and the interface this decision named both shipped. What was open was only the mechanism, and this is what it is.

**The sidecar is our own image**, built from `services/doc-engine/`: headless LibreOffice, OCRmyPDF/Tesseract, poppler, and a thin HTTP wrapper over three operations — convert a source to PDF, OCR a PDF and answer the text, read a PDF's native text layer. It is stateless (every call writes into a temporary directory it removes before answering), carries **no authentication**, and declares **no published port**. The last two go together: it has nothing to authorise, because the API decides who may read a file long before it sends the bytes, so what keeps it safe is that it is reachable only on the compose network, exactly as Postgres is.

**The base image is Debian trixie, not the bookworm the application image is built on.** The base is chosen for the LibreOffice it carries. Bookworm ships 7.4, which exports a Word comment as a PDF annotation only; trixie ships 25.2, which renders comments in the page margin. DOC-004 promises a reader sees tracked changes _and_ comments in the conversion, and only the newer engine keeps that promise as visible text. The cost is accepted and named: the project now tracks two Debian releases for security updates rather than one, and the sidecar — roughly 800 MB, most of it LibreOffice — is by a long way the largest image in the stack. Moving back to bookworm would remove both costs and give up the visible comment, which is not a trade this decision is willing to make.

**The seam is `DocEngine`**, injected into the app factory beside the database, the mailer, and storage. It carries three operations and names no tool, filter, or temporary file — an interface shaped around LibreOffice's command line could not carry the Aspose-class swap-in this decision reserves. Its failures are split by what a caller should do about them, because the pipeline has to choose between marking a derivation failed and retrying it: an unsupported format and an unreadable source are terminal, a timeout and an unreachable engine are transient.

**The engine is chosen at startup and injected**, on the storage driver's pattern: `DOC_ENGINE_URL` defaults to the sidecar's name on the compose network, so the blessed stack configures nothing, and a malformed value stops the boot rather than quietly calling somewhere else. Nothing is contacted at startup, so a sidecar still coming up never holds the API's boot — and Compose starts the app after it by order only, never gated on its health, because a conversion that cannot reach the engine falls back to download-only while a database that cannot be reached is fatal.

**The contract suite comes in two tiers**, and the split is the honest part. The _shape_ tier — which formats convert, which failure each bad input produces, that a conversion answers a PDF, that what the engine converts it can read back, that nothing one call does is visible to the next — is run against both the real image and the deterministic fake. The _fidelity_ tier — a Word document's words, a deck's slide, the tracked insertion, the tracked deletion, the margin comment, a scan's OCR text, and a native text layer read without OCR — runs against the real container only. The fake cannot read a Word document, and a fake that pretended to would pass while the engine it stands in for failed. The fidelity tier is where this decision's flagged risk is now measured rather than assumed.

### Addendum (2026-08-15) — settled in M12/5: the in-process MSG/EML libraries

This decision said MSG/EML parsing is an in-process Node library and left the library open. These are the ones, and the reason for each.

**Two libraries, because there are two containers.** An EML is an RFC 822 MIME message and is read by **`postal-mime`** (MIT-0, no dependencies of its own). A MSG is Outlook's compound file — a small random-access filesystem, not text — and is read by **`@kenjiuno/msgreader`** (Apache-2.0). Both licences are AGPL-compatible, which is the gate every runtime dependency passes. Neither container can be parsed as a stream: a MSG is addressed at random and a MIME tree is only whole once its last boundary is read. So the whole file is opened in memory behind a 25 MiB ceiling. It is a ceiling, not a claim about what exists: a message with large attachments, or one an internal Exchange carried without a relay's limits, really can be bigger — and what such a file is refused is the parsed reading of itself, never its upload, its download, or its place on the record.

**The sanitizer is a third dependency, and it is not optional.** An email body is the only content in the product written by somebody outside it, and the panel is asked to render it. **`sanitize-html`** (MIT) cuts it to an allow-list on the server, so no client can render the raw form by forgetting a step. Writing our own was rejected: an HTML sanitizer is a parser with an adversary, and this is not the place to have one of our own.

**Neither library touches the doc-engine seam, and that is the decision holding.** `DocEngine` names three operations over documents the sidecar reads; an email is not one of them, and adding a fourth would put a text format that parses in a millisecond behind an HTTP call to an 800 MB container. The `EmailUnreadableError` these libraries raise is classified terminal beside the engine's own terminal failures, because it means the same thing to the pipeline: a retry reads the same bytes.

## TECH-011: Email sending — SMTP first + provider adapter

- **Status:** Accepted
- **Date:** 2026-08-06

### Decision

SMTP (Nodemailer-class) as the universal default — every org's existing relay works — behind a thin sender interface with optional API-provider adapters (Postmark / SES / Resend). Configured in the SET-004 wizard. Notification/digest templates (NOT-002/003) in a maintainable email-template layer, copy per DES-015.

### Alternatives considered

API providers only: forces a SaaS mail account on regulated self-hosters.

### Addendum (2026-08-10) — database-configurable SMTP; environment wins (#37)

The SET-004 wizard surface this decision named (deferred at M2, where env vars carried SMTP alone) shipped: the wizard's email step saves a relay URL + from-address to the `org_settings` singleton, mirroring the `SMTP_URL`/`SMTP_FROM` shape — one mental model, two carriers. The mailer is resolved at send time, env-else-database (the TECH-014 read-on-every-decision pattern), so a save applies to the very next send with no restart. **Precedence: environment wins.** A set `SMTP_URL` pins the instance — database values are ignored entirely and saves are refused. This is a safety property, not a convenience: the dev/E2E overlay pins Mailpit via env, and a database-saved real relay must never beat it, or test mail leaks to real inboxes. The relay URL is write-only through the API (it embeds the credential) and stored plaintext for v1 — at-rest encryption is a flagged follow-up shared with the TECH-008 SSO client secret.

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

### Addendum (2026-08-16, M15/1)

The surface shipped in **Settings → Organization → Integrations → E-signature** (SET-007), and it asks for one field more than this decision listed: the **DocuSign Connect HMAC secret**, without which a connector cannot be saved. The account is **discovered, not configured** — `/oauth/userinfo` answers the integration user's default account — so the pane asks for three plain values — environment, integration key, and user ID — plus two secrets, rather than for an account id. The assertion is RS256, scoped `signature impersonation`, and lives ten minutes.

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
3. **Compose grows incrementally.** `compose.yml` ships now with exactly `app` + `postgres`. A service lands in `compose.yml` in the same change as the feature that first needs it — the compose counterpart of TECH-014's incremental-schema rule. TECH-005's four-service set is the destination, not the starting lineup (`worker` joins with the first pg-boss job, doc-engine with the first DOC feature). _Settled in part in M12/1: the doc-engine service joined, so the stack was `app` + `postgres` + `doc-engine`. The sidecar follows Postgres's posture exactly — no published port, reachable only on the compose network — and the app depends on it by start order alone, never on its health._ _Settled in M12/3: the `worker` joined with the first pg-boss job, so `compose.yml` now defines all four services TECH-005 named. The worker is the app's own image run with the worker command (TECH-007) and reads the same environment block, so a variable added to one and forgotten on the other cannot happen. It carries no health probe, because it publishes nothing to probe._
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

### Addendum (2026-08-16, M15/7) — the outbound side of a test stack goes to a stand-in

The M15 demo has to send an envelope, and a suite that runs on built images cannot inject the API's own fake signing provider: the container resolves its driver for itself from the stored connector (CTR-013). Two rules follow, and they are the rule the dev overlay already applies to mail.

1. **The overlay pins the outbound side.** `compose.dev.yml` sets `DOCUSIGN_BASE_URL` on the **app and the worker both** — both resolve a provider, one to send and verify, the other to fetch an executed copy — and points them at a server the suite runs on the host (`host.docker.internal`, the same door the mock OIDC issuer uses). SMTP goes to Mailpit for this reason; signing goes to a stand-in for it too. A test run must not be able to post paper to somebody's DocuSign account.
2. **The switch is the overlay's alone, and only names a host.** The connector's credentials stay org data read live from the row; the variable answers where they are presented, nothing else. It is unset on every real install, malformed values stop the boot rather than falling back to DocuSign, and both processes warn at boot when it is set — the `AUTH_RATE_LIMIT=off` shape.

What this buys is that the **production path runs in the demo**: the real DocuSign driver, its JWT grant, its Connect HMAC check, the real webhook route, and the real worker fetch. What the stand-in supplies is the counterpart's shapes and the one thing no real provider would give a test — a signer who signs on demand.

The E2E demo's stand-in is deliberately the same server shape the DocuSign driver's own contract suite runs against, so one description of the counterpart is not maintained in two divergent forms.

**What it costs.** Three things, named because they are real. The demo's counterpart is **our** description of DocuSign, so its fidelity is only as good as the driver's contract suite and the payload fixtures — nothing in CI ever talks to DocuSign, and nothing here claims otherwise. The boot-time read is **duplicated in both entrypoints**, as the storage root and the doc engine already are, because both processes resolve a provider and a variable set on one and forgotten on the other is a send that works and a signed PDF that never lands. And the switch is a code path no deployment exercises, which is why it is one function with tests of its own rather than a condition sprinkled through the driver.

**Alternatives considered.**

- **Ship the deterministic fake provider in the image, behind a flag** — a build-time double is not the DocuSign driver, so the demo would prove the record's half of the milestone and skip the driver, the JWT grant, and the Connect HMAC entirely. The point of the fidelity gate is that the production path runs.
- **A recorded-fixture proxy replaying real DocuSign traffic** — closer to DocuSign, and unable to do the one thing the demo needs: sign an envelope on demand, mid-journey, in an order the recording never took.
- **Let the E2E stack reach DocuSign's demo estate** — a shared credential in CI, a network dependency in a gate that must be deterministic, and a suite that can post paper to a real account.

### Addendum (2026-08-16, [#279](https://github.com/juggernog20/OpenLaw/issues/279)) — the stand-in takes two variables, and they have to agree

The addendum above guards `DOCUSIGN_BASE_URL` three ways: it must name a bare origin with no credentials, it is warned about at boot, and only the dev/E2E overlay sets it. What it did not have is a second fact saying **this install is deliberately not talking to DocuSign**. `compose.yml` passes `.env` to both processes, so one line in the wrong `.env` sent a real install's paper to whatever host it named, with a warning in the boot log as the only sign.

**A second variable earns its place here, where it would not for the other overrides.** `SIGNING_STANDIN=true` carries no address and says only that. Set the address without it and the boot stops; set it without the address and the boot stops too. The asymmetry with `SMTP_URL`, `DOC_ENGINE_URL`, and the rest is deliberate and rests on the consequence, not on the shape: a mis-set mail relay sends an invitation to the wrong catcher, and a mis-set signing host puts a contract in front of a third party who is not DocuSign and takes back a document the record then treats as executed. That is a different kind of wrong, and it is the only override in the file with it.

**Refusing the flag without an address is the half worth arguing for.** The flag alone changes nothing on its own, so ignoring it would be defensible. It is refused because the honest reading of "declared a stand-in, named no stand-in" is that the address was meant to be there and was lost — a typo in the name, a line dropped from the overlay — and this install would then dial DocuSign while its operator believed it could not.

**The pairing is enforced in `readDocuSignBaseUrl`, not at the entrypoints.** The API and the worker both call it, so there is no way to guard one and not the other — which the addendum above names as the worse-than-neither outcome: a send that goes to the stand-in and an executed copy fetched from DocuSign. `compose.dev.yml` sets both in the shared anchor for the same reason.

Neither variable appears in `.env.example`. That file is what a self-hoster reads and copies, and the address has no business being one line away from a real install.

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

## TECH-020: Problem `type` URIs — a refusal names itself only when a client must act on it

- **Status:** Accepted
- **Date:** 2026-08-16

### Context

Every non-2xx answer is an RFC 9457 problem detail (TECH-016's consequence: one error envelope, generated into the OpenAPI document and the typed client). Until M14 every one of them carried `type: "about:blank"`, because every one of them was a refusal the client **prints**.

CTR-012's soft gate (#235) is the first refusal a client has to **act on**. `PATCH /contracts/:number` refuses a status change that crosses past the approval stage while approvals are unresolved, and the web record turns that refusal into a confirmation dialog and retries with an override flag. The same route already answers 409 for an archived contract, so the status code does not tell the two apart, and the only thing left to branch on was the wording of `detail`.

### Decision

1. **`HttpError` carries an optional `type`, and the error handler renders it.** It defaults to `about:blank`, which stays the answer for every refusal a client prints.
2. **Set it only where a client is expected to branch.** A refusal that a client renders as a sentence and nothing else keeps `about:blank`. A refusal that drives a second request, a dialog, or a different code path names itself.
3. **The URI is a URN under `urn:openlaw:problem:`** — `urn:openlaw:problem:approval-soft-gate` is the first. OpenLaw is self-hosted, so an `https:` type would name a domain that resolves for nobody who runs it.
4. **The type is part of the API contract.** It is a stable identifier: rewording `detail` is a copy change, and changing a `type` is a breaking change.

### Rationale

- **Branching on copy is a latent break.** `detail` is product copy written for a human, and copy gets rewritten. A client that matched on it would fail silently at the first rewording, on the path that matters most — the one where a warning is meant to be raised.
- **RFC 9457 already answers this.** §4.2.1 makes `type` the problem's identity and `detail` the human-readable explanation. Nothing new was invented; the field was there and unused.
- **A default of `about:blank` keeps the cost at zero.** No existing refusal changes, no route has to opt out, and the generated client already carries the field.
- **A URN says the truth about the deployment.** Every self-hoster runs their own OpenLaw; there is no shared origin to hang a dereferenceable type URI on.

### Alternatives considered

- **Match on `detail`.** Rejected: copy is not a contract.
- **A dedicated extension member on the envelope** (a `code`, or a structured `unresolvedApprovals` array). Rejected: `type` is the field the RFC already spends on exactly this, and a per-feature member on a shared envelope grows one field per feature that ever needs to be acted on.
- **A distinct status code for the gate** (422 rather than 409). Rejected: status codes are a small closed set shared across every refusal a route can give, and the next feature that needs to be acted on would collide.
- **Answering 200 with a "would need confirmation" body instead of refusing.** Rejected: the gate has to be honest for every API client, and a 200 that did not commit is a lie to the ones that do not read the body.

### Consequences

- `apps/api/src/lib/problem.ts` owns the field; `app.ts`'s error handler renders it. Every existing refusal is unchanged.
- The web helper layer gains `problemType` beside `problemDetail` (`apps/web/src/lib/messages.ts`).
- Each acted-on type is declared once, in `packages/shared` (TECH-016's home for definitions both ends of the wire must agree on), and imported by the rule that throws it and the client that branches on it — `SOFT_GATE_PROBLEM_TYPE` in `packages/shared/src/index.ts` is the first. A mirrored copy per side was rejected in review: two copies that drifted would not fail loudly — the client would simply stop recognizing the refusal.
- The OpenAPI document does not enumerate the types; they are documented in the route summary that can raise them.

## TECH-021: Secrets at rest — plaintext for v1, with one owner and one trigger

- **Status:** Accepted
- **Date:** 2026-08-16

### Context

Four credential columns are written to Postgres in the clear:

| Column                                   | What it is                                   | Recorded in |
| ---------------------------------------- | -------------------------------------------- | ----------- |
| `signing_connectors.private_key`         | The RSA private key that signs DocuSign JWTs | TECH-013    |
| `signing_connectors.webhook_secret`      | The DocuSign Connect HMAC secret             | TECH-013    |
| `org_settings.smtp_url`                  | The SMTP relay URL, credentials inline       | TECH-011    |
| better-auth's `sso_provider` OIDC config | The IdP client secret                        | TECH-008    |

All four are runtime organisation configuration, not deployment environment. An Administrator pastes them into Settings and every use reads them live, so they have to be stored somewhere the application can read on its own. Postgres is that somewhere.

Three schema comments already defer encryption to "a future pass" — TECH-008's SSO note, TECH-011's SMTP note, and the `signing_connectors` table header. None of them names an owner and none names a trigger, so the same deferral has now been written three times and scheduled zero times. An architecture review on 2026-08-16 raised it as a standing risk with nobody holding it. This record replaces the three loose notes with one decision.

### Decision

1. **v1 stores all four plaintext.** No encryption ships in v1. The three schema comments stay where they are; this record is the single place the posture is stated, and they point at it.
2. **The trigger is the production recommendation.** Encryption lands before OpenLaw is recommended for production use. The project is pre-alpha today, and it does not stop being pre-alpha with these columns in the clear.
3. **The open work is issue #259**, which carries the question this decision does not answer: where the encryption key lives, given that a key sitting in the same database backup as the data protects nothing.

### Rationale

- **Name the exposure exactly.** Anyone holding a database backup holds the DocuSign RSA private key. With it they mint their own JWT assertions and act as the install's integration user — they can send, void, and read envelopes as OpenLaw, on the organisation's real DocuSign account. The same backup holds the Connect HMAC secret, so they can also forge webhook deliveries and drive a Contract to a signed Stage for a signature that never happened. The SMTP relay URL lets them send mail as the organisation. The OIDC client secret is half of an SSO client credential. A backup file is a lower bar than a live database, and backups get copied to laptops. This is the reason the trigger exists, and it should not be read as a small residual risk.
- **Encryption without key management is theatre.** The cheap version of this change — a key in an environment variable, read at boot — moves the secret from one file the deployer backs up to another file the deployer backs up. It would let us delete the schema comments while changing almost nothing about who can read the key. Issue #259 exists because the key-management answer is the hard half, and shipping the easy half first would remove the pressure to finish.
- **The under-an-hour install constraint is real.** PRODUCT.md's success criterion is a self-host from a clean Linux VM in under an hour, by a non-specialist sysadmin. Any answer here adds a key the deployer must generate, store outside the backup, and be able to rotate without locking themselves out of their own integration. That is a deploy-docs problem as much as a code problem, and it is worth doing once, properly.
- **The deferral was already the decision — it was just never written as one.** Three schema comments saying "future pass" are three descriptions of the same accepted trade-off. Writing it down changes nothing in the code and everything about whether it can be forgotten.

### Alternatives considered

- **Encrypt now, key in the environment.** Rejected for the theatre reason above. It is the likely shape of the eventual answer, but only alongside a key-handling story in the deploy docs, and that is #259's job.
- **Move the four back to environment variables.** Rejected: TECH-011 and CTR-013 deliberately made these runtime configuration so a rotation applies to the next send with no restart, and so an Administrator can do it without shell access. Undoing that to avoid a database write would trade a real usability property for a marginal security one — the deployer's `.env` is backed up too.
- **`pgcrypto` column encryption.** Rejected for the same reason: the passphrase has to reach the query, so it lands in the environment or in the database, and we are back where we started with more moving parts.
- **Leave the three schema comments as the record.** Rejected: that is the state this decision exists to end. A comment on a column is read by whoever edits that column, which is exactly the person who is not deciding project-wide security posture.

### Consequences

- No code changes. The four columns keep their current types and their current comments.
- Issue #259 is the single tracking item, and it blocks any change of the README's `pre-alpha` status line to something that invites production use.
- A fifth credential column added before #259 closes joins this record's table rather than growing a fourth "future pass" comment.
- Whoever closes #259 supersedes this record rather than deleting it, and the deploy docs gain a key-handling section in the same change.

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
| TECH-020 | Problem `type` URIs — a refusal names itself only when a client acts on it    | Accepted             |
| TECH-021 | Secrets at rest — plaintext for v1, with one owner and one trigger            | Accepted             |
