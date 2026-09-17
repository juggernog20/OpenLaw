# OpenLaw — Auto-Docs Module Decision Record

Decisions specific to the Auto-Docs module: approved Word templates that a form fills, for Legal and for Business Users in the Portal. Platform-level decisions that apply across all modules (data model, role model, intake, activity tracking, etc.) live in `DECISIONS.md` and are referenced by ID where relevant. The direction that opened this module is **DD-022**; this file is the grill it asked for.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `ADO-###`.

## Open questions queued for the next grill-me session

_None — queue cleared 2026-09-13 (ADO-001 through ADO-011). The clause library, repeating Blocks, and per-person Generation limits are parked in `FUTURE-FEATURES.md`._

---

## ADO-001 — Module identity: an Auto-Doc is its own record, in its own destination, with a Portal surface

- **Status** — Accepted
- **Date** — 2026-09-13
- **Context** — DD-022 asked whether an Auto-Doc is a Document on a Contract created on the fly, a Knowledge Item of type template, or a record of its own. Knowledge Items are edit-in-place with no version model (KNW-002) and gate the Portal by audience alone (KNW-004). Contract Types have no home for a board resolution or a letter. The focus group's ask was self-serve documents for Business Users, not a pre-fill for Legal.
- **Decision** — **An Auto-Doc is its own record**: one approved Word template, the form that fills it, and the settings that govern its use. **Auto-Docs is a top-level destination in the app** and a destination in the Portal. The template file is an ordinary Document with a DOC-001 version chain, owned by the Auto-Doc: the DOC-008 owner set gains a fifth arm, `auto_doc_id`. A Generation is the act of filling one; it is its own record (ADO-007) and is never a Document. The vocabulary is fixed in `CONTEXT.md`: **Auto-Doc**, **Placeholder**, **Block**, **Clause rule**, **Form field**, **Generation**, **Filing**.
- **Rationale** — The three things an Auto-Doc must do — version its form separately from its file (ADO-004), reach a chosen set of Business Users (ADO-009), and create or attach to Contracts and Matters (ADO-005) — each fight Knowledge's model. A record of its own pays for one destination and owes nothing to another module's rules.
- **Alternatives considered** — Knowledge Item of type `template` with side tables: fights KNW-002 the moment the form is versioned, and forces letters into Knowledge's audience model. A property of the Contract Type: no home for non-contract documents. A Document on a fly-created Contract: every letter would be a Contract.
- **Consequences** — New tables under SCHEMA.md's Auto-Docs section. `documents.auto_doc_id` and a widened owner CHECK. The activity vocabulary gains the `auto_doc` entity type. The nav gains a destination in both shells. DOC-002's routing of "templates" to Knowledge stands for precedents and playbooks; a Knowledge `template` is guidance beside a file, an Auto-Doc is a file a form fills.

## ADO-002 — Placeholders, Blocks, and Clause rules: double braces in Word, rules in the editor

- **Status** — Accepted
- **Date** — 2026-09-13
- **Context** — Legal writes the template in Word (DD-022 path 1). OpenLaw must find the variables (path 3), keep every bit of formatting Legal prepared (path 11), and include or omit clauses on conditions such as "jurisdiction is United States, so include arbitration" (Blair, 2026-09-13).
- **Decision** —
  - **Placeholder syntax is double braces**: `{{counterparty_name}}`. A person types it anywhere in the document. Nothing else is detected in v1: no Word merge fields, no content controls.
  - **A Block is a named span**: `{{#block arbitration}} … {{/block}}`. Its text stays in the file with its own formatting. The editor detects Blocks from the file exactly as it detects Placeholders; a person never names a Block by hand and can never reference one the file does not hold.
  - **A Clause rule is written in the form editor, not in Word.** It names one Block and one condition on one form field: `equals`, `is one of`, `is set`, `is not`. A Block with no rule is always included. The editor validates every rule against the current form and file on Publish (ADO-004).
  - **Formatting directives** ride on the Placeholder: a `date` form field prints in a chosen date format, a `currency` field with its symbol and thousands separators, and text may be asked for in upper case. The set of directives is fixed in code and small.
  - **Detection reports by name**: unclosed braces, a Block opened and never closed, and a name that is not a valid slug are refused at upload with the offending text quoted.
  - **Repeating blocks** (a table of deliverables, a list of schedules) and **a clause library** (Blocks sourced from outside the file) are **deferred** to `FUTURE-FEATURES.md`. The editor's Clauses section is shaped so a library clause is one more row beside the detected Blocks, with the same rule grammar.
- **Rationale** — Every lawyer can type braces; merge fields and content controls are invisible to most of them. A rule in the editor can offer the form field's option list and fail loudly on Publish; an expression in Word fails silently at Generation. Keeping the clause text in the file is what makes path 11 true: the engine substitutes and omits, it never composes.
- **Alternatives considered** — Word merge fields: familiar to mail-merge users only. Content controls: best in-Word UX, worst discoverability. Rules written in Word (`{{#if jurisdiction == "United States"}}`): declined, see Rationale. Clause library now: needs a corpus, a clause record, and an insertion engine that keeps foreign formatting; KNW-005 already parked the corpus.
- **Consequences** — The fill engine must merge Word runs so a Placeholder split by spell-check still resolves (TECH-028). Clause rules are rows on the form version (ADO-004). One rule grammar serves Clause rules and Assignment rules (ADO-006).

