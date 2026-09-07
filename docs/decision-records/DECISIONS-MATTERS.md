# OpenLaw — Matters Module Decision Record

Decisions specific to the Matters module. Platform-level decisions that apply across all modules (data model, role model, intake, activity tracking, etc.) live in `DECISIONS.md` and are referenced by ID where relevant.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `MTR-###`.

## Open questions queued for the next grill-me session

Queued 2026-08-07 from the matters.pen ↔ decision-record audit — mock drift that needs a decision rather than a silent strip:

1. ~~**Key-date owner** — M5 mocks an Owner column per key date; **MTR-004** modeled key dates as `date + label + note`.~~ **Resolved by M23/3 (#491):** the Owner column is stripped. A Key date remains date + label + optional note, with no owner and no per-date schedule.
2. ~~**Close dialog "Resolution" and closing note** — M10 mocks a Resolution select ("Completed") plus an optional closing note; **MTR-002**/**MTR-008** define closing as moving to a closed-category status, with no resolution concept.~~ **Resolved by M23/7 (#495):** the dialog asks only for one live closed-Category Status. Resolution and closing note are out; no field, payload, or control is created for either.
3. ~~**Template key dates** — M8 mocks "Template adds 4 tasks and 2 key dates"; **MTR-013** template content is pre-fill values + tasks only.~~ **Resolved by M24/4 (#514):** templates carry ordered relative Key dates with a required day offset, label, and optional note. Applying one resolves each date from the Matter creation date.
4. **"My matters" / "matters I'm on" affordance** — **MTR-003** defines both views; M1 offers only a Manager filter chip and Saved views. Decide: first-class views, saved-view presets, or filter-chip-only.

> The M18 Time tab surfaced in the same audit is deliberately not queued here per direction 2026-08-07.

---

## MTR-001: Matter type taxonomy — configurable enum, seeded with 9 default types, Admin-managed

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

Every matter needs a categorical type for filtering, segmentation, and reporting. The choice was between hardcoding the enum in code (tractable but rigid) and making it admin-configurable (flexible but requires a settings surface).

The first instinct was to lock a fixed enum because "type drives downstream behavior" (per-type lifecycle, per-type fields, per-type access). On inspection, that argument falls apart — lifecycle states, field tags (`business | legal` per **DD-015**), and access (per **DD-013** / **DD-014**) are independent dimensions. Type ends up being purely metadata: filter pivot, dashboard segmentation, and an intake disambiguator. Once the dependent-behavior argument is gone, fixed-enum has no real upside left for an OSS-deployable tool with heterogeneous adopters.

### Decision

**Configurable matter types**, stored in a `matter_types` table, seeded at install with 9 default rows, managed by Administrators via a Matters Settings surface.

Default seeded types:

| Slug         | Display name | Notes                                                            |
| ------------ | ------------ | ---------------------------------------------------------------- |
| `employment` | Employment   | Terminations, severance, harassment investigations, non-competes |
| `litigation` | Litigation   | Lawsuits, threats, demand letters, subpoenas                     |
| `regulatory` | Regulatory   | Agency inquiries, audits, license issues                         |
| `commercial` | Commercial   | Bespoke deals, complex MSAs, matter-wrapped contracts            |
| `corporate`  | Corporate    | Board matters, equity issuances, governance, M&A                 |
| `ip`         | IP           | Trademark filings, patent strategy, infringement                 |
| `privacy`    | Privacy      | GDPR/CCPA, breach response, data-subject requests                |
| `advisory`   | Advisory     | One-off questions ("can we do X?")                               |
| `other`      | Other        | Long-tail catch-all (system-protected — cannot be hard-deleted)  |

Schema (full DDL captured in `SCHEMA.md`):

- `matter_types(id, slug, display_name, description, display_order, is_system_default, archived_at, created_at, updated_at)`
- `slug` is stable for analytics + URLs and is **not** user-editable after creation; `display_name` is.
- `is_system_default = true` marks seed rows; the `other` row carries an additional protection preventing hard-delete.
- `archived_at` enables soft-delete; archived types are hidden from the new-matter picker. (_Per **SET-003**'s archive guard, in-use types are bulk-reassigned before archiving, so existing matters never carry an archived type._)

Behavior:

- Admins add, rename, reorder, and archive types via Matters Settings.
- ~~Archiving a type that is in use prompts an optional bulk-reassign step ("Move 14 existing matters to: Other ▾"). If skipped, existing matters keep their archived type for historical fidelity.~~ _Superseded by **SET-003** (2026-08-05), the cross-module archive guard: archiving an in-use type shows the live-usage count and **requires** a reassignment target — existing matters no longer keep an archived type._
- `matters.matter_type_id` is non-null at creation. ~~Intake (per **DD-010**) collects type at submission or defaults to `advisory` (lowest-commitment default; Member triage assigns the real type at handoff).~~ _Revised by **INT-001/INT-002** (2026-08-04): intake captures a structured request type, not a matter type; the triaging Member picks the final matter type at Convert (request types may suggest a default target)._
- Re-typing an existing matter is restricted to Member+ (Contributors cannot per **DD-015**) and audit-logged per **DD-017**.
- Type CRUD writes audit-log entries per **DD-017**.

### Rationale

1. **OSS-deployable means heterogeneous practice mixes.** Fintechs add Regulatory weight; hardware companies add IP and Supply contracts; non-profits add Tax and Grants. Hardcoding the enum forces every deployment into the same buckets and creates a permanent rename request backlog.
2. **Type is metadata, not behavior.** It does not drive lifecycle states (independent dimension), field visibility (per-field `business | legal` tag per **DD-015**), or access (per **DD-013** / **DD-014**). Decoupling type from behavior removes the "fixed enum is more tractable" argument that motivated the original recommendation.
3. **The `Other` system-protected row guarantees a fallback.** No team is forced to invent a category at intake when the type isn't yet known; no archive operation can leave a matter typeless.
4. **Slug-vs-display-name split protects analytics and integrations.** Users can rename "Employment" to "People Ops" without breaking dashboards, exports, or URL stability.
5. **Soft-delete (archive) preserves historical type assignments** without polluting the picker — important for a system whose matters can outlive any single GC's preferred taxonomy.

### Alternatives considered

- **Fixed enum in code** (the original recommendation, rejected by the user) — rigid for an OSS-deployable tool with heterogeneous adopters; the "drives behavior" argument fell apart on inspection.
- **No types, free-form tags only** — rejected; tags are too soft to drive a primary filter / dashboard segmentation, and reporting becomes inconsistent across deployments.
- **Hard-delete with cascade-to-Other** — rejected; loses historical type assignments. Soft-delete + optional bulk-reassign covers the same intent without data loss.
- **Per-team or per-user type sets** — rejected; over-engineered for the persona, fragments analytics, no real demand.

### Consequences

- New `matter_types` table; seeded by an install-time migration. Schema captured in `SCHEMA.md`.
- `matters.matter_type_id` is a non-null foreign key.
- **Requires Matters Settings UI** — first concrete configurability surface in the product. The cross-cutting Settings architecture (IA placement, permission model, audit treatment, preview/rollback semantics) is a separate decision class queued in `DECISIONS-SETTINGS.md`, to be grilled after the per-module decisions wrap.
- Intake (DD-010) must surface a type picker on the Slack modal and web form. Email-parsed requests where type is hard to infer default to `advisory`.
- Tags are a separate concept (queued in open questions above) — they handle finer slicing within a type.
- Reporting / dashboards must group by `matter_type.slug`, not by display name (display name is mutable).

### Settings touchpoints

- **Matters Settings → Types** — list view with add / rename / reorder / archive actions; in-place edit for display name and description; system-default and `other` rows display a lock icon.

### Addendum (2026-08-23, M22 close, [#474](https://github.com/juggernog20/OpenLaw/issues/474)) — the taxonomy now names records

M22 shipped the nine seed rows, the Administrator's Types pane and type editor, and the non-null `matters.matter_type_id` reference. The create and re-type writes lock the selected live type; re-type retains values whose fields the new type does not attach. The live-usage count is now a count of reachable records rather than the placeholder the settings machinery carried before matters existed, and archiving an in-use type requires SET-003's reassignment.

---

## MTR-002: Matter lifecycle — fixed open/closed system dimension + configurable status labels

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

Matters need a lifecycle state for filtering ("active matters"), workload views, SLA behavior, and archive eligibility. The tension: the project's configurable-over-fixed default (per **MTR-001** and the platform pattern) pulls toward admin-defined states, but lifecycle genuinely drives code branches — default list filters, deadline clocks, close/archive affordances — which is exactly the documented carve-out where fixed enums are allowed.

### Decision

**Two-layer model** (Jira status-category shape):

1. **Fixed system dimension: `open` | `closed`.** This is the only value application code branches on: default matter-list filter (open), "active matters" counts, SLA/deadline stop-clock, archive eligibility, close affordances.
2. **Configurable status labels** layered on top. Each label maps to exactly one system category. Stored in a `matter_statuses` table with the MTR-001 machinery (slug, display name, display order, archive, system-default protection). Seeded at install:

| Slug          | Display name | Category |
| ------------- | ------------ | -------- |
| `open`        | Open         | open     |
| `in_progress` | In Progress  | open     |
| `on_hold`     | On Hold      | open     |
| `closed`      | Closed       | closed   |

1. **Global status set in v1**, not per-type. Per-type state machines are explicitly rejected.

Behavior:

- Admins add / rename / reorder / archive statuses via Matters Settings; each new status must pick a category at creation. Category is immutable after creation (changing it would silently rewrite history semantics for existing matters).
- At least one status per category must remain unarchived; the seed `open` and `closed` rows are system-protected (same protection pattern as the `other` matter type).
- New matters default to the first `open`-category status by display order.
- Status changes are Member+ (Contributors cannot, consistent with re-typing per **MTR-001**) and audit-logged per **DD-017**.
- Moving a matter to any `closed`-category status is "closing" it; what closing preserves/redacts is a separate queued decision (closing/archiving).

### Rationale

1. **Code branches on two values, not N.** Every downstream feature ("show my active matters", stop the SLA clock, allow archive) needs a reliable binary; admin-editable labels can't provide that.
2. **Teams disagree on stages, not on open-vs-closed.** One team wants "Awaiting Business Input", another "With Outside Counsel" — all map cleanly onto open/closed.
3. **Consistent with MTR-001** — same table machinery, same settings surface, same slug/display-name split, same protections. One pattern to learn.
4. **Per-type machines rejected** as a Jira-complexity trap for a 2–10 person team: heavy admin surface, migration pain when types change, near-zero payoff at this scale.

### Alternatives considered

- **Fixed enum only** — simplest, but forfeits the real demand for custom stage labels and contradicts the configurability pattern for what is (beyond the binary) just metadata.
- **Fully configurable states, no system dimension** — code can't reliably determine "is this matter active/closed"; every feature would need per-deployment status mapping.
- **Per-type state machines** — rejected per rationale 4.

### Consequences

- New `matter_statuses` table + install-time seed migration; `matters.status_id` non-null FK. Schema captured in `SCHEMA.md`.
- Second concrete configurability surface: **Matters Settings → Statuses** (sibling of → Types per MTR-001).
- Status pills on screens render the configurable display name; pill color family maps from the **category** (per **DES-005** paired status-pill families), so admin-created statuses get sane colors for free.
- **MTR-008** defines what happens when a matter enters a `closed`-category status: closing is a signal, not a lock — the record stays writable; archiving is a separate action.
- Reporting groups by `matter_statuses.slug` and/or category, never display name.

### Settings touchpoints

- **Matters Settings → Statuses** — list view with add / rename / reorder / archive; category picker (open/closed) at creation, immutable after; seed `open` and `closed` rows show the lock icon.

### Addendum (2026-08-23, M22 close, [#474](https://github.com/juggernog20/OpenLaw/issues/474)) — both lifecycle layers are live

M22 shipped the four seed statuses, the Statuses pane, and the record's status control. Category is immutable, every transition remains allowed, and the application branches only on `open | closed`: the list opens on open records, the header counts open and on-hold work, and the write maintains `closed_at`. At least one live row in each category remains, the seed `open` and `closed` rows are protected, and an in-use archive requires reassignment. A closed matter stays writable; archive remains a separate act.

---

## MTR-003: Matter assignment — one Matter Manager, plus legal team members added as needed

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

Every matter needs an ownership answer: single primary owner vs multiple assignees vs a formal lead/supporting staffing model. `matter_team` (per **DD-014**/**DD-015**) already existed with an `assignee` role whose compound key technically permitted multiple assignees.

