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

Source: **DD-013**, **TECH-008** (auth columns)

Application user. Single role per user (no multi-role membership in v1). better-auth maps onto this table via model/field mapping: `display_name` maps to its `name`, and `role` **is** the admin plugin's role column — never redeclared as an additional field.

| Column                     | Type        | Notes                                                                                                              |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`                       | UUID        | PK                                                                                                                 |
| `email`                    | text        | unique, not null                                                                                                   |
| `display_name`             | text        | not null                                                                                                           |
| `role`                     | text (enum) | `administrator` \| `legal_team_member` \| `contributor` \| `business_user` per **DD-013**                          |
| `email_verified`           | boolean     | not null, default `false` per **TECH-008**; proven inbox control (set-password activation, magic-link redemption)  |
| `image`                    | text        | nullable; better-auth core writes IdP profile pictures here — **deliberate deviation**, demanded by its core model |
| `two_factor_enabled`       | boolean     | nullable; twoFactor-plugin column, flipped by TOTP enrolment/disable (see `two_factors`)                           |
| `banned`                   | boolean     | nullable; admin-plugin column — **no product semantics yet** (offboarding is `archived_at`, not bans)              |
| `ban_reason`               | text        | nullable; admin-plugin column, same status as `banned`                                                             |
| `ban_expires`              | timestamptz | nullable; admin-plugin column, same status as `banned`                                                             |
| `created_at`, `updated_at` | timestamptz |                                                                                                                    |
| `archived_at`              | timestamptz | soft-delete affordance; checked in the session-creation hook — an archived user cannot authenticate by any path    |

Resolved (**TECH-008**, closing the earlier "Open" note): no credential material lives on `users`. Password hashes and OIDC subjects live in `accounts`; magic-link and set-password tokens live in `verifications`. The plugin-demanded columns above (`image`, `two_factor_enabled`, the ban trio) are deliberate deviations recorded per the auth spec. **DD-010**'s floor stands: non-legal users authenticate via magic link, not password.

---

### `sessions`

Source: **TECH-008** (sessions are ours in every auth mode)

Server-side sessions: one row per live sign-in, referenced by an httpOnly cookie. Database rows only — no cookie cache in v1, so revocation and role changes are instant. Default sliding expiry. Sign-out and admin revocation delete the row; a copied cookie is dead the moment the row is gone. Mode switches (`org_settings.auth_mode`) never invalidate existing sessions — the session model is mode-independent.

| Column                     | Type        | Notes                                                                                                                                                                                                |
| -------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                                                                                                                   |
| `user_id`                  | UUID FK     | → `users.id`, not null, cascade delete                                                                                                                                                               |
| `token`                    | text        | unique, not null; the cookie-carried session token                                                                                                                                                   |
| `expires_at`               | timestamptz | not null; sliding expiry                                                                                                                                                                             |
| `ip_address`               | text        | nullable; captured at creation for the session-management surface                                                                                                                                    |
| `user_agent`               | text        | nullable; same purpose                                                                                                                                                                               |
| `impersonated_by`          | UUID        | nullable; references `users.id` — admin-plugin column whose name deviates from the `<entity>_id` FK convention (plugin-dictated); no product semantics yet (the admin-plugin HTTP surface is closed) |
| `created_at`, `updated_at` | timestamptz |                                                                                                                                                                                                      |

No `archived_at`: sessions are revoked by deletion, not archived.

---

### `accounts`

Source: **TECH-008**

One row per authentication method per user: a **credential row** (holding the Argon2id password hash) and/or **OIDC-subject rows** (one per IdP the user has signed in through). Invited staff have no credential row until first-use activation sets a password — an unactivated invite has nothing to brute-force.

| Column                                                | Type        | Notes                                                                              |
| ----------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `id`                                                  | UUID        | PK                                                                                 |
| `user_id`                                             | UUID FK     | → `users.id`, not null, cascade delete                                             |
| `provider_id`                                         | text        | `credential`, or the `sso_providers.provider_id` slug for OIDC rows                |
| `account_id`                                          | text        | provider-side subject (OIDC `sub`); equals the user id on credential rows          |
| `password`                                            | text        | nullable; Argon2id hash per **TECH-008** — credential rows only, NULL on OIDC rows |
| `access_token`, `refresh_token`, `id_token`           | text        | nullable; OIDC token columns, demanded by better-auth's model                      |
| `access_token_expires_at`, `refresh_token_expires_at` | timestamptz | nullable; companions to the token columns                                          |
| `scope`                                               | text        | nullable; granted OIDC scopes                                                      |
| `created_at`, `updated_at`                            | timestamptz |                                                                                    |

Unique on (`provider_id`, `account_id`): one credential row per user, and no second user can ever claim someone else's OIDC subject. No `archived_at`: offboarding archives the _user_; account rows die with the user via cascade.

---

### `verifications`

Source: **TECH-008**, **DD-010**/**INT-001** (magic-link floor)

Short-lived single-use tokens: magic links and set-password (invite activation) tokens. Both the identifier and the token value are stored **hashed** — a database read never yields a usable link. Redemption consumes the row; expiry makes leftovers worthless.

| Column                     | Type        | Notes                                                      |
| -------------------------- | ----------- | ---------------------------------------------------------- |
| `id`                       | UUID        | PK                                                         |
| `identifier`               | text        | not null, stored hashed; addresses the pending token       |
| `value`                    | text        | not null, stored hashed; the token itself                  |
| `expires_at`               | timestamptz | not null; magic links and activation links are short-lived |
| `created_at`, `updated_at` | timestamptz |                                                            |

No user FK — the identifier carries the addressing (magic-link issuance is gated by `org_settings.allowed_email_domains` _before_ a row exists). No `archived_at`: rows are consumed or expire.

---

### `org_settings`

Source: **TECH-008**, **DD-010**/**INT-001** (revised per INT-001: magic-link portal, form-first)

Organization-wide settings. Exactly one row, seeded by the migration that creates the table; a unique index on a constant expression makes a second row unrepresentable. Columns arrive incrementally with the features that read them (**TECH-014**) — auth policy landed first; later Settings panes append here.

| Column                     | Type        | Notes                                                                                                 |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                    |
| `auth_mode`                | text (enum) | `built_in` \| `oidc` per **TECH-008**; seeded `built_in`                                              |
| `magic_link_enabled`       | boolean     | DD-010's portal floor; host-closable where SSO-only is policy. Seeded `true`                          |
| `allowed_email_domains`    | jsonb       | lower-cased domain strings gating magic-link issuance + JIT provisioning. Empty = nobody; seeded `[]` |
| `name`                     | text        | org identity per **SET-001** (General pane); seeded `''` until an Administrator names the org         |
| `logo`                     | text        | org logo as a `data:` URI; NULL until one is uploaded                                                 |
| `default_locale`           | text        | BCP 47 tag; the display locale until per-user locales exist (**DES-013**); seeded `en-US`             |
| `default_timezone`         | text        | IANA zone name; the display timezone until a user sets their own (**DES-014**); seeded `UTC`          |
| `created_at`, `updated_at` | timestamptz |                                                                                                       |

No `archived_at`: the row is neither creatable nor deletable, only edited.

---

### `sso_providers`

Source: **TECH-008** (bring-your-own IdP, configured at runtime)

Runtime-registered OIDC identity providers, one row per IdP, created only through the admin-guarded registration endpoint. Mapped onto by better-auth's sso plugin.

| Column                     | Type        | Notes                                                                                                               |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                                  |
| `provider_id`              | text        | unique slug; identifies the provider in sign-in and callback flows                                                  |
| `issuer`                   | text        | OIDC issuer URL; endpoint discovery runs from it at registration                                                    |
| `domain`                   | text        | email domain(s) served by the IdP, comma-separated for multi-domain                                                 |
| `oidc_config`              | text (JSON) | discovered + supplied OIDC config, **including the client secret** — at-rest encryption is a flagged future pass    |
| `saml_config`              | text (JSON) | demanded by the plugin's model; SAML is out of scope, always NULL                                                   |
| `organization_id`          | text        | demanded by the plugin's model; organization plugin unused, always NULL                                             |
| `domain_verified`          | boolean     | plugin trust flag gating email-linking to existing users; set at registration (admin registration = trust decision) |
| `user_id`                  | UUID FK     | the registering Administrator; no cascade — the provider outlives the registrant                                    |
| `created_at`, `updated_at` | timestamptz |                                                                                                                     |

No `archived_at`: providers are deleted (future management surface), not archived.

---

### `two_factors`

Source: **TECH-008** (TOTP second factor for password accounts)

One row per 2FA-enrolled user, owned by better-auth's twoFactor plugin. The seed and backup codes are symmetrically encrypted with the auth secret before storage and are never returned by any endpoint. 2FA gates only password sign-in — SSO delegates MFA to the IdP, and a magic link already proves inbox control. A companion `two_factor_enabled` boolean lives on `users` (plugin-demanded, like the admin-plugin columns).

| Column                      | Type        | Notes                                                                                                |
| --------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| `id`                        | UUID        | PK                                                                                                   |
| `secret`                    | text        | encrypted TOTP seed                                                                                  |
| `backup_codes`              | text        | encrypted JSON array of one-time recovery codes; redemption rewrites the array without the used code |
| `user_id`                   | UUID FK     | cascade delete — the factor dies with the user                                                       |
| `verified`                  | boolean     | false until the user proves the first code; unproven enrolments never challenge (or lock) a sign-in  |
| `failed_verification_count` | integer     | consecutive failed verifications, reset on success                                                   |
| `locked_until`              | timestamptz | account-level lockout: set after 10 consecutive failures, 15-minute lock                             |
| `created_at`, `updated_at`  | timestamptz |                                                                                                      |

No `archived_at`: rows are deleted on disable, not archived.

---

### `entities` (own corporate entities)

Source: **DD-008**, **ENT-001–004**

Internal corporate entities — your subsidiaries, holdings, and related corporate persons. Visible to all Member+ (no per-entity grants); `is_confidential` covers the rare sensitive case (ENT-004).

| Column                                    | Type        | Notes                                                                                                           |
| ----------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `id`                                      | UUID        | PK                                                                                                              |
| `legal_name`                              | text        | not null                                                                                                        |
| `entity_type_id`                          | UUID        | FK → `entity_types.id` (configurable list; seeds: corporation, llc, partnership, branch, other) per **ENT-001** |
| `jurisdiction`                            | text        | formation jurisdiction                                                                                          |
| `formed_on`                               | date        | nullable                                                                                                        |
| `registration_number`                     | text        | nullable                                                                                                        |
| `tax_id`                                  | text        | nullable                                                                                                        |
| `registered_agent`                        | text        | nullable                                                                                                        |
| `registered_address`                      | text        | nullable                                                                                                        |
| `status`                                  | text (enum) | `active` \| `dormant` \| `dissolved` \| `divested` — fixed per **ENT-001**                                      |
| `shares_authorized`, `shares_issued`      | bigint      | nullable; simple share capital per **ENT-001**                                                                  |
| `par_value`                               | bigint      | nullable, integer cents                                                                                         |
| `custom_fields`                           | jsonb       | keyed by slug; `entity`-scoped catalog fields per **ENT-001**/CTR-016                                           |
| `is_confidential`                         | boolean     | per **DD-014**/ENT-004                                                                                          |
| `created_at`, `updated_at`, `archived_at` | timestamptz |                                                                                                                 |

Support tables per **ENT-001/002/003/006**:

- `entity_types` — MTR-001 machinery (slug, display_name, display_order, is_system_default, archived_at); `other` protected. Officer roles likewise: `officer_roles` (seeds: director, ceo, cfo, secretary, other).
- `entity_officers` — `entity_id`, `name` text, `officer_role_id` FK, `appointed_on`, `resigned_on` (null = current), `user_id` nullable FK, timestamps.
- `entity_registrations` — `entity_id`, `jurisdiction`, `registration_number`, `registered_agent`, `status` (`active|lapsed|withdrawn`), timestamps.
- `entity_holdings` — (`owner_entity_id`, `owned_entity_id`, `ownership_percent`, timestamps), compound PK on the pair; no cycles (application-enforced); soft ≤100% validation per owned entity. Backs the v1 org chart (ENT-003).
- `entity_obligations` — `entity_id`, `label` text (no kind taxonomy), `registration_id` nullable FK, `recurrence_months` integer (null = one-off), `next_due_on` date, `assignee_id` nullable FK, `note`, timestamps. Blank-start; "Mark filed" logs the cycle and rolls `next_due_on` forward, human-confirmed (ENT-006). Feeds NOT-002 group 3.

---

### `counterparties` (external parties)

Source: **DD-008**

External organizations on the other side of contracts/matters. Light schema per **DD-008**; resolved in **CTR-011**. Created on the fly (name only) during contract intake; enrichment later and optional.

| Column                     | Type        | Notes                              |
| -------------------------- | ----------- | ---------------------------------- |
| `id`                       | UUID        | PK                                 |
| `name`                     | text        | not null — the only required field |
| `jurisdiction`             | text        | nullable                           |
| `primary_contact_name`     | text        | nullable                           |
| `primary_contact_email`    | text        | nullable                           |
| `address`                  | text        | nullable                           |
| `notes`                    | text        | nullable                           |
| `created_at`, `updated_at` | timestamptz |                                    |
| `archived_at`              | timestamptz | soft delete                        |

---

### `parties_view` (read-only union)

Source: **DD-008**

SQL view that UNIONs `entities` and `counterparties` with a type discriminator and a shared subset of columns. Used by cross-cutting reads (search, party autocomplete, contract party assignment); module-specific reads use the underlying tables directly.

| Column            | Source                                        | Notes                      |
| ----------------- | --------------------------------------------- | -------------------------- |
| `id`              | `entities.id` / `counterparties.id`           | UUID, unique within type   |
| `type`            | constant                                      | `entity` \| `counterparty` |
| `name`            | `entities.legal_name` / `counterparties.name` |                            |
| `jurisdiction`    | both tables                                   |                            |
| `primary_address` | both tables                                   |                            |

---

### `matters`

Source: **DD-007**, **DD-014**, **MTR-001**, **MTR-002**

Work container for any legal effort. Holds Documents and Contracts; references Entities as subjects.

| Column                     | Type        | Source      | Notes                                                                                                                                                  |
| -------------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                       | UUID        |             | PK                                                                                                                                                     |
| `number`                   | integer     | **MTR-009** | unique, DB sequence, immutable, never reused; displayed as `M-42`; used in URLs (`/matters/42`)                                                        |
| `title`                    | text        | **MTR-009** | not null; free text, editable (audit-logged)                                                                                                           |
| `matter_type_id`           | UUID        | **MTR-001** | FK → `matter_types.id`, not null                                                                                                                       |
| `status_id`                | UUID        | **MTR-002** | FK → `matter_statuses.id`, not null; defaults to first `open`-category status by display order                                                         |
| `manager_id`               | UUID        | **MTR-003** | FK → `users.id`, nullable; the Matter Manager. Null = unassigned (surfaced in triage)                                                                  |
| `priority`                 | text (enum) | **MTR-012** | `low` \| `medium` \| `high` \| `critical` (levels renamed per **DES-018**); not null, default `medium`; drives triage sort                             |
| `risk`                     | text (enum) | **MTR-012** | `low` \| `medium` \| `high` \| `critical`; nullable — null = not yet assessed (set by legal at triage)                                                 |
| `custom_fields`            | jsonb       | **MTR-011** | values keyed by field slug; GIN-indexed for filtering; values for fields detached from the type are retained but not rendered                          |
| `parent_id`                | UUID        | **MTR-015** | FK → `matters.id`, nullable; single parent, arbitrary depth, cycles rejected in application code. Navigational only — no cascade/inheritance semantics |
| `opened_at`                | timestamptz | **MTR-016** | set once at creation, never changes                                                                                                                    |
| `closed_at`                | timestamptz | **MTR-016** | set on transition into a `closed`-category status; cleared on reopen; null = open. Cycle time = `closed_at - opened_at`                                |
| `is_confidential`          | boolean     | **DD-014**  | default `false`; opt-in restriction gate                                                                                                               |
| `created_by`               | UUID        |             | FK → `users.id`; the matter creator (relevant to **DD-014** team-default)                                                                              |
| `created_at`, `updated_at` | timestamptz |             |                                                                                                                                                        |
| `archived_at`              | timestamptz |             | nullable                                                                                                                                               |

**TBD columns** to be added by upcoming Matters decisions:

- Description / summary

---

### `matter_types`

Source: **MTR-001**

Configurable taxonomy of matter types. Seeded at install with 9 default rows; Admin-managed thereafter via Matters Settings.

| Column                     | Type        | Notes                                                 |
| -------------------------- | ----------- | ----------------------------------------------------- |
| `id`                       | UUID        | PK                                                    |
| `slug`                     | text        | unique, not null, immutable after creation            |
| `display_name`             | text        | not null, user-editable                               |
| `description`              | text        | nullable                                              |
| `display_order`            | integer     | not null; controls picker order                       |
| `is_system_default`        | boolean     | not null, default `false`; `true` for the 9 seed rows |
| `archived_at`              | timestamptz | nullable; soft-delete affordance                      |
| `created_at`, `updated_at` | timestamptz |                                                       |

**Seed rows** (install-time migration):

`employment`, `litigation`, `regulatory`, `commercial`, `corporate`, `ip`, `privacy`, `advisory`, `other`.

`other` carries an additional protection in application code — cannot be hard-deleted regardless of permissions; archive is also blocked. Guarantees a non-null fallback type.

---

### `matter_key_dates`

Source: **MTR-004**

Named deadlines on a matter. Zero-to-many per matter; the earliest upcoming entry is the matter's "next deadline" in lists and dashboards. No SLA semantics in v1 (see `FUTURE-FEATURES.md`).

| Column                     | Type        | Notes                                                                                            |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `id`                       | UUID        | PK                                                                                               |
| `matter_id`                | UUID        | FK → `matters.id`, not null                                                                      |
| `date`                     | date        | not null; a calendar date, not a timestamp (deadlines are day-granular; display per **DES-014**) |
| `label`                    | text        | not null, e.g., "SOL expires", "Preliminary hearing"                                             |
| `note`                     | text        | nullable                                                                                         |
| `created_at`, `updated_at` | timestamptz |                                                                                                  |

Indexed on (`matter_id`, `date`). CRUD audit-logged per **DD-017**.

---

### `fields` (formerly `matter_fields`)

Source: **MTR-011**, revised by **CTR-016**

Custom-field catalog (Jira model), shared across modules with a scope. A field is defined once here; which records render it is controlled by per-type attachment (`matter_type_fields` / `contract_type_fields`). `field_type` is immutable after creation (archive and recreate instead — no silent value coercion).

| Column                     | Type        | Notes                                                                                                                                                                                               |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                                                                                                                  |
| `slug`                     | text        | unique, not null, immutable; key used in the per-module `custom_fields` jsonb                                                                                                                       |
| `display_name`             | text        | not null, user-editable                                                                                                                                                                             |
| `description`              | text        | nullable; shown as help text on forms                                                                                                                                                               |
| `module_scope`             | text (enum) | `matter` \| `contract` \| `entity` (**ENT-001**) \| `global` per **CTR-016**; global attaches across modules. Promotion to `global` allowed; narrowing blocked while cross-module attachments exist |
| `field_type`               | text (enum) | `text` \| `long_text` \| `number` \| `date` \| `boolean` \| `single_select` \| `multi_select` \| `user` \| `entity` (**CTR-016** adds `entity`) — **immutable**                                     |
| `options`                  | jsonb       | nullable; option list for select types                                                                                                                                                              |
| `field_tag`                | text (enum) | `business` \| `legal` per **DD-015**; drives Contributor visibility                                                                                                                                 |
| `ai_prompt`                | text        | nullable per **CTR-008/CTR-016**; extraction prompt consumed by contract AI analysis; seeded defaults on contract core fields, editable                                                             |
| `archived_at`              | timestamptz | nullable; archived fields hidden everywhere, stored values retained                                                                                                                                 |
| `created_at`, `updated_at` | timestamptz |                                                                                                                                                                                                     |

---

### `matter_type_fields`

Source: **MTR-011**

Attachment join: which global fields appear on which matter types, and in what order. Managed from each type's settings.

| Column           | Type        | Notes                                                                                                                   |
| ---------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `matter_type_id` | UUID        | FK → `matter_types.id`, not null                                                                                        |
| `field_id`       | UUID        | FK → `fields.id`, not null (renamed with the **CTR-016** catalog unification); scope must be `matter` or `global`       |
| `display_order`  | integer     | not null; per-type form order                                                                                           |
| `is_required`    | boolean     | **MTR-014**; not null, default `false`; hard-enforced at creation/re-type/edit (not retro-enforced on existing matters) |
| `created_at`     | timestamptz |                                                                                                                         |

Compound primary key on (`matter_type_id`, `field_id`). Attachment changes audit-logged per **DD-017**.

---

### `matter_relations`

Source: **MTR-015**

Undirected matter↔matter "related" links. One row per pair; application stores with `matter_a_id < matter_b_id` (canonical ordering) and renders on both matters.

| Column        | Type        | Notes                       |
| ------------- | ----------- | --------------------------- |
| `matter_a_id` | UUID        | FK → `matters.id`, not null |
| `matter_b_id` | UUID        | FK → `matters.id`, not null |
| `created_by`  | UUID        | FK → `users.id`             |
| `created_at`  | timestamptz |                             |

Compound primary key on (`matter_a_id`, `matter_b_id`); CHECK `matter_a_id <> matter_b_id`.

---

### `matter_templates`

Source: **MTR-013**

Named creation templates, Admin-managed. A template belongs to one matter type and supplies pre-fill values plus a task checklist. Applying one is always optional.

| Column                     | Type        | Notes                                                                              |
| -------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                 |
| `matter_type_id`           | UUID        | FK → `matter_types.id`, not null                                                   |
| `name`                     | text        | not null (e.g., "Employment – Termination")                                        |
| `description`              | text        | nullable                                                                           |
| `default_priority`         | text (enum) | nullable; per **MTR-012** enum                                                     |
| `default_risk`             | text (enum) | nullable; per **MTR-012** enum                                                     |
| `default_custom_fields`    | jsonb       | nullable; values keyed by field slug (fields attached to the type per **MTR-011**) |
| `title_prefix`             | text        | nullable; optional title pattern/prefix                                            |
| `archived_at`              | timestamptz | nullable                                                                           |
| `created_at`, `updated_at` | timestamptz |                                                                                    |

---

### `matter_template_tasks`

Source: **MTR-013**

Task rows carried by a template; instantiated as `matter_tasks` when the template is applied at matter creation.

| Column               | Type        | Notes                                                                          |
| -------------------- | ----------- | ------------------------------------------------------------------------------ |
| `id`                 | UUID        | PK                                                                             |
| `matter_template_id` | UUID        | FK → `matter_templates.id`, not null                                           |
| `title`              | text        | not null                                                                       |
| `due_offset_days`    | integer     | nullable; due date = matter creation + offset                                  |
| `assignee_role`      | text (enum) | `matter_manager` \| `none`; resolved at instantiation (**never** a named user) |
| `display_order`      | integer     | not null                                                                       |

---

### `matter_tasks`

Source: **MTR-005**

Lightweight checklist items on a matter. Deliberately not a task entity: no comments, no statuses beyond done, no sub-tasks, no detail page. Task due dates are internal to-dos and do **not** feed the "next deadline" surfaces (those read `matter_key_dates` per **MTR-004**).

| Column                     | Type        | Notes                                          |
| -------------------------- | ----------- | ---------------------------------------------- |
| `id`                       | UUID        | PK                                             |
| `matter_id`                | UUID        | FK → `matters.id`, not null                    |
| `title`                    | text        | not null                                       |
| `is_done`                  | boolean     | not null, default `false`                      |
| `assignee_id`              | UUID        | FK → `users.id`, nullable                      |
| `due_date`                 | date        | nullable                                       |
| `display_order`            | integer     | not null; manual ordering within the checklist |
| `created_at`, `updated_at` | timestamptz |                                                |

Indexed on (`matter_id`, `display_order`).

---

### `matter_statuses`

Source: **MTR-002**

Configurable lifecycle status labels, each mapped to a fixed system category. Application code branches only on `category`; labels are presentation/workflow metadata. Same machinery as `matter_types`.

| Column                     | Type        | Notes                                                 |
| -------------------------- | ----------- | ----------------------------------------------------- |
| `id`                       | UUID        | PK                                                    |
| `slug`                     | text        | unique, not null, immutable after creation            |
| `display_name`             | text        | not null, user-editable                               |
| `category`                 | text (enum) | `open` \| `closed`; **immutable after creation**      |
| `display_order`            | integer     | not null; controls picker order                       |
| `is_system_default`        | boolean     | not null, default `false`; `true` for the 4 seed rows |
| `archived_at`              | timestamptz | nullable; soft-delete affordance                      |
| `created_at`, `updated_at` | timestamptz |                                                       |

**Seed rows** (install-time migration): `open` (open), `in_progress` (open), `on_hold` (open), `closed` (closed).

The `open` and `closed` seed rows are system-protected (no hard-delete, no archive) — guarantees at least one status per category. Application additionally enforces ≥1 unarchived status per category.

---

### `matter_team`

Source: **DD-014**, **DD-015**, **MTR-003**

Membership association linking users to matters with a role tag. Drives confidentiality team-membership semantics and Contributor scoping. The single Matter Manager lives on `matters.manager_id` per **MTR-003**, not in this table.

| Column       | Type        | Notes                                                                                                                                                |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matter_id`  | UUID        | FK → `matters.id`, not null                                                                                                                          |
| `user_id`    | UUID        | FK → `users.id`, not null                                                                                                                            |
| `role`       | text (enum) | `member` \| `watcher` \| `creator` \| `contributor` per **MTR-003** (`assignee` promoted to `matters.manager_id`; `member` = supporting legal staff) |
| `created_at` | timestamptz |                                                                                                                                                      |

