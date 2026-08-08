# Contract details — grill-me plan

Tracking document for grilling every element on `designs/initial-contract-details.pen` frames `GJVDs` (V12) and `WdR49` (V13). The full inventory of elements lives in `CONTRACT-DETAILS-INVENTORY.md` — this document is the decision log.

## How to use

For each row:

1. Open the inventory entry it points at (region letter + element number).
2. Run a grill-me session with the user: defend the element, decide **keep / change / remove / park**.
3. Fill in **Decision** (one line) and link to a follow-up DD-### if a new feature decision was opened.
4. Set **Status** to `done` once the row is locked.

Status values:

- `pending` — not yet discussed
- `in-grill` — actively being discussed
- `done` — decision recorded; no further action
- `parked` — deferred, with an explicit reason and a trigger to revisit
- `blocked` — depends on another row or an external decision

A row whose Decision is `change` should also list the change either inline (one short sentence) or as "see DD-### / see follow-up #N" if it's bigger than a sentence.

## Context sweep — 2026-08-02

All 122 rows were swept against `DECISIONS.md` (DD-001–017), `DECISIONS-DESIGN.md` (DES-001–015), `MTR-001`, `TECH-001`, and `SCHEMA.md`. Results:

- **10 rows pre-closed** (`done`) — the existing decision answers them outright; citation in the Decision column.
- **21 rows `blocked`** — they depend on module decisions that have **not been made**: `DECISIONS-CONTRACTS.md`, `DECISIONS-DOCUMENTS.md`, and `DECISIONS-SETTINGS.md` all have zero recorded decisions, and the notifications-surface and comment-UI feature DDs flagged in `DECISIONS-DESIGN.md` were never opened.
- **Remaining rows stay `pending`**, many with new citations narrowing them.

Dependency picture (biggest first):

