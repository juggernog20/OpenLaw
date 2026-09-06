# OpenLaw — Intake & Triage Decision Record

Decisions specific to the intake surfaces (ChatOps, web form, email-to-intake), the `Request` entity, and the triage layer that routes Requests into Contracts or Matters.

The high-level intake architecture was set by `DECISIONS.md` DD-010 (three-channel: ChatOps / magic-link form / email parser) and **revised by INT-001 (2026-08-04)**: capture is structured forms in a magic-link portal (JSM-style); email is outbound-notification-only; ChatOps is parked. Work-model doctrine for what requests convert into is **DD-018**. This file covers the module-level decisions.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `INT-###`.

## Open questions queued for the next grill-me session

_None — queue cleared 2026-08-05 (INT-001 through INT-006, plus platform doctrine **DD-018**); **INT-007** accepted 2026-08-08 from the I1/I2 design review._

Disposition of the former technical queue, per **INT-001**'s form-first revision:

- Email parser / email transports / spam handling — **dropped from v1** (no inbound email; outbound sending is already a tech-stack question). Revive with the FUTURE-FEATURES email-capture entry.
- `ChatAdapter` / Slack specifics — **scope shrunk** to at-most notifications + portal deep-links; parked with the FUTURE-FEATURES ChatOps entry.
- Magic-link mechanics (TTL, reuse, allowlist editor, rate limits) + identity mapping (magic-link email → user record) — now **portal auth**; lands with the tech-stack authentication decision. Working defaults: single-use link, short TTL, session cookie after redemption; allowlist editable in Intake Settings.
- Email filing to existing matters/contracts (`m-42@…` addresses) — inbound email is out of v1; entry moved to FUTURE-FEATURES alongside email capture.

---

## INT-001 — Intake model: JSM-style structured forms + lightweight portal; email for notifications only

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — What a Request is and how it's captured. A five-model landscape comparison (ticket-as-work / JSM envelope+backing-object / chat-bridge capture / one-object / conversation-first) was run. Blair rejected the recommended multi-channel bridge — "too many surface areas to anticipate (slack, email, teams)" — and rejected email-to-intake as capture: "it's critical that certain information is collected in a structured manner.. intake needs to be done through structured forms like JSM."
- **Decision** —
  - **Capture is structured forms, JSM-style**: business users submit through per-request-type forms in a **lightweight portal**. No free-form capture channels create requests.
  - **The portal is the requester's home**: authenticated via DD-010's magic-link + domain-allowlist mechanics (no accounts/passwords); requesters see their requests, status, and a conversation thread on each; legal's replies land there. Resolve-in-thread happens on this thread and is recorded.
  - **Email is outbound only**: host-configurable email notifications on request creation and updates, deep-linking back to the portal (magic link). No inbound email parsing creates requests.
  - **Request is an envelope, not a work container** (JSM split): no tasks/team/key dates; real work converts to a matter or contract, the request links to what it became, and the requester keeps their portal view.
  - **Lifecycle (fixed enum, code branches)**: `new → in_review → converted | resolved | declined`; `archived_at` separate. _Revised by INT-007 (2026-08-08): `in_review` removed — lifecycle is `new → converted | resolved | declined`._
  - **DD-010 is revised**: the three-channel capture architecture (ChatOps primary / form / email parser) narrows to **form-first**. Email-to-intake is dropped from v1 (future candidate with parse-to-form-prefill). The ChatAdapter/Slack ambition shrinks from capture+bridge to, at most, notifications and deep-links to the portal form — scope to be set if/when v1.5 revisits it.
- **Rationale** — Structured collection at the door beats parsing unstructured messages out of N channels; one well-built portal is maintainable by an OSS project where per-channel bridges are not. JSM is the proven reference architecture, and the legal intake-first generation follows the same request→convert split.
- **Alternatives considered** — Conversational envelope with bidirectional Slack/email bridging (recommended, declined — surface-area anticipation cost). Thin ticket without conversation: answers evaporate. Ticket-as-work: duplicates matters/contracts. Email-to-intake as capture: unstructured.
- **Consequences** — DD-010 annotated in DECISIONS.md. The portal is a real v1 build surface (submission forms + my-requests + threads). Email sending infrastructure is required (tech-stack queue already has it); email _receiving_ drops out of v1 scope. Request types + form definition become the next structural question. FUTURE-FEATURES: email capture with AI prefill; ChatOps capture.

### Addendum (2026-08-21, M20/2, [#376](https://github.com/juggernog20/OpenLaw/issues/376)) — the portal is reached by role, not by callback URL, and the dead-link page sends the fresh link itself

The decision above says the portal is the requester's home and DD-010's magic link is the door. Building the shell settled two mechanics the decision left open, and both came out the opposite way from the obvious one.

**Landing is decided by role at "/", not by pointing the magic link at the portal.** The plain reading — make the redemption callback `/portal` — puts every redeemed link in the portal, including an Administrator's break-glass link on an instance whose identity provider is down. So the callback stays `/` and the staff application's front door forwards a Business User to `/portal` instead. The redirect is one line in one loader and it covers more than redemption: SSO, password sign-in, a bookmark, and every staff destination that refuses its role floor by bouncing to `/`. The issuance API is left knowing nothing about the portal, which is why nothing in it needed re-testing. **The rule is: a signed-in Business User is always at the portal, whatever door they came through.**

**Member+ staff are admitted to the portal, and it owes them no way back.** The portal's only gate is a session. Staff submit Requests too (user story 7), and on this surface they are a Requester like anybody else — they see only what they submitted, per DD-013. Nothing in the portal chrome links to the staff application, because a staff member arrived from it and can return the way they came; a "back to the app" affordance would be a staff-only affordance on a surface whose whole definition is that it has none.

**The dead-link page asks for the address instead of pointing at sign-in.** A stale link strands a Business User who has no account and no password, and the sign-in screen is not their surface — the one thing they need is another link. So the page carries the email step itself, on the same neutral answer as the entry screen, and falls back to the old point-at-sign-in card only when the magic-link toggle is off or the instance cannot send mail. There is one dead-link page rather than a portal copy beside a staff copy: the redemption failure cannot tell which door the request came from, and the answer is the same either way.

**The entry screen is its own address, `/portal/enter`.** Not the portal home in a signed-out costume: the emailed link, the dead-link page, and sign-out all need somewhere to name. It wears the same centered Light card as the `/auth` screens, because it is the same pre-session moment.

### Addendum (2026-08-21, M20/3, [#377](https://github.com/juggernog20/OpenLaw/issues/377)) — the requester reads the Administrator's configuration through a mount of its own

The Administrator built the front door in M19 behind `requireRole("administrator")`. That gate is right for the routes that write the configuration and wrong for the person it was built for: a Business User has to read the same request types and deflection links to pick one. M20/3 settled how.

**The requester-facing reads are a separate `portal` mount, not a loosened gate.** `GET /portal/request-types` and `GET /portal/intake-links` sit behind `requireAuth` — a session and nothing else, the portal's own rule. The Intake Settings routes are untouched and still refuse a Business User with a 403. Widening an existing route's gate would have made one route mean two things and left the Administrator's projection in front of a requester; a second mount keeps each route saying one thing.

**The requester's projection is narrower than the Administrator's, and the difference is deliberate.** A request type is answered as its id, slug, display name, description, and display order. The archive stamp, the conversion target, the in-use count, and the form-field count are all facts about administering the taxonomy, and none of them belongs in front of the person filling the form in. A deflection link is answered as its id, label, URL, and panel order — no placement key, because the home panel is the only answer the route gives.

**Archived request types are absent, with no `includeArchived` escape.** An archived form takes no submissions (the INT-004 addendum), so offering one would be offering a dead end. The Administrator-facing list keeps its `includeArchived=true`, because administering a taxonomy means seeing what is in it.

**The picker addresses a form by slug, at `/portal/new/:slug`.** The slug is the request type's machine identity and never changes (INT-002), so a bookmarked or shared form address survives a rename; an id would be correct and unreadable.

### Addendum (2026-08-21, M20/5, [#379](https://github.com/juggernog20/OpenLaw/issues/379)) — the requester's own two reads, and what the detail says without a thread

The decision above says a requester sees their requests, their status, and a thread on each. M20/5 built the first two. These are the choices it settled.

**The reads sit on the portal mount and in the `requests` module, and the two halves say different things.** `GET /portal/requests` and `GET /portal/requests/{number}` answer my-requests and the detail. The mount names the audience — the M20/3 addendum's rule, that a requester-facing read is its own route rather than a loosened gate on a staff one. The module names the record — the M20/4 addendum's rule, that one module owns the Request whichever surface asks. M21's Inbox reads the same rows at its own address with its own projection, so neither route ever has to mean two things.

**Another requester's Request is answered 404, not 403.** To a requester it does not exist (DD-013), and a refusal that told the two apart would confirm the row is there. A number nobody has and a number somebody else has get the same status and the same sentence. The scoping is part of the lookup rather than a check after it, so there is no branch where the row was read and then refused.

**My-requests is a block on the portal home, not an address of its own.** I5 draws it there, under the picker and the deflection panel, and the I7 back link names it "Your requests" and points at the home. A returning requester scrolls; a first visitor meets the picker first, which is the order a front door should have.

**The empty list points at the picker above it, and drops the pointer when there is no picker.** A first visit should teach the loop rather than state a fact about zero. On an instance whose Administrator has archived every request type there is nothing above to point at, so the block states the fact alone.

**The row carries the request type, which I5's row does not.** A requester who has submitted through three different doors cannot tell an NDA request from a contract review by the summary alone, and the front door is what decided what Legal collected. It renders under the summary rather than as a sixth column.

**The detail is addressed by the R-### number**, because that is the reference a requester quotes and the one the row links on. A reference that is not the caller's lands back on the portal home — the rule the form's loader already applies to a stale form link (the M20/4 addendum): a stale bookmark is not a fault a requester can act on, and the home is where their own list is.

**A converted Request opens, and the page names no record it cannot open.** Conversion never takes the requester's window away (DD-018), so the row stays on the list and the detail keeps answering. What the Request became is not on the wire at all: a Business User cannot open a Contract or a Matter, and a reference they could not follow would be a dead end dressed as a fact. The banner says Legal is working on it and that this page is still theirs.

**The Description is a submitted value, not the thread's first message.** I7 draws it as the opening message of the conversation. Nothing writes a comment row at submission — the Description is a column on the Request — so a thread that drew it would be drawing a message that does not exist. It is the first row of "What you submitted", and the thread (#381) draws comment rows and nothing else.

**The banner is keyed to the status, and on `declined` it is the reason.** I7 draws one information-toned line for a `new` Request. The other three arms are M21's to write, so each gets its own line and its own status tokens, and the declined arm carries the recorded reason itself — INT-006 makes "no" arrive with a why, and a line _about_ a reason is not the reason.

**The values are labelled through the type's live attached fields.** The detail reads `selectAttachedFields` — the same read the form drew its boxes from and the submission route checked against — so a value is named exactly as the box that collected it was. A value whose field the Administrator has since detached or archived stays on the row and is not drawn: the label that would name it is no longer on this form, which is the rule every record surface already applies. A `user` or `entity` value is resolved into a name before it is answered, because a bare id is not something anybody can read.

**The Attachments row waits for uploads.** The submission form draws an inert Attachments box because there it is a promise about a control. On the detail it would be a statement about the Request, and "no attachments" is a claim this build cannot make, so the row lands with the uploads (M20/6). _Settled in the INT-002 M20/6 addendum below: the row now draws when the Request carries paper, and each filename is the link that downloads it._

