# OpenLaw — Implementation Plan

The build order for everything designed: four modules, intake, knowledge, settings, and the cross-cutting
capabilities. Read `docs/decision-records/PRODUCT.md` for _what_ we're building and why; this document is
only concerned with _in what order_.

This is a sequence, not a schedule. There are no dates and no estimates.

## How this plan is built

**A milestone is a demo.** Every milestone below is defined by one sentence describing something a person
can watch happen. If you can't write that sentence, it isn't a milestone — it's a task, and tasks belong in
GitHub issues.

**No stubbed demos.** A milestone's demo must run end to end with nothing faked. This is why the order
sometimes departs from the obvious user journey: a Request converts _into_ a Contract [INT-007], so the
contract record exists before intake does, even though a real user meets intake first.

**Infrastructure rides along.** There is no infrastructure phase. The storage adapter, the OCR sidecar,
pg-boss, SMTP, and search each land in the milestone whose demo first needs them. Same doctrine as the
schema rule below.

**The schema grows incrementally.** Tables land in the same change as the feature that reads and writes
them, each with its own drizzle-kit migration. `SCHEMA.md` is the naming and relationship reference, never
a migration to be transcribed up front [TECH-014].

**Run it the way a deployer would.** Development happens against the Docker Compose stack, not a bespoke
local setup. Deployment isn't a milestone because it's a standing constraint: if `docker compose up` stops
producing a working install, that's a bug in the current milestone [TECH-005, PRODUCT.md].

**Settings are sliced, not stacked.** The `/settings` destination and its Personal rail are substrate;
every Organization pane ships inside the milestone of the module it configures [SET-001].

Detail lives in GitHub issues and in `docs/decision-records/`. Keep the summaries here to a few lines — this
document is the map, not the territory.

## Where we are

**Arc 3, milestone 17** — tasks, relations, and end of life. Arc 1 is done: the monorepo and CI, the
authentication chain, the Compose stack a deployer actually runs, the themed app shell, and the
`/settings` destination with its Personal and Organization rails. Arc 2 is done too: the
configurable types and statuses, the Entities registry, the contract record, the conversation on a
record with the two read surfaces over the activity log, and the confidentiality gate that takes a
walled-off contract out of the reach of everyone outside its team. Arc 3 is under way: M11 puts the
paper on the record — the version chain, the storage adapter, and the two drivers behind it — M12
makes that paper readable, with the doc panel over five families, the doc-engine sidecar, and the
background pipeline that extracts every version's text, M13 organizes it, with folders inside
the record and a folder drop that recreates the structure it arrived with, M14 puts the
six-stage backbone and its sign-off on the record — the stage pipeline, parallel approvals with
reusable approver groups, and the soft gate that warns before a contract goes past open sign-off —
M15 sends the paper out and takes it back: the signing adapter with DocuSign behind it, the
envelope on the record, the webhook and the sweep that both report what happened, and the executed
PDF that files and pins itself when everybody has signed — the manual hand-off still needs no
configuration at all — and M16 gives the record a term: the five typed columns, the notice deadline
and the pending-confirmation state that derive themselves out of them, the key dates that join both
in one deadline surface, and the Renew dialog that routes a renewal to whichever of the four vehicles
the team actually used. Nothing in it advances a date on its own; the notifier that fires on these
dates is M18's.

---

## Arc 1 — Foundation

The shell you sign into. Nothing here is legal software; all of it is load-bearing for everything that
follows.

- [x] **M1 — Monorepo, toolchain, and CI**
      _Demo:_ Clone the repo, `pnpm install`, `pnpm check` — lint, typecheck, and tests pass in one command.
  - pnpm workspaces + Turborepo; `apps/api` (Fastify + OpenAPI), `apps/web` (Vite SPA), `apps/worker`,
    `packages/{db,shared,api-client}`
  - Zod as the single schema source, emitting the OpenAPI contract and the generated client
  - Vitest + the API test harness; GitHub Actions for CI, CodeQL, secret scanning, Dependabot
  - _Decisions:_ TECH-002, TECH-003, TECH-014, TECH-015, TECH-016