### Decision

**One Matter Manager per matter**, who can add other legal team members to the matter as needed.

- **Matter Manager** is the product term for the single owner. Stored as `matters.manager_id` — a single nullable FK → `users.id`.
- `manager_id` is **nullable**: null = unassigned, a real state — intake per **DD-010** creates work before anyone picks it up; the triage queue surfaces unassigned matters.
- Other legal team members are added via `matter_team` with role `member`. The `assignee` role is **removed** from the `matter_team` enum (promoted to the column); `member` replaces it for supporting legal staff. `watcher` / `creator` / `contributor` are unchanged.
- "My matters" = `manager_id = me`; a separate "matters I'm on" view unions `matter_team` membership.
- Changing the Matter Manager is Member+ and audit-logged per **DD-017**.
- The Matter Manager and all `matter_team` rows count as team membership for **DD-014** confidential-matter access.

### Rationale

1. **Single-owner accountability is the point at 2–10 people.** "Whose desk is this on" must have exactly one answer; workload views and "My matters" become trivially correct.
2. **Co-working is membership, not shared ownership.** A second attorney helping out joins as `member` — full participation without blurring accountability.
3. **Nullable beats fake ownership.** Forcing an owner at creation makes intake lie (auto-assigning whoever triages); explicit "unassigned" keeps the triage queue honest.