### Addendum (2026-08-21, M20/7, [#381](https://github.com/juggernog20/OpenLaw/issues/381)) — the thread the detail was waiting for

INT-001 says a requester sees their requests, their status, and a thread on each. M20/5 built the first two; M20/7 built the thread. Who is in the room on a Request is the comments module's answer (the CMT-010 M20/7 addendum). These are the choices the portal's own surface settled.

**The Conversation card draws even when nobody has replied.** The M20/5 addendum drew no card, because an empty one would have claimed there was a conversation. The card now carries the composer, so it is the way to start the conversation rather than a claim about one, and it draws on every Request whatever its status. It sits between the banner and "What you submitted", where I7 puts it: what has been said since somebody asked matters more than what they typed when they did.

**The composer offers no tier picker, and the absence is the truth about the surface.** A Requester is in one room (DD-016), so the read carries Full Thread comments alone and a post at any other tier is refused at the seam. A three-segment control would offer two rooms nobody would be let into, and a one-segment control is not a choice. The portal posts Full Thread and says nothing about tiers at all — no badges on the rows either, because a badge naming the only room there is names nothing.

**The portal draws no corrections and no unread badge.** Editing, deleting, and redacting are staff affordances the mock does not draw (CMT-008), and a requester who wants to take something back replies again. A tombstone still renders as a tombstone, because the row keeps its seat and the conversation around it has to read. There is no badge because the portal has no activity bar to hang one on (CMT-004).

**The thread read is soft, and the detail read is not.** A Request that cannot be read sends the requester back to the portal home or to the error boundary, as M20/5 settled. A thread that cannot be read leaves the page standing and says so in the card: the values somebody submitted are still theirs to see, and the composer is still the way to reach Legal.

**Two recorded I7 deviations.** I7's composer carries an "Attach a file" link; a comment carries no file — the thread is plain text and attachments are deliberately out of the comment model (M9/2) — and the paper travels with the ask instead (INT-002), so the composer draws the box and the Send button alone. And I7 draws the messages as one unbounded run; the read is paged from the newest end (CTR-024), so a thread past one page carries a control that walks back into the older conversation. Without it a long thread would silently lose its own beginning.

### Addendum (2026-08-21, M20/9, [#383](https://github.com/juggernog20/OpenLaw/issues/383)) — the portal chrome gains its two destinations

NOT-001 promised a business user a bell **and** a lightweight settings surface in the portal. M20/2 built the chrome without either and recorded that the portal has "no settings entry", because at that point every destination it could have offered was a staff one. Both now exist, and they are the only two the portal has.

**The header's trailing cluster carries a bell and a gear, and that is the whole of the portal's navigation.** Two glyphs rather than a nav, because two destinations do not make a nav. The M20/2 sentence stands with one correction: the portal still has no _staff_ destination and never will, and it now has two of its own.

**The bell is the staff bell** (the NOT-005 M20/9 addendum) — the same component, the same read model, rendered against the portal's own strip. The gear opens `/portal/settings`, which is NOT-002's group 5 and nothing else: the other four groups are about contracts, records, dates, and the Inbox, none of which a Business User can open (DD-013). Calling the page "Notification settings" rather than "Settings" is the honest name for what it holds.

**Neither has a frame.** `intake.pen` draws I5–I7 and none of them carries a bell, a gear, or a preferences pane. The bell's anatomy is DES-049's, the grid's is DES-050's, and the card around the grid is the portal's own section chrome — the strip the Request detail already draws "What you submitted" with. All three are already ratified against frames elsewhere.

**The settings card is the portal column's width**, not the 720px settings card. This is the portal's chrome, and a narrower card floating in a wider column would be the one block on the surface that did not line up with the ones above it.

### Addendum (2026-08-21, M20/10, [#384](https://github.com/juggernog20/OpenLaw/issues/384)) — two portal reads that were decided in the route and not here

The M20 close read the portal's own reads back against this record. Two rules were live and unrecorded.

**My-requests is unpaged, and it is the one list in this API that is.** Every other list pages, because every other list is org-wide and its row count is a fact about the whole instance. This one is bounded by what a single person has asked Legal for. A cap would silently drop somebody's own Request out of the only list that can show it, and I5 draws the block whole — there is no "load more" to recover the tail with. The count the block prints is read off the same answer, so it cannot disagree with the rows. **The thread on the Request detail still pages** (CTR-024), and that is not a contradiction: a conversation grows without anybody asking for a new one, while a list of Requests grows one deliberate act at a time. If a requester ever accumulates enough Requests for this to hurt, the answer is a filter, not a page — a person looking for one of their own asks knows something about it.

**A `user` or `entity` value whose row cannot be resolved renders as the raw id.** The API resolves both types into names for the detail, and resolves **archived** rows on purpose — a Request that already names somebody who has left must go on naming them, exactly as a contract does. What is left is an id that resolves to nothing at all: a row hard-deleted since submission, or a value written before the write path checked liveness (the INT-002 M20/10 addendum). The card shows the id rather than a dash, because the Request does hold a value and a dash would say it holds none. It is an internal identifier on a Business User's screen, which is ugly and rare and honest; a placeholder that reads better would be a claim this build cannot support. The milestone that gives a Request a repair path should give this one a better answer.

