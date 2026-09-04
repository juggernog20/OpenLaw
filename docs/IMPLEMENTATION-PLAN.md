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

**A milestone learned late takes a letter.** M21A sits between M21 and M22 because the work it holds was
found at the M21 close, after the numbers around it had already been quoted in decision records, in issue
titles, and in code comments. Renumbering would rewrite text that is true. A letter keeps the running order
readable and leaves every number where it is.

**Settings are sliced, not stacked.** The `/settings` destination and its Personal rail are substrate;
every Organization pane ships inside the milestone of the module it configures [SET-001].

Detail lives in GitHub issues and in `docs/decision-records/`. Keep the summaries here to a few lines — this
document is the map, not the territory.

## Where we are

**Arc 7 is under way: M32 adds Redline compare to the Document chain.** A reader opens a stored Comparison of two Versions, reads its change model in the compare screen, and moves through the change pane. Word pairs run through the existing doc-engine sidecar and export once per pair as a Generated redline with both operands on the chain. Other pairs use extracted text and state that formatting and export are unavailable. **M31 ships AI Contract analysis.** One runtime BYO-key connector supports Anthropic Messages, OpenAI-compatible chat completions, and Gemini through presets or a custom endpoint. An executed primary Document automatically queues extraction against the seven core targets plus prompted catalog Fields; the evidence-checked writer preserves human values, marks every AI write unverified, and carries that marker onto derived deadline surfaces until a person confirms. The Contract record revalidates from the completion frame, so another open browser sees the run and its writes land without a refresh. **M30 makes the open record live.** One `GET /api/events` connection per signed-in tab carries prompts, never payloads, and Postgres `LISTEN`/`NOTIFY` fans them out across the API and the worker. The bell, an open comment thread, an open Activity feed, the Approvals & signing card, the Envelope row, and the Home Inbox count re-read their existing routes when a frame names them, so a live update passes the same reach and tier gates as a page load. The 60-second bell poll is gone. **M29 makes Home the personal state summary and completes the daily briefing.** A Member+ user lands on pending Approvals, assigned Tasks, approaching Dates, Entity Obligations, the Inbox, managed Contracts, and managed Matters. The morning email carries its six cross-module sections, and one daily bell summary opens Home. Reporting remains deferred as a destination.