### Alternatives considered

- **Multiple assignees** (`matter_team` role, several allowed) — rejected; blurs accountability, ambiguates "my matters".
- **Formal lead + supporting-attorney roles** — rejected; law-firm staffing machinery a small in-house team doesn't need. `member` covers supporting staff without ceremony.

### Consequences

- `matters.manager_id` nullable FK added; `matter_team` role enum becomes `member | watcher | creator | contributor`. Schema updated in `SCHEMA.md`.
- The same shape was adopted for Contracts by **CTR-004**: `contracts.manager_id` (UI label "Owner") + `contract_team` with the identical role enum.
- UI: matter header shows the Matter Manager avatar/name; unassigned matters show an explicit "Unassigned" affordance, not an empty gap.
- Intake handoff (per **DD-010**) sets the Matter Manager at triage, not at submission.

### Addendum (2026-08-23, M22 close, [#474](https://github.com/juggernog20/OpenLaw/issues/474)) — one owner and one roster, built

`manager_id` shipped nullable and independently editable, with an explicit Unassigned rendering on the record and list. The list's Manager filter accepts a person or `me`, which is the first-class "my matters" answer for this surface. `matter_team` shipped with `creator | member | watcher | contributor`; the creator row is written at birth and cannot be removed, while Member+ can maintain the other three in the Team applet. Conversion deliberately creates an unassigned matter and adds only the triager's creator row, so intake does not invent ownership.

---

## MTR-004: Deadlines — first-class named key dates; SLA engine deferred to future

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

"Don't miss the date" is core to legal work, and matters routinely carry several hard dates at once (filing deadline, hearing, statute of limitations). The question was how much deadline machinery v1 gets: nothing, a single due date, named key dates, or a full SLA engine.

### Decision

**First-class named key dates; no SLA engine in v1.** The SLA engine is explicitly wanted for the future and is recorded in `FUTURE-FEATURES.md`.

- New `matter_key_dates` table: a matter has zero-to-many entries of `date` + `label` + optional `note` (e.g., "Response to demand letter due", "SOL expires", "Preliminary hearing").
- The earliest upcoming key date surfaces in matter lists and dashboards as **"next deadline"**; overdue dates render via the **DES-005** status-pill families; dates format per **DES-014**.
- Statute-of-limitations tracking gets no special machinery — it is a key date with an appropriate label.
- Approaching-date notifications plug into the cross-cutting notifications capability (**DD-005**) when that surface is designed — no bespoke reminder system here.
- Key-date CRUD is Member+ (Contributor writes per **DD-015** field-tag rules TBD in that grill) and audit-logged per **DD-017**.

### Rationale

1. **Multiple hard dates are the norm**, so a single `due_date` column loses exactly what a legal tool must not lose.
2. **SLA engines measure throughput; small teams need to not miss dates.** Response-time targets, breach clocks, and business-hours calendars are big-team ops tooling — deferred, not rejected.
3. **The shape is SLA-forward-compatible**: a future SLA layer computes against key dates and MTR-002 status categories (On Hold pause semantics) without remodeling.

### Alternatives considered

- **Single optional `due_date`** — rejected; collapses concurrent hard dates.
- **Key dates + SLA engine now** — deferred to `FUTURE-FEATURES.md`; heavy for the 2–10 person persona in v1.
- **No deadline fields** — rejected; core to the domain.

### Consequences

- New `matter_key_dates` table in `SCHEMA.md`.
- New `docs/FUTURE-FEATURES.md` parking lot created (first entries: SLA engine, plus pre-existing deferrals DD-005 reporting destination and DES-010 Cmd-K).
- Matter list/detail screens need a "next deadline" affordance; the events-card pattern in the contract mock (region H) is the likely shared component.
- Resolved in the Contracts grill: renewal/expiry/notice dates got their own typed columns with a derived notice deadline (**CTR-006**), and ad-hoc contract dates reuse this table's shape as `contract_key_dates` (**CTR-009**).

### Implementation note (2026-08-23, M23/3, [#491](https://github.com/juggernog20/OpenLaw/issues/491))

`matter_key_dates` landed as the M16 sibling promised: one civil date, a trimmed label, and an optional trimmed note, with no owner, per-date schedule, special statute-of-limitations type, or SLA behavior. The record keeps every row through closing and archiving; only an open, non-archived Matter marks a Next deadline or enters the morning round. Closing remains writable, reopening reactivates still-future dates, and archiving alone freezes mutations. Matter reach is the read wall, while the reminder audience is the Matter Manager and explicit team roster narrowed through that wall again at send time.

### Addendum (2026-08-24, M23 close, [#496](https://github.com/juggernog20/OpenLaw/issues/496))

The deployer journey now proves that same date on the real Matter record and the cross-slice suite keeps the boundary explicit: reached Contributors may read Key dates but never mutate them, closed Matters retain writable dates while contributing none to active deadline surfaces, and archived Matters freeze them. No owner, template date, derived date, or per-date reminder contract was added.

---

## MTR-005: Tasks — lightweight checklist, not a task entity

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

Matters need some way to track "who's doing which piece of this, and is it done". The spectrum runs from nothing, through a checklist, to a full task entity with its own lifecycle, comments, and activity.

### Decision

**Lightweight checklist**, GitHub-task-list weight. New `matter_tasks` table: `title`, `is_done`, optional `assignee_id`, optional `due_date`. That is the whole model.

- No task-level comments, no statuses beyond done/not-done, no sub-tasks, no task detail page. A task is a row in a list on the matter; discussion about it happens in the matter's comment thread per **DD-016**.
- Task due dates are deliberately **separate from MTR-004 key dates**: key dates are external/legal deadlines and surface in lists and dashboards; task dates are internal to-dos and stay inside the matter.
- Task CRUD and toggling are audit-logged per **DD-017** at feed (not admin) visibility.

### Rationale

1. **Highest-value, lowest-cost coordination primitive** for a 2–10 person team.
2. **A full task entity duplicates matter machinery one level down** — that's project-management software. If a piece of work is big enough to need its own thread and lifecycle, it should be its own matter.
3. **Keeping task dates out of deadline surfaces** protects the "next deadline" signal (MTR-004) from being diluted by internal to-dos.

### Alternatives considered

- **Full task entity** (own status, comments, activity) — rejected per rationale 2.
- **No tasks in v1** — rejected; the checklist is cheap and the coordination need is real.

### Consequences