## INT-002 — Request types mapped to target types; forms reuse the fields catalog

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — INT-001 made structured per-type forms the only capture; this defines them.
- **Decision** —
  - **`request_types`** — admin-configurable (Intake Settings → Request Types; MTR-001 machinery: slug, display name, description, display order, archive). Each optionally **targets a matter type or contract type** (or no target, e.g. "Legal question").
  - **The portal form** for a request type = standard basics (summary, description, attachments, **urgency** — requester-supplied, `low|medium|high|critical` _(levels per **DES-018**'s severity-ramp canon; originally `low|normal|high|urgent`)_, mapping 1:1 to `priority` on conversion per MTR-012; `risk` is never requester-set) + **attached catalog fields** via `request_type_fields` (CTR-016 `fields` whose scope matches the target module, or `global`), each with display order and required flag.
  - **Collected values carry through conversion** — they land in the converted matter/contract's real fields, no re-keying; MTR-014's hard-required fields can be satisfied at the door when the form collects them.
  - **Request attachments** are lightweight uploads on the request (`request_attachments`), promoted into `documents` (owned by the new matter/contract per DOC-008) at conversion — requests are not document owners.
  - Requests get **R-### numbering** (global sequence, MTR-009/CTR-003 sibling).
- **Rationale** — Reusing the fields catalog is the JSM request-field→issue-field mapping done with machinery we already have; it's what makes "structured collection" survive the handoff.
- **Alternatives considered** — Independent per-type form builder: re-keying at conversion. One generic form: collects nothing structured.
- **Consequences** — `request_types`, `request_type_fields`, `request_attachments` + `requests` core columns in SCHEMA.md. Settings surface added. Conditional form logic (Q6) would layer on `request_type_fields` if ever adopted.

### Addendum (2026-08-20, [#354](https://github.com/juggernog20/OpenLaw/issues/354)) — the target has three states, and the basics are fixed

The decision above knew two target states: a specific matter or contract type, or nothing. The editor built in M19/4 needed a third, and it earns its place — so the target is written down here as what it is.

**The target is a module, and optionally a type inside it.** `target_module` is NULL, `matter`, or `contract`. Under `matter` or `contract` a type id may name one specific type, and under NULL nothing may. So "NDA request" targets the NDA contract type, **"Contract review" targets the Contract module and leaves the type to the reviewer at conversion**, and "Legal question" targets nothing at all. The middle state is the new one: a request type can promise a contract without pre-deciding which kind, which is what an intake form for "review this counterparty paper" honestly knows at submission. It costs conversion nothing — INT-006's rule is that triage confirms rather than classifies, and a module-only target still hands the triager the module, the collected values, and one choice instead of two.

**One check constraint holds all three columns together**, so the invariant is the table's rather than the route's: with no module, both type ids are NULL; under `matter`, `target_contract_type_id` is NULL and `target_matter_type_id` may be set or NULL; under `contract`, the mirror. The module-only state is the one where the module's own type id is NULL. On the wire it is two values — the module and the optional type id — because which of the two id columns holds it is the module's to say.

**Deleting a targeted type demotes; it never strands.** Both type FKs are `on delete set null` while `target_module` stays, so hard-deleting the NDA contract type turns "Contract · NDA" into "Contract" — a state the model already has. Archiving a targeted type is left alone: the target picker offers live types only, the editor flags a target whose type is archived, and conversion (M21) reads an archived target type as no type.

**The basics are fixed and are not columns.** Every portal form collects Summary, Description, Attachments, and Urgency. Summary, Description, and Urgency are required; Attachments are optional. The editor draws the four as locked rows so an Administrator can read the contract without being invited to change it, and nothing in the schema records them — a fixed set is a fact about the form, not a configuration of it. Urgency carries the DES-018 severity ramp (`low`, `medium`, `high`, `critical`), as this decision already recorded.

### Addendum (2026-08-20, M19/7, [#357](https://github.com/juggernog20/OpenLaw/issues/357)) — one attached field can outlive the scope that admitted it, and M20 will meet it

Changing a request type's target is refused when the new target's scope rule would exclude fields already on the form; the refusal names them and the Administrator detaches first (SET-003's house style — guards refuse and explain). **The refusal reads live attached fields only, and an archived catalog field is therefore invisible to it.** That leaves one reachable state, recorded here rather than closed, because M20 is where it will next be seen.

**The sequence.** Attach a contract-scoped field to a contract-targeting request type. Archive that field in the catalog — allowed; a field is archived, never deleted (MTR-014 value retention). Re-point the request type to Matter — allowed, because the only attachment that would have stranded is now archived and the check does not see it. Restore the field. The attachment is live again, so it renders on the editor and counts in the ST12 Form fields column, under a target whose scope no longer admits it.

**Why this is the right end of the trade.** The alternative is a refusal an Administrator cannot act on. While the field is archived the editor does not draw its row — the form definition lists live fields — so a target change refused on its account would name a row that is not on the screen and offer no way to detach it. That is a dead end; the state above is not. It is visible the moment it happens, it is repairable by a plain detach, and nothing about it is silent: the field is on the form, drawn like every other, and its scope caption says what it is.

**What it costs, and who pays.** Nothing is corrupted — the attachment row is well formed, the required flag still applies, and the portal (M20) renders the field and collects its value like any other. The cost arrives at conversion (M21): a contract-scoped value collected under a matter-targeting form has no field to land in on the created matter, so it is a collected value with nowhere to go. **M20 and M21 should treat "attached but out of scope for the current target" as a state that exists**, not as one the API prevents. Widening the strand check to include archived attachments is the obvious fix and is deliberately not taken here — it would trade a visible, repairable state for an invisible, unrepairable refusal, and the honest place to solve it is wherever the portal or the Inbox decides what an out-of-scope collected value means.

**Not to be confused with the archived _target type_.** That case is settled above: the picker offers live types only, the editor flags an archived target, and conversion reads it as no type. This addendum is about an archived **catalog field**, on the other side of the attachment.

### Addendum (2026-08-21, M20/4, [#378](https://github.com/juggernog20/OpenLaw/issues/378)) — submission, and where the form's rules are stated

The decision above says what a portal form collects. This records what happens when a requester presses Submit, decided while building the first surface that does.

**The `requests` module owns submission; the `portal` module owns the form read.** `GET /portal/request-types/{slug}` answers one type, its attached catalog fields in display order, and the deflection links placed on that form — the requester-facing read of the Administrator's configuration, which is what the `portal` module already is. `POST /requests` writes the row, and it is the Request's own module because M21's Inbox reads the same record from the staff side. One module owns the Request whichever surface asks for it.

**The basics are drawn by the portal and enforced in code.** Summary, Description, Attachments, and Urgency have no rows in `request_type_fields` and never will, so the form renders them and the submission route requires the three that carry a value. The attached fields are the only half read from configuration, and both surfaces read it through the one `selectAttachedFields` helper the contract record already uses — a rule stated twice is a rule that drifts.

**One refusal names every gap, basics and attached fields together.** A person filling a form in should not have to press Submit twice to learn two halves of the same answer. The portal shows that refusal in two places: as a sentence, and again on each unanswered box, because a sentence cannot point at a control.

**An archived request type is refused at the API, not only hidden in the picker.** The type row is locked for update before the insert, so an archive committing between the check and the write cannot let a Request be born on a form that takes no submissions. The form read refuses the same type with a 404, and the portal sends that visitor back to the picker rather than to an error page: a stale bookmark is not a fault a requester can act on.

**An out-of-scope attached field renders, collects, and still enforces its required flag** — the M19/7 addendum above said M20 would meet that state, and this is it meeting it. Nothing about it is special-cased on either side.

**Values are accepted for exactly the attached fields.** A slug the type does not attach is refused rather than dropped: a form that sent it is out of step with the type, and a value stored under it would sit on the Request where nothing could show it or clear it. An empty answer leaves no key at all, so "nothing recorded" has one shape here as it does on a contract.

**The Requester is the session, never a body field** (DD-013). There is no `requesterId` on the wire and no route to create a Request on somebody else's behalf.

**Creation is narrated as `request.created` inside the insert's transaction** (DD-017), so no Request can exist without the entry that says who asked. The payload carries the number, the request type's display name, the urgency, and the **slugs** the form answered — no free text at all, not the summary and not the values. The log is append-only, so a requester's own words could never leave it again; R-### is the Request's name, and the number never changes.

**`requests.converted_matter_id` landed before its foreign key.** The column arrived with M20 because INT-006's conversion is one of two shapes and a table that could record only one would lie about the model. M22 added the foreign key and index with `matters`; the existing check continues to hold the pair to at most one non-null, so "a Request becomes one record" is the table's rule rather than the conversion route's.

### Addendum (2026-08-21, M20/6, [#380](https://github.com/juggernog20/OpenLaw/issues/380)) — the paper travels with the ask

The decision above calls request attachments lightweight uploads, promoted into `documents` at conversion. M20/6 built them. These are the choices it settled.

**`request_attachments` is four columns, an id, and a stamp, and it stores no declared type.** SCHEMA.md's shape exactly — `id`, `request_id`, `file_ref`, `filename`, `uploaded_by`, `created_at` — with no media type, no byte count, and no checksum, because nothing on this side of conversion reads any of them. The download therefore answers `application/octet-stream`, which is what an email attachment's download already answers and for the same reason (DOC-004): a type nobody verified is a hint, and a response that echoes one is a response that can be made to lie. A promotion that needs those facts reads them off the blob.

**Nothing enters `documents`.** A Request is not a document owner (DOC-008), so an attachment is a stored blob and the name it arrived under — no version chain, no folder, no confidentiality flag, and nothing to edit. Promotion into the record the Request became is conversion's (M21).

**The bytes ride the storage seam documents upload through, and there is one set of upload rules.** The key is minted from the attachment's id and never from the filename (DOC-012), the blob is written before the row exists and taken away again when the write does not commit, and the size ceiling, the filename bound, and the multipart parser's refusals are read from one module by both upload paths. A person told a 300-character name is too long on a contract is told the same thing on the portal.

**The upload is a write on the Request, so it sits at `/requests`; the download is a read, so it sits on the portal mount.** `POST /requests/{number}/attachments` follows `POST /requests` — a write of the record is the same act whoever makes it. `GET /portal/requests/{number}/attachments/{id}` sits beside the detail that lists it, because what differs between a requester and M21's Inbox is a read's projection, not a write. Both answer 404 on a Request the caller did not submit, and the download answers the same 404 for an attachment id that belongs to another Request — the detail read's rule, one level down (DD-013).

**One file per call, and the form uploads after the submission rather than with it.** An attachment is a row against a Request, so there is no Request to attach to until the submission has been accepted: the form holds the chosen files, posts the Request, and then puts the paper on it one call at a time. The alternative — one multipart submission carrying the values and the files together — was declined because it would make `POST /requests` mean two things and would send a form's structured values through a wire format that has no shape for them.

**A file that does not land is named on the confirmation, not swallowed.** The Request exists either way and that is the first thing the page says; the paper that did not follow it is stated beside it under its own name. There is no retry, because there is no upload control on the request detail — the honest answer is the fact and the reference to quote.

**A Request carries at most twenty attachments.** A bound rather than none, because the portal is open to every Business User and an unbounded upload address is unbounded disk. It is generous for what this decision calls lightweight, and a Request that needs more paper than this is a matter or a contract, which is what conversion makes it. The count is read under the Request's row lock, so two uploads racing for the last free slot cannot both take it.

**Attachments write no activity entry.** The submission they arrive with is already narrated (`request.created`, DD-017), and the portal offers no other moment to attach one, so an entry per file would narrate the same act several times. Staff-side attachment does not exist yet; the milestone that builds it is the one to decide what it narrates.

**The detail's Attachments row is absent when there is none.** The M20/5 addendum left the row out because "no attachments" was a claim that build could not make. It can now, and the row still follows the card's own rule: the card says what was submitted, attachments are optional, and a row of dashes says what was not. Each filename is the link that downloads it — a name a requester cannot open is a label rather than a document.

### Addendum (2026-08-21, M20/10, [#384](https://github.com/juggernog20/OpenLaw/issues/384)) — what M20 met, and the one form the portal cannot answer

The M20 close read the shipped portal back against this decision: one state M20 was asked to meet and did, three rules that were live and written only in the code, and one form nobody can submit.

**The M19/7 state was met, and it is now measured rather than promised.** The M19/7 addendum recorded that an attached catalog field can outlive the scope that admitted it, and asked M20 to treat that as a state which exists. The M20/4 addendum says the form does. The close confirms it against the code: the API seam and the web route seam each pin the case — the field renders, collects, and enforces its required flag, and no arm special-cases it. Nothing is left for M21 here beyond what the M19/7 addendum already said, which is that the cost of an out-of-scope collected value arrives at conversion.

**A request type with a _required_ `user` or `entity` catalog field is a dead end for the requester, and no decision has been taken.** The portal draws those two field types as an empty picker on purpose: a requester reads neither the staff directory nor the Entity registry, and a picker that offered either would be a leak (DD-013, DD-016). An optional one is therefore harmless — it collects nothing and the form submits. A **required** one cannot be answered by anybody who can reach the form, so every submission of that type is refused, forever, and the refusal names a control the requester can see and cannot use. Nothing in the M19 editor stops an Administrator attaching one, and nothing in the portal warns them.

This is the M19/7-shaped edge M20 leaves open. It is written down rather than closed because the fix is a product choice nobody has made, and the three candidates are not equivalent:

1. **Offer rows.** The picker draws a set a requester may see — Entities are the organization's own registry and arguably public to its own people, and `user` is not. That is a visibility decision, not an implementation.
2. **Refuse the attachment in the M19 editor.** A `user` or `entity` field may be attached but never marked required on a form, refused by name in SET-003's house style. Cheapest, and it makes the rule an Administrator's to read.
3. **Let it through and drop the requirement at the door.** The portal treats a required `user` or `entity` field as optional. Silent, and silent rules are the ones this repo does not take.

Until one is chosen, the state is reachable and unguarded. **M21 must not assume a collected `user` or `entity` value is present**, and the milestone that takes this on owns both the editor's refusal and whatever the portal draws. Raised as [#400](https://github.com/juggernog20/OpenLaw/issues/400), which is where the choice gets made.

> **Settled by the M20/11 addendum below.** Candidate 2 was taken. The state is no longer reachable, and the sentence above about M21 not assuming a value is present still holds — the field stays optional, so it still collects nothing.

**A submission refuses a `user` or `entity` value naming an archived row; the detail goes on resolving one.** The two directions are deliberately not symmetrical, and both follow the contract record's rule. A **write** points something new at somebody: nothing new is pointed at a person or an entity that has left, so the id is checked against a live row under a lock and refused by name if it is not one. A **read** reports what was already recorded: a Request that named somebody before they were archived must go on naming them, or the record would quietly rewrite itself. `coerceCustomFieldValue` accepts any non-empty string on purpose and leaves liveness to the record module, which is why the check sits in the submission route rather than in the shared coercion.

**One refusal names every gap, with one stated exception: a number that is not a number.** The M20/4 addendum's rule holds for every unanswered required field, basics and attached alike. A value typed into a number box that will not parse stops the pass at that field and marks only it. That is the right shape — the other refusal answers "what have you not filled in yet", which is a complete list, while this one answers "this box does not hold what it says it holds", which is about one control and cannot be usefully pooled with the others. Two presses is the cost, and it is paid only by somebody who typed letters into a number.

**A cumulative attachment byte cap and per-route rate limiting stay deferred**, as the M20/6 build recorded and this close restates so it is not silently carried. What is bounded today is one file (the shared upload ceiling) and one Request (twenty attachments, counted under the row lock). What is not bounded is the number of Requests one Business User may raise, and therefore the total bytes one account can put on disk. That is a deployment-shaped question — the numbers depend on the instance, and the enforcement point is in front of the app rather than inside it — so it belongs with an infrastructure decision that does not exist yet. It is parked in `FUTURE-FEATURES.md`.

### Addendum (2026-08-21, M20/11, [#400](https://github.com/juggernog20/OpenLaw/issues/400)) — a request form may collect a user or an entity, and may never require one

The M20/10 addendum above left one form nobody could submit, and named three candidate fixes. **Candidate 2 was taken.** A `user` or `entity` catalog field may be attached to a request type and may never be marked required on that type's form. The attempt is refused by name, in SET-003's house style, so the rule reaches the Administrator who sets the flag rather than the requester who would meet it.

**Candidate 1 is declined for now, and this choice does not foreclose it.** Drawing the Entity registry or the staff directory to a Business User is a DD-level visibility decision (DD-013, DD-016) that nobody has taken, and it is not one to take inside a bug fix. If Entities later become visible to their own people, `entity` leaves the refusal and `user` stays. Candidate 3 is declined outright: a portal that quietly treated a required field as optional would make a silent rule, and this repo does not take those.

**The refusal is per mount, never on the shared route.** The required flag is written through one machinery that the contract-type, matter-type, and request-type editors all mount. Staff picking a user or an entity on a **contract** type is ordinary work — their picker has rows — so a blanket rule would refuse a screen that is not broken. The request-type mount states a `TypeFieldRequiredRule` and the other two state nothing, exactly as `TypeFieldScopeRule` is already the mount's to state. What a required field costs belongs to the surface that collects the value, so the surface's own mount says it.

**Both write doors are guarded.** The flag can arrive on the attach as well as on the later change, and the rule reads the same on each. An attach that carries it is refused whole, so nothing is attached half-way, and attaching the same field with no flag succeeds — which is the point of the decision: the form may collect the value, it may just not demand it.

**Clearing the flag is always allowed; setting it is always refused, even on a row that already holds it.** The shared route answers a no-op change with the row it already has, and that answer would report a refused state as an accepted one. So the rule is read before the no-op check. The one direction that is always open is the repair.

**A request type already in this state has its flag cleared, once, by migration `0063`.** M19 shipped the editor with no guard, so an install can hold such a row today; the editor's refusal alone would leave it there, unsubmittable, with nothing on any screen to explain it. A rule that is not true of the data is not a rule, so the migration makes it true. **The field stays attached and the form goes on collecting it** — only the requirement goes, because the requirement is the only part nobody could satisfy. Request forms only: `contract_type_fields` and `matter_type_fields` are not touched.

**The editor draws the box locked rather than letting the rule arrive as a failed save.** The row is otherwise an ordinary row — it attaches, reorders, and detaches — and only its Required box is disabled. The reason is said twice, beside the box for a reader and in the card's help line for everybody else, because a disabled control with no reason is a screen that refuses without explaining. The API's refusal is the real guard; the locked box is the client half of it, in the same way the Attach menu's scoping is the client half of the scope rule.

### Addendum (2026-08-22, M21/10, [#421](https://github.com/juggernog20/OpenLaw/issues/421)) — the paper follows a conversion

The M20/6 addendum above built request attachments and left one sentence for M21: promotion into the record the Request became is conversion's. M21/10 built it, inside the conversion transaction the M21/9 addendum describes. These are the choices it settled.

**Promotion copies, and it never takes anything away.** Every `request_attachments` row and every blob behind it stays exactly where it is. The requester's portal detail goes on listing the paper they submitted and the downloads behind those names go on answering, unchanged, after the conversion. The Request survives as the requester's window (INT-002), and a window onto paper it can no longer open is not a window. The same rule the collected values already follow, applied to the files: copied, never moved.

**One attachment is one ordinary document at version 1, filed at the record root.** Three attachments are three documents, not one batch of anything, which is the M13 batch doctrine restated for a promotion. The chain, the folder rule, and the version row are `documents`' own: the promotion writes through the one version write path, so a promoted round is indistinguishable from an uploaded one once it is on the record. There is no marker saying a document arrived by conversion. The record's activity already says it, once, on the conversion entry.

**The bytes ride the storage seam to a key minted from the new ids** (DOC-012). The attachment's key belongs to the attachment, so nothing is re-pointed and no blob is moved: the copy is written under `documents/<document id>/<version id>`, exactly as an upload's is, and never under anything derived from a filename. The copy is one pass. The bytes are hashed, counted, and read for their head on their way to the driver, which is how an upload meters a file.

**The facts a document needs are read off the blob, because there is no claim to read them off.** An attachment stores no media type, no byte count, and no checksum, on purpose. So the count and the SHA-256 come from the copy's own pass, and the media type comes from the first sixteen bytes through a small signature table (`lib/media-type.ts`). Three rules keep that table honest. The bytes name the type and a filename never overrules them, so a zip called `.pdf` is not a PDF. Where a container holds several formats, and a `.docx` and a `.pptx` are the same zip, the name picks among the members that container admits and nothing else. Bytes the table cannot read are `application/octet-stream`, which is the widest thing that is always true and the same answer an upload that declared nothing gets: the render table falls through to the filename for exactly that case, so a file this module cannot name still routes to its family and still asks the pipeline for its derivations.

**Each promotion narrates `document.created` naming its destination** (DD-017). One entry per file, carrying the document, the version, the title, and a null folder name, which is the upload route's own payload, so the record's feed reads one way whatever put the paper there. There is no promotion event and no batch entry: a batch is not a thing a record holds, files are.

**The first promoted document takes the instrument designation** (CTR-014), and it narrates `document.primary_set` beside the creation. The upload route's rule is mechanical, whatever lands first takes it and it moves afterwards, and a promotion is not the place to make an exception. A conversion that left the designation empty would hand it to whatever somebody uploaded by hand next, which is both a worse answer and a stranger one. The kind is `draft_ours`, the upload route's own default for a file that names none, because a requester is one of our own people and their paper is our side's.

**Group 2's document event is raised, and today it reaches nobody.** A record born by conversion has one person on it, the triager who converted, and the event excludes the actor, so no bell row is written. It is raised anyway, because the rule belongs to the event rather than to what a newborn record's roster happens to hold.

**A Request that carried no paper converts with no document and no sentence about it.** No document, no entry, no event. A Request with no attachments is a complete Request, and narrating an empty promotion would put a sentence on the record about something that did not happen.

**A conversion that fails once the copying has started leaves nothing, including nothing on disk.** The rows are the transaction's, so no contract, no documents, and no half-converted Request survives a refusal anywhere in the act. The blobs are not the transaction's: bytes reach the driver before rows exist, so the promotion remembers every key it wrote and removes them when the act does not commit, which is the upload path's own rule applied to a copy that can write several files. The keys are never written again; a retry mints its own. A failed cleanup is logged and swallowed, because the caller is owed the reason their conversion was refused.

**An attachment whose blob cannot be read fails the whole conversion, and does not promote the others.** The alternative, skipping the file and converting anyway, would be a lossy act dressed as a successful one, and INT-002's promise is that nothing the requester gave us is lost. The refusal costs nothing: the Request is untouched, it is still `new`, and it can be converted again once the storage fault behind it is understood.

**The promotion runs inside the transaction, under the Request's own row lock.** The attachments are read after the lock, so the paper this conversion promotes is the paper the Request held when it was held. That means the copies are network work under a lock, which is accepted here: a Request carries at most twenty files (the M20/6 bound), and the alternative, copying before the lock and re-checking the set afterwards, would be a second mechanism guarding a race that the lock already answers. The derivations are asked for after the commit, never inside it, exactly as an upload asks for them.

### Addendum (2026-08-22, M21/12, [#423](https://github.com/juggernog20/OpenLaw/issues/423)) — five things the carry settled that were written only in the code

Read back at the M21 close. Each was decided by the build and stated nowhere.

**A carried `user` or `entity` value whose row has since been archived refuses the whole conversion, and the dialog has no box to answer with.** The value was live when the requester chose it. Somebody archived the person or the Entity before a triager picked the Request up. The create refuses every archived reference by name — `pick a live person` — for the reason the Owner and the signing entity refuse one, and Convert is all-or-nothing, so the Request cannot be converted through the screen at all. The dialog draws no control because it grows a box only for a field the target type demands and nothing answers; this field is answered, with a value that no longer resolves. The API takes an override in `customFields` and the screen offers none. **The refusal is right and the dead end is not**, so which of the three repairs to build is raised as [#437](https://github.com/juggernog20/OpenLaw/issues/437) and none is chosen here. Note the rule it sits next to: both staff reads resolve an archived person or Entity on purpose, because a Request that already names somebody who has left must go on naming them. Reading one is allowed; writing one forward is not.

**The lock order conversion takes is the Request's row, then the target contract type, then each referenced person or Entity in the body's key order.** The last of those three is the ordering [#425](https://github.com/juggernog20/OpenLaw/issues/425) is about, and conversion inherits it from the create door rather than adding one.

**A promoted document is titled with the requester's filename, carries no version note, and is born non-confidential.** The M21/10 addendum settled the kind, the folder, the version number, and the media type, and left these three unsaid. The title is the filename because it is the only name anybody has given the file, and DOC-007 lets a Member+ rename it afterwards. The note is NULL because a version note is what somebody wrote about a round, and nobody wrote one — an invented note would be the promotion's words in a person's slot. Non-confidential because DD-014 is the record's decision and a promotion inherits nothing: the paper is as confidential as the contract it landed on.

**Paper attached after a conversion never promotes, and the upload does not refuse it.** The attachment route checks the caller is the Requester and the Request is under its twenty-file cap; it does not check status. Promotion is a one-time copy taken inside the disposition transaction, so a file added afterwards sits on the Request, listed and downloadable on the portal, with no document on the record to match it — the requester believes they sent Legal a paper and they did not. This is M20/6 behaviour that the conversion did not change rather than something M21 introduced. It is the one place the thread's answer and the paper's answer diverge: CMT-001 gave the thread an address that follows the work, and promotion is a copy at one moment. Raised as [#438](https://github.com/juggernog20/OpenLaw/issues/438); the shape that matches CMT-001 is to promote on arrival, and it is the one that costs the most.

**One collision the dialog's two lists leave open.** "Carries into the contract" is built from the target type's attached fields and "Does not carry" from the request type's, so a collected value whose request-type field the Administrator has since detached appears in neither list and carries nowhere. It is consistent with the staff detail, which draws no row for a detached field's value — the value is on the Request and readable through the seam either way — but the M19/7 promise that nothing is dropped silently and that rule pull in opposite directions. Recorded rather than fixed: nothing is deleted, and the milestone that draws the repair path for a detached field's stranded value owns the call.

### Addendum (2026-08-22, [#437](https://github.com/juggernog20/OpenLaw/issues/437)) — a carried reference that died reads as dead, and the dialog grows a box for it

The M21/12 addendum above raised three repairs for the archived carried value and chose none. This chooses, and the answer is two of them rather than one.

**A carried value that no longer resolves is a third state on the read, beside answered and unanswered.** The staff detail says so on the value itself, before anybody has pressed anything. That is where the triager is standing when the fact first becomes useful to them, and it is how the INT-001 M20/10 raw-id fallback already reads a reference it cannot resolve: the surface says what it has rather than drawing something that looks fine.

**The Convert dialog then grows a box for it**, beside the boxes it already grows for a required field the form never collected. The same control, for a second reason. No new route is needed — `POST /requests/{number}/convert` already takes `customFields` and an override there already wins, which is the INT-007 M21/9 addendum's rule reached by a screen for the first time.

**The marker comes first and the box second, and that order is the point.** A triager who meets this while reading can go and restore the person, or pick the right one, or decline the Request. A triager who meets it at the press has already decided.

**The box is drawn for a dead value and never for a live one.** That is what keeps the repair inside DD-018. Triage confirms and does not classify, and a control offered on every carried reference would quietly become a licence to re-key what the requester said. Repairing a pointer that points nowhere is not re-keying it; it is the only act available.

**The requester is not asked to fix it.** They answered correctly at the time, the value died behind them, and they have no more standing over an archived row than the triager does. The conversion is Legal's act, so the repair belongs to whoever is making it.

**Reading an archived reference stays allowed and writing one forward stays refused.** Unchanged by this, and restated because this is the first thing to act on the difference: the staff detail goes on naming the person who has left, and `lockedReference` goes on refusing to point a new record at them.

### Addendum (2026-08-22, [#438](https://github.com/juggernog20/OpenLaw/issues/438)) — paper after the disposition goes on the thread, and the upload refuses

The M21/12 addendum above named the post-conversion attachment and guessed at its shape: promote on arrival, matching CMT-001, at the highest cost. The decision went the other way, and the reason is worth keeping.

**Promoting on arrival puts a document on a record with nobody in the room to say what it is.** The file that actually comes back is the counterparty's markup of a round already on the chain — Legal drafts, the business sends it out, the other side marks it up and returns it. That is not a new document at the record root and its kind is not `draft_ours`, and neither fact can be read off an upload: a requester cannot know which round a markup marks up, and until now a kind could not be corrected once written. A better copy was never the answer. The thread was, because CMT-001 had already given it the address that follows the work.

**So paper after the disposition arrives as a comment attachment (CMT-011), and a Member+ files it onto the record.**

**The upload refuses once the Request is not `new`**, and one rule covers all three outcomes. Resolve and Decline leave no record for a file to land on. Convert leaves one, and it has a thread. The route checks that the caller is the Requester and that the Request is under its twenty-file cap (the M20/6 addendum above); it never checked status, and it does now.

**The refusal names the thread**, so the portal answers with a door rather than a wall.

**The refusal and the comment attachment ship in the same milestone** (M21A). Refusing first would take away a path that goes nowhere and put nothing in its place, which is worse for the requester than the bug: today they at least keep a copy where they can see it.

**Nothing already on a Request moves.** The cap, the requester's own download, and the promotion at conversion are all untouched, and paper submitted with the form still travels with the ask (the M20/6 addendum above), because there is no thread before there is a Request.

### Build note (2026-08-23, M21A/5, [#448](https://github.com/juggernog20/OpenLaw/issues/448)) — the wall names its door

The upload reuses `urn:openlaw:problem:request-dispositioned`, the existing shared type for a write that lost the `new` Request. Its 409 carries three extension members: `request: { number }`, the stable portal address of the thread; `outcome`, the recorded `converted | resolved | declined` arm; and `convertedContract`, the C-### a conversion made when the caller reaches it under DD-014, and `null` on the other two arms or where reach fails. The route is the Requester's own, and a Business User reaches no Contract, so on the portal the member reads `null`, the same answer the portal detail gives; the staff disposition refusal (INT-007) applies the same rule. The status guard runs inside the existing transaction after the Requester-scoped row has been locked and before the twenty-file count, so every disposition answers the thread refusal and two uploads still serialize at the cap. Because the bytes precede that transaction (DOC-012), the existing stored-blob wrapper removes the refused upload.

DES-065 records the two portal readings. A dispositioned detail draws no Request attachment control and points at the comment composer it already has. If one of the submission form's sequential uploads races a disposition, the confirmation reads `request.number` from the typed refusal and links that file to the same composer. The form remains the only place Request attachments enter; the detail's paper control is always the comment control CMT-011 added.

### Addendum (2026-08-23, M22 close, [#474](https://github.com/juggernog20/OpenLaw/issues/474)) — the second target now completes the same carry

M22 made `matter` a complete target rather than a configuration value waiting for a record. A live bound matter type is confirmed, a module-only target asks for its type, and an archived bound type reads as module-only on both staff reads and at the write. The conversion resolves the destination's attached fields through one module-aware definition: collected values with matching slugs carry server-side, required gaps are asked in the dialog, dead references get the existing repair control, and values with nowhere to land remain whole on the Request. Request attachments become root documents owned by the matter while the original attachment rows and downloads remain.

## INT-003 — Requester updates: email notifications only; no status-poke button

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — Whether the portal gets a LawVu-style "Request a status update" button. Blair: "No — notifications suffice."
- **Decision** — Requesters receive host-configurable email notifications (creation + status changes, deep-linking to the portal per INT-001) and can reply in the request thread. No dedicated poke affordance.
- **Rationale** — The thread already allows asking; a throttled button adds an affordance without adding a capability.
- **Alternatives considered** — Throttled poke (recommended, declined).
- **Consequences** — Notifications feature DD (still unopened) covers delivery mechanics. Nothing schema-side.

### Addendum (2026-08-21, M20/8, [#382](https://github.com/juggernog20/OpenLaw/issues/382)) — what actually reaches a requester, and when

The decision above promised notifications instead of a poke button and left the mechanics to the notifications record. NOT-002's M20/8 addendum has them. These are the intake-side facts.

**The four events are the four this decision named**, and they are one Notifier method each: the Request was created, its status moved, somebody replied on its thread, and it was declined with a reason. **Two of them fire in M20** — submission raises the receipt, and a Full Thread reply raises the thread reply — and the other two exist with no caller until M21's disposition routes.

**The receipt is the deliberate exception to "never tell somebody about their own act".** Its audience is the requester who just pressed Submit, because that is what a receipt is (INT-001). No other requester event has that shape.

**Legal's internal rooms stay internal.** A reply raises something at the requester only at Full Thread; a Legal Only or Working Team comment raises nothing at all (DD-016). The requester's own reply raises nothing either, so a thread nobody has answered leaves their bell exactly as it was.

**A decline carries its reason into the email, and the status change does not carry the decline.** INT-006 makes "no" arrive with a why, so the two are different messages and only one of them is sent for a declined Request. This is the one place the platform puts somebody's prose in an email — the reason was written to be read by this person, and unlike a comment it is not something a redact could ever have to reach.

**Every message links to the Request in the portal**, and the link works whether or not the reader still has a session: signed out it lands on the entry screen that sends a fresh link (the INT-001 M20/2 addendum), signed in it lands on the Request. The link is not carried through redemption — landing is by role (M20/2) — so a redeemed link puts the requester in the portal with their own list one click from the Request.

**Group 5 defaults are bell on and email immediate**, and an unexpressed preference takes the default. It is the one group whose email is on by default, and INT-003 is why: a requester does not live in the app, so email is the channel that keeps the promise this decision made when it declined the poke button.

### Addendum (2026-08-21, M20/10, [#384](https://github.com/juggernog20/OpenLaw/issues/384)) — the requester's email speaks a second status vocabulary, and nobody has chosen it

The status-change email translates the lifecycle before it says it: `new` reads "open" and `converted` reads "in progress", while `resolved` and `declined` keep their own words. The portal says something else on the same Request — the status pill reads "New" and "Converted", the words the enum uses. **So one person can be told two names for one status**, one in their inbox and one on the screen the email links to.

The translation is defensible on its own: `converted` is a fact about Legal's machinery — a record now exists — and "in progress" is what that means to the person who asked. INT-006 makes conversion the moment real work starts, so the requester-facing word is the truer one for them. What is not defensible is saying it twice, differently.

Neither vocabulary was chosen; the mail arm's own comment says as much, and this records it rather than leaving it in the code. **Nothing is wrong today**: `request.status_changed` has no caller until M21's disposition routes, so no requester has ever received the translated word. **M21 owns the choice**, and it is one choice for both surfaces — either the portal pill learns the requester's vocabulary, or the email drops it. A status that reads one way in the inbox and another on the page is the kind of small lie a requester notices and cannot resolve.

### Addendum (2026-08-22, M21/6, [#417](https://github.com/juggernog20/OpenLaw/issues/417)) — the vocabulary is chosen, and it is the requester's own

The M20/10 addendum above left the choice open and named the two ways out: the portal learns the email's words, or the email drops them. M21 owns the choice, and this is it.

**The requester-facing vocabulary is Open, In progress, Resolved, Declined**, and every surface a requester reads says those four and nothing else. The pill on my-requests, the pill on the Request detail, and the status-change and decline emails are one vocabulary. The email did not change, because the email was already right: `converted` is a fact about Legal's machinery and "in progress" is what that fact means to the person who asked, which is the truer word for the surface they read. So the portal learned the email's words rather than the email dropping them.

**One choice, both surfaces, and the enum is untouched.** `request_status` still holds `new`, `converted`, `resolved`, `declined`; nothing is renamed, migrated, or aliased on the wire. The translation happens at the last moment before a person reads it, which is where a translation belongs: two labels over one column, chosen by who is reading. `requesterStatusLabel` is the requester's four and `requestStatusLabel` is the enum's, and a surface picks the one its reader speaks.

**Staff keep the enum's own words**, on the Inbox's triaged toggle and on the staff detail's Outcome card. A triager works the machinery, so the machinery's words carry the fact they act on: "Converted" says a record now exists and "In progress" does not. That is not the M20/10 problem in reverse, because it is not the same person. A requester is told one name for one status; a triager is told one name for one status; nobody is ever told two.

**The colours do not fork.** There is one `REQUEST_STATUS_PILL` keyed on the enum, so an arm is the same status family whoever is reading it: information for `new`, success for `converted`, neutral for `resolved`, danger for `declined`. Only the word differs by audience.

**The `resolved` banner now says the request was answered and closed.** The INT-001 M20/5 addendum drew four banner arms when it built the banner, so M21/6 inherited them rather than writing them. Three stand as written. The resolved line said Legal had answered, which is half of what `resolved` means: an answered request is also a closed one, and a requester who is not told it is closed goes on waiting for a second reply. The `declined` arm already carries the recorded reason itself, as INT-006 requires.

**Recorded normalization point.** I5 and I7 draw the portal pill reading "New", "Converted", and "Resolved", which are the enum's words. The mocks were drawn before anybody noticed there were two vocabularies. The pill renders the requester's words instead. The mocks are the visual specification, and this is a copy decision the mocks do not settle.

## INT-004 — Deflection links panel in v1; conditional form logic stays deferred

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — The research-queued deflection layer and conditional-logic question.
- **Decision** — Admin-configurable links panel ("Before you submit…") on the portal home and optionally per request type — plain links (FAQ, policies; Knowledge items when that module lands). Conditional show/hide form logic remains deferred with the MTR-014 FUTURE-FEATURES entry (one entry covers matter forms and intake forms).
- **Rationale** — Deflection is the highest-leverage intake win at near-zero cost; the conditional-logic engine is not.
- **Alternatives considered** — Nothing (loses free deflection); building conditional logic now (reverses MTR-014's deferral).
- **Consequences** — `intake_links` (id, label, url, request_type_id nullable = home panel, display_order) — settings-managed. Settings inventory row added.

### Addendum (2026-08-20, [#356](https://github.com/juggernog20/OpenLaw/issues/356)) — deleting a request type takes its links with it, and the URL is validated but never normalized

The decision above named the table and left two questions to whoever built it. M19/6 built it, and these are the answers.

**A link's placement is its audience, so the FK cascades.** `intake_links.request_type_id` is `on delete cascade`. The sibling target FKs on `request_types` are `on delete set null` — they **demote**, turning "Contract · NDA" into "Contract" — and the same move here would do the opposite of demoting: a link an Administrator scoped to the Contract review form would appear, unasked, on the portal home in front of every requester. Widening an audience is not a demotion. Cascade also matches `request_type_fields`, the other child of `request_types`: the type carries its form definition and its deflection panel alike, and the blast radius is small either way, because a request type may only be hard-deleted when nothing has used it. An Administrator who wants the link to survive the type moves it to the portal home first, deliberately.

**The URL is validated as an absolute `http`/`https` address and stored exactly as entered.** Absolute, because the panel renders in a portal a requester reaches from their own browser, so a relative path would resolve against the portal and land nowhere; `http` or `https` only, because a `mailto:` is not deflection and a `javascript:` is an attack. Nothing normalizes it after that — no lower-casing, no trailing-slash trimming, no re-encoding — because a URL is a string a person pasted from somewhere that works, and a normalizer that is right 99% of the time is a link that is broken 1% of the time. The settings row renders it **without its scheme**, which is presentation and not storage.

**A link is removed, never archived.** Nothing points at a link and there is no history to keep, so there is no `archived_at`, no restore, no guard modal, and no slug — a link has no machine identity for anything to refer to. The pane is the DES-052 value list for exactly that reason.

**A placement being assigned must be a live request type.** An archived form takes no submissions, so a link scoped to it deflects nobody; the API refuses the assignment and the pane's picker offers live types only. The rule cuts one way: a link placed while the type was live stays put when the type is archived afterwards — the picker keeps that one archived type on offer for that row, so a label edit never forces a placement move. This is the same tolerance the INT-002 target keeps for an archived target type.

### Addendum (2026-08-21, M20/3, [#377](https://github.com/juggernog20/OpenLaw/issues/377)) — how the panel reads on the portal

M19/6 built the configuration; M20/3 built the panel a requester sees. Three things came out of it.

**The panel shows the label and nothing else.** The settings row draws the address without its scheme because an Administrator checking their own configuration needs to recognise the target. A requester does not: the label is the sentence written for them, and a URL beside it is machinery on a surface that has none. What the link points at is the stored string, unchanged — absolute, unnormalized, scheme intact.

**A deflection link opens beside the portal, not over it.** `target="_blank"`, with `rel="noreferrer"`. A requester who follows a link is usually part-way through deciding whether to submit at all, and taking the portal away to show them a wiki page costs them the place they were in. `noreferrer` keeps the portal's address out of the destination's logs, which matters because the destination is by definition somewhere else. The new tab is announced — each link carries a screen-reader-only "(opens in a new tab)" — because a sighted requester watches the switch happen and a screen-reader user does not.

**No links means no panel.** An instance whose Administrator has configured none draws nothing rather than an empty "Before you submit…" heading — a heading over nothing deflects nobody. The panel is independent of the picker in both directions: it renders when the picker is empty, because a link may be the answer the requester came for.

### Built addendum (2026-08-30, [#603](https://github.com/juggernog20/OpenLaw/issues/603)) — a deflection target is exactly one external address or Knowledge item

An intake link has exactly one target kind: its existing absolute `http`/`https` URL or a Knowledge item id. The Knowledge picker offers only live, published, `everyone` items, and choosing one defaults the editable label to the item's title. The DES-052 row shows that title for an internal target and keeps showing the scheme-less address for an external one.

Reach is evaluated when the requester reads the panel, on both the portal home and a request-type form. An internal link whose item later becomes draft, Legal only, or archived is omitted. Its Settings row is not removed: it retains the item id and last-known joined title so an Administrator can move, relabel, or remove it. This is the same preservation rule as an archived placement, now applied to the target side. Internal links open the portal article in the same tab; external links keep the M20/3 new-tab and `noreferrer` behavior.

## INT-005 — No auto-classification: the form is the classification

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — Whether v1 classifies inbound requests automatically.
- **Decision** — None. INT-001/002 dissolved the problem: the requester picks a request type and fills its structured form; there is no unstructured inbound to classify. AI intake assist (type suggestion, attachment extraction) stays parked in FUTURE-FEATURES (BYO-key pattern).
- **Rationale** — No AI dependency on the adoption-critical path; the type picker already does the job.
- **Alternatives considered** — AI type-suggestion at submission: marginal gain, real dependency.
- **Consequences** — None schema-side. Revisit only alongside the parked email-capture + AI-prefill future feature.

## INT-006 — Triage: one Inbox, pickup assignment, four actions, lossless re-convert

- **Status** — Accepted; assignment mechanic and Inbox scope revised by INT-007
- **Date** — 2026-08-05
- **Context** — The triage flow, resolved after the work-model research landed as **DD-018**. Every researched product — regardless of object model — runs a single triage queue with routing pre-encoded, not human-classified.
- **Decision** —
  - **The Inbox** (first nav slot — settles grill-plan B.1's lean) lists ~~`new` and `in_review`~~ requests, ordered by urgency then age. Member+ triages. _(Revised by **INT-007**: the Inbox lists `new` requests only — `in_review` no longer exists.)_
  - ~~**Pickup assignment**: `requests.assigned_to` (nullable FK → users) — picking a request up sets it and moves status to `in_review`.~~ _(Superseded by **INT-007**: no assignment step, no persisted intermediate status, and `requests.assigned_to` is dropped — acting on a request means choosing its disposition then and there.)_ No routing rules or rotation config in v1.
  - **Four actions**: **Convert** (target and type pre-selected from the request type per INT-002/DD-018 — triage confirms, never classifies; collected values pre-filled; MTR-014 required-field gaps prompted; MTR-013 template applicable for matters), **Re-target** (the exception path: convert to the _other_ kind — lossless, request survives as the portal shell per DD-018 rule 5), **Resolve** (reply in thread, close), **Decline** (reason required, requester notified).
  - No bulk triage and no auto-triage rules in v1.
- **Rationale** — Pickup beats a designated triage owner for a 2–10 person team (no bottleneck, no rotation config); the four actions are the complete set of honest outcomes for a request.
- **Alternatives considered** — Single triage owner: bottleneck + config. Per-request object-kind choice: rejected by DD-018 and by every researched product's happy path.
- **Consequences** — ~~`requests.assigned_to` in SCHEMA.md~~ _(removed by **INT-007**)_. Inbox screen is a v1 build surface (nav slot 1). Grill-plan B.1 resolvable as Inbox.

### Addendum (2026-08-22, M21/2, [#413](https://github.com/juggernog20/OpenLaw/issues/413)) — the Inbox read: its address, its toggle, its order, and the trail it draws

INT-006 named the Inbox and INT-007 shrank it to the undecided queue. These are the mechanics the first build of the list settled.

**The staff read is `GET /requests`, and the portal keeps `GET /portal/requests`.** Same rows, two projections, two gates — the M20/5 rule, which is what keeps either route from meaning two things. `POST /requests` stays the submission, because a write of the record is the same act whoever makes it and only a read's projection differs by audience (the M20/6 addendum's rule, applied to the list). The staff read is Member+ and refuses a Contributor and a Business User with 403 rather than answering them an empty queue: an empty list would say the Inbox is theirs and happens to be empty.

**The toggle is `includeTriaged=true`, and it widens rather than swaps.** It is the house shape every list filter in this API already wears — `includeArchived`, `includeEnded` — and it means what those mean: the default answer is the queue, and the flag adds the rows the default leaves out. So a triaged view is the whole intake picture rather than a second list, and the one ordering holds across both. The screen draws an Outcome column only under the toggle, because the default queue is all `new` and a column of one repeated word says nothing.

**The order is a triple: urgency rank, then the stamp, then the reference.** INT-006 asks for urgency then age; the reference is the third term because a keyset cursor over an ordering with unbroken ties skips and repeats rows, and the reference is unique and monotonic. `urgency` is `NOT NULL` on the table, so there is no unknown group to file last — every form collects a level. The page is 50, the contract list's number, and the foot states the ordering rather than leaving a reader to infer a product decision from a column of pills.

**A converted row's link is the server's to give, and its absence is the server's decision too.** The contract is joined under the caller's own reach (DD-014, CTR-021), so a confidential record this Member+ is not on contributes no row and the answer carries `null`. The client is never handed a reference it must decide not to render — the CTR-018 posture. The Request itself stays in the list either way: it is triage's business whatever became of it, and a row that vanished with its record would be the existence leak DD-014 exists to close.

**The Matter arm was deliberately absent in M21.** There was no row to join until the Matter table existed. M22/1 first extracted the shared converted-record projection, and M22/8 added the arm under Matter reach; the close addendum below records the resulting trail.

**Row navigation and the Assign button both open `/inbox/{number}`.** The Inbox is the staff destination and a Request opened from it stays under it, exactly as a contract record sits under `/contracts`. The portal keeps `/portal/requests/{number}` for the same row. What the Assign button opens once it lands there is INT-007's disposition entry, built in M21/7.

### Addendum (2026-08-22, M21/3, [#414](https://github.com/juggernog20/OpenLaw/issues/414)) — the staff detail read: what it answers, who it answers, and where the paper comes down

The M21/2 addendum settled the Inbox list. This is the screen a row opens.

**`GET /requests/{number}` is the staff detail, and the portal's own read is untouched.** The M20/5 rule again: same rows, two projections, two gates, and neither route ever means two things. The address is the R-### reference, because that is what the row links on and what a triager quotes. Member+ only — a Contributor and a Business User are refused with 403 rather than answered a stripped envelope, including the Requester themselves, whose window is the portal mount.

**Every status opens.** The Inbox is the undecided queue; the detail is the Request. A converted, resolved, or declined one still has an envelope, values, paper, and a thread, and the triaged toggle exists precisely so yesterday's decisions stay findable. Only an archived Request is absent, by the house rule that NULL means live. There is no scope to defend on the way in — Member+ read every Request — so the only miss the route can meet is a reference nobody has.

**The staff projection carries the requester's email; the portal's does not carry anything new.** The Inbox row states the person, and the detail is where a triager decides whether to answer in the thread or pick up the phone. It is one Request's requester rather than a directory read — the only other surfaces that answer an address are the Administrator's, and this one answers exactly the person who chose to write to Legal.

**The converted link is the Inbox row's rule, unchanged.** In M21 the Contract was joined under the viewer's own reach (DD-014, CTR-021), so a confidential record they were not on answered `null` and the Request still opened. M22 applies the same rule to Matters through the shared projection described below. The client is never handed a reference it must decide not to render (CTR-018).

**The paper comes down through the staff mount, under the portal download's own answer.** `GET /requests/{number}/attachments/{attachmentId}`, Member+, `application/octet-stream` with the same disposition and the same private cache rule — the type is never one a client declared, because the table stores none (DOC-004). Both mounts now send an attachment through one helper, so a reader's identity can never change what the bytes are answered as. An attachment id belonging to another Request is a miss rather than a refusal, exactly as on the portal.

**The thread is not part of this read.** It is one machinery keyed by an entity pair (CMT-001), the `request` arm already puts a Member+ in every room (CMT-010), and the screen mounts the same chat applet the contract record does. That is what makes Legal Only triage chatter and Full Thread requester-facing replies one conversation (DD-016). Posting into it writes nothing on the Request: **replying never changes a status**, which is INT-007's whole point about clarifying back-and-forth, and the detail has no write route at all until disposition lands (M21/7–9).

**What is not answered, and why.** No previous-request count for the requester and no department: a user has no department on this model, and a count of somebody's other asks is a claim about their history nothing has decided to make. No attachment size and no uploader: a Request's attachment stores neither, and every file on one was put there by its Requester. The screen's reading of all of this is DES-057.

### Addendum (2026-08-22, M21/12, [#423](https://github.com/juggernog20/OpenLaw/issues/423)) — a converted link goes missing for a second reason, and the record only named the first

Read back at the M21 close. The M21/2 and M21/3 addenda give exactly one reason a converted Request's row carries no C-###: DD-014 reach, a confidential record this Member+ is not on. There is a second, and the build put it in the join without saying so.

**An archived contract drops off the trail too.** Both staff reads join the contract under `archived_at is null`, so the Inbox's Outcome column and the detail's Outcome card say "Converted" with no reference for a record that exists and that this reader could open. The 409 a losing triager gets carries the same `null` for the same reason. It is the house rule — archived means off every list — applied to a join rather than to a list, and it is the right default: the trail points at live work.

**What it costs is worth writing down.** "Converted, and I cannot see into what" now means either "not yours to see" or "the record was archived", and the screen says neither. A reader who can archive a contract can also find it, so nothing is unrecoverable; what is lost is the one-click trail INT-006 asked for, silently. No repair is built here. The milestone that gives a Request an archive surface of its own is the one that will have to say what an archived record's trail reads as, because it will meet the same question from the other side.

### Addendum (2026-08-23, M22 close, [#474](https://github.com/juggernog20/OpenLaw/issues/474)) — the trail has two record arms

The Inbox row, staff detail, disposition conflict, and Requester's stable portal window now read one module-aware converted-record projection. Its Matter arm joins `converted_matter_id` under the viewer's matter reach predicate and the same live-record rule as Contracts: an unreachable confidential or archived Matter yields no reference and leaks neither title nor number. A reachable one yields `{ module: "matter", number }`, so both staff surfaces link to `/matters/{number}` without client-side permission logic.

### UX review addendum (2026-09-05): Inbox quick filters and saved views

Inbox adopts the shared filter bar, managed columns, and private saved views used by Contracts and Matters. This supersedes the earlier toggle-only presentation. The built-in view shows a visible **Status: New** filter; removing it includes all triage outcomes. Status, request type, urgency, and requester support searchable multi-selection (OR within a field, AND across fields). Received date supports inclusive ranges in the viewer’s timezone. Choices come from the whole live collection, including past requesters and retired types with existing requests. Filters and matching totals are applied server-side before pagination. The urgency-then-age queue order remains unchanged.

The Assign action occupies a fixed trailing column outside the editable catalogue and saved layouts. Summary always absorbs the remaining width. Resizing another data column trades space only with Summary and stops at its minimum; resizing Summary trades with the next visible column (or the previous one if Summary is last). Other widths remain steady during the drag. If the viewport cannot fit the columns’ minimum widths, the data scrolls while Assign remains pinned and visible.

Views store filters and column layout under the `inbox` surface, with save, rename, default, reset, and delete controls. URL filters and the selected view survive reload and browser history; explicit filter links override the saved default. Clearing filters widens the list, and an empty filtered result says so. The existing `includeTriaged` API query remains compatible. Member+ retains sole access to the list and filter options, and converted-record links remain subject to the caller’s record access.

## INT-007 — Disposition-at-pickup: triage decides the outcome; no parked in-review state

- **Status** — Accepted
- **Date** — 2026-08-08
- **Context** — Design review of the Inbox/detail mocks (I1/I2). Under INT-006's pickup model, an assigned request sat in the Inbox as `in_review` with no forcing function — it could linger indefinitely, and an assigned-but-undispositioned row read as a duplicate of the matter/contract it would eventually become. Blair: assignment should require conversion. The strict form ("assigned ⇒ must convert") collides with INT-002's no-target request types and the Resolve/Decline outcomes, so it was refined to disposition-at-pickup.
- **Decision** —
  - **There is no assignment step and no parked state.** Acting on a request from the Inbox means choosing its outcome then and there: **Convert** / **Resolve** / **Decline** (Re-target remains the exception path inside Convert, per INT-006/DD-018).
  - **The Inbox row affordance is an Assign button** (2026-08-08 follow-up): it assigns the triager and immediately opens the disposition flow. Assignment is not a persisted intermediate status — cancelling the flow returns the request to the queue untouched.
  - **Lifecycle (revises INT-001)**: `new → converted | resolved | declined`; `in_review` is removed; `archived_at` separate.
  - **The Inbox lists `new` requests only** — it is exactly the undispositioned queue. A toggle reveals triaged (converted/resolved/declined) requests.
  - A substantive legal question doesn't linger: per DD-018, real work converts — it becomes a matter. Trivial ones are answered in the thread and resolved.
  - Clarifying back-and-forth with the requester remains possible while a request is `new` (the portal thread is live from submission); replying does not change status.
  - **`requests.assigned_to` is dropped.** Who dispositioned a request is audit data on the conversion/resolution/decline event, not a live assignment.
  - **Disposition is atomic on `new`.** The server transitions a request only from `new`; with no claim mechanism, two triagers can open the flow for the same request, and the loser's Convert/Resolve/Decline must return the recorded outcome instead of creating a second conversion, resolution, or decline event.
- **Rationale** — Nothing can rot in an intermediate state; the Inbox reads truthfully as "requests whose fate is undecided"; a request and its converted object never coexist as live work items.
- **Alternatives considered** — Claim-then-convert deadline (keep `in_review`, escalate age-since-assignment): keeps the limbo state, only softens it. Strictly forced conversion on assignment: breaks no-target request types and Decline.
- **Consequences** — INT-001's lifecycle enum and INT-006's pickup mechanic annotated as revised. SCHEMA.md: `assigned_to` removed, `status` enum shrinks. Inbox mock loses Status/Assignee columns but keeps a per-row Assign button as the entry to disposition; request-detail hero loses Assignee; the subbar's Convert/Resolve/Decline actions are the whole triage surface. Trade-off accepted: no claim mechanism to signal "I'm reading this" — fine at 2–10 person team scale; revisit if duplicate triage effort shows up in practice.

### Addendum (2026-08-22, M21/7, [#418](https://github.com/juggernog20/OpenLaw/issues/418)) — the disposition scaffold, and the first outcome through it

INT-007 removed the claim step and the parked state. This is what the three outcomes share, settled by building the first of them.

**A disposition is one guarded act, and it lives in one place.** `disposition.ts` takes the Request's row lock, refuses anything but `new`, runs the outcome's own work, and reads the envelope back — all in one notifying transaction. Resolve (M21/8) and Convert (M21/9) hang their work on it rather than restating any of that, so what a disposition route says is what it writes and which event it raises. `FOR UPDATE` is taken **before** the status is read, the contract renewal's rule (CTR-006): an unlocked read lets a concurrent disposition commit between the check and the write, and both triagers then believe they decided.

**The loser of a race is answered the recorded outcome, as a problem type carrying it.** `urn:openlaw:problem:request-dispositioned` at 409, with the decision on an RFC 9457 §3.2 extension member named `outcome`. A client branches on the type and reads the member; it never parses `detail`, which is copy. That is the soft gate's house style (TECH-020) with one addition — `HttpError` now carries extension members, because this is the first refusal in the API whose _content_ a client acts on rather than prints. Without the member, the losing client would have to guess or re-read to find out whether the winner converted, resolved, or declined, and INT-007 asks for it to be told.

**A refused disposition writes nothing.** No second event, no second entry, no second email, and the first triager's reason untouched. That falls out of the lock rather than being checked for: the guard throws before the outcome's work runs, and the transaction that would have carried it never opens.

**The disposition answers the staff envelope.** The same shape `GET /requests/{number}` answers, read back inside the transaction. The house shape for a write, and the shape Convert needs — the record a conversion made is part of what it did. The screen still re-reads, because the Outcome card, the status pill, and the thread's watermark all hang off one loader and one revalidation is what keeps them from disagreeing.

**Decline's reason is required, refused by name, and not in the log.** INT-006 makes "no" arrive with a why, and the reason is the whole of the answer the requester gets: stored on the Request, carried into the email, rendered verbatim on the portal banner. A blank one — or one of spaces — is refused with the field named rather than accepted empty. The `request.declined` activity entry carries the actor and the Request's number and **no reason at all**: DD-017 forbids `UPDATE` and `DELETE` on the log, so text that enters a payload can never leave it, and the reason belongs where a correction can still reach it. Who declined is the audit datum INT-007 asks for, and it is the entry's actor rather than a column on the Request.

**`requestDeclined` fires instead of `requestStatusChanged`, never beside it** — the M20/8 rule, first exercised here. A decline is a status change and it is also the news that Legal said no with a reason, and those are one act. The M20 seam already held both methods with no caller; the decline route is `requestDeclined`'s one caller and does not raise the other.

**Assign is still not a write.** The Inbox row's button opens `/inbox/{number}`, where the sub-bar now carries the disposition. Nothing about the Request changes when the dialog opens, so cancelling returns it to the queue untouched — which is the whole of what INT-007 means by "assignment is not a persisted intermediate status".

### Addendum (2026-08-22, M21/8, [#419](https://github.com/juggernog20/OpenLaw/issues/419)) — Resolve: the answer and the closure are two things

The M21/7 addendum settled the scaffold by building Decline through it. Resolve is the second outcome, and it is the one that needed the scaffold to carry more than a status write.

**Resolve is one route over `dispositionOf`, and it restates none of it.** `POST /requests/{number}/resolve`, Member+, with the lock, the `new` guard, the recorded-outcome refusal, and the envelope read all the scaffold's. What the route says is what it writes: the optional closing reply, then the move to `resolved`, then the narration, then the event. The scaffold fitted as it was built — nothing about it had to widen for a second outcome, which is the claim M21/7 made and this is the first test of.

**The closing reply is optional, and an omitted one is genuinely omitted.** INT-006 asks for a reply rather than requiring one, because by the time somebody presses Resolve the answer is usually already on the thread and a second copy of it is noise. The body's `reply` is absent or it is text; a blank string is refused rather than posted, because a comment with no words in it is not an answer. The screen sends no `reply` at all when its box is empty, so the refusal only ever meets a client that did not come from it.

**When it is given it is an ordinary Full Thread comment, written through the composer's own call.** Not a special kind of row and not a column on the Request: it lands on the thread, narrates as `comment.posted` at its own tier, and raises `requestReplied` exactly as a staff reply from the panel does. The tier is fixed rather than offered — a closing reply the requester cannot read is an internal note, and the thread's composer is where those are written (DD-016). `comments/post.ts` now holds the insert, the `comment_mentions` rows, the entry, and the arm's event, and `POST /comments` and Resolve both call it, so there is one place any of the four can be forgotten. M21/9's conversion inherits that call.

**The reply and the closure are different news, and both fire.** `requestStatusChanged` is raised beside `requestReplied`, and this is `requestStatusChanged`'s **first caller** — the M20/8 catalogue, which shipped with none. That is deliberately not Decline's shape: a decline's reason and its closure are one act, so `requestDeclined` fires _instead of_ the status change. A resolution's answer and its closure are two acts, so the requester may hear about both. The seam decides who hears what, as always: a Full Thread reply reaches the Requester and a Legal Only one would not, and the actor hears neither.

**The narration says who resolved, and not what they said.** `request.resolved` carries the actor and the Request's number, matching the decline entry. The words are on the thread, where a redact can still reach them (CMT-008), and the log is append-only. A resolution with a closing reply and one without read identically on the feed, because what the entry records is the closure.

**A refused resolution posts nothing.** The guard throws before the outcome's work runs, so the loser of a race leaves no comment on somebody else's decision — the same absence M21/7 recorded for the decline reason, now proved for a comment.

**The banner's resolved arm has its writer.** The INT-003 M21/6 addendum chose the requester's vocabulary and drew all four arms; the `resolved` one had nothing that could produce it. It does now, and the row moves under the Inbox's triaged toggle.

### Addendum (2026-08-22, M21/9, [#420](https://github.com/juggernog20/OpenLaw/issues/420)) — Convert: the record is born with the values carried through

Decline proved the scaffold and Resolve proved it fitted a second outcome. Convert is the third, and it is the one the Inbox exists to reach. These are the choices building it settled.

**The scaffold carried Convert with one addition, and it is on the wire rather than in the code.** The lock, the `new` guard, the refusal, and the envelope read are unchanged. The 409 gained a second RFC 9457 extension member, `convertedContract`, holding the C-### the winner made — because the M21/2 addendum already promised "the outcome and, for a conversion, the record it became", and because "somebody converted this" without the number is news the loser cannot act on. It is `null` on every other outcome and `null` on a record the caller cannot reach, joined under the envelope's own DD-014 rule, so a refusal never hands a client a reference the read would have withheld. `HeldRequest` did not widen: a route that needs more of the Request reads more of it, inside the transaction the lock is already held in.

**Triage confirms the routing, and the seam is what enforces it** (DD-018 rule 2). `contractTypeId` is optional on the body and is only _accepted_ where the request type names no live contract type. Where it names one, that type is the target and a body naming a different one is refused by name; a body repeating it is accepted, because echoing what you were shown is agreeing rather than classifying. So the one genuine choice — the module-only target the form honestly deferred — is the only place a picker appears, and re-typing a Request onto a different kind of contract is not something a triager can do by hand. The Administrator's configuration is the routing, as DD-018 says.

**An archived target type reads as no type on the staff reads too, not only at conversion.** INT-002's addendum settled the conversion half. This one moves the rule onto the join both staff reads already make, so the Inbox row, the detail hero, the Convert dialog, and the conversion route cannot disagree about which type is being confirmed. "Contract · NDA" becomes "Contract" the moment the NDA type is archived, which is the truthful reading: the Inbox row exists to say how much of the routing is already decided, and a retired type decides nothing. The Matter half was written at the same time and became active with M22, so both modules now hold the same rule. `StaffRequestTypeSchema` gained `targetTypeId` beside `targetTypeName` — the dialog needs the id to know whether the routing it is drawing is the bound one, and the schema is where "live" is already decided.

**Re-target is the module exception and the only one** (DD-018 rule 5). In M21 a Request whose type targeted a Matter, or nothing, could convert into a Contract by naming one; the dialog said the act was a re-target and deliberately offered no Matter option before Matters existed. M22 completed the symmetric direction on the same door, as the close addendum below records. The Request survives as the requester's portal shell in either direction.

**Carry-through is landed by the server, and the dialog sends no collected value back.** INT-002's promise that nothing is re-keyed is a rule, and a rule a browser holds is not a rule: the route reads the Request's own `custom_fields` under the lock and lands every value whose slug the target type also attaches. The body's `customFields` is for the _gaps_ — the fields the target type hard-requires that no collected value answers (CTR-016/MTR-014) — and the triager's answers go on top of the carry, so an edit made in the dialog wins and an absent carry is filled. An empty hard-required field refuses the whole conversion by name and writes nothing at all: no contract, no status move, no back-link, no entry.

**A collected value with nowhere to land is named before the press and left whole after it** (the INT-002 M19/7 addendum's bill, paid here). The dialog lists it under its own heading and says nothing is deleted; the route writes it nowhere; the Request keeps its `custom_fields` entire and both details go on rendering it. Values are copied, never moved.

**The record is born ordinary, and the create callable gained exactly one thing.** The C-### sequence, the protected draft seed, the creator's provenance row and no other team member, no Owner, no Confidential flag — the M16 successor rule's sibling, unchanged. The one addition is `priority`, because MTR-012 maps the requester's urgency onto it 1:1 at conversion: that is a fact somebody stated, carried rather than assessed, and no other caller of the create holds one. There is no `risk` beside it and there never will be — risk is legal's assessment, nobody has made it at birth, and a requester never sets it.

**Both records narrate, each by the other's permanent reference.** `request.converted` on the ask carries the R-### and the C-### it became; `contract.created_from_request` on the record carries its own number and title and the R-### it came from. Neither carries free text, for the reason the decline reason is not in its entry: the log is append-only. The contract-side entry sits _beside_ `contract.created` rather than replacing it, because a contract born by conversion is an ordinary contract and where it came from is a second sentence about the same birth.

**`requestStatusChanged` fires, and no conversion event of its own.** Resolve's shape rather than Decline's: the closure is the whole of the news, and in the requester's own vocabulary it reads "In progress" (the INT-003 M21/6 addendum). The Inbox row's converted link now has its writer, and the portal banner's converted arm does too.

**Two seams are left open on purpose, both inside this transaction.** The paper is not yet promoted into `documents` ([#421](https://github.com/juggernog20/OpenLaw/issues/421)) and the thread is not yet re-parented onto the record ([#422](https://github.com/juggernog20/OpenLaw/issues/422)). Both are additive steps beside the create, and neither leaves anything broken in the meantime: an attachment stays readable and downloadable on the Request, and the thread stays on the Request's own entity pair, which is where the portal already reads it.

> **The first of the two is closed by the INT-002 M21/10 addendum above.** The paper is promoted inside this transaction, between the create and the status write, and the attachment rows and their blobs stay where they are. The thread seam is still open.

### Addendum (2026-08-22, M21/12, [#423](https://github.com/juggernog20/OpenLaw/issues/423)) — two rules of Convert's body that were written only in the route

Read back at the M21 close. Decline's reason has its rule written down — trimmed, required, capped, refused by name (M21/7). Convert's title has the same rule and nobody wrote it, and the body carries a third behaviour the M21/9 addendum does not name.

**The title is the box's, trimmed, required, and capped at the contract title's own bound.** The route never re-reads the Request's summary: the dialog seeds the box from it and what is in the box at the press is what the record is born with, so a triager who sharpened a vague summary gets the sharpened one and a triager who cleared it is refused rather than quietly handed the old one back. A title of nothing but spaces is the same as no title — `Name the contract — a conversion is refused without a title.` The cap is the contract's, because the thing being named is a contract.

**A `null` in the body's `customFields` cancels a carry, silently.** The triager's answers land on top of the carried values, so a key the body repeats wins; a key the body sends as `null` clears rather than lands, and where nothing was stored it simply does not arrive — no refusal, no narration, no trace that a collected value was vetoed. The dialog never sends one, so this is the API's surface and not a screen's. It is recorded rather than closed because the alternative is a refusal, and refusing `null` on a route whose whole job is filling gaps would make "answer this field with nothing" impossible to say. What the record now states is that the veto exists and that no screen offers it.

### Addendum (2026-08-22, M21/13) — Home takes slot one and the Inbox follows it

INT-006 put the Inbox in the first nav slot, and the M21/2 build did that. Sitting with the shipped nav, the order reads wrong: the first thing in the bar is the one destination two of the four roles cannot see at all.

**Home is slot one; the Inbox is slot two.** Home is where sign-in lands and the only destination every role holds, so the nav now opens with an entry that is never absent. For a Contributor or a Business User the old order meant the bar began at whatever survived the role filter, which is a first slot that moves depending on who is looking. The Inbox keeps everything else the M21/2 addendum gave it — its address, its Member+ floor, and its being one click from anywhere — and gives up only the position.

> **INT-006's original decision named the first nav slot** ("_The Inbox_ (first nav slot — settles grill-plan B.1's lean)"), and its consequence line reads "Inbox screen is a v1 build surface (nav slot 1)". ~~Both are superseded on the position alone~~ — the Inbox is slot two. Grill-plan B.1 is still resolved as Inbox rather than Dashboard: the question there was which surface intake gets, not where its entry sits in the bar.

Nothing about triage changes. The registry is still the only thing the nav renders from, a destination is still registered by the milestone that ships its surface, and a role floor still means absent rather than disabled (SET-002).

### Addendum (2026-08-23, M22 close, [#474](https://github.com/juggernog20/OpenLaw/issues/474)) — Convert is one guarded door with two arms

The `new` row lock, single transaction, 409 loser, and no-claim UI now serve Contract and Matter conversion alike. The body may name one destination type and never both; a bound live target is confirmed, a module-only target is completed, and switching modules is the one explicit Re-target exception in either direction. Matter conversion calls the ordinary matter-create callable with the Request summary as title, urgency as priority, risk unset, Manager unassigned, confidentiality off, and only the triager's creator row. It then writes `converted_matter_id`, carries paper and thread before commit, narrates both records by permanent reference, and emits the same requester-facing In progress event. A rollback leaves no Matter, document, moved thread, backlink, or notification behind.

## Index of decisions

| #       | Decision                                                                     | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INT-001 | Intake model: JSM-style structured forms + portal; email notifications only  | Accepted; lifecycle revised by INT-007; landing and dead-link mechanics added by M20/2 addendum; requester-facing reads added by M20/3 addendum; my-requests and the request detail added by M20/5 addendum; the request thread added by M20/7 addendum; the portal chrome's two destinations added by M20/9 addendum; the unpaged list and the unresolvable-id fallback recorded by the M20/10 addendum                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| INT-002 | Request types mapped to target types; forms reuse the fields catalog         | Accepted; three-state target added by M19/4 addendum; out-of-scope attachment recorded by M19/7 addendum; submission added by M20/4 addendum; request attachments added by M20/6 addendum; the unanswerable required `user`/`entity` field left open for M21 by the M20/10 addendum and settled by the M20/11 addendum, which refuses the flag on this mount alone; carry-through, the archived target type, and the value with nowhere to land built by the INT-007 M21/9 addendum; attachment promotion built by the M21/10 addendum; the archived carried reference ([#437](https://github.com/juggernog20/OpenLaw/issues/437)), the conversion's lock order, the promoted document's title, note, and confidentiality, the post-conversion attachment ([#438](https://github.com/juggernog20/OpenLaw/issues/438)), and the dialog's two-list collision over a detached field recorded by the M21/12 addendum; the archived carried reference answered by the [#437](https://github.com/juggernog20/OpenLaw/issues/437) addendum, which shows the value as dead and gives the dialog a box for it; the post-conversion attachment answered by the [#438](https://github.com/juggernog20/OpenLaw/issues/438) addendum, which refuses the upload and sends the paper to the thread (CMT-011) |
| INT-003 | Requester updates: email notifications only; no status-poke button           | Accepted; what fires and what it says added by M20/8 addendum; the unchosen requester-facing status vocabulary left open for M21 by the M20/10 addendum and chosen for both surfaces by the M21/6 addendum                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| INT-004 | Deflection links panel in v1; conditional form logic stays deferred          | Accepted; delete behavior and URL rule added by M19/6 addendum; portal rendering added by M20/3 addendum                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| INT-005 | No auto-classification: the form is the classification                       | Accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| INT-006 | Triage: one Inbox, pickup assignment, four actions, lossless re-convert      | Accepted; revised by INT-007; the Inbox read's address, toggle, ordering, and converted-link rule added by the M21/2 addendum; the staff detail read, its projection, and the staff attachment download added by the M21/3 addendum; Decline's required reason and its narration added by the INT-007 M21/7 addendum; Resolve's optional closing reply added by the INT-007 M21/8 addendum; Convert, the confirmed target, and Re-target added by the INT-007 M21/9 addendum; the archived contract's dropped trail recorded by the M21/12 addendum; the first nav slot given to Home by the M21/13 addendum                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| INT-007 | Disposition-at-pickup: triage decides the outcome; no parked in-review state | Accepted; the triaged toggle's shape recorded by the INT-006 M21/2 addendum; "a reply changes no status" pinned by the M21/3 addendum; the disposition scaffold, its race problem type, and Decline added by the M21/7 addendum; Resolve, its two events, and the shared comment write added by the M21/8 addendum; Convert, its server-landed carry-through, and the refusal's second extension member added by the M21/9 addendum; the paper Convert promotes recorded by the INT-002 M21/10 addendum; Convert's title rule and the body's silent `null` veto recorded by the M21/12 addendum                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### UX review addendum — request triage menu (2026-09-05)

The request detail now has one primary **Triage** dropdown: **Convert to contract**,
**Convert to matter**, and **Resolve request without converting**. Choosing a conversion
opens that module's form, even when the request type routes to the other module.
Decline is removed from the staff action menu; historical declined outcomes remain readable.

Resolving requires a nonblank explanation in the dialog and API, superseding the optional
closing reply in the INT-007 M21/8 addendum. The note is a requester-visible Full Thread
comment and is saved in the same transaction as the resolved status, activity and
notifications. The dialog states that the note appears on the thread and is emailed to
the requester. Cancelling makes no changes.

### INT-007 UX review addendum — triage assignment (2026-09-05)

Assignment now records the person responsible for triaging a Request. This supersedes
INT-007's previous rule that Assign only opens the disposition flow. It does not introduce
another status or prevent other Legal Team Members from triaging the Request.

The Inbox's fixed Assign column opens a searchable modal of active Administrators and
Legal Team Members. Saving replaces Assign with the person's avatar; clicking it reopens
the modal. The intake page also shows the assignee and supports reassignment. Clearing
restores the unassigned state. Closed Requests retain their historical assignee and cannot
be reassigned.

The API validates eligibility and serializes assignment with disposition using the Request
row lock. Assignment, activity and notification commit together. The new assignee receives
an Assigned to you notification pointing to the intake, subject to their preferences;
self-assignment and unchanged assignments do not generate notifications. Assignment does
not change the Request's status or assign ownership of a later Contract or Matter.

### INT-001 UX review addendum — portal layout and themes (2026-09-06)

Your requests spans the full portal content width below the request-type picker and
Before you submit panel. On narrow screens the order remains picker, guidance, requests.
The portal header offers Light, Warm and Dark to every signed-in requester, including
Business Users. Theme changes apply immediately and save through the existing personal
preference endpoint. A failed save restores the previous theme and reports the failure.