- [x] **M2 — Authentication**
      _Demo:_ A fresh install shows the first-run Administrator setup; that Administrator invites a Legal
      Team Member, who sets a password, enrols TOTP, and signs in.
  - better-auth behind our own session model; built-in basic and runtime BYO-OIDC modes
  - Magic-link portal access as the floor in both modes, gated by the domain allowlist
  - `packages/db` is born with the first real tables; the guard chain every later route builds on
  - _Decisions:_ TECH-008, DD-010, DD-013 · _Issues:_ #2–#10

- [x] **M3 — The Compose stack**
      _Demo:_ On a clean Linux VM, clone, copy `.env.example`, `docker compose up`, and reach the first-run
      setup screen in a browser.
  - `compose.yml` with the blessed service set; migrations run on API boot
  - `/healthz` and `/readyz`; structured JSON logs with request IDs
  - The demo itself is a CI gate: the browser suite runs against images built from the real Dockerfiles
    on a fresh runner, so "works in dev, breaks in the image" fails the build [TECH-018]
  - _Decisions:_ TECH-005, TECH-014, TECH-017, TECH-018

- [x] **M4 — App shell and design system**
      _Demo:_ Sign in, land on the authenticated shell, switch between the three themes, and resize to the
      mobile layout without anything breaking.
  - Nav, page chrome, the record-page activity bar, and the responsive shell
  - Semantic colour tokens across Light / Warm / Dark; the type ramp, spacing scale, and Lucide icons
  - Every string wrapped in ICU MessageFormat from the first component; `Intl.*` for dates and currency
  - The `/`, `Esc`, `?` keyboard contract and the WCAG 2.2 AA floor
  - _Decisions:_ DES-001 to DES-018, TECH-001

- [x] **M5 — The settings destination**
      _Demo:_ An Administrator opens `/settings`, changes their own theme, then switches the organization's
      auth mode and revokes another user's session.
  - `/settings` IA with the Personal and Organization rails; Admin-only Organization access
  - Personal: Profile (name, avatar, password, TOTP, sign-out-other-devices, timezone) and Appearance —
    the Notifications pane waits for the engine in M18
  - Organization: General (org identity), Users (pending-invite rows, in-place role edits, guarded
    archive, per-user session revocation), and the Security group with Authentication as its first
    sub-item — the M2 admin surfaces reach their real home
  - Immediate-on-save semantics; `activity_log` lands here with writes from every settings mutation
    (M9 builds the surfaces that read it)
  - _Decisions:_ SET-001, SET-002, SET-003, SET-005, SET-006, DD-013, DD-017

---

## Arc 2 — The first record

Contracts, up to the point where one exists and can be found. This arc builds the configuration machinery
every later module reuses, so it is slower than it looks and pays for itself three times over.

- [x] **M6 — Types, statuses, and the field catalog**
      _Demo:_ An Administrator adds a contract type, renames a status without breaking anything, defines a
      custom field, and attaches it to that type.
  - The configurable-taxonomy machinery: add / rename / reorder / archive, protected seed rows
  - The list-editor DES record gets written here, with the first real list-editor to write it against
    (the forward reference in SET-001/SET-003)
  - Contract statuses each mapped to one of the six fixed stages, immutable after creation
  - The shared `fields` catalog with module scopes plus a global tier; per-type attachment and required flags
  - _Decisions:_ CTR-001, CTR-002, CTR-016, MTR-014

- [x] **M7 — Entities, minimal**
      _Demo:_ An Administrator registers the company's UK subsidiary; it becomes selectable as the signing
      entity on a contract.
  - The registry core only: entity record, type, name, jurisdiction — enough to answer "which of ours signs"
  - Split deliberately from the full Entities module (Arc 6): CTR-011 makes this a contracts prerequisite,
    and the alternative is a placeholder column we'd rip out later
  - _Decisions:_ ENT-001 (partial), CTR-011

