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

- Entity schema depth (officers, directors, share capital, registered agent, statutory addresses, EIN/TIN, license registry — first-class fields vs JSON metadata)
- Multi-jurisdiction handling (one entity may have registrations in multiple jurisdictions; sub-entity records vs jurisdiction list)
- Officers and directors (separate `people` table, or just text fields on the entity)
- Statutory document storage (where do certificates of incorporation, bylaws, annual filings live — in Documents module with entity reference, or duplicated in Entities)
- Renewal calendar mechanics (per-entity, per-license, per-jurisdiction; reminder schedule; ownership/assignment)
- Compliance calendar UX (calendar view vs list vs Kanban)
- Subsidiary tree / corporate structure visualization (org chart? optional v2?)
- Counterparty schema (how light is the light schema; primary contact model; M&A "counterparty becomes entity" migration)
- Entity → Matter / Contract roll-up reporting (how many active contracts per entity, etc.)
- Entity-level access control (does a Member need to be granted per-entity access, or is it global?)

---

_No decisions recorded yet. Run `/grill-me` and ask to design the Entities module._

## Index of decisions

| # | Decision | Status |
|---|---|---|