## ADO-003 — Form fields belong to the Auto-Doc and may map to catalog Fields and Contract attributes

- **Status** — Accepted
- **Date** — 2026-09-13
- **Context** — INT-002 built request forms on the shared fields catalog. DOC-007 refused a `document` scope in that catalog. Ten NDA placeholders do not belong in an org-wide catalog, but a draft Contract created from a Generation (ADO-005) should arrive with its Fields filled, exactly as Request conversion carries values through today.
- **Decision** —
  - **Form fields are local to the Auto-Doc.** Each has a slug, a label, help text, one of the catalog's field types (`text`, `long_text`, `number`, `currency`, `date`, `boolean`, `single_select`, `multi_select`, `user`, `entity`), options where the type needs them, a required flag, and a display order. No catalog row is created.
  - **A form field either fills a Placeholder or collects a value the document does not print** (DD-022 path 4). Both kinds are ordinary rows; the only difference is whether a Placeholder of the same slug exists in the pinned file.
  - **A form field may map to one catalog Field** whose scope admits `contract`, or to one built-in Contract attribute: title, primary Counterparty name, our Entity, Owning department, Region, value, effective date, expiry date, term type. On Generation of a Contract-targeted Auto-Doc the answer lands there. A map is optional and per field.
  - **First upload detects Placeholders and creates one `text` form field per Placeholder**, in document order. Legal retypes, relabels, reorders, and adds non-document fields.
  - **Re-upload runs detection again.** A new Placeholder gets a new `text` form field. A form field whose Placeholder is gone is kept and marked as an **error state** in the editor — a visible cue on the row and a count on the card — because a mapped answer must not be lost silently. Publish refuses while any Placeholder in the pinned file has no form field (ADO-004); an orphaned form field does not block Publish, it is simply a non-document field until Legal removes it.
  - **The `entity` type is allowed on Portal Auto-Doc forms and may be required.** Business Users pick from Portal-listed Entities (DD-027). An Auto-Doc may instead fix our Entity in its settings, in which case the form shows none. The `user` type stays refused on Portal forms, as INT-002's M20/11 addendum left it.
- **Rationale** — Local fields keep the catalog clean; the optional map is what makes path 8 useful. Detection-then-edit is what path 3 promised; running it again on re-upload is the same promise kept. An error state that a person must clear beats a silent drop.
- **Alternatives considered** — Every Placeholder becomes a catalog Field under a new scope: supersedes DOC-007 and fills the catalog with one-offs. Re-upload only reports differences and Legal maintains fields by hand: more work than the first upload, for no gain.
- **Consequences** — `auto_doc_form_fields` rows carry `catalog_field_id` and `contract_attribute` as two nullable maps with a CHECK that at most one is set. Conversion's value carry-through (INT-002) is reused for the catalog map. DD-027 opens the Entity picker to Business Users.

