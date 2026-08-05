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

_None — queue cleared 2026-08-04 (DOC-001 through DOC-011). Templates/precedents routed to the Knowledge module per DOC-002; storage/search engine picks routed to the tech-stack grill per DOC-009. New questions from screen batches or other module grills queue here._

---

## DOC-001 — Record model: logical document + linear immutable version chain

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — The foundational shape for the module; must satisfy CTR-014's contract-side requirements (version kinds, executed pin, generated-redline provenance). Gates grill-plan K.H3.
- **Decision** —
  - **`documents`** is the logical record: title, ownership links (`contract_id`/`matter_id`, both nullable per DD-007), metadata, and an explicit executed pin: `executed_version_id` FK.
  - **`document_versions`** are immutable file snapshots in a **strictly linear** chain (`version_number` 1..n): `kind` (`draft_ours | redline_theirs | redline_ours | executed | amendment | generated_redline`), `source` (`uploaded | generated`), `compared_from_version_id` (provenance for generated redlines), `note`, `created_by`. Individual versions are never edited or deleted; corrections add a new version.
  - The K.H3 version pill renders `version_number` of the viewed version.
- **Rationale** — A stable logical identity is what contracts/matters link to (CTR-014's primary-document designation); immutable snapshots make the chain trustworthy as negotiation history. Linear beats DAG: real negotiation rounds supersede each other, and the rare parallel-drafts case is servable with a second document record instead of branch/merge UI.
- **Alternatives considered** — DAG with branches: git-for-lawyers UI for a rare case. Self-referencing single table (`prev_version_id`): no stable identity to link from; every query collapses chains.
- **Consequences** — Two tables in SCHEMA.md; `generated_redline` added to CTR-014's kind list (SCHEMA note updated). Storage question (Q5) deals in immutable blobs — enables content-addressing/dedup. K.H3 unblocked.

## DOC-002 — Module identity: the legal file layer, made browsable

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — Raised by Blair mid-grill: before technical feature decisions, "have we established more fundamentally what exactly the document feature will be." PRODUCT.md promises a "central document repository with versioning, search, and tagging — first-class destination, not just an attachment store"; DD-007 makes Document the workflow-free file primitive; the Knowledge module exists separately. The identity between those commitments was never pinned.
- **Decision** — Documents is **the file layer of legal work, made browsable**:
  - Files mostly **enter through work** — uploaded to matters, contracts, and intake requests; executed copies arriving via e-sign (CTR-013). ~~**Standalone direct upload** exists for files that belong to no matter/contract~~ *(superseded by **DOC-008**: every document has an owning record — matter, contract, entity, or knowledge item; direct upload asks where the file lives).*
  - The Documents **destination is a repository view across all of them**: search, filters (type, linked matter/contract, party, date, kind), recents — one place to find any file regardless of where it lives.
  - **Organization comes from links + metadata + search, not a mandatory folder tree.** No filing discipline is imposed at upload.
  - **Explicit non-goals**: OpenLaw is not the org's general file system (Drive/SharePoint stays); no check-in/check-out; templates/precedent library belongs to the **Knowledge module**, not here.
- **Rationale** — For a 2–10 person team the painful question is "where is that NDA?", not "is our folder taxonomy enforced?" A repository view over work-attached files answers it without building a DMS product category (iManage/NetDocuments territory) or breaking PRODUCT.md's first-class-destination promise.
- **Alternatives considered** — Full DMS (workspaces/folders/check-out): months of build, entrenched competition, filing discipline a small team won't keep. Attachment-store-only: contradicts PRODUCT.md and DD-007; orphan documents homeless.
- **Consequences** — This decision is the lens for the rest of the queue: versioning/preview/search serve the repository view; the folders question (Q8) starts from "links + metadata are primary"; templates (Q12) route to Knowledge; bulk import (Q13) matters because legacy files must get *into* the layer. **Reorders DOC-001 conceptually** — DOC-002 is the module's root decision; DOC-001 stands as its record model.

## DOC-003 — Redline compare: Workshare-style in-app view + Word track-changes export

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — The mechanics behind CTR-014's "run a redline against the previous version" (gates K.H4). Blair: "I want to have the option of both a Litera Workshare compare style compare or to export to word track changes."
- **Decision** — Comparison is **dual-mode**:
  1. **In-app compare view (Litera/Workshare-style)**: a rendered, formatted comparison of two versions — insertions/deletions highlighted in the document's real formatting, with a change list / navigation pane. This is the default result of "Run redline".
  2. **Export to Word track changes**: from the same comparison, generate a real .docx with tracked changes — saved into the version chain as a `generated_redline` version (DOC-001 provenance) and downloadable for counterparty exchange.
  - Non-Word pairs (e.g. PDF↔PDF) support the in-app view via extracted text (degraded: no formatting fidelity); export is Word-pairs only.
  - Comparison engine selection → tech-stack grill (queued).
- **Rationale** — The in-app view is the daily-driver review experience (Workshare is the lawyer benchmark); the exportable artifact is how the redline leaves the building. Building the view on the same engine output as the export keeps the two consistent.
- **Alternatives considered** — Artifact-only (recommended initially): loses the rich review UX. View-only: redline can't be emailed. Pass-through only: contradicts CTR-014.
- **Consequences** — Compare engine is now a load-bearing tech-stack decision (must yield both a renderable change model and a track-changes .docx). K.H4 unblocked: the Redlines pill opens compare (view mode), with export as an action inside it.

## DOC-004 — In-app rendering: PDF, Word, images, PowerPoint, emails; rest download-only

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — Which formats read inside the doc panel vs download-only (gates K.B1–17). Recommended PDF+Word+images; Blair widened: "PDF, word, images, ppt, and emails."
- **Decision** — The doc panel **renders**: PDF (native), Word/DOCX (converted for display; tracked changes and comments visible), images (PNG/JPG inline), **PowerPoint/PPTX** (converted), and **emails (MSG/EML)** (parsed: headers, body, attachment list — attachments openable as documents). Any file type can be **uploaded and stored**; everything outside the render set (XLSX, TXT/RTF, ZIP, …) is searchable by metadata/extracted text where possible but opens via download in v1.
- **Rationale** — PPT decks (board materials) and emails (the raw material of disputes and deals) are genuinely read line-by-line in legal work; spreadsheets rarely are.
- **Alternatives considered** — PDF-only: guts the panel mid-negotiation. Everything renders: one pipeline per format for a long tail with little legal payoff.
- **Consequences** — Render pipeline needs DOCX + PPTX conversion and MSG/EML parsing (engines → tech-stack queue). Email rendering meshes with the intake email channel (DD-010) and the email-filing ideas queued in DECISIONS-INTAKE. K.B1–17 unblocked; the doc panel is now the confirmed surface for DES-006's secondary-typeface pick.

## DOC-005 — OCR on upload for image-only PDFs

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — Legacy signed contracts are overwhelmingly scans; a repository that can't find them fails DOC-002's job. Bulk import (Q13) will bring them in volume.
- **Decision** — Image-only PDFs are OCR'd in the background on upload; extracted text feeds full-text search and AI analysis (CTR-008). The original scan is always what renders — extracted text is an index, never a displayed "conversion". OCR engine (open-source) → tech-stack grill.
- **Rationale** — Searchability of legacy paper is a core repository promise; background processing keeps upload fast.
- **Alternatives considered** — Defer: day-one legacy imports would be unsearchable.
- **Consequences** — Background job pipeline is now required infrastructure (aligns with the job-runner tech-stack question). Extracted text storage lands with the search decision (Q6).

## DOC-006 — Folders: inside matters/contracts only; no global tree

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — MTR-013 parked "template folder structures" here; DOC-002 ruled out a mandatory global tree. Blair: folders may also exist inside future modules (Knowledge — templates/precedents/legislation; Entities — articles, resolutions, share registers/certificates), "but yes in the main matters / contracts, that's where folders will live, not in a separate DMS folder system."
- **Decision** — Optional lightweight folders **scoped within a matter or contract** (~~single level in v1~~ *revised by **DOC-011**: folders nest — folder-drop imports retain structure*). The global repository view stays flat — a folder is just another filter facet there. Knowledge and Entities may define their own organization structures when those modules are grilled (noted in their queues). Re-opens the MTR-013 door: matter templates may later pre-create a folder skeleton.
- **Rationale** — A 60-file litigation matter needs grouping; the org-wide tree is the DMS trap DOC-002 declined.
- **Alternatives considered** — No folders anywhere: heavy matters become flat 60-row lists. Global tree: two competing sources of truth for "where" a file is.
- **Consequences** — `document_folders` (scoped to one owning record) + `documents.folder_id` in SCHEMA.md. Folder skeletons added to the matter-templates FUTURE-FEATURES scope. Entities/Knowledge queues annotated.

## DOC-007 — Metadata: standard document properties only; no custom fields; tags deferred

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — Recommended tags + a `document` scope in the CTR-016 fields catalog. Blair: "I don't think we want to do too many custom fields for doc metadata.. just normal what you'd see for document metadata."
- **Decision** — Documents carry **standard metadata only**: title, description/notes, document kind (per DOC-001 version kinds at version level), file properties (format, size), provenance (uploaded by, dates), owning record, folder. **No `document` scope in the fields catalog. No tags in v1** — this extends MTR-010's tag deferral to documents; the existing FUTURE-FEATURES tags entry now covers both, and PRODUCT.md's "tagging" wording is satisfied later or amended (flagged).
- **Rationale** — The repository's findability comes from search (incl. OCR text), links, and standard facets; a metadata schema nobody fills is DMS-profile theater.
- **Alternatives considered** — Tags + catalog scope (recommended, declined). Tags only: not affirmed; keeps one deferral story for tags platform-wide.
- **Consequences** — SCHEMA.md documents table stays lean. Repository filters: kind, format, owning record/module, date, uploader, folder. FUTURE-FEATURES tags entry extended.

## DOC-008 — No standalone documents: every document has an owning record; access is inherited

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — Asked who sees standalone documents. Blair: "I don't think there will be standalone.. it'd either be knowledge base, entities management, contract or matter." This revises DD-007's "can stand alone" clause and DOC-002's standalone-upload bullet.
- **Decision** —
  - Every document belongs to **exactly one owning record**: a matter, a contract, an entity (Entities grill), or a knowledge item (Knowledge grill). Application enforces exactly-one-owner across the FK set; direct upload flows always ask "where does this live?"
  - **Access is always inherited** from the owning record (its team + DD-014 confidentiality). There is **no `document_team`** — the TBD under `matter_team` resolves to "not needed".
  - The repository destination is Member+ (legal staff); Contributors/Business Users see documents only through records they're on.
- **Rationale** — One rule source for permissions (no drift between a record's team and its files); "where does this live?" at upload is cheap now that owners include entities and knowledge (the old orphan cases all have homes).
- **Alternatives considered** — Standalone with default-team-wide visibility (recommended, declined). Per-document teams: permission drift by design.
- **Consequences** — DD-007 annotated (stand-alone clause revised); DOC-002's standalone bullet superseded; SCHEMA.md documents section gains the exactly-one-owner rule and future `entity_id` / knowledge FKs; MTR-007's "standalone contract" is unaffected (the *contract* stands alone; its documents belong to it).

## DOC-009 — Storage & search: requirements here, engine picks routed to tech-stack

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — Storage backend and FTS engine were queued in both this grill and the tech-stack grill; they are infrastructure picks, not product decisions (per Blair's mid-grill steer away from technical questions).
- **Decision** — This grill fixes the **requirements**; the tech-stack grill picks engines:
  - **Storage**: version files are immutable blobs (DOC-001) behind a **storage adapter interface**. Working default: local filesystem driver (self-host-first per PRODUCT.md), S3-compatible driver as the alternative. Encryption-at-rest is **not an application-layer v1 requirement** — self-hosters use disk/volume encryption; an application-layer story can come with a managed offering.
  - **Search**: full-text search covers title, description, owning-record context, and **extracted text** (native text layers + DOC-005 OCR output). Working default: Postgres FTS first (no extra infrastructure for self-hosters); a dedicated engine (Tantivy/Meilisearch) only if relevance/scale demands it later. Extraction runs on the background job pipeline (same worker as OCR).
- **Rationale** — Both choices follow PRODUCT.md's "working install in under an hour from a clean VM" principle: zero extra services in the default path, adapters where deployments differ.
- **Alternatives considered** — S3-only (hosted assumption — wrong default for self-host); dedicated search engine in v1 (another service to run before the first document is findable).
- **Consequences** — Tech-stack queue already carries the engine questions; this decision pre-loads the defaults. `document_versions.file_ref` format finalizes with the adapter decision.

## DOC-010 — Deletion: soft delete + Admin hard delete; versions immutable

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — Deletion/retention semantics for the file layer.
- **Decision** — Archive (soft delete, Member+) hides from lists/search, recoverable, logged. Hard delete is Admin-only, whole-document (all versions), typed-confirmation + activity-logged — the compliance/redaction path (DD-017/MTR-008 pattern). Individual versions can never be deleted. Retention rules and legal holds stay parked (FUTURE-FEATURES).
- **Rationale** — Chain trustworthiness requires version immutability; lawful-erasure (GDPR) requires a real hard-delete path.
- **Alternatives considered** — Soft-only: no erasure path. Per-version delete: breaks the negotiation record.
- **Consequences** — Matches `archived_at` on `documents`; hard delete cascades `document_versions` + stored blobs.

## DOC-011 — Bulk upload: multi-file drop + folder drop retaining structure (revises DOC-006 to nested folders)

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — Getting many files in at once. Blair: "We want file drop as well as folder drop that retains folder structure… so we can add a lot of files at once."
- **Decision** —
  - **Multi-file drop** onto any matter/contract (or a folder within one): each file becomes a document there.
  - **Folder drop**: dropping a folder (or nested tree) onto a record **recreates its folder structure** as `document_folders` and files each document into place.
  - **Consequently DOC-006 is revised: folders nest** (`document_folders.parent_id`) — structure retention requires it. The global repository view remains flat regardless.
  - Email-attachment auto-extraction remains an Intake-channel concern (already queued in DECISIONS-INTAKE). OCR (DOC-005) and AI analysis (CTR-008, for contract-owned files) queue over bulk-imported files like any upload.
- **Rationale** — Legacy books arrive as folder trees on someone's drive; structure-retaining drop is the lowest-friction migration path — no mapping file, no per-file ceremony.
- **Alternatives considered** — Drag-drop only (no structure): flattens legacy organization. CSV-mapped migration flow (recommended, not requested): can layer later if metadata-rich migration demand appears.
- **Consequences** — `document_folders.parent_id` added in SCHEMA.md; DOC-006 annotated. Upload pipeline handles directory traversal + batch job queuing (background pipeline per DOC-005/009).

## Index of decisions

| # | Decision | Status |
|---|---|---|
| DOC-001 | Record model: logical document + linear immutable version chain | Accepted |
| DOC-002 | Module identity: the legal file layer, made browsable | Accepted |
| DOC-003 | Redline compare: Workshare-style in-app view + Word track-changes export | Accepted |
| DOC-004 | In-app rendering: PDF, Word, images, PowerPoint, emails; rest download-only | Accepted |
| DOC-005 | OCR on upload for image-only PDFs | Accepted |
| DOC-006 | Folders: inside matters/contracts only; no global tree | Accepted |
| DOC-007 | Metadata: standard document properties only; no custom fields; tags deferred | Accepted |
| DOC-008 | No standalone documents: every document has an owning record; access inherited | Accepted |
| DOC-009 | Storage & search: requirements here, engine picks routed to tech-stack | Accepted |
| DOC-010 | Deletion: soft delete + Admin hard delete; versions immutable | Accepted |
| DOC-011 | Bulk upload: multi-file + folder drop retaining structure (folders nest) | Accepted |