Compound primary key on (`matter_id`, `user_id`, `role`) — a user may be both `member` and `creator` on the same matter. Same model is reused for `contract_team` (done — **CTR-004**). No `document_team` exists — document access is always inherited from the owning record per **DOC-008**.

---

### `contracts`

Source: **DD-007**, **DD-014**, **CTR-001**

Workflow object with parties; owns one or more Documents (draft, redlines, executed version, amendments). Referenced by Matters; can also stand alone.

Schema **in progress** — being detailed in the Contracts module grill (`DECISIONS-CONTRACTS.md`, `CTR-###`).

Known columns so far:

- `number` — unique integer, global auto-increment sequence (own sequence, independent of matters), displayed **C-42**, used in URLs `/contracts/42`; immutable per **CTR-003**
- `title` — text, not null, free-form, editable per **CTR-003**
- `contract_type_id` FK → `contract_types.id`, not null per **CTR-002**
- `status_id` FK → `contract_statuses.id`, not null per **CTR-001**; the contract's **stage** is derived from the status, never stored on the contract
- `manager_id` FK → `users.id`, nullable (null = unassigned/triage), UI label "Owner" per **CTR-004**
- `priority` — text enum `low|medium|high|critical` (levels renamed per **DES-018**), not null, default `medium` per **CTR-005**
- `risk` — text enum `low|medium|high|critical`, nullable (null = not yet assessed) per **CTR-005**
- `term_type` — text enum `fixed|auto_renew|evergreen`, not null per **CTR-006**; renewal engine and calendar branch on this
- `effective_date` — date, nullable until known per **CTR-006**
- `expiry_date` — date, nullable (null for evergreen) per **CTR-006**
- `renewal_period_months` — integer, nullable (auto_renew only) per **CTR-006**
- `notice_period_days` — integer, nullable per **CTR-006**. **Derived, never stored:** notice deadline = `expiry_date − notice_period_days` (renewal calendar / reminders)
- `value_amount` — bigint (integer cents per DES-014), nullable per **CTR-010**
- `value_currency` — char(3) ISO 4217, nullable (required when amount set) per **CTR-010**
- `value_cadence` — text enum `one_time|monthly|annually`, nullable per **CTR-010**; total value (annual × term) derived, never stored
- `description` — text, nullable (long-form context rendered in the Description section; added in the 2026-08-06 screen sweep, replacing the mock's Memo tab)
- `custom_fields` — jsonb keyed by field slug per **CTR-016** (fields attached via `contract_type_fields`; values retained on detach)
- `ai_unverified` — jsonb, nullable per **CTR-008**: map of field slug → extraction meta (evidence snippet, run info) for AI-written values not yet human-confirmed; entry removed on confirmation.
- `entity_id` FK → `entities.id`, nullable until known per **CTR-011** — which of our entities signed
- `parent_id` FK → `contracts.id`, nullable per **CTR-015** — single parent, arbitrary depth, no cycles (application-enforced); no inheritance semantics
- `ended_at` — timestamptz, nullable per **CTR-019**: set on transition into the `ended` stage, cleared on revert (activity log remains source of truth)
- `is_confidential` boolean per **DD-014**; never cascades to/from linked records per **CTR-018**
- `matter_id` FK → `matters.id`, nullable per **DD-007** (contracts can stand alone)
- `primary_document_id` FK → `documents.id`, nullable, `ON DELETE SET NULL` per **CTR-014** — which document is the instrument. One column, so exactly one document holds the designation; the first upload takes it, and from there it moves to another document on the same contract or it stays where it is. That the named document belongs to this contract is enforced at write time. This settles the mechanism the `documents` section below left open (flag there vs FK here).

Ended behavior per **CTR-019**: signal not lock — record stays writable; drops from default lists, counts, and renewal-calendar surfaces; `archived_at` remains a separate soft-delete (mistakes/imports), not end-of-life.

Engine behavior per **CTR-006**: notify-only — the system never advances `expiry_date` itself; a past-due auto-renew shows "renewal pending confirmation" until a human confirms (then the date advances, activity-logged).

---

### `contract_counterparties`

Source: **CTR-011**

N counterparties per contract; exactly one `is_primary` (renders in the hero).

| Column            | Type        | Notes                                                                    |
| ----------------- | ----------- | ------------------------------------------------------------------------ |
| `contract_id`     | UUID        | FK → `contracts.id`, not null                                            |
| `counterparty_id` | UUID        | FK → `counterparties.id`, not null                                       |
| `is_primary`      | boolean     | not null, default `false`; application enforces exactly one per contract |
| `created_at`      | timestamptz |                                                                          |

Compound primary key on (`contract_id`, `counterparty_id`).

---

### `approver_groups` / `approver_group_members`

Source: **CTR-012**

Admin-managed reusable approver templates (Settings → Contracts → Approver Groups). Applying a group snapshots its members into `contract_approvals` at apply time; later group edits don't touch existing requests.

`approver_groups`: `id`, `name` (not null), `description` (nullable), `created_at`, `updated_at`, `archived_at`.
`approver_group_members`: compound PK (`group_id`, `user_id`), `created_at`.

---

### `contract_approvals`

Source: **CTR-012**

One row per approval request. Parallel — all pending must approve. Soft gate: advancing stage with unresolved approvals is allowed, warned, and activity-logged as an override.

| Column                     | Type        | Notes                                                         |
| -------------------------- | ----------- | ------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                            |
| `contract_id`              | UUID        | FK → `contracts.id`, not null                                 |
| `approver_id`              | UUID        | FK → `users.id`, not null                                     |
| `source`                   | text (enum) | `manual` \| `group`                                           |
| `group_id`                 | UUID        | FK → `approver_groups.id`, nullable (set when source = group) |
| `status`                   | text (enum) | `pending` \| `approved` \| `rejected`                         |
| `note`                     | text        | nullable; approver's comment on decision                      |
| `requested_by`             | UUID        | FK → `users.id`, not null                                     |
| `decided_at`               | timestamptz | nullable                                                      |
| `created_at`, `updated_at` | timestamptz |                                                               |

---

### `contract_type_fields`

Source: **CTR-016** (mirrors `matter_type_fields`, MTR-011/MTR-014)

Attachment join: which catalog fields appear on which contract types. Field scope must be `contract` or `global`.

| Column             | Type        | Notes                                                                                  |
| ------------------ | ----------- | -------------------------------------------------------------------------------------- |
| `contract_type_id` | UUID        | FK → `contract_types.id`, not null                                                     |
| `field_id`         | UUID        | FK → `fields.id`, not null                                                             |
| `display_order`    | integer     | not null; per-type form order                                                          |
| `is_required`      | boolean     | not null, default `false`; hard-enforced at creation/re-type/edit per the MTR-014 rule |
| `created_at`       | timestamptz |                                                                                        |

Compound primary key on (`contract_type_id`, `field_id`). Attachment changes audit-logged per **DD-017**.

---

### `contract_tasks`

Source: **CTR-017** (mirrors `matter_tasks`, MTR-005)

Lightweight checklist. Task due dates do **not** feed deadline surfaces.

| Column                     | Type        | Notes                         |
| -------------------------- | ----------- | ----------------------------- |
| `id`                       | UUID        | PK                            |
| `contract_id`              | UUID        | FK → `contracts.id`, not null |
| `title`                    | text        | not null                      |
| `is_done`                  | boolean     | not null, default `false`     |
| `assignee_id`              | UUID        | FK → `users.id`, nullable     |
| `due_date`                 | date        | nullable                      |
| `display_order`            | integer     | not null                      |
| `created_at`, `updated_at` | timestamptz |                               |

---

### `contract_relations`

Source: **CTR-015**

Typed, directional links between contracts (beyond the `parent_id` hierarchy). One row per pair per type (application-enforced). No cascade/inheritance semantics; inaccessible relatives render as "restricted contract".

| Column             | Type        | Notes                                                                              |
| ------------------ | ----------- | ---------------------------------------------------------------------------------- |
| `from_contract_id` | UUID        | FK → `contracts.id`, not null                                                      |
| `to_contract_id`   | UUID        | FK → `contracts.id`, not null                                                      |
| `relation_type`    | text (enum) | `related` (symmetric) \| `renews` \| `amends` (directional: from renews/amends to) |
| `created_at`       | timestamptz |                                                                                    |

Compound primary key on (`from_contract_id`, `to_contract_id`, `relation_type`).

---

### `contract_envelopes`

Source: **CTR-013**

Signing envelopes sent via the e-signature adapter (DocuSign first connector). Manual hand-off (upload executed PDF) creates no envelope row.

| Column                     | Type        | Notes                                        |
| -------------------------- | ----------- | -------------------------------------------- |
| `id`                       | UUID        | PK                                           |
| `contract_id`              | UUID        | FK → `contracts.id`, not null                |
| `provider`                 | text        | `docusign` in v1; adapter-keyed              |
| `provider_envelope_id`     | text        | not null                                     |
| `status`                   | text (enum) | `sent` \| `signed` \| `declined` \| `voided` |
| `sent_at`, `completed_at`  | timestamptz | completed_at nullable                        |
| `created_at`, `updated_at` | timestamptz |                                              |

---

### `contract_key_dates`

Source: **CTR-009** (mirrors `matter_key_dates`, MTR-004)

Free-form named dates beyond the typed term machinery (price reviews, milestones, option-exercise windows). Deadline surfaces show the union of these, `expiry_date`, and the derived notice deadline.

| Column                     | Type        | Notes                         |
| -------------------------- | ----------- | ----------------------------- |
| `id`                       | UUID        | PK                            |
| `contract_id`              | UUID        | FK → `contracts.id`, not null |
| `date`                     | date        | not null                      |
| `label`                    | text        | not null                      |
| `note`                     | text        | nullable                      |
| `created_at`, `updated_at` | timestamptz |                               |

---

### `contract_team`

Source: **CTR-004** (mirrors `matter_team`, MTR-003/DD-015)

| Column        | Type        | Notes                                                                                                          |
| ------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `contract_id` | UUID        | FK → `contracts.id`, not null                                                                                  |
| `user_id`     | UUID        | FK → `users.id`, not null                                                                                      |
| `role`        | text (enum) | `member` \| `watcher` \| `creator` \| `contributor` per **CTR-004** (owner promoted to `contracts.manager_id`) |
| `created_at`  | timestamptz |                                                                                                                |

Compound primary key on (`contract_id`, `user_id`, `role`).

---

### `contract_types`

Source: **CTR-002**

Configurable taxonomy of contract types. Same machinery as `matter_types` (MTR-001). Admin-managed via Contracts Settings → Types. Designated policy carrier: per-type custom fields (CTR-016), templates (deferred per CTR-017), and approval scoping (CTR-012 approver groups) attach here.

| Column                     | Type        | Notes                                                 |
| -------------------------- | ----------- | ----------------------------------------------------- |
| `id`                       | UUID        | PK                                                    |
| `slug`                     | text        | unique, not null, immutable after creation            |
| `display_name`             | text        | not null, user-editable                               |
| `description`              | text        | nullable                                              |
| `display_order`            | integer     | not null; controls picker order                       |
| `is_system_default`        | boolean     | not null, default `false`; `true` for the 8 seed rows |
| `archived_at`              | timestamptz | nullable; soft-delete affordance                      |
| `created_at`, `updated_at` | timestamptz |                                                       |

**Seed rows** (install-time migration): `nda`, `msa`, `sow`, `sales`, `vendor`, `employment`, `license`, `other`. The `other` row is system-protected (no archive/delete).

**Seeded contract-scoped catalog fields** (per **CTR-008**'s core-field commitment, confirmed in the 2026-08-06 screen sweep): `governing_law` (text), `jurisdiction` (text — forum/venue), `our_position` (single_select: customer | provider | other) — each with a default, editable `ai_prompt`.

---

### `contract_statuses`

Source: **CTR-001**

Configurable lifecycle status labels, each mapped to a fixed system **stage**. Application code branches only on `stage`; labels are presentation/workflow metadata. Same machinery as `matter_statuses`. Transitions are unrestricted (stage regression allowed, logged per DD-017).

| Column                     | Type        | Notes                                                                                                 |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                    |
| `slug`                     | text        | unique, not null, immutable after creation                                                            |
| `display_name`             | text        | not null, user-editable                                                                               |
| `stage`                    | text (enum) | `draft` \| `review` \| `approval` \| `signature` \| `active` \| `ended`; **immutable after creation** |
| `display_order`            | integer     | not null; controls picker order                                                                       |
| `is_system_default`        | boolean     | not null, default `false`; `true` for the seed rows                                                   |
| `archived_at`              | timestamptz | nullable; soft-delete affordance                                                                      |
| `created_at`, `updated_at` | timestamptz |                                                                                                       |

**Seed rows** (install-time migration): `draft` (draft), `internal_review` (review), `redlining` (review), `awaiting_approval` (approval), `out_for_signature` (signature), `active` (active), `expired` (ended), `terminated` (ended).

The `draft`, `active`, and `expired` seed rows are system-protected (no hard-delete, no archive). Application additionally enforces ≥1 unarchived status per seeded stage.

---

### `documents`

Source: **DD-007**, **DD-014**, **DOC-001**, **DOC-007**, **DOC-008**

Logical document record. No workflow. **Every document has exactly one owning record** (matter, contract, entity, or knowledge item) per **DOC-008** — no standalone documents (revises DD-007's stand-alone clause). Access is always inherited from the owner (its team + DD-014 confidentiality); there is no `document_team`. Files live in the version chain (`document_versions`), never on this record.

| Column                     | Type        | Notes                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                                                                                                                                                                                                                                                                                               |
| `title`                    | text        | not null per **DOC-001**                                                                                                                                                                                                                                                                                                                                                         |
| `description`              | text        | nullable per **DOC-007** (standard metadata only — no custom fields, no tags in v1)                                                                                                                                                                                                                                                                                              |
| `matter_id`                | UUID        | FK → `matters.id`, nullable                                                                                                                                                                                                                                                                                                                                                      |
| `contract_id`              | UUID        | FK → `contracts.id`, nullable                                                                                                                                                                                                                                                                                                                                                    |
| `entity_id`                | UUID        | FK → `entities.id`, nullable per **ENT-005**/**DOC-008**                                                                                                                                                                                                                                                                                                                         |
| `knowledge_item_id`        | UUID        | FK → `knowledge_items.id`, nullable per **KNW-001**/**DOC-008**                                                                                                                                                                                                                                                                                                                  |
| `folder_id`                | UUID        | FK → `document_folders.id`, nullable per **DOC-006**; the folder must belong to the same owning record as the document                                                                                                                                                                                                                                                           |
| `executed_version_id`      | UUID        | FK → `document_versions.id`, nullable per **DOC-001**, `ON DELETE SET NULL` — the CTR-014 executed pin; default target for previews/exports/AI analysis. Set and cleared explicitly, never inferred from a version's `kind`. The same-document invariant is enforced at write time rather than by a composite FK, which could not carry the plain `SET NULL` hard deletion needs |
| `is_confidential`          | boolean     | per **DD-014** (meaningful via the owning record's access; never cascades per CTR-018)                                                                                                                                                                                                                                                                                           |
| `created_by`               | UUID        | FK → `users.id`, not null                                                                                                                                                                                                                                                                                                                                                        |
| `created_at`, `updated_at` | timestamptz |                                                                                                                                                                                                                                                                                                                                                                                  |
| `archived_at`              | timestamptz | soft delete per **DOC-010** — off the record's lists and out of its counts, recoverable, and it destroys nothing. Hard deletion is the Administrator's separate path and leaves no row to hold a time                                                                                                                                                                            |

Exactly-one-owner rule (**DOC-008**): application enforces exactly one of the owner FKs set — `matter_id` | `contract_id` | `entity_id` (**ENT-005**) | `knowledge_item_id` (**KNW-001**). The owner set is now complete and all four columns are declared above. Repository destination is Member+; Contributors/Business Users reach documents only through records they're on (portal-readable knowledge items render their docs read-only per KNW-004).

---

### `knowledge_items` / `knowledge_types` / `knowledge_folders`

Source: **KNW-001–004**

The curated know-how home (DOC-002 routing): templates, precedents, playbooks, articles.

`knowledge_items`: `id`, `title` (not null), `knowledge_type_id` FK (configurable list — seeds: template, precedent, playbook, article; MTR-001 machinery), `body` (rich text), `folder_id` nullable FK, `state` (`draft | published`), `audience` (`legal_only | everyone` — published `everyone` items render read-only in the portal), `replaced_by_id` nullable self-FK (supersession on archive), `created_by`, timestamps, `archived_at`. Edit-in-place, audit-logged (no item versioning — owned documents carry DOC-001 version chains).

`knowledge_folders`: nested (`parent_id`), blank-start, organizing knowledge _items_ (distinct from `document_folders`, which organize documents within a record): `id`, `parent_id`, `name`, `display_order`, timestamps.

CTR-014 contract-side requirements (primary-document designation per contract; ordered version chain; kinds; executed pin; generated-redline provenance) are satisfied by **DOC-001**. Primary-document designation mechanism — **settled with the M11/4 contract-side surface: an FK on `contracts`** (`contracts.primary_document_id`), not a flag here. One column is the exactly-one rule stated as a shape, where a flag would need a partial unique index to say the same thing.

---

### `document_folders`

Source: **DOC-006**, **DOC-011**

Optional lightweight folders scoped within one owning matter, contract, or entity (**ENT-005** adds `entity_id` to the owner set; blank-start, nothing seeded). **Nested** per DOC-011 (folder-drop imports retain structure). The global repository view stays flat — folder is a filter facet there.

| Column                     | Type        | Notes                                                                                                                            |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                                               |
| `matter_id`                | UUID        | FK → `matters.id`, nullable                                                                                                      |
| `contract_id`              | UUID        | FK → `contracts.id`, nullable                                                                                                    |
| `entity_id`                | UUID        | FK → `entities.id`, nullable per **ENT-005**                                                                                     |
| `parent_id`                | UUID        | FK → `document_folders.id`, nullable per **DOC-011**; no cycles (application-enforced); parent must share the same owning record |
| `name`                     | text        | not null                                                                                                                         |
| `display_order`            | integer     | not null                                                                                                                         |
| `created_at`, `updated_at` | timestamptz |                                                                                                                                  |

Exactly one owner FK set (same rule shape as `documents`). Invariant: a folder, its parent, and every document filed in it all share the same owning record.

---

### `document_versions`

Source: **DOC-001**

Immutable file snapshots, strictly linear per document (`version_number` 1..n). Never edited or deleted individually — corrections add a new version. Beside the chain columns each row records the **file facts** the stored bytes are described by; they are written once at upload, because the blob behind `file_ref` is immutable and cannot drift from them.

| Column                     | Type        | Notes                                                                                                                                                                                                                 |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                                                                                                                                    |
| `document_id`              | UUID        | FK → `documents.id`, not null                                                                                                                                                                                         |
| `version_number`           | integer     | not null; unique per document, 1..n                                                                                                                                                                                   |
| `file_ref`                 | text        | not null; storage reference, `<driver>:<key>` per DOC-012 (e.g. `local:…`). A version row with no blob describes no bytes, so the constraint is part of the immutability claim above                                  |
| `kind`                     | text (enum) | `draft_ours` \| `redline_theirs` \| `redline_ours` \| `executed` \| `amendment` \| `generated_redline` (**CTR-014** kinds + generated)                                                                                |
| `source`                   | text (enum) | `uploaded` \| `generated`                                                                                                                                                                                             |
| `compared_from_version_id` | UUID        | FK → `document_versions.id`, nullable; generated redlines: the older comparison operand                                                                                                                               |
| `compared_to_version_id`   | UUID        | FK → `document_versions.id`, nullable; generated redlines: the newer comparison operand — both operands stored per **DOC-001**/**DOC-003** so the original comparison is reconstructable after the result is appended |
| `note`                     | text        | nullable                                                                                                                                                                                                              |
| `original_filename`        | text        | not null; the name the file arrived under, and the name a download offers back. Never used to build a storage key — keys are minted from ids                                                                          |
| `mime_type`                | text        | not null; what the upload declared. Client-supplied, so it is a rendering hint (**DOC-004**) and never a security decision                                                                                            |
| `byte_size`                | bigint      | not null; counted by the server as the bytes streamed past, not taken from a header                                                                                                                                   |
| `checksum_sha256`          | text        | not null; lowercase hex, computed over the same pass — written at upload so a later integrity check has something to compare against                                                                                  |
| `created_by`               | UUID        | FK → `users.id`, not null                                                                                                                                                                                             |
| `created_at`               | timestamptz | no `updated_at` — rows are immutable                                                                                                                                                                                  |

---

### `document_version_text`

Source: **DOC-005**

One version's extracted text, landed in M12/3. It sits **beside** the version chain and never in it: a `document_versions` row is immutable (DOC-001), so nothing a background job derives afterwards is written onto it.

The row is the record of work **owed**, not only of work done. It is written `pending` inside the upload's own transaction, so a rolled-back upload leaves nothing and a committed one always says a derivation is due — the queue send that follows only wakes a worker, and a lost send leaves a row for the M12/6 backfill sweep to find.

| Column       | Type        | Notes                                                                                                                                                                                                                                                                                                      |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version_id` | UUID        | PK and FK → `document_versions.id`, `ON DELETE CASCADE` — one text row per version, and lawful erasure (DOC-010) takes what the machine read along with what the person uploaded                                                                                                                           |
| `state`      | text (enum) | `pending` \| `ready` \| `failed` — code branches on all three, so the set is fixed                                                                                                                                                                                                                         |
| `source`     | text (enum) | `native_layer` \| `ocr`, nullable — where the text came from. Recorded rather than inferred: OCR text is a machine's reading of a photograph, and a later feature that weighs a match has to know which it holds. `rendition` (M12/4) and `email_body` (M12/5) join the set with the step that writes them |
| `text`       | text        | nullable; NULL unless `ready`. An empty string is a different and legitimate fact — a blank page read successfully                                                                                                                                                                                         |
| `created_at` | timestamptz |                                                                                                                                                                                                                                                                                                            |
| `updated_at` | timestamptz | when the state last moved; the panel polls on it                                                                                                                                                                                                                                                           |

A check constraint holds `state = 'ready'` and "has text from a named source" together, so a `ready` row can never answer a reader with silence and a `pending` row can never sit on an answer it already has.

---

### `notifications` / `notification_preferences`

Source: **NOT-001**

One notification system rendered on two surfaces: staff bell (full platform) and business-user bell (portal), plus email for both.

`notifications`: `id`, `user_id` (FK, not null), `event_type` (text — catalog per NOT decisions), `entity_type` / `entity_id` (polymorphic ref, documented inline like `comments`), `payload` (jsonb — rendering data), `read_at` (nullable), `emailed_at` (nullable), `created_at`.

`notification_preferences`: (`user_id`, `event_group`, `channel` `in_app|email`, `enabled` boolean, timestamps), compound PK on first three. Defaults per event group; in-app default-on.

---

### `requests`

Source: **DD-010** (as revised by **INT-001**), **INT-002**

Structured request envelope, created only via portal forms. Not a work container — converts to a Matter or Contract, or resolves in-thread. Portal conversation uses the `comments` machinery (DD-016).

| Column                     | Type        | Notes                                                                                                             |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                                |
| `number`                   | integer     | unique global sequence, displayed **R-42** per **INT-002**                                                        |
| `request_type_id`          | UUID        | FK → `request_types.id`, not null                                                                                 |
| `requester_id`             | UUID        | FK → `users.id`, not null (magic-link identity)                                                                   |
| `status`                   | text (enum) | `new` \| `converted` \| `resolved` \| `declined` per **INT-001** as revised by **INT-007** — fixed, code branches |
| `summary`                  | text        | not null                                                                                                          |
| `description`              | text        | nullable                                                                                                          |
| `urgency`                  | text (enum) | `low                                                                                                              | medium | high | critical`(levels per **DES-018**), requester-supplied; maps 1:1 to`priority`at conversion (MTR-012 —`risk` never requester-set) |
| `custom_fields`            | jsonb       | collected form values keyed by field slug per **INT-002**; carried into the converted record                      |
| `converted_matter_id`      | UUID        | FK → `matters.id`, nullable                                                                                       |
| `converted_contract_id`    | UUID        | FK → `contracts.id`, nullable                                                                                     |
| `declined_reason`          | text        | nullable                                                                                                          |
| `created_at`, `updated_at` | timestamptz |                                                                                                                   |
| `archived_at`              | timestamptz | soft delete                                                                                                       |

---

### `request_types` / `request_type_fields` / `request_attachments`

Source: **INT-002**

`request_types`: MTR-001 machinery (`slug`, `display_name`, `description`, `display_order`, `is_system_default`, `archived_at`, timestamps) + **target**: `target_matter_type_id` / `target_contract_type_id` (both nullable; at most one set). Admin-managed via Intake Settings → Request Types.

`request_type_fields`: (`request_type_id`, `field_id`, `display_order`, `is_required`, `created_at`), compound PK on the first two. Attachable fields: scope matching the target module, or `global`.

`request_attachments`: (`id`, `request_id`, `file_ref`, `filename`, `uploaded_by`, `created_at`) — lightweight; promoted into `documents` on conversion (requests are not document owners per DOC-008).

---

### `comments`

Source: **DD-016**, **CMT-001–009**

Audience-tiered comments — one system across record threads, document annotations, and the portal request thread. Flat chronological (no `parent_comment_id` by design, CMT-002). On request conversion, comment rows **re-parent** to the converted matter/contract with tiers preserved (CMT-001); `request` remains a target only for never-converted requests. The portal renders the record thread filtered to `full_thread`.

| Column                     | Type        | Notes                                                                                                                                                                      |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                                                                                         |
| `entity_type`              | text (enum) | `matter` \| `contract` \| `document` \| `request`                                                                                                                          |
| `entity_id`                | UUID        | polymorphic — references the row in the table named by `entity_type`                                                                                                       |
| `author_id`                | UUID        | FK → `users.id`, not null                                                                                                                                                  |
| `body`                     | text        | not null                                                                                                                                                                   |
| `visibility`               | text (enum) | `legal_only` \| `working_team` \| `full_thread` per **DD-016**; **immutable after posting** per CMT-005                                                                    |
| `anchor`                   | jsonb       | nullable per **CMT-001**; document comments only: `{version_id, quote, position}` — renders the K.B9 margin marker; lands with documents in M11, not before (**TECH-014**) |
| `edited_at`                | timestamptz | nullable per **CMT-005**; "edited" marker, prior text in `comment_revisions` per **CMT-006**                                                                               |
| `deleted_at`               | timestamptz | nullable per **CMT-005**; the author's own soft delete → tombstone in thread; the body moves to `comment_revisions`                                                        |
| `redacted_at`              | timestamptz | nullable per **CMT-008**; the Administrator's hard redact (MTR-008/DOC-010 pattern) → the other tombstone. Its own column, because the two removals are different acts     |
| `created_at`, `updated_at` | timestamptz |                                                                                                                                                                            |

Mentions (CMT-007): `comment_mentions` (`comment_id` FK → `comments.id` ON DELETE CASCADE, `user_id` FK → `users.id` with no delete action, so a person cannot be deleted out from under a mention — they are archived, never deleted, per SET-005), compound PK on both. Who a comment addresses is a queryable list, never a substring of the body — tier promotion reads it at post time, and the M18 notification fan-out reads it afterwards. The body stays plain text; a mention is written into it as `@` and the person's display name.

Prior versions (CMT-006, amending CMT-005): `comment_revisions` (`id`, `comment_id` FK → `comments.id` ON DELETE CASCADE, `body` not null, `replaced_at`), indexed on (`comment_id`, `replaced_at`). One row per body an edit or a soft delete replaced. The prior text cannot live in the audit log: DD-017 forbids `UPDATE` and `DELETE` on `activity_log`, so text that enters a payload can never leave, and a hard redact would remove the comment while leaving what it said in the log. This table is ordinary application data, so a redact purges it along with `comments.body` and `comment_mentions` (CMT-008) — the text and who it named are both gone rather than only hidden. Every `comment.*` activity payload carries ids and metadata only.

Unread tracking (CMT-004, confirmed by CMT-009): `comment_last_read` (`user_id` FK → `users.id` with no delete action, `entity_type`, `entity_id`, `read_at`, compound PK on the first three). One watermark per reader per record — where that person had read to, not a receipt per comment. The badge counts comments on the record that pass the viewer's tier predicate, are not the viewer's own, are neither soft-deleted nor redacted, and were created after `read_at`. Hidden-tier counts never leak, because the count is taken over the same filtered set the thread is read at. **No row means everything visible is unread**, not zero: a reader who has never opened the panel has read none of it. Opening the panel writes the row, and only when the thread was actually delivered.

The polymorphic `entity_type / entity_id` pair is unavoidable here unless we shard comments per host table. Reconsider in the tech-stack grill if the chosen ORM has a strong opinion. Indexed on (`entity_type`, `entity_id`, `created_at`).

---

### `activity_log`

Source: **DD-017**

Source-of-truth for both the per-entity activity feed and the system-wide audit log.

| Column        | Type        | Notes                                                                                                                   |
| ------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`          | UUID        | PK                                                                                                                      |
| `entity_type` | text (enum) | `matter` \| `contract` \| `document` \| `request` \| `user` \| `system`                                                 |
| `entity_id`   | UUID        | nullable — `system`-typed entries (login, role change, intake-config change) have no entity                             |
| `actor_id`    | UUID        | nullable — system-emitted events (cron jobs, external webhooks) have no human actor                                     |
| `action`      | text        | slug, e.g., `matter.created`, `confidentiality.set`, `user.role_changed`, `document.downloaded`, `matter_type.archived` |
| `visibility`  | text (enum) | `legal_only` \| `working_team` \| `full_thread` \| `admin_only` per **DD-017**                                          |
| `payload`     | jsonb       | action-specific data (old/new values for edits, etc.)                                                                   |
| `created_at`  | timestamptz |                                                                                                                         |

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
- **Authentication-related columns on `users`** — resolved per **TECH-008**: credential material lives in `accounts`/`verifications`, not on `users`; see the `users`, `sessions`, `accounts`, and `verifications` sections.
- **Tags table(s)** — resolved: deferred out of v1 per **MTR-010**; see `FUTURE-FEATURES.md`.