**DES-087 addendum (2026-09-14, #874):** The editor is the builder: the template drawn beside its form, one field card per selected row, and each commit its own form version. An orphaned field prints "No Placeholder in file version N" on its row and the Fields card counts them; an unfilled Placeholder draws on `status-danger` in the template pane.

## ADO-004 — Two chains, one live pair: the file versions, the form versions, and Publish pins them

- **Status** — Accepted
- **Date** — 2026-09-13
- **Context** — DD-022 path 10 asks for diff-style version control. Blair wants form changes tracked separately from changes to the file. A Generation must be able to say exactly what it filled.
- **Decision** —
  - **The template file is a Document with a DOC-001 chain.** Each upload appends a Version. Two Versions compare through the existing DOC-003 Comparison machinery, so the diff of the paper is the Word compare the team already knows.
  - **The form definition is versioned on its own.** A form version is an immutable snapshot of the form fields, their maps, and the Clause rules. Saving the editor writes a new draft form version; the diff between two form versions is structural — fields added, removed, retyped, relabelled, reordered, rules changed — and is rendered as such.
  - **Delivery and access settings are plain audited edits**, not versioned. A change shows in the Activity feed as before and after.
  - **Publish pins one file Version and one form version together as the live pair.** A Generation cites both. Editing either chain after Publish changes nothing live until the next Publish. Unpublish clears the pair and deletes nothing.
  - **Publish refuses** when a Placeholder in the pinned file has no form field, when a Clause rule names a Block the pinned file does not hold, or when a Clause rule names a form field or option that no longer exists. The refusal names every gap at once, in SET-003's house style.
  - **A submission names the pair it loaded.** If the live pair changed while the person was filling the form, the submission is refused with a named reason and the answers stay on screen. Nothing is ever generated against a pair the person did not see.
- **Rationale** — A form change alone can change the document, so a Generation must cite both halves. Separate chains give Blair the separate tracking he asked for; the pair gives the Generation one thing to cite. Refusing a changed pair costs one reload and prevents the one thing a template system must never do.
- **Alternatives considered** — One version of the whole Auto-Doc per Publish: simpler, but the diff of a form edit would be buried in a file compare. Form edits live at once: two Generations five minutes apart could differ with no version to cite.
- **Consequences** — `auto_doc_form_versions` with a jsonb snapshot; `auto_docs.published_document_version_id` and `published_form_version_id`; `auto_doc_generations` cite both. The Activity verbs `auto_doc.published` and `auto_doc.unpublished` carry the pair.

**M35/5 built addendum (#848):** Member+ has the Auto-Docs list, draft creation, template uploads, and the nine-type form editor. Migration 0120 adds the fifth Document owner and immutable JSON form snapshots. Each file Version holds detection metadata; a field's Placeholder provenance survives later uploads to drive the editor's orphan cue. History uses the shared activity feed, and file previews use the shared Document reader. Clause rules, maps, structural diffs, and Publish follow in M35/6.

**M35/6 built addendum (#849):** Each form snapshot also holds its maps and Clause rules. The editor offers one row per detected Block and each select field's options. It refuses a rule for an absent Block when saving. Publish checks the chosen file and form together and names every missing Placeholder, Block, field, or option in one refusal. Structural form comparisons report field and rule changes. File comparisons open the shared Comparison view.

Member+ can Publish a new pair, Unpublish, Archive, and Restore through separate audited routes. Later uploads and form saves keep the live pair. Migration 0121 adds publication and audience settings, the target Contract Type, and deferred checks on both version owners. Settings edits record before and after. The list searches by name and filters by state, audience, and target Type, with archived records hidden by default. Portal audience enforcement follows in M35/11.

**DES-087 addendum (2026-09-14, #874):** The form editor has no Save. Every field-card commit, reorder, add, removal, and Clause rule change writes one form version, as this record's "saving the editor writes a new draft form version" already allows. Form versions are chosen only in the Publish and Compare dialogs. Publish is a dialog from the record's sub-bar and lists every gap inside it.

**ADO-012 addendum (2026-09-14, #873):** "Unpublish clears the pair and deletes nothing" holds for every lifecycle act. Administrator erasure is the one act that removes both chains. It destroys every file Version and every form version together with the Auto-Doc, so nothing is left to publish or to compare. It is the only path that can take a Version away.

## ADO-005 — Destinations: a Contract Type target creates a draft Contract; anything can be Filed afterwards

- **Status** — Accepted
- **Date** — 2026-09-13
- **Context** — DD-022 path 8: if the Auto-Doc is a contract, a draft Contract is created. Blair widened it: a Generation must be able to create a Contract, be added to a Matter or Contract, or stand alone. DOC-008 gives every Document exactly one owner, and DD-023 lets a Business User upload Documents to records they hold a team row on.
- **Decision** —
  - **An Auto-Doc optionally targets one Contract Type**, the `request_types.target_*` shape. A targeted Generation creates a Contract in the `draft` seed status of that Type, inside the Generation's own transaction, and files the generated `.docx` as the Contract's primary Document, Version 1, kind `draft_ours`, source `generated`. The `document_versions` CHECK that binds `source = 'generated'` to redlines is widened to admit this.
  - **The created Contract takes its shape from the form** through ADO-003's maps: title from a **title pattern** in the Auto-Doc's settings (`NDA – {{counterparty_name}}`), primary Counterparty matched by name or created (as Request conversion does), our Entity from the form or the fixed setting, catalog Fields and built-in attributes from their maps. **Business Owner is the generating Business User**, which under DD-023 also adds their team row and so gives them the Contract in the Portal. Member+ generating in the app may name a Business Owner or leave it empty. **Legal Owner is assigned by ADO-006.** Default people on the Type (CTR-026) are applied as on any creation path.
  - **A non-targeted Generation's output lives on the Generation.** It is not a Document. Legal opens and downloads it from the Auto-Doc's Generations list; the person who generated it has it in the Portal (ADO-009).
  - **Filing** adds a Generation's output to an existing Matter or Contract as a Document, Version 1, or creates a new Contract from it. Member+ may File to any record they reach, and may pick the destination on the form itself when generating in the app. A Business User may File from the Portal to a Contract or Matter they hold a team row on, under DD-024's own upload rule. The Generation keeps its copy and records where it was Filed. A Generation may be Filed to several records; each Filing is one Document.
  - ~~**Generation bypasses the Inbox.**~~ No Request is created. A generated Contract without a Legal Owner appears on the Inbox's Unassigned contracts tab (ADO-006). The Contract's Activity feed opens with `contract.created` naming the Auto-Doc and the Generation.
- **Rationale** — The target shape is one the team already reads. Creating the Contract in the Generation's transaction means no Contract can exist without the Generation that explains it. Keeping standalone outputs off the Document model spares a one-shot letter version chains and folders it never needs. Filing afterwards is how a board resolution reaches "Q4 2026 board meeting" without Legal predicting it at design time.
- **Alternatives considered** — Always create a Contract: a letter is not a Contract. A "creates a Contract" flag with the Type chosen at Generation: the Type's policy would be unknown when the form is designed. A Request per Generation for triage: a second record for one fact, and path 7 already gave the person their document.
- **Consequences** — `auto_docs.target_contract_type_id`, `title_pattern`, `fixed_entity_id`, `auto_doc_filings`. `createContract` gains an Auto-Doc creation path beside direct creation and conversion. CTR-014's first-upload-takes-primary rule is satisfied by construction.

### Built in M35/9

Target settings add an optional title pattern and fixed Entity. Publication checks every title Placeholder against the saved form. Without a pattern, the mapped title takes precedence over the Auto-Doc name. Entity answers are optional on targeted forms; a fixed Entity supplies them without a picker. Settings changes record before and after.

All nine built-in maps and attached catalog Fields carry through the shared Contract creation path. A Value map includes an explicit currency and cadence; its numeric answer is an amount in major units, converted to the currency's minor units when the Contract is created. Catalog maps carry only to Fields attached to the target Type and obey their existing validation and requiredness.

The accepted Generation saves its resolved Contract facts for retry. After Word fill succeeds, one transaction writes the draft Contract, its primary Document and Version, the Generation links, default people, and Activity. The Document holds its own stored copy, so retrying delivery cannot remove its file. A retry of a Generation that already created a Contract keeps that original Document and creates no second Contract. A failed fill or Contract transaction leaves no partial Contract.

The first Contract Activity entry names the Auto-Doc and Generation. Member+ can name a Business Owner; the shared Generation function names a generating Business User as Business Owner and adds their team row. The Portal entry point and its audience and acknowledgement checks follow in M35/11. Legal Owner assignment follows in M35/10. Filing follows in M35/12.

### Built in M35/12

A Filing copies an allowed Generation output into a fresh Document and Version 1. Word is the default when allowed; a PDF-only Generation files its PDF. The automatic Contract destination still uses Word as specified above. Existing record reach, the archive freeze, and the Portal team upload rule apply at commit. The first Member+ Filing takes an empty primary designation; Business User Filings remain supporting Documents.

Member+ may choose a Contract Type when Filing an already generated output to a new Contract. This later Filing uses the original answers and Form maps with the current target Type, Entity, Assignment, and default people validation through the shared creation path. It is separate from the one automatic Contract created at Generation: each new-Contract Filing records its own provenance, and retry never creates it again. The automatic Generation links remain unchanged.

A destination chosen on the Member generation form is saved in the acceptance transaction. Word Filing completes after fill; PDF Filing is fulfilled by the delivery worker when conversion finishes, with the saved Filing id preventing duplicate copies. Reach is checked again. A Filing failure leaves the Generation's output intact and lets the person choose a destination again. Every Filing writes `auto_doc.filed` and the ordinary `document.created` action, with generated provenance; existing upload narration is unchanged. History remains after Document erasure. Filing targets and their Activity are visible only through the reader's current destination reach.

**Trade-off:** Filing adds a destination choice after Generation. That extra step keeps output separate from record ownership and prevents an automatic Filing to an unintended record. The optional destination on the Member form avoids repeating the choice when it is already known.

## ADO-006 — Assignment rules choose the Legal Owner; an unmatched Generation waits on the Inbox as an Unassigned contract

- **Status** — Accepted
- **Date** — 2026-09-13
- **Context** — A generated Contract has no legal work waiting, but it does have an expiry to watch and CTR-004 wants one accountable person. The right person varies: our Entity A's counsel, or the lawyer for jurisdiction B. Blair, 2026-09-13: "we need to think about how the legal team member gets assigned." `contracts.manager_id` is already nullable, and SCHEMA.md already reads null as "unassigned, surfaced in triage".
- **Decision** —
  - **An Auto-Doc holds an ordered list of Assignment rules.** Each names one condition on one form field, with the ADO-002 rule grammar, and one Member+ as Legal Owner. The first matching rule wins. An optional default Legal Owner closes the list.
  - **A Generation for which no rule matches creates the Contract with no Legal Owner.** It appears on the **Inbox** under a second tab, **Unassigned contracts**, beside the Requests. Any Member+ claims it in one act, which records the existing `contract.updated` Owner change and uses the `contract.owner_assigned` notification and clears it from the tab. Assigning the Legal Owner from the Contract record clears it the same way.
  - **Until claimed**, the expiry and notice reminders that would go to the Legal Owner go to every Member+ through the generated-Contract fallback. After Claim, those term reminders go to its Legal Owner. Named Key dates retain their team and recipient settings.
  - INT-007's "the Inbox lists exactly the Requests whose fate is undecided" is amended: the Inbox lists undecided Requests and unowned generated Contracts. The glossary entry for Inbox is updated.
- **Rationale** — Rules cover the common case with no queue. The queue covers the case nobody wrote a rule for, in the one place the team already looks for work nobody owns. Nothing is silently defaulted to whoever published the template.
- **Alternatives considered** — Always the Auto-Doc's publisher: wrong for a multi-jurisdiction team. Always a queue: a click on every NDA. A Contracts list filter and a dashboard tile instead of the Inbox: hides the work from the surface built for it.
- **Consequences** — `auto_doc_assignment_rules`. The Inbox read gains a second projection over `contracts where manager_id is null and created_by_generation_id is not null`. NOT-009 adds the Generation notification.

### Implementation note (2026-09-14, M35/10)

Assignment settings are edited in place and audited. Rule ids survive edits and reordering. Save checks the latest Form; Publish and Generate check the chosen Form so a removed field cannot accidentally satisfy `is not`. A Generation saves its selected Legal Owner with its Contract facts, retaining the routing decision on retry. If the selected Owner has been archived or demoted when Generate accepts the answers, the saved Owner is null and the Contract waits in the Inbox. That first matching rule does not fall through to a different person. An Owner who becomes unavailable after acceptance is still refused by the shared Contract creation check; retry retains the accepted facts.

The existing Owner Activity is `contract.updated` with `changed.owner`; `contract.manager_set` was an incorrect name in this decision. Claim uses that same Activity and the existing assignment notification, including its self-notification exclusion. The morning round previously addressed the Owner and team without an unassigned fallback; M35/10 adds the fallback for generated Contracts' expiry and notice reminders, leaving other Contract and Key-date audiences intact.

**DES-087 addendum (2026-09-14, #874):** Assignment rules are a table inside the Settings section's Contract creation card, one row per rule as a sentence ("Jurisdiction equals United States") with the Legal Owner as its caption; Add rule and the row's pencil open one dialog. The default Legal Owner commits on pick.

## ADO-007 — Output and delivery: `.docx` and `.pdf` per Auto-Doc, on screen and by email, with Generation states

- **Status** — Accepted
- **Date** — 2026-09-13
- **Context** — DD-022 paths 7 and 9: the person receives the completed document by email, and Legal decides between `.docx`, `.pdf`, or both. TECH-010's sidecar converts Office to PDF in seconds; the `.docx` fill is in-process and fast (TECH-028).
- **Decision** —
  - **Formats are set per Auto-Doc, default both.** The `.docx` is always produced and kept; whether the person may download it is the setting. The `.pdf` is a derivation through the existing `/convert` operation.
  - **Delivery is always both on screen and by email.** The download appears on the confirmation screen as each format becomes ready. The email goes when every requested format is ready. If SMTP is unconfigured the download still works and the Generation records the email as not sent, in TECH-011's `unconfigured` sense.
  - **A Generation has a state**: `pending | ready | failed`. Answers are written at submission; the `.docx` fill runs in the request; the PDF rides the derivation pipeline. A failed Generation shows the person a plain message and is listed for Member+ with a retry.
  - **The email uses TECH-011's paired HTML and text layer**, branded like every notification: the Auto-Doc's name, the person's name, an optional per-Auto-Doc **cover note** written in Markdown and rendered through the KNW-001 allowlist, and the files attached.
- **Rationale** — A person who just filled a form should not wait on SMTP for their own document. Keeping the `.docx` always makes Filing and the Contract's primary Document possible whatever the person was allowed to download.
- **Alternatives considered** — Email only: a lost email needs a Request to Legal. A plain-text email: rejected by Blair; the layer already exists.
- **Consequences** — `auto_doc_generations.state`, `docx_file_ref`, `pdf_file_ref`, `email_sent_at`, `email_failure`. The rendition pipeline gains a Generation input beside Document Versions.

**M35/7 built addendum (#850):** Member+ opens the live form and submits its pair ids with typed answers. A changed pair or non-published Auto-Doc returns a named refusal, with answers kept in the form. Migration 0122 adds Generations and deferred checks that both versions belong to the same Auto-Doc, including after reparenting. The pending row and `auto_doc.generated` entry commit before the bounded Word fill. A complete output is stored under `auto-doc-generations/<id>/<fresh id>.docx`, DOC-012's never-overwrite key, then the Generation becomes ready. Fill failures keep their reason and no output. The confirmation and the Auto-Doc's Generations list show the person, pair, time, state, and available download. PDF, formats, email, and retry remain M35/8.

**M35/8 built addendum (#851):** Formats and the Markdown cover note are audited Auto-Doc settings. Each new Generation copies them, the answers, and the Entity names printed in the file. Later settings edits do not change that Generation's downloads or retry. Member+ can retry a failed Generation from its list. Retry keeps the saved pair and answers, increments the attempt, and writes new output keys. A ready Generation cannot be retried.

The Word download appears after fill when its saved formats allow Word. The delivery worker produces the PDF through `DocEngine.convertToPdf`, then sends the requested attachments through the resolved mailer. Email state is `pending`, `sent`, `failed`, or `unconfigured`, with a sent time or controlled failure detail. Unconfigured SMTP leaves the Generation ready and displays the not-sent reason. A terminal or exhausted PDF or email failure makes it failed and retryable. Duplicate jobs lock the Generation before email and skip a recorded outcome. As with other SMTP delivery, an acceptance by the relay followed by a database failure can cause a duplicate on recovery.

Migration 0123 preserves older Word-only Generations with `formats = docx` and `email_state = not_requested`. It adds checks for the requested ready files and the email outcome. New submissions explicitly request email and copy today's formats, whose Auto-Doc default is both. The boot and scheduled recovery sweeps requeue saved work. A pending fill with no Word output after five minutes becomes failed so Legal can retry an interrupted request.

**ADO-012 addendum (2026-09-14, #873):** The kept `.docx`, the derived `.pdf`, and the saved answers behind them are content, so Administrator erasure removes them with the Auto-Doc. The delivery worker, the PDF conversion, and retry take the Generation's row lock before they write, so a job queued before the erasure completes without recreating a file. The email already sent is outside this system and cannot be recalled.

## ADO-008 — Acknowledgement before use, by Business Users, at a configurable frequency

- **Status** — Accepted
- **Date** — 2026-09-13
- **Context** — DD-022 path 13: Legal may require Business Users to acknowledge something — for example that they will not edit the generated document — before using an Auto-Doc, once or every time. No acknowledgement concept exists anywhere in OpenLaw.
- **Decision** —
  - **The acknowledgement text has an org-wide default** in Auto-Docs settings and **may be overridden per Auto-Doc**. An Auto-Doc may also require no acknowledgement.
  - **Business Users must acknowledge; Member+ never do.**
  - **Frequency is a per-Auto-Doc setting** with three acknowledgement schedules (plus `none` to disable it): `every_use`, `once_per_auto_doc` (per person), `once` (per person, org-wide). Default `once_per_auto_doc`.
  - **Editing the text resets** every standing acknowledgement of it: the person agreed to different words.
  - **Every acknowledgement is an Activity entry** with the exact text shown, the Auto-Doc, and the person, at `admin_only` visibility, and a row that the frequency check reads.
- **Rationale** — A single text with per-template override is the configurable-with-seeded-default pattern this repo prefers. Recording the words shown is what makes the acknowledgement worth anything later.
- **Alternatives considered** — One global text and frequency: too coarse for "you may not edit this" beside "this is a template, not advice". A checkbox with no record: not an acknowledgement.
- **Consequences** — `auto_doc_acknowledgements`; `auto_docs.acknowledgement_text`, `acknowledgement_frequency`; `org_settings.auto_doc_acknowledgement_text`. The Activity verb `auto_doc.acknowledged`.

**M35/11 built addendum (#854):** Portal audience is rechecked for the published list, acknowledgement, form, acceptance, owned history and downloads. Every-use acknowledgements are consumed atomically with acceptance; rejected submissions do not consume them. Text edits revoke earlier matching Acknowledgements, so restoring old text still requires a new acknowledgement. Member+ bypasses acknowledgement. Existing Generations remain readable after Unpublish or Archive as ADO-010 requires, while audience revocation removes access. An Entity fixed for a targeted Auto-Doc must remain Portal-listed, live and non-Confidential for Business User use; Legal sees the specific configuration warning and the Portal asks the person to contact Legal. Saved Assignment rules that name fields absent from the Live Form receive the same author warning and Portal refusal.

### UX revision (2026-09-14): organisation acknowledgement frequency

This supersedes ADO-008's per-Auto-Doc frequency setting and DES-087's Frequency control. Administrators set one frequency in Settings → Auto-Docs, applying to existing and future Auto-Docs. The schedules remain none, every generation, once per person for each Auto-Doc, and once per person across all Auto-Docs. Each distinct statement still needs its own acknowledgement, and a text change invalidates agreements to the old words. Individual records retain their optional custom acknowledgement text.

Migration 0132 moves frequency from `auto_docs` to `org_settings.auto_doc_acknowledgement_frequency`, initially once per person for each Auto-Doc. The settings API audits frequency changes; record edits cannot override the organisation policy. Generation acceptance checks the current policy while holding the organisation settings lock.

## ADO-009 — Reach: Legal only, selected people and Departments, or everyone; the Portal lists an Auto-Doc and the person's own Generations

- **Status** — Accepted
- **Date** — 2026-09-13
- **Context** — DD-022 path 6: Legal decides whether an Auto-Doc reaches the Portal. Blair: the choices are Legal only, some users, everyone, and "some users" must be able to name whole departments. No department exists on the user record today (SET-010 adds it).
- **Decision** —
  - **Audience is one of three**: `legal_only`, `selected`, `everyone`. Under `selected`, an allowlist names users and Departments (SET-010); a person reaches the Auto-Doc if named directly or by their Department. Email domains are not an allowlist term.
  - **Member+ reach every Auto-Doc in the app** regardless of audience. Audience governs the Portal only.
  - **A published Auto-Doc the person reaches appears in the Portal's Auto-Docs destination.** A draft or archived one never does; an unpublished one leaves at once (ADO-010).
  - **The Portal also lists the person's own Generations**, with re-download of the output and **Generate again from these answers**, which opens a new form pre-filled. A Generation that created a Contract says so and links to it; its own output stays downloadable, labelled as generated. The Contract, reached through Your Contracts, shows the primary Document as it stands now. Both are listed; neither hides the other, because the two files are never the same file after the first edit.
- **Rationale** — The account executive who wants an NDA today is one person, not all of Finance; the allowlist reaches them without opening the template to everyone. Listing Generations beside Contracts keeps "what I asked for" separate from "what the paper became".
- **Alternatives considered** — Audience flag alone (KNW-004's shape): cannot say "Sales only". Hiding a Generation once it became a Contract: hides the frozen original the person may need.
- **Consequences** — `auto_docs.audience`; `auto_doc_audience_users`, `auto_doc_audience_departments`. Portal routes for the destination, one form, one confirmation, and the person's Generations. Every Portal read re-checks audience and lifecycle, in the M20/5 style.

## ADO-010 — Lifecycle: draft, published, archived; transitions never lose form work and never surprise a person mid-form

- **Status** — Accepted
- **Date** — 2026-09-13
- **Context** — Blair (2026-09-13): going back from published to draft must pull the Auto-Doc from the Portal without losing the form work, and transitions must be careful about people already on the form. KNW-002 gives the shape; ADO-004 gives the two chains.
- **Decision** —
  - **States are `draft | published | archived`.** Member+ create, edit, Publish, Unpublish, Archive, and Restore. Each lifecycle act is its own audited route and verb, as KNW-002's built addendum did for Knowledge. No approval gate: trust the author, audit is the accountability.
  - **Unpublish clears the live pair and touches neither chain.** Every file Version and every form version remain. The Auto-Doc leaves the Portal picker on the next read. A Business User already on the form meets a named refusal on submit, answers kept on screen, the M20/4 pattern for an archived request type. Past Generations stay in the person's Portal list and in the app.
  - **Archive** does what Unpublish does and also hides the Auto-Doc from the app's default list. Every Generation stays readable and Fileable. Restore returns to `draft`.
  - **Publish of a new pair while a person is mid-form** is met by ADO-004's changed-pair refusal.
  - **The Auto-Docs list is flat**: search, and filters on state, audience, and target Type. No folders.
- **Rationale** — Two chains that keep everything is what makes Unpublish safe; the Portal gate reading state on every request is what makes it immediate. Ten to thirty Auto-Docs do not need a tree.
- **Alternatives considered** — Administrator-only Publish, or a named approver: a queue between a 2-to-10-person team and its own templates. Folders (KNW-003): copy later if a list ever hurts.
- **Consequences** — `auto_docs.state`, `published_at`, `archived_at`. Verbs `auto_doc.created`, `auto_doc.published`, `auto_doc.unpublished`, `auto_doc.archived`, `auto_doc.restored`, `auto_doc.generated`, `auto_doc.filed`, `auto_doc.acknowledged`.

**M35/13 reconciliation (2026-09-14, #856):** ADO-005's earlier Inbox-bypass wording is superseded by the Unassigned contracts tab built in M35/10 (#853). No Request is created. ADO-009's lifecycle check distinguishes new use from owned history: Unpublish and Archive stop new Generations while preserving historical reads and Filing under current audience reach, as ADO-010 requires. Assignment configuration warnings appear for Legal-only Auto-Docs too. A failed Generation retains its saved Filing destination for retry but no longer presents the Filing as pending.

**ADO-012 addendum (2026-09-14, #873):** Archive is retention. It hides the Auto-Doc and keeps every Generation readable, which is what makes it safe and what makes it the wrong answer to an erasure request. ADO-012 adds a fourth act beside Unpublish, Archive, and Restore: an Administrator-only erasure that removes the record and its content outright, reaches an archived Auto-Doc, and leaves created Contracts and Filed Documents standing on their own records.

## ADO-011 — Signature: a Generation is download-only; the created Contract takes the ordinary pipeline

- **Status** — Accepted
- **Date** — 2026-09-13
- **Context** — DD-022 asked whether a generated document enters the signature flow (CTR-013) or is download-only.
- **Decision** — **Download-only at Generation.** The created Contract is in `draft` and moves through review, approval, and signature by the ordinary CTR-001 pipeline and CTR-013's Envelope or manual hand-off, when Legal decides. Because the generating Business User is on the team (ADO-005, DD-023), the Portal already shows them the Contract and its stage moves. No new signature surface is built.
- **Rationale** — Legal keeps control of when paper leaves the building. Everything a Business User needs to see afterwards, DD-023 already shows them.
- **Alternatives considered** — Send for signature from the confirmation screen: hands a Business User an act CTR-013 reserves for Member+.
- **Consequences** — None beyond ADO-005. CTR-013 is unchanged.

## ADO-012 — Erasure: an Administrator deletes an Auto-Doc outright; independent records keep a content-free origin

- **Status** — Accepted
- **Date** — 2026-09-14
- **Context** — The review of #872 found that an Auto-Doc's content could not reach DOC-010 permanent erasure. The generic Administrator Document delete refuses an Auto-Doc owner with 409 and says "Manage this template through its Auto-Doc.", and the Auto-Doc itself offered only ADO-010's Unpublish, Archive, and Restore. All three are retention: the source file, its extracted text and renditions, every saved answer, and every generated output stay. Archive is not erasure. A release that holds a Business User's typed answers with no way to remove them cannot answer a lawful erasure request, so this blocked M34.
- **Decision** —
  - **Erasure is its own Administrator-only act**, not a widening of an existing one. `DELETE /api/v1/auto-docs/:id` takes the typed word `delete` and the Auto-Doc's current name. The route checks both, in DOC-010's sense that the ceremony is a server rule and not a dialog's manners; a name that no longer matches is refused with 409 so a rename cannot be erased by a stale screen. Member+ cannot reach the route, and neither can a Business User.
  - **It reaches an archived Auto-Doc.** Erasure is compelled from outside the record, so a frozen record is not a place to hide from it. This is DOC-010's rule for a document on an archived Contract, applied here.
  - **It destroys the Auto-Doc's own content.** The template Document and every file Version, the extracted text, renditions, and Comparisons those Versions carry, every form version, the audience rows, the Assignment rules, the Acknowledgements, every Generation with its saved answers and display values, the Filing rows, and every stored blob behind any of them.
  - **Created Contracts and Filed Documents survive.** They are independent records with their own paper, their own teams, and their own history. A Contract that reached signature does not disappear because Legal removed the template that started it.
  - **A content-free origin row carries their provenance.** `auto_doc_generation_origins` holds Generation ids and nothing else. A Contract's `created_by_generation_id` and a generated Version's `generated_from_generation_id` point at that table instead of at the Generation. Erasure removes the Generation and leaves the origin, so the generated Version CHECK still holds and the record still says it was generated, while nothing that says what was generated remains. A Contract's pointer clears on erasure; a Version keeps its id.
  - **Copies that already left are erased separately.** A Filed Document on a Matter or a Contract is that record's paper. An Administrator answering an erasure request removes it through DOC-010 on its own record. The dialog says so rather than implying one act is enough.
  - **Ordering is DOC-010's.** The route locks the Auto-Doc, its Generations, and its template Versions, reads every blob reference, writes the audited entry, deletes the rows, and destroys the blobs inside the same transaction before the commit. A storage failure rolls every row back, and the retry converges because deleting a key that is already gone succeeds (DOC-012).
  - **Queued work cannot outlive the erasure.** PDF conversion, email delivery, retry, and Filing take the Generation's row lock before they write anything. A job that wakes after the erasure finds no row and does nothing, so no worker can put a blob back after the files are gone.
  - **One audited entry, `auto_doc.hard_deleted`**, carries the Generation count and the Version count. It names no answer, no filename, and no file content.
- **Rationale** — Erasure and retention are different acts and a person must be able to tell which one they are about to perform, so Archive keeps its meaning and erasure gets its own verb, its own confirmation, and its own refusals. Provenance is the hard part: a Contract that names its Generation through a restrictive foreign key either blocks the erasure or is destroyed by it, and both are wrong. Splitting the identity from the content lets the id survive as a fact while everything it described is removed.
- **Alternatives considered** — Widen the generic Document hard delete to accept an Auto-Doc owner: it erases the template and leaves every Generation and every saved answer behind, which is the gap this record closes. Cascade the erasure into created Contracts: an executed Contract is destroyed because a template was removed. Rewrite a generated Version's `source` to `uploaded`: the record then states something untrue about where the paper came from, and the change is silent.
- **Consequences** — Migration 0129 adds `auto_doc_generation_origins`, backfills it from the existing Generations, and repoints the two provenance foreign keys. `apps/api/src/lib/document-erasure.ts` holds the blob collection both erasure paths share. The Auto-Doc record's sub-bar shows Delete Auto-Doc to an Administrator only. ADO-004, ADO-007, and ADO-010 gain the exception this act makes to what they promise is kept.

**Built addendum (2026-09-14, #873):** The delivery worker now writes the PDF reference inside the transaction that holds the Generation lock, where it previously stored the blob first and updated the row afterwards, so an erasure between the two steps can no longer leave an orphaned file. The display-conversion and comparison pipelines take the same lock for the same reason. `auto_doc_filings.document_id` already cleared on Document erasure, so a Filed Document erased on its own record leaves its Filing history intact.

## Index of decisions

| #       | Decision                                                                                                | Status   |
| ------- | ------------------------------------------------------------------------------------------------------- | -------- |
| ADO-001 | Module identity: an Auto-Doc is its own record, in its own destination, with a Portal surface           | Accepted |
| ADO-002 | Placeholders, Blocks, and Clause rules: double braces in Word, rules in the editor                      | Accepted |
| ADO-003 | Form fields belong to the Auto-Doc and may map to catalog Fields and Contract attributes                | Accepted |
| ADO-004 | Two chains, one live pair: the file versions, the form versions, and Publish pins them                  | Accepted |
| ADO-005 | Destinations: a Contract Type target creates a draft Contract; anything can be Filed afterwards         | Accepted |
| ADO-006 | Assignment rules choose the Legal Owner; an unmatched Generation waits on the Inbox as Unassigned       | Accepted |
| ADO-007 | Output and delivery: `.docx` and `.pdf` per Auto-Doc, on screen and by email, with Generation states    | Accepted |
| ADO-008 | Acknowledgement before use, by Business Users, at a configurable frequency                              | Accepted |
| ADO-009 | Reach: Legal only, selected people and Departments, or everyone; the Portal lists Auto-Docs and outputs | Accepted |
| ADO-010 | Lifecycle: draft, published, archived; transitions never lose form work or surprise a person mid-form   | Accepted |
| ADO-011 | Signature: a Generation is download-only; the created Contract takes the ordinary pipeline              | Accepted |
| ADO-012 | Erasure: an Administrator deletes an Auto-Doc outright; independent records keep a content-free origin  | Accepted |