**Arc 6 is complete: M28 gives the legal team's know-how a file-first Knowledge destination and a requester-facing route out of Intake.** A dropped file creates one draft Knowledge Item with its Document pinned as primary. Member+ publishes it, marks it portal-readable, and an Administrator places it on the portal home as an internal deflection link. The portal article reads the primary Document first and optional Markdown guidance last. Nested Knowledge Folders organize items without adding Document folders, the managed list and search cover both item text and owned paper, the Documents repository gains its fourth owner, and the morning briefing gains its Knowledge section. **M27 turns the Entity registry into the corporate record.** A subsidiary now carries Officers, Registrations, Holdings, Obligations, statutory Documents, and query-derived Contract and Matter roll-ups. The Entities destination opens on the compliance calendar, with the DES-046 registry and the ownership chart beside it; the DD-014 gate reaches every view and reference. M27 also extends the M26 Documents destination to Entity-owned Documents. **M26 makes the legal file layer browsable from one Documents destination.** A reader can start with a Counterparty, format, Version kind, date, uploader, or owning-record filter, then open the matching current Version on its Contract or Matter without knowing that owner first. Recent means recently uploaded, and the flat managed list carries saved views while DD-014 removes unreachable rows and filter options before paging. **M25 opened Arc 6 with one global search across the records and the words inside their paper.** Pressing `/` opens the ranked, viewer-scoped answer; a Document hit names its owning record and opens the matching Version with the PDF find bar already filled. Stored generated vectors keep record edits and extracted text indexed in the same write, while DD-014's existing reach predicates stay ahead of ranking and paging. **Arcs 4 and 5 are complete: M24 adds reusable Matter templates to the complete Matter workspace.** Named templates can pre-fill Matter defaults and custom fields, then create relative Tasks and Key dates through either the direct or Intake creation path. M23 supplied the work surfaces around the M22 record: Key dates join the active deadline system; Tasks stay a lightweight internal checklist; parent, child, and flat relationships remain navigational; Contracts link without losing their standalone identity; reached Contributors can edit business Fields and supply supporting Documents; and Closing is an advisory signal that leaves the record writable. Arc 1 is done: the monorepo and CI,
the authentication chain, the Compose stack a deployer actually runs, the themed app shell, and the
`/settings` destination with its Personal and Organization rails. Arc 2 is done too: the
configurable types and statuses, the Entities registry, the contract record, the conversation on a
record with the two read surfaces over the activity log, and the confidentiality gate that takes a
walled-off contract out of the reach of everyone outside its team. Arc 3 is now complete: M11 puts the
paper on the record — the version chain, the storage adapter, and the two drivers behind it — M12
makes that paper readable, with the doc panel over five families, the doc-engine sidecar, and the
background pipeline that extracts every version's text, M13 organizes it, with folders inside
the record and a folder drop that recreates the structure it arrived with, M14 puts the
six-stage backbone and its sign-off on the record — the stage pipeline, parallel approvals with
reusable approver groups, and the soft gate that warns before a contract goes past open sign-off —
M15 sends the paper out and takes it back: the signing adapter with DocuSign behind it, the
envelope on the record, the webhook and the sweep that both report what happened, and the executed
PDF that files and pins itself when everybody has signed — the manual hand-off still needs no
configuration at all — M16 gives the record a term: the five typed columns, the notice deadline
and the pending-confirmation state that derive themselves out of them, the key dates that join both
in one deadline surface, and the Renew dialog that routes a renewal to whichever of the four vehicles
the team actually used — M17 adds the task checklist, the relations panel with parent hierarchy
and typed directional links, and end of life as a signal that leaves the record writable — and M18
finally makes the system speak: the Notifier seam, the bell with its 9+ badge, immediate email for a
direct ask, and one morning briefing for the dates coming up, on a scheduled round that serves each
reader at their own eight o'clock. Arc 4, the front door, is complete: M19 configures it — the Intake
section on the settings rail, request types on the same machinery every other type table already
uses, the three-state target that decides at the door what a request will become, the form definition
that reuses the M6 field catalog rather than building a second one, and the deflection links panel
that answers a question before it becomes a request. Nothing in M19 was visible to a requester, and
M20 is the milestone that opens the door: the lightweight portal a business user magic-links into, the
form that renders M19's configuration, the Request with its R-### and its paper, the conversation
Legal answers on, and a bell and a notification pane of the portal's own. Every one of those reads is
its own mount rather than a loosened staff gate, and the thread and the bell are the comments and
notification machinery given one more arm rather than a second system. M21 closes the arc by
receiving what M20 lets people send: the Inbox one click behind Home, listing exactly the Requests whose
fate is undecided; the staff detail that reads a whole Request on one screen; and disposition at
pickup — Convert, Resolve, or Decline, atomic on `new` under the Request's own row lock, with no
parked intermediate state and no claim step. Convert is the one the milestone is for. It runs the
ordinary contract-create write inside the disposition transaction, so the record is born ordinary,
with the summary as its title, the urgency as its priority, the collected values in their real
fields, the paper promoted into documents, and the thread re-parented onto the record with its tiers
intact. Nothing is re-keyed and nothing is dropped in silence. The Requester's window survives all
of it: the same address, the same conversation, and one vocabulary — Open, In progress, Resolved,
Declined — on the pill, the banner, and the email alike. M21A completes the hand-off after conversion:
paper rides a comment at its tier, a Member+ files it as a new Document or the next Version, and the
round's kind can be corrected without moving the bytes or the executed pin. A dispositioned Request
takes no more attachments of its own; its stable portal thread is the door beside that wall. M22 added the
second workspace: a Matter is born under its own M-###, configured type and open/closed status, one
nullable Matter Manager and roster, priority and risk, hard-required matter fields, lifecycle timestamps,
confidential reach, a managed list, an editable detail, and the same comments, history, notifications, and
document machinery a Contract already wears. The Request door now converts into either record through
one guarded transaction; its values, paper, thread, watermarks, and requester window all follow the Matter
arm too. M23 completed the record as a work surface with Key dates, Tasks, relationships, linked
Contracts, the Contributor grid, and Closing that leaves the record writable. M24 completed Arc 5 with
named Matter templates, direct and Intake application, Matter defaults, and relative Tasks and Key dates.
M25 now makes every live, reachable record and every ready Document text row findable from one box.
M26 adds a flat repository over every reachable Contract-owned and Matter-owned Document, with standard-property filters, recently uploaded paper, saved views, and direct landing on the current Version.

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
  - The flag on Documents landed in M11 and the CTR-018 link-time nudge on the M17 Contract links and M23
    Contract-to-Matter link; search inherits the gate in M25
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