- New `matter_tasks` table in `SCHEMA.md`.
- Matter detail screen needs a tasks section (checklist affordance); counts (e.g., "3/7 done") can use `--badge-count-*` per **DES-005**.
- Whether Contracts gets the same checklist is a Contracts-grill question (likely yes via the same table shape).
- If richer tasking demand emerges post-v1, it graduates via `FUTURE-FEATURES.md` — do not grow this table into a task entity ad hoc.

### Implementation note (2026-08-24, M23/4, [#492](https://github.com/juggernog20/OpenLaw/issues/492))

Matter Tasks landed as the same flat checklist discipline proven on Contracts, with deterministic manual order and completed/total counts on the Matter record. Member+ can add, edit, reorder, complete, reopen, and remove Tasks through Closing; Archiving alone freezes the checklist. Contributors who reach the Matter read the same rows but receive no mutation controls and every write route refuses them.

Assignment is deliberately narrower than reach: the assignee must be active and already be the active Matter Manager or represented on the Matter team. Assignment does not create team membership, team removal remains independent, and a newly handed-off Task raises the existing direct-assignment notification through the Matter reach wall. Task due dates remain civil, date-only internal targets and are absent from both Next deadline and the morning approaching-date round.

### Addendum (2026-08-24, M23 close, [#496](https://github.com/juggernog20/OpenLaw/issues/496))

The close pass confirms Tasks as one section of the Matter rather than a parallel record: the four platform roles receive their existing Matter reach answer, only Member+ can mutate the checklist, assignment raises the direct-assignment notification, and Closing does not freeze it. Task dates still have no deadline or reminder behavior, and templates remain M24's work.

---

### UX review addendum (2026-09-05): Explicit team expansion from Tasks

The shared Task assignee picker follows CTR-017's UX review addendum: avatar and name on each row, searchable active team members and the Matter Manager, and an explicit **Add someone to the team… → Add to team and assign** flow. This supersedes the earlier restriction that assignment never creates membership: an explicit request now adds the person and assigns the Task atomically, subject to the existing confidential-team permission. Ordinary assignment still requires an existing team member or Manager. Add/edit forms save both changes only on Task Save; cancellation grants no access. Clearing or changing the assignee leaves team membership intact.

The Team panel groups entries by person: one avatar and name, with every held role shown as a tag, including Matter Manager and Creator. A removable role has its own remove control; removing it leaves the person’s other roles intact. Creator and the record’s responsible role remain informational tags.

## MTR-006: External counsel — collaboration via Contributor role; fee tracking deferred

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

Outside counsel touch matters in two distinct ways: participating in the work (documents, comments, status) and costing money (budgets, invoices, e-billing). The question was which of these v1 supports.

### Decision

**Collaboration yes, money no (for now).**

- External counsel who need to participate join as ordinary users with the **Contributor** role per **DD-013** — scoped to matters they're added to (via `matter_team` per **MTR-003**), subject to **DD-016** comment tiers and **DD-014** confidentiality. No new roles, tables, or machinery.
- All outside-spend functionality — budgets, accruals, invoice review, UTBMS/LEDES e-billing — is **out of scope for v1** and recorded in `FUTURE-FEATURES.md`.

### Rationale

1. **The Contributor role already fits** external counsel exactly: matter-scoped access, no browse rights. Zero-cost win.
2. **E-billing is an entire product category** (SimpleLegal, Brightflag) — it would dominate the roadmap and drags in AP-system integrations.
3. **Manually-maintained money fields mislead** — a half-measure (budget + spend-to-date columns) goes stale and gives false confidence; better to have nothing than wrong numbers.
4. Nothing in the current model blocks a future spend module; it would attach to matters and (likely) a law-firm flavored counterparty record.

### Alternatives considered

- **Basic fee fields on matters** — rejected per rationale 3.
- **Full e-billing** — deferred per rationale 2.
- **External counsel fully out of scope** — rejected; forfeits the free win from the existing role model.

### Consequences

- No schema changes.
- `FUTURE-FEATURES.md` gains an outside-counsel spend / e-billing entry.
- Onboarding docs should note the pattern: invite outside counsel as Contributors, add them to their matters.
- A future spend module may want a way to mark a user or counterparty as a law firm — noted in the future-features entry, not modeled now.

### Addendum (2026-08-24, M23 close, [#496](https://github.com/juggernog20/OpenLaw/issues/496))

The shipped external-counsel path is the ordinary Contributor path end to end: invite one user, add one `contributor` team row, then use DD-015's business-Field, supporting-Document, comment, and read permissions on that reached Matter. There is no law-firm record, counsel subtype, budget, invoice, or spend field hidden behind the label.

---

## MTR-007: Matter ↔ Contract — contracts standalone by default, linked to a matter when part of broader work

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

**DD-007** fixed the data model (`contracts.matter_id` nullable FK — contracts can stand alone). This decision fixes the working rule and UX for when a contract lives inside a matter.

### Decision

Contracts can be **both**: standalone where no matter work is needed (e.g., an autodoc NDA), or **linked to a matter** when the contract is part of a broader effort.

- **Standalone by default.** Routine paper (NDAs, standard MSAs, order forms) flows through the Contracts module alone — no wrapper matter.
- **Link when the work outgrows the document.** Rule of thumb: _if the work is the contract, it's standalone; if the contract is part of the work, link it_ (e.g., a `commercial` matter carrying negotiation strategy plus several related agreements).
- Linking is set/unset of `matter_id`: Member+, at creation or any time after, audit-logged per **DD-017**.
- **One matter max per contract** (single FK per DD-007; no many-to-many).
- Matter detail lists its linked contracts; contract header shows a parent-matter chip (region-E chips in the contract-details mock).

### Rationale

1. **Forcing a shell matter around every NDA doubles the objects** and clutters the matter list with empty containers.
2. **The link is cheap and reversible**, so the team never has to predict up front whether work will grow — start standalone, link later.
3. **Many-to-many rejected**: complicates "where does this live", and the rare cross-matter agreement can be referenced from other matters via comments/description.

### Consequences

- The implementation adds DD-007's nullable, indexed `contracts.matter_id` FK incrementally; existing Contracts remain null/standalone.
- Contract creation flow offers an optional matter picker; matter detail needs a Contracts section.
- Confidentiality interaction resolved by **CTR-018**: matter and contract `is_confidential` flags stay independent — no cascade in either direction; creating a link where one side is confidential shows a one-time "make this confidential too?" nudge, never enforcement.
- The rule-of-thumb wording above goes into user-facing docs.

### Implementation note (2026-08-24, M23/6)

Migration `0076_thankful_cerebro` lands the nullable FK and its index without a backfill. One canonical Contract datum now drives the optional creation picker, both record-side link/unlink flows, the Matter's Linked Contracts section, and the Contract's Matter context. Writes lock the Contract, require Member+ reach to both live records, and refuse a direct move until an explicit unlink. Independently unreachable relatives are represented only as `{ restricted: true }`; candidate searches omit them, archived records, linked Contracts, and other ineligible rows.

