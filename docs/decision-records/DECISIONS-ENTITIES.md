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
- **Rationale** — The compliance calendar and registrations need typed data; full corporate-secretarial depth (parity with the dedicated entity-management products) is months of schema for the last-shipping module.
- **Alternatives considered** — Deep registry now; light card + jsonb (calendar can't key off a blob).
- **Consequences** — SCHEMA.md entities section resolved; two configurable lists (types, officer roles) join the settings inventory; `fields.module_scope` enum gains `entity` (CTR-016 revision note).

### ENT-011 amendment (2026-09-18)

The "share registers/cap tables stay in FUTURE-FEATURES" clause is superseded by ENT-011. The three declared share-capital columns stay; the Ownership tab reconciles `shares_issued` against the register.

### Built addendum (2026-09-18, M36/3, [#933](https://github.com/juggernog20/OpenLaw/issues/933))

The Ownership tab's reconciliation line compares the Overview's declared `shares_issued` with the register's issued total across every class, today, and says so in one sentence: success when they agree, a warning naming both figures when they do not.

### Built addendum (2026-08-29, M27/3–4, #575, #576)

Migration `0082_great_betty_ross` adds the share-capital columns, `entity` Field scope, `entity_type_fields`, officer roles, and `entity_officers`. Entities Settings mounts the shared taxonomy, type-editor, and Field-catalog machinery. The Entity record reads and writes the three share-capital columns and its type-attached Fields through `PATCH /entities/:id`. Each Field commit uses the shared coercion and required-value checks, including live `user` and `entity` references. Officers have Member+ list, create, inline update, resignation, and delete routes. Each write appends its own `entity_officer.*` Activity entry in the same transaction.

### Amendment (2026-09-21, DD-028) — Entity types get the Form

`entity_type_fields` becomes the Row table of an Entity type's Form: Required for creation and Branches, no intake switch and no built-in Rows. The entity create form collects the required Rows of the chosen type; the rest go on the record.

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

Where an Entity keeps a share register, its owner Holdings are a projection of that register (`source = register`) and are read-only through the Holdings routes. ~~Manual Holdings remain for Entities without a register.~~ (superseded by ENT-012) The Owners list on the Ownership tab is replaced by the Register of members; the owned side stays as the "Holdings in other Entities" card.

### Built addendum (2026-09-18, M36/4, [#934](https://github.com/juggernog20/OpenLaw/issues/934)) — the projection

Migration 0151 (the same migration as the register tables) adds `source` (`manual | register`) to `entity_holdings` and `individual_holdings`, and `shareholder_id` to `individual_holdings` so a projected individual row is matched by holder, never by name. After every register entry write, in the same transaction and under the Holdings advisory lock, the issuer's owner Holdings are rewritten from today's holders: each holder's outstanding shares across every class over the issuer's outstanding shares, to two decimals. A manual row for an owner the register now names is taken over; a projected row for a holder who no longer holds is deleted; each change appends the same `entity_holding.*` Activity a hand-typed write would. `PATCH` and `DELETE` on a projected row answer 409. `GET /holdings` and the chart carry `source` on every row and edge; the Ownership tab marks a projected row "From register", disables its controls, and links to the register that produced it. The register's cycle check reads `entity_holdings` only, because the projection has already written the holder's edge when it runs.

### ENT-012 amendment (2026-09-30)

Hand-typed Holdings are superseded by ENT-012. The write routes, Add Holding, the individual-owner dialog and the soft ≤100% warning are removed, and migration 0185 deletes the typed rows. The graph, the chart and the majority spine read the projected rows as before.

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
- **Decision** — Four tables. `entity_share_classes` (name, authorized, par value with currency, votes per share, rights summary, archivable). `entity_shareholders` (per issuer; kind `entity` with a registry FK, or `individual` with a name). `entity_share_entries` (per-Entity entry number; kind `allotment | transfer | buyback | cancellation | conversion`; effective date; class and, for conversion, a to-class; quantity; from and to holder; price, consideration, distinctive numbers, resolution reference, note). `entity_share_certificates` (number unique per issuer; holder; class; quantity; distinctive numbers; issued-by and cancelled-by entry). **Holders and balances are never stored**: the Register of members is a replay of the entries to a date, ordered by effective date then entry number. Issued = allotments − cancellations; treasury = buybacks − treasury cancellations; outstanding = issued − treasury; votes = balance × votes per share. Every write replays the register with the change applied and refuses (409) any negative balance at any date, any cancelled certificate that is not live for that holder and class, and any ownership cycle. Allotment past `authorized` warns and commits, as ENT-003 does for percentages. The register is read as of a date (`asOf`), today by default. **Holdings project from the register**: after each entry write the issuer's owner Holdings are rewritten from today's holders (percent = holder's outstanding shares over the issuer's outstanding shares, all classes), marked `source = register` and read-only; ~~Entities without a register keep manual Holdings.~~ (superseded by ENT-012) ENT-001's three declared numbers stay and the tab reconciles `shares_issued` against the register in one line.
- **Rationale** — A register that stores balances beside entries can disagree with itself; replay cannot. Deriving Holdings from the register removes the second place ownership was typed. Keeping the declared numbers keeps the pre-M27 upgrade path and makes drift visible instead of silently overwriting one source with the other.
- **Alternatives considered** — Stored holder balances updated per entry (two sources of truth); Holdings computed at read time in the chart and majority-owner SQL (touches every ownership query; the projection keeps them unchanged); certificates as free text on entries (cannot say which certificates are live); dropping ENT-001's declared columns (breaks the upgrade gate and loses the reconciliation signal).
- **Consequences** — Supersedes ENT-001's "share registers/cap tables stay in FUTURE-FEATURES" clause and the FUTURE-FEATURES row. Amends ENT-003: Holdings gain `source`, and register-sourced rows refuse PATCH and DELETE. The Ownership tab's Owners list is replaced by the Register of members (DES-088). Option pools, convertibles, subdivision and consolidation, waterfalls, beneficial-ownership look-through, certificate PDFs, and per-entry filing status are new FUTURE-FEATURES rows with [#930](https://github.com/juggernog20/OpenLaw/issues/930) as origin.

### Built addendum (2026-09-18, M36/2–5, [#932](https://github.com/juggernog20/OpenLaw/issues/932)–[#935](https://github.com/juggernog20/OpenLaw/issues/935))

Migration 0151 adds `entity_share_classes`, `entity_shareholders`, `entity_share_entries`, `entity_share_certificates` and `entity_share_entry_counters`; every dependant references its parent by (`entity_id`, `id`), bigint columns carry a safe-integer ceiling, and entry numbers come from the counter so a deleted entry's number is never reused. `lib/share-register.ts` is the pure replay: entries ordered by effective date then number, applied to nothing, answering balances, treasury, issued, member-since dates, live certificates, the first violation and authorized-overrun warnings. `GET /entities/:id/share-register?asOf=` replays to the date and to today. Share classes and entries have create, update and remove routes; each write replays the register with the change applied and refuses a negative balance, a certificate that is not live for a Holder the Register entry names, or an ownership loop through `entity_holdings`. A certificate a Register entry cancels may belong to either Holder it names, so a transferee can consolidate. Certificates issued by an entry that a later entry cancelled pin the entry until that later entry changes. A holder no entry or certificate names is pruned. `GET …/share-register/export?kind=members|entries` renders CSV. Six `entity_share_*` Activity actions land on the issuer and on each Entity holder the entry names.

### ENT-012 amendment (2026-09-30)

The "Entities without a register keep manual Holdings" clause is superseded by ENT-012. Every Holding is a projection, so `source` is gone from both tables and no route writes a Holding by hand.

## ENT-012 — The share register is the only source of a Holding

- **Status** — Accepted
- **Date** — 2026-09-30
- **Source** — [#1240](https://github.com/juggernog20/OpenLaw/pull/1240)
- **Context** — ENT-011 projected Holdings from the register and kept ENT-003's hand-typed Holdings for Entities without one. The two sources met on one tab. Add Holding wrote rows outside the register. An owner that the register did not name listed in a "Declared owners not in the register" card. A typed individual stayed beside a register Holder of the same name, and the total counted that person twice. Blair ruled that typed Holdings cause more problems than they solve, and that the declared-owners card goes with them.
- **Decision** — Only the ENT-011 projection writes a Holding. `POST`, `PATCH` and `DELETE` on `/entities/:id/holdings` are removed. `GET /entities/:id/holdings` and `GET /entities/chart` stay. The Ownership tab loses Add Holding, its dialog and the declared-owners card, and "Holdings in other Entities" becomes a read-only list (DES-088, 2026-09-30 addendum). Migration 0185 deletes every `source = manual` row from `entity_holdings` and `individual_holdings`, drops `source` from both tables, and makes `individual_holdings.shareholder_id` required. The `source` field and the `ownership-over-100` warning leave the Holdings and chart responses.
- **Rationale** — One source cannot disagree with itself, which is the reason ENT-011 gave for replay over stored balances. Every defect on the tab came from the second source: the double count, the declared-owners card, and a warning for totals over 100%.
- **Alternatives considered** — Remove the controls and keep the API writes (typed rows would show in the chart with no screen to correct them). Keep typed rows as a remove-only list (keeps the declared-owners card in a smaller form). Convert typed rows into register entries on upgrade (invents share counts and dates that nobody recorded).
- **Consequences** — Supersedes ENT-003's hand-typed writes, the Add Holding path of its Individual owner addendum, and its soft ≤100% validation. Supersedes ENT-011's "Entities without a register keep manual Holdings" clause. The upgrade deletes typed Holdings and writes no Activity entry for them, because a migration has no actor. The changelog tells the Administrator to record a register before the upgrade. An Entity without shares, such as a branch, a trust or an LLC, needs a share class named for its interest before it appears in the ownership chart. Rounding to two decimals can make an owned Entity's Holdings total 99.99 or 100.01, and nothing warns. The demo seed and the e2e journeys record ownership as one share class and one allotment.

## ENT-013 — Every Entity type names a register kind; the Ownership tab mounts the register that kind names

- **Status** — Accepted
- **Date** — 2026-09-30
- **Context** — ENT-011 built one register, the share register, and the Ownership tab mounts it for every Entity whatever its type. A trust has no shares. A partnership has partners with capital, not shares of a class. A branch has no owners of its own. Blair asked for the right register to appear from the Entity type, and asked for research on what each register holds. The research note is `ENTITY-REGISTERS-RESEARCH.md`. Blair chose to build the trust and partnership registers now, with the share register kept and a "none" kind for branches, and to defer LLC interests, foundations and guarantee members. Two research findings shape the model: a UAE onshore LLC and a DIFC or ADGM "LLC" are share companies, so one type name can need two registers; and the research groups the law into four register engines, so the kind must be fixed in code, not a configurable list.
- **Decision** — **Register kind** is a fixed enum on `entity_types`: `shares | partnership | trust | none`, not null, default `shares`. The Administrator sets it on the type in Entities Settings. Seeds: corporation `shares`, llc `shares`, partnership `partnership`, branch `none`, other `shares`; every user-created type gets `shares` on upgrade. **An Entity may override its type's kind.** `entities.register_kind` is the same enum, nullable; the effective kind is the override or, failing that, the type's kind. The record carries the effective kind and where it came from. **The effective kind never changes while a register holds data.** A write that would change an Entity's effective kind is refused with 409 while that Entity has any share class, share entry, Partnership entry or Role entry. That covers the override on `PATCH /entities/:id` and the type's kind on the type route, which counts the Entities of the type that have no override and hold data and names the count in the problem detail. Setting the override to the current effective kind is always allowed; it pins the Entity. Clearing the override is a kind change like any other. ENT-009's archive-and-reassign move pins an override on every moved Entity whose effective kind would otherwise change and that holds data, so an archive never strands a register. The upgrade migration applies the same pin: every Entity whose type's new kind is not `shares` and that holds share register data gets `register_kind = shares`. **Each register's routes serve one kind.** A share register, partnership register or trust register route on an Entity whose effective kind is another register answers 409. The Overview's Share capital card (ENT-001's three declared numbers) renders only for `shares`. **Kind `none`** keeps no register. Its Ownership tab shows the head office: `entities.head_office_entity_id`, nullable, not the Entity itself, and not an Entity whose own head-office chain reaches back to it. `PATCH /entities/:id` sets or clears it for `none` Entities only, and a kind change away from `none` clears it. The head office is an Entity fact narrated by `entity.updated` with its changed field, as the register kind is. The chart draws a branch under its head office (ENT-003 amendment below). The MCP Entity read carries the effective register kind and only the register it names.
- **Rationale** — The kind decides which tables the API writes and which screen the tab draws, so it must be a code enum, not a taxonomy row (DD-028's carve-out for values that drive code branches). A per-Entity override with an "empty registers" guard handles the one-name-two-registers case and the upgrade without a migration that guesses. Refusing a kind change while data exists is the ENT-009 pattern: count, name, refuse; nothing is hidden or lost.
- **Alternatives considered** — Kind on the type only, with two types for LLC (breaks existing partnership-typed Entities that already hold share entries); kind on the Entity only (the type is the carrier of policy, DD-028); automatic re-pinning on a type change instead of refusing (silent side effects on other people's Entities); a head office as a 100 percent Holding (a branch is the head office, not owned by it).
- **Consequences** — Migration adds `entity_types.register_kind`, `entities.register_kind`, `entities.head_office_entity_id` and the upgrade pins. The type editor gains a Register select. The entity record loader reads the register the kind names. ENT-011's routes gain the kind guard. FUTURE-FEATURES gains rows for LLC interests, foundations, member registers, the share register's statutory columns and the other research items, with the research note as origin. ENT-014 and ENT-015 define the two new registers; DES-096 records the screens.

## ENT-014 — The partnership register: partners with capacity, capital and units; an ownership basis projects Holdings

- **Status** — Accepted
- **Date** — 2026-09-30
- **Context** — Partnership law keeps a register of partners, not shares. Delaware, ULPA and the DIFC require the entity to produce each partner's contributions agreed and made, with dates, and the DIFC register names units or a percentage "if relevant" (research note, section 4). The default profit split differs by statute, equal in the UK and the DIFC general partnership, pro rata to contributed capital in Delaware and the DIFC limited partnership, so the product cannot derive a percentage from capital by default. Blair chose the middle depth: commitments, contributions and returns, with units or a stated percentage, and no capital calls, distributions or profits interests.
- **Decision** — Two tables and a counter. `entity_register_parties` (per Entity; kind `entity` with a registry FK, `individual` with a name, or `class` with a description; a class serves the trust register only). It is shared with ENT-015; a party exists because an entry names it and is pruned when none does. `entity_partnership_entries` (per-Entity entry number from `entity_register_entry_counters`, keyed by Entity and register, never reused; kind `admission | commitment | contribution | return | transfer | capacity_change | withdrawal`; effective date; party, or from and to parties for a transfer; capacity `general | limited`; units; stated percent to two decimals; amount in minor units with a currency; form of contribution; consideration; reference; note; recorded by). Per-kind CHECKs pin which columns each kind carries. **Partners and balances are never stored.** The Register of partners is a replay of the entries to a date, ordered by effective date then entry number, as ENT-011 replays shares. Per partner it yields capacity, status (`admitted`, `assignee`, `ceased`), partner since, units, stated percent, committed, contributed, returned and unreturned (contributed minus returned). Admission admits a party with a capacity and optional units and stated percent. Commitment, contribution and return move money for one partner. Transfer moves any of units, stated percent and unreturned capital from one party to another, with consideration; when the transferee is not already admitted, the entry says whether it is admitted with a capacity or holds as an assignee. Capacity change swaps general and limited. Withdrawal ends the party's standing and is refused while the party holds units, a stated percent or unreturned capital. Every write replays the register with the change applied and refuses (409) any negative units, percent or capital at any date, a withdrawal that breaks the rule above, a capacity change or transfer naming a party that is not admitted or an assignee on that date, and an ownership cycle through `entity_holdings`. **One currency per register.** The first money entry sets it; a money entry in another currency is refused, so the totals and the capital basis are always one figure. **The ownership basis** is `entities.partnership_basis`: `capital | units | stated | equal`, not null, default `capital`, editable at any time on `PATCH /entities/:id`. **Holdings project from the register** after every entry write and every basis change, in the same transaction and under the Holdings advisory lock, as ENT-011's projection does, rewriting the partnership's owner Holdings and deleting the rows of parties no longer held: `capital` gives each party its unreturned capital over the total, admitted and assignee alike; `units` gives units over total units; `stated` gives the stated percent as typed, with a `stated-total` warning when today's total is not 100; `equal` gives each admitted partner one equal share and an assignee nothing. Only projections write Holdings (ENT-012), so `individual_holdings.shareholder_id` becomes nullable again beside a new `register_party_id`, with a CHECK that exactly one of the two is set; a projected individual row is matched by party, never by name. Reads: `GET /entities/:id/partnership-register?asOf=` answers the basis, the currency, the partners at the date and today, every entry, totals and warnings. Entries have create, update and delete routes for Member+, and `GET …/partnership-register/export?kind=partners|entries` renders CSV. Three `entity_partnership_entry.*` Activity actions land on the partnership and on each Entity party the entry names.
- **Rationale** — The research shows the statutes agree on the money columns and disagree on the split, so the register records money as fact and lets the Entity name its basis. Replay keeps the register from disagreeing with itself. Sharing the party table with the trust register avoids a third holder table for the same two shapes. One currency per register keeps the capital basis a number instead of a conversion.
- **Alternatives considered** — Stored balances (two sources of truth); a percentage derived from capital by default (wrong for half the statutes); capital calls, distributions and profits interests now (fund administration depth, deferred to FUTURE-FEATURES); classes of interest and series (deferred); mixed currencies with conversion (a valuation the register cannot own).
- **Consequences** — Migration adds `entity_register_parties`, `entity_partnership_entries`, `entity_register_entry_counters`, `entities.partnership_basis` and `individual_holdings.register_party_id`, and relaxes `individual_holdings.shareholder_id` to the one-of-two CHECK. `lib/partnership-register.ts` is the pure replay. The Ownership tab for `partnership` Entities draws DES-096's partnership register. FUTURE-FEATURES gains rows for capital calls and distributions, classes of interest and series, profits interests, and LLC interests as a vocabulary preset on this engine.

## ENT-015 — The trust register: parties hold dated roles; settlements and distributions are a ledger beside them; no percentage ownership

- **Status** — Accepted
- **Date** — 2026-09-30
- **Context** — Every statute the research read says nobody owns a trust. A discretionary beneficiary has no share, the trustee holds title for others, and the settlor gave the property away (research note, section 5). What the law asks a trustee to hold is who held each role, with the date each began and ended, and FATF names five roles: settlor, trustee, protector, beneficiary or class, and any other person with control. The UK, ADGM and the DIFC want the same with dates. Blair chose to build the trust register now and to leave foundations for a later preset on the same engine.
- **Decision** — One table beside the shared party table. `entity_trust_entries` (per-Entity entry number from `entity_register_entry_counters`; kind `appointment | cessation | settlement | distribution`; effective date; party; role `settlor | trustee | protector | enforcer | beneficiary | other`, with a required label when `other`; interest, the nature and extent of a beneficiary's interest or the powers a role holds, as text; amount in minor units with a currency, or property as text, one of the two for a settlement or distribution; reference; note; recorded by). Parties are Entities, named individuals, or a described class; a class may hold the beneficiary role only. **Roles are never stored.** The Register of trust parties is a replay of the entries to a date. An appointment opens a role for a party from its date; a cessation closes it; a settlement from a party opens the settlor role for that party from its date when the party does not already hold it, so a later settlor needs no separate appointment. Every write replays the register with the change applied and refuses (409) a cessation of a role the party does not hold on that date, an appointment of a role the party already holds on that date, and a distribution to a party that is not a beneficiary on that date. **The trust fund** is settled minus distributed per currency for money entries; property entries are listed, not totalled. Distributions past settlements warn (`fund-negative`) and commit, because the fund grows and shrinks by valuation the register does not hold. **No percentage ownership.** The trust register projects nothing into Holdings, and ENT-012 removed hand-typed Holdings, so a trust has no owner Holdings at all. A trust that holds shares in a company is that company's Holder as the trust Entity, so the chart edge runs from the trust; the trustee's name is on the trust register, not on the issuer's. Reads: `GET /entities/:id/trust-register?asOf=` answers the parties with their open roles at the date and today, every entry, the fund and warnings. Entries have create, update and delete routes for Member+, and `GET …/trust-register/export?kind=parties|entries` renders CSV. Three `entity_trust_entry.*` Activity actions land on the trust and on each Entity party the entry names.
- **Rationale** — A dated role ledger replayed to a date is what every regime read asks a trustee to be able to produce, and it is the same discipline ENT-011 uses. Deriving the settlor from a settlement removes a step the law treats as one fact. Projecting nothing from a trust keeps the ownership chart honest: role lines say who holds what role, and only share and partnership registers say who owns what.
- **Alternatives considered** — Beneficiaries with a percentage (Diligent does this; the statutes say the number does not exist for a discretionary beneficiary); roles as a configurable list (the chart and a future beneficial-owner derivation branch on the category, so the category is fixed and `other` carries a label); a separate foundation kind now (deferred; founder, council, guardian and qualified recipient map onto these roles as a preset); the trustee as the Holder on a company's register (the chart would then draw the trustee, not the structure).
- **Consequences** — Migration adds `entity_trust_entries`. `lib/trust-register.ts` is the pure replay. The Ownership tab for `trust` Entities draws DES-096's trust register. The chart gains role edges (ENT-003 amendment below). FUTURE-FEATURES gains rows for foundations, the beneficial-owner derivation from role holders, letters of wishes as Documents linked to entries, and identity details on parties.

### ENT-003 amendment (2026-09-30, ENT-013 to ENT-015) — role edges and branch edges on the chart

`GET /entities/chart` gains two edge sets beside the ownership edges. **Role edges** run from a trust party to the trust Entity and carry the role and its label, never a percentage; individual and class parties join the nodes as terminal nodes with a `kind`. **Branch edges** run from a head office to a `none` Entity. An edge is drawn only when the viewer reaches the trust or the branch, under the same DD-014 rule as ownership edges. Role edges stay out of the majority spine and the cycle check. This supersedes ENT-012's consequence that a branch, a trust or a partnership needs a share class before it appears in the chart: a partnership reaches the chart through ENT-014's projection, a trust through its role edges and a branch through its branch edge. A branch with no owner Holdings hangs under its head office in the spine, with no percentage on the edge. The chart export carries both edge sets.

### ENT-011 amendment (2026-09-30, ENT-013) — the share register serves the `shares` kind

Share register routes answer 409 on an Entity whose effective register kind is `partnership`, `trust` or `none`. The upgrade pins `register_kind = shares` on every Entity that already holds share register data under a type whose kind is now something else, so no existing register goes dark.

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
| ENT-012 | The share register is the only source of a Holding                                                        | Accepted |
| ENT-013 | Every Entity type names a register kind; the Ownership tab mounts the register that kind names            | Accepted |
| ENT-014 | The partnership register: partners with capacity, capital and units; an ownership basis projects Holdings | Accepted |
| ENT-015 | The trust register: parties hold dated roles; a ledger beside them; no percentage ownership               | Accepted |