- [x] **M17 — Tasks, relations, and end of life**
      _Demo:_ Check off a task, link an amendment to its parent contract, then end the contract and confirm
      the record is still writable.
  - Lightweight checklist tasks — deliberately not an entity, and their due dates never feed deadline surfaces
  - `parent_id` hierarchy plus typed directional links, no inheritance
  - Ending as a signal, not a lock; archiving kept separate
  - _Decisions:_ CTR-015, CTR-017, CTR-019

- [x] **M18 — Background jobs and notifications**
      _Demo:_ An approaching notice deadline produces a bell item and a morning digest email, while an
      approval request emails the approver immediately.
  - pg-boss on Postgres as the job pipeline; SMTP with a provider adapter for delivery
  - The five event groups with defaults set by interruptiveness; per-user channel preferences — the
    Personal → Notifications pane in `/settings` ships here, deferred from M5 so the toggles control
    events that actually fire
  - Immediate email for direct events, a daily digest for dates; the admin-configurable 7/1/0 offsets
  - Bell with a 9+ capped unread badge, read-on-open
  - One new seam, the **Notifier**: a route names what happened and never learns that channels exist,
    who the audience is, or that anything is queued
  - Groups 1 to 3 fire; groups 4 and 5 ship as catalog slots for the Inbox (M21) and the portal (M20)
  - _Decisions:_ TECH-007, TECH-011, NOT-001 to NOT-005, DES-049 to DES-052 · _Issues:_ #315–#323

---

## Arc 4 — Intake

The front door. Everything here has a target to convert into, which is why it comes fourth rather than
first.

- [x] **M19 — Request types and forms**
      _Demo:_ An Administrator builds an "NDA" request form targeting the NDA contract type, attaches two
      catalog fields, and adds a deflection link above it.
  - `request_types` on the third mount of the shared taxonomy machinery — no new module, and no
    system-protected row, because no record needs a non-null request type once conversion is done
  - The target has **three** states, not two: no target, a module, or a module and a type inside it —
    one check constraint holds the three columns together, and one grouped select carries both halves
  - Form definition reusing the M6 field catalog — no separate form builder, so nothing is re-keyed later
  - Which fields may attach follows the target — CTR-016's scope rule applied one level out — and a
    target change that would strand attached fields is refused and names them
  - The four basics (Summary, Description, Attachments, Urgency) are fixed, not configured, and are
    drawn as locked rows rather than stored as columns
  - The "Before you submit…" deflection links panel, global or per request type — removed outright,
    never archived, and cascaded away with the request type it was placed on
  - The `#85` doctrine held — nothing was copied — but the extension surface is **five** hooks, not
    the two forecast: `protectedSlug`, the `extras` hook, `loadContext`, a `scopeRule` that may be a
    function of the locked row, and a generic row type on both factories. Recorded in TECH-023 with
    the rule an extension point has to pass and the point at which the machinery is split instead
  - One edge left open for M20: a catalog field archived, its type re-pointed, then the field
    restored, leaves an attachment live under a target whose scope no longer admits it — visible,
    repairable by a plain detach, and recorded in INT-002 rather than refused. _Met in M20: the
    portal form renders, collects, and enforces such a field like any other, and both seams pin it
    (the INT-002 M20/4 addendum)._
  - _Decisions:_ INT-002, INT-004, INT-005, DES-020, DES-022, DES-052, TECH-023 · _Issues:_ #351–#357

