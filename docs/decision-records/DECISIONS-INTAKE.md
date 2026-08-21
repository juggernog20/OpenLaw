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

**`requests.converted_matter_id` lands without its foreign key.** SCHEMA.md records it as a reference to `matters.id`, and `matters` arrives in M22. The column is here because INT-006's conversion is one of two shapes and a table that could only record one of them would be a table that lies about the model; the constraint arrives with the table it points at. A check constraint already holds the pair to at most one non-null, so "a Request becomes one record" is the table's rule rather than the conversion route's.

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

## INT-003 — Requester updates: email notifications only; no status-poke button

- **Status** — Accepted
- **Date** — 2026-08-04
- **Context** — Whether the portal gets a LawVu-style "Request a status update" button. Blair: "No — notifications suffice."
- **Decision** — Requesters receive host-configurable email notifications (creation + status changes, deep-linking to the portal per INT-001) and can reply in the request thread. No dedicated poke affordance.
- **Rationale** — The thread already allows asking; a throttled button adds an affordance without adding a capability.
- **Alternatives considered** — Throttled poke (recommended, declined).
- **Consequences** — Notifications feature DD (still unopened) covers delivery mechanics. Nothing schema-side.

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

## Index of decisions

| #       | Decision                                                                     | Status                                                                                                                                                                                                      |
| ------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INT-001 | Intake model: JSM-style structured forms + portal; email notifications only  | Accepted; lifecycle revised by INT-007; landing and dead-link mechanics added by M20/2 addendum; requester-facing reads added by M20/3 addendum; my-requests and the request detail added by M20/5 addendum |
| INT-002 | Request types mapped to target types; forms reuse the fields catalog         | Accepted; three-state target added by M19/4 addendum; out-of-scope attachment recorded by M19/7 addendum; submission added by M20/4 addendum; request attachments added by M20/6 addendum                   |
| INT-003 | Requester updates: email notifications only; no status-poke button           | Accepted                                                                                                                                                                                                    |
| INT-004 | Deflection links panel in v1; conditional form logic stays deferred          | Accepted; delete behavior and URL rule added by M19/6 addendum; portal rendering added by M20/3 addendum                                                                                                    |
| INT-005 | No auto-classification: the form is the classification                       | Accepted                                                                                                                                                                                                    |
| INT-006 | Triage: one Inbox, pickup assignment, four actions, lossless re-convert      | Accepted; revised by INT-007                                                                                                                                                                                |
| INT-007 | Disposition-at-pickup: triage decides the outcome; no parked in-review state | Accepted                                                                                                                                                                                                    |
