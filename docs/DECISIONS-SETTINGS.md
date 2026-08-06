# OpenLaw — Settings Module Decision Record

Decisions specific to the cross-cutting **Settings** surface — IA placement, permission model, audit-log treatment, preview/rollback semantics, install-time vs runtime seeding, and per-module settings UX patterns. Platform-level decisions that apply across all modules (data model, role model, intake, activity tracking, etc.) live in `DECISIONS.md` and are referenced by ID where relevant.

## Why this is a separate decision class

Per `DECISIONS.md` **DD-005**, "Search / Comments / Activity feed / Dashboards / Notifications" are cross-cutting capabilities — designed *into* every module rather than living as separate destinations. **Settings is the same kind of capability**: every module accumulates configurable surfaces (matter types, contract templates, intake routing rules, retention policies, theme preference, etc.) and they need a consistent IA, permission model, and audit treatment.

Treating Settings as cross-cutting (rather than per-module) keeps:

- **One IA pattern** for where settings live in the nav.
- **One permission model** for who can change what (mostly Admin per **DD-013**, but with documented carve-outs).
- **One component substrate** so every settings page looks and behaves the same.
- **One persistence + audit pattern** so settings changes write to the same `activity_log` per **DD-017**.

## Sequencing

This decision class is queued **after the per-module grills wrap** — Matters → Contracts → Intake → Documents → Entities → Knowledge — so that we know the full configurability shopping list before designing the surface. Each module decision that introduces a configurable item flags it in its **Settings touchpoints** subsection; this document collates them when grilling begins.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `SET-###`.

## Open questions queued for the next grill-me session

_None — queue cleared 2026-08-05 (SET-001 through SET-004). Audit treatment needed no grill: DD-017 already mandates every settings mutation to the activity log, applied immediately (SET-003). Entities/Knowledge settings sections queue here when those module grills run._

## Configurability surface inventory (live, populated as module grills land)

| Source | Surface | Permission | Notes |
|---|---|---|---|
| **MTR-001** | Matters Settings → Types | Admin | List view; add / rename / reorder / archive; system-default + `other` row protected |
| **MTR-002** | Matters Settings → Statuses | Admin | List view; add / rename / reorder / archive; category (open/closed) picked at creation, immutable after; seed `open` + `closed` rows protected |
| **MTR-011** | Matters Settings → Fields | Admin | Custom-field catalog view scoped to `matter` + `global` fields per **CTR-016**: add / rename / describe / archive; field type immutable (9 types incl. `entity`); DD-015 business\|legal tag; options editor for selects |
| **TECH-008** | Settings → Organization → Authentication | Admin | Auth mode (built-in basic vs OIDC IdP config); magic-link portal toggle |
| **NOT-004** | Settings → Notifications | Admin | Global reminder-offset list (seeded 7/1/0 days) for all tracked dates |
| **NOT-001** | Account Settings → Notifications (staff) / Portal Settings (business users) | Per-user | Channel toggles per event group (bell always on; email defaults per NOT-002) |
| **INT-004** | Intake Settings → Deflection Links | Admin | "Before you submit…" links panel: label + URL, global or per request type, ordered |
| **INT-002** | Intake Settings → Request Types | Admin | List + per-type form editor: target matter/contract type; attach catalog fields (target-module or global scope); required flags; display order |
| **CTR-016** | Contracts Settings → Fields | Admin | Catalog view scoped to `contract` + `global` fields; per-field `ai_prompt` editor (CTR-008); same machinery as the matters view |
| **CTR-016** | Contracts Settings → Types → [type] | Admin | Attach / detach `contract`/`global` fields; per-type display order; `is_required` toggle (hard-enforced per MTR-014 rule) |
| **MTR-011** | Matters Settings → Types → [type] | Admin | Attach / detach `matter`/`global`-scoped fields to the type; per-type display order |
| **MTR-013** | Matters Settings → Templates | Admin | Named templates per type: pre-fill values (priority, risk, custom fields, title prefix) + task rows (relative due dates, role targeting) |
| **CTR-002** | Contracts Settings → Types | Admin | List view; add / rename / reorder / archive; `other` row protected; attachment point for per-type fields / templates / approval scoping |
| **CTR-013** | Contracts Settings → E-signature | Admin | Provider connector credentials (DocuSign v1); adapter-keyed for future providers |
| **CTR-012** | Contracts Settings → Approver Groups | Admin | Named groups (name + member list); applying a group snapshots members into approval requests |
| **CTR-008** | Contracts Settings → AI Analysis | Admin | BYO API key; per-field default prompts (editable); custom fields carry their own prompts |
| **KNW-001** | Knowledge Settings → Types | Admin | List view; seeds: template, precedent, playbook, article; MTR-001 machinery |
| **ENT-001** | Entities Settings → Types | Admin | List view; add / rename / reorder / archive; `other` row protected |
| **ENT-001** | Entities Settings → Officer Roles | Admin | List view; seeds: director, ceo, cfo, secretary, other |
| **CTR-001** | Contracts Settings → Statuses | Admin | List view; add / rename / reorder / archive; stage (draft/review/approval/signature/active/ended) picked at creation, immutable after; seed `draft`, `active`, `expired` rows protected |

