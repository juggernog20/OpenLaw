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

- **IA placement** — top-level "Settings" destination, per-module gear icon, or both?
- **Permission model** — Admin-only across the board (default per **DD-013**), or delegated for specific surfaces (e.g., a Member can manage contract templates without Admin escalation)?
- **Audit-log treatment** — every settings change written to `activity_log` per **DD-017**, or only Admin-classified ones? Read-after-write display semantics (the change shows in the system audit log immediately).
- **Preview / draft / rollback semantics** — does a settings change apply immediately on save, or after explicit "Publish"? Soft-rollback affordance for high-blast-radius changes (e.g., archiving a matter type that has live matters)?
- **Install-time vs runtime seeding** — what's seeded by the installer (the 9 matter types per **MTR-001**, the role enum per **DD-013**), and what's pulled in via post-install onboarding?
- **Per-user vs per-org settings** — theme preference (per **DES-001**) is per-user; matter types are per-org. Does the IA expose them on the same surface ("Settings" with personal / org tabs) or separate destinations?
- **Bulk reassign / migration UX** — when archiving a configurable value that's in use (matter type, lifecycle state, tag), how does the bulk-reassign step look across modules?
- **Configurability surface inventory** — pulled from each module's "Settings touchpoints" subsection as those modules get grilled.

## Configurability surface inventory (live, populated as module grills land)

| Source | Surface | Permission | Notes |
|---|---|---|---|
| **MTR-001** | Matters Settings → Types | Admin | List view; add / rename / reorder / archive; system-default + `other` row protected |
| **MTR-002** | Matters Settings → Statuses | Admin | List view; add / rename / reorder / archive; category (open/closed) picked at creation, immutable after; seed `open` + `closed` rows protected |
| **MTR-011** | Matters Settings → Fields | Admin | Custom-field catalog view scoped to `matter` + `global` fields per **CTR-016**: add / rename / describe / archive; field type immutable (9 types incl. `entity`); DD-015 business\|legal tag; options editor for selects |
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
| **CTR-001** | Contracts Settings → Statuses | Admin | List view; add / rename / reorder / archive; stage (draft/review/approval/signature/active/ended) picked at creation, immutable after; seed `draft`, `active`, `expired` rows protected |
| **CTR-002** | Contracts Settings → Types | Admin | List view; add / rename / reorder / archive; `other` row protected; type is the policy carrier (fields / templates / approval targeting) |

---

_No decisions recorded yet. Grill after the per-module grills (Matters, Contracts, Intake, Documents, Entities, Knowledge) wrap._

## Index of decisions

| # | Decision | Status |
|---|---|---|
