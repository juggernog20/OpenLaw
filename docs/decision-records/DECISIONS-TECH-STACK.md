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
- **shadcn/ui** as the component library — copied into `components/ui/` as owned source code, not consumed as a dependency. Updated by re-copying or by manual diff application against upstream. _(2026-08-28, high-level review: the wrappers in `components/ui/` have since diverged from upstream. They keep shadcn's shape, `cva` variants, `cn`, Radix underneath, but are restyled on our tokens and trimmed to what the app uses. There is no `components.json` and no re-copy path; an upstream fix is read and applied by hand. Shell components may import Radix directly, as this record already allows.)_
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

### Addendum (2026-08-21, [#390](https://github.com/juggernog20/OpenLaw/issues/390)) — a primary key is a UUIDv7 **value** in a `text` column, and stays one

The decision above says "UUID v7 primary keys confirmed" and stops there. What shipped is a UUIDv7 value stored in a `text` column: `uuidPk()` in `packages/db/src/schema/helpers.ts` is `text("id").primaryKey()` with a `uuidv7()` default, and every table in `packages/db/src/schema` takes it. That is the decision, not a shortcut somebody took on the first table and nobody revisited.

**What the value is, is unchanged.** The keys are UUIDv7: canonical 36-character form, time-ordered, so the sort property TECH-004 bought is the value's and the column type never had it to give. Nothing about ordering, generation, or the `created_at`-free keyset cursor (CTR-024) depends on the storage type.

**What the native `uuid` type would buy.** Sixteen bytes per key instead of thirty-six, a narrower index, and a parse the database does rather than trusts. Real, and at this product's scale unobservable: DD-002 sizes the install at a 2–10 person legal team, so the widest table holds tens of thousands of rows on a machine that is not index-bound.

**Why the conversion is declined.** It is an unattended rewrite of every `id` column the schema declares — 31 tables take `uuidPk()` today — and of every foreign key that points at one, across all 46 tables. It runs on somebody else's data, from `compose up` (TECH-005), with no operator watching. The upgrade story is the promise this product is built on, and a whole-schema type change is the single migration most able to break it. The trade is a measurable risk to every existing install against a benefit nobody on one can measure.

**When to reopen.** A deployment that is demonstrably index-bound on key width, or a Postgres feature the schema wants that requires the native type. Neither exists. Until one does, `text` is the answer, and a new table takes `uuidPk()` like every other.

This closes the API-and-domain-core review's close call CC-1.

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

### Addendum (2026-08-21, [#390](https://github.com/juggernog20/OpenLaw/issues/390)) — a migration does not always start inside a transaction

**A migration file inherits whatever transaction state the file before it left behind. If it needs to be all-or-nothing, it must open its own transaction rather than assume one.**

The runner is drizzle-orm's `migrate()`, called on container start (TECH-005) — drizzle-kit only generates the files. It runs the pending files in order inside **one transaction around the whole batch**, not one per file: normally a statement that fails rolls back everything the batch had applied — statements and journal rows together — and the upgrade stops with the previous release's schema intact, which is the safe failure.

One thing ends that transaction mid-batch: a bare `COMMIT;` inside a migration file. The first two were one-offs, both deliberate:

- `packages/db/migrations/0054_reminder_dedup_entity_type.sql` opens with one, because its `CREATE INDEX CONCURRENTLY` statements cannot run inside a transaction block at all — Postgres refuses the statement rather than the transaction, so the file has to end the transaction first.
- `packages/db/migrations/0060_account_issuer.sql` ends with the one that closes its own `BEGIN` (below).

Every file on the two-line pattern below adds another — `0064`–`0066` were the first to follow it ([#391](https://github.com/juggernog20/OpenLaw/issues/391)), and each ends with the `COMMIT` that closes its own `BEGIN`.

After any of these files, the session is in **autocommit**, and **every later file in that batch arrives that way**. In autocommit every statement commits as it runs, so a file with an `ALTER TABLE` followed by a guard that raises leaves the `ALTER` applied and nothing else done — and the re-run after the fix dies on the duplicate column instead of resuming.

The fix is two lines at the head of any migration that must be atomic:

```sql
COMMIT;--> statement-breakpoint
BEGIN;--> statement-breakpoint
```

The `COMMIT` closes whatever is open — the batch transaction, carrying every earlier pending file's statements and journal rows, all of them complete files that are safe to make durable early — or nothing at all, which Postgres answers with a warning rather than an error. The `BEGIN` then makes the file one transaction on **every** upgrade path, whether the batch reached it inside the runner's transaction or in autocommit after crossing `0054` or any self-transactioned file on the way.

This is worth the two lines whenever a file has more than one statement that must not land alone: a backfill beside its column, a guard that can refuse, or a constraint added after the data is fixed up to satisfy it. A lone `ALTER TABLE ADD COLUMN` is atomic by itself and needs nothing.

`0060_account_issuer.sql` is the worked example and carries the argument in its own comments. The `database` agent skill repeats this rule where a migration author will be standing.

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

### Addendum (2026-08-18) — settled in M18/1: the first queue that leaves the building

The immediate notification email (NOT-002 group 1) is the pipeline's fifth queue, and it is the first one whose product is a message to a person rather than a row or a blob. It takes a queue of its own on the M12/4 line — **what a job produces, not what it reads** — and it is the clearest case of it so far: nothing else in the pipeline hands anything to a third party's relay.

**Its bounds are its own, and they are short.** Two minutes per attempt, because the work is one send whose transport already bounds its own sockets at tens of seconds, and because somebody has been asked to do something and is waiting to hear. Three attempts on the ladder every other queue uses — half a minute, then a minute — because the failure a retry heals here is the familiar one: a relay that was unreachable for a moment.

**The terminal-or-transient question has a new terminal answer: an install with no relay.** No retry configures SMTP, so three attempts would write the same line three times and settle the row anyway. It records the skip on the row and reports `unconfigured` in as many words, which is TECH-011's posture — a missing relay degrades one channel and hides nothing — said on the one path that has no request to answer it in. A recipient who no longer reaches the record is terminal for the same reason, and everything else stays transient.

**Two dependencies join `PipelineHandlers`**: the mailer resolver and `BASE_URL`. The resolver is the API's own, per send (TECH-011), so a relay saved in the wizard reaches the very next notification email with no restart of either process; the base URL is what lets the message deep-link to the record it is about. The worker reads both from the same variables the API reads, because a worker that linked somewhere else would send mail nobody could act on.

**The row is the record of the work owed, and the queue is only the wake-up** — M12/3's sentence, unchanged, applied to mail. `email_owed` is written in the mutation's own transaction, so a send lost between the commit and the wake-up leaves a row that says an email is still due, and the scheduled round the dates slice brings re-asks from those rows.

**What it costs is a fifth queue and a fifth set of bounds**, and the cost is real: every queue is a declaration at boot, a worker registration, and one more number an operator may have to reason about. The M12/4 rule takes that cost deliberately, on the ground that shared bounds are worse — an install that wants a longer conversion ceiling must not thereby give every notification email fifteen minutes to send.

**Alternatives considered.** _A branch inside an existing queue_ — cheapest, and it would put a relay's fifteen-minute lease beside a document conversion's, which is the exact drift the M12/4 line exists to prevent. _One job per event rather than one per notification_ — it would fan out again at send time, making the audience decision twice, in a place where the wall is harder to apply and the second answer could differ from the first. _No queue at all: send inside the request_ — it is what the invite and magic-link paths do, and it does not survive a group apply that asks fifty people, because the response would then wait on fifty relay round trips. _An outbox table of our own beside the notification row_ — a second record of the same debt, when `email_owed` on the row already is one.

### Addendum (2026-08-18) — settled in M18/6: the third scheduled queue, and the first one that is a clock

The morning round (NOT-003, NOT-004) is the pipeline's sixth queue and its **third** cron, joining the backfill sweep and the reconciliation sweep. It settles nothing new about what makes a queue — the M12/4 line answered that, and this is different work with a different product again — but it is the first scheduled job whose reason for repeating is not "ask somebody the same question again".

**The other two sweeps repeat to recover. This one repeats because it is the clock.** The backfill sweep asks the derivation rows what is still owed; the reconciliation sweep asks a provider where an envelope stands. Both would be correct run once, and repeat only because the answer can change. The morning round exists **because** time passes: a date arriving is nobody's act, so if nothing runs on a schedule, nothing ever fires. That is why it is the one scheduled job this system could not have been built without.

**#277's boot-versus-schedule rule applies at its strongest here.** It repeats, so it is cron and `singleton` — and unlike the reconciliation round, a second replica's round would not merely duplicate requests. It sends a person a briefing, and NOT-003 promises exactly one of those a day. Two rounds racing on one person is a user-visible defect rather than a rate-limit one, which is why the queue policy is load-bearing rather than tidy.

**The cron is hourly and the work is daily**, which is the one thing about it that looks wrong and is not. A person is served at 08:00 **in their own zone** (NOT-003's addendum), and a daily tick could only ever be 08:00 in one of them. So the round ticks every hour and each tick serves whoever has reached their morning. On an install whose people are all in one zone, twenty-three of every twenty-four rounds write nothing — three small queries and a return — which is the cost of the schedule being about the reader's clock rather than the server's.

**It is never retried, for the other two sweeps' reason.** A round that failed part way through wrote some reminders and sent some briefings, and the rows say what the rest is: `email_owed` with nothing recorded against it. The next tick picks it up, and a retry would only bring the same failure forward an hour early.

**It also closes the loop M18/1 left open.** The immediate-email queue's addendum above ends "the scheduled round the dates slice brings re-asks from those rows", and this is that round: past a fifteen-minute age bound it asks the queue again for every immediate email still owed and unsent. That bound is chosen against the immediate queue's own numbers — three attempts over about ninety seconds, two-minute expiry — so nothing still in flight is asked for twice, and the `short` policy collapses it if the timing is ever unlucky. This is what makes the Notifier's quietly-failing queue ask a delay rather than a lost message, which is the property the whole M12 doctrine was for.

**Alternatives considered.** _A daily cron at 08:00 UTC_ — one tick instead of twenty-four, and it serves one timezone's morning and everybody else's afternoon or small hours, which is the promise NOT-003 makes in as many words. _A per-user scheduled job_ — pg-boss can hold thousands of schedules, and it makes a person's timezone a thing that has to be re-registered on every profile save; the round reads the column live instead. _A `last_digest_sent_on` column on `users`_ — a second record of a fact `emailed_at` on the reminder rows already carries, and one that would go stale the first time a briefing failed after the column was written.

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
- **SSO client secret at rest.** The sso plugin stores the OIDC client secret inside the provider row's config JSON. v1 accepts DB-at-rest storage (single-tenant, self-hosted, the DB already holds privileged material); **flagged for a future secrets-encryption pass** — deliberate, not accidental. _(2026-08-16, M15/1: the DocuSign RSA private key and the Connect HMAC secret in `signing_connectors` are the **second entry** on that same pass, under the same accepted posture — see CTR-013's M15 addendum.)_ _(2026-08-16, #259: **superseded by TECH-022** — the pass happened. `sso_providers.oidc_config` is sealed whole with `encryptedText`, so the sso plugin's own Drizzle queries seal and open it too.)_
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

The SET-004 wizard surface this decision named (deferred at M2, where env vars carried SMTP alone) shipped: the wizard's email step saves a relay URL + from-address to the `org_settings` singleton, mirroring the `SMTP_URL`/`SMTP_FROM` shape — one mental model, two carriers. The mailer is resolved at send time, env-else-database (the TECH-014 read-on-every-decision pattern), so a save applies to the very next send with no restart. **Precedence: environment wins.** A set `SMTP_URL` pins the instance — database values are ignored entirely and saves are refused. This is a safety property, not a convenience: the dev/E2E overlay pins Mailpit via env, and a database-saved real relay must never beat it, or test mail leaks to real inboxes. The relay URL is write-only through the API (it embeds the credential) and stored plaintext for v1 — at-rest encryption is a flagged follow-up shared with the TECH-008 SSO client secret. _(2026-08-16, #259: **superseded by TECH-022** — `org_settings.smtp_url` is now sealed at rest with the rest of them. Nothing else about the resolution changes: the environment still wins, and a save still applies to the next send.)_

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
- **Search** — confirms DOC-009: **Postgres FTS** (tsvector columns + GIN; ~~indexing jobs on pg-boss~~ _superseded 2026-08-27 by the M25/2 addendum below: stored generated columns, no indexing job_); dedicated engine only if relevance/scale ever demands it.

### Consequences

Repo scaffold order: monorepo shell → Fastify + OpenAPI → auth (brings `packages/db` and its first tables) → Compose. _Revised 2026-08-08: there is no up-front "drizzle schema from SCHEMA.md" phase — the schema grows incrementally; tables land in the same change as the feature that reads and writes them, each with its own drizzle-kit migration, with SCHEMA.md as the naming/relationship reference._ The build phasing itself (which module first — CLM per PRODUCT.md) is unchanged.

### Addendum (2026-08-28, high-level review) — what the web test layer is

The Testing bullet names the tools. This names the rules the web tests actually follow, which until now lived in `apps/web/src/testing/helpers.tsx` and a `vite.config.ts` comment.

- **The unit of web testing is the route.** A test mounts the real route table through `createMemoryRouter` at a path and drives it with user gestures. Route tests are React Testing Library used as intended: what the user sees, not component internals. A component gets its own test when it carries its own state machine or a DES-010 keyboard contract (the date picker, the bell, the shell pieces).
- **The API seam is a stub, not a proxy.** A global `fetch` stub answers per call and fails loudly on an unstubbed request. Stub payloads import wire constants from `@openlaw/shared` (the TECH-020 #812 rule), and a new fixture is typed with `satisfies` against the generated response type from `@openlaw/api-client` so a literal that no longer matches the schema fails `tsc`. Existing fixtures migrate when touched. MSW was considered and declined: a second matching language for the agents, for no gain over the 40-line stub.
- **Playwright proves what only the built image can.** One demo spec per milestone, run against the Compose images and a real Postgres, serial, one worker. The demo specs are the milestone acceptance record and are not trimmed.
- **Budgets.** 20 s per route test on CI (a shared runner is several times slower than a laptop; the bound catches hangs, not slowness). A test file that passes 3,000 lines is split along its sections; `contract-record.test.tsx` is the example of what happens without the rule.

### Addendum (2026-08-27, M25/2, [#532](https://github.com/juggernog20/OpenLaw/issues/532)) — generated search columns replace the indexing queue

The Search bullet above is revised in one respect: **there is no pg-boss search-indexing job**. Each searchable table declares a stored generated `tsvector` column in Drizzle, and PostgreSQL recomputes it in the same write that changes its source columns. The extraction and backfill jobs already write `document_version_text`; that write is therefore the complete indexing path for extracted text. A title edit and a completed extraction cannot commit while leaving their vectors stale, and there is no queue state to reconcile.

Migration `0080_calm_cloak` adds all seven generated columns and their GIN indexes in one batch. The `ALTER TABLE` statements compute existing rows in place. Plain `CREATE INDEX` is deliberate: the blessed upgrade runs before the API starts, so nothing needs `CONCURRENTLY`, and the migration keeps the runner's surrounding transaction rather than using the `COMMIT; BEGIN;` preamble. `pg_trgm` remains deferred; M25 adds no extension dependency.

### Addendum (2026-08-21, [#391](https://github.com/juggernog20/OpenLaw/issues/391)) — one version, checked rather than generated

The product's version is written down ten times: in the root `package.json`, in each of the eight workspace members', and once more as `OPENLAW_VERSION` in `packages/shared/src/index.ts` — the constant `GET /api/v1/meta` answers and the OpenAPI document carries. Nothing kept them in step, so a release bump that missed one would ship an install reporting a version it is not. The API review offered the fork: generate the constant, or check it.

**It is checked.** `pnpm lint:versions` reads the root `package.json` as the source of truth and fails when any of the other nine places disagrees, naming each one. It runs inside `pnpm check`, which is what CI runs — a real gate, on the `lint:migrations` and `lint:contrast` precedent, not a comment asking somebody to remember.

Generating it was declined for two concrete reasons rather than on taste. `@openlaw/shared` is bundled into the browser, so the value has to be a literal in the source rather than a file read at runtime; and that package's tsconfig sets `rootDir: "src"`, so importing its own `package.json` would move the whole build's output layout. What is left of "generate" is a generated file that is **committed** — and a committed generated file needs a CI check that it is current anyway (the `openapi-current` job is exactly that shape). That is the check below plus a build step, so the build step is the part that was dropped.

The script reads the workspace members from `pnpm-workspace.yaml` rather than listing them, so a package added later is checked without anybody remembering to.

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

**Zod (v4)** via `fastify-type-provider-zod`: every route declares request/response schemas in Zod; the same definitions drive validation, inference, and the OpenAPI 3.1 document (`@fastify/swagger`). Schemas shared with the SPA (form validation, shared types) **will** live in `packages/shared`. _(2026-08-21, [#390](https://github.com/juggernog20/OpenLaw/issues/390): that clause is a destination, not a description. No Zod schema lives in `packages/shared` today. What the package holds is the wire vocabulary both ends must agree on — problem-type strings, bound constants, action slugs, sort keys — and the web app validates its forms in the field controls rather than against a schema. The sentence is written in the future tense because the first shared schema arrives with web form validation, and until then a reader would otherwise go looking for schemas that are not there.)_ _(2026-08-28, high-level review: that forecast is withdrawn. Fifty-seven forms later, no web form validates against a schema, and M31 reads the same `AttachedCustomField` rows the API already validates in `apps/api/src/lib/custom-fields.ts`. The API is the only validator. A shared schema lands only when a second consumer of one exists.)_

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

### Addendum (2026-08-21, [#390](https://github.com/juggernog20/OpenLaw/issues/390)) — security response headers, and where rate limiting lives

The BYO-proxy decision left one thing unsaid, and it has been unsaid through fifteen milestones: **who sets the security response headers.** This records the posture so nobody has to infer it from the absence of `helmet` in `package.json`.

**1. The app sets the headers that are about its own responses, and only those.** Two are set today and both are per route rather than global, because both are about the bytes that route returns:

- `x-content-type-options: nosniff` on every document, rendition, and request-attachment download. A browser that sniffs an uploaded file into something executable is the attack; the route knows it is streaming somebody else's upload, so the route says so.
- `content-security-policy: default-src 'none'; sandbox` on the inline-render routes. An uploaded HTML or SVG rendered in a frame is the attack, and this is the narrowest policy that stops it.

Those stay in the routes. A global header cannot know which responses are somebody else's bytes.

**2. The deployer's reverse proxy owns the origin-wide headers.** `Strict-Transport-Security`, `X-Frame-Options` / `frame-ancestors`, `Referrer-Policy`, and a page-level CSP for the SPA are the proxy's, added to the contract in `docs/DEPLOYMENT.md`. HSTS is the clearest case: it is a claim about TLS, the app has no TLS, and an app that asserts HSTS on a plain-HTTP port is asserting something it cannot know. The others follow the same rule — they are properties of the public origin, which is the thing the deployer configured and the app was told about only as a `BASE_URL` string.

**3. `@fastify/helmet` is declined, and this is the reason.** Helmet's value is a sensible default for an app that is its own origin. This app is not: it is one upstream behind an ingress the deployer already runs, and every org in TECH-008's audience has one. Adding helmet would put a second, weaker copy of the same headers behind the proxy's, and the two would disagree the moment a deployer tuned theirs — with the app's copy winning or losing depending on the proxy's merge behavior, which is not something we can pin from here. A page-level CSP tight enough to be worth having also needs to know the origin's assets, and Vite's hashed bundle means it would be generated or permissive; permissive is the version that ships and then reads as protection.

**4. Rate limiting is the proxy's too, with one exception that is already ours.** Sign-in has an in-app limiter (better-auth's, TECH-018's `AUTH_RATE_LIMIT=off` overlay switch) because it protects a credential rather than a resource, and the counter has to be the one the auth layer itself keeps. Everything else — the portal's open write addresses above all (INT-002's M20 addenda, parked in `FUTURE-FEATURES.md`) — is a bytes-and-requests bound whose right numbers depend on the instance, and whose right enforcement point is in front of the app. `docs/DEPLOYMENT.md`'s proxy contract now says so, rather than covering TLS and `Origin` and going quiet on limits.

**When to reopen.** A deployment topology with no proxy in front of it — which TECH-017 does not bless and the docs do not describe — or a managed offering, which DD-009 and TECH-005 both put outside v1.

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

### Addendum (2026-08-16, [#260](https://github.com/juggernog20/OpenLaw/issues/260)) — fidelity also means the second install

This decision made the gate run against **built images** rather than a dev server, because "works with Vite / breaks in the container" is the drift that reaches a self-hoster. There is a second drift with the same shape and it was not covered: every job in CI started from an **empty database**, so the _first_ install was tested on every commit and the _second_ was never tested at all.

**Self-hosting is not a one-time act.** The install runs, fills with real Contracts and Documents, and then a new version arrives. That path is the one thing shipped and never exercised — and a migration that passes against an empty table can still fail against one with rows: a NOT NULL column with no default, a unique index over data that already holds duplicates, a backfill that assumes a shape the old rows do not have. None of those appear against an empty database, so the install that finds them belongs to somebody else, at their 2am, on their contracts.

**The gate is a third job in `ci.yml`.** It fills a baseline install through the public API, stops it **keeping the volumes**, brings this commit up against the same database and files, and checks every seeded record still reads back. The volumes are the install: `down -v` there would test nothing.

**The seed writes through the API and never through SQL.** A seed that inserted rows the application would never insert proves nothing about the application, and it would drift from the real write paths the first time a route changed what it stores.

**What is compared is named facts, not whole responses.** A release is allowed to add a field to a response — that is not an upgrade failure, and a deep equality check would report it as one. The fingerprint records what must survive: contract numbers, titles, stages and custom field values; a document version's SHA-256 and byte count, checked against the bytes the store hands back; a user's role; whether the signing connector still holds credentials.

**The baseline is the newest release tag, and `dev` until one exists.** The project has no releases yet, so the job upgrades from trunk and says so in its own output. `main` is never the baseline — it is vestigial here.

**One constraint the seed carries forever:** it is the current commit's script talking to the _previous_ release's server, so it may only use API surface the baseline already has. Anything added in the change under test is verified after the upgrade, never during the seed.

**Matters are absent from the seed because they do not exist.** The install has matter types and no matter records. The seed grows one the day the product does — which is the maintenance cost this job takes on deliberately: the seed has to keep pace with what an install can hold, and it gets more expensive with every milestone that adds a table.

### Addendum (2026-08-18, [#323](https://github.com/juggernog20/OpenLaw/issues/323)) — a scheduled round needs a door, and the overlay's outbound side belongs to both processes

The M18 demo is the first acceptance journey whose subject is **a job nobody starts**. Every gate before it was reached by a request: an upload asks for a derivation, a webhook reports an ending, a person presses a button. The morning round is a pg-boss cron on the hour (NOT-003), so a browser suite driving the built images has nothing to press and no hour to spend waiting for the next tick.

**The overlay mounts one route, and it takes no parameters.** `MORNING_ROUND_TRIGGER=on` — set only in `compose.dev.yml`, warned about at boot, and absent from `.env.example` — mounts `POST /api/v1/notifications/morning-round`. That is the `AUTH_RATE_LIMIT=off` shape rather than the two-variable signing shape, and the asymmetry rests on the consequence, as the signing addendum's does: a mis-set relay sends an invitation to the wrong catcher, a mis-set signing host puts a contract in front of a stranger, and a mis-set round trigger lets an Administrator send this morning's briefings this morning. The route is **Administrator-only** even under the overlay, it is hidden from the OpenAPI document, and it is registered rather than guarded from inside — so an install that never set the variable answers the ordinary unknown-path 404 and admits nothing.

**What makes it a door rather than a back door is that it carries no clock.** The round already takes `now` as a parameter, and exposing it would have been the obvious thing; it is deliberately not exposed. The route runs the same round the cron runs, on the real clock, with the real notifier, the real mailer resolver, and the real queue, and every gate still decides for itself: whose morning it is, which dates sit at an offset, whether a briefing has already gone today, and the dedup identity that makes a second round a no-op. **The suite makes the round fire by arranging the world**, exactly as an install does by waiting until tomorrow — the reader is put in a timezone whose morning has arrived, and the dates are set against that person's own civil date. Nothing about the round is weakened to make the gate pass, which is the property this decision exists to protect: what runs in the demo is the production path.

**And the overlay's outbound side is one anchor on both processes now.** The M15/7 addendum stated the rule for signing — the app and the worker both resolve a provider, so a variable set on one and forgotten on the other is a send that works and a signed PDF that never lands. Mail had been the app's alone since M2, because the app was the only process that sent any. M18 changed that: the worker sends every notification email and every morning digest. `SMTP_URL` and `SMTP_FROM` had stayed in the app's own block, so the worker resolved an **unconfigured** mailer and recorded every message as skipped — a bell that rang and an inbox that stayed empty, on a stack whose whole purpose is to prove otherwise. They join `x-openlaw-dev-outbound`, and the rule generalizes: **every outbound address this overlay pins belongs to both processes**, because either of them may be the one that reaches out. A real install was never affected — `compose.yml` passes `.env` to both — which is exactly why only a demo that sent mail from the worker could find it.

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

### Addendum (2026-08-21, [#391](https://github.com/juggernog20/OpenLaw/issues/391)) — where a test writes a problem type out, and where it imports one

The consequence above rejects a mirrored copy of a type **in production code**, because two copies that drifted would not fail loudly. Tests were left unsaid, and the suites had drifted into doing both without a rule. This is the rule.

**A test that authors the value imports it. A test that reads the value off the wire writes it out.**

The web route tests stub the seam: the test writes the problem payload the record then branches on. There the literal is a second copy of a shared constant with nothing checking it against the first, and a renamed URN leaves a fixture asserting a string the product no longer uses. Those import from `@openlaw/shared` — four sites, in the contract record's soft-gate, relations, renewal, and envelope suites.

The API integration suites and the E2E spec assert a type on a response the server produced. There the literal is the tripwire that makes decision point 4 above real: **changing a `type` is a breaking change**, and a change nothing goes red for is not being treated as one. Six sites keep their literals for that reason, and each now says so in place — `20-m14-demo.spec.ts` argued it first, and this addendum makes its local reasoning the general rule.

Nothing is left green asserting a URN that no longer exists: after a rename the wire suites fail and the stub suites pass, which is the correct answer from each.

## TECH-021: Secrets at rest — plaintext for v1, with one owner and one trigger

- **Status:** Superseded by TECH-022
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

## TECH-022: Credentials at rest — sealed columns, one required key, outside the database

- **Status:** Accepted
- **Date:** 2026-08-16
- **Supersedes:** TECH-021

### Context

TECH-021 recorded that four credential columns were stored in the clear, named the exposure, and put the open question in issue #259: **where does the encryption key come from**, given that a key sitting in the same database backup as the data protects nothing. It also refused the cheap answer in advance — "encrypt now, key in the environment" — as theatre unless a key-handling story shipped with it.

The four are `signing_connectors.private_key`, `signing_connectors.webhook_secret`, `org_settings.smtp_url`, and the OIDC client secret inside better-auth's `sso_providers.oidc_config`. All four are runtime organisation configuration an Administrator pastes into Settings, so the application has to be able to read them on its own.

Three key sources were on the table: a required environment variable, a key derived from an existing secret, and a key file on disk beside the compose stack.

### Decision

1. **A new required setting, `OPENLAW_SECRET_KEY`**, read at boot by the app and the worker. Both refuse to start without it, and the refusal names `openssl rand -base64 32`.
2. **The columns are sealed by the schema, not by callers.** Each is declared with `encryptedText` — a Drizzle custom type that seals on the way to Postgres and opens on the way back. The DDL is unchanged (`text`), so this is not a migration, and no route, job, or resolver below the schema can forget to do it. better-auth reads `sso_providers` through our Drizzle tables, so its own queries are sealed too.
3. **AES-256-GCM, with the column name as additional authenticated data.** A sealed value reads `openlaw:v1:<base64>`. The prefix is what lets the same code read a plaintext value written by an older version, and gives a later cipher change somewhere to live.
4. **A boot pass brings stored values under the key in use.** It runs in the API, beside the migrations and under an advisory lock, because a SQL migration is run by Postgres and Postgres has neither the key nor the cipher. It covers both the upgrade (plaintext in, sealed out) and the rotation.
5. **A rotation is `OPENLAW_SECRET_KEY_PREVIOUS` and one restart.** The retiring key is accepted for reads only; the boot pass rewrites everything under the new key; the deployer then removes the variable. Nothing is retyped.
6. **A value no configured key opens reads as "not set", and is left in place.** It does not throw.
7. **`docs/DEPLOYMENT.md` carries the key-handling section**, and it is part of this decision rather than a note about it: how to generate the key, that it must not share an archive with the database dump, how to rotate it, and what losing it costs.

### Rationale

- **The key has to be outside the thing it protects, and the environment is the only place that is by default.** A key file beside the compose stack is a second artefact to back up, and the natural mistake is to back it up _into_ the same archive as the dump — which is the exact failure this exists to prevent, with an extra file to lose. Deriving the key from `AUTH_SECRET` welds two rotations together: rotating the session secret, which self-hosters do, would silently destroy every stored credential.
- **The theatre objection is answered by the deploy docs, not by the code.** TECH-021 is right that an environment variable moves the secret from one file the deployer backs up to another. What makes it real is telling the deployer, in the place they are already reading, that the backup job must not capture both — and giving them a rotation they will actually run. That section is the feature; the cipher is the easy half.
- **Sealing at the schema is the only place a caller cannot forget.** Encrypt-here-decrypt-there scattered across routes is how a fifth call site ends up writing a plaintext value that reads back fine and shows up in the next dump. A custom type has one behaviour and no opt-out.
- **An unreadable value must read as absent, not throw.** The recovery from a lost key is "open Settings and paste it again", and a read that threw would fail the pane that recovery happens in. Every reader of these four columns already has an unconfigured path — the Settings pane shows the credential as absent, the mailer reports email unconfigured, the SSO update handler asks for the credentials to repair the row — so "not set" is a state the product already knows how to be in.
- **Not overwriting an unreadable value keeps a mistake recoverable.** A deployer who boots with the wrong key has made a fixable error; a boot pass that resealed the empty string they read as would make it permanent.
- **A rotation nobody can perform is not a rotation.** The two-variable, one-restart shape is the smallest thing that lets a self-hoster change this key without re-entering a DocuSign private key by hand, which is the step that would make them not do it.

### Alternatives considered

- **A key file on disk beside the compose stack.** Rejected: see the rationale. It needs no new variable, and it is the option most likely to end up inside the dump's archive.
- **Derive the key from `AUTH_SECRET`.** Rejected: it couples two rotations with very different cadences, and the coupling is silent and destructive.
- **`pgcrypto` column encryption.** Rejected, as in TECH-021: the passphrase still has to reach the query, so it lands in the environment or in the database, with more moving parts and SQL that cannot be read without it.
- **A SQL migration that encrypts the existing values.** Not possible — Postgres has no key. Hence the boot pass.
- **Encrypt only the two DocuSign secrets.** Rejected: the SMTP relay URL carries a password inline and the OIDC config carries a client secret. Three of four sealed is a table anyone reading the schema would assume is fully sealed.
- **Throw when a value cannot be opened.** Rejected: it breaks the pane the operator has to use to recover, and it turns a wrong key into an install that cannot serve Settings at all.

### Consequences

- `.env.example`, `compose.yml`, and the CI E2E job all set `OPENLAW_SECRET_KEY`; compose refuses to start without it, as it already does for `AUTH_SECRET`.
- The install gains one required step. `docs/DEPLOYMENT.md`'s quickstart sets both secrets in two lines.
- The E2E stack's persistent volumes need a stable key between runs, so it comes from `.env` like every other compose variable.
- A fifth credential column joins `SEALED_COLUMNS` in `packages/db/src/rewrap.ts` in the change that adds it — the list is what the boot pass walks, so an omission is a column that never gets resealed.
- The three schema comments deferring encryption are gone, because it happened.
- TECH-021 stays in this document, marked superseded. Its statement of the exposure is still the clearest one we have.

### Addendum (2026-08-21, [#387](https://github.com/juggernog20/OpenLaw/issues/387)) — two regimes, two keys

**This install encrypts credentials at rest under two keys, on purpose.** Columns an Administrator pastes into Settings are sealed by our schema under `OPENLAW_SECRET_KEY` — the four above. Columns better-auth owns end to end are encrypted by better-auth under `AUTH_SECRET`: the TOTP seed and backup codes it already sealed, and now `accounts.access_token` and `accounts.refresh_token`, which the `account.encryptOAuthTokens` flag turns on. `docs/DEPLOYMENT.md`'s `AUTH_SECRET` line already told this truth for the 2FA material; it holds for the OAuth tokens too.

The split follows the **recovery contract**, not the sensitivity. Consequence 6 above says an unopenable sealed value reads as "not set" and is left alone, because the recovery is "open Settings and paste it again". A per-user OIDC token cannot be re-pasted by anyone. Putting these two columns in `SEALED_COLUMNS` would therefore trade a real exposure for a worse failure: a boot under the wrong key would read every SSO user's tokens as unset and never say so. better-auth's own mechanism has no such pass — it seals on write, reads a pre-flag plaintext value straight through, and lets a later sign-in rewrite the row — so there is nothing to boot-migrate and nothing to blank. One residue rides along: the sign-in rewrite is certain for the access token, but better-auth keeps the stored refresh token when a token response carries no new one, so on an IdP that re-issues refresh tokens only at first consent, a pre-flag plaintext refresh token outlives the upgrade. Accepted — the sso plugin asks for `offline_access` on every exchange, so conformant IdPs do re-issue, and redeeming the token is still gated on the sealed client secret. `accounts.id_token` stays plaintext because better-auth writes it raw whatever the flag says; that is accepted, being expired identity evidence whose claims already sit plaintext on `users`.

**A fifth admin-pasted credential still joins `SEALED_COLUMNS`.** This addendum widens nothing about the rule above; it names the one category that sits outside it, so the next reader does not file a better-auth column in the wrong regime.

## TECH-023: Shared machinery grows named per-mount hooks — a third mount is configuration, not a copy

- **Status:** Accepted
- **Date:** 2026-08-20

### Context

Two factories carry every taxonomy in the product. `taxonomyRoutes` serves contract types, matter types, and entity types — add, rename, describe, reorder, archive with the SET-003 guard, restore, delete, and the DD-017 activity for each. `typeFieldRoutes` serves the per-type attachment of catalog fields on contract types and matter types. This is the #85 doctrine: one machinery, every type table, so a change to archive semantics is written once and lands everywhere.

M19 mounted a **third** taxonomy — request types — and it is the first mount that carries columns of its own: a target (INT-002), and a form definition whose attachable scopes depend on that target. M19's spec forecast **two** new factory parameters and said that needing more than two would be a signal worth recording.

It needed five. This decision records the real count and says when the count stops being acceptable.

### Decision

**The five extension points, named.**

1. **`protectedSlug`** on `taxonomyRoutes` — optional, and previously a hardcoded `other`. It names the system-protected fallback row that archive and hard delete refuse. Request types omit it: no record needs a non-null request type once conversion is done, so there is no fallback row and no row is locked.
2. **`extras`** (`TaxonomyExtras`) on `taxonomyRoutes` — the mount's own columns, in four parts that travel together: `rowSchema` (extra keys on the row, so they reach the list, the single-row response, and the OpenAPI document), `projectRow` (how they are read off the selected row), `patchSchema` (extra keys the **strict** PATCH body accepts), and `applyPatch` (a validator that runs inside the PATCH transaction under the row's `for update` lock, refuses with an RFC 9457 problem, and answers both the columns to write and what the `updated` activity should narrate).
3. **`loadContext`** on `TaxonomyExtras` — one batched read over exactly the rows about to be projected, for a column that cannot be read off the row. Request types count the fields on their form; reading that per row would be an N+1 behind one list.
4. **`scopeRule`** on `typeFieldRoutes` — one parameter in place of the former `attachableScopes` plus `scopeRefusal` pair, and now either a constant or **a function of the locked type row**. Contract types and matter types pass a constant, unchanged. Request types pass a function, because which catalog fields may attach follows the target.
5. **A generic row type on both factories** — the mount declares what its row is, and its own hooks read it without a cast at the call site.

**The rule an extension point has to pass.** It is admissible when all three hold:

- **It is named for what a mount carries, never for which mount it is.** `extras`, `scopeRule`, `protectedSlug` describe a shape. A branch on the mount's own path or noun is the tripwire, not a hook.
- **It is inert when omitted.** The three existing taxonomy mounts and the two existing attachment mounts pass nothing new and behave exactly as they did. A parameter that changes an existing mount's behaviour to make room for a new one is a rewrite wearing a config key.
- **It cannot loosen a guarantee the machinery makes.** The PATCH body stays strict — a key no mount declared is still refused rather than stripped, and a mount may not declare a machinery-owned column. A mount that tried is rejected when it is built, not when a request arrives.

**When the count stops being acceptable.** The next mount that needs a hook failing any of the three, or a hook whose only caller is one mount **and** whose body reads that mount's table, is the point at which the machinery is split rather than extended.

### Rationale

- **The forecast was wrong by more than double, and the honest number is the useful one.** Anyone reading "two parameters" would conclude the machinery absorbs a new mount almost free. It does not: a mount that carries columns of its own needs a way to project them, a way to accept them, a way to validate them under the lock, and a way to narrate them — that is one hook with four parts, and it is the bulk of the growth.
- **The doctrine held where it matters: nothing was copied.** Request types are a config object, not a fourth module with its own list, guard, reorder, and audit code. Every taxonomy behaviour the M19 API suite asserts is behaviour the machinery already had, which is why the request-types assertions transfer almost verbatim from the matter-types suite.
- **A hook shaped like the thing it extends stays readable.** `scopeRule` as a function of the locked row is the same idea as the constant it replaced, widened; a reader of the mount's config sees the rule without reading the factory. The alternative — one general "run this before the write" escape hatch — would have been a single parameter and would have made every mount's behaviour unreadable from its own configuration.
- **`protectedSlug` becoming optional is a correction, not a concession.** The lock has to follow the decision that a row is a fallback. Hardcoding `other` meant a mount inherited a protected row because of a name an Administrator happened to type.

### Alternatives considered

- **Copy the taxonomy module for request types.** Rejected: it is the thing #85 exists to prevent, and it would have put a fourth copy of the SET-003 archive guard and the DD-017 narration in the tree on the milestone right before the portal starts writing records against these tables.
- **One general `beforeWrite(ctx)` escape hatch.** Rejected: one parameter instead of five, at the cost of every mount's behaviour becoming invisible from its config and every guarantee — strict bodies above all — becoming a convention.
- **Leave `attachableScopes` and `scopeRefusal` as two parameters and add a third for the function form.** Rejected: the refusal line and the scopes are one rule, and a mount that could set the scopes without the refusal would produce a 400 with nothing to read.

### Consequences

- M22 widened the scope rule to `matter` with **no new hook** and opened the Matter catalog and record values. M27 repeats that extension for Entities.
- The three existing taxonomy mounts and both existing attachment mounts kept their configuration; the only change to them is that `protectedSlug` is now spelled where it was assumed.
- The five hooks are covered by the behaviour they produce at each mount, not by tests of the hooks themselves — no test asserts that a factory was configured a certain way.
- `applyPatch` has the most reach of the five: it runs under the row lock and can refuse. A second mount wanting it is fine; a third that needs it to do something other than validate-and-narrate is the split signal above.

## TECH-024: Web data and state model — loaders read, screens own what they show, live surfaces patch feeds

- **Status:** Accepted
- **Date:** 2026-08-28

### Context

TECH-003 chose Vite + React Router and a generated typed client, and stopped there. Twenty-five milestones later the web app has a data model that every screen follows and no record states. The 2026-08-28 high-level review found it in the code: 42 route files read through loaders, 685 `useState` hooks hold what the screens show, two files call `useRevalidator`, none use `useFetcher` or route actions, and `KeyedByParam` in `router.tsx` exists because a loader-seeded state went stale when the URL changed (#372). The review's prosecutors argued for a query cache or react-router actions. The skeptics won, narrowly, on one point: the recorded scope of M30's live surfaces (comments, activity, approvals, envelope events; the bell and Inbox counts) is append-only feeds and counters, which the current model handles in one line each. What was missing was the record, so that the next screen follows the rule on purpose.

This record describes the model as built and names the places where a different rule now applies. It does not adopt a cache.

### Decision

**1. Loaders are the only place server data enters the tree.** A route's loader does the reads its screen needs, in parallel, and throws into `errorElement` on failure. A component does not fetch on mount what a loader could have read.

**2. A screen owns what it shows.** After a write, the screen updates its own copy from the mutation's response. `useState` seeded from loader data is the rule, not a smell. This is the model that keeps every read and write for a screen in one file, which is what makes the file legible to the agents that write most of it.

**3. Staleness is fixed by navigation, by `revalidate()`, or by a keyed remount.** Nothing is cached across routes. A screen that must re-read after its own write calls `useRevalidator`. A parameterised route wraps its screen in `KeyedByParam` so a new record is a fresh screen.

**4. Live surfaces (TECH-009, M30) patch append-only feeds and counters in place.** An event for a comment thread, an activity feed, an approval roster, or an envelope row appends to or replaces the row in the screen's own state. An event that would require re-reading a whole record is out of M30's scope; if one appears, it is `revalidate()` plus a sync effect, and the first such surface is where this record gets its next addendum.

**5. Session is read per navigation, in the loader, through `requireUser()`.** Every guarded loader calls it; it returns the user or throws a redirect to setup or login. Role gates stay in the loader beside the data they guard (SET-002's enforcement site). There is no root session loader and no `shouldRevalidate`: a revoked user or a changed role takes effect on the next click, which is the freshness a tool with no push channel owes its Administrators.

**6. Refusals are read through one helper.** `problemDetail()` and `problemType()` in `lib/messages.ts` today; one `problem.ts` helper that also distinguishes network failure before M31 (#550). Most refusals are printed; the few a client branches on carry a TECH-020 type.

**7. Record pages share viewer facts through a context, not props.** A record page provides `RecordContext` (viewer id, role, whether the record is frozen, the record header) and its section cards read it. Sections take domain props only.

**8. Component budget.** A `.tsx` file over 800 lines, or a component with more than a dozen `useState` hooks, is split at its next substantive change. A DES-032 section lives in its own file. The two record pages that predate this rule are the first targets, one section per PR, not a sweep.

**9. One bundle, no code splitting.** The staff app and the portal ship as one Vite bundle (about 310 KB gzipped, served `immutable` for a year). The portal shares most of its heavy dependencies with the staff app, so a split would save one second on a rare first load and add a stale-chunk failure mode on every boundary. Revisit at M33, or the first time a Business User on cellular is observed waiting. The three on-demand previews stay lazy and sit behind a boundary that asks for a reload when their chunk is gone after an upgrade.

### Rationale

- The simplest model an agent can read is one where a screen's reads and writes are in one file. A cache moves the write path into an invalidation vocabulary that is non-local and silent when wrong.
- Adopting a cache now would leave two data models coexisting for many milestones. That is worse than either model alone.
- M30's recorded scope fits rule 4. The record is cheap; the migration was not.

### Alternatives considered

- **TanStack Query with loaders as prefetch.** Rejected for now: a second concept (query keys) in a codebase whose stated virtue is that a self-hoster can reason about it, and a half-migrated tree for years. Revisit if a live surface needs cross-route invalidation.
- **react-router actions and `useFetcher` for every mutation.** Rejected: the record page has dozens of typed JSON mutations; `useFetcher` wants forms, and actions are one per route.
- **A root layout route with one session loader.** Rejected: the four top-level trees (`/`, `/welcome`, `/portal`, `/auth`) have different session needs, and `shouldRevalidate` would make the session stale until reload.

### Consequences

- `requireUser()` and `useSignOut()` in `lib/session.ts` replace the 34 and 16 copies of those idioms.
- `RecordContext` lands on the contract and matter records.
- DES-032's "one loader reads the whole record" clause stands and is the data-loading half of rule 7; the strip's look stays in DES-032.
- Issues: #550 (refusal helper), #552 (`useFieldCommit`), #551 (web "third mount" doctrine, at M27), #554 (hook warnings).

## Index of decisions

| #        | Decision                                                                      | Status                 |
| -------- | ----------------------------------------------------------------------------- | ---------------------- |
| TECH-001 | Frontend stack — React + Tailwind CSS + shadcn/ui (copied) + Radix primitives | Accepted               |
| TECH-002 | Backend — TypeScript on Node LTS                                              | Accepted               |
| TECH-003 | Application shape — Fastify API + Vite React SPA (REST/OpenAPI)               | Accepted               |
| TECH-004 | Database — PostgreSQL only                                                    | Accepted               |
| TECH-005 | Deployment — Docker Compose as the blessed path                               | Accepted               |
| TECH-006 | ORM — Drizzle (+ drizzle-kit migrations)                                      | Accepted               |
| TECH-007 | Background jobs — pg-boss on Postgres                                         | Accepted               |
| TECH-008 | Authentication — onboarding-selectable: built-in basic or BYO IdP (OIDC)      | Accepted               |
| TECH-009 | Real-time — SSE on live surfaces                                              | Accepted               |
| TECH-010 | Document engines — one LibreOffice + OCR sidecar                              | Accepted               |
| TECH-011 | Email sending — SMTP first + provider adapter                                 | Accepted               |
| TECH-012 | AI providers — three protocol adapters, presets, custom option                | Accepted               |
| TECH-013 | DocuSign auth — JWT grant (service integration)                               | Accepted               |
| TECH-014 | DX housekeeping — repo, CI, testing, observability, telemetry, storage/search | Accepted               |
| TECH-015 | TypeScript 7 native compiler + TS 6 API shim for typescript-eslint            | Accepted (temporary)   |
| TECH-016 | API validation vocabulary — Zod as the single schema source                   | Accepted               |
| TECH-017 | Compose topology — single app container, BYO proxy, incremental growth        | Accepted               |
| TECH-018 | Deployment fidelity — hybrid dev loop, E2E gate on built images, `e2e/` pkg   | Accepted               |
| TECH-019 | Code documentation — module-granular doc comments, no coverage percentage     | Accepted               |
| TECH-020 | Problem `type` URIs — a refusal names itself only when a client acts on it    | Accepted               |
| TECH-021 | Secrets at rest — plaintext for v1, with one owner and one trigger            | Superseded by TECH-022 |
| TECH-022 | Credentials at rest — sealed columns, one required key, outside the database  | Accepted               |
| TECH-023 | Shared machinery grows named per-mount hooks — a third mount is configuration | Accepted               |
| TECH-024 | Web data and state model — loaders read, screens own what they show           | Accepted               |