### Addendum (2026-08-24, M23 close, [#496](https://github.com/juggernog20/OpenLaw/issues/496))

The close journey links an already-existing standalone Contract from the Matter surface and reads the result from the canonical `contracts.matter_id`. The regression matrix holds one link at most, explicit unlink before move, Member+ reach to both records, silent candidate omission, restricted projections, and independent lifecycle, team, Field, Document, date, Task, and confidentiality state.

---

## MTR-008: Closing is a signal, not a lock; archiving is separate; no retention engine in v1

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

**MTR-002** defines _when_ a matter is closed (any `closed`-category status). This decision defines what closing _does_ — locking, preservation, redaction, retention — and how it relates to archiving.

### Decision

1. **Closing changes visibility, not writability** (GitHub-issue model). A closed matter stays fully readable and writable: comment, edit fields, attach late-arriving documents. Reopening is simply moving it back to an `open`-category status. What changes on close:
   - Drops out of default list filters and "active matters" counts (per **MTR-002** category branching).
   - Its key dates stop feeding "next deadline" surfaces (per **MTR-004**).
2. **Archiving is a separate, orthogonal action** — the `archived_at` soft-delete (existing schema convention) for matters that shouldn't exist (created in error, spam intake). Archived matters are hidden from lists and search by default; Admin can restore. Closing is normal end-of-life; archiving is "this shouldn't exist".
3. **No retention/redaction engine in v1.** Hard delete remains an explicit Admin action (compliance redaction, logged per **DD-017**). Automatic retention policies are parked in `FUTURE-FEATURES.md`.

### Rationale

1. **Late stragglers are the routine case** — the final signed doc or closing comment often arrives after close; read-only-on-close punishes it with reopen/re-close ceremony.
2. **DD-017 already provides record integrity** — every post-close mutation is in the append-only activity log; freezing adds no audit value.
3. **Conflating close with archive** would make normal end-of-life matters unfindable; closed matters are the team's institutional memory.

### Alternatives considered

- **Read-only on close** (comments allowed, edits require reopen) — rejected per rationale 1–2.
- **Close = archive** (one hidden end state) — rejected per rationale 3.
- **Retention engine now** — deferred; genuinely useful for privacy-conscious deployments but a policy surface too big for v1.

### Consequences

- No schema changes (`archived_at` and status categories already exist).
- Matter list needs an archived-excluded default plus an Admin-visible archived filter; closed matters need a visible closed pill (category-mapped per **DES-005**) so post-close edits are made knowingly.
- Search treats closed matters as normal results; archived matters excluded by default.
- `FUTURE-FEATURES.md` gains a retention-policies entry.

### Implementation note (2026-08-24, M23/7, [#495](https://github.com/juggernog20/OpenLaw/issues/495))

Closing and reopening landed as deliberate record actions over the ordinary Status transition. The current Category's Statuses remain available inline; crossing Categories opens a confirmation that offers only live Statuses in the target Category. Closing names every reachable open child Matter and represents each inaccessible open child only as a Restricted Matter placeholder. The advisory never blocks and confirmation sends only `statusId` through the existing write, so no child or sibling datum is touched.

The existing timestamp rules remain the whole lifecycle model: open-to-closed stamps `closed_at`, closed-to-open clears it, moves within one Category preserve it, and `opened_at` never moves. Closed Matters remain writable across Fields, comments, Documents, Key dates, Tasks, and relationships. They stay outside default and active deadline surfaces until reopened; Archiving remains the separate write freeze. Each accepted transition appends `matter.status_changed` with from/to Status and Category.

### Addendum (2026-08-24, M23 close, [#496](https://github.com/juggernog20/OpenLaw/issues/496))

The real close dialog now demonstrates the whole boundary: it lists the reachable open child, changes only the parent's Status, and then accepts a new comment on the closed Matter. The matrix also proves continued Field, Document, Key-date, Task, and relationship writes after Closing. No Resolution, closing note, inheritance, retention action, or cascade entered the record.

---

## MTR-009: Naming — free-text title plus immutable global sequence number (M-42)

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

Matters need human identification (what is this?) and stable citation (which one, exactly, in an email to outside counsel?). The question was free text only, auto-numbering, or firm-style templated schemes.

### Decision

- **Title**: required free text, user-written, editable anytime by Member+ (edits audit-logged per **DD-017**).
- **Number**: auto-assigned **global integer sequence**, displayed as **M-42** (GitHub-issue style). Immutable, never reused — gaps from hard-deleted matters stay gaps. URLs use it: `/matters/42`.
- **No templated/configurable numbering in v1** (no `EMP-2026-003` per-type-per-year schemes).

### Rationale

1. **Short stable citation is real workflow** — matters get referenced in email, Slack, and outside-counsel correspondence; "M-42" is unambiguous where titles get renamed and paraphrased.
2. **Templated schemes break on re-typing** — MTR-001 allows changing a matter's type; a type-encoded number would then lie or need renumbering (worse).
3. **Configurable numbering is a settings surface with real edge cases** (collisions, sequence resets, migrations) for marginal value at 2–10 people.
4. **Numeric URLs beat UUID URLs** for a tool people paste links from all day.

### Alternatives considered

- **Title only** — rejected; nothing short and stable to cite.
- **Templated numbering** — rejected per rationale 2–3; can graduate via `FUTURE-FEATURES.md` if OSS adopters demand it.

### Consequences

- `matters` gains `number` (unique integer, DB sequence) and `title` (text, not null). Schema updated in `SCHEMA.md`.
- The `M-` prefix is a display convention, not stored. Contracts grill should adopt the sibling pattern (`C-###`) for consistency.
- Search should match on number ("M-42" and "42") as well as title.
- UI: number renders beside the title in headers and list rows (muted, per **DES-005** token conventions).

---

## MTR-010: Tags — deferred out of v1

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

**MTR-001** carved tags out as a separate concept from matter type (finer, cross-type slicing: deals like "project-berlin", themes like "gdpr", occasions like "board-meeting"). The question was whether they ship in v1 and who controls the vocabulary.

### Decision

**No tags in v1.** Parked in `FUTURE-FEATURES.md`. Until then, cross-type grouping relies on search and title conventions.

### Rationale

1. **At 2–10 people, teams mostly remember what belongs together**; unused tag systems rot into vocabulary noise.
2. **Cheap to add later** — two small tables (`tags`, `matter_tags`), nothing else depends on them.
3. Deferring beats shipping a curation surface (rename/merge/archive) nobody asked for yet.

### Alternatives considered

- **Inline-create + Admin curation** (the recommended model if/when tags graduate) — flat org-wide tags, Member+ creates at point of use, Admin merges/renames.
- **Admin-curated only** — tidier but ceremony-heavy.

### Consequences

