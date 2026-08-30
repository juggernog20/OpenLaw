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

_None — queue cleared 2026-08-06 (KNW-001 through KNW-005)._

---

## KNW-001 — Entry model: one typed entity, text body + owned documents

- **Status** — Accepted
- **Date** — 2026-08-06
- **Decision** — `knowledge_items` with a **configurable type list** (`knowledge_types`, MTR-001 machinery; seeds: template, precedent, playbook, article). Every item has a rich-text `body` (article/playbook content, or usage guidance for a template) and can **own documents** — `documents.knowledge_item_id` joins the DOC-008 owner set; a template's .docx is a normal document with DOC-001 version chains, previewable and downloadable like any file.
- **Rationale** — One machinery for search, browse, and publishing; playbooks/FAQs aren't files and files aren't articles — the body+documents combination covers both.
- **Alternatives considered** — Distinct entities per kind (4× machinery); documents-with-a-flag (no home for non-file knowledge; DOC-002 routed the library here).
- **Consequences** — `knowledge_items`, `knowledge_types` in SCHEMA.md; DOC-008 owner set complete (matter | contract | entity | knowledge item).

### Built addendum (2026-08-30, M28 close, [#598](https://github.com/juggernog20/OpenLaw/issues/598)) — file-first, one primary Document, drop-to-create, and Markdown guidance

The shipped record is file-first. Dropping one or several files on the Knowledge destination creates one draft Knowledge Item per file, takes each title from its filename, creates its first owned Document and Version, and pins that Document as the item's primary Document. An item may also start without a file. On a record with several Documents, Member+ may move or clear the primary pin, and the pin must name a live Document that item owns.

The optional `body` stores Markdown source. The editor gives source and preview modes. Rendering uses a fixed React-element allowlist for headings, lists, links, emphasis, and code; it accepts no raw HTML and uses no HTML injection. The body remains guidance beside the files, and the record and portal both read the primary file before the body.

## KNW-002 — Publishing: Member+ authors, draft/published, edit-in-place

- **Status** — Accepted
- **Date** — 2026-08-06
- **Decision** — Any legal staff member creates and publishes — no curator gate (trust-the-author; DD-017 audit is the accountability). States: `draft | published` (drafts staff-visible, excluded from portal/deflection). **Edit-in-place** with audit history — no item-version model; file versions come free via owned documents' chains. Supersession = archive + optional `replaced_by_id` link.
- **Rationale** — At 2–10 people a review queue between the team and its own know-how mostly guarantees an empty library.
- **Consequences** — `state`, `replaced_by_id` columns. Curator workflow, if ever needed, layers on later.

### Built addendum (2026-08-30, [#603](https://github.com/juggernog20/OpenLaw/issues/603)) — lifecycle acts are named, audited routes

Publishing, unpublishing, archiving, and restoring are actions rather than generic field edits. Each has its own Member+ route and activity verb. The first publish stamps `published_at`; publishing an already-published item does not replace that date. Unpublish returns the item to draft and clears the stamp. Archive accepts an optional live replacement and restore removes the archive stamp. Audience remains an ordinary field write because it describes who may read a published item rather than changing the item's lifecycle.

A change that removes portal reach is allowed even when intake links point at the item. The record UI names the number of affected links before unpublishing or choosing Legal only, but the settings rows remain intact. This preserves the Administrator's configuration for repair instead of silently deleting it as a side effect of an author's lifecycle decision.

## KNW-003 — Organization: nested folders, blank-start

- **Status** — Accepted
- **Date** — 2026-08-06
- **Decision** — `knowledge_folders` (nested, DOC-006/011 pattern at knowledge scope — organizing _items_, not documents) + `knowledge_items.folder_id`. **Blank-start**, consistent with ENT-005/006: the organization builds its own structure. Type is a filter, not the hierarchy.
- **Consequences** — Two light tables; list + search across everything with type/folder/author filters.

### Built addendum (2026-08-30, M28 close, [#598](https://github.com/juggernog20/OpenLaw/issues/598)) — the blank nested tree organizes items

The Knowledge destination starts with no folders. Member+ may create, rename, move, reorder, and dissolve nested Knowledge Folders. Moving refuses cycles. Dissolving a folder moves its child folders and Knowledge Items to the parent and deletes no item. Selecting a folder scopes the managed list to that folder and its descendants; Type remains an independent filter. The shared Document-folder name rule applies, but a Knowledge Item's Documents stay in one flat card and gain no `document_folders` owner arm.

## KNW-004 — Audience: legal-only default + portal-readable flag; v1 surfacing = browse/search/deflection

- **Status** — Accepted
- **Date** — 2026-08-06
- **Decision** — `audience`: `legal_only` (default) | `everyone` — published `everyone` items render read-only in the portal (magic-link, no login), which lets INT-004 deflection links point at real knowledge articles. v1 surfacing is the Knowledge destination + deflection links only; in-workflow surfacing (template picker at contract creation, clause suggestions in review) goes to FUTURE-FEATURES.
- **Rationale** — The deflection layer needs a home for the FAQ content it links; in-workflow surfacing needs a populated corpus before it's more than an empty dropdown.
- **Consequences** — Portal gains a read-only knowledge-article view. INT-004's links can be internal (knowledge item) or external (URL).

### Built addendum (2026-08-30, [#603](https://github.com/juggernog20/OpenLaw/issues/603)) — one portal-reach gate governs the article, its files, and deflection

A Knowledge item exists on the portal only while it is live, published, and `everyone`. The article read and every document download apply that same gate. Draft, Legal only, archived, and unknown items answer the same 404 body, so refusal does not disclose which condition failed. The portal routes require the existing session and no additional credential; a Member+ session may use them in the same requester capacity.

The portal article is read-only: its title, current-version downloads, and body, with the primary file first and the body last. It carries no author, folder, type, or edit affordance. Internal deflection links open that route in the same tab. External links retain the existing new-tab behavior.

## KNW-005 — Deferred set: search intelligence, usage tracking, staleness, AI, external ingestion

- **Status** — Accepted
- **Date** — 2026-08-06
- **Decision** — Deferred without individual grills: semantic/vector search (DOC-009 FTS covers v1), usage tracking ("inserted into contract X"), stale-content rules (review-by dates), AI-assisted authoring/retrieval, and external clause-library ingestion. One FUTURE-FEATURES entry covers the set.
- **Rationale** — All presuppose a corpus and usage patterns that don't exist yet.

## Index of decisions

| #       | Decision                                                           | Status   |
| ------- | ------------------------------------------------------------------ | -------- |
| KNW-001 | Entry model: one typed entity, text body + owned documents         | Accepted |
| KNW-002 | Publishing: Member+ authors, draft/published, edit-in-place        | Accepted |
| KNW-003 | Organization: nested folders, blank-start                          | Accepted |
| KNW-004 | Audience: legal-only default + portal-readable flag                | Accepted |
| KNW-005 | Deferred set: search intelligence, usage, staleness, AI, ingestion | Accepted |
