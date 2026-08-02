# OpenLaw — Documents Module Decision Record

Decisions specific to the Documents module. Platform-level decisions that apply across all modules (data model, role model, intake, activity tracking, etc.) live in `DECISIONS.md` and are referenced by ID where relevant.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `DOC-###`.

## Open questions queued for the next grill-me session

- Storage backend (local filesystem / S3 / S3-compatible adapter; is encryption-at-rest a v1 requirement?)
- Versioning model (linear chain / DAG with branches for redlines / immutable snapshots with diff)
- Redline diff strategy (rendered DOCX track-changes pass-through, or generated diff view in-app)
- File-format support (PDF, DOCX, TXT, RTF — what about images, spreadsheets, emails?)
- OCR for scanned PDFs (in scope for v1?)
- Full-text search architecture (Postgres FTS / SQLite FTS5 / external like Tantivy or Meilisearch)
- Document-level tags / metadata schema (tags freeform vs vocabulary, custom fields)
- File preview rendering (in-browser preview without download — DOCX, PDF, etc.)
- Bulk import (folder import, drag-drop multi-file, email-attachment auto-extract)
- Permanent deletion vs soft delete; retention rules and legal-hold semantics
- Templates as a first-class document subtype (precedent library) or deferred

---

_No decisions recorded yet. Run `/grill-me` and ask to design the Documents module._

## Index of decisions

| # | Decision | Status |
|---|---|---|