- No schema changes; the tags entry in `SCHEMA.md`'s outstanding questions is resolved as deferred.
- Matter list filtering in v1 is type + status + manager (+ search) only.
- If tags graduate, the inline-create + Admin-curation model above is the starting recommendation.

---

## MTR-011: Custom fields — global field catalog with per-type attachment (Jira model)

- **Status:** Accepted (storage revised by **CTR-016**: `matter_fields` renamed to `fields` with a `module_scope` of `matter | contract | global`, an `ai_prompt` column, and a new `entity` field type; the decision itself stands)
- **Date:** 2026-08-02

### Context

The queued question was per-type field _templates_. The actual requirement (per user): templates aren't necessarily needed, but a **full custom fields capability** is. The shape settled on is the global-Jira model: fields are defined once globally, and each matter type's settings control which fields are attached to it.

### Decision

**Global custom-field catalog + per-type attachment.**

1. **Global catalog** — Admins define fields once in **Matters Settings → Fields** (MTR-001 machinery: slug, display name, description, archive). A field's definition (name, type, options) lives in exactly one place.
2. **Field types (8)**: text, long text, number, date, boolean, single-select, multi-select, user reference. Currency/money deliberately excluded until the spend module (per **MTR-006**).
3. **Per-type attachment** — each matter type's settings add/remove fields from that type and order them. A field appears on a matter iff it's attached to the matter's type. Creating a field offers an "attach to all current types" convenience action (one-time, not a live flag).
4. **DD-015 interplay** — every custom field carries the `business | legal` tag, exactly like built-in fields, so Contributor visibility rules apply uniformly.
5. **Filterable** — select, date, number, boolean, and user fields work as matter-list filters; text/long-text are search-only.
6. **Storage** — `matter_fields` (definitions) + `matter_type_fields` (attachment join) + a `custom_fields` jsonb column on `matters`, keyed by field slug. Values for fields detached from a type are retained (historical fidelity), just no longer rendered/editable.
7. **Scope** — matters only in v1. The pattern is deliberately platform-shaped; Contracts/Entities adopt or decline it in their own grills.

Behavior details:

- Re-typing a matter (**MTR-001**) re-renders the form per the new type's attachments; values for now-unattached fields are retained but hidden (visible in activity history per **DD-017**).
- Field CRUD, attachment changes, and value edits are audit-logged per **DD-017**.
- Archiving a field hides it everywhere but retains stored values.
- Changing a field's _type_ after creation is not supported (archive and recreate) — avoids silent value coercion.

### Rationale

1. **Define-once beats per-type duplicates** — "Separation date" defined globally means one slug for reporting even if attached to three types; Jira's global-field model is battle-tested.
2. **Attachment lives in type settings** because that's where an admin thinks "what does an Employment matter look like?" — the template use case falls out for free without templates as a concept.
3. **jsonb over EAV** — Postgres jsonb with a GIN index handles filtering at this scale; EAV's join sprawl isn't warranted.
4. **No type-change on fields** — silent coercion of existing values is a data-integrity trap.

### Alternatives considered

- **Per-type field templates** (fields defined inside a type) — rejected; duplicates definitions across types, fragments reporting.
- **Global fields with no per-type attachment** — rejected; Employment-only fields would clutter every matter's form.
- **Defer custom fields entirely** (the original recommendation) — overridden by the user: the capability is needed in v1.
- **EAV value table** — rejected per rationale 3.

### Consequences

- New tables `matter_fields`, `matter_type_fields`; new `matters.custom_fields` jsonb column. Schema in `SCHEMA.md`.
- Two settings surfaces: **Matters Settings → Fields** (catalog) and field add/remove/order inside each type's settings row.
- Matter detail/form rendering is now type-driven; the form component must render from the attachment list, not a static field set.
- List filtering must support custom-field predicates (select/date/number/boolean/user).
- Contracts grill should decide whether contracts adopt the same capability (likely yes, sibling tables).
- This substantially raises the v1 build surface — accepted knowingly.

### Settings touchpoints

- **Matters Settings → Fields** — global catalog: add / rename / describe / archive; type picker at creation (immutable); DD-015 tag picker; options editor for selects.
- **Matters Settings → Types → [type]** — attach/detach fields, per-type display order.

### Addendum (2026-08-23, M22 close, [#474](https://github.com/juggernog20/OpenLaw/issues/474)) — the matter scope is open

M22 widened the shared field catalog to admit `matter`, mounted the Fields pane under Matters, and let each matter type attach `matter` and `global` fields through the existing editor. Create, record read/edit, re-type, list completeness, and Request conversion all use the same attachment definition and store values by slug in `matters.custom_fields`; detached values stay stored and disappear from the active form. The original `matter_fields` table name in the consequence above is historical: **CTR-016**'s shared `fields` table and `module_scope` are the shipped schema.

---

## MTR-012: Priority and risk — both first-class default fields on every matter

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

Competitive research (2026-08-02, Xakia/LawVu/Dazychain + enterprise ELM + intake-first generation) showed priority/urgency and a separate risk rating as first-class matter fields in effectively every product: Xakia's legal-risk dial (low→critical) and priority, LawVu's urgent flag + 1–5 risk slider, Dazychain's risk-assigned-at-triage, Tonkean's triage on urgency/impact/risk. OpenLaw had neither. The choice was first-class columns vs seeded MTR-011 custom fields.

### Decision

**Both are built-in default fields** (first-class columns on `matters`):