- [x] **M8 — The contract record**
      _Demo:_ Create a contract, set its owner and team, pick our entity and two counterparties, fill a
      custom field, and find it again in the list.
  - `contracts` with the global C-### sequence; owner plus contract team
  - Priority and risk as first-class fields; value with currency and cadence
  - Our-entity FK plus the multi-counterparty join with one primary; light counterparty records
  - List and detail views; per-field inline commit, no page edit mode
  - _Decisions:_ CTR-003, CTR-004, CTR-005, CTR-010, CTR-011, DES-017

- [x] **M9 — Comments and activity**
      _Demo:_ Post a Legal Only comment and a Full Thread comment on a contract, then watch the activity feed
      record a field edit at the right visibility tier.
  - One comment system: flat, chronological, @mentions, no nesting; segmented composer with tier badges
  - The per-record activity feed and the Administrator-only audit log — two surfaces over one table
    (the table itself has existed since M5, fed by settings mutations; the audit-log view joins the
    Security group in `/settings`)
  - Edit-with-marker and soft delete; tier immutable after posting
  - Contributor team access to a contract record, which is the second audience Legal Only excludes
  - _Decisions:_ CMT-001 to CMT-009, CTR-021, DD-016, DD-017, DES-023 to DES-027

- [x] **M10 — Confidentiality**
      _Demo:_ Mark a contract confidential; a Legal Team Member who isn't on it can't see it in the list, in
      search, or anywhere else — with no placeholder revealing that it exists.
  - The opt-in per-record flag on contracts; silent omission, never a locked placeholder — the list, the
    record URL, the comments, the activity feed, the unread counts, the mention candidates, and every
    mutation all answer as for a record that does not exist
  - One predicate for all of them: confidentiality composes in front of the M9 contract-access module
  - The three-tier affordance: inline marker, record banner, composer notice
  - Three actors decide the audience — an Administrator, the creator, and the Owner — and each set and
    clear is its own activity action, so the audit log holds the walling-off itself
  - The flag on documents waits for the `documents` table in M11; the CTR-018 link-time nudge waits for the
    first link surface (M17/M23); search inherits the gate in M25
  - _Decisions:_ DD-014, CTR-021 (extended in place), CTR-022, DES-009, DES-028, DES-029

---

## Arc 3 — The contract lifecycle

Everything between "a contract exists" and "a contract is live and being watched." This is the arc that
makes OpenLaw a CLM rather than a database with a form on it.

- [x] **M11 — Documents and the version chain**
      _Demo:_ Upload a draft to a contract, upload a revision, and see the linear immutable chain with the
      current version pinned.
  - `documents` plus `document_versions`; every document has exactly one owning record, which in this
    milestone is a contract
  - Corrections append a version — the number is assigned under the owning contract's row lock, and no
    route edits or deletes one
  - The chain pins the current version; the record names its primary document, and the executed copy is
    pinned by hand until M15 sets it
  - Archive and restore, plus the Administrator's typed-confirmation hard delete, which takes the version
    rows and the stored blobs with it
  - The per-document Confidential flag, deferred from M10 to the `documents` table: silent omission on the
    list, the count, the download, and the activity entries that name the file
  - The storage adapter — put, get as a stream, delete — with the local-filesystem driver on a named volume
    and the S3-compatible driver behind the same interface; this is the first demo that puts a file
    anywhere, so the adapter lands here rather than with the Compose stack
  - _Decisions:_ DOC-001, DOC-008, DOC-009, DOC-010, DOC-012, CTR-014, DD-014 (extended to documents),
    TECH-014

