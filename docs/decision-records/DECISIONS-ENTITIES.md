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

## ENT-002 — Multi-jurisdiction: registrations table

- **Status** — Accepted
- **Date** — 2026-08-06
- **Decision** — `entity_registrations`: one row per jurisdiction of registration/qualification — `jurisdiction`, `registration_number`, `registered_agent`, `status` (`active | lapsed | withdrawn`), timestamps. Formation jurisdiction stays on the entity; registrations cover everywhere it must stay in good standing. Renewal obligations per registration feed the compliance calendar (ENT-006).
- **Rationale** — Per-state registration numbers, agents, and renewal dates are exactly the data a jurisdiction multi-select can't hold.
- **Consequences** — Table in SCHEMA.md; the compliance calendar (ENT-006) references registrations.

## ENT-003 — Corporate structure: full ownership graph + org chart in v1

- **Status** — Accepted
- **Date** — 2026-08-06
- **Context** — Recommended parent_id + indented tree; Blair chose the full graph with rendered org chart.
- **Decision** — `entity_holdings` many-to-many: (`owner_entity_id`, `owned_entity_id`, `ownership_percent`, timestamps) — supports JVs, minority stakes, and cross-holdings honestly. No cycles (application-enforced). The Entities module renders a **graphical org chart** in v1 (pan/zoom corporate tree; primary spine derived from the majority holder per entity) alongside the list view. External owners (founders, investors) are out of scope — the graph covers our entities; the top of the tree simply has no owner rows.
- **Rationale** — Real structures aren't trees; recording them wrong in a registry defeats the registry. (User override, consistent with the structurally-richer calibration.)
- **Alternatives considered** — parent_id + indented list (recommended); flat list.
- **Consequences** — Org-chart renderer is a v1 build surface (tech-stack queue: charting approach — likely SVG/D3-class). Majority-spine derivation needed for breadcrumbs/roll-ups. Percent totals per owned entity ≤ 100 validated softly (warn, don't block — data entry precedes completeness).

## ENT-004 — Access: global for legal staff; DD-014 confidential flag for the rare case

- **Status** — Accepted
- **Date** — 2026-08-06
- **Decision** — All entities visible to Member+; no per-entity grants. `is_confidential` (DD-014) covers sensitive cases (undisclosed acquisition vehicles): visible to Admins + a grant list, rendered as "restricted entity" elsewhere (MTR-015 convention). Contributors and Business Users have no Entities module access.
- **Rationale** — The registry's value is shared truth; per-entity ACL is bookkeeping a small team won't maintain.
- **Consequences** — `is_confidential` on entities; confidential-grant mechanism reuses the DD-014 pattern.

## ENT-005 — Statutory documents: entity-owned documents, no seeded folders

- **Status** — Accepted
- **Date** — 2026-08-06
- **Context** — Where certificates, bylaws, resolutions, filings live. Recommended a seeded per-entity folder set; Blair chose blank-start.
- **Decision** — `documents.entity_id` joins the DOC-008 owner set now; an entity's Documents tab is the DOC-002 repository filtered to that entity. DOC-006 folder machinery extends to entity scope (`document_folders.entity_id`), but **no folders are seeded** — each organization builds its own structure (folder-drop import per DOC-011 works here too).
- **Rationale** — (User preference.) Statutory filing taxonomies vary by jurisdiction mix; imposing one risks fighting how the team already files.
- **Alternatives considered** — Seeded folder template (recommended, declined).
- **Consequences** — SCHEMA.md: `entity_id` added to `documents` and `document_folders` owner sets. No settings surface for a folder template.

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

## ENT-007 — Roll-ups: linked-records tabs with query-derived counts

- **Status** — Accepted
- **Date** — 2026-08-06
- **Decision** — The entity page shows Contracts and Matters tabs listing referencing records (`contracts.entity_id` per CTR-011; matters via `entity`-scoped fields), counts in tab labels — pure queries, no stored counters. Restricted records render per the MTR-015 convention. Per-entity analytics belong to the dashboards capability (DD-005) later.
- **Consequences** — None schema-side.

## ENT-008 — The registry surface owns a Member+ entity-type read

- **Status** — Accepted
- **Date** — 2026-08-12
- **Context** — The register form is Member+ (ENT-004), but `GET /entity-types` — like every settings taxonomy read — is Administrator-only (SET-002). The form needs the type vocabulary from somewhere a Legal Team Member can read.
- **Decision** — The entities module carries its own picker read: `GET /api/v1/entities/types`, Member+ guarded, answering the live types (id, slug, display name) in display order. Archived types stay out, matching SET-003 picker semantics. The settings surface and the shared taxonomy machinery stay Administrator-only and untouched.
- **Rationale** — Permissions split by surface, not by table: the same vocabulary is settings data when configured (Administrator) and picker data when used (Member+). A read on the consuming surface keeps SET-002's single role gate intact instead of poking a role exception into the taxonomy factory.
- **Alternatives considered** — Loosening `GET /entity-types` to Member+ (breaks SET-002's uniform gate and leaks settings metadata — archived rows, system flags, usage counts); embedding the types in the registry list response (couples two reads that change independently).
- **Consequences** — Later Member+ forms over admin-configured taxonomies (the matter and contract type pickers on their record forms) repeat this pattern on their own surfaces.

## ENT-009 — The type archive guard counts and moves every referencing entity, archived included

- **Status** — Accepted
- **Date** — 2026-08-12
- **Context** — SET-003's guard needs a counting rule for entity types (#100): does an archived entity's type reference count toward the in-use number, and does it move on reassignment? SET-003 says "live-usage count" without fixing which set "live" means.
- **Decision** — The guard counts **every entity referencing the type, archived entities included**, and reassignment moves that same set. The refusal count, the moved set, and the set the `entities.entity_type_id` FK protects on hard delete are one set. Hard delete of an in-use type refuses with the same count (a clean 409, where the FK alone would answer a bare 500). Each moved entity gets its own activity entry under a dedicated verb, `entity.type_reassigned` (Legal Only, in the archive transaction per DD-017), alongside the Administrator-side `entity_type.archived` entry carrying the count and the target.
- **Rationale** — One counting rule everywhere: if only live entities counted, a type referenced solely by archived entities would pass the guard and then hit the FK on delete. And restore must never resurrect a reference to an archived type — archiving an entity is recoverable (a mistake, not history), so its type reference is as real as a live one. The dedicated activity verb lets the M9 feed narrate _why_ the type changed (an Administrator archived the old type) instead of a generic edit.
- **Alternatives considered** — Counting live entities only and leaving archived ones on the old type (splits the counted set from the FK set; restore brings back an archived-type reference); folding the move into `entity.updated` (loses the causal narration).
- **Consequences** — The dialog's "used by N entities" can exceed the visible registry list when archived entities reference the type — correct, and self-explaining once the archived toggle is on. Contract and Matter types inherited the same semantics when M8 and M22 armed their counters.

## Index of decisions

| #       | Decision                                                                               | Status   |
| ------- | -------------------------------------------------------------------------------------- | -------- |
| ENT-001 | Schema: typed registry core + officers table; simple share capital; entity field scope | Accepted |
| ENT-002 | Multi-jurisdiction: registrations table                                                | Accepted |
| ENT-003 | Corporate structure: full ownership graph + org chart in v1                            | Accepted |
| ENT-004 | Access: global for legal staff; DD-014 confidential flag                               | Accepted |
| ENT-005 | Statutory documents: entity-owned documents, no seeded folders                         | Accepted |
| ENT-006 | Compliance calendar: recurring obligations, blank-start, human-confirmed roll-forward  | Accepted |
| ENT-007 | Roll-ups: linked-records tabs with query-derived counts                                | Accepted |
| ENT-008 | The registry surface owns a Member+ entity-type read                                   | Accepted |
| ENT-009 | The type archive guard counts and moves every referencing entity, archived included    | Accepted |