- `priority` — text enum `low | medium | high | critical` _(levels renamed per **DES-018**'s severity-ramp canon; originally `low | normal | high | urgent`)_, **not null, default `medium`**.
- `risk` — text enum `low | medium | high | critical`, **nullable** — null means "not yet assessed", which is honest until legal triages (the Dazychain pattern: risk set at triage, not by the requester).

Behavior:

- Priority drives triage-queue and list sort order and renders as a pill/flag; risk renders as a pill; both map to the **DES-005** paired status-pill families.
- Both are filterable and dashboard-segmentable (risk mix and urgent share were standard dashboard cuts in every product researched).
- Intake (**DD-010**) may collect urgency from the requester (informing `priority`); `risk` is set by legal at triage, never by the requester.
- Both editable by Member+ (Contributors cannot), audit-logged per **DD-017**.

### Rationale

1. **Universal in the market** — their absence would read as a gap in the first demo.
2. **They drive code behavior** (triage sort, routing signals, dashboard cuts), which is the documented carve-out (per project memory) where fixed enums beat configurability.
3. **Priority ≠ risk**: priority is "how fast", risk is "how bad if it goes wrong" — a routine filing can be urgent+low-risk; a dormant dispute can be low-priority+critical-risk. Collapsing them loses triage information.
4. Teams wanting additional axes (complexity, strategic value à la Xakia) can add them via the **MTR-011** catalog — the built-ins set the floor, not the ceiling.

### Alternatives considered

- **Priority first-class, risk as seeded custom field** (the original recommendation) — overridden by the user: both should be default fields.
- **Both as seeded custom fields** — rejected; code can't reliably sort/route on archivable fields.
- **Neither** — rejected per rationale 1.

### Consequences

- Two new columns on `matters` in `SCHEMA.md`.
- The triage queue (DD-010 surfaces) sorts by priority; dashboards get risk-mix and urgent-share cuts.
- Screen mocks need priority/risk affordances on matter lists, headers, and the intake triage view.

### Addendum (2026-08-23, M22 close, [#474](https://github.com/juggernog20/OpenLaw/issues/474)) — the two severities keep their different sources

Priority and risk shipped as first-class columns and as filters/columns on the managed Matters list. A direct create can set both; a Request conversion maps requester urgency one-for-one into priority, leaves risk unassessed, and lets Legal edit either on the record. Both use DES-018's shared severity labels and pill families, so the list, create dialog, and detail do not invent module-local scales.

---

## MTR-013: Matter templates — named template entity, pre-fills the matter and instantiates its checklist

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

Competitive research showed template-driven matter creation as the market's most-loved matters feature (Clio Matter Templates pre-fill fields, status, custom fields, and attach task lists with relative due dates; LawVu/Xakia/Dazychain auto-apply task templates by matter type). The choice was between hanging a single default checklist off each matter type versus a separate named template entity. The user chose the **separate template entity** — its key advantage: multiple templates per type (e.g., "Employment – Termination" and "Employment – Investigation" both on the Employment type).

### Decision

New **`matter_templates`** entity, Admin-managed:

- A template belongs to exactly one **matter type** and has a name + description.
- A template can pre-fill: **priority**, **risk**, **custom-field values** (for fields attached to its type per **MTR-011**), and a **title prefix/pattern** (optional).
- A template carries **template tasks**: title, **relative due date** (offset in days from matter creation, optional), **role target** (`matter_manager` or unassigned — roles, not named users, per Clio's retrofit lesson), display order. Instantiated as **MTR-005** checklist items on creation.
- **Creation flow**: pick type → optionally pick one of its templates (types with one template can offer it as default; templates are always optional — blank matters remain first-class).
- Template CRUD is Admin (Matters Settings); applying a template at creation is anyone who can create matters. Template changes never retroactively alter existing matters.
- Document folder structures as template content: **deferred to the Documents grill** (flagged there).

### Rationale

1. **Multiple named templates per type** is the real-world shape — one type, several recurring playbooks.
2. **Relative due dates + role targeting** make templates survive personnel changes and start the deadline clock correctly.
3. **Templates compose with, not duplicate, existing decisions**: fields come from the type (MTR-011), statuses are global (MTR-002) — the template only supplies _values_ and _tasks_.
4. Restraint kept: no workflow triggers, no stage-change automation (Clio gates that behind top tiers; our equivalent would be a future automation surface).

### Alternatives considered

- **Per-type default checklist only** (the original recommendation) — overridden by the user; one checklist per type is too coarse for types with several recurring playbooks.
- **No templates in v1** — rejected; the most-loved market feature, cheap relative to MTR-011 machinery already being built.

### Consequences

- New tables `matter_templates`, `matter_template_tasks` in `SCHEMA.md`.
- New settings surface: **Matters Settings → Templates** (list per type; editor covers pre-fill values + task rows).
- Matter creation UI gains an optional template picker (filtered by chosen type).
- Intake triage (**DD-010**) can apply a template at handoff.
- If a template's type detaches a custom field the template pre-fills, the template editor flags it (stale value warning).

### Addendum (2026-08-26, M24/4, [#514](https://github.com/juggernog20/OpenLaw/issues/514)) — templates carry relative Key dates

The M8 mock's “4 tasks and 2 key dates” promise is accepted. Alongside its ordered task checklist, a Matter template carries an ordered list of **relative Key dates**: a required label, a whole-number offset from 0 through 3,650 days after Matter creation, and an optional note. Applying the template resolves each row to a civil date from the Matter creation date and copies it into `matter_key_dates`; like every other template value, later edits never reach an existing Matter.

Key-date templates carry no owner, reminder schedule, or named person. They preserve **MTR-004**'s ordinary Key-date shape and use the organization's live **NOT-004** reminder offsets after instantiation. The new `matter_template_key_dates` table sits beside `matter_template_tasks` in `SCHEMA.md`.

## MTR-014: Custom fields — hard-required per type, enforced at creation; conditional logic deferred

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

Enterprise research flagged required-ness as the first thing users ask of a custom-field catalog (Legal Tracker's soft-required "Profile Incomplete" flags; its conditional "smart matters"). The choice: soft-required (never blocks saving, incomplete badge) vs hard-required at creation vs nothing.

### Decision

1. **`is_required` lives on the per-type attachment** (`matter_type_fields.is_required`) — a field can be required for Employment matters and optional elsewhere.
2. **Hard enforcement at creation**: a matter cannot be created (or re-typed, per **MTR-001**) while a required field for its type is empty. Also enforced when a required field is cleared on edit.
3. **Conditional show/hide logic** ("show field B only if field A = X") is **deferred** to `FUTURE-FEATURES.md`.

### Rationale

1. **Data quality by construction** — required fields that can be skipped drift empty; hard enforcement guarantees dashboards and filters over those fields are trustworthy.
2. **The quick-capture tension resolves through DD-010**: rushed inbound work lives as a _Request_ until triage; required matter fields are filled by the triager at conversion. The Request entity absorbs the "capture in 10 seconds" role, so the matter record can afford to be strict.
3. **Templates soften the cost** — MTR-013 templates pre-fill values, so required fields on templated flows are mostly pre-satisfied.
4. **Conditional logic deferred** — a dependency-graph engine (cycles, hidden-but-required, stale hidden values) that none of the small-team competitors ship; only the enterprise ceiling has it.

### Alternatives considered

- **Soft-required with "incomplete" badge** (the original recommendation, Tracker/Xakia pattern) — overridden by the user in favor of guaranteed data quality.
- **No required-ness** — rejected; catalogs without it drift empty.

### Consequences

- `matter_type_fields` gains `is_required` (boolean, not null, default false). Schema updated.
- Attaching a field as required to a type with existing matters does **not** retro-block those matters; they surface in an "incomplete" filter instead (only creation/re-type/edit paths enforce).
- Re-typing a matter (**MTR-001**) may now prompt for newly-required fields before completing.
- Intake conversion UI (**DD-010**) must render required fields for the chosen type at triage.
- Warning inherited from research: deactivating/archiving a field must **never** delete data (contrast Legal Tracker, where field deactivation destroys values) — MTR-011's retention semantics already guarantee this.

### Addendum (2026-08-23, M22 close, [#474](https://github.com/juggernog20/OpenLaw/issues/474)) — hard-required at every write that can make a gap

M22 enforces the attachment's `is_required` at direct creation, conversion, re-type, and field edit. Each refusal names every missing field; re-type and conversion render controls for the gaps before retrying. Making a field required later does not rewrite old rows: the managed list's Incomplete filter finds them, and their next relevant edit must satisfy the rule. Detaching or archiving a definition never removes a stored value.

## MTR-015: Matter relationships — parent/child hierarchy plus flat related links; no cascade semantics

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

Matters had no way to reference each other. Research: TeamConnect supports full matter hierarchies (parent objects, sub-objects); LawVu has flat linked matters. Real cases: one dispute spawning multiple proceedings; a project matter with sub-workstreams; loosely connected matters worth cross-referencing.

### Decision

**Both structures, kept deliberately dumb:**

1. **Parent/child**: `matters.parent_id` — nullable self-referencing FK. Single parent per matter, arbitrary depth, cycles rejected at the application layer.
2. **Related**: `matter_relations` join table — undirected matter↔matter links (A related to B shows on both).
3. **No cascade or inheritance semantics, explicitly:**
   - Closing a parent does **not** close children (closing a parent with open children shows an informational prompt listing them — never blocks).
   - Team membership, Matter Manager, and confidentiality (**DD-014**) do **not** flow between parent and child.
   - No rollups (no aggregated deadlines/tasks/spend on the parent) in v1.
   - Hierarchy is navigational structure only: children listed on the parent's detail; parent breadcrumb on the child; related list shows number + title per **MTR-009**.
4. Link/unlink and re-parenting are Member+, audit-logged per **DD-017**.

### Rationale

1. **Parent/child expresses real structure** (dispute → proceedings; program → workstreams) that flat links flatten away.
2. **Cascade semantics are the trap** — auto-closing children, inherited teams, and flowing confidentiality each create surprise behavior and permission leaks; declining them keeps the hierarchy safe and cheap.
3. Rollups can be added later without schema change if demand appears.

### Alternatives considered

- **Flat related links only** (the original recommendation) — overridden by the user; hierarchy is wanted too.
- **Typed relations** ("spawned from", "consolidated into") — not chosen; label vocabulary with little behavior. Revisit only with demand.

### Consequences

- `matters.parent_id` column + new `matter_relations` table in `SCHEMA.md`.
- Matter detail gains a hierarchy section (parent breadcrumb, children list) and a Related list; matter lists may indicate child matters (indent or badge — screen grill decides).
- Confidentiality note for the screen grills: a user may see a child but lack access to its confidential parent (or vice versa) — render inaccessible relatives as "restricted matter", never leak titles (**DD-014**/**DES-009**).
- Cycle prevention is an application-layer invariant.

### Addendum (2026-08-24, M23 close, [#496](https://github.com/juggernog20/OpenLaw/issues/496))

The hierarchy and flat-link surfaces are complete with canonical undirected pairs, one parent, cycle refusal under concurrent writes, and restricted placeholders that disclose no number or title. Reach, confidentiality, Manager, team, Documents, Fields, Key dates, Tasks, lifecycle, and notifications remain properties of each Matter. The open-child close advisory reads the relationship but changes nothing through it.

## MTR-016: Lifecycle timestamps — `opened_at` / `closed_at` maintained on category transitions

- **Status:** Accepted
- **Date:** 2026-08-02

### Context

Cycle-time reporting ("avg days to close, by type") is a named metric in every product researched, and the deferred SLA engine (**MTR-004** / `FUTURE-FEATURES.md`) will need status-transition timing. The enterprise research's cheapest lesson (via TeamConnect's phase-linked Opened On/Closed On): capture the timestamps now and reporting falls out for free.

### Decision

- `matters.opened_at` — set at creation (equals `created_at` initially; reset if a closed matter is reopened? **No** — `opened_at` is set once at creation and never changes; reopen history lives in the activity log).
- `matters.closed_at` — set when the matter transitions into a `closed`-category status (**MTR-002**); **cleared on reopen**. Null = open.
- Maintained by the application on status change; the full transition history (including repeated close/reopen cycles) remains in `activity_log` per **DD-017** — these columns are a reporting convenience, not the source of truth.
- Cycle time = `closed_at - opened_at` for closed matters; a canned "avg days to close by type" report becomes trivially possible.

### Rationale

1. Two columns now vs a log-scan in every report later.
2. Future SLA/step-timing work reads DD-017 transition history; these columns just make the headline metric cheap.

### Alternatives considered

- **Derive from activity log only** — rejected; every dashboard query pays a log-scan.

### Consequences

- Two columns on `matters` in `SCHEMA.md`; status-change code path must maintain `closed_at`.
- Dashboards can ship a cycle-time report in v1 with zero additional data work.

### Addendum (2026-08-23, M22 close, [#474](https://github.com/juggernog20/OpenLaw/issues/474)) — transition timestamps are maintained

The create callable writes `opened_at` once. The status write sets `closed_at` on an open→closed category transition, clears it on closed→open, and leaves it alone for moves within one category; `opened_at` never changes. The same callable is used by direct creation and Request conversion, and the activity entry retains the from/to status and category needed to reconstruct repeated cycles.

## Index of decisions

| #       | Decision                                                                                            | Status   |
| ------- | --------------------------------------------------------------------------------------------------- | -------- |
| MTR-001 | Matter type taxonomy — configurable enum, seeded with 9 default types, Admin-managed                | Accepted |
| MTR-002 | Matter lifecycle — fixed open/closed system dimension + configurable status labels                  | Accepted |
| MTR-003 | Matter assignment — one Matter Manager, plus legal team members added as needed                     | Accepted |
| MTR-004 | Deadlines — first-class named key dates; SLA engine deferred to future                              | Accepted |
| MTR-005 | Tasks — lightweight checklist, not a task entity                                                    | Accepted |
| MTR-006 | External counsel — collaboration via Contributor role; fee tracking deferred                        | Accepted |
| MTR-007 | Matter ↔ Contract — standalone by default, linked when part of broader work                         | Accepted |
| MTR-008 | Closing is a signal, not a lock; archiving separate; no retention engine in v1                      | Accepted |
| MTR-009 | Naming — free-text title plus immutable global sequence number (M-42)                               | Accepted |
| MTR-010 | Tags — deferred out of v1                                                                           | Accepted |
| MTR-011 | Custom fields — global field catalog with per-type attachment (Jira model)                          | Accepted |
| MTR-012 | Priority and risk — both first-class default fields on every matter                                 | Accepted |
| MTR-013 | Matter templates — named template entity per type, pre-fills fields and instantiates task checklist | Accepted |
| MTR-014 | Custom fields — hard-required per type at creation; conditional logic deferred                      | Accepted |
| MTR-015 | Matter relationships — parent/child hierarchy plus flat related links; no cascade semantics         | Accepted |
| MTR-016 | Lifecycle timestamps — opened_at/closed_at maintained on category transitions                       | Accepted |