- [x] **M12 — Rendering, OCR, and text extraction**
      _Demo:_ Preview a Word draft in-app without downloading it, then upload a scanned PDF and watch OCR
      make its text available.
  - The doc-engine sidecar — headless LibreOffice, OCRmyPDF/Tesseract, and a thin HTTP wrapper — as the
    stack's fourth service, reachable only on the compose network; the `DocEngine` interface is the seam
    the application sees, and the sidecar's own contract suite is what "a doc engine" means
  - The doc panel, DES-016's wider sibling layer: PDFs and raster images drawn from the stored file,
    Word and PowerPoint from a converted PDF rendition, emails parsed into headers, sanitized body, and
    an attachment list; everything else gets an honest download card, never a broken preview
  - Render routing is a hint and never a security decision — the family comes from the declared type and
    the filename, and a preview answers a content type this server chose, inline, with nosniff
  - The background pipeline for real: pg-boss on the existing Postgres, the worker container alive on the
    same image with the worker command, and bounded retries with a terminal failure recorded per version
  - Derived artifacts beside the chain, never in it: a display rendition and the extracted text per
    version, each with its own pending / ready / failed state the panel polls — plus `unsupported`,
    the answer for a file that was never owed one, so a caller stops asking instead of waiting
  - Text out of every family that has any — a PDF's native layer, OCR when that layer is empty, a
    conversion's rendition for Word and PowerPoint, and an email's body — with the source recorded,
    because the search index M25 builds has to know which it holds
  - The upgrade backfill sweep: a worker asks for what pre-M12 versions are still owed, so an install
    gets its previews and text without re-upload
  - _Decisions:_ DOC-004, DOC-005, DOC-010 (extended to derived artifacts), DES-006 (addendum),
    DES-016 (clarified), TECH-007, TECH-010

- [x] **M13 — Folders and bulk upload**
      _Demo:_ Drag a folder of legacy contract files onto a contract and watch the nested structure survive
      the drop.
  - `document_folders` scoped to the owning record — nested, created and renamed and dissolved in place,
    and never a global tree; `documents` gains the nullable folder reference, and none means the record
    root
  - Three invariants held in the write path under the owning contract's row lock: one owning record for a
    folder, its parent, and the paper filed in it; no cycle in the parent chain; no two siblings of one
    name — which is what makes find-or-create deterministic
  - Dissolving a folder re-files its child folders and its documents into the parent and destroys nothing;
    document deletion stays DOC-010's job
  - The upload route takes a folder destination — an id, a relative path, or both — and find-or-creates the
    chain segment by segment under that same lock, so parallel uploads racing on one path converge on one
    folder
  - A batch is N ordinary uploads and never a bulk call: one confirmation for the whole drop, one version
    kind for every file in it, per-file progress, and a failure that costs its own file and nothing else
  - Every dropped file is a new document at version 1; the drop's own story is its `document.created`
    entries, which name the destination folder, and folders a drop passed through narrate nothing
  - The folder tree in the Documents section, each folder's documents read when it is opened, with the
    paging foot applying inside that listing — and confidential documents silently out of both the
    listings and the counts, so an empty folder and a walled one read the same
  - Every drop capability has a pointer-free twin: a multi-select picker, a directory picker, New folder,
    and Move
  - _Decisions:_ DOC-006, DOC-011, DES-033

- [x] **M14 — Stages and approvals**
      _Demo:_ Move a contract from draft through review into approval, request two approvals in parallel, and
      watch the soft gate.
  - The record draws the fixed six-stage pipeline beside the status pill — one datum at two zooms — and the
    marker follows the derived stage, never the renameable label; it renders position, so a regression moves
    the marker back
  - `approver_groups`, `approver_group_members`, and `contract_approvals`, with the pending ask held unique
    per approver per contract by a partial index
  - Approver groups in Settings → Contracts, Administrator-only, in the DES-020 list-editor anatomy; archiving
    one takes it out of the apply picker and touches no request it already made
  - Manual approvers and the group apply through one door: the same audience rule, the same pending-set read,
    and the same write that makes the rows and narrates them; applying a group snapshots its members, so a
    later edit never changes who was asked
  - Every request runs in parallel — no chains and no order; a decision is final, a re-request after a
    rejection writes a new row, and a cancellation deletes the row and leaves the activity entry as the record
  - The soft gate is the first server-side branch on stage: a status change crossing past `approval` with
    unresolved approvals is refused 409, naming each unresolved approver and their state, and the same commit
    with the override flag succeeds and writes its own activity entry
  - The refusal carries an RFC 9457 `type`, so the web client tells the gate from the other 409 the same PATCH
    gives and raises its confirmation dialog on the type rather than on the sentence
  - _Decisions:_ CTR-001, CTR-012, DES-034, DES-035, TECH-020

