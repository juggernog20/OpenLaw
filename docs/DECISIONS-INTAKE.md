# OpenLaw — Intake & Triage Decision Record

Decisions specific to the intake surfaces (ChatOps, web form, email-to-intake), the `Request` entity, and the triage layer that routes Requests into Contracts or Matters.

The high-level intake architecture was set by `DECISIONS.md` DD-010 (three-channel: ChatOps / magic-link form / email parser) and **revised by INT-001 (2026-08-04)**: capture is structured forms in a magic-link portal (JSM-style); email is outbound-notification-only; ChatOps is parked. Work-model doctrine for what requests convert into is **DD-018**. This file covers the module-level decisions.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `INT-###`.

## Open questions queued for the next grill-me session

_None — queue cleared 2026-08-05 (INT-001 through INT-006, plus platform doctrine **DD-018**); **INT-007** accepted 2026-08-08 from the I1/I2 design review._

Disposition of the former technical queue, per **INT-001**'s form-first revision:

- Email parser / email transports / spam handling — **dropped from v1** (no inbound email; outbound sending is already a tech-stack question). Revive with the FUTURE-FEATURES email-capture entry.
- `ChatAdapter` / Slack specifics — **scope shrunk** to at-most notifications + portal deep-links; parked with the FUTURE-FEATURES ChatOps entry.
- Magic-link mechanics (TTL, reuse, allowlist editor, rate limits) + identity mapping (magic-link email → user record) — now **portal auth**; lands with the tech-stack authentication decision. Working defaults: single-use link, short TTL, session cookie after redemption; allowlist editable in Intake Settings.
- Email filing to existing matters/contracts (`m-42@…` addresses) — inbound email is out of v1; entry moved to FUTURE-FEATURES alongside email capture.

---

## INT-001 — Intake model: JSM-style structured forms + lightweight portal; email for notifications only

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — What a Request is and how it's captured. A five-model landscape comparison (ticket-as-work / JSM envelope+backing-object / chat-bridge capture / one-object / conversation-first) was run. Blair rejected the recommended multi-channel bridge — "too many surface areas to anticipate (slack, email, teams)" — and rejected email-to-intake as capture: "it's critical that certain information is collected in a structured manner.. intake needs to be done through structured forms like JSM."
- **Decision** —
  - **Capture is structured forms, JSM-style**: business users submit through per-request-type forms in a **lightweight portal**. No free-form capture channels create requests.
  - **The portal is the requester's home**: authenticated via DD-010's magic-link + domain-allowlist mechanics (no accounts/passwords); requesters see their requests, status, and a conversation thread on each; legal's replies land there. Resolve-in-thread happens on this thread and is recorded.
  - **Email is outbound only**: host-configurable email notifications on request creation and updates, deep-linking back to the portal (magic link). No inbound email parsing creates requests.
  - **Request is an envelope, not a work container** (JSM split): no tasks/team/key dates; real work converts to a matter or contract, the request links to what it became, and the requester keeps their portal view.
  - **Lifecycle (fixed enum, code branches)**: `new → in_review → converted | resolved | declined`; `archived_at` separate. _Revised by INT-007 (2026-08-08): `in_review` removed — lifecycle is `new → converted | resolved | declined`._
  - **DD-010 is revised**: the three-channel capture architecture (ChatOps primary / form / email parser) narrows to **form-first**. Email-to-intake is dropped from v1 (future candidate with parse-to-form-prefill). The ChatAdapter/Slack ambition shrinks from capture+bridge to, at most, notifications and deep-links to the portal form — scope to be set if/when v1.5 revisits it.
- **Rationale** — Structured collection at the door beats parsing unstructured messages out of N channels; one well-built portal is maintainable by an OSS project where per-channel bridges are not. JSM is the proven reference architecture, and the legal intake-first generation follows the same request→convert split.
- **Alternatives considered** — Conversational envelope with bidirectional Slack/email bridging (recommended, declined — surface-area anticipation cost). Thin ticket without conversation: answers evaporate. Ticket-as-work: duplicates matters/contracts. Email-to-intake as capture: unstructured.
- **Consequences** — DD-010 annotated in DECISIONS.md. The portal is a real v1 build surface (submission forms + my-requests + threads). Email sending infrastructure is required (tech-stack queue already has it); email _receiving_ drops out of v1 scope. Request types + form definition become the next structural question. FUTURE-FEATURES: email capture with AI prefill; ChatOps capture.

