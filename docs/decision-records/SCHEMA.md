# OpenLaw — Schema Reference

Living reference for the database schema. Captures table structures, column definitions, and the **decision provenance for each** — i.e., for every table or column, which DD or module-decision committed us to it.

This is **not** a migration file. SQL DDL lives in `db/migrations/` (when that exists). This document is the conceptual model that migrations should serialize, and a quick read for anyone trying to understand what the data looks like without reading the code.

## How to use this document

- New decisions that touch the schema append to or revise the affected table section, with a footnote-style reference to the decision (e.g., `[DD-014]`, `[MTR-001]`).
- When a decision is superseded, mark the affected schema sections superseded too, and link to the replacement decision.
- DDL syntax in this doc is illustrative (PostgreSQL-flavored — Postgres assumed pending the tech-stack grill). The conceptual columns and constraints are what's authoritative.

## Conventions

These apply unless a specific table overrides them.

- **Primary keys:** `id`, UUID v7 (sortable, time-ordered). Confirmed by **TECH-004**. **Stored as `text`, not as the native Postgres `uuid` type** — the value is a canonical UUIDv7 and carries the time-ordering; only the column type differs. That is deliberate and is argued in TECH-004's 2026-08-21 addendum. `uuidPk()` in `packages/db/src/schema/helpers.ts` is the one place it is declared. **The table sections below write `UUID` in their type column. Read that as the logical type — the physical column is `text` everywhere**, for `id`, for every `<entity>_id` foreign key, and for the polymorphic `entity_id` pairs alike. The sections were written before the type was settled and are not rewritten row by row, because the rule is one rule and it has no exceptions.
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

| Column                                                | Type        | Notes                                                                                                                           |
| ----------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                  | UUID        | PK                                                                                                                              |
| `user_id`                                             | UUID FK     | → `users.id`, not null, cascade delete                                                                                          |
| `provider_id`                                         | text        | `credential`, or the `sso_providers.provider_id` slug for OIDC rows                                                             |
| `account_id`                                          | text        | provider-side subject (OIDC `sub`); equals the user id on credential rows                                                       |
| `password`                                            | text        | nullable; Argon2id hash per **TECH-008** — credential rows only, NULL on OIDC rows                                              |
| `access_token`, `refresh_token`                       | text        | nullable; OIDC token columns, **encrypted at rest by better-auth** under `AUTH_SECRET` (**TECH-022**)                           |
| `id_token`                                            | text        | nullable; stored plaintext — better-auth writes it raw, and it is expired identity evidence whose claims already sit on `users` |
| `access_token_expires_at`, `refresh_token_expires_at` | timestamptz | nullable; companions to the token columns                                                                                       |
| `scope`                                               | text        | nullable; granted OIDC scopes                                                                                                   |
| `created_at`, `updated_at`                            | timestamptz |                                                                                                                                 |

Unique on (`provider_id`, `account_id`): one credential row per user, and one row per subject under a given provider registration. It is the pair better-auth looks an account up by, and the one it refuses to find twice. Two provider registrations naming the same IdP give one person's subject two rows here, each linked to the same user by email — accepted, since that is what happened and each row signs in. No `archived_at`: offboarding archives the _user_; account rows die with the user via cascade.

The two token columns are sealed by **better-auth**, not by `encryptedText`, so they are absent from `SEALED_COLUMNS` and there is no boot pass for them. better-auth owns every read and write of them, encrypts them under `AUTH_SECRET` when `account.encryptOAuthTokens` is set, and reads a pre-flag plaintext value straight through — so a later sign-in through the IdP rewrites the row sealed, with nothing to migrate. The rewrite is certain for `access_token`; `refresh_token` is only replaced when the IdP re-issues one, because better-auth keeps the stored value when the token response carries no new one. **TECH-022** records why the key differs from the one the five admin-pasted credentials use, and its #387 and M31 addenda record this residue and the fifth column.