- [x] **M15 — E-signature**
      _Demo:_ Send a contract for signature through DocuSign, sign it, and watch the executed PDF land back
      as a pinned version.
  - The `SigningProvider` seam with DocuSign as the first connector and JWT grant auth, a deterministic
    fake beside it, and one contract suite both are held to
  - The connector is org data, not deployment environment: an Administrator saves it in the new
    Settings → Organization → Integrations section, both secrets write-only, and every use reads the row
    live
  - `contract_envelopes` and its signers, at most one live envelope per contract; the send picks a version
    of the primary document and names the signers, who are all asked at once
  - The record answers where the paper is: the envelope row in the "Approvals & signing" card, the status
    chip beside the pipeline, and the void on the row
  - Status comes back two ways and both funnel into one idempotent transition — the Connect webhook, this
    install's first unauthenticated inbound write path, and the reconciliation sweep that converges an
    install DocuSign cannot reach
  - Completion files itself: the executed PDF is fetched, appended to the chain as an `executed` version,
    pinned explicitly, and the status advances from the signature stage to active, narrated as the
    integration's own act
  - The manual hand-off is untouched and needs no configuration — upload, pin, mark active
  - _Decisions:_ CTR-013, CTR-014, TECH-013, SET-007, DES-036, DES-037, DES-038 · _Issues:_ #244–#251

- [x] **M16 — Term, renewal, and key dates**
      _Demo:_ Set a contract's term and notice period; the notice deadline derives itself, and choosing to
      renew routes to the vehicle you picked.
  - CTR-006's five term columns on `contracts` — term type, effective date, expiry date, renewal period,
    notice period — each an ordinary inline-committed field, with the cross-field rules refused by their
    own problem types and a type change clearing what the new type cannot hold
  - Four answers derived at read and stored nowhere: the notice deadline (expiry minus notice period),
    days remaining, where a confirmed roll would land, and the renewal-pending-confirmation state below
  - The Term timeline card draws the periods, the today line, and the derived notice-deadline marker
  - `contract_key_dates` per CTR-009, and the deadline union the record reads as one list — the key dates,
    the expiry, and the notice deadline, ordered outward from today with the next deadline named by the seam
  - "Renewal pending confirmation" is a predicate over the record's own dates, not a status: the banner
    appears because the read says so, and no job, sweep, or column is involved
  - The Renew dialog's four CTR-007 vehicles — the confirmed roll writes here, and the amendment, the child
    contract, and the standalone successor route to the surfaces that already exist
  - The write side of CTR-015 lands with the routing: `contracts.parent_id` and `contract_relations`, both
    through one guarded path; M17 keeps the read surfaces
  - The successor is born prefilled with the deal — our entity, the counterparties, the value, the term
    shape — and never with the record: no status, no team, no Owner, no Confidential flag
  - Nothing fires and nothing advances on its own; the notifier is M18's, and what M16 ships is every datum
    it will fire on
  - _Decisions:_ CTR-006, CTR-007, CTR-009, CTR-015, DES-040, DES-041, DES-042, DES-043, DES-044 ·
    _Issues:_ #282–#288

- [ ] **M17 — Tasks, relations, and end of life**
      _Demo:_ Check off a task, link an amendment to its parent contract, then end the contract and confirm
      the record is still writable.
  - Lightweight checklist tasks — deliberately not an entity, and their due dates never feed deadline surfaces
  - `parent_id` hierarchy plus typed directional links, no inheritance
  - Ending as a signal, not a lock; archiving kept separate
  - _Decisions:_ CTR-015, CTR-017, CTR-019

- [ ] **M18 — Background jobs and notifications**
      _Demo:_ An approaching notice deadline produces a bell item and a morning digest email, while an
      approval request emails the approver immediately.
  - pg-boss on Postgres as the job pipeline; SMTP with a provider adapter for delivery
  - The five event groups with defaults set by interruptiveness; per-user channel preferences — the
    Personal → Notifications pane in `/settings` ships here, deferred from M5 so the toggles control
    events that actually fire
  - Immediate email for direct events, a daily digest for dates; the admin-configurable 7/1/0 offsets
  - Bell with a 9+ capped unread badge, read-on-open
  - _Decisions:_ TECH-007, TECH-011, NOT-001 to NOT-005