## INT-002 — Request types mapped to target types; forms reuse the fields catalog

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — INT-001 made structured per-type forms the only capture; this defines them.
- **Decision** —
  - **`request_types`** — admin-configurable (Intake Settings → Request Types; MTR-001 machinery: slug, display name, description, display order, archive). Each optionally **targets a matter type or contract type** (or no target, e.g. "Legal question").
  - **The portal form** for a request type = standard basics (summary, description, attachments, **urgency** — requester-supplied, `low|medium|high|critical` _(levels per **DES-018**'s severity-ramp canon; originally `low|normal|high|urgent`)_, mapping 1:1 to `priority` on conversion per MTR-012; `risk` is never requester-set) + **attached catalog fields** via `request_type_fields` (CTR-016 `fields` whose scope matches the target module, or `global`), each with display order and required flag.
  - **Collected values carry through conversion** — they land in the converted matter/contract's real fields, no re-keying; MTR-014's hard-required fields can be satisfied at the door when the form collects them.
  - **Request attachments** are lightweight uploads on the request (`request_attachments`), promoted into `documents` (owned by the new matter/contract per DOC-008) at conversion — requests are not document owners.
  - Requests get **R-### numbering** (global sequence, MTR-009/CTR-003 sibling).
- **Rationale** — Reusing the fields catalog is the JSM request-field→issue-field mapping done with machinery we already have; it's what makes "structured collection" survive the handoff.
- **Alternatives considered** — Independent per-type form builder: re-keying at conversion. One generic form: collects nothing structured.
- **Consequences** — `request_types`, `request_type_fields`, `request_attachments` + `requests` core columns in SCHEMA.md. Settings surface added. Conditional form logic (Q6) would layer on `request_type_fields` if ever adopted.

## INT-003 — Requester updates: email notifications only; no status-poke button

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — Whether the portal gets a LawVu-style "Request a status update" button. Blair: "No — notifications suffice."
- **Decision** — Requesters receive host-configurable email notifications (creation + status changes, deep-linking to the portal per INT-001) and can reply in the request thread. No dedicated poke affordance.
- **Rationale** — The thread already allows asking; a throttled button adds an affordance without adding a capability.
- **Alternatives considered** — Throttled poke (recommended, declined).
- **Consequences** — Notifications feature DD (still unopened) covers delivery mechanics. Nothing schema-side.

## INT-004 — Deflection links panel in v1; conditional form logic stays deferred

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — The research-queued deflection layer and conditional-logic question.
- **Decision** — Admin-configurable links panel ("Before you submit…") on the portal home and optionally per request type — plain links (FAQ, policies; Knowledge items when that module lands). Conditional show/hide form logic remains deferred with the MTR-014 FUTURE-FEATURES entry (one entry covers matter forms and intake forms).
- **Rationale** — Deflection is the highest-leverage intake win at near-zero cost; the conditional-logic engine is not.
- **Alternatives considered** — Nothing (loses free deflection); building conditional logic now (reverses MTR-014's deferral).
- **Consequences** — `intake_links` (id, label, url, request_type_id nullable = home panel, display_order) — settings-managed. Settings inventory row added.

## INT-005 — No auto-classification: the form is the classification

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — Whether v1 classifies inbound requests automatically.
- **Decision** — None. INT-001/002 dissolved the problem: the requester picks a request type and fills its structured form; there is no unstructured inbound to classify. AI intake assist (type suggestion, attachment extraction) stays parked in FUTURE-FEATURES (BYO-key pattern).
- **Rationale** — No AI dependency on the adoption-critical path; the type picker already does the job.
- **Alternatives considered** — AI type-suggestion at submission: marginal gain, real dependency.
- **Consequences** — None schema-side. Revisit only alongside the parked email-capture + AI-prefill future feature.

## INT-006 — Triage: one Inbox, pickup assignment, four actions, lossless re-convert

- **Status** — Accepted; assignment mechanic and Inbox scope revised by INT-007
- **Date** — 2026-08-05
- **Context** — The triage flow, resolved after the work-model research landed as **DD-018**. Every researched product — regardless of object model — runs a single triage queue with routing pre-encoded, not human-classified.
- **Decision** —
  - **The Inbox** (first nav slot — settles grill-plan B.1's lean) lists ~~`new` and `in_review`~~ requests, ordered by urgency then age. Member+ triages. _(Revised by **INT-007**: the Inbox lists `new` requests only — `in_review` no longer exists.)_
  - ~~**Pickup assignment**: `requests.assigned_to` (nullable FK → users) — picking a request up sets it and moves status to `in_review`.~~ _(Superseded by **INT-007**: no assignment step, no persisted intermediate status, and `requests.assigned_to` is dropped — acting on a request means choosing its disposition then and there.)_ No routing rules or rotation config in v1.
  - **Four actions**: **Convert** (target and type pre-selected from the request type per INT-002/DD-018 — triage confirms, never classifies; collected values pre-filled; MTR-014 required-field gaps prompted; MTR-013 template applicable for matters), **Re-target** (the exception path: convert to the _other_ kind — lossless, request survives as the portal shell per DD-018 rule 5), **Resolve** (reply in thread, close), **Decline** (reason required, requester notified).
  - No bulk triage and no auto-triage rules in v1.
- **Rationale** — Pickup beats a designated triage owner for a 2–10 person team (no bottleneck, no rotation config); the four actions are the complete set of honest outcomes for a request.
- **Alternatives considered** — Single triage owner: bottleneck + config. Per-request object-kind choice: rejected by DD-018 and by every researched product's happy path.
- **Consequences** — ~~`requests.assigned_to` in SCHEMA.md~~ _(removed by **INT-007**)_. Inbox screen is a v1 build surface (nav slot 1). Grill-plan B.1 resolvable as Inbox.

## INT-007 — Disposition-at-pickup: triage decides the outcome; no parked in-review state

- **Status** — Accepted
- **Date** — 2026-08-08
- **Context** — Design review of the Inbox/detail mocks (I1/I2). Under INT-006's pickup model, an assigned request sat in the Inbox as `in_review` with no forcing function — it could linger indefinitely, and an assigned-but-undispositioned row read as a duplicate of the matter/contract it would eventually become. Blair: assignment should require conversion. The strict form ("assigned ⇒ must convert") collides with INT-002's no-target request types and the Resolve/Decline outcomes, so it was refined to disposition-at-pickup.
- **Decision** —
  - **There is no assignment step and no parked state.** Acting on a request from the Inbox means choosing its outcome then and there: **Convert** / **Resolve** / **Decline** (Re-target remains the exception path inside Convert, per INT-006/DD-018).
  - **The Inbox row affordance is an Assign button** (2026-08-08 follow-up): it assigns the triager and immediately opens the disposition flow. Assignment is not a persisted intermediate status — cancelling the flow returns the request to the queue untouched.
  - **Lifecycle (revises INT-001)**: `new → converted | resolved | declined`; `in_review` is removed; `archived_at` separate.
  - **The Inbox lists `new` requests only** — it is exactly the undispositioned queue. A toggle reveals triaged (converted/resolved/declined) requests.
  - A substantive legal question doesn't linger: per DD-018, real work converts — it becomes a matter. Trivial ones are answered in the thread and resolved.
  - Clarifying back-and-forth with the requester remains possible while a request is `new` (the portal thread is live from submission); replying does not change status.
  - **`requests.assigned_to` is dropped.** Who dispositioned a request is audit data on the conversion/resolution/decline event, not a live assignment.
- **Rationale** — Nothing can rot in an intermediate state; the Inbox reads truthfully as "requests whose fate is undecided"; a request and its converted object never coexist as live work items.
- **Alternatives considered** — Claim-then-convert deadline (keep `in_review`, escalate age-since-assignment): keeps the limbo state, only softens it. Strictly forced conversion on assignment: breaks no-target request types and Decline.
- **Consequences** — INT-001's lifecycle enum and INT-006's pickup mechanic annotated as revised. SCHEMA.md: `assigned_to` removed, `status` enum shrinks. Inbox mock loses Status/Assignee columns but keeps a per-row Assign button as the entry to disposition; request-detail hero loses Assignee; the subbar's Convert/Resolve/Decline actions are the whole triage surface. Trade-off accepted: no claim mechanism to signal "I'm reading this" — fine at 2–10 person team scale; revisit if duplicate triage effort shows up in practice.

## Index of decisions

| # | Decision | Status |
| --- | --- | --- |
| INT-001 | Intake model: JSM-style structured forms + portal; email notifications only | Accepted; lifecycle revised by INT-007 |
| INT-002 | Request types mapped to target types; forms reuse the fields catalog | Accepted |
| INT-003 | Requester updates: email notifications only; no status-poke button | Accepted |
| INT-004 | Deflection links panel in v1; conditional form logic stays deferred | Accepted |
| INT-005 | No auto-classification: the form is the classification | Accepted |
| INT-006 | Triage: one Inbox, pickup assignment, four actions, lossless re-convert | Accepted; revised by INT-007 |
| INT-007 | Disposition-at-pickup: triage decides the outcome; no parked in-review state | Accepted |
