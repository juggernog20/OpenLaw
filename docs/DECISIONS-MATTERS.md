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

- Matter lifecycle states (Open / In Progress / On Hold / Closed? configurable? per-type or global?)
- Matter assignment model (single primary assignee vs team; lead vs supporting roles)
- Deadlines and SLA tracking (are deadlines first-class? statute-of-limitations tracking?)
- Tasks / sub-items inside a matter (checklist vs full task entity)
- External counsel and outside-fee tracking (in scope at all? deferred to e-billing?)
- Matter / Contract relationship UX (when does a contract live "inside" a matter vs standalone)
- Closing / archiving a matter (what's preserved, what's redacted, retention rules)
- Matter naming / numbering scheme (free text only, or templated/auto-numbered?)
- Tags — separate concept from type, admin-curated and/or user-creatable?
- Field templates — per-type custom field definitions (e.g., Employment matters always have a "Separation date" field)?

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

| Slug | Display name | Notes |
|---|---|---|
| `employment` | Employment | Terminations, severance, harassment investigations, non-competes |
| `litigation` | Litigation | Lawsuits, threats, demand letters, subpoenas |
| `regulatory` | Regulatory | Agency inquiries, audits, license issues |
| `commercial` | Commercial | Bespoke deals, complex MSAs, matter-wrapped contracts |
| `corporate` | Corporate | Board matters, equity issuances, governance, M&A |
| `ip` | IP | Trademark filings, patent strategy, infringement |
| `privacy` | Privacy | GDPR/CCPA, breach response, data-subject requests |
| `advisory` | Advisory | One-off questions ("can we do X?") |
| `other` | Other | Long-tail catch-all (system-protected — cannot be hard-deleted) |

Schema (full DDL captured in `SCHEMA.md`):

- `matter_types(id, slug, display_name, description, display_order, is_system_default, archived_at, created_at, updated_at)`
- `slug` is stable for analytics + URLs and is **not** user-editable after creation; `display_name` is.
- `is_system_default = true` marks seed rows; the `other` row carries an additional protection preventing hard-delete.
- `archived_at` enables soft-delete; archived types are hidden from the new-matter picker but retained on existing matters.

Behavior:

- Admins add, rename, reorder, and archive types via Matters Settings.
- Archiving a type that is in use prompts an optional bulk-reassign step ("Move 14 existing matters to: Other ▾"). If skipped, existing matters keep their archived type for historical fidelity.
- `matters.matter_type_id` is non-null at creation. Intake (per **DD-010**) collects type at submission or defaults to `advisory` (lowest-commitment default; Member triage assigns the real type at handoff).
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

---

## Index of decisions

| # | Decision | Status |
|---|---|---|
| MTR-001 | Matter type taxonomy — configurable enum, seeded with 9 default types, Admin-managed | Accepted |