- [x] **M20 — The portal**
      _Demo:_ A business user requests a magic link, lands in the portal, submits an NDA request with an
      attachment, and sees it in their list with a live thread.
  - The lightweight portal shell: magic-link auth, no accounts, no passwords, and a chrome with no
    staff nav, no search, and two destinations of its own
  - **Landing is by role, not by callback URL** — the magic link still redeems to `/`, and the root
    loader forwards a Business User to the portal, so SSO, password sign-in, and a bookmark all land
    the same way and `apps/api` learned nothing about the portal
  - Every requester-facing read is **its own mount**, never a loosened gate on the Administrator's:
    `/portal/...` answers a narrower projection of the same rows, and the M19 settings routes still
    refuse a Business User with 403
  - Submission forms, my-requests, and the per-request conversation thread, with the requester in the
    `where` clause of every read (DD-013) — a foreign R-### and a missing one are the same 404
  - `requests` and `request_attachments`; R-### as a `GENERATED ALWAYS` identity column;
    requester-supplied urgency on the DES-018 ramp; one set of upload rules shared with documents,
    and a Request bounded at twenty attachments
  - The thread is the comments machinery with **one new arm**, not a second system — the M20/1
    prefactor's acceptance criterion, measured: adding `request` took one vocabulary entry and one
    map member, with no route, tier filter, or unread-count edit
  - Group 5 fires: the receipt, the reply, and the requester email — four Notifier methods, of which
    two have callers today and two wait for M21's disposition routes
  - The portal bell and portal notification settings, both a **second mount** of the staff ones. The
    notification scope now takes which surface is asking rather than which role, because a Member+ who
    raises a Request of their own holds both kinds of row at once
  - Three things left open for M21, each written down where M21 will look rather than carried
    silently. One of the three is now settled, and it is marked below rather than removed.
    **A request type with a _required_ `user` or `entity` catalog field is unanswerable** —
    the portal draws those pickers empty on purpose, so every submission of that type is refused
    forever, and nothing in the M19 editor stops an Administrator attaching one; three candidate
    fixes are recorded in INT-002 and raised as #400, and none is chosen. _Settled by #400: the
    second candidate was taken. Such a field may be on a request form and may never be required
    on one — both write doors refuse the flag by name, the editor draws the box locked and says
    why, and one migration clears the rows an install could already hold (the INT-002 M20/11
    addendum)._ **The requester-facing
    status vocabulary is unchosen** — the status-change email translates `new` to "open" and
    `converted` to "in progress" while the portal pill says "New" and "Converted"; no requester has
    seen it because the event has no caller yet, and M21 gives it one (INT-003). **A mention on a
    Request thread notifies nobody** — `commentMentioned` is a contract's event, and what is meant to
    tell the staff side about a Request is group 4, which the Inbox brings (CMT-010)
  - _Decisions:_ INT-001, INT-002, INT-003, INT-004, CMT-010, NOT-001, NOT-002, NOT-005, DES-049,
    DES-050 · _Issues:_ #375–#384, #400