---

## Arc 4 — Intake

The front door. Everything here has a target to convert into, which is why it comes fourth rather than
first.

- [ ] **M19 — Request types and forms**
      _Demo:_ An Administrator builds an "NDA" request form targeting the NDA contract type, attaches two
      catalog fields, and adds a deflection link above it.
  - `request_types` with an optional target matter type or contract type
  - Form definition reusing the M6 field catalog — no separate form builder, so nothing is re-keyed later
  - The "Before you submit…" deflection links panel, global or per request type
  - _Decisions:_ INT-002, INT-004, INT-005

- [ ] **M20 — The portal**
      _Demo:_ A business user requests a magic link, lands in the portal, submits an NDA request with an
      attachment, and sees it in their list with a live thread.
  - The lightweight portal shell: magic-link auth, no accounts, no passwords
  - Submission forms, my-requests, and the per-request conversation thread
  - R-### numbering; requester-supplied urgency; request attachments
  - The portal bell and portal notification settings
  - _Decisions:_ INT-001, INT-003, NOT-001, DD-010

- [ ] **M21 — The Inbox and triage**
      _Demo:_ A submitted request appears in the Inbox, converts into a contract with the collected values
      carried straight through, and the requester sees the update in their thread.
  - The Inbox as nav slot one: exactly the requests whose fate is undecided, ordered by urgency then age
  - Disposition-at-pickup — Convert, Resolve, or Decline, with no parked intermediate state
  - Re-target as the lossless exception path; attachments promoted into `documents` at conversion
  - _Decisions:_ INT-006, INT-007, DD-018

---

## Arc 5 — The second workspace

Matters. Six MTR decisions are explicit siblings of CTR ones, so this arc inherits finished patterns rather
than racing them — which is the whole reason it sits here and not next to Arc 2.

- [ ] **M22 — The matter record**
      _Demo:_ Create a matter from scratch, then create a second one by converting a request, and see both in
      the list.
  - `matters` with the global M-### sequence; matter types and status labels mapped to open/closed categories
  - One Matter Manager plus the matter team; priority and risk
  - The field catalog at `matter` scope; hard-required fields enforced at creation
  - `opened_at` / `closed_at` maintained on category transitions
  - _Decisions:_ MTR-001, MTR-002, MTR-003, MTR-009, MTR-011, MTR-012, MTR-016

- [ ] **M23 — Matter work surfaces**
      _Demo:_ Open a matter, link an existing contract to it, add a sub-matter, invite external counsel as a
      Contributor, then close it and keep writing to it.
  - Key dates and checklist tasks, reusing the M16/M17 machinery
  - Parent/child hierarchy plus flat related links, no cascade
  - Matter ↔ Contract linking; contracts stay standalone by default
  - The Contributor permission grid — read, comment, upload, edit business fields
  - Closing as a signal, not a lock
  - _Decisions:_ MTR-004 to MTR-008, MTR-015, DD-015

- [ ] **M24 — Matter templates**
      _Demo:_ Create an employment matter from a template and find its checklist already populated with
      relative due dates.
  - Named template entities per type; pre-fill of priority, risk, custom fields, title prefix
  - Template tasks with relative due dates and role targeting
  - _Decisions:_ MTR-013

---

## Arc 6 — Destinations

The three surfaces that only make sense once there's real content behind them, plus the search that makes
all of it findable.

- [ ] **M25 — Search**
      _Demo:_ Press `/`, type a phrase that only appears inside an uploaded PDF, and land on the contract that
      owns it.
  - Postgres FTS with tsvector columns and GIN indexes; indexing jobs on the background pipeline
  - Coverage across titles, descriptions, owning-record context, and extracted document text
  - Cross-module results that respect the M10 confidentiality rules
  - _Decisions:_ DOC-009, TECH-014, DES-010

