# OpenLaw — Knowledge Module Decision Record

Decisions specific to the Knowledge module (precedent library, playbooks, templates, internal know-how). Platform-level decisions that apply across all modules (data model, role model, intake, activity tracking, etc.) live in `DECISIONS.md` and are referenced by ID where relevant.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `KNW-###`.

## Open questions queued for the next grill-me session

- Knowledge entry types (precedent clauses / playbooks / templates / how-to articles / FAQ — single entity with `type` discriminator, or distinct entities per kind?)
- Relationship to Documents (is a precedent a Document with a flag, or a separate Knowledge record that *references* a Document version, or fully independent?)
- Authoring workflow (who can publish — any lawyer, or curator-gated? draft → review → publish lifecycle, or trust-the-author?)
- Versioning and supersession (does a clause have versions like a contract draft, and how do we surface "this superseded KNW-042"?)
- Search architecture for knowledge (reuse Documents FTS, or layer a separate semantic / vector search? cross-module unified search vs module-scoped)
- Tagging / taxonomy (controlled vocabulary curated by admins vs freeform tags vs both — and how this interacts with the document-tags decision in DOC)
- Surfacing knowledge in workflows (suggested clauses inside the contract redline UI? template picker at matter-open time? passive vs active recommendation)
- Usage tracking (do we record "this precedent was inserted into contract X" — for popularity ranking, audit, or both?)
- Stale-content handling (review-by date / owner / auto-archive rules — or rely on manual curation)
- AI-assisted authoring and retrieval (in scope for v1, or strictly post-v1 once a corpus exists?)
- Access control granularity (org-wide vs role-restricted vs per-entry ACL — and how it composes with the platform role model)
- External-source ingestion (clause libraries from third-party providers, statute snippets, regulator guidance — adapter model? out of scope?)

- Organization structure for knowledge items (templates, precedents, legislation) — folder-like structure flagged from **DOC-006**; documents will own a knowledge-item FK per **DOC-008**; precedent/template library explicitly routed here by **DOC-002**
---

_No decisions recorded yet. Run `/grill-me` and ask to design the Knowledge module._

## Index of decisions

| # | Decision | Status |
|---|---|---|
