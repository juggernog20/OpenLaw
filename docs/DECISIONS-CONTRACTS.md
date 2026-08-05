# OpenLaw — Contracts Module Decision Record

Decisions specific to the Contracts (CLM) module. Platform-level decisions that apply across all modules (data model, role model, intake, activity tracking, etc.) live in `DECISIONS.md` and are referenced by ID where relevant.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `CTR-###`.

## Open questions queued for the next grill-me session

_None — queue cleared 2026-08-04 (CTR-001 through CTR-019). New questions from screen batches or other module grills queue here._

---

## CTR-001 — Lifecycle: fixed six-stage backbone + configurable statuses

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — Contracts need a lifecycle model. The contract-details mocks show both a "Status" pill (C.5) and a "Stage" field (D.8) — a duplication that must resolve to one stored field. Unlike matters (MTR-002's two categories), contract code genuinely branches at more points: approval rules gate before signature, the e-signature integration fires during signature, term/renewal logic runs only on executed contracts, and ended contracts drop from active surfaces. Per the configurable-over-fixed default and its carve-out (fixed enums only where code branches — DD-013/DD-016 precedent).
- **Decision** — Two-layer model, MTR-002 scaled up:
  - **Fixed system stages** (code branches on these; immutable enum): `draft` → `review` → `approval` → `signature` → `active` → `ended`.
  - **Configurable statuses** (`contract_statuses`, same machinery as `matter_statuses`): each status maps to exactly one stage, mapping immutable after creation. Seeds: Draft (draft); Internal review, Redlining with counterparty (review); Awaiting approval (approval); Out for signature (signature); Active (active); Expired, Terminated (ended).
  - Contract stores `status_id` only; **stage is derived** from the status. The status pill shows the status label; the pipeline/progress visualization shows the stage. C.5 and D.8 are the same datum at two zoom levels.
  - Stage order is the canonical forward sequence but transitions are **not restricted** — a contract can move to any status (deals collapse, redlines reopen after approval). Stage regression is allowed and logged per DD-017.
  - Same guardrails as MTR-002: ≥1 unarchived status per stage that has seeds; seed rows for `draft`, `active`, and one `ended` status are system-protected; global list, not per-type.
- **Rationale** — The stage backbone gives approvals, e-sign, renewals, and surfaces a stable enum to branch on without hardcoding labels teams will want to rename. Matches the market-leader pipeline shape (Ironclad/LinkSquares). Deriving stage from status kills the stage-vs-status duplication in the mocks.
- **Alternatives considered** — Three coarse categories (pre_execution/active/ended): approval and e-sign gates would need separate per-contract flags. Fully fixed status enum: contradicts the configurable default; teams rename these labels. Enforced forward-only transitions: real deals move backwards; a transition matrix adds config surface with no v1 payoff.
- **Consequences** — `contract_statuses` table + `contracts.status_id` in SCHEMA.md. Settings surface: Contracts → Statuses (sibling of Matters → Statuses). Approval (Q8) and e-signature (Q9) decisions can key off `approval`/`signature` stages. Renewal logic (Q4) keys off `active`/`ended`. Grill-plan rows C.5/D.8 unblocked; H.C4 remains gated on approval rules.

## CTR-002 — Contract types: configurable list, type as policy carrier

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — Contracts need a type taxonomy (grill-plan row D.2 already leans configurable per the MTR-001 pattern). The deeper question: is type a cosmetic label, or the attachment point for per-type policy the way `matter_types` became one?
- **Decision** — `contract_types` table mirroring `matter_types` exactly: Admin add/rename/reorder/archive via Contracts Settings → Types; slug immutable; protected `other` row; `contracts.contract_type_id` not null. **Type is the policy carrier**: per-type custom-field attachment, contract templates, and approval-rule targeting all key off it. Seeds: `nda`, `msa`, `sow`, `sales`, `procurement`, `employment`, `other`.
- **Rationale** — Identical machinery to MTR-001 (one settings pattern to build twice). Type-as-policy-carrier is the universal market pattern and gives approvals/fields/templates a natural hook instead of inventing three targeting mechanisms.
- **Alternatives considered** — Cosmetic-only type (breaks the Q8/Q12/Q13 composition); fixed enum (no code-branching justification).
- **Consequences** — `contract_types` in SCHEMA.md; settings row; grill-plan D.2 unblocked. The single-state-machine-for-all-types question from the original queue resolves implicitly: the lifecycle (CTR-001) is global, type does not vary the state machine — type varies *policy* (fields/templates/approvals), not *stages*.

## CTR-002 — Contract types: configurable list, MTR-001 sibling

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — Contracts need a type taxonomy (grill-plan row D.2). Per the configurable-over-fixed default, and per the market research finding that type is the natural **policy carrier** for contracts (fields, templates, approval rules all scope by type in market leaders).
- **Decision** — `contract_types` table with identical machinery to `matter_types` (MTR-001): slug (immutable), display_name, description, display_order, is_system_default, archived_at. Admin-managed via Contracts Settings → Types. `contracts.contract_type_id` FK, not null. Seeds: `nda`, `msa`, `sow`, `sales`, `vendor`, `employment`, `license`, `other` — `other` row system-protected (no archive/delete). Type is the designated attachment point for per-type custom fields, templates, and approval-rule scoping as those decisions land (Q8, Q12, Q13).
- **Rationale** — Nothing in code branches on "NDA vs MSA" — policy attaches via configuration, so the fixed-enum carve-out doesn't apply. Reusing MTR-001's exact machinery keeps the settings UI and application code uniform.
- **Alternatives considered** — Fixed enum: no code-branching justification; new type shouldn't require a release. Two-level types/subtypes: no v1 feature consumes the parent level; retrofittable later via `parent_id`.
- **Consequences** — `contract_types` table in SCHEMA.md. Settings surface: Contracts → Types. Later decisions (fields, templates, approvals) hang policy off this FK. Grill-plan row D.2 unblocked.

## CTR-003 — Numbering: free title + global C-### sequence

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — Contracts need identity: the details mock has a free-text title pill (C.3) and a "Reference" field (D.1). MTR-009 settled the sibling question for matters (M-42).
- **Decision** — Free-text `title` (editable) + immutable global auto-increment `number` on its own sequence, independent of the matters sequence. Displayed as **C-42**; used in URLs (`/contracts/42`). The "Reference" field in the hero renders this number. No templated/per-type numbering.
- **Rationale** — Same as MTR-009: short, memorable, speakable references; no pattern-editor settings surface; no renumbering questions when a contract's type changes.
- **Alternatives considered** — Templated numbering (`{TYPE}-{YYYY}-{SEQ}`, Clio-style counter scopes): adds config surface and re-type ambiguity; rejected for matters already.
- **Consequences** — `contracts.number` + `contracts.title` in SCHEMA.md. Grill-plan rows C.3 (title pill = editable free text) and D.1 (Reference = C-###) unblocked.

## CTR-004 — Owner + team: manager_id + contract_team, MTR-003 sibling

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — Who runs a contract (grill-plan D.7 owner-field divergence), and what the collaboration model is. MTR-003 settled one Matter Manager + role-typed team. Standalone contracts (MTR-007's autodoc NDA) can't borrow a matter's team.
- **Decision** — `contracts.manager_id` (nullable FK → users; null = unassigned/triage), rendered with UI label **"Owner"** per the mock; name only, no job-title suffix (D.7: V13 wins). `contract_team` join table with the same shape and role enum as `matter_team`: `member | watcher | creator | contributor`, compound PK on (contract_id, user_id, role). External counsel participate as `contributor` per MTR-006.
- **Rationale** — One accountable human per contract mirrors the matter model and the market norm. A contract-local team table is required because contracts can stand alone; reusing the exact matter_team machinery keeps queries and permissions code uniform.
- **Alternatives considered** — Owner only, team via linked matter: breaks for standalone contracts. Multi-owner: rejected for matters (MTR-003) for accountability-diffusion reasons that apply equally here.
- **Consequences** — `contracts.manager_id` + `contract_team` table in SCHEMA.md (resolves the "reused for contract_team" TBD noted under matter_team). Grill-plan D.7 unblocked.

## CTR-005 — Priority and risk: both first-class, MTR-012 sibling

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — The details mock carries a risk field (G.R2); MTR-012 gave matters both priority and risk. Risk scoring is a headline CLM feature (LinkSquares/Ironclad).
- **Decision** — `contracts.priority` (`low|normal|high|urgent`, not null, default `normal`) and `contracts.risk` (`low|medium|high|critical`, nullable = not yet assessed, set by legal during review). Identical enums to matters.
- **Rationale** — Priority orders the review pipeline (matters especially for standalone contracts with no parent matter to carry urgency); risk is the G.R2 field and a standard CLM datum. Same enums as matters means DES-005 pill families map once (grill-plan X.2).
- **Alternatives considered** — Risk only: leaves the review queue ordered by created_at; standalone contracts get no urgency signal. Configurable scales: these drive sorting/branching and cross-module consistency — the fixed-enum carve-out applies, as in MTR-012.
- **Consequences** — Two columns in SCHEMA.md. Grill-plan G.R2 unblocked (existence: keep, first-class column; visualization still X.2).

## CTR-006 — Term & renewal model: typed columns, derived notice deadline, notify-only engine

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — The term/renewal model gates eight blocked screen rows (G.R3, G.R5–R7, I.B2–B5, I.B7) and is the reason small legal teams buy CLM (missed auto-renewals). Also the designated revisit for the derived-dates question deferred in the Matters grill.
- **Decision** —
  - **Storage (typed columns on `contracts`)**: `term_type` (`fixed | auto_renew | evergreen`; code branches on this — expiry behavior, renewal engine, calendar surfaces), `effective_date` (nullable until known), `expiry_date` (null for evergreen), `renewal_period_months` (auto_renew only), `notice_period_days` (nullable).
  - **Derived, never stored**: notice deadline = `expiry_date − notice_period_days`. Surfaces on the renewal calendar and reminders. (Derived dates accepted here — this is the case that earns them.)
  - **Engine is notify-only, never auto-advance** (user override of the auto-advance recommendation): reminders fire at the notice deadline and at expiry; when an auto-renew contract passes its renewal date un-actioned, the record shows a "renewal pending confirmation" state — a human confirms, and only then does `expiry_date` advance (activity-logged per DD-017). The system never mutates term data on its own.
  - Population of these fields can be manual or via AI analysis (CTR-008).
- **Rationale** — Typed columns are required for the engine and calendar to branch; free-text terms can't drive reminders. Notify-only keeps humans the sole writers of legal-state data — Blair prefers the record to await confirmation over the system asserting a renewal happened.
- **Alternatives considered** — Dates-only (no term_type/notice machinery): defers the core CLM value. Term-ledger table (per-term rows): second entity; activity log already preserves history. Auto-advance on renewal date: recommended, declined — record must never change without a human.
- **Consequences** — Five columns in SCHEMA.md. A "pending confirmation" indicator state exists in the UI (contract remains `active` stage; this is a banner/derived state, not a status). Unconfirmed lapses mean the record can show a past expiry on a legally-renewed contract — accepted trade-off. Renewal calendar + reminder surfaces are committed (notifications feature DD to specify delivery). Grill-plan G.R3, G.R5–R7, I.B2–B5, I.B7 unblocked.

## CTR-007 — Renewal routing: user's choice of vehicle

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — When a contract renews (beyond a confirmed same-paper roll), what record represents the new term? Recommended same-record-rolls / renegotiation-= new-contract; Blair widened it: "It should be up to the user. They could theoretically add the renewal as an amendment, child contract, or as a new contract."
- **Decision** — No forced renewal shape. Four supported routes, chosen by the user at renewal time:
  1. **Confirm the roll** — same record, expiry advances (the CTR-006 confirmation flow); for unchanged auto-renewals.
  2. **Amendment** — renewal papered as an amendment on the existing contract (amendment model in the Q11 relations decision).
  3. **Child contract** — new record parented to the original.
  4. **New contract** — standalone successor, linked to the predecessor.
- **Rationale** — Teams paper renewals differently per relationship; the tool records what happened rather than imposing a doctrine. Consistent with MTR-015's no-forced-semantics stance.
- **Alternatives considered** — Same-record always / successor-record always: both impose one doctrine on heterogeneous practice.
- **Consequences** — The Q11 relations model must support amendment and parent/child/renewal link types (pulled forward as the enabler). Renewal reporting must tolerate all four shapes (a renewal is identified by the link/log, not by record shape).

## CTR-008 — AI contract analysis: BYO key, field-schema-driven, auto-fill flagged unverified

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — Volunteered by Blair during the term-model question: "the user [can] add an AI API key in settings that runs full AI analysis of the contract for a schema of contract fields. User can set the field name and we'll have a default prompt per field that they can edit." Previously parked in FUTURE-FEATURES as "AI assistance (BYO-key)"; now in scope for Contracts.
- **Decision** —
  - **BYO API key** configured in settings (OSS-friendly; no bundled key). Provider details (Anthropic-first vs adapter) deferred to the tech-stack grill.
  - **Field-schema-driven**: the analysis target is the contract's field schema — the default/core fields (term fields, counterparty, value, governing law, etc.) ship with **default prompts, editable per field**; users add **custom fields with their own prompts** (per-field `ai_prompt` lives on the field definition — shape finalized in Q12).
  - **Auto-fill, flag for review** (user override of propose-review-accept): analysis writes values directly to the contract's fields, each marked **unverified (AI)** until a human confirms it; confirmation clears the flag; both the write and the confirmation are activity-logged per DD-017.
- **Rationale** — Auto-fill makes bulk onboarding of legacy contracts fast (the dominant use for extraction); the unverified flag preserves the review obligation without blocking on it.
- **Alternatives considered** — Propose→review→accept (recommended, declined — slower for bulk). No AI / future-features parking: overtaken by explicit user request.
- **Consequences** — Settings surface: Contracts → AI Analysis (API key + per-field default prompts). Per-field verification state needs storage (working shape: `contracts.ai_unverified` jsonb map keyed by field slug — evidence/meta per entry, entry removed on confirmation; finalize alongside Q12). **Known tension, accepted**: the CTR-006 renewal engine may fire reminders off unverified AI dates — reminder surfaces should show the unverified badge. Q12 (custom fields) is now partially pre-decided: contracts get a field catalog with per-field prompts. FUTURE-FEATURES entry to be updated (contract analysis no longer parked).

## CTR-009 — Key dates: contract_key_dates, MTR-004 sibling

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — CTR-006's typed term dates cover expiry/notice; contracts also carry ad-hoc dates (price reviews, delivery milestones, option-exercise windows, warranty expiry).
- **Decision** — `contract_key_dates` table, same shape as `matter_key_dates` (date, label, note). Typed term dates stay in their columns; key dates are the free-form escape hatch. Deadline surfaces show the union of term-derived dates and key dates; earliest upcoming = "next deadline".
- **Rationale** — Custom date fields are per-type and single-valued — awkward for N ad-hoc dates on one contract. Same machinery as matters keeps surfaces uniform.
- **Alternatives considered** — Term dates only (custom fields as overflow): single-valued limitation. Typed milestone table: over-modeled.
- **Consequences** — Table in SCHEMA.md. Contract deadline surfaces aggregate three sources: derived notice deadline, expiry, key dates.

## CTR-010 — Contract value: amount + currency + cadence

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — Grill-plan D.6: the mock renders "$120,000 /year" — the cadence needed a backing datum. DES-014 locked formatting (integer cents, ISO 4217, no compact notation).
- **Decision** — `value_amount` (bigint, integer cents), `value_currency` (char(3) ISO 4217), `value_cadence` (`one_time | monthly | annually`) — all nullable as a group (no value recorded is normal, e.g. NDAs). Total-contract-value math (annual × term) is derived, never stored.
- **Rationale** — Cadence makes values comparable in reporting (annualized) and backs the mock's "/year" suffix. A schedule table is payment-tracking territory — overlaps e-billing scope already deferred per MTR-006.
- **Alternatives considered** — Single ambiguous amount: reporting can't compare. `contract_values` schedule table: finance-tool territory.
- **Consequences** — Three columns in SCHEMA.md. Grill-plan D.6 unblocked. AI analysis (CTR-008) targets these as core fields with default prompts.

## CTR-011 — Parties: our entity FK + multi-counterparty join, light counterparty schema

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — Contracts have two sides: our signing entity (Entities module, DD-008) and the counterparty. The counterparty schema TBD was assigned to this grill. The mock (D.5) shows a single counterparty, but tripartite agreements (assignments, novations) exist.
- **Decision** —
  - **Our side**: `contracts.entity_id` FK → `entities.id`, nullable until known — which of our entities signed.
  - **Their side**: `contract_counterparties` join — N counterparties per contract, exactly one flagged `is_primary` (renders in the hero, D.5).
  - **Counterparty schema stays light per DD-008**: `name` (required), `jurisdiction`, `primary_contact_name`, `primary_contact_email`, `address`, `notes`, plus standard timestamps/soft-delete.
  - **Inline light-touch creation**: typing an unknown name during contract/intake creation creates the record with just a name; enrichment is later and optional.
- **Rationale** — Honest recording of multi-party deals without polymorphic FKs (DD-008 convention) or a party-role taxonomy nothing consumes. Light schema + inline create keeps intake friction near zero.
- **Alternatives considered** — Single `counterparty_id`: tripartite deals end up in notes. Polymorphic `contract_parties` with roles: against convention; role taxonomy unconsumed in v1.
- **Consequences** — `counterparties` schema resolved in SCHEMA.md; `contract_counterparties` table added; `contracts.entity_id` added. `parties_view` unchanged. Counterparty AI extraction (CTR-008) targets the primary counterparty name as a core field. Grill-plan D.5 already done; multi-party rendering beyond the primary is a screen-batch concern.

## CTR-012 — Approvals: manual approvers + reusable approver groups, parallel, soft gate

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — When/who/how of contract approval; gates the events card's Decision column (H.C4). Recommended a threshold rule engine; Blair chose a lighter shape: "The user can add manual approvers at approval stage and also set up custom approver groups (templates)."
- **Decision** —
  - **No auto-firing rule engine.** At the approval stage the contract owner adds approvers **manually** — individually and/or by applying a named **approver group**.
  - **Approver groups** are admin-managed templates (Settings → Contracts → Approver Groups): name + member list (e.g. "Commercial sign-off" = GC + CFO). Applying a group **snapshots** its members into approval requests at apply time — later group edits don't touch existing requests.
  - **Parallel**: all pending approvers must approve; no sequential chains in v1.
  - Recorded in `contract_approvals`: approver, source (`manual|group` + group ref), status (`pending|approved|rejected`), note, decided_at, requested_by. This is the datum H.C4 renders.
  - **Soft gate** (recommended, accepted): advancing past approval with pending/rejected approvals warns loudly, is allowed, and is activity-logged as an override — consistent with CTR-001's unrestricted transitions and the signal-not-lock philosophy (MTR-008).
- **Rationale** — Groups capture the recurring 80% ("this is a commercial contract → apply Commercial sign-off") without a rules engine's config surface; in a 2–10 person team the policy holder and the overrider are often the same person.
- **Alternatives considered** — Threshold rule list (recommended, declined — parked to FUTURE-FEATURES as a natural later layer that would *pre-apply* groups). Ad-hoc only: loses reusable templates. Sequential workflow builder: big-team territory. Hard gate: blocks legitimate small-team situations.
- **Consequences** — `approver_groups`, `approver_group_members`, `contract_approvals` in SCHEMA.md. Settings surface added. Grill-plan H.C4 unblocked (Decision column = approval outcomes). Approval-stage UI needs an "apply group" affordance.

## CTR-013 — E-signature: provider adapter, DocuSign first connector, manual fallback

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — How signing integrates (gates grill-plan E.5). Recommended an OSS self-hostable reference provider (Documenso/DocuSeal); Blair corrected the market read: "most places won't run their own self hosted signing and would want a DocuSign connector."
- **Decision** —
  - **Provider-agnostic signing adapter**: send (document + signers) → envelope; webhook status back (signed / declined / voided); executed file auto-filed on the contract; stage advances signature → active on completion.
  - **First connector: DocuSign** (user override — meets teams where their counterparties already sign). Configured in Settings → Contracts → E-signature (API credentials).
  - **Manual hand-off always available, zero config**: set Out for signature → sign anywhere → upload executed PDF → mark Active.
  - Open-source providers (Documenso, DocuSeal) and others (Dropbox Sign, Adobe Sign) are future adapters — parked in FUTURE-FEATURES.
- **Rationale** — The adapter keeps OpenLaw provider-neutral (important for OSS longevity); DocuSign first matches actual usage. Manual fallback means the product works before anyone configures anything.
- **Alternatives considered** — OSS reference provider first (recommended, declined). Manual-only v1: leaves envelope status in the DocuSign inbox. Built-in signing: an entire company's product surface.
- **Consequences** — Signing adapter interface + `contract_envelopes` working table (envelope id, provider, status, sent_at) in SCHEMA.md. Settings surface added. Grill-plan E.5 unblocked. DocuSign OAuth/credential handling lands in the tech-stack grill.

## CTR-014 — Documents: primary version chain, executed pin, generate-redline capability

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — How drafts → redlines → executed relate to the Contract record (gates F.3; the deep file mechanics belong to the Documents grill). Blair accepted the version-chain recommendation and added: "we'll also want the functionality to run a redline against the previous version."
- **Decision** —
  - Each contract designates one **primary document** with an ordered **version chain**; every version is tagged with kind — `draft_ours | redline_theirs | redline_ours | executed | amendment` — plus an optional note.
  - The **executed version is pinned**: it's what previews, exports, and AI analysis (CTR-008) target by default.
  - Loose attachments (schedules, certificates) attach to the contract outside the chain.
  - **Generate-redline capability** (user addition): from any version, the system can produce a comparison against the previous version (Word-compare-style redline artifact, saved into the chain as a generated file). Comparison engine mechanics (OOXML diff vs external tool) → Documents/tech-stack grills, where the existing K.H4 redline-strategy row already lives.
  - **Key clauses (F.3) are not a clause model** — they render AI-extracted fields per CTR-008 (governing law, indemnity cap, etc. as fields with prompts).
- **Rationale** — The ordered chain kills filename archaeology; the executed pin gives every downstream feature one authoritative file; field extraction covers the read-side of clauses without an Ironclad-scale clause library.
- **Alternatives considered** — Loose docs + executed flag: negotiation history as filenames. Clause-level model: heavy parse/storage build v1 doesn't need.
- **Consequences** — `documents` schema (Documents grill) must support: contract primary-doc designation, version ordering, version kind, generated-artifact provenance. Grill-plan F.3 unblocked (renders CTR-008 fields); K.H3/K.H4 stay DOC-gated but now have the contract-side contract to satisfy.

## CTR-015 — Relations: parent_id hierarchy + typed directional links, no inheritance

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — Contract relationships (MSA→SOW trees, amendments, renewal successors). Pulled forward by CTR-007, whose renewal routing requires links that *identify* a renewal. MTR-015 settled the matters sibling with untyped links.
- **Decision** —
  - **Hierarchy**: `contracts.parent_id` — single parent, arbitrary depth, no cycles (application-enforced). MSA → SOWs; substantial amendments as child contracts.
  - **Typed directional links**: `contract_relations(from_contract_id, to_contract_id, relation_type)` with `relation_type` = `related` (symmetric) | `renews` | `amends` (directional). Renewal reporting reads `renews` links (plus confirmed rolls from the activity log) per CTR-007. Minor amendments may instead live as doc-chain versions per CTR-014 — team's choice per case.
  - **No cascade/inheritance semantics** (MTR-015 stance): status, team, confidentiality never flow between related contracts. Inaccessible relatives render as "restricted contract".
- **Rationale** — The type upgrade over MTR-015 is forced by CTR-007: "a renewal is identified by the link, not by record shape". parent_id keeps the most common structure (MSA trees) cheap to query and render.
- **Alternatives considered** — Untyped MTR-015 copy: renewal reporting has no datum. Links-only (no parent FK): MSA trees become graph traversal.
- **Consequences** — `parent_id` column + `contract_relations` table in SCHEMA.md. Duplicate-direction guard (one row per pair per type) application-enforced. Contract details needs hierarchy breadcrumb + relations panel (screen batches).

## CTR-016 — Custom fields: one catalog, module-scoped, with a global tier

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — CTR-008 committed contracts to a field catalog with per-field AI prompts; the open question was catalog shape. Blair: "Matter and Contract fields will mostly be separate.. but certain fields can be across both… (global) like departments, our entity."
- **Decision** —
  - **One `fields` catalog** (renaming `matter_fields` — storage revision to MTR-011; the MTR-011 decision otherwise stands) with `module_scope`: `matter` | `contract` | `global`. Matter-scoped fields attach only to matter types, contract-scoped only to contract types, **global fields attach to both** (e.g. Department, Our entity).
  - **Field types gain `entity`** (picker over our `entities`, like the `user` type) — 9 types total: text, long_text, number, date, boolean, single_select, multi_select, user, entity. `field_type` remains immutable.
  - **`ai_prompt`** (nullable text) lives on the field definition per CTR-008; seeded defaults on contract core fields; editable. Consumed by contract analysis (matter-side AI stays parked).
  - `contract_type_fields` join mirrors `matter_type_fields`, including **`is_required` hard-enforced at creation/re-type** (MTR-014 rule). `contracts.custom_fields` jsonb keyed by slug, values retained on detach.
- **Rationale** — Mostly-separate keeps each module's settings tidy; the global tier means "Department" is defined once and reportable across modules without a coupling free-for-all. One table with a scope column beats three tables with a promote-between-them mechanism.
- **Alternatives considered** — Fully separate catalogs: departments defined twice, cross-module reporting joins on convention. Fully shared single-scope catalog: every field shows up in both settings surfaces.
- **Consequences** — SCHEMA.md: `matter_fields` → `fields` (+ `module_scope`, `ai_prompt`, `entity` type); `contract_type_fields` + `contracts.custom_fields` added; MTR-011 schema section annotated. Settings: the Fields surface becomes shared with per-module views (Matters Settings → Fields shows matter+global; Contracts Settings → Fields shows contract+global). Scope is immutable after creation except matter/contract → global promotion (values already keyed by slug, so promotion is safe); global → narrower is not allowed while attachments exist on the other module.

## CTR-017 — Tasks adopted; contract templates deferred

- **Status** — Accepted
- **Date** — 2026-08-02
- **Context** — Whether contracts adopt MTR-005 tasks and MTR-013 templates. Blair: "Tasks yes, templates later."
- **Decision** — `contract_tasks` as a full MTR-005 sibling (title, is_done, assignee_id, due_date, display_order; task dates do **not** feed deadline surfaces). **Contract templates deferred** to FUTURE-FEATURES (pre-fill + template tasks per type, MTR-013 shape, when real usage shows which playbooks teams want).
- **Rationale** — Standalone contracts need a checklist home (no matter to borrow from). Templates are a layer that benefits from observed usage; unlike matters, contract creation is already heavily pre-structured by type + required fields + approver groups.
- **Alternatives considered** — Both now (recommended, declined). Neither: breaks standalone contracts.
- **Consequences** — `contract_tasks` in SCHEMA.md. FUTURE-FEATURES entry added. MTR-013's template machinery stays matters-only for now.

## CTR-018 — Confidentiality: independent flags, link-time nudge, no cascade

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — MTR-007 flagged the interaction: what happens when a confidential matter links a non-confidential contract (or vice versa)?
- **Decision** — `is_confidential` never flows between linked records — the MTR-015/CTR-015 no-inheritance stance applies to confidentiality too. Users without access see "restricted matter" / "restricted contract" placeholders. One ergonomic aid: creating a link where one side is confidential prompts "make this confidential too?" — a one-time suggestion, never enforcement, and never automatic.
- **Rationale** — A cascade would be the platform's first inheritance rule and immediately raises unanswerable questions (does unlinking un-flag?). The nudge captures the common intent without the trap.
- **Alternatives considered** — Cascade-down with locked flag: breaks the no-inheritance invariant; unlink semantics unanswerable.
- **Consequences** — No schema change. Link-creation flows (contract↔matter, contract↔contract) need the nudge affordance. Restricted-placeholder rendering (already committed in MTR-015) extends to contract surfaces.

## CTR-019 — End of life: signal not lock, MTR-008 sibling

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — What ended (expired/terminated) means operationally, and what "active contracts" counts.
- **Decision** — Ended stage is a **signal, not a lock** (MTR-008 sibling): the record stays fully writable (late executed copies, post-termination notes); it drops out of default list filters, dashboard counts, and renewal-calendar/reminder surfaces; reachable via an "Ended" filter. Default contract lists show all non-ended stages. `ended_at` timestamptz set on transition into the ended stage, cleared on revert (MTR-016 sibling; activity log remains source of truth). `archived_at` stays a separate soft-delete for mistakes/imports — not end-of-life. No retention engine (already parked).
- **Rationale** — Post-end work is routine; locking creates an Admin-unlock dance for no integrity gain the activity log doesn't already provide.
- **Alternatives considered** — Read-only-on-ended: contradicts platform precedent and blocks routine late filing.
- **Consequences** — `ended_at` column in SCHEMA.md. List/count/calendar queries key off stage ≠ ended. Reopening (ended → active et al.) is allowed and logged like any transition.

## Index of decisions

| # | Decision | Status |
|---|---|---|
| CTR-001 | Lifecycle: fixed six-stage backbone + configurable statuses | Accepted |
| CTR-002 | Contract types: configurable list, MTR-001 sibling | Accepted |
| CTR-003 | Numbering: free title + global C-### sequence | Accepted |
| CTR-004 | Owner + team: manager_id + contract_team, MTR-003 sibling | Accepted |
| CTR-005 | Priority and risk: both first-class, MTR-012 sibling | Accepted |
| CTR-006 | Term & renewal model: typed columns, derived notice deadline, notify-only engine | Accepted |
| CTR-007 | Renewal routing: user's choice of vehicle | Accepted |
| CTR-008 | AI contract analysis: BYO key, field-schema-driven, auto-fill flagged unverified | Accepted |
| CTR-009 | Key dates: contract_key_dates, MTR-004 sibling | Accepted |
| CTR-010 | Contract value: amount + currency + cadence | Accepted |
| CTR-011 | Parties: our entity FK + multi-counterparty join, light counterparty schema | Accepted |
| CTR-012 | Approvals: manual approvers + reusable approver groups, parallel, soft gate | Accepted |
| CTR-013 | E-signature: provider adapter, DocuSign first connector, manual fallback | Accepted |
| CTR-014 | Documents: primary version chain, executed pin, generate-redline capability | Accepted |
| CTR-015 | Relations: parent_id hierarchy + typed directional links, no inheritance | Accepted |
| CTR-016 | Custom fields: one catalog, module-scoped, with a global tier | Accepted |
| CTR-017 | Tasks adopted; contract templates deferred | Accepted |
| CTR-018 | Confidentiality: independent flags, link-time nudge, no cascade | Accepted |
| CTR-019 | End of life: signal not lock, MTR-008 sibling | Accepted |
| CTR-002 | Contract types: configurable list, type as policy carrier | Accepted |
