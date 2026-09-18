# OpenLaw — Entities Module Decision Record

Decisions specific to the Entities module. Platform-level decisions that apply across all modules (data model, role model, intake, activity tracking, etc.) live in `DECISIONS.md` and are referenced by ID where relevant.

Reference: per `DECISIONS.md` DD-008, internal **entities** and external **counterparties** live in separate tables with a shared `parties_view`. This file covers decisions about the `entities` table and the Entities module UI specifically.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `ENT-###`.

## Open questions queued for the next grill-me session

_None — queue cleared 2026-08-06 (ENT-001 through ENT-007)._

---

## ENT-001 — Schema: typed registry core + officers table; simple share capital; entity field scope

- **Status** — Accepted
- **Date** — 2026-08-06
- **Decision** — First-class columns on `entities`: `legal_name`, `entity_type` (configurable list — Entities Settings → Types; seeds: corporation, llc, partnership, branch, other), formation `jurisdiction` + `formed_on`, `registration_number`, `tax_id`, `registered_agent`, `registered_address`, `status` (`active | dormant | dissolved | divested` — fixed enum; surfaces branch on it). **Officers/directors** as `entity_officers` rows: `name` text (officers are usually not app users), `role` from a configurable list (seeds: director, ceo, cfo, secretary, other), `appointed_on`, `resigned_on` (null = current), optional `user_id` link. **Share capital as three simple fields** (`shares_authorized`, `shares_issued`, `par_value`) — share registers/cap tables stay in FUTURE-FEATURES. The CTR-016 fields catalog gains an **`entity` module scope** for custom entity fields.
- **Rationale** — The compliance calendar and registrations need typed data; full corporate-secretarial depth (Diligent parity) is months of schema for the last-shipping module.
- **Alternatives considered** — Deep registry now; light card + jsonb (calendar can't key off a blob).
- **Consequences** — SCHEMA.md entities section resolved; two configurable lists (types, officer roles) join the settings inventory; `fields.module_scope` enum gains `entity` (CTR-016 revision note).

### ENT-011 amendment (2026-09-18)

The "share registers/cap tables stay in FUTURE-FEATURES" clause is superseded by ENT-011. The three declared share-capital columns stay; the Ownership tab reconciles `shares_issued` against the register.

### Built addendum (2026-09-18, M36/3, [#933](https://github.com/juggernog20/OpenLaw/issues/933))

The Ownership tab's reconciliation line compares the Overview's declared `shares_issued` with the register's issued total across every class, today, and says so in one sentence: success when they agree, a warning naming both figures when they do not.

### Built addendum (2026-08-29, M27/3–4, #575, #576)

Migration `0082_great_betty_ross` adds the share-capital columns, `entity` Field scope, `entity_type_fields`, officer roles, and `entity_officers`. Entities Settings mounts the shared taxonomy, type-editor, and Field-catalog machinery. The Entity record reads and writes the three share-capital columns and its type-attached Fields through `PATCH /entities/:id`. Each Field commit uses the shared coercion and required-value checks, including live `user` and `entity` references. Officers have Member+ list, create, inline update, resignation, and delete routes. Each write appends its own `entity_officer.*` Activity entry in the same transaction.

## ENT-002 — Multi-jurisdiction: registrations table

- **Status** — Accepted
- **Date** — 2026-08-06
- **Decision** — `entity_registrations`: one row per jurisdiction of registration/qualification — `jurisdiction`, `registration_number`, `registered_agent`, `status` (`active | lapsed | withdrawn`), timestamps. Formation jurisdiction stays on the entity; registrations cover everywhere it must stay in good standing. Renewal obligations per registration feed the compliance calendar (ENT-006).
- **Rationale** — Per-state registration numbers, agents, and renewal dates are exactly the data a jurisdiction multi-select can't hold.
- **Consequences** — Table in SCHEMA.md; the compliance calendar (ENT-006) references registrations.

### Built addendum (2026-08-29, M27/3–4, #575, #576)

Migration `0082_great_betty_ross` adds `entity_registrations`. The Entity Overview lists, creates, edits, and deletes registrations. The API and database both enforce `active | lapsed | withdrawn`. Each write appends its matching `entity_registration.*` Activity entry in the same transaction.

## ENT-003 — Corporate structure: full ownership graph + org chart in v1

- **Status** — Accepted
- **Date** — 2026-08-06
- **Context** — Recommended parent_id + indented tree; Blair chose the full graph with rendered org chart.
- **Decision** — `entity_holdings` many-to-many: (`owner_entity_id`, `owned_entity_id`, `ownership_percent`, timestamps) — supports JVs, minority stakes, and cross-holdings honestly. No cycles (application-enforced). The Entities module renders a **graphical org chart** in v1 (pan/zoom corporate tree; primary spine derived from the majority holder per entity) alongside the list view. External owners (founders, investors) are out of scope — the graph covers our entities; the top of the tree simply has no owner rows.
- **Rationale** — Real structures aren't trees; recording them wrong in a registry defeats the registry. (User override, consistent with the structurally-richer calibration.)
- **Alternatives considered** — parent_id + indented list (recommended); flat list.
- **Consequences** — Org-chart renderer is a v1 build surface (tech-stack queue: charting approach — likely SVG/D3-class). Majority-spine derivation needed for breadcrumbs/roll-ups. Percent totals per owned entity ≤ 100 validated softly (warn, don't block — data entry precedes completeness).

### Built addendum (2026-08-30, M27/5, #577)

Holdings now read and write from either Entity, with graph-wide transaction locking and a full-path cycle check before each insert. Aggregate ownership above 100 percent returns a warning and still commits. The chart endpoint derives one primary owner per Entity by percent and legal name.

The web chart uses a dependency-free SVG layout. A compact layered forest places leaf nodes in horizontal slots and centers each primary owner over its children. Entities without Holdings occupy a final row. Secondary Holdings use dashed curves. The SVG supports pointer drag, wheel zoom, arrow-key pan, keyboard zoom, and fit-to-window.

### Individual owner addendum (2026-09-18)

Add Holding now offers Entity or Individual. Entity keeps the registry lookup; Individual collects a name and direct ownership percentage without creating an Entity or user account. Migration 0146 stores individual holdings separately, scoped to the owned Entity. Names are not identity keys and matching names are not merged. Individuals appear as terminal owners in the chart and exports, and contribute to the combined ownership-total warning. Their access follows the owned Entity, including for Administrators. This replaces ENT-003's exclusion of individual owners; it does not introduce a separate beneficial-owner register or automatic beneficial-ownership classification.

### ENT-011 amendment (2026-09-18)

Where an Entity keeps a share register, its owner Holdings are a projection of that register (`source = register`) and are read-only through the Holdings routes. Manual Holdings remain for Entities without a register. The Owners list on the Ownership tab is replaced by the Register of members; the owned side stays as the "Holdings in other Entities" card.

### Built addendum (2026-09-18, M36/4, [#934](https://github.com/juggernog20/OpenLaw/issues/934)) — the projection

Migration 0151 (the same migration as the register tables) adds `source` (`manual | register`) to `entity_holdings` and `individual_holdings`, and `shareholder_id` to `individual_holdings` so a projected individual row is matched by holder, never by name. After every register entry write, in the same transaction and under the Holdings advisory lock, the issuer's owner Holdings are rewritten from today's holders: each holder's outstanding shares across every class over the issuer's outstanding shares, to two decimals. A manual row for an owner the register now names is taken over; a projected row for a holder who no longer holds is deleted; each change appends the same `entity_holding.*` Activity a hand-typed write would. `PATCH` and `DELETE` on a projected row answer 409. `GET /holdings` and the chart carry `source` on every row and edge; the Ownership tab marks a projected row "From register", disables its controls, and links to the register that produced it. The register's cycle check reads `entity_holdings` only, because the projection has already written the holder's edge when it runs.

## ENT-004 — Access: global for legal staff; DD-014 confidential flag for the rare case

**Amended 10 September 2026:** the DD-014 administrator bypass is removed. Confidential Entities require a grant for administrators too. New Entity creators receive a recorded grant; explicit grantees can manage access. The DD-014 amendment in [DECISIONS.md](DECISIONS.md) supersedes the original administrator exceptions below.

- **Status** — Accepted
- **Date** — 2026-08-06
- **Decision** — All entities visible to Member+; no per-entity grants. `is_confidential` (DD-014) covers sensitive cases (undisclosed acquisition vehicles): visible to Admins + a grant list, rendered as "restricted entity" elsewhere (MTR-015 convention). Contributors and Business Users have no Entities module access.
- **Rationale** — The registry's value is shared truth; per-entity ACL is bookkeeping a small team won't maintain.
- **Consequences** — `is_confidential` on entities; confidential-grant mechanism reuses the DD-014 pattern.

### Grant addendum (2026-08-29, M27/1, [#573](https://github.com/juggernog20/OpenLaw/issues/573)) — `entity_grants` is the grant list

ENT-004's grant list is the `entity_grants` relation: one row names one user granted access to one confidential Entity. Administrators remain implicitly entitled and do not need rows in this relation; `entity_grants` carries only the explicit named-user exceptions shown in the Confidential grant list dialog.

### Built addendum (2026-08-30, M27/8, #580) — one Entity predicate reaches every surface

The Entity reach predicate is now armed. Administrators reach every Entity; Legal Team Members reach open Entities and Confidential Entities carrying their `entity_grants` row; Contributors and Business Users reach none. Only Administrators set or clear the flag and maintain grants, and all four acts are audited.

List, record, picker, calendar, search, Documents, roll-up, and notification queries compose that predicate before limits and counts. A known Holding, chart edge, Contract signing field, or Entity-valued custom Field may retain its relationship while naming the unreachable side only as Restricted Entity; every other surface omits the Entity without a row, name, count, notification, cursor gap, or page gap.

## ENT-005 — Statutory documents: entity-owned documents, no seeded folders

- **Status** — Accepted
- **Date** — 2026-08-06
- **Context** — Where certificates, bylaws, resolutions, filings live. Recommended a seeded per-entity folder set; Blair chose blank-start.
- **Decision** — `documents.entity_id` joins the DOC-008 owner set now; an entity's Documents tab is the DOC-002 repository filtered to that entity. DOC-006 folder machinery extends to entity scope (`document_folders.entity_id`), but **no folders are seeded** — each organization builds its own structure (folder-drop import per DOC-011 works here too).
- **Rationale** — (User preference.) Statutory filing taxonomies vary by jurisdiction mix; imposing one risks fighting how the team already files.
- **Alternatives considered** — Seeded folder template (recommended, declined).
- **Consequences** — SCHEMA.md: `entity_id` added to `documents` and `document_folders` owner sets. No settings surface for a folder template.

### Built addendum (2026-08-30, M27/7, [#579](https://github.com/juggernog20/OpenLaw/issues/579)) — Entity paper uses the shared record machinery

Entity is the third live `DocumentOwner` arm. Its Documents tab mounts the same Documents card, folder tree, folder-drop importer, version chain, panel, and landing route as Contract and Matter paper. The repository addresses an Entity filter by opaque id but names the owner by legal name; no statutory folders are seeded.

## ENT-006 — Compliance calendar: recurring obligations, blank-start, human-confirmed roll-forward

- **Status** — Accepted
- **Date** — 2026-08-06
- **Context** — The module's core value. Blair accepted the recurring-obligations model but rejected any seeding: "Start blank and the organization adds their custom obligations."
- **Decision** —
  - `entity_obligations`: `label` (free text — **no obligation-kind taxonomy**; obligations are whatever the org defines), `entity_id`, optional `registration_id` link (ENT-002), recurrence (`months` integer, null = one-off), `next_due_on`, `assignee_id`, `note`.
  - **Blank-start**: nothing seeded — no default obligations, no kind list.
  - Completing a cycle ("Mark filed") logs it (DD-017) and **rolls `next_due_on` forward by the recurrence — human-confirmed, never auto-advanced** (CTR-006 doctrine).
  - Feeds NOT-002 group 3: bell + daily digest at NOT-004 offsets, addressed to the assignee (fallback: all Admins when unassigned).
  - Views: due-date list + month calendar; the module home is the **unified compliance calendar across all entities**.
- **Rationale** — Recurrence machinery without prescriptive content: the January re-typing problem is solved, and nothing tells a legal team what their obligations are.
- **Alternatives considered** — One-off key dates (annual re-entry); obligations auto-spawning matters (auto-created work violates the notify-only doctrine).
- **Consequences** — Table in SCHEMA.md; completion events are activity-logged with the cycle date. A filing that needs real work gets a matter created manually and linked by the human doing it.

### Built addendum (2026-08-30, M27/6, [#578](https://github.com/juggernog20/OpenLaw/issues/578)) — Filing advances the held cycle, and only filing advances it

The obligation row is the schedule. Member+ can create, read, edit, and delete it beneath its Entity; the optional Registration, assignee, note, and manually chosen Matter are links on that same row. The Entities destination now opens on the cross-Entity calendar, ordered with overdue open obligations first and then by due date, with Entity, assignee, date-range, and completed-state filters. Its second form is a month grid over the same read.

`Mark filed` takes the filing day, defaulting to the caller's local day. A recurring obligation advances by its `recurrence_months` at least once and keeps advancing until the resulting due day is after the filing day. That catches up a filing made after several missed cycles without inventing several completed rows. A one-off keeps its due day and records `completed_on`. Both write `entity_obligation.filed` with the cycle date and previous due day; recurring rows also carry the new due day. Reading the calendar, opening a new month, and running the morning round never mutate the schedule.

A deleted Registration is not a deleted obligation: its foreign key is set to null and the obligation remains on the calendar. Registration rows on Overview expose the obligations that currently point at them.

## ENT-007 — Roll-ups: linked-records tabs with query-derived counts

- **Status** — Accepted
- **Date** — 2026-08-06
- **Decision** — The entity page shows Contracts and Matters tabs listing referencing records (`contracts.entity_id` per CTR-011; matters via `entity`-scoped fields), counts in tab labels — pure queries, no stored counters. Restricted records render per the MTR-015 convention. Per-entity analytics belong to the dashboards capability (DD-005) later.
- **Consequences** — None schema-side.

### Built addendum (2026-08-30, M27/7, [#579](https://github.com/juggernog20/OpenLaw/issues/579)) — roll-ups are reach-scoped at the target

Contracts are derived from `contracts.entity_id`; Matters are derived when any Entity-typed Field's slug in the Matter's `custom_fields` holds the Entity id. The read does not check that the Field is still attached to the Matter's type, so a detached Field's stored value keeps the link until the value is cleared. Both the rows and tab-label counts compose the target record's own reach predicate, so a walled target contributes neither a placeholder nor a count. The list component can render the shared restricted cell for seams whose doctrine retains a known link, but these query-derived roll-ups silently omit inaccessible targets.

## ENT-008 — The registry surface owns a Member+ entity-type read

- **Status** — Accepted
- **Date** — 2026-08-12
- **Context** — The register form is Member+ (ENT-004), but `GET /entity-types` — like every settings taxonomy read — is Administrator-only (SET-002). The form needs the type vocabulary from somewhere a Legal Team Member can read.
- **Decision** — The entities module carries its own picker read: `GET /api/v1/entities/types`, Member+ guarded, answering the live types (id, slug, display name) in display order. Archived types stay out, matching SET-003 picker semantics. The settings surface and the shared taxonomy machinery stay Administrator-only and untouched.
- **Rationale** — Permissions split by surface, not by table: the same vocabulary is settings data when configured (Administrator) and picker data when used (Member+). A read on the consuming surface keeps SET-002's single role gate intact instead of poking a role exception into the taxonomy factory.
- **Alternatives considered** — Loosening `GET /entity-types` to Member+ (breaks SET-002's uniform gate and leaks settings metadata — archived rows, system flags, usage counts); embedding the types in the registry list response (couples two reads that change independently).
- **Consequences** — Later Member+ forms over admin-configured taxonomies (the matter and contract type pickers on their record forms) repeat this pattern on their own surfaces.

### Built addendum (2026-08-14, M7.2, [#98](https://github.com/juggernog20/OpenLaw/issues/98))

`GET /api/v1/entities/types` answers Member+ with the live Entity types in display order and no settings metadata. The register form reads that route; the Administrator-only `/entity-types` taxonomy surface remains unchanged.

## ENT-009 — The type archive guard counts and moves every referencing entity, archived included

- **Status** — Accepted
- **Date** — 2026-08-12
- **Context** — SET-003's guard needs a counting rule for entity types (#100): does an archived entity's type reference count toward the in-use number, and does it move on reassignment? SET-003 says "live-usage count" without fixing which set "live" means.
- **Decision** — The guard counts **every entity referencing the type, archived entities included**, and reassignment moves that same set. The refusal count, the moved set, and the set the `entities.entity_type_id` FK protects on hard delete are one set. Hard delete of an in-use type refuses with the same count (a clean 409, where the FK alone would answer a bare 500). Each moved entity gets its own activity entry under a dedicated verb, `entity.type_reassigned` (Legal Only, in the archive transaction per DD-017), alongside the Administrator-side `entity_type.archived` entry carrying the count and the target.
- **Rationale** — One counting rule everywhere: if only live entities counted, a type referenced solely by archived entities would pass the guard and then hit the FK on delete. And restore must never resurrect a reference to an archived type — archiving an entity is recoverable (a mistake, not history), so its type reference is as real as a live one. The dedicated activity verb lets the M9 feed narrate _why_ the type changed (an Administrator archived the old type) instead of a generic edit.
- **Alternatives considered** — Counting live entities only and leaving archived ones on the old type (splits the counted set from the FK set; restore brings back an archived-type reference); folding the move into `entity.updated` (loses the causal narration).
- **Consequences** — The dialog's "used by N entities" can exceed the visible registry list when archived entities reference the type — correct, and self-explaining once the archived toggle is on. Contract and Matter types inherited the same semantics when M8 and M22 armed their counters.

### Built addendum (2026-08-15, M7.4, [#100](https://github.com/juggernog20/OpenLaw/issues/100))

The Entity-type taxonomy mount counts every referencing Entity, including archived records. Archive requires a live replacement when that count is non-zero and reassigns the complete set in the same transaction, appending one `entity.type_reassigned` entry per moved Entity and one `entity_type.archived` audit entry with the count and replacement. Hard delete refuses an in-use type with that same count.

## ENT-010 — An Entity may be Portal-listed, so Business Users can pick it on a form

- **Status** — Accepted
- **Date** — 2026-09-13
- **Context** — DD-027 lets a Business User pick an Entity where Legal has placed an `entity` picker. The registry holds holding companies a Business User should never see in a picker.
- **Decision** — `entities.portal_listed`, boolean, default false, set or cleared on the Entity record only by an Administrator and shown as a column in the Entities settings list. A Confidential Entity (ENT-004) is never listed whatever the flag, and the record refuses to set the flag on one. The Portal read returns id and name only, ordered by name, for live, non-Confidential, Portal-listed Entities. Archiving an Entity removes it from the read; the flag is kept for restore.
- **Rationale** — A property of the Entity, set once, respected by every Business User picker. The alternative, a per-Field subset, was rejected in DD-027.
- **Alternatives considered** — Per-Field subsets repeat the same visibility choice on every form and can drift as Entities change. Listing the whole non-Confidential registry exposes irrelevant holding companies; DD-027 instead chooses one explicit list of operating Entities.
- **Consequences** — One column, one Portal read, one settings column. Glossary: **Portal-listed Entity**. The activity verb `entity.portal_listed_set`.

### Built addendum (2026-09-13, M35/3, #846)

**M35/13 reconciliation (2026-09-14, #856):** The M35/3 ticket amendment (#846, commit `99d9c62c`) narrowed the earlier ~~Member+~~ Portal-listed writer to **Administrator only**. ENT-010 and DD-027 reflect that accepted amendment; ordinary Member+ Entity editing does not grant the Portal-listed write.

The Entity Overview commits Portal-listed through `PATCH /entities/:id`. Only an Administrator may set or clear it, including a write that repeats its current value. A change records `entity.portal_listed_set` in the same transaction. The registry list includes a Portal-listed column. Archived and Confidential Entities retain the stored flag but stay out of `GET /portal/entities`, which returns only id and name in name order.

The request form uses that read through the shared Field control. Entity Fields may be required; person Fields remain optional. The submission locks each selected Entity and checks the same Portal predicate before committing. The predicate and picker loader are shared for Auto-Doc forms. Existing Request references stop naming an Entity if it later becomes Confidential.

## ENT-011 — The share register: classes, entries, certificates; holders derived by replay; Holdings projected from it

- **Status** — Accepted
- **Date** — 2026-09-18
- **Context** — ENT-001 shipped share capital as three declared numbers and parked share registers in FUTURE-FEATURES. ENT-003 shipped the Ownership tab as two lists of hand-typed percentages. Neither answers who holds which class, how many, under which certificate, since when, or what the register showed on a record date. Blair asked for a full capitalization table and share register on the Ownership tab, chose the statutory ledger layout with a date scrubber from ten mocks, and ruled that holders must be derived from the transactions, never added by hand.
- **Decision** — Four tables. `entity_share_classes` (name, authorized, par value with currency, votes per share, rights summary, archivable). `entity_shareholders` (per issuer; kind `entity` with a registry FK, or `individual` with a name). `entity_share_entries` (per-Entity entry number; kind `allotment | transfer | buyback | cancellation | conversion`; effective date; class and, for conversion, a to-class; quantity; from and to holder; price, consideration, distinctive numbers, resolution reference, note). `entity_share_certificates` (number unique per issuer; holder; class; quantity; distinctive numbers; issued-by and cancelled-by entry). **Holders and balances are never stored**: the Register of members is a replay of the entries to a date, ordered by effective date then entry number. Issued = allotments − cancellations; treasury = buybacks − treasury cancellations; outstanding = issued − treasury; votes = balance × votes per share. Every write replays the register with the change applied and refuses (409) any negative balance at any date, any cancelled certificate that is not live for that holder and class, and any ownership cycle. Allotment past `authorized` warns and commits, as ENT-003 does for percentages. The register is read as of a date (`asOf`), today by default. **Holdings project from the register**: after each entry write the issuer's owner Holdings are rewritten from today's holders (percent = holder's outstanding shares over the issuer's outstanding shares, all classes), marked `source = register` and read-only; Entities without a register keep manual Holdings. ENT-001's three declared numbers stay and the tab reconciles `shares_issued` against the register in one line.
- **Rationale** — A register that stores balances beside entries can disagree with itself; replay cannot. Deriving Holdings from the register removes the second place ownership was typed. Keeping the declared numbers keeps the pre-M27 upgrade path and makes drift visible instead of silently overwriting one source with the other.
- **Alternatives considered** — Stored holder balances updated per entry (two sources of truth); Holdings computed at read time in the chart and majority-owner SQL (touches every ownership query; the projection keeps them unchanged); certificates as free text on entries (cannot say which certificates are live); dropping ENT-001's declared columns (breaks the upgrade gate and loses the reconciliation signal).
- **Consequences** — Supersedes ENT-001's "share registers/cap tables stay in FUTURE-FEATURES" clause and the FUTURE-FEATURES row. Amends ENT-003: Holdings gain `source`, and register-sourced rows refuse PATCH and DELETE. The Ownership tab's Owners list is replaced by the Register of members (DES-088). Option pools, convertibles, subdivision and consolidation, waterfalls, beneficial-ownership look-through, certificate PDFs, and per-entry filing status are new FUTURE-FEATURES rows with [#930](https://github.com/juggernog20/OpenLaw/issues/930) as origin.

### Built addendum (2026-09-18, M36/2–5, [#932](https://github.com/juggernog20/OpenLaw/issues/932)–[#935](https://github.com/juggernog20/OpenLaw/issues/935))

Migration 0151 adds `entity_share_classes`, `entity_shareholders`, `entity_share_entries`, `entity_share_certificates` and `entity_share_entry_counters`; every dependant references its parent by (`entity_id`, `id`), bigint columns carry a safe-integer ceiling, and entry numbers come from the counter so a deleted entry's number is never reused. `lib/share-register.ts` is the pure replay: entries ordered by effective date then number, applied to nothing, answering balances, treasury, issued, member-since dates, live certificates, the first violation and authorized-overrun warnings. `GET /entities/:id/share-register?asOf=` replays to the date and to today. Share classes and entries have create, update and remove routes; each write replays the register with the change applied and refuses a negative balance, a certificate that is not live for a Holder the Register entry names, or an ownership loop through `entity_holdings`. A certificate a Register entry cancels may belong to either Holder it names, so a transferee can consolidate. Certificates issued by an entry that a later entry cancelled pin the entry until that later entry changes. A holder no entry or certificate names is pruned. `GET …/share-register/export?kind=members|entries` renders CSV. Six `entity_share_*` Activity actions land on the issuer and on each Entity holder the entry names.

## Index of decisions

| #       | Decision                                                                                                  | Status   |
| ------- | --------------------------------------------------------------------------------------------------------- | -------- |
| ENT-001 | Schema: typed registry core + officers table; simple share capital; entity field scope                    | Accepted |
| ENT-002 | Multi-jurisdiction: registrations table                                                                   | Accepted |
| ENT-003 | Corporate structure: full ownership graph + org chart in v1                                               | Accepted |
| ENT-004 | Access: global for legal staff; DD-014 confidential flag                                                  | Accepted |
| ENT-005 | Statutory documents: entity-owned documents, no seeded folders                                            | Accepted |
| ENT-006 | Compliance calendar: recurring obligations, blank-start, human-confirmed roll-forward                     | Accepted |
| ENT-007 | Roll-ups: linked-records tabs with query-derived counts                                                   | Accepted |
| ENT-008 | The registry surface owns a Member+ entity-type read                                                      | Accepted |
| ENT-009 | The type archive guard counts and moves every referencing entity, archived included                       | Accepted |
| ENT-010 | An Entity may be Portal-listed, so Business Users can pick it on a form                                   | Accepted |
| ENT-011 | The share register: classes, entries, certificates; holders derived by replay; Holdings projected from it | Accepted |