An `issuer` column lived here between two migrations. better-auth 1.7.0 keyed an account on (`issuer`, `account_id`) — who asserted the subject rather than which provider row it was filed under — and `0060_account_issuer` (#340) backfilled one on every row, refusing an upgrade it could not resolve. 1.7.3 restored the 1.6 key above, and `0091_account_issuer_retired` dropped the column and its unique index; both migrations stay in the chain, and the rehearsal in `apps/api/src/account-issuer-migration.test.ts` walks a 1.6 install through both. **TECH-008**'s 1.7.3 addendum records why the reversal was taken rather than resisted.

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

| Column                         | Type        | Notes                                                                                                                                                                                                                                                                              |
| ------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                           | UUID        | PK                                                                                                                                                                                                                                                                                 |
| `auth_mode`                    | text (enum) | `built_in` \| `oidc` per **TECH-008**; seeded `built_in`                                                                                                                                                                                                                           |
| `magic_link_enabled`           | boolean     | DD-010's portal floor; host-closable where SSO-only is policy. Seeded `true`                                                                                                                                                                                                       |
| `allowed_email_domains`        | jsonb       | lower-cased domain strings gating magic-link issuance + JIT provisioning. Empty = nobody; seeded `[]`                                                                                                                                                                              |
| `name`                         | text        | org identity per **SET-001** (General pane); seeded `''` until an Administrator names the org                                                                                                                                                                                      |
| `logo`                         | text        | org logo as a `data:` URI; NULL until one is uploaded                                                                                                                                                                                                                              |
| `default_locale`               | text        | BCP 47 tag; the display locale until per-user locales exist (**DES-013**); seeded `en-US`                                                                                                                                                                                          |
| `default_timezone`             | text        | IANA zone name; the display timezone until a user sets their own (**DES-014**); seeded `UTC`                                                                                                                                                                                       |
| `reminder_offset_days`         | jsonb       | **NOT-004**'s one reminder-offset list, day-granular whole numbers, seeded `[7, 1, 0]`. Applied to every tracked date — key dates, notice deadlines, expiries — and read live by each morning round. Landed in M18/6                                                               |
| `onboarding_completed_at`      | timestamptz | Nullable; when the first-run wizard (**SET-004**) was finished or skipped through. NULL sends the Administrator into the wizard on login; set once, never cleared. Landed in migration `0001`                                                                                      |
| `onboarding_reviewed_types_at` | timestamptz | Nullable; the first Administrator acknowledgement of the seeded lists in Review (**SET-004**, #700). One-way and idempotent; skipping Review leaves it NULL. Landed in migration `0090_onboarding_reviewed_types.sql`; wizard Finish and the checklist action write the same mark. |
| `smtp_url`                     | text        | app-saved SMTP relay URL, credentials inline (**TECH-011**). **Write-only** through the API and **encrypted at rest** (**TECH-022**); ignored entirely while `SMTP_URL` pins the environment                                                                                       |
| `smtp_from`                    | text        | the from-address paired with `smtp_url`                                                                                                                                                                                                                                            |
| `created_at`, `updated_at`     | timestamptz |                                                                                                                                                                                                                                                                                    |

No `archived_at`: the row is neither creatable nor deletable, only edited.

---

### `sso_providers`

Source: **TECH-008** (bring-your-own IdP, configured at runtime)

Runtime-registered OIDC identity providers, one row per IdP, created only through the admin-guarded registration endpoint. Mapped onto by better-auth's sso plugin.

| Column                     | Type        | Notes                                                                                                                   |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                                      |
| `provider_id`              | text        | unique slug; identifies the provider in sign-in and callback flows                                                      |
| `issuer`                   | text        | OIDC issuer URL; endpoint discovery runs from it at registration                                                        |
| `domain`                   | text        | email domain(s) served by the IdP, comma-separated for multi-domain                                                     |
| `oidc_config`              | text (JSON) | discovered + supplied OIDC config, **including the client secret** — sealed whole, **encrypted at rest** (**TECH-022**) |
| `saml_config`              | text (JSON) | demanded by the plugin's model; SAML is out of scope, always NULL                                                       |
| `organization_id`          | text        | demanded by the plugin's model; organization plugin unused, always NULL                                                 |
| `domain_verified`          | boolean     | plugin trust flag gating email-linking to existing users; set at registration (admin registration = trust decision)     |
| `user_id`                  | UUID FK     | the registering Administrator; no cascade — the provider outlives the registrant                                        |
| `created_at`, `updated_at` | timestamptz |                                                                                                                         |

No `archived_at`: providers are deleted (future management surface), not archived.

---

### `signing_connectors`

Source: **CTR-013** (provider-agnostic signing adapter), **TECH-013** (DocuSign JWT grant), **SET-007** (the pane's home)

The credentials one e-signature provider is reached with. **Adapter-keyed**: one row per adapter, `provider` unique, `docusign` in v1 — a second provider is a second row, not a second table. The row is **org data, not deployment environment**: an Administrator configures it at runtime in Settings → Organization → Integrations → E-signature, and every use reads it live (the mailer-resolver pattern), so a rotation applies to the next call with no restart. An install with no row resolves to no provider, which is what keeps CTR-013's zero-config manual hand-off working.

| Column                     | Type        | Notes                                                                                                                                              |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                                                                 |
| `provider`                 | text (enum) | the adapter behind the row; `docusign` in v1. Unique — one connector per adapter                                                                   |
| `environment`              | text (enum) | `demo` \| `production`; the two estates differ by host and account (**TECH-013**)                                                                  |
| `integration_key`          | text        | DocuSign's integration key — the OAuth client id of the app                                                                                        |
| `api_user_id`              | text        | the provider-side user the integration signs as; a GUID in DocuSign's directory, never a row in ours                                               |
| `private_key`              | text        | RSA private key (PEM) that signs the JWT assertions. **Write-only** through the API; **encrypted at rest** (**TECH-022**)                          |
| `webhook_secret`           | text        | the Connect HMAC secret. **Write-only** and **encrypted at rest**, and **not nullable** — a connector without one would answer unsigned deliveries |
| `disabled_at`              | timestamptz | when an Administrator turned the connector off; NULL while it is on. A disabled row resolves to nothing, exactly as a missing one does             |
| `created_at`, `updated_at` | timestamptz |                                                                                                                                                    |

No `archived_at`: a connector is turned off with `disabled_at`, or deleted. The two secret columns are sealed by `encryptedText` with a key held outside the database (**TECH-022**), as `org_settings.smtp_url` and `sso_providers.oidc_config` are.

---

### `ai_connector`

Source: **CTR-008**, **TECH-012**, **TECH-022**, **SET-007**

The one AI connector for this install: the singleton provider configuration for Contract analysis. A unique index on constant `true` makes the singleton rule a database fact. It is configured at runtime in Settings → Organization → AI analysis and resolved live for both the API's Test connection call and every worker analysis run. There is no environment variable for the AI connector; the row is the only source.

| Column                     | Type        | Notes                                                                                                                                                   |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                                                                      |
| `preset`                   | text (enum) | `anthropic` \| `openai` \| `azure_openai` \| `gemini` \| `openrouter` \| `ollama` \| `custom`                                                           |
| `protocol`                 | text (enum) | `anthropic_messages` \| `openai_chat_completions` \| `gemini`; a custom endpoint still chooses one supported wire protocol                              |
| `base_url`                 | text        | not null; preset-supplied or Administrator-supplied endpoint                                                                                            |
| `api_key`                  | text        | nullable for keyless local endpoints; write-only through the API and encrypted at rest with `OPENLAW_SECRET_KEY` through `encryptedText` (**TECH-022**) |
| `model`                    | text        | not null; always editable, including for a preset                                                                                                       |
| `disabled_at`              | timestamptz | nullable; a disabled row resolves as no connector without deleting its configuration                                                                    |
| `created_at`, `updated_at` | timestamptz |                                                                                                                                                         |

Landed in M31/1, migration `0085_loud_scourge`. No `archived_at`: the singleton is disabled or removed.

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

Internal corporate entities — your subsidiaries, holdings, and related corporate persons. Visible to Member+ by default; `is_confidential` switches the rare sensitive Entity to explicit readers in `entity_grants` (ENT-004).

The M27 schema landed together in migration `0082_great_betty_ross`. It adds only nullable or defaulted columns (`custom_fields` defaults to `{}`, `is_confidential` to `false`), so populated pre-M27 Entity rows retain their values unchanged.

| Column                                    | Type        | Notes                                                                                                                                  |
| ----------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                      | UUID        | PK                                                                                                                                     |
| `legal_name`                              | text        | not null                                                                                                                               |
| `entity_type_id`                          | UUID        | FK → `entity_types.id` (configurable list; seeds: corporation, llc, partnership, branch, other) per **ENT-001**                        |
| `jurisdiction`                            | text        | formation jurisdiction                                                                                                                 |
| `formed_on`                               | date        | nullable                                                                                                                               |
| `registration_number`                     | text        | nullable                                                                                                                               |
| `tax_id`                                  | text        | nullable                                                                                                                               |
| `registered_agent`                        | text        | nullable                                                                                                                               |
| `registered_address`                      | text        | nullable                                                                                                                               |
| `status`                                  | text (enum) | `active` \| `dormant` \| `dissolved` \| `divested` — fixed per **ENT-001**                                                             |
| `shares_authorized`, `shares_issued`      | bigint      | nullable; simple share capital per **ENT-001**                                                                                         |
| `par_value`                               | bigint      | nullable, integer cents                                                                                                                |
| `custom_fields`                           | jsonb       | not null, default `{}`, keyed by slug; object shape enforced by CHECK; values retained on detach per **ENT-001**/CTR-016               |
| `is_confidential`                         | boolean     | not null, default `false`, per **DD-014**/ENT-004                                                                                      |
| `created_at`, `updated_at`, `archived_at` | timestamptz |                                                                                                                                        |
| `search_vector`                           | tsvector    | stored generated English FTS: `legal_name` weight A; jurisdiction, registration number, and fixed status weight C (**DOC-009**, M25/2) |

Support tables per **ENT-001/002/003/006**:

- `entity_types` — MTR-001 machinery (slug, display_name, display_order, is_system_default, archived_at); `other` protected.
- `officer_roles` — the shared taxonomy column set; seeds director, ceo, cfo, secretary, other in display order. `other` is protected. Its SET-003 usage guard counts and reassigns every referencing `entity_officers` row, including resigned officers.
- `entity_officers` — `entity_id`, `name` text, `officer_role_id` FK, `appointed_on`, `resigned_on` (null = current), `user_id` nullable FK, timestamps.
- `entity_registrations` — `entity_id`, `jurisdiction`, `registration_number`, `registered_agent`, `status` (`active|lapsed|withdrawn`), timestamps.
- `entity_holdings` — (`owner_entity_id`, `owned_entity_id`, `ownership_percent`, timestamps), compound PK on the pair; row CHECKs prohibit self-ownership and hold percentage to 0–100. Longer cycles remain application-enforced; soft ≤100% aggregate validation per owned Entity backs the v1 org chart (ENT-003).
- `entity_obligations` — `entity_id`, `label` text (no kind taxonomy), `registration_id` nullable FK with `ON DELETE SET NULL`, `recurrence_months` integer (null = one-off), `next_due_on` date, `assignee_id` nullable FK, `note`, `matter_id` nullable FK, `completed_on`, timestamps. Blank-start; "Mark filed" logs the cycle and rolls recurring `next_due_on` forward until it is after the filing day, while a one-off records `completed_on`; nothing advances without that explicit write (ENT-006 and its M27/6 addendum). Feeds NOT-002 group 3 as `date.obligation_approaching`.
- `entity_type_fields` — compound PK (`entity_type_id`, `field_id`) plus `display_order`, `is_required`, and `created_at`; attaches `entity`/`global` catalog Fields through the shared type-field machinery.
- `entity_grants` — compound PK (`entity_id`, `user_id`) plus `created_at`; the explicit-reader set for confidential Entities (ENT-004).

---

### `counterparties` (external parties)

Source: **DD-008**

External organizations on the other side of contracts/matters. Light schema per **DD-008**; resolved in **CTR-011**. Created on the fly (name only) during contract intake; enrichment later and optional.

| Column                     | Type        | Notes                                                                                   |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                      |
| `name`                     | text        | not null — the only required field                                                      |
| `jurisdiction`             | text        | nullable                                                                                |
| `primary_contact_name`     | text        | nullable                                                                                |
| `primary_contact_email`    | text        | nullable                                                                                |
| `address`                  | text        | nullable                                                                                |
| `notes`                    | text        | nullable                                                                                |
| `created_at`, `updated_at` | timestamptz |                                                                                         |
| `archived_at`              | timestamptz | soft delete                                                                             |
| `search_vector`            | tsvector    | stored generated English FTS: name weight A, jurisdiction weight C (**DOC-009**, M25/2) |

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
| `description`              | text        |             | nullable; free-text summary, editable and audit-logged                                                                                                 |
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
| `search_vector`            | tsvector    | **DOC-009** | stored generated English FTS: title and M-number weight A, description weight B; Type and Status labels remain query-time joins                        |

`parent_id` and the `matter_relations` table landed in M23/5, migration
`0075_watery_war_machine`. Existing Matters receive `NULL` and are otherwise unchanged.

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
| `matter_id`                | UUID        | FK → `matters.id`, not null, cascade — a Key date is part of the Matter                          |
| `date`                     | date        | not null; a calendar date, not a timestamp (deadlines are day-granular; display per **DES-014**) |
| `label`                    | text        | not null, 1–200 trimmed characters, e.g., "SOL expires", "Preliminary hearing"                   |
| `note`                     | text        | nullable, 1–2000 trimmed characters; a blank write is normalized to NULL                         |
| `created_at`, `updated_at` | timestamptz |                                                                                                  |

Indexed on (`matter_id`, `date`). CRUD audit-logged per **DD-017**.

Landed in M23/3, migration `0073_shocking_raider`. Closing and archiving retain these rows. Only an open, non-archived Matter contributes a Next deadline or approaching-date notification; archive freezes CRUD, while closing does not.

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
| `field_tag`                | text (enum) | `business` \| `legal` per **DD-015**; drives Contributor projection and write permission                                                                                                            |
| `ai_prompt`                | text        | nullable per **CTR-008/CTR-016**; extraction prompt for this catalog Field when it is attached to a Contract Type. Core target prompts do not live here                                             |
| `archived_at`              | timestamptz | nullable; archived fields hidden everywhere, stored values retained                                                                                                                                 |
| `created_at`, `updated_at` | timestamptz |                                                                                                                                                                                                     |

---

### `ai_field_prompts`

Source: **CTR-008**, **TECH-012**

Administrator overrides for the seven core Contract-analysis prompts. The primary key is the canonical target slug. Absence means use the built-in prompt from `packages/shared/src/analysis.ts`; resetting a prompt deletes the row rather than copying the default into the database.

| Column       | Type        | Notes                                                              |
| ------------ | ----------- | ------------------------------------------------------------------ |
| `slug`       | text        | PK; one of the seven core target slugs enforced by the write route |
| `prompt`     | text        | not null; trimmed and bounded to 2,000 characters                  |
| `updated_at` | timestamptz | not null; refreshed on update                                      |

Landed in M31/5, migration `0086_free_invisible_woman`. No `id`, `created_at`, or `archived_at`: the slug is the identity and deleting the override restores the shipped default.

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
| `created_by`  | UUID        | FK → `users.id`, not null   |
| `created_at`  | timestamptz |                             |

Compound primary key on (`matter_a_id`, `matter_b_id`); CHECK `matter_a_id < matter_b_id`.

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

### `matter_template_key_dates`

Source: **MTR-013 addendum (M24/4)**

Ordered relative Key dates carried by a template; instantiated as `matter_key_dates` when the template is applied at Matter creation.

| Column               | Type    | Notes                                                                       |
| -------------------- | ------- | --------------------------------------------------------------------------- |
| `id`                 | UUID    | PK                                                                          |
| `matter_template_id` | UUID    | FK → `matter_templates.id`, not null, cascade; the row is template content  |
| `label`              | text    | not null; 1–200 trimmed characters                                          |
| `offset_days`        | integer | not null; whole number from 0 through 3,650                                 |
| `note`               | text    | nullable; 1–2,000 trimmed characters; a blank write is normalized to `NULL` |
| `display_order`      | integer | not null; at least 1                                                        |

Indexed on (`matter_template_id`, `display_order`).

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

Indexed on (`matter_id`, `display_order`). M29 adds (`assignee_id`, `due_date`) for the personal Home and briefing reads.

Landed in incremental migration `0074_bored_felicia_hardy.sql` (M23/4, #492). The migration only adds this table, its two foreign keys, title check, and ordering index; it does not rewrite existing Matter rows.

At M23 close, these additions remain four incremental migrations over the M22 model: `matter_key_dates`, `matter_tasks`, `matters.parent_id` plus `matter_relations`, and nullable `contracts.matter_id`. None rewrites existing Matter, Contract, Field, team, Document, Activity, `opened_at`, or `closed_at` data. Closing adds no Resolution or note column; Key dates add no owner; M24 templates still carry Tasks only unless MTR-013's open question later changes that contract. Relationships and Contract links carry no inheritance or cascade columns.

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

The Contract core landed through M17, the Matter link landed incrementally in M23/6, and `ai_unverified` landed in M31/2. Schema details live in `DECISIONS-CONTRACTS.md` (`CTR-###`).

Columns:

- `number` — unique integer, global auto-increment sequence (own sequence, independent of matters), displayed **C-42**, used in URLs `/contracts/42`; immutable per **CTR-003**
- `title` — text, not null, free-form, editable per **CTR-003**
- `contract_type_id` FK → `contract_types.id`, not null per **CTR-002**
- `status_id` FK → `contract_statuses.id`, not null per **CTR-001**; the contract's **stage** is derived from the status, never stored on the contract
- `manager_id` FK → `users.id`, nullable (null = unassigned/triage), UI label "Owner" per **CTR-004**
- `priority` — text enum `low|medium|high|critical` (levels renamed per **DES-018**), not null, default `medium` per **CTR-005**
- `risk` — text enum `low|medium|high|critical`, nullable (null = not yet assessed) per **CTR-005**
- `term_type` — text enum `fixed|auto_renew|evergreen`, not null per **CTR-006**, default `fixed`; renewal engine and calendar branch on this. Landed in M16/1
- `effective_date` — date, nullable until known per **CTR-006**. Landed in M16/1
- `expiry_date` — date, nullable (null for evergreen) per **CTR-006**. Landed in M16/1
- `renewal_period_months` — integer, nullable (auto_renew only) per **CTR-006**. Landed in M16/1
- `notice_period_days` — integer, nullable per **CTR-006**. **Derived, never stored:** notice deadline = `expiry_date − notice_period_days` (renewal calendar / reminders). Landed in M16/1
- `value_amount` — bigint (integer cents per DES-014), nullable per **CTR-010**
- `value_currency` — char(3) ISO 4217, nullable (required when amount set) per **CTR-010**
- `value_cadence` — text enum `one_time|monthly|annually`, nullable per **CTR-010**; total value (annual × term) derived, never stored
- `description` — text, nullable (long-form context rendered in the Description section; added in the 2026-08-06 screen sweep, replacing the mock's Memo tab)
- `custom_fields` — jsonb keyed by field slug per **CTR-016** (fields attached via `contract_type_fields`; values retained on detach)
- `ai_unverified` — jsonb, nullable per **CTR-008**: map of field slug → extraction meta (exact evidence, Analysis run id, written time) for AI-written values not yet human-confirmed; a human write or confirmation removes that entry. Landed in M31/2, migration `0086_free_invisible_woman`
- `entity_id` FK → `entities.id`, nullable until known per **CTR-011** — which of our entities signed
- `parent_id` FK → `contracts.id`, nullable per **CTR-015** — single parent, arbitrary depth, no cycles (application-enforced); no inheritance semantics. Landed in M16/5, migration `0048_contract_relations`, with the routing that first writes it (CTR-007's child-contract vehicle). A `parent_id <> id` check states the shortest cycle as a row rule; the longer ones are the write path's walk. Indexed for the walk and the M17 hierarchy surfaces
- `ended_at` — timestamptz, nullable per **CTR-019**: set on transition into the `ended` stage, cleared on reopen (activity log remains source of truth). Landed in M17/3, migration `0050_contract_ended_at`, with no backfill
- `is_confidential` boolean per **DD-014**; never cascades to/from linked records per **CTR-018**
- `matter_id` FK → `matters.id`, nullable and indexed per **DD-007** (contracts can stand alone). Landed incrementally in M23/6, migration `0076_thankful_cerebro`, with no backfill: every existing Contract remains null/standalone
- `primary_document_id` FK → `documents.id`, nullable, `ON DELETE SET NULL` per **CTR-014** — which document is the instrument. One column, so exactly one document holds the designation; the first upload takes it, and from there it moves to another document on the same contract or it stays where it is. That the named document belongs to this contract is enforced at write time. This settles the mechanism the `documents` section below left open (flag there vs FK here).
- `search_vector` — stored generated English FTS per **DOC-009** M25/2: title and C-number weight A, description weight B. Configured Type and Status labels and Counterparty names remain query-time joins rather than copied context.

Ended behavior per **CTR-019**: signal not lock — record stays writable; drops from default lists, counts, and renewal-calendar surfaces; `archived_at` remains a separate soft-delete (mistakes/imports), not end-of-life.

Engine behavior per **CTR-006**: notify-only — the system never advances `expiry_date` itself; a past-due auto-renew shows "renewal pending confirmation" until a human confirms (then the date advances, activity-logged).

Term shape per **CTR-006**. The five columns landed in M16/1, migration `0046_contract_term`.

- **Constraints.** Five checks, so no write path can get past them. `term_type` is one of the three kinds. An `evergreen` contract holds no `expiry_date`. Only an `auto_renew` contract holds a `renewal_period_months`. A roll is at least one month. A notice period is at least zero days.
- **Backfill.** Existing rows took `fixed`. That is an assertion about them, not a discovery: `fixed` is the least-asserting of the three kinds. Re-type an evergreen contract by editing it.
- **Derived.** Four answers the record gives sit in no column, and all four are computed where the answer is assembled. The notice deadline above; days remaining (`expiry_date − today`), which goes negative once the expiry has passed; **renewal pending confirmation** (M16/4) — true when the contract is `auto_renew`, is not archived, is not ended, and its `expiry_date` is behind today; and the **proposed roll expiry**, `expiry_date` plus `renewal_period_months`, clamped at the target month's last day — null whenever the contract cannot roll, which is any term that is not `auto_renew` and any `auto_renew` term missing either `expiry_date` or `renewal_period_months`. None of the four needs a job, a sweep, or a clock.
- **A renewal is not a row.** Confirming a roll (**CTR-007**) moves `expiry_date` and appends one `contract.renewal_confirmed` entry to `activity_log`; nothing else records it. The record's renewal history and its "Last renewal" fact are those entries read back. No renewal table exists, and none is planned.

---

### `contract_analysis_runs`

Source: **CTR-008**, **TECH-006**, **TECH-012**

One durable reading of one Contract's chosen Document Version against the Contract's current analysis target schema. Automatic and manual triggers use the same ledger and worker path. The outcome records every target as written, kept, unmatched, or invalid with its evidence; the row is the account of the run, not a proposal table.

| Column         | Type        | Notes                                                                                                     |
| -------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| `id`           | UUID        | PK                                                                                                        |
| `contract_id`  | UUID FK     | → `contracts.id`, not null, cascade delete                                                                |
| `version_id`   | UUID FK     | → `document_versions.id`, nullable, `ON DELETE SET NULL`; lawful Document erasure keeps the run's account |
| `state`        | text (enum) | `pending` \| `ready` \| `failed`, not null, default `pending`                                             |
| `trigger`      | text (enum) | `automatic` \| `manual`, not null                                                                         |
| `requested_by` | UUID FK     | → `users.id`, nullable; automatic runs have no requester                                                  |
| `preset`       | text (enum) | connector preset used for this run                                                                        |
| `model`        | text        | provider model used for this run                                                                          |
| `truncated`    | boolean     | not null, default `false`; the provider saw the bounded prefix rather than the whole extracted text       |
| `outcome`      | jsonb       | nullable until ready; typed per-target extraction and writer outcomes with evidence                       |
| `failure`      | text        | nullable; stable failure account for a failed run                                                         |
| `started_at`   | timestamptz | nullable until the worker claims the run                                                                  |
| `finished_at`  | timestamptz | nullable until ready or failed                                                                            |

Indexed on (`contract_id`, `id`) for the record's latest-run read. The state and trigger columns carry CHECK constraints. Landed in M31/2, migration `0086_free_invisible_woman`; the automatic scheduler began writing the same table in M31/3.

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

`approver_groups`: `id`, `name` (not null), `description` (nullable), `created_at`, `updated_at`, `archived_at`. A **partial unique** index on `lower(name)` `where archived_at is null` — the name is the only identity the apply picker shows, so two live groups may not share one, and archiving frees the name (CTR-012's #391 addendum).
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

Five invariants ride the table itself (M14/3). A **partial** unique index on (`contract_id`, `approver_id`) `where status = 'pending'` enforces CTR-012's one-pending-request-per-approver rule while leaving a decided row free, so a re-request after a rejection writes a new row. A check constraint pairs `group_id` with `source = 'group'`, and a second one pairs `decided_at` with a status other than `pending` — a half-set pair on either would draw a cell nobody could read. Two more hold `source` and `status` to the values CTR-012 defines: the paired checks above do not imply them, because an unknown `source` with a NULL `group_id` satisfies the first pair and an unknown `status` carrying a `decided_at` satisfies the second. Index on `contract_id` for the roster read; M29 adds (`approver_id`, `status`) for the personal Home and briefing reads.

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

Landed in M17/1, migration `0049_contract_tasks`.

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

M29 adds an index on (`assignee_id`, `due_date`) for the personal Home and briefing reads.

---

### `contract_relations`

Source: **CTR-015**

Typed, directional links between contracts (beyond the `parent_id` hierarchy). One row per pair per type (application-enforced). No cascade/inheritance semantics; inaccessible relatives render as "restricted contract".

Landed in M16/5, migration `0048_contract_relations`, with CTR-007's successor vehicle — the feature that first needs a renewal to be identified by its link. M16 wrote the rows and the rules; M17 landed the relations panel, the hierarchy breadcrumb, manual link creation and removal, and the restricted-contract rendering.

| Column             | Type        | Notes                                                                              |
| ------------------ | ----------- | ---------------------------------------------------------------------------------- |
| `from_contract_id` | UUID        | FK → `contracts.id`, not null                                                      |
| `to_contract_id`   | UUID        | FK → `contracts.id`, not null                                                      |
| `relation_type`    | text (enum) | `related` (symmetric) \| `renews` \| `amends` (directional: from renews/amends to) |
| `created_at`       | timestamptz |                                                                                    |

Compound primary key on (`from_contract_id`, `to_contract_id`, `relation_type`) — which is CTR-015's duplicate guard stated as the shape rather than kept as a convention. The type is part of the key, so two contracts may hold two links of different kinds at once. A `from <> to` check refuses a self-link, and `to_contract_id` is indexed for the far half of every relations read. Both foreign keys cascade: a link is a fact about exactly these two records and about nothing else.

**Both writes go through one path** (`apps/api/src/lib/contract-relations.ts`), which asks the two guards before the row does, so a caller reads a named RFC 9457 refusal instead of a constraint violation. The path serializes both writes under one transaction-scoped advisory lock, because neither guard holds in a race a single row cannot see: a cycle can be threaded by two concurrent parent writes, and a symmetric `related` mirror is two different keys to the compound key. Renewal routing cannot itself reach either refusal — a contract born a moment ago has no descendants to loop through and no links to duplicate — and it goes through the guarded path anyway, because the rule belongs to the write and not to the caller that happens to be safe.

**The writes are narrated as their own verbs**: `contract.parent_set` and `contract.relation_added`, both at the record tier, both hung on the record that changed — which is the new one. Nothing is written on the far end, because nothing there moved.

---

### `contract_envelopes`

Source: **CTR-013**

Signing envelopes sent via the e-signature adapter (DocuSign first connector). Manual hand-off (upload executed PDF) creates no envelope row. Landed in M15/2 with the columns the send writes and the later slices move; `executed_version_id` joined it in M15/5, the slice that files an executed copy.

| Column                     | Type        | Notes                                                                                  |
| -------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                     |
| `contract_id`              | UUID        | FK → `contracts.id`, not null, cascade                                                 |
| `provider`                 | text        | `docusign` in v1; adapter-keyed                                                        |
| `provider_envelope_id`     | text        | not null; unique with `provider` — the webhook's correlation key                       |
| `status`                   | text (enum) | `sent` \| `signed` \| `declined` \| `voided`, default `sent`                           |
| `document_version_id`      | UUID        | FK → `document_versions.id`, nullable, SET NULL — which round went out (CTR-014)       |
| `sent_by`                  | UUID        | FK → `users.id`, not null                                                              |
| `reason`                   | text        | nullable; the decline or void reason, and only on those two statuses                   |
| `executed_fetch`           | text (enum) | `pending` \| `ready` \| `failed`, default `pending` — the M12 derived-artifact pattern |
| `executed_version_id`      | UUID        | FK → `document_versions.id`, nullable, SET NULL — the round **this envelope** filed    |
| `sent_at`, `completed_at`  | timestamptz | completed_at nullable, and null exactly while the status is `sent`                     |
| `created_at`, `updated_at` | timestamptz |                                                                                        |

Indexes: `(contract_id)`; unique `(provider, provider_envelope_id)`; **partial unique `(contract_id) WHERE status = 'sent'`** — at most one live envelope per contract (CTR-013), the shape M14 used for the one-pending-ask rule.

`executed_version_id` is **not** the same fact as `documents.executed_version_id`. The pin names the one version the record calls the signed copy and a team moves it by hand; this column says which version _this round_ produced, because a chain can hold two rounds both of kind `executed` and the row has to draw its own (CTR-014).

---

### `contract_envelope_signers`

Source: **CTR-013**

The people one envelope was sent to. Their own table because the record renders them: the envelope row answers "who was asked to sign this". A signer is a name and an email typed into the send dialog, never a user of this install and never a counterparty contact.

| Column          | Type        | Notes                                                                         |
| --------------- | ----------- | ----------------------------------------------------------------------------- |
| `id`            | UUID        | PK                                                                            |
| `envelope_id`   | UUID        | FK → `contract_envelopes.id`, not null, cascade                               |
| `name`          | text        | not null                                                                      |
| `email`         | text        | not null                                                                      |
| `signing_order` | integer     | not null, ≥ 1, unique per envelope — a display order, **not** a routing order |
| `created_at`    | timestamptz |                                                                               |

Every signer is asked in parallel in v1 (CTR-013); `signing_order` records the order they were entered so the row draws them back as they were typed.

Indexes: `(envelope_id)`; unique `(envelope_id, signing_order)` — one row per position; and unique `(envelope_id, lower(email))` — one address, one signer, the database backstop for the rule the send route already refuses on (CTR-013's #391 addendum).

---

### `contract_key_dates`

Source: **CTR-009** (mirrors `matter_key_dates`, MTR-004)

Free-form named dates beyond the typed term machinery (price reviews, milestones, option-exercise windows). Deadline surfaces show the union of these, `expiry_date`, and the derived notice deadline.

Landed in M16/3, migration `0047_contract_key_dates`, with the columns CTR-009 names and nothing else.

| Column                     | Type        | Notes                                                                                            |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `id`                       | UUID        | PK                                                                                               |
| `contract_id`              | UUID        | FK → `contracts.id`, not null, cascade — a key date is part of the contract                      |
| `date`                     | date        | not null; a calendar date, not a timestamp (deadlines are day-granular; display per **DES-014**) |
| `label`                    | text        | not null, 1–200 trimmed characters                                                               |
| `note`                     | text        | nullable, 1–2000 trimmed characters; the write path normalizes a blank string to NULL            |
| `created_at`, `updated_at` | timestamptz |                                                                                                  |

Indexed on (`contract_id`, `date`) — the shape every deadline surface reads. CRUD audit-logged per **DD-017**, one closed-union action per act (`key_date.added`, `key_date.edited`, `key_date.removed`), each at the record tier on the owning contract.

- **Deliberately flat** (CTR-009). No owner column: the matters-side owner question stays a matters question. No per-date reminder schedule: **NOT-004** fixed one global offset list for every tracked date.
- **No audience of its own.** Access is the owning contract's (DD-014, CTR-021), so confidentiality composes without this table holding a flag, a team, or a tier.
- **Derived, never stored.** The notice deadline in the union beside these rows is `expiry_date − notice_period_days`, computed where the answer is assembled (**CTR-006**). Which date is next, and how many days away each is, are answered there too — one place, so a surface cannot disagree with the order it was given.

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
| `search_vector`            | tsvector    | stored generated English FTS: title weight A and description weight B (**DOC-009**, M25/2). Version filenames and owning-record context remain query-time joins                                                                                                                                                                                                                  |

Indexes include one owner-list index per owning record, including `documents_knowledge_item_idx` on `(knowledge_item_id, created_at, id)`, plus `documents_folder_idx` on `(folder_id, created_at, id)` — the record's paper and one folder's paper, newest first, with `id` as the keyset tie-break the listings walk (CTR-024, #391). `documents_executed_version_idx` on `(executed_version_id)` exists for the referencing side of the executed pin rather than for a read: DOC-010's hard delete of a version makes Postgres check every document for one pointing at it.

Exactly-one-owner rule (**DOC-008**): the database CHECK is `num_nonnulls(matter_id, contract_id, entity_id, knowledge_item_id) = 1`. The owner set is complete. Repository destination is Member+; Contributors/Business Users reach documents only through records they're on (portal-readable knowledge items render their docs read-only per KNW-004).

---

### `knowledge_items` / `knowledge_types` / `knowledge_folders`

Source: **KNW-001–004**

The curated know-how home (DOC-002 routing): templates, precedents, playbooks, articles. `knowledge_types` is TECH-023's sixth shared taxonomy mount. Its install-time seeds are `template`, `precedent`, `playbook`, and `article`, each exactly once; no slug is protected. The Settings taxonomy is Administrator-only and its separate live-options read is Member+.

`knowledge_items`: `id`; not-null `title` and `knowledge_type_id`; nullable Markdown `body`; nullable `folder_id`; `state` with CHECK `draft | published` (default `draft`); `audience` with CHECK `legal_only | everyone` (default `legal_only`); nullable `primary_document_id` FK → `documents.id` with `ON DELETE SET NULL`; nullable `replaced_by_id` self-FK with `ON DELETE SET NULL`; nullable `published_at`; not-null `created_by` and `updated_by` FKs → `users.id`; timestamps; and nullable `archived_at`. `search_vector` is a stored generated English tsvector (title weight A, body weight B) with a GIN index. Items are edit-in-place and audit-logged; owned documents carry DOC-001 version chains.

`knowledge_folders`: nested (`parent_id`), blank-start, organizing knowledge _items_: `id`, nullable self-FK `parent_id`, `name`, `display_order`, and timestamps. These are distinct from `document_folders`, which organize documents inside Matter, Contract, or Entity owners.

The full set landed in migration `0083_wide_inhumans`. That migration also adds the fourth Document owner arm, widens the owner CHECK, adds the internal intake-link target and exactly-one-target CHECK, extends the Activity and notification entity vocabularies, and inserts the four Knowledge Type seeds once, with stable ids and slugs; the migration journal, not an `ON CONFLICT` clause, is what keeps the insert single-shot. Populated pre-M28 Documents, Document folders, and external intake links are not rewritten. The migration rehearsal and retained upgrade-fidelity gate read those rows and stored bytes back after upgrade.

CTR-014 contract-side requirements (primary-document designation per contract; ordered version chain; kinds; executed pin; generated-redline provenance) are satisfied by **DOC-001**. Primary-document designation mechanism — **settled with the M11/4 contract-side surface: an FK on `contracts`** (`contracts.primary_document_id`), not a flag here. One column is the exactly-one rule stated as a shape, where a flag would need a partial unique index to say the same thing.

---

### `document_folders`

Source: **DOC-006**, **DOC-011**

Optional lightweight folders scoped within one owning matter, contract, or entity (**ENT-005** adds `entity_id` to the owner set; blank-start, nothing seeded). There is deliberately no Knowledge owner column: Knowledge folders organize items, and each item's documents remain inside that item. **Nested** per DOC-011 (folder-drop imports retain structure). The global repository view stays flat — folder is a filter facet there.

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

Indexes: `document_folders_contract_idx` on `(contract_id)` — the record's folder tree, read whole and ordered in application code, so the index filters rather than orders.

Exactly one owner FK set (same rule shape as `documents`). Invariant: a folder, its parent, and every document filed in it all share the same owning record.

---

### `document_versions`

Source: **DOC-001**

File-immutable snapshots, strictly linear per document (`version_number` 1..n). Never deleted individually. A file correction adds a new version; CTR-014's M21A addendum permits one UPDATE that changes only a hand-set `kind`. Beside the chain columns each row records the **file facts** the stored bytes are described by; they are written once at upload, because the blob behind `file_ref` is immutable and cannot drift from them.

| Column                     | Type        | Notes                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                                                                                                                                                                                                                         |
| `document_id`              | UUID        | FK → `documents.id`, not null                                                                                                                                                                                                                                                                              |
| `version_number`           | integer     | not null; unique per document, 1..n                                                                                                                                                                                                                                                                        |
| `file_ref`                 | text        | not null; storage reference, `<driver>:<key>` per DOC-012 (e.g. `local:…`). A version row with no blob describes no bytes, so the constraint is part of the immutability claim above                                                                                                                       |
| `kind`                     | text (enum) | `draft_ours` \| `draft_theirs` \| `redline_theirs` \| `redline_ours` \| `executed` \| `amendment` \| `generated_redline` (**CTR-014** kinds + generated); the only correctable column, except that `generated_redline` is neither a source nor target                                                      |
| `source`                   | text (enum) | `uploaded` \| `generated`; not null, default `uploaded`. Landed in M32/4, migration `0088_document-version-provenance`, with no backfill. A check pairs all three provenance columns: `generated` with both operands set exactly when the kind is `generated_redline`, `uploaded` with both NULL otherwise |
| `compared_from_version_id` | UUID        | FK → `document_versions.id`, nullable; generated redlines: the older comparison operand                                                                                                                                                                                                                    |
| `compared_to_version_id`   | UUID        | FK → `document_versions.id`, nullable; generated redlines: the newer comparison operand — both operands stored per **DOC-001**/**DOC-003** so the original comparison is reconstructable after the result is appended                                                                                      |
| `note`                     | text        | nullable                                                                                                                                                                                                                                                                                                   |
| `original_filename`        | text        | not null; the name the file arrived under, and the name a download offers back. Never used to build a storage key — keys are minted from ids                                                                                                                                                               |
| `mime_type`                | text        | not null; what the upload declared. Client-supplied, so it is a rendering hint (**DOC-004**) and never a security decision                                                                                                                                                                                 |
| `byte_size`                | bigint      | not null; counted by the server as the bytes streamed past, not taken from a header                                                                                                                                                                                                                        |
| `checksum_sha256`          | text        | not null; lowercase hex, computed over the same pass — written at upload so a later integrity check has something to compare against                                                                                                                                                                       |
| `created_by`               | UUID        | FK → `users.id`, not null                                                                                                                                                                                                                                                                                  |
| `created_at`               | timestamptz | no `updated_at` — the kind correction narrates before and after rather than changing a row timestamp                                                                                                                                                                                                       |

The shared append write now supplies all three provenance columns. Ordinary uploads write `source = uploaded` with both operands NULL. A Comparison export writes `source = generated` and both operand ids in the same insert that appends the Generated redline. The columns are therefore both present in the database and written by their first product path.

---

### `document_version_text`

Source: **DOC-005**

One version's extracted text, landed in M12/3. It sits **beside** the version chain and never in it: a `document_versions` row is immutable (DOC-001), so nothing a background job derives afterwards is written onto it.

The row is the record of work **owed**, not only of work done. It is written `pending` inside the upload's own transaction, so a rolled-back upload leaves nothing and a committed one always says a derivation is due — the queue send that follows only wakes a worker, and a lost send leaves a row for the M12/6 backfill sweep to find.

| Column          | Type        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version_id`    | UUID        | PK and FK → `document_versions.id`, `ON DELETE CASCADE` — one text row per version, and lawful erasure (DOC-010) takes what the machine read along with what the person uploaded                                                                                                                                                                                                                                         |
| `state`         | text (enum) | `pending` \| `ready` \| `failed` — code branches on all three, so the set is fixed                                                                                                                                                                                                                                                                                                                                       |
| `source`        | text (enum) | `native_layer` \| `ocr` \| `rendition` \| `email_body`, nullable — where the text came from. Recorded rather than inferred: OCR text is a machine's reading of a photograph and a rendition's text has been through a converter, and a later feature that weighs a match has to know which it holds. `rendition` landed in M12/4 with the conversion job that writes it; `email_body` (M12/5) joins the set the same way |
| `text`          | text        | nullable; NULL unless `ready`. An empty string is a different and legitimate fact — a blank page read successfully                                                                                                                                                                                                                                                                                                       |
| `created_at`    | timestamptz |                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `updated_at`    | timestamptz | when the state last moved; the panel polls on it                                                                                                                                                                                                                                                                                                                                                                         |
| `email_subject` | text        | nullable; the parsed subject of an `email_body` source, written beside the body by the same extraction (M25/4, **DOC-004**). A Document hit on an email uses it as its title. A check constraint keeps it NULL for every other source                                                                                                                                                                                    |
| `search_vector` | tsvector    | stored generated English FTS over `left(text, 1_000_000)`, weight D when `state = 'ready'`, otherwise empty (**DOC-009**, M25/2)                                                                                                                                                                                                                                                                                         |

A check constraint holds `state = 'ready'` and "has text from a named source" together, so a `ready` row can never answer a reader with silence and a `pending` row can never sit on an answer it already has.

---

### `document_version_rendition`

Source: **DOC-004**

One version's display rendition, landed in M12/4. A Word document and a PowerPoint deck do not draw in a browser, so the pipeline converts each one to a PDF and the doc panel draws that — tracked changes and comments included, because they are in the conversion.

It sits **beside** the version chain and never in it, for `document_version_text`'s reason: a `document_versions` row is immutable (DOC-001), and a PDF a machine made afterwards is not the bytes a person uploaded. The row is the record of work **owed**, written `pending` inside the upload's own transaction.

The rendition is for display; the original is the record. The download always answers the uploaded bytes, and a rendition can be thrown away and made again from its source.

| Column       | Type        | Notes                                                                                                                                                                                                                            |
| ------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version_id` | UUID        | PK and FK → `document_versions.id`, `ON DELETE CASCADE` — one rendition per version, and lawful erasure (DOC-010) takes what the machine made along with what the person uploaded                                                |
| `state`      | text (enum) | `pending` \| `ready` \| `failed` — the same three the extracted text carries, and code branches on all three                                                                                                                     |
| `file_ref`   | text        | nullable; NULL unless `ready`. Storage reference, `<driver>:<key>` per DOC-012. The key is `renditions/<version id>/<fresh id>` — minted from the version, and given a fresh tail on every attempt because a key is never reused |
| `byte_size`  | bigint      | nullable; NULL unless `ready`. Counted as the conversion streamed to the driver, and what the preview's `content-length` is set from                                                                                             |
| `created_at` | timestamptz |                                                                                                                                                                                                                                  |
| `updated_at` | timestamptz | when the state last moved; the panel polls on it                                                                                                                                                                                 |

A check constraint holds `state = 'ready'` and "has a stored blob of a known size" together, so a `ready` row can never send the panel at a preview that streams nothing.

The blob behind `file_ref` is **not** cascaded — no database reaches a storage driver — so the hard-delete route destroys it explicitly, before its commit and ahead of the source blobs.

---

### `document_comparisons`

Source: **DOC-003**

One durable comparison between two rounds of one Document, landed in M32/2. A reader asks for a pair over HTTP and polls the row; the worker computes it once against the engine and keeps it, so every later reader reuses the same answer.

It sits **beside** the version chain and never in it, for the same reason as the two tables above: a comparison is a derivation, not a round. That is also why a request on an archived Document is accepted (DOC-010). The row is the record of work **owed**, written `pending` inside the request's transaction; the queue send after the commit only wakes a worker, and a lost send leaves a `pending` row for the backfill sweep to find. A second request for the same pair answers the existing row and does not ask again.

| Column             | Type        | Notes                                                                                                                                                                                                                               |
| ------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`               | UUID        | PK                                                                                                                                                                                                                                  |
| `document_id`      | UUID        | FK → `documents.id`, `ON DELETE CASCADE` — lawful erasure (DOC-010) takes the comparison with the Document                                                                                                                          |
| `from_version_id`  | UUID        | FK → `document_versions.id` — the older operand. Unique with `document_id` and `to_version_id`: one row per pair                                                                                                                    |
| `to_version_id`    | UUID        | FK → `document_versions.id` — the newer operand. A check keeps the two distinct; the route holds the rest of the pair rules (same Document, older before newer by version number, neither a generated redline)                      |
| `mode`             | text (enum) | `word` \| `text` — decided at request time off the DOC-004 routing table: `word` when both operands convert from a Word format (`doc`, `docx`, `odt`, `rtf`), `text` otherwise. Stored so the screen never guesses what it will get |
| `state`            | text (enum) | `pending` \| `ready` \| `failed` — code branches on all three                                                                                                                                                                       |
| `change_model`     | jsonb       | nullable; NULL unless `ready`. The parsed change model the compare screen draws. Typed at the API boundary, where its schema is owned                                                                                               |
| `change_count`     | integer     | nullable; NULL unless `ready`. The number of changes in the model, kept beside it so a list can show the count without reading the model                                                                                            |
| `redline_file_ref` | text        | nullable; set exactly when `ready` and `mode = 'word'`. Storage reference per DOC-012 to the tracked-changes Word file, keyed `comparisons/<comparison id>/<fresh id>`. Text mode has no derived file                               |
| `failure`          | text        | nullable; NULL unless `failed`. The reason, in one line                                                                                                                                                                             |
| `requested_by`     | UUID        | FK → `users.id`                                                                                                                                                                                                                     |
| `created_at`       | timestamptz |                                                                                                                                                                                                                                     |
| `finished_at`      | timestamptz | nullable; set when the state leaves `pending`                                                                                                                                                                                       |

A check constraint holds each state to its columns: `pending` carries no outcome, `ready` carries a model and a count (and a file in word mode, none in text mode), and `failed` carries a reason and nothing else.

The blob behind `redline_file_ref` is **not** cascaded, for the rendition's reason, so the hard-delete route destroys it explicitly, before its commit and ahead of the source blobs.

---

### `notifications` / `notification_preferences`

Source: **NOT-001**

One notification system rendered on two surfaces: staff bell (full platform) and business-user bell (portal), plus email for both.

_Landed in M18/1 (#316). The columns below are what the migration holds; the two refinements beyond the original sketch are marked._

`notifications`

| Column                 | Type        | Notes                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | text        | uuidv7                                                                                                                                                                                                                                                                                                                                                                          |
| `user_id`              | text        | FK → `users.id`, not null. No cascade: a person is archived, never deleted (SET-005)                                                                                                                                                                                                                                                                                            |
| `event_type`           | text        | The NOT-002 catalog slug. **No CHECK**, for `activity_log.action`'s reason: a row outlives the build that wrote it, and the closed union lives in TypeScript                                                                                                                                                                                                                    |
| `entity_type`          | text (enum) | `matter` \| `contract` \| `document` \| `request` \| `entity` \| `knowledge_item`. Polymorphic with `entity_id`, so no FK — the documented exception, as `comments` has it.                                                                                                                                                                                                     |
| `entity_id`            | text        | not null                                                                                                                                                                                                                                                                                                                                                                        |
| `payload`              | jsonb       | Rendering data, snapshotted at write time (the record's title is what the item says; the deep link shows current truth)                                                                                                                                                                                                                                                         |
| `read_at`              | timestamptz | nullable. NOT-005: opening the center marks the visible items read                                                                                                                                                                                                                                                                                                              |
| `email_owed`           | boolean     | **Refinement 1.** Whether email was owed at write time, decided from the group default and the person's preference. Without it, "owed and never sent" and "never owed" are the same NULL and no round can re-ask. It records the **debt, not the route**: a group-3 row owes a digest email and is `true` here too, and the event's group decides which of them the queue wakes |
| `emailed_at`           | timestamptz | nullable; when the email went                                                                                                                                                                                                                                                                                                                                                   |
| `email_skipped_at`     | timestamptz | nullable; when it was given up on — no relay configured, or the record walled off since. The M12 `failed` state said for mail. Why is in the log, not in a column                                                                                                                                                                                                               |
| `reminder_date`        | date        | **Refinement 2**, half one. The date a group-3 reminder is about; NULL on every other event                                                                                                                                                                                                                                                                                     |
| `reminder_offset_days` | integer     | **Refinement 2**, half two. Which NOT-004 offset fired it                                                                                                                                                                                                                                                                                                                       |
| `created_at`           | timestamptz |                                                                                                                                                                                                                                                                                                                                                                                 |

Indexes: `notifications_user_idx` on `(user_id, created_at, id)` — the list's keyset order; `notifications_unread_idx` on `(user_id) where read_at is null` — the NOT-005 badge; and `notifications_reminder_idx`, a **partial unique** index on `(user_id, event_type, entity_id, reminder_date, reminder_offset_days) where reminder_date is not null`. That last one is the date reminder's **dedup identity**: it makes a re-ask a no-op and makes a date that _moves_ correctly fire again for its new value. It is defined in M18/1 and first written by the dates slice — the identity has to be in the schema before the first round runs rather than retrofitted around rows with no key.

Checks: `entity_type` in the vocabulary; a reminder carries both halves of its identity or neither; an email is sent or skipped, never both; and neither outcome is reachable on a row that never owed one.

`notification_preferences`: (`user_id` FK, `event_group`, `channel` `in_app|email`, `enabled` boolean, timestamps), compound PK on the first three, CHECKs on the two closed unions. M28 adds the `knowledge` briefing-section value to `event_group`. M29 adds the email-only `briefing.approvals`, `briefing.tasks`, `briefing.dates`, `briefing.obligations`, and `briefing.intake` section switches. The first four default on; Intake defaults off. A check rejects an `in_app` row for any `briefing.*` key. **It is a set of overrides, not a full grid**: a person with no row for a pair takes the group's default, and the defaults live in application code (NOT-002) rather than being seeded — so a default that changes reaches everybody who never expressed an opinion, and nobody who did. That is why `enabled` has no column default: a row exists precisely because somebody said something.

M29 also widens the TypeScript event catalog with `briefing.ready`. Notification rows deliberately retain no event-type CHECK; the event is bell-only and never incurs another email debt.

---

### `requests`

Source: **DD-010** (as revised by **INT-001**), **INT-002**

Structured request envelope, created only via portal forms. Not a work container — converts to a Matter or Contract, or resolves in-thread. Portal conversation uses the `comments` machinery (DD-016).

| Column                     | Type        | Notes                                                                                                                                                                                                             |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | UUID        | PK                                                                                                                                                                                                                |
| `number`                   | integer     | `GENERATED ALWAYS AS IDENTITY` (`requests_number_seq`), displayed **R-42** per **INT-002**                                                                                                                        |
| `request_type_id`          | UUID        | FK → `request_types.id`, not null                                                                                                                                                                                 |
| `requester_id`             | UUID        | FK → `users.id`, not null (magic-link identity)                                                                                                                                                                   |
| `status`                   | text (enum) | `new` \| `converted` \| `resolved` \| `declined` per **INT-001** as revised by **INT-007** — fixed, code branches; not null, default `new` (every Request is born open; M21's disposition writes the other three) |
| `summary`                  | text        | not null                                                                                                                                                                                                          |
| `description`              | text        | nullable                                                                                                                                                                                                          |
| `urgency`                  | text (enum) | `low` \| `medium` \| `high` \| `critical` (levels per **DES-018**), requester-supplied, not null; maps 1:1 to `priority` at conversion (MTR-012 — `risk` is never requester-set)                                  |
| `custom_fields`            | jsonb       | collected form values keyed by field slug per **INT-002**; not null, default `{}`; carried into the converted record                                                                                              |
| `converted_matter_id`      | UUID        | → `matters.id`, nullable; FK added with the M22 matter table                                                                                                                                                      |
| `converted_contract_id`    | UUID        | FK → `contracts.id`, nullable                                                                                                                                                                                     |
| `declined_reason`          | text        | nullable                                                                                                                                                                                                          |
| `created_at`, `updated_at` | timestamptz |                                                                                                                                                                                                                   |
| `archived_at`              | timestamptz | soft delete                                                                                                                                                                                                       |
| `search_vector`            | tsvector    | stored generated English FTS: summary and R-number weight A, description weight B, fixed status weight C; Type and Requester names remain query-time joins (**DOC-009**, M25/2)                                   |

Indexes: `requests_number_unique`, a **unique** index on `(number)` — the identity sequence already hands out distinct numbers, and the index is both what the number-keyed portal read (`/portal/requests/42`) uses and the table's own statement that R-42 names exactly one Request; `requests_requester_idx` on `(requester_id, created_at)`, which is my-requests, the only list a Business User ever sees (DD-013); and `requests_converted_contract_idx` on `(converted_contract_id)`, added by M21/11 (#422, migration 0067) because the CMT-001 re-parent makes every Full Thread comment on a contract ask whether a Request converted into it, and that lookup would otherwise scan a table that only grows.

Checks: `requests_converted_target_check` — `num_nonnulls(converted_matter_id, converted_contract_id) <= 1`, so "a Request becomes one record, not two" is the table's rule rather than the conversion route's; `requests_status_check` and `requests_urgency_check`, closing the two unions to their listed values, the house rule for every closed union in this schema.

The table landed with M20/4 (#378), migration 0061, and was reconciled against the schema file at the M21 close (#423, through migration 0067). Two notes on what it holds today. `number` is a Postgres identity column, `GENERATED ALWAYS`, so no write path can set or correct it — the immutability INT-002 asks for is a database rule rather than an application convention, and it is the CTR-003 contract sequence's sibling. M22 added the `converted_matter_id` foreign key and index with the `matters` table; both converted-record references now carry no-cascade foreign keys because their records are soft-deleted, never dropped. The check constraint keeps at most one non-null. `request_type_id` carries no cascade either — a request type in use refuses hard delete, and an archived one keeps naming the Requests it took.

---

### `request_types` / `request_type_fields` / `request_attachments`

Source: **INT-002**

`request_types`: MTR-001 machinery (`slug`, `display_name`, `description`, `display_order`, `is_system_default`, `archived_at`, timestamps) + the **three-state target** (INT-002's M19/4 addendum): `target_module` (nullable — `matter` or `contract`), `target_matter_type_id` and `target_contract_type_id` (both nullable FKs, `on delete set null`). One check constraint holds all three together — with no module both type ids are NULL; under `matter`, `target_contract_type_id` is NULL and `target_matter_type_id` may be set or NULL; under `contract`, the mirror — so "no target", "the Contract module", and "the NDA contract type" are the only shapes the table accepts. `on delete set null` demotes rather than strands: deleting the targeted type leaves the module standing. No row is system-protected; there is no fallback request type, because no record needs a non-null request type once conversion is done. Admin-managed via Intake Settings → Request types.

`request_type_fields`: (`request_type_id`, `field_id`, `display_order`, `is_required`, `created_at`), compound PK on the first two. Attachable fields: scope matching the target module, or `global`. One invariant here has no constraint behind it: a `user`- or `entity`-typed field may sit on a request form and may never be `is_required` on one, because the portal draws those pickers empty and a required one would refuse every submission of the type forever (the INT-002 M20/11 addendum, #400). Both write doors refuse the flag by name and migration 0063 cleared the rows an install could already hold; nothing in the table stops a hand-written `UPDATE`.

`request_attachments`: (`id`, `request_id`, `file_ref`, `filename`, `uploaded_by`, `created_at`) — lightweight; promoted into `documents` on conversion (requests are not document owners per DOC-008). Every column is not null. `request_id` is `on delete cascade`: an attachment is part of its Request and has no meaning without one. The cascade takes the row and **not the blob** — no database cascade reaches a storage driver — so whichever milestone builds a Request hard delete owes the same read-then-delete pass `documents` makes (DOC-010, DOC-012). `uploaded_by` is an FK to `users.id` with no cascade, and it is a column of its own because the Request's `requester_id` answers a different question: who asked, not who put this file here. `file_ref` is the storage seam's `<driver>:<key>` reference (DOC-012), whose key is minted from the attachment id and never from the filename. One index, `request_attachments_request_idx` on `(request_id, created_at)` — the one read there is, every attachment on one Request in the order they were attached. No declared media type and no byte count are stored, so the download answers `application/octet-stream` (the INT-002 M20/6 addendum). A row may be added only while its Request is `new`; after a disposition, paper arrives on `comment_attachments` and a Member+ files it onto the record (CMT-011, INT-002's #438 addendum). The table landed with M20/6 (#380), migration 0062, and was reconciled against the schema file again at the M21A close (#448).

---

### `intake_links`

Source: **INT-004** (delete behavior and URL rule per its M19/6 addendum)

The "Before you submit…" deflection panel, Admin-managed via Intake Settings → Deflection links: (`id`, `label`, nullable `url`, nullable `knowledge_item_id`, nullable `request_type_id`, `display_order`, timestamps). A CHECK requires exactly one target: `num_nonnulls(url, knowledge_item_id) = 1`. A URL is an external answer; `knowledge_item_id` is an internal answer. Its FK is declared `ON DELETE SET NULL`, and on a Knowledge-targeted row the target CHECK turns that into a refusal in practice: `url` is already NULL, so clearing the column would leave the row targetless and the delete fails the CHECK instead. No route performs such a delete — KNW-002 supersedes by archive, and a target that loses portal reach keeps its link rows intact for repair (the KNW-002 #603 addendum). A NULL `request_type_id` is the **portal home** panel — everybody sees the link whatever they came to ask; a request type names the form the link shows on instead.

`request_type_id` is `on delete cascade`, not `set null`. A link's placement is its **audience**, so setting it NULL would publish a link scoped to one form to every requester on the portal home, which is the opposite of the demotion `request_types`' own target FKs perform. Cascade matches `request_type_fields`, the other child of `request_types`, and a request type is only hard-deletable when nothing has used it.

When present, `url` is validated as an absolute `http`/`https` address and stored **exactly as entered** — nothing normalizes it. The settings row renders it without its scheme; that is presentation. There is no `slug` and no `archived_at`: nothing points at a link and there is no history to keep, so a link is removed outright (the DES-052 value-list pane).

---

### `comments`

Source: **DD-016**, **CMT-001–011**

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

Prior versions (CMT-006, amending CMT-005): `comment_revisions` (`id`, `comment_id` FK → `comments.id` ON DELETE CASCADE, `body` not null, `replaced_at`), indexed on (`comment_id`, `replaced_at`). One row per body an edit or a soft delete replaced. The prior text cannot live in the audit log: DD-017 forbids `UPDATE` and `DELETE` on `activity_log` (the one named exception is the signer erasure below, which reaches nothing a comment ever wrote), so text that enters a payload can never leave, and a hard redact would remove the comment while leaving what it said in the log. This table is ordinary application data, so a redact purges it along with `comments.body` and `comment_mentions` (CMT-008) — the text and who it named are both gone rather than only hidden. Every `comment.*` activity payload carries ids and metadata only.

Unread tracking (CMT-004, confirmed by CMT-009): `comment_last_read` (`user_id` FK → `users.id` with no delete action, `entity_type`, `entity_id`, `read_at`, compound PK on the first three). One watermark per reader per record — where that person had read to, not a receipt per comment. The badge counts comments on the record that pass the viewer's tier predicate, are not the viewer's own, are neither soft-deleted nor redacted, and were created after `read_at`. Hidden-tier counts never leak, because the count is taken over the same filtered set the thread is read at. **No row means everything visible is unread**, not zero: a reader who has never opened the panel has read none of it. Opening the panel writes the row, and only when the thread was actually delivered.

The polymorphic `entity_type / entity_id` pair is unavoidable here unless we shard comments per host table. Reconsider in the tech-stack grill if the chosen ORM has a strong opinion. Indexed on (`entity_type`, `entity_id`, `created_at`, `id`) — the thread's keyset walks `(created_at, id)`, so the tie-break sits in the index that answers the order (CTR-024's #391 addendum).

#### `comment_attachments`

Source: **CMT-011**, **DOC-008**, **DOC-012**

The lightweight paper carried by a comment. It is not a Document and has no version chain, folder, confidentiality flag, media type, or byte count. Its comment supplies the visibility tier; a soft-deleted comment suppresses its paper from reads, while an Administrator's redact deletes the stored blobs and these rows with the text.

| Column              | Type        | Notes                                                                                                                                                                                                         |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | UUID        | PK, uuidv7                                                                                                                                                                                                    |
| `comment_id`        | UUID        | FK → `comments.id`, not null, `ON DELETE CASCADE`                                                                                                                                                             |
| `file_ref`          | text        | not null; storage seam `<driver>:<key>` reference; key minted from the comment id and attachment id, never the filename                                                                                       |
| `filename`          | text        | not null; the name the file arrived under and the name its download offers back                                                                                                                               |
| `uploaded_by`       | UUID        | FK → `users.id`, not null, no cascade                                                                                                                                                                         |
| `filed_document_id` | UUID        | nullable; paired with `filed_version_id` in composite FK `comment_attachments_filed_version_fk` → `document_versions(document_id, id)`, `ON DELETE SET NULL`; names the Document this attachment was filed as |
| `filed_version_id`  | UUID        | nullable; paired with `filed_document_id` in the same composite FK; names the exact Document Version the filing produced                                                                                      |
| `created_at`        | timestamptz | not null                                                                                                                                                                                                      |

Indexed on (`comment_id`, `created_at`, `id`) for the one read: a comment's attachments in arrival order. The table landed in M21A/2, migration 0068.

---

### `activity_log`

Source: **DD-017**

Source-of-truth for both the per-entity activity feed and the system-wide audit log.

| Column        | Type        | Notes                                                                                                                   |
| ------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`          | UUID        | PK                                                                                                                      |
| `entity_type` | text (enum) | `matter` \| `contract` \| `document` \| `request` \| `entity` \| `knowledge_item` \| `user` \| `system`                 |
| `entity_id`   | UUID        | nullable — `system`-typed entries (login, role change, intake-config change) have no entity                             |
| `actor_id`    | UUID        | nullable — system-emitted events (cron jobs, external webhooks) have no human actor                                     |
| `action`      | text        | slug, e.g., `matter.created`, `confidentiality.set`, `user.role_changed`, `document.downloaded`, `matter_type.archived` |
| `visibility`  | text (enum) | `legal_only` \| `working_team` \| `full_thread` \| `admin_only` per **DD-017**                                          |
| `payload`     | jsonb       | action-specific data (old/new values for edits, etc.)                                                                   |
| `created_at`  | timestamptz |                                                                                                                         |

Append-only at the application layer. **Corrections are appended as new entries, never written over** — that is DD-017's rule and it has no exception.

**One application-code path issues an `UPDATE`, and it is a named exception rather than a crack in the rule.** `apps/api/src/lib/signer-erasure.ts` rewrites the name and the address of one external signer to `[erased]` inside `envelope.sent` payloads, for CTR-013's 2026-08-16 addendum ([#280](https://github.com/juggernog20/OpenLaw/issues/280)). It is a lawful-erasure route, not a correction: no fact recorded there was wrong, and there is no way to honour an erasure request by appending. The exception is confined to that one module, one action slug, and two keys inside the payload; the signer array keeps its length and its order, so the entry still says how many people were asked and in what position. The erasure is itself appended like anything else. Every other row and every other key stays untouchable, and **no application-code path issues a `DELETE`** on this table at all.

An earlier version of this section said no path issues either statement. It was true when written and the erasure route falsified it; the rule it was protecting is the sentence above.

Indexed on (`entity_type`, `entity_id`, `created_at`, `id`) for the per-entity feed — that feed is paged and its keyset walks `(created_at, id)` (CTR-024's #391 addendum); on (`actor_id`, `created_at`) for actor-based audit queries; on (`action`, `created_at`) for security-event filtering. The two filter indexes need no tie-break, because neither answers a cursor.

---

### `list_views`

Source: **DD-019**

One person's saved way of reading one list. **Private to that person** — there is no `is_shared`, no `organization_id`, and no author-versus-owner split, because DD-019 clause 1 declined shared views: every clause they add is a permission question, and a 2–10 person team (DD-002) answers "send me your columns" with a sentence.

| Column                     | Type        | Notes                                                                                                                                                                                                                   |
| -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | text        | PK, uuidv7                                                                                                                                                                                                              |
| `user_id`                  | text        | FK → `users.id` **ON DELETE CASCADE**. A view is a preference, not a record: a deleted user's saved columns are nobody's                                                                                                |
| `surface`                  | text        | Which list this view is for — `contracts`, `matters`, `documents`, or `entities` today. **No CHECK against an enum**: a new destination adopting DES-046's table must not need a migration to be allowed to save a view |
| `name`                     | text        | What the reader called it; shown in the views menu. CHECK: non-empty, trimmed, at most 60 characters                                                                                                                    |
| `config`                   | jsonb       | The whole list state — columns shown, their order, their widths, the filters in force, the sort (DD-019 clause 2). Read and written whole; **no query reaches into it**. The API's schema is the authority on the shape |
| `is_default`               | boolean     | not null, default false. The one view this person's list opens on. All-false means the list opens on the built-in layout, which is code rather than a seeded row (DD-019 clause 7)                                      |
| `created_at`, `updated_at` | timestamptz |                                                                                                                                                                                                                         |

**The surface is a string, so one table serves every destination.** Matters added `matters` in M22; documents (M26) and entities (M27) add theirs by rendering the same managed table (DES-046), not by adding a table here. Nothing joins to a view, which is what makes this the cheap kind of polymorphism rather than the kind DD-008 avoids. A `surface` value is a slug the build writes, never user text — CHECK: `^[a-z][a-z0-9_]*$`.

**A config may name a column the build no longer has.** DD-019 clause 7 makes that a read-past rather than an error: the surface resolves the config against the column catalogue it actually ships, drops what it cannot draw, and renders the rest. So nothing here constrains the config's contents, and no migration ever has to rewrite one.

Unique on (`user_id`, `surface`, `lower(name)`) — two views of one list may not share a name for one person, compared without case, the same reading the menu's sort takes and the same rule folder siblings follow (DES-033). Names are per person, so two people may both have a "My contracts". Unique on (`user_id`, `surface`) **partial where `is_default`** — at most one default per person per surface, as a database rule rather than a thing the writer is trusted to remember; partial because the non-default rows are the many.

How many views one person may hold on one surface is bounded in the API (`MAX_LIST_VIEWS_PER_SURFACE`), not here — which is why the list route answers whole rather than paging (CTR-024's 2026-08-21 addendum).

---

## Outstanding schema questions

Tracked here so they're not forgotten when the relevant grill begins.

- **Database engine** — Postgres assumed; formalized in the tech-stack grill.
- ~~**ID type** — UUID v7 vs ULID vs sortable BIGINT; formalized in the tech-stack grill.~~ Resolved per **TECH-004**: UUID v7, held in a `text` column (see Conventions).
- **ORM and migration framework** — formalized in the tech-stack grill (will affect comment polymorphism strategy and FK naming).
- **Comments table polymorphism strategy** — single table with `entity_type / entity_id` pair (current proposal), per-host-type sharded tables, or polymorphic via association — depends on ORM ergonomics.
- ~~**Full-text search column placement** — per-table generated `tsvector` columns vs separate index store.~~ Resolved by **DOC-009** M25/2 and **TECH-014**: stored generated columns on each searchable table, with GIN indexes; no separate store or indexing queue.
- **Authentication-related columns on `users`** — resolved per **TECH-008**: credential material lives in `accounts`/`verifications`, not on `users`; see the `users`, `sessions`, `accounts`, and `verifications` sections.
- **Tags table(s)** — resolved: deferred out of v1 per **MTR-010**; see `FUTURE-FEATURES.md`.