- [ ] **M26 — The Documents destination**
      _Demo:_ Find a file without knowing which record owns it, using filters alone.
  - The repository view across every document in the system
  - Filters by type, linked matter or contract, party, date, and kind; recents
  - Standard document properties only — no custom fields, no tags
  - _Decisions:_ DOC-002, DOC-007

- [ ] **M27 — Entities in full**
      _Demo:_ Open a subsidiary, see its officers and its position in the org chart, and find its next
      statutory filing on the compliance calendar.
  - Officers, share capital, and multi-jurisdiction registrations on top of the M7 core
  - The full ownership graph with an org chart view
  - Entity-owned statutory documents; recurring obligations with human-confirmed roll-forward
  - Linked-record roll-up tabs with query-derived counts
  - _Decisions:_ ENT-001 to ENT-007

- [ ] **M28 — Knowledge**
      _Demo:_ Publish a playbook, mark it portal-readable, and watch it appear as a deflection link on the
      portal submission form.
  - Knowledge items as one typed entity: text body plus owned documents
  - Draft / published with edit-in-place; Member+ authoring
  - Nested folders, blank start; the legal-only default with a portal-readable flag
  - _Decisions:_ KNW-001 to KNW-004, INT-004

---

## Arc 7 — Finish

Things that sit on top of flows that already work. Each of these is optional in the sense that skipping it
leaves a coherent product; none of them is optional in the sense that we intend to ship without it.

- [ ] **M29 — Dashboards**
      _Demo:_ Sign in and see your own work across contracts and matters on the home surface, without
      navigating anywhere.
  - Cross-cutting dashboards designed into the modules, not a reporting destination
  - _Decisions:_ DD-005

- [ ] **M30 — Live surfaces**
      _Demo:_ Two browsers on the same contract; a comment posted in one appears in the other without a
      refresh.
  - SSE on the surfaces where staleness is visible — comments, activity, approvals, envelope events
  - _Decisions:_ TECH-009

- [ ] **M31 — AI contract analysis**
      _Demo:_ Upload a signed contract and watch the term, value, and notice period auto-fill, each flagged
      unverified until a human confirms it.
  - Bring-your-own key; three protocol adapters with provider presets and a custom option
  - Field-schema-driven extraction, including custom fields carrying their own prompts
  - Auto-filled values flagged unverified; nothing silently trusted
  - _Decisions:_ CTR-008, TECH-012

- [ ] **M32 — Redline compare**
      _Demo:_ Compare a revision against the previous version in-app, then export the difference as a Word
      file with tracked changes.
  - Workshare-style in-app comparison view
  - Word track-changes export
  - _Decisions:_ DOC-003

- [ ] **M33 — The finished first run**
      _Demo:_ On a fresh install, the first Administrator is walked from sign-in to a configured, populated
      system by the onboarding wizard alone — org identity, domains, email, invites, integrations, and the
      seeded types reviewed — with every skipped step waiting on the Settings checklist card.
  - The SET-004 wizard, completed: the auth, portal, email, and invite steps shipped with M2; the org
    identity, integrations, and review-seeded-types steps land here, once the features behind them exist
  - Sits deliberately last-but-one: building these steps earlier would mean wizard steps for features
    that don't exist, which the no-stubbed-demos rule forbids
  - _Decisions:_ SET-004

- [ ] **M34 — Release**
      _Demo:_ A stranger with a clean Linux VM has OpenLaw running in under an hour, from the README alone.
  - Semver tag to ghcr images plus `compose.yml` and `.env.example` artifacts; generated CHANGELOG
  - Install documentation, upgrade path, and the backup story
  - The under-an-hour install actually timed, by someone who didn't build it
  - _Decisions:_ TECH-005, TECH-014, PRODUCT.md

---

## What this plan does not cover

Everything in `docs/decision-records/FUTURE-FEATURES.md` — the deferred parking lot, with each entry citing
the decision that deferred it. Items graduate from there by getting their own grill and decision record, and
only then earn a milestone here.
