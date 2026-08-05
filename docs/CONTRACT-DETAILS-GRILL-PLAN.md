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
5. **Settings grill (SET-###)** gates J.9.

Two mock-vs-decision **conflicts** found: B.6 (Reports nav item vs DD-005's deferral of reporting-as-destination) and the V13 right column (48px bar + 392px panel vs DES-007's single 320px `--width-rail`) — see B.6 and J.X. Also: the V13 doc panel is the screen DES-006 was waiting for to pick the secondary legal-document typeface — that deferred question is now unblocked.

## Recommended order

The grill flows top-of-screen down so each decision feeds the next. Suggested batches:

1. **Batch 1 — Chrome (rows A.1–C.8).** Header, nav, sub-bar. These cascade into every screen, so lock them first.
2. **Batch 2 — Hero (D.1–D.8).** What metadata earns a top-of-page slot.
3. **Batch 3 — Module chips (E.1–E.7).** Decide whether chips stay at all (vs. activity bar in J).
4. **Batch 4 — Section tabs (F.1–F.11).** What tabs belong, in what order, with what labels.
5. **Batch 5 — Description card (G.*).** Each row is a contract-data field decision — likely the longest batch.
6. **Batch 6 — Events card (H.*).** Column shape, decision visualization, mock-data sanity check.
7. **Batch 7 — Timeframe card (I.*).** Visualization choices and the risk-threshold concept.
8. **Batch 8 — Activity bar (J.0–J.9).** Slot count, glyphs, badges. Likely opens a feature DD.
9. **Batch 9 — Doc panel (K.*).** Header chrome, toolbar density, comment-marker UX.
10. **Batch 10 — Cross-cutting (X.*).** Sweep up the divergences between V12 and V13.

Post-sweep note: the Contracts, Documents, Intake (+DD-018), Notifications, and Comments grills are all complete as of 2026-08-05. The only remaining gate is the Settings grill (J.9); everything else is pending-by-choice in the screen batches.

---

## A. Top header

| ID | Element | Where | Status | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| A.1 | App logo | Both | pending | | Name "OpenLaw" locked by DD-012 (rename trigger documented). Open: wordmark-only vs glyph mark. |
| A.2 | Global search | Both | pending | | Scope is global cross-module per DD-005; `/` affordance locked by DES-010; copy register per DES-015. Open: placeholder scope list. |
| A.3 | Create button | Both | pending | | Menu candidates follow the module set (DD-005/006). Business Users create via intake channels (DD-010), so this is a Member+ affordance. Open: exact menu. |
| A.4 | Notifications bell + badge | Both | done | keep — staff notification center per NOT-001; unread count badge capped 9+, read-on-open per NOT-005 | |
| A.5 | User avatar | Both | pending | | Menu must reach account settings: theme (DES-001/002), timezone (DES-014), locale (DES-013). Open: full menu contents. |

## B. Primary nav

| ID | Element | Where | Status | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| B.1 | First slot: Inbox vs Dashboard | Diverges | done | keep **Inbox** — the single triage queue per INT-006/DD-018 (nav slot 1) | |
| B.2 | Matters | Both | done | keep — mirrors the module set per DD-005 | |
| B.3 | Contracts (active) | Both | done | keep — module per DD-005; active underline uses `--accent` per DES-005 | |
| B.4 | Documents | Both | done | keep — Documents is a first-class destination per DD-007 | Tension with the Documents module-chip is handled in E.4. |
| B.5 | Entities | Both | done | keep — module per DD-006 | |
| B.6 | Reports | Both | pending | | **Conflict:** DD-005 explicitly defers "Reporting/analytics as a destination" (per-module dashboards stay in scope). A Reports nav item contradicts it — recommend remove/park; confirm in grill. |

## C. Module sub-bar

| ID | Element | Where | Status | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| C.1 | Back/up arrow | Both | pending | | Standard vs. breadcrumb-only — pick one navigation pattern. |
| C.2a–c | Module switcher icons (3) | Both | pending | | **Purpose unclear** — define what these three icons do or remove them. |
| C.3 | Title pill | Both | done | keep — free-text title per CTR-003, editable (interaction pattern — inline vs modal — is a screen-batch call) | |
| C.4 | Inline action icon | Both | pending | | Single mystery icon next to title — define or remove. |
| C.5 | Status pill | Both | done | keep — shows the configurable **status** label per CTR-001; single stored field (`status_id`), stage derived | Pill family mapping (DES-005) still to pick in X.2. |
| C.6 | Cancel button | Both | pending | | See X.5. If kept, label rules per DES-015. |
| C.7 | Save button | Both | pending | | See X.5 — autosave vs explicit save is undecided anywhere in the docs. |
| C.8 | Overflow / more | Both | pending | | Define the menu items. Known candidate: confidential-flag toggle (Admin/creator only per DD-014). |

## D. Hero meta grid

| ID | Field | Where | Status | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| D.1 | Reference | Both | done | keep — renders `C-###` global sequence number per CTR-003; read-only | |
| D.2 | Contract type | Both | done | keep — configurable `contract_types` per CTR-002 (MTR-001 mirror; type = policy carrier) | |
| D.3 | Effective date | Both | done | keep — UTC storage + `formatShortDate` display per DES-014 | |
| D.4 | Subject matter | Both | pending | | Free text vs. linked matter? (Matter↔Contract link semantics exist per DD-007.) |
| D.5 | Counterparty | Both | done | keep — backed by `counterparties` table per DD-008; value links to the counterparty record (both frames get the link affordance) | |
| D.6 | Contract value | Both | done | keep — `value_amount` + `value_currency` + `value_cadence` per CTR-010; "/year" suffix renders the cadence | Formatting per DES-014. |
| D.7 | Owner field shape | Diverges | done | keep — name only (V13) backed by `contracts.manager_id` per CTR-004; label "Owner" | |
| D.8 | Stage | Both | done | keep — renders the derived **stage** (6-step pipeline per CTR-001), same datum as C.5 at coarser zoom; not a separate stored field | |

## E. Module chip row

| ID | Chip | Where | Status | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| E.0 | Should the chip row exist at all | Both | pending | | The activity bar (J) covers similar functions. Risk of duplication — see X.8. |
| E.1 | Notifications chip | Both | pending | | Unblocked by NOT-001, which makes it likely redundant with the global bell (per-record notifications aren't a NOT-002 concept). Recommend remove — confirm in the screen batch. |
| E.2 | Workflows chip | Both | pending | | "Workflow" is undefined in v1; approval rules are a queued CTR question. |
| E.3 | Linked files chip | Both | pending | | Distinct from Documents chip (E.4)? DD-007 gives documents/attachments semantics to check against. |
| E.4 | Documents chip | Both | pending | | If kept, this is the active surface (V13). |
| E.5 | Signature elements chip | V12 | done | keep (conditional) — renders envelope status per CTR-013 when an envelope exists; hidden for manual hand-off contracts | |
| E.6 | Conversation chip | V12 | done | remove — redundant with the activity-bar comment panel per CMT-004 | |
| E.7 | "+ 2 more" overflow | V13 | pending | | If E.0 stays, decide: always-show vs. collapse. |

## F. Section tab strip

| ID | Tab | Where | Status | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| F.0 | Tab strip vs. anchored sections | Both | pending | | Should this be tabs at all, or anchor-scroll headings inside one long page? |
| F.1 | Description (active) | Both | pending | | — |
| F.2 | Key dates | Both | pending | | Could be a panel inside Description instead of a tab — see X.7. |
| F.3 | Key clauses | Both | done | keep — renders AI-extracted clause fields per CTR-008/CTR-014 (no clause-parsing model) | Unverified-badge treatment per CTR-008. |
| F.4 | Signatories (label) | Diverges | pending | | "Signatories & contacts" (V12) vs. "Signatories" (V13) — pick one. Sentence case per DES-015 either way. |
| F.5 | Considerations | Both | pending | | Define what this contains. |
| F.6 | Memo | Both | pending | | Free-form notes vs. structured memo? |
| F.7 | Communications | Both | done | remove — comments live in the rail panel per CMT-004, not a tab | |
| F.8 | Risks & issues | Both | pending | | Risk management is deferred per DD-005 — define a narrow contract-level scope or park the tab. |
| F.9 | Deliverables | Both | pending | | Confirm distinct from Key dates / Workflows. |
| F.10 | History | Both | pending | | Per-entity activity feed is committed (DD-017); open whether it surfaces as this tab. Lifecycle visualization part blocked on CTR lifecycle. |
| F.11 | Overflow chevron | V12 | pending | | If we keep all 10 tabs, V12's chevron is redundant — V13 already drops it. |

## G. Description card

All G field rows are contract-schema decisions — the `contracts` schema is TBD in `SCHEMA.md`, so outcomes here should land as CTR decisions.

### G.left

| ID | Field | Where | Status | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| G.L1 | Country | Both | pending | | — |
| G.L2 | Region | Both | pending | | — |
| G.L3 | City | V12 | pending | | Probably redundant — Region + Governing law usually covers this. |
| G.L4 | Governing law | Both | pending | | — |
| G.L5 | Jurisdiction | Both | pending | | Tied to Governing law — could collapse. |
| G.L6 | Practice area | Both | pending | | Configurable taxonomy per the MTR-001 pattern. |
| G.L7 | Created | Both | done | keep — `formatShortDate` per DES-014; "by Sarah Chen" backed by the activity model per DD-017 | |

### G.right

| ID | Field | Where | Status | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| G.R1 | Our position | Both | pending | | "Customer" / "Provider" — derive from counterparty side? |
| G.R2 | Risk level | Both | done | keep — first-class `contracts.risk` per CTR-005 (nullable = not yet assessed) | Visualization still X.2 (DES-005 pill family). |
| G.R3 | Auto-renew | Both | done | keep — renders `term_type` per CTR-006 (auto-renew / fixed / evergreen) | |
| G.R4 | Notice period | Both | pending | | — |
| G.R5 | Last renewal | V12 | done | keep — last *confirmed* renewal event from activity_log per CTR-006/007 | X.6 empty-state rule still applies when no renewal yet. |
| G.R6 | Renewal cap | Both | done | remove — no renewal-cap field in the CTR-006 model (term-ledger option rejected) | |
| G.R7 | Days remaining | Both | done | keep — derived `expiry_date − today` per CTR-006; blank for evergreen | |

### G.header

| ID | Element | Where | Status | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| G.H1 | Section icon | V12 | pending | | See X.1. DES-008's size scale already names "section-header icons" (24px) — mild lean toward keeping them. |
| G.H2 | Title | Both | pending | | — |
| G.H3 | Overflow icon | Both | pending | | Define the per-card menu. |

## H. Events card

| ID | Element | Where | Status | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| H.H1 | Section icon | V12 | pending | | See G.H1 / X.1. |
| H.H2 | Title | Both | pending | | — |
| H.H3 | Count chip "7" | Both | done | keep — neutral counter badge per DES-005 `--badge-count-*` | |
| H.H4 | "+ Add event" | Both | pending | | Define the relationship to the DD-017 activity feed first — auto-derived vs manual events; risk of a parallel timeline. |
| H.C1 | Date column | Both | pending | | — |
| H.C2 | Event name column | Both | pending | | Free text vs. linked entry? |
| H.C3 | Type column label | Diverges | pending | | "Event type" (V12) vs. "Type" (V13). |
| H.C4 | Decision column | Both | done | keep — renders `contract_approvals` outcomes (approved / rejected / pending + note) per CTR-012 | Pill vs text is H.X1 (pills favored). |
| H.C5 | Comment column | Both | pending | | Editorial pattern — required? optional? |
| H.C6 | Attachments/Files label | Diverges | pending | | Pick one. |
| H.R1–7 | Mock data sanity | Diverges | pending | | V12 and V13 use different dates/comments — decide canonical sample (X.9). |
| H.X1 | Decision pill vs. text | Diverges | pending | | DES-005's paired status-pill families favor V13's pills (see X.2). Recommend pills. |

## I. Timeframe card

| ID | Element | Where | Status | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| I.H1 | Section icon | V12 | pending | | See G.H1 / X.1. |
| I.H2 | Title | Both | pending | | — |
| I.H3 | Zoom switcher (Year/Quarter/Month) | Both | pending | | Three zooms or just one default view? |
| I.X1 | Label placement: on-bar vs. gutter | Diverges | pending | | V12 inline; V13 gutter. Pick one. |
| I.B1 | Effective date marker | Both | pending | | — |
| I.B2 | Term 1 bar | Both | done | keep — initial term: `effective_date → expiry_date` (as of first term) per CTR-006 | |
| I.B3 | Term 2 bar | Both | done | keep — one bar per confirmed renewal event (activity_log per CTR-006) | |
| I.B4 | Term 3 bar | Both | done | keep — bar count = confirmed renewals + 1; renewals routed to amendment/child/new contracts (CTR-007) render on those records, not extra bars here | |
| I.B5 | Last renewal marker | V12 | done | keep — same datum as G.R5 | |
| I.B6 | End of contract | Both | pending | | — |
| I.B7 | Renewal cap | Both | done | remove — same call as G.R6 (no cap field) | |
| I.B8 | Risk threshold marker | Both | pending | | **Define the concept** — undefined anywhere; risk mgmt deferred per DD-005. Define narrowly or remove. |
| I.X2 | Today line + pill | Both | pending | | — |
| I.X3 | Legend (3 swatches) | Both | pending | | Reasonable; confirm copy. |

## J. Activity bar

| ID | Slot | Where | Status | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| J.0 | Active indicator strip | V13 | pending | | If we keep the bar, both screens should use this. |
| J.X | **Should the bar exist** | Both | pending | | Likely opens a new DD. Tradeoff vs. module chips (E). **Conflict:** DES-007 specs a single 320px `--width-rail`; a 48px icon bar + 392px panel is a new chrome pattern needing a DES amendment if kept. |
| J.1 | description | Both | pending | | Overlaps the Description tab (F.1). |
| J.2 | chat (badge "3") | Both | done | keep — the comment panel's home per CMT-004; badge = viewer's unread, tier-filtered (no hidden-tier leaks) | |
| J.3 | history (badge "v7") | Both | pending | | Overlaps History tab (F.10). |
| J.4 | draw / redline | Both | pending | | Define the tool. |
| J.5 | bolt / automation | Both | pending | | Define the tool; tied to Workflows (E.2). |
| J.6 | track_changes (badge "42") | Both | pending | | Same redlines from doc panel — clarify relationship. |
| J.7 | attach_file | V12 | pending | | Confirm whether V13 keeps it. |
| J.8 | divider | Both | pending | | Group break — confirm the grouping is meaningful. |
| J.9 | settings | Both | blocked | | Settings IA (top-level vs per-module gear) is a queued SET question — blocked on the Settings grill. |
| J.X2 | Badge rules | Both | pending | | "3 / v7 / 42" — define what counts and when. |

## K. Document panel (V13 only)

| ID | Element | Where | Status | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| K.0 | Should V12 also have a doc panel | V12 closed | pending | | V12 currently closed — confirm intentional. X.4 resolution makes V12/V13 the same screen at different container widths. |
| K.H1 | File icon | V13 | pending | | File-type icon pattern (colored square) per DES-008. |
| K.H2 | Filename | V13 | pending | | Editable? |
| K.H3 | Version pill | V13 | done | keep — renders `version_number` of the viewed version per DOC-001 (linear immutable chain) | |
| K.H4 | Redlines pill | V13 | done | keep — opens the DOC-003 compare view (Workshare-style); Word track-changes export is an action within | |
| K.H5 | Open-in-full icon | V13 | pending | | Confirm intent. |
| K.H6 | Close icon | V13 | pending | | Closes the panel; reopen via activity bar. |
| K.T1–T9 | Toolbar density | V13 | pending | | Nine controls is a lot — collapse some behind more-vert. |
| K.B1–17 | Doc body content | V13 | done | keep — panel renders the DOC-004 set (PDF, DOCX, images, PPTX, MSG/EML); rest download-only | DES-006 secondary-typeface pick now actionable on this surface. |
| K.B9 | Inline comment marker | V13 | done | keep — anchored comment margin marker per CMT-001; tier treatments per CMT-003 | |

## X. Cross-cutting

These rows do not map to a single element; they capture decisions that propagate across the screen.

| ID | Topic | Status | Decision | Notes |
| --- | --- | --- | --- | --- |
| X.1 | Card-leading icons (G.H1, H.H1, I.H1) | pending | | V12 uses them, V13 doesn't. DES-008 names section-header icons (24px) in its size scale — mild lean keep. Pick one. |
| X.2 | Status visualization (G.R2, H decision col, lifecycle pills) | pending | | DES-005 defines six paired status-pill families — converge on pills; remaining work is mapping values → families. |
| X.3 | Header-icon set (V12 has bell+avatar; V13 has bell+chevron+avatar) | pending | | Trim to one set. |
| X.4 | Width target (1440 V12 vs. 1000 V13 main column) | done | both — same screen at different container widths per DES-012 (content is container-responsive; opening the doc panel narrows the main column) | |
| X.5 | Edit-mode chrome (Cancel/Save buttons in C.6, C.7) | pending | | Autosave vs. explicit save — pick one. Undecided anywhere in the docs. |
| X.6 | Empty-state for "—" fields (D.5–D.8, G.R5) | pending | | If a value is "—", do we render the row? (DES-003's empty-state rule covers surfaces, not fields.) |
| X.7 | Field-vs-tab boundary | pending | | Several tabs (Key dates, Risks & issues, Deliverables) could be panels inside Description. |
| X.8 | Activity-bar vs. module-chip overlap (E vs. J) | pending | | Likely pick one surface, not both. |
| X.9 | Mock-data parity (Events H, hero D) | pending | | Decide canonical sample contract so V12/V13/future iterations stay consistent. |
| X.10 | Internationalization sweep | done | covered by DES-013 — build-time contract (every string ICU-wrapped); not a mock/screen decision | |