- [x] **M21 — The Inbox and triage**
      _Demo:_ A submitted Request appears in the Inbox, converts into a contract with the collected values
      carried straight through, and the Requester sees the update in their thread.
  - The Inbox in nav slot two, directly behind Home: exactly the Requests whose fate is undecided, ordered
    by urgency then age, Member+ only and absent rather than disabled below that floor. The triaged toggle
    is the Inbox's one control — the Inbox is fixed, so DD-019's list machinery is not built on it
  - The staff request detail: the envelope, the submitted values labelled by the boxes that collected them,
    the paper downloadable before the decision, and the thread at every tier on the same activity bar a
    contract wears — a record page for something that is not a record
  - Disposition-at-pickup — Convert, Resolve, or Decline, with no parked intermediate state. All three
    transition only from `new`, under the Request's own row lock, so two triagers racing one Request
    produce one outcome; the loser is answered the recorded one as an RFC 9457 problem carrying the
    record it became
  - **Convert is one transaction, and the record is born inside it**: the contract comes out of the
    ordinary create write — the prefactor that made it a door conversion can call was the milestone's
    first task — so it is an ordinary contract. C-###, the draft-stage seed, no Owner, no team beyond
    the triager's provenance row, no Confidential flag. The summary is the title, the urgency is the
    priority 1:1, risk is never requester-set, and every collected value whose slug the target type
    attaches lands in that field
  - Nothing is dropped silently: a value the target type has no field for is named in the dialog as not
    carrying and stays on the Request, and a required field the form never collected is prompted before
    commit. Re-target is the lossless exception path — a matter-targeting or no-target Request can still
    become a contract, and the Request survives either way
  - Attachments promoted into `documents` at conversion, one document at version 1 each, copied rather
    than moved — the Requester's own download goes on answering
  - The thread re-parents onto the record with its tiers and its unread watermarks, and from then on the
    Request's own thread address answers the record's conversation. The Requester's window never moves:
    the portal draws the record's thread filtered to Full Thread, their replies land on the record, and
    the reply promise follows — a Full Thread comment on the contract still reaches the Requester
  - Group 4 fires at last, and the two bells split by audience rather than by role; a mention on a
    Request thread became group 1's business
  - **One Requester-facing vocabulary, chosen and applied**: Open, In progress, Resolved, Declined, on
    the portal pill, the banner, and the email alike. The enum is untouched and staff surfaces keep its
    own words — `converted` is a fact about Legal's machinery, and "In progress" is what it means to the
    person who asked
  - Both things M20 left "where M21 will look" are closed — the requester-facing status vocabulary and
    the Request-thread mention — and so is INT-002's older M19/7 residue, the collected value with no
    field to land in, which the Convert dialog now names before the press
  - Four things were left open and are now closed in the records that own them. **The matter arm of
    conversion shipped in M22** on the same guarded path rather than as a second conversion. **A carried
    `user` or `entity` value whose row is archived between submission and
    triage dead-ends the dialog** — conversion refuses it by name and all-or-nothing holds, but the
    dialog draws no box to fix it, because the field is answered rather than missing; the API takes an
    override and the screen does not offer one. Which of the three repairs to build was a design decision
    (#437), since taken: the value reads as dead on the staff detail and the dialog grows a box for it.
    **A Requester may still attach paper to an already-converted Request**, and that paper never promotes —
    M20/6 behaviour that conversion did not change (#438). The answer turned out not to be a better copy:
    the upload is refused and the paper goes on the thread instead, which M21A builds. **The
    converted-contract left join was written twice**, in the Inbox read and the staff detail read; M22/1
    folded both into `projection.ts` before adding the Matter arm
  - _Decisions:_ INT-002, INT-003, INT-006, INT-007, CMT-001, CMT-010, NOT-002, DD-018, DES-056, DES-057,
    DES-058, DES-059 · _Issues:_ #412–#423

- [x] **M21A — Paper on the thread**
      _Demo:_ Legal sends a draft out, the business gets the counterparty's markup back, posts it on the
      contract's thread, and a lawyer files it as the next version of the chain.
  - Attachments on comments, on every thread the audience seam already answers for — a contract, a Request,
    a document, and the Matter arm added in M22. One upload path, with the storage rules documents and
    request attachments already share
  - **A file takes its comment's tier by being part of the comment**, so a Legal Only note keeps its paper
    legal only, and a redact takes the file with the words
  - **A comment attachment is not a document**: a stored blob and the name it arrived under, exactly as a
    request attachment is, because a comment owns no record (DOC-008)
  - **Filing is the lawyer's act and it has two destinations** — a new document at the record root, or a new
    version on a chain already there. The kind is named at the moment of filing, which is the first time
    anybody in the room can say honestly what the round is. The comment then says where its file went
  - A version's kind becomes correctable by Member+ and narrates the change; the bytes, the order, and the
    round itself stay untouchable, and the executed pin is not moved by either direction of it
  - The portal composer gains the upload, and the attachment route starts refusing a dispositioned Request —
    the two ship together, so a requester never meets a wall before the door beside it exists (#438)
  - _Decisions:_ CMT-011, CTR-014, INT-002, DD-014, DD-016, DD-018, DOC-008, DOC-012

---

## Arc 5 — The second workspace

Matters. Six MTR decisions are explicit siblings of CTR ones, so this arc inherits finished patterns rather
than racing them — which is the whole reason it sits here and not next to Arc 2.

- [x] **M22 — The matter record**
      _Demo:_ Create a matter from scratch, then create a second one by converting a request, and see both in
      the list.
  - `matters` with the global M-### sequence; matter types and status labels mapped to open/closed categories
  - One Matter Manager plus the matter team; priority and risk
  - The field catalog at `matter` scope; hard-required fields enforced at creation
  - `opened_at` / `closed_at` maintained on category transitions
  - **The matter arm of the conversion door M21 built.** The one guarded path now resolves either module,
    confirms a bound Matter target or asks for a module-only one, and Re-targets in both directions. M22/1
    moved the converted-record projection into `apps/api/src/modules/requests/projection.ts`; the Matter
    arm then added one reader rather than a third join
  - _Decisions:_ MTR-001, MTR-002, MTR-003, MTR-009, MTR-011, MTR-012, MTR-016, INT-002, INT-007, CMT-001

- [x] **M23 — Matter work surfaces**
      _Demo:_ Open a matter, link an existing contract to it, add a sub-matter, invite external counsel as a
      Contributor, then close it and keep writing to it.
  - Key dates and checklist tasks, reusing the M16/M17 machinery
  - Parent/child hierarchy plus flat related links, no cascade
  - Matter ↔ Contract linking; contracts stay standalone by default
  - The Contributor permission grid — read, comment, upload, edit business fields
  - Closing as a signal, not a lock
  - The close journey proves the complete sentence against fresh Compose images; the retained upgrade gate carries populated M22 Matter records, Fields, teams, Documents, Activity, and lifecycle timestamps through all four M23 migrations
  - _Decisions:_ MTR-004 to MTR-008, MTR-015, DD-014 to DD-017, DOC-008, DOC-012, CTR-018, NOT-001, NOT-002, NOT-004 · _Issues:_ #489–#496

- [x] **M24 — Matter templates**
      _Demo:_ Create an employment matter from a template and find its checklist already populated with
      relative due dates.
  - Named template entities per type; pre-fill of priority, risk, custom fields, title prefix
  - Template Tasks with relative due dates and role targeting, plus relative Key dates
  - Optional application at direct creation and Intake handoff, with carried Request values and triager choices taking precedence
  - The close journey proves the demo sentence against fresh Compose images; the retained upgrade gate carries populated pre-M24 Matters, Tasks, and Key dates through all three M24 migrations
  - _Decisions:_ MTR-013, MTR-014, DD-010, INT-002 · _Issues:_ #510–#518

---

## Arc 6 — Destinations

The three surfaces that only make sense once there's real content behind them, plus the search that makes
all of it findable.

- [x] **M25 — Search**
      _Demo:_ Press `/`, type a phrase that only appears inside an uploaded PDF, and land on the contract that
      owns it.
  - Postgres FTS with stored generated `tsvector` columns and GIN indexes; the existing extraction and backfill jobs write the text rows those vectors derive from
  - Coverage across titles, descriptions, owning-record context, and extracted document text
  - Cross-module results that respect the M10 confidentiality rules
  - The close journey proves the demo sentence against fresh Compose images; the retained upgrade gate carries populated pre-M25 records and a ready extracted-text row through the migration and proves each is searchable without re-upload
  - _Decisions:_ DOC-009, TECH-014, DES-010, DES-016, DD-014 · _Issues:_ #532–#539

- [x] **M26 — The Documents destination**
      _Demo:_ Find a file without knowing which record owns it, using filters alone.
  - One flat repository view across every reachable Contract-owned and Matter-owned Document, with rows opening the current Version on its owning record
  - Filters by owning module and record, Counterparty, format, Version kind, upload date, uploader, and record-scoped folder; Recent means recently uploaded
  - The third DES-046 managed-list catalogue, with private saved views over columns, filters, and sort; standard Document properties only, with no custom Fields or tags
  - The close journey proves the demo sentence against fresh Compose images; the retained upgrade gate proves pre-M26 Documents appear through the new repository read with no backfill
  - _Decisions:_ DOC-002, DOC-006, DOC-007, DOC-008, DD-014, DD-019, DES-046, DES-066 · _Issues:_ #555–#560 · _Parent:_ #549

- [x] **M27 — Entities in full**
      _Demo:_ Open a subsidiary, see its officers and its position in the org chart, and find its next
      statutory filing on the compliance calendar.
  - Officers, share capital, and multi-jurisdiction registrations on top of the M7 core
  - The full ownership graph with an org chart view
  - Entity-owned statutory documents; recurring obligations with human-confirmed roll-forward
  - Linked-record roll-up tabs with query-derived counts
  - The close journey proves the full demo sentence against fresh Compose images; the retained upgrade gate carries a populated pre-M27 Entity and its Entity-referencing Contracts through the M27 migration, then proves the Entity lists and opens with empty Officers, Registrations, Holdings, and Obligations
  - _Decisions:_ ENT-001 to ENT-009, DD-014, DD-017, DD-019, DOC-006, DOC-008, NOT-002, TECH-023, TECH-025, DES-046, DES-067 · _Issues:_ #573–#582 · _Parent:_ #572

- [x] **M28 — Knowledge**
      _Demo:_ Drop a Word playbook to create the Knowledge Item, publish it, mark it portal-readable,
      place it in "Before you submit…" on the portal home, sign in to the portal, and open it there.
  - One typed, file-first Knowledge Item with optional Markdown guidance, owned Documents and Version
    chains, an explicit primary Document, and one-draft-per-file drop creation
  - Member+ edit-in-place authoring with named publish, unpublish, archive, and restore acts; nested
    blank-start Knowledge Folders; Legal Only by default and portal-readable by choice
  - The fifth DES-046 managed-list catalogue, global search, and the fourth Documents repository owner;
    the shared Documents card mounts without Document folders
  - Internal or external deflection targets; the portal article applies one published, portal-readable,
    live gate to the item and its current-Version downloads
  - The fifth morning-briefing section lists newly published Knowledge Items, excludes the author, and
    has its own email toggle
  - The close journey proves the full demo sentence against fresh Compose images; the axe sweep covers
    the destination, record, and portal article; the retained upgrade gate carries pre-M28 Documents and
    external deflection links through migration `0083_wide_inhumans` and reads them back unchanged
  - _Decisions:_ KNW-001 to KNW-004, INT-004, DOC-006, DOC-008, NOT-008, TECH-023, TECH-025,
    DES-046, DES-068 · _Issues:_ #599–#605 · _Parent:_ #598

---

## Arc 7 — Finish

Things that sit on top of flows that already work. Each of these is optional in the sense that skipping it
leaves a coherent product; none of them is optional in the sense that we intend to ship without it.

- [x] **M29 — Dashboards**
      _Demo:_ Sign in and see your own work across contracts and matters on the home surface, without
      navigating anywhere.
  - Home is the fixed personal read of pending Approvals, assigned Tasks, approaching Dates, Entity
    Obligations, the Inbox, managed Contracts, and managed Matters
  - The daily briefing carries its six cross-module sections and writes one Home-linked bell summary
    when a Home-backed section has content (a Knowledge-only briefing mails without one); absent
    section preferences keep the application defaults
  - Reporting and org-wide analytics stay deferred as a destination
  - The close journey proves the demo sentence against fresh Compose images; the populated Home joins
    the axe sweep; the retained upgrade gate reads pre-M29 rows through Home with no backfill
  - _Decisions:_ DD-005, NOT-003, NOT-006, NOT-008, DES-029, DES-069 · _Issues:_ #616–#625

- [x] **M30 — Live surfaces**
      _Demo:_ Two browsers on the same contract; a comment posted in one appears in the other without a
      refresh.
  - SSE on the surfaces where staleness is visible — comments, activity, approvals, envelope events
  - _Decisions:_ TECH-009

- [x] **M31 — AI contract analysis**
      _Demo:_ Upload a signed contract and watch the term, value, and notice period auto-fill, each flagged
      unverified until a human confirms it.
  - Bring-your-own key; three protocol adapters with provider presets and a custom option
  - Field-schema-driven extraction, including custom fields carrying their own prompts
  - Auto-filled values flagged unverified; nothing silently trusted
  - _Decisions:_ CTR-008, TECH-012

- [x] **M32 — Redline compare**
      _Demo:_ Compare a revision against the previous version in-app, then export the difference as a Word
      file with tracked changes.
  - One stored Comparison per Version pair, with Word mode from the doc-engine sidecar and text mode from
    extracted text
  - Workshare-style compare screen with pair control, change pane, change model, and predecessor entry points
  - Once-per-pair Word track-changes export as a Generated redline with both operands on the chain
  - Tinos closes the secondary-typeface deferral on the compare document, including the Light and Dark axe
    sweep
  - _Decisions:_ DD-014, DD-017, CTR-014, DOC-001, DOC-003 to DOC-005, DOC-008, DOC-010, DES-006,
    DES-071, TECH-007, TECH-010, TECH-020 · _Issues:_ #679–#684

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
