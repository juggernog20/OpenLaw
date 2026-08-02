# OpenLaw — Schema Reference

Living reference for the database schema. Captures table structures, column definitions, and the **decision provenance for each** — i.e., for every table or column, which DD or module-decision committed us to it.

This is **not** a migration file. SQL DDL lives in `db/migrations/` (when that exists). This document is the conceptual model that migrations should serialize, and a quick read for anyone trying to understand what the data looks like without reading the code.

## How to use this document

- New decisions that touch the schema append to or revise the affected table section, with a footnote-style reference to the decision (e.g., `[DD-014]`, `[MTR-001]`).
- When a decision is superseded, mark the affected schema sections superseded too, and link to the replacement decision.
- DDL syntax in this doc is illustrative (PostgreSQL-flavored — Postgres assumed pending the tech-stack grill). The conceptual columns and constraints are what's authoritative.

## Conventions

These apply unless a specific table overrides them.

- **Primary keys:** `id`, UUID v7 (sortable, time-ordered). Final pick deferred to the tech-stack grill; UUID v7 is the working assumption.
- **Timestamps:** `created_at`, `updated_at` (`timestamptz`) on every mutable table.
- **Soft delete:** `archived_at` (`timestamptz`, nullable) is the default delete affordance. Hard delete is reserved for explicit Admin actions (e.g., compliance redaction).
- **Audit:** every mutation on a tracked table is recorded in `activity_log` per **DD-017**. The application layer is responsible for emission; the database does not auto-trigger.
- **Foreign keys:** named `<entity>_id` (e.g., `matter_id`, `user_id`). Cross-table polymorphism is avoided where practical (per **DD-008**'s preference for separate-tables-with-view); where unavoidable (`comments`, `activity_log`), the `entity_type / entity_id` pair is documented inline.
- **Enum columns:** stored as text with a CHECK constraint, not as a Postgres `ENUM` type — text is easier to evolve via migration. Application enforces the canonical set.
- **Slug fields:** stable identifiers used in URLs and analytics. Once set, never user-editable. Display names are separately editable.

---

## Tables

### `users`
Source: **DD-013**

Application user. Single role per user (no multi-role membership in v1).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `email` | text | unique, not null |
| `display_name` | text | not null |
| `role` | text (enum) | `administrator` \| `legal_team_member` \| `contributor` \| `business_user` per **DD-013** |
| `created_at`, `updated_at` | timestamptz | |
| `archived_at` | timestamptz | soft-delete affordance |

Open: authentication-related columns (password hash vs OIDC sub vs magic-link only) deferred to the Intake / tech-stack grills. **DD-010** establishes that non-legal users authenticate via magic-link / ChatOps, not password.

---

### `entities` (own corporate entities)
Source: **DD-008**, project memory `project_entities_module_scope.md`

Internal corporate entities — your subsidiaries, holdings, and related corporate persons. Rich schema (officers, share capital, registered agent, EIN, registered address, statutory documents, license registry, renewal calendar).

Schema **TBD** — to be detailed in the Entities module grill (`DECISIONS-ENTITIES.md`, `ENT-###`).

---

### `counterparties` (external parties)
Source: **DD-008**

External organizations on the other side of contracts/matters. Light schema (name, jurisdiction, primary contact, address). Created on the fly during contract intake (per **DD-008** rationale point 2).

Schema **TBD** — to be detailed in the Contracts module grill (`DECISIONS-CONTRACTS.md`, `CON-###`).

---

### `parties_view` (read-only union)
Source: **DD-008**

SQL view that UNIONs `entities` and `counterparties` with a type discriminator and a shared subset of columns. Used by cross-cutting reads (search, party autocomplete, contract party assignment); module-specific reads use the underlying tables directly.

| Column | Source | Notes |
|---|---|---|
| `id` | `entities.id` / `counterparties.id` | UUID, unique within type |
| `type` | constant | `entity` \| `counterparty` |
| `name` | `entities.legal_name` / `counterparties.name` | |
| `jurisdiction` | both tables | |
| `primary_address` | both tables | |

---

### `matters`
Source: **DD-007**, **DD-014**, **MTR-001**

Work container for any legal effort. Holds Documents and Contracts; references Entities as subjects.

| Column | Type | Source | Notes |
|---|---|---|---|
| `id` | UUID | | PK |
| `matter_type_id` | UUID | **MTR-001** | FK → `matter_types.id`, not null |
| `is_confidential` | boolean | **DD-014** | default `false`; opt-in restriction gate |
| `created_by` | UUID | | FK → `users.id`; the matter creator (relevant to **DD-014** team-default) |
| `created_at`, `updated_at` | timestamptz | | |
| `archived_at` | timestamptz | | nullable |

**TBD columns** to be added by upcoming Matters decisions:

- Title / display name (MTR-### naming/numbering decision)
- Description / summary
- Lifecycle state (MTR-### lifecycle decision)
- Primary assignee (MTR-### assignment-model decision)
- Deadlines / SLA fields (MTR-### deadlines decision)

---

### `matter_types`
Source: **MTR-001**

Configurable taxonomy of matter types. Seeded at install with 9 default rows; Admin-managed thereafter via Matters Settings.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `slug` | text | unique, not null, immutable after creation |
| `display_name` | text | not null, user-editable |
| `description` | text | nullable |
| `display_order` | integer | not null; controls picker order |
| `is_system_default` | boolean | not null, default `false`; `true` for the 9 seed rows |
| `archived_at` | timestamptz | nullable; soft-delete affordance |
| `created_at`, `updated_at` | timestamptz | |

**Seed rows** (install-time migration):

`employment`, `litigation`, `regulatory`, `commercial`, `corporate`, `ip`, `privacy`, `advisory`, `other`.

`other` carries an additional protection in application code — cannot be hard-deleted regardless of permissions; archive is also blocked. Guarantees a non-null fallback type.

---

### `matter_team`
Source: **DD-014**, **DD-015**

Membership association linking users to matters with a role tag. Drives confidentiality team-membership semantics and Contributor scoping.

| Column | Type | Notes |
|---|---|---|
| `matter_id` | UUID | FK → `matters.id`, not null |
| `user_id` | UUID | FK → `users.id`, not null |
| `role` | text (enum) | `assignee` \| `watcher` \| `creator` \| `contributor` |
| `created_at` | timestamptz | |

Compound primary key on (`matter_id`, `user_id`, `role`) — a user may be both `assignee` and `creator` on the same matter. Same model is reused for `contract_team` and (likely) standalone `document_team` — TBD in those module grills.

---

### `contracts`
Source: **DD-007**, **DD-014**

Workflow object with parties; owns one or more Documents (draft, redlines, executed version, amendments). Referenced by Matters; can also stand alone.

Schema **TBD** — to be detailed in the Contracts module grill (`DECISIONS-CONTRACTS.md`, `CON-###`).

Known columns from platform decisions:

- `is_confidential` boolean per **DD-014**
- `matter_id` FK → `matters.id`, nullable per **DD-007** (contracts can stand alone)

---

### `documents`
Source: **DD-007**, **DD-014**

Underlying file primitive. No workflow. Can stand alone, be owned by a Contract, or attached to a Matter.

Schema **TBD** — to be detailed in the Documents module grill (`DECISIONS-DOCUMENTS.md`, `DOC-###`).

Known columns from platform decisions:

- `is_confidential` boolean per **DD-014**
- `contract_id` FK → `contracts.id`, nullable per **DD-007**
- `matter_id` FK → `matters.id`, nullable per **DD-007**

---

### `requests`
Source: **DD-010**

Source-of-truth for inbound work, before triage into a Contract or Matter (or resolved-in-thread).

Schema **TBD** — to be detailed in the Intake module grill (`DECISIONS-INTAKE.md`, `INT-###`).

---

### `comments`
Source: **DD-016**

Audience-tiered comments on every Matter, Contract, Document, and Request.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `entity_type` | text (enum) | `matter` \| `contract` \| `document` \| `request` |
| `entity_id` | UUID | polymorphic — references the row in the table named by `entity_type` |
| `author_id` | UUID | FK → `users.id`, not null |
| `body` | text | not null |
| `visibility` | text (enum) | `legal_only` \| `working_team` \| `full_thread` per **DD-016** |
| `created_at`, `updated_at` | timestamptz | |

The polymorphic `entity_type / entity_id` pair is unavoidable here unless we shard comments per host table. Reconsider in the tech-stack grill if the chosen ORM has a strong opinion. Indexed on (`entity_type`, `entity_id`, `created_at`).

---

### `activity_log`
Source: **DD-017**

Source-of-truth for both the per-entity activity feed and the system-wide audit log.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `entity_type` | text (enum) | `matter` \| `contract` \| `document` \| `request` \| `user` \| `system` |
| `entity_id` | UUID | nullable — `system`-typed entries (login, role change, intake-config change) have no entity |
| `actor_id` | UUID | nullable — system-emitted events (cron jobs, external webhooks) have no human actor |
| `action` | text | slug, e.g., `matter.created`, `confidentiality.set`, `user.role_changed`, `document.downloaded`, `matter_type.archived` |
| `visibility` | text (enum) | `legal_only` \| `working_team` \| `full_thread` \| `admin_only` per **DD-017** |
| `payload` | jsonb | action-specific data (old/new values for edits, etc.) |
| `created_at` | timestamptz | |

Append-only at the application layer. **No application-code path issues `UPDATE` or `DELETE`** on this table. Corrections are appended as new entries.

Indexed on (`entity_type`, `entity_id`, `created_at`) for the per-entity feed; on (`actor_id`, `created_at`) for actor-based audit queries; on (`action`, `created_at`) for security-event filtering.

---

## Outstanding schema questions

Tracked here so they're not forgotten when the relevant grill begins.

- **Database engine** — Postgres assumed; formalized in the tech-stack grill.
- **ID type** — UUID v7 vs ULID vs sortable BIGINT; formalized in the tech-stack grill.
- **ORM and migration framework** — formalized in the tech-stack grill (will affect comment polymorphism strategy and FK naming).
- **Comments table polymorphism strategy** — single table with `entity_type / entity_id` pair (current proposal), per-host-type sharded tables, or polymorphic via association — depends on ORM ergonomics.
- **Full-text search column placement** — per-table generated `tsvector` columns vs separate index store (Meilisearch / Typesense) — depends on Documents module decisions and tech-stack picks.
- **Authentication-related columns on `users`** — depends on Intake decisions (DD-010 establishes magic-link for non-legal; legal-team auth model TBD).
- **Tags table(s)** — separate concept from matter type per the open question in `DECISIONS-MATTERS.md`; structure TBD if tags become a decision.
