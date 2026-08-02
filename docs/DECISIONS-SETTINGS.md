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

---

_No decisions recorded yet. Grill after the per-module grills (Matters, Contracts, Intake, Documents, Entities, Knowledge) wrap._

## Index of decisions

| # | Decision | Status |
|---|---|---|