---

## SET-001 — IA: one /settings destination with Personal + Organization rails

- **Status** — Accepted
- **Date** — 2026-08-05
- **Context** — Where the 17-surface inventory lives. (Grilled after five of seven module grills; Entities/Knowledge sections slot in when theirs land.)
- **Decision** — A single `/settings` destination, reached via the avatar menu and gear affordances. Left rail in two groups: **Personal** (Profile, Appearance per DES-001/002, Notification preferences per NOT-001) and **Organization** (General, Users, Matters, Contracts, Intake, Notifications, Integrations) — Organization sections hidden from non-Admins. **Contextual deep-links** from module UIs jump to the relevant section (Admin-only affordances, e.g. "Manage types…" under a type picker). Grill-plan J.9 becomes a deep-link, not a separate surface.
- **Rationale** — Cross-cutting surfaces (the shared fields catalog, notifications, users) have no module home; a single destination with module sections keeps one IA pattern and one component substrate.
- **Alternatives considered** — Per-module gear pages: orphans/duplicates cross-cutting surfaces.
- **Consequences** — Two net-new Organization sections implied beyond the module inventory: **General** (org identity: name, logo, locale/timezone defaults) and **Users** (invite, role assignment per DD-013, archive). Integrations hosts E-signature (CTR-013) + AI (CTR-008) credentials. Settings screens become one design family (list-editor pattern per DES).

## SET-002 — Permissions: Admin-only Organization settings; no delegation in v1

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — Every Organization section is Administrator-only per DD-013. Members see Personal only (module UIs may render read-only labels of org config where contextual). No per-surface delegation grants in v1 — parked in FUTURE-FEATURES.
- **Rationale** — At 2–10 people the Admin is a message away; a grants model is a fifth permission concept bolted onto DD-013's clean scheme.
- **Consequences** — FUTURE-FEATURES entry (settings delegation). Permission check is a single role gate, not per-surface.

## SET-003 — Apply semantics: immediate on save; guarded archive with reassignment

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — Settings changes apply immediately on save, activity-logged per DD-017 (the audit log + unarchive are the recovery story; no draft/publish/rollback engine). One cross-module guard: **archiving a value in use** (matter/contract type, request type, template, field option) shows the live-usage count and requires a reassignment target before archiving; surfaces with structural minimums (statuses: ≥1 per category/stage per MTR-002/CTR-001) block instead. Field archival keeps stored values per MTR-011 — no reassignment needed.
- **Rationale** — Publish ceremony on every rename is big-org machinery; the guard pattern addresses the only genuinely dangerous operation.
- **Consequences** — Bulk-reassign flow is a shared component across all list-editor surfaces. Archive guards need usage-count queries per surface.

## SET-004 — First-run onboarding wizard + seeded defaults

- **Status** — Accepted
- **Date** — 2026-08-05
- **Context** — Installer seeding vs post-install setup. Recommended seeds + a passive checklist; Blair chose the **first-run onboarding wizard**.
- **Decision** — *(Addendum 2026-08-06 per **TECH-008**: the wizard gains an **Authentication step** — built-in basic auth vs bring-your-own IdP via OIDC.)* Install-time migrations still seed every system default already specified per-table (9 matter types, matter/contract statuses, 8 contract types, notification offsets, starter request types: NDA request → contract, Contract review → contract, Legal question → no target). On first Admin login, a **guided onboarding wizard** runs: org identity (name, logo) → allowed email domains (DD-010 allowlist) → email/SMTP → invite users + roles → optional integrations (DocuSign, AI key) → review seeded types. Steps are skippable and everything remains editable in Settings afterward; the wizard is first-run only, not a recurring surface.
- **Rationale** — (User preference for a guided first-run.) The wizard makes the under-an-hour install goal *feel* finished — a fresh system that asks for exactly the config seeds can't know.
- **Alternatives considered** — Seeds + passive "Finish setup" checklist card (recommended, declined).
- **Consequences** — The wizard is a real v1 build surface (one flow, ~6 steps). Wizard completion state stored per-org; skipped steps resurface as a Settings checklist card until done.

## Index of decisions

| # | Decision | Status |
|---|---|---|
| SET-001 | IA: one /settings destination with Personal + Organization rails | Accepted |
| SET-002 | Permissions: Admin-only Organization settings; no delegation in v1 | Accepted |
| SET-003 | Apply semantics: immediate on save; guarded archive with reassignment | Accepted |
| SET-004 | First-run onboarding wizard + seeded defaults | Accepted |