1. **Contracts module grill (CTR-###)** — **DONE 2026-08-04** (CTR-001–019). All 14 gated rows resolved: lifecycle/status (C.5, D.8, H.C4), renewal/term model (G.R3, G.R5–R7, I.B2–B5, I.B7), e-signature (E.5), clauses/redlines (F.3), plus D.1/D.2/D.6/D.7/C.3/G.R2 along the way.
2. **Documents module grill (DOC-###)** — **DONE 2026-08-04** (DOC-001–011). Doc-panel gates resolved: versioning (K.H3), redline strategy (K.H4), preview rendering (K.B1–17).
3. **Notifications feature DD** — **DONE 2026-08-05** (`DECISIONS-NOTIFICATIONS.md`, NOT-001–005). A.4 resolved; E.1 narrowed.
4. **Comment-surface feature DD** — **DONE 2026-08-05** (`DECISIONS-COMMENTS.md`, CMT-001–005). K.B9/J.2 resolved; E.6/F.7 removed.
5. **Settings grill** — **DONE 2026-08-05** (SET-001–004). J.9 resolved.

Two mock-vs-decision **conflicts** found: B.6 (Reports nav item vs DD-005's deferral of reporting-as-destination) and the V13 right column (48px bar + 392px panel vs DES-007's single 320px `--width-rail`) — see B.6 and J.X. Also: the V13 doc panel is the screen DES-006 was waiting for to pick the secondary legal-document typeface — that deferred question is now unblocked.

## Recommended order

The grill flows top-of-screen down so each decision feeds the next. Suggested batches:

1. **Batch 1 — Chrome (rows A.1–C.8).** Header, nav, sub-bar. These cascade into every screen, so lock them first.
2. **Batch 2 — Hero (D.1–D.8).** What metadata earns a top-of-page slot.
3. **Batch 3 — Module chips (E.1–E.7).** Decide whether chips stay at all (vs. activity bar in J).
4. **Batch 4 — Section tabs (F.1–F.11).** What tabs belong, in what order, with what labels.
5. **Batch 5 — Description card (G.\*).** Each row is a contract-data field decision — likely the longest batch.
6. **Batch 6 — Events card (H.\*).** Column shape, decision visualization, mock-data sanity check.
7. **Batch 7 — Timeframe card (I.\*).** Visualization choices and the risk-threshold concept.
8. **Batch 8 — Activity bar (J.0–J.9).** Slot count, glyphs, badges. Likely opens a feature DD.
9. **Batch 9 — Doc panel (K.\*).** Header chrome, toolbar density, comment-marker UX.
10. **Batch 10 — Cross-cutting (X.\*).** Sweep up the divergences between V12 and V13.

Post-sweep note: **THE PLAN IS COMPLETE (2026-08-06)** — all 122 rows are `done`. The screen-batch pass auto-resolved rows already answered by the decision layer and grilled the four open design decisions, which landed as **DES-016** (VS Code-style activity bar; chip row removed; DES-007 amended) and **DES-017** (per-field inline commit; no Save/Cancel chrome), plus wordmark-only logo / no card icons, and the 5-tab section set (Description · Documents · Key dates · Signatories · Tasks, with Key clauses and the Term timeline as Description cards).

**Follow-up:** apply the recorded verdicts to `designs/initial-contract-details.pen` (delete chip row, C.2/C.4/C.6/C.7, card icons, removed tabs; retitle Events → Approvals & signing; converge V12/V13 into the one responsive screen with the canonical C-42 sample data per X.9). That's a Pencil editing session, not a decision session.

---

## A. Top header

| ID  | Element                    | Where | Status | Decision                                                                                                                                                                         | Notes |
| --- | -------------------------- | ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| A.1 | App logo                   | Both  | done   | keep — wordmark only, no glyph (DD-012 rename trigger argues against glyph investment now)                                                                                       |       |
| A.2 | Global search              | Both  | done   | keep — global scope per DD-005; placeholder lists module names ("Search matters, contracts, documents…"), final copy at build per DES-015                                        |       |
| A.3 | Create button              | Both  | done   | keep — Member+ menu: New matter, New contract, New entity, New knowledge item, Upload document (owner picker per DOC-008). Requests come via the portal (INT-001), not this menu |       |
| A.4 | Notifications bell + badge | Both  | done   | keep — staff notification center per NOT-001; unread count badge capped 9+, read-on-open per NOT-005                                                                             |       |
| A.5 | User avatar                | Both  | done   | keep — menu: Profile, Appearance, Notification preferences (SET-001 Personal), Settings (Admin org sections), Sign out                                                           |       |

## B. Primary nav

| ID  | Element                        | Where    | Status | Decision                                                                                                                                                                            | Notes                                                     |
| --- | ------------------------------ | -------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| B.1 | First slot: Inbox vs Dashboard | Diverges | done   | keep **Inbox** — the single triage queue per INT-006/DD-018 (nav slot 1)                                                                                                            |                                                           |
| B.2 | Matters                        | Both     | done   | keep — mirrors the module set per DD-005                                                                                                                                            |                                                           |
| B.3 | Contracts (active)             | Both     | done   | keep — module per DD-005; active underline uses `--accent` per DES-005                                                                                                              |                                                           |
| B.4 | Documents                      | Both     | done   | keep — Documents is a first-class destination per DD-007                                                                                                                            | Tension with the Documents module-chip is handled in E.4. |
| B.5 | Entities                       | Both     | done   | keep — module per DD-006                                                                                                                                                            |                                                           |
| B.6 | Reports                        | Both     | done   | remove — conflicts with DD-005's deferral of reporting-as-destination (FUTURE-FEATURES entry exists); nav = Inbox, Matters, Contracts, Documents, Entities (+ Knowledge when built) |                                                           |

## C. Module sub-bar

| ID     | Element                   | Where | Status | Decision                                                                                                                                       | Notes                                               |
| ------ | ------------------------- | ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| C.1    | Back/up arrow             | Both  | done   | keep — back arrow returns to the module list; no breadcrumb pattern in v1 (none exists in DES; contract hierarchy renders in-page per CTR-015) |                                                     |
| C.2a–c | Module switcher icons (3) | Both  | done   | remove — purpose undefined; no decision backs them (mock cruft)                                                                                |                                                     |
| C.3    | Title pill                | Both  | done   | keep — free-text title per CTR-003, editable (interaction pattern — inline vs modal — is a screen-batch call)                                  |                                                     |
| C.4    | Inline action icon        | Both  | done   | remove — undefined; title edit is the C.3 affordance                                                                                           |                                                     |
| C.5    | Status pill               | Both  | done   | keep — shows the configurable **status** label per CTR-001; single stored field (`status_id`), stage derived                                   | Pill family mapping (DES-005) still to pick in X.2. |
| C.6    | Cancel button             | Both  | done   | remove — per-field inline commit per DES-017; no page edit mode                                                                                |                                                     |
| C.7    | Save button               | Both  | done   | remove — per DES-017 (Esc reverts the in-progress field edit)                                                                                  |                                                     |
| C.8    | Overflow / more           | Both  | done   | keep — menu: Toggle confidential (DD-014), Link/unlink matter (MTR-007), Archive (CTR-019), Delete permanently (Admin, DOC-010 pattern)        |                                                     |

## D. Hero meta grid

| ID  | Field             | Where    | Status | Decision                                                                                                                                                     | Notes                   |
| --- | ----------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| D.1 | Reference         | Both     | done   | keep — renders `C-###` global sequence number per CTR-003; read-only                                                                                         |                         |
| D.2 | Contract type     | Both     | done   | keep — configurable `contract_types` per CTR-002 (MTR-001 mirror; type = policy carrier)                                                                     |                         |
| D.3 | Effective date    | Both     | done   | keep — UTC storage + `formatShortDate` display per DES-014                                                                                                   |                         |
| D.4 | Subject matter    | Both     | done   | change — becomes **Matter** (renders the MTR-007 linked matter or "—"); no subject_matter column exists in the CTR schema and title covers the free-text job |                         |
| D.5 | Counterparty      | Both     | done   | keep — backed by `counterparties` table per DD-008; value links to the counterparty record (both frames get the link affordance)                             |                         |
| D.6 | Contract value    | Both     | done   | keep — `value_amount` + `value_currency` + `value_cadence` per CTR-010; "/year" suffix renders the cadence                                                   | Formatting per DES-014. |
| D.7 | Owner field shape | Diverges | done   | keep — name only (V13) backed by `contracts.manager_id` per CTR-004; label "Owner"                                                                           |                         |
| D.8 | Stage             | Both     | done   | keep — renders the derived **stage** (6-step pipeline per CTR-001), same datum as C.5 at coarser zoom; not a separate stored field                           |                         |

## E. Module chip row

| ID  | Chip                             | Where | Status | Decision                                                                                                               | Notes |
| --- | -------------------------------- | ----- | ------ | ---------------------------------------------------------------------------------------------------------------------- | ----- |
| E.0 | Should the chip row exist at all | Both  | done   | remove — chip row deleted; the DES-016 activity bar is the single right-side system                                    |       |
| E.1 | Notifications chip               | Both  | done   | remove — per-record notifications aren't a NOT-002 concept; the global bell (A.4) is the surface                       |       |
| E.2 | Workflows chip                   | Both  | done   | remove — no "workflow" concept in v1; approvals render in the Approvals card (H) per CTR-012                           |       |
| E.3 | Linked files chip                | Both  | done   | remove — row deleted per E.0; loose attachments render in the Documents tab (CTR-014)                                  |       |
| E.4 | Documents chip                   | Both  | done   | remove — row deleted per E.0; Documents is a section tab (F set)                                                       |       |
| E.5 | Signature elements chip          | V12   | done   | keep (conditional) — renders envelope status per CTR-013 when an envelope exists; hidden for manual hand-off contracts |       |
| E.6 | Conversation chip                | V12   | done   | remove — redundant with the activity-bar comment panel per CMT-004                                                     |       |
| E.7 | "+ 2 more" overflow              | V13   | done   | remove — row deleted per E.0                                                                                           |       |

## F. Section tab strip

| ID   | Tab                             | Where    | Status | Decision                                                                                                                    | Notes                                   |
| ---- | ------------------------------- | -------- | ------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| F.0  | Tab strip vs. anchored sections | Both     | done   | keep tabs — final set of 5: Description · Documents · Key dates · Signatories · Tasks                                       |                                         |
| F.1  | Description (active)            | Both     | done   | keep — the primary section (hosts the G card + contracts.description long-form context)                                     |                                         |
| F.2  | Key dates                       | Both     | done   | keep — its own tab (term dates + contract_key_dates per CTR-006/009)                                                        |                                         |
| F.3  | Key clauses                     | Both     | done   | change — renders as a **card inside Description** (not a tab); content = CTR-008/CTR-014 extracted fields                   | Unverified-badge treatment per CTR-008. |
| F.4  | Signatories (label)             | Diverges | done   | keep — label "Signatories" (V13; DES-015 concision); content = envelope signers (CTR-013) + counterparty contacts (CTR-011) |                                         |
| F.5  | Considerations                  | Both     | done   | remove — undefined concept; nothing in the decision layer backs it                                                          |                                         |
| F.6  | Memo                            | Both     | done   | remove — long-form context lives as `contracts.description` in the Description section; ad-hoc notes are comments (CMT)     |                                         |
| F.7  | Communications                  | Both     | done   | remove — comments live in the rail panel per CMT-004, not a tab                                                             |                                         |
| F.8  | Risks & issues                  | Both     | done   | remove — risk mgmt deferred (DD-005); the contract-level datum is the G.R2 risk field per CTR-005                           |                                         |
| F.9  | Deliverables                    | Both     | done   | change — becomes **Tasks** (renders `contract_tasks` per CTR-017); "deliverables" undefined otherwise                       |                                         |
| F.10 | History                         | Both     | done   | remove — the DD-017 activity feed lives in the rail (J.3), symmetric with comments (CMT-004); not a tab                     |                                         |
| F.11 | Overflow chevron                | V12      | done   | remove — surviving section count (~5) fits without overflow                                                                 |                                         |

## G. Description card

All G field rows are contract-schema decisions — the `contracts` schema is TBD in `SCHEMA.md`, so outcomes here should land as CTR decisions.

### G.left

| ID   | Field         | Where | Status | Decision                                                                                                                     | Notes |
| ---- | ------------- | ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------- | ----- |
| G.L1 | Country       | Both  | done   | remove — location lives on the counterparty record (CTR-011 address/jurisdiction)                                            |       |
| G.L2 | Region        | Both  | done   | remove — same call as G.L1                                                                                                   |       |
| G.L3 | City          | V12   | done   | remove — same call as G.L1                                                                                                   |       |
| G.L4 | Governing law | Both  | done   | keep — seeded contract-scoped catalog field `governing_law` with default AI prompt (CTR-008's named core field)              |       |
| G.L5 | Jurisdiction  | Both  | done   | keep — seeded catalog field `jurisdiction` (forum/venue; legally distinct from governing law), default AI prompt per CTR-008 |       |
| G.L6 | Practice area | Both  | done   | remove — duplicates contract type (CTR-002); orgs wanting it add a custom field                                              |       |
| G.L7 | Created       | Both  | done   | keep — `formatShortDate` per DES-014; "by Sarah Chen" backed by the activity model per DD-017                                |       |

### G.right

| ID   | Field          | Where | Status | Decision                                                                                                                              | Notes                                                   |
| ---- | -------------- | ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| G.R1 | Our position   | Both  | done   | keep — seeded contract-scoped `single_select` catalog field `our_position` (customer \| provider \| other), AI-promptable per CTR-008 |                                                         |
| G.R2 | Risk level     | Both  | done   | keep — first-class `contracts.risk` per CTR-005 (nullable = not yet assessed)                                                         | Visualization still X.2 (DES-005 pill family).          |
| G.R3 | Auto-renew     | Both  | done   | keep — renders `term_type` per CTR-006 (auto-renew / fixed / evergreen)                                                               |                                                         |
| G.R4 | Notice period  | Both  | done   | keep — `notice_period_days` per CTR-006; renders "90 days"                                                                            |                                                         |
| G.R5 | Last renewal   | V12   | done   | keep — last _confirmed_ renewal event from activity_log per CTR-006/007                                                               | X.6 empty-state rule still applies when no renewal yet. |
| G.R6 | Renewal cap    | Both  | done   | remove — no renewal-cap field in the CTR-006 model (term-ledger option rejected)                                                      |                                                         |
| G.R7 | Days remaining | Both  | done   | keep — derived `expiry_date − today` per CTR-006; blank for evergreen                                                                 |                                                         |

### G.header

| ID   | Element       | Where | Status | Decision                                                                          | Notes |
| ---- | ------------- | ----- | ------ | --------------------------------------------------------------------------------- | ----- |
| G.H1 | Section icon  | V12   | done   | remove — no card-leading icons (X.1: V13 style wins)                              |       |
| G.H2 | Title         | Both  | done   | keep — "Description"                                                              |       |
| G.H3 | Overflow icon | Both  | done   | remove — no per-card menu in v1; record actions live in C.8, field edit is inline |       |

## H. Events card

| ID     | Element                 | Where    | Status | Decision                                                                                                                                                                                   | Notes                                 |
| ------ | ----------------------- | -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| H.H1   | Section icon            | V12      | done   | remove — per X.1                                                                                                                                                                           |                                       |
| H.H2   | Title                   | Both     | done   | change — card becomes **"Approvals & signing"**: auto-derived rows from `contract_approvals` (CTR-012), envelope events (CTR-013), confirmed renewals (CTR-006). No manual event authoring |                                       |
| H.H3   | Count chip "7"          | Both     | done   | keep — neutral counter badge per DES-005 `--badge-count-*`                                                                                                                                 |                                       |
| H.H4   | "+ Add event"           | Both     | done   | remove — manual events would fork the DD-017 activity feed (the flagged parallel-timeline risk); card is auto-derived only                                                                 |                                       |
| H.C1   | Date column             | Both     | done   | keep — event date, `formatShortDate` per DES-014                                                                                                                                           |                                       |
| H.C2   | Event name column       | Both     | done   | keep — derived label linking to its source (approval request, envelope, renewal confirmation); never free text                                                                             |                                       |
| H.C3   | Type column label       | Diverges | done   | remove — event kind is implicit in the derived label; column dropped                                                                                                                       |                                       |
| H.C4   | Decision column         | Both     | done   | keep — renders `contract_approvals` outcomes (approved / rejected / pending + note) per CTR-012                                                                                            | Pill vs text is H.X1 (pills favored). |
| H.C5   | Comment column          | Both     | done   | keep — renders the approver's decision `note` (CTR-012, optional) / envelope decline reason; "—" otherwise                                                                                 |                                       |
| H.C6   | Attachments/Files label | Diverges | done   | keep — label "Files" (concision per DES-015); e.g. the executed file on a signed-envelope row                                                                                              |                                       |
| H.R1–7 | Mock data sanity        | Diverges | done   | change — regenerate rows from the X.9 canonical sample when mocks are edited                                                                                                               |                                       |
| H.X1   | Decision pill vs. text  | Diverges | done   | keep pills (V13) — DES-005 paired status-pill families; mapping per X.2                                                                                                                    |                                       |

## I. Timeframe card

| ID   | Element                            | Where    | Status | Decision                                                                                                                                           | Notes |
| ---- | ---------------------------------- | -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| I.H1 | Section icon                       | V12      | done   | remove — per X.1                                                                                                                                   |       |
| I.H2 | Title                              | Both     | done   | keep — title "Term" (renders the CTR-006 term timeline)                                                                                            |       |
| I.H3 | Zoom switcher (Year/Quarter/Month) | Both     | done   | remove — single fit-to-term view in v1; zoom machinery unearned for a bar that spans one contract's life                                           |       |
| I.X1 | Label placement: on-bar vs. gutter | Diverges | done   | keep gutter (V13) — survives narrow containers per DES-012/X.4                                                                                     |       |
| I.B1 | Effective date marker              | Both     | done   | keep — `effective_date` per CTR-006                                                                                                                |       |
| I.B2 | Term 1 bar                         | Both     | done   | keep — initial term: `effective_date → expiry_date` (as of first term) per CTR-006                                                                 |       |
| I.B3 | Term 2 bar                         | Both     | done   | keep — one bar per confirmed renewal event (activity_log per CTR-006)                                                                              |       |
| I.B4 | Term 3 bar                         | Both     | done   | keep — bar count = confirmed renewals + 1; renewals routed to amendment/child/new contracts (CTR-007) render on those records, not extra bars here |       |
| I.B5 | Last renewal marker                | V12      | done   | keep — same datum as G.R5                                                                                                                          |       |
| I.B6 | End of contract                    | Both     | done   | keep — `expiry_date` per CTR-006; absent for evergreen                                                                                             |       |
| I.B7 | Renewal cap                        | Both     | done   | remove — same call as G.R6 (no cap field)                                                                                                          |       |
| I.B8 | Risk threshold marker              | Both     | done   | remove — undefined concept; the real threshold datum is the derived notice deadline, which gets its own marker per CTR-006                         |       |
| I.X2 | Today line + pill                  | Both     | done   | keep — plus a **notice-deadline marker** (derived, CTR-006) joins the timeline                                                                     |       |
| I.X3 | Legend (3 swatches)                | Both     | done   | keep — swatches: initial term / renewals / markers; final copy at build per DES-015                                                                |       |

## J. Activity bar

| ID   | Slot                       | Where | Status | Decision                                                                                                                                  | Notes |
| ---- | -------------------------- | ----- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| J.0  | Active indicator strip     | V13   | done   | keep — both frames; marks the active applet per DES-016                                                                                   |       |
| J.X  | **Should the bar exist**   | Both  | done   | keep — **DES-016**: VS Code-style activity bar with page-scoped applets; DES-007 amended (`--width-activitybar` 48 + `--width-panel` 320) |       |
| J.1  | description                | Both  | done   | remove — duplicates the Description tab; applet set per DES-016 is chat, history, settings                                                |       |
| J.2  | chat (badge "3")           | Both  | done   | keep — the comment panel's home per CMT-004; badge = viewer's unread, tier-filtered (no hidden-tier leaks)                                |       |
| J.3  | history (badge "v7")       | Both  | done   | keep — the DD-017 activity-feed panel (F.10 tab removed in its favor); **no badge** (history isn't an alert)                              |       |
| J.4  | draw / redline             | Both  | done   | remove — comparison lives in the doc panel (K.H4 per DOC-003); no separate drawing tool                                                   |       |
| J.5  | bolt / automation          | Both  | done   | remove — no automation concept in v1 (same call as E.2)                                                                                   |       |
| J.6  | track_changes (badge "42") | Both  | done   | remove — duplicates K.H4 (DOC-003 compare)                                                                                                |       |
| J.7  | attach_file                | V12   | done   | remove — upload lives on the Documents surface (DOC-011 drag-drop), not a rail tool                                                       |       |
| J.8  | divider                    | Both  | done   | keep — separates content panels (description/chat/history) from settings, meaningful after the J.4–7 removals                             |       |
| J.9  | settings                   | Both  | done   | keep — deep-link into /settings at the relevant section per SET-001 (Admin sees org sections; Members land on Personal)                   |       |
| J.X2 | Badge rules                | Both  | done   | change — only chat carries a badge (CMT-004 unread, tier-filtered); history and settings unbadged                                         |       |

## K. Document panel (V13 only)

| ID      | Element                          | Where      | Status | Decision                                                                                                                       | Notes                                                           |
| ------- | -------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| K.0     | Should V12 also have a doc panel | V12 closed | done   | keep — one responsive screen per X.4/DES-012; panel closed by default, opens at any width (main column narrows)                |                                                                 |
| K.H1    | File icon                        | V13        | done   | keep — colored-square file-type pattern per DES-008                                                                            |                                                                 |
| K.H2    | Filename                         | V13        | done   | keep — read-only in the panel header; the document `title` edits on the document record (DOC-001), version filenames immutable |                                                                 |
| K.H3    | Version pill                     | V13        | done   | keep — renders `version_number` of the viewed version per DOC-001 (linear immutable chain)                                     |                                                                 |
| K.H4    | Redlines pill                    | V13        | done   | keep — opens the DOC-003 compare view (Workshare-style); Word track-changes export is an action within                         |                                                                 |
| K.H5    | Open-in-full icon                | V13        | done   | keep — opens the document's own detail page (Documents is a first-class destination per DD-007/DOC-002)                        |                                                                 |
| K.H6    | Close icon                       | V13        | done   | keep — closes panel; reopen via the Documents section or rail                                                                  |                                                                 |
| K.T1–T9 | Toolbar density                  | V13        | done   | change — collapse to: zoom −/+, download, compare (K.H4), overflow (print, page nav, rest); final set at build                 |                                                                 |
| K.B1–17 | Doc body content                 | V13        | done   | keep — panel renders the DOC-004 set (PDF, DOCX, images, PPTX, MSG/EML); rest download-only                                    | DES-006 secondary-typeface pick now actionable on this surface. |
| K.B9    | Inline comment marker            | V13        | done   | keep — anchored comment margin marker per CMT-001; tier treatments per CMT-003                                                 |                                                                 |

## X. Cross-cutting

These rows do not map to a single element; they capture decisions that propagate across the screen.

| ID   | Topic                                                              | Status | Decision                                                                                                                                              | Notes |
| ---- | ------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| X.1  | Card-leading icons (G.H1, H.H1, I.H1)                              | done   | remove — V13 style (no icons); card titles carry identity                                                                                             |       |
| X.2  | Status visualization (G.R2, H decision col, lifecycle pills)       | done   | change — pills everywhere; value→family mapping (stages, priority, risk, approvals, envelopes, request statuses) lands as a DES addendum at build     |       |
| X.3  | Header-icon set (V12 has bell+avatar; V13 has bell+chevron+avatar) | done   | keep bell + avatar only (A.4/A.5 define exactly two affordances); V13's chevron removed                                                               |       |
| X.4  | Width target (1440 V12 vs. 1000 V13 main column)                   | done   | both — same screen at different container widths per DES-012 (content is container-responsive; opening the doc panel narrows the main column)         |       |
| X.5  | Edit-mode chrome (Cancel/Save buttons in C.6, C.7)                 | done   | change — per-field inline commit per **DES-017**; C.6/C.7 removed                                                                                     |       |
| X.6  | Empty-state for "—" fields (D.5–D.8, G.R5)                         | done   | change — schema-backed core fields always render with "—" (predictable layout, DES-003 spirit); empty custom fields hide                              |       |
| X.7  | Field-vs-tab boundary                                              | done   | change — settled with F.0: 5 tabs; Key clauses + Term timeline are cards inside Description; Risks/Deliverables/Memo/Considerations tabs removed      |       |
| X.8  | Activity-bar vs. module-chip overlap (E vs. J)                     | done   | change — activity bar wins per **DES-016**; chip row removed                                                                                          |       |
| X.9  | Mock-data parity (Events H, hero D)                                | done   | change — canonical sample: "Acme Master Services Agreement" C-42, auto-renew, defined once when mocks are next edited; both frames regenerate from it |       |
| X.10 | Internationalization sweep                                         | done   | covered by DES-013 — build-time contract (every string ICU-wrapped); not a mock/screen decision                                                       |       |
