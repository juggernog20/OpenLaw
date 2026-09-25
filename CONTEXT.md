# OpenLaw

Legal department management for a 2–10 person in-house legal team: intake of legal requests from the business, contract lifecycle, matter tracking, document management, and corporate entity management. Single-tenant per deployment, self-hosted.

This glossary was backfilled from the accepted decisions in `docs/decision-records/`. Where a term's meaning is fixed by a decision, the ID is cited — that record is the authority, this is the index.

## Language

### Work objects

**Matter**:
A work container for legal effort whose deliverable is not a signed document — advice, disputes, investigations, projects [DD-018].
_Avoid_: case, project, ticket, engagement

**Contract**:
A workspace for work whose deliverable is a signed document; the draft→signature→active pipeline is the work tracking [DD-018].
_Avoid_: agreement, deal, paper

**Request**:
The structured envelope a Business User submits through the portal, before triage decides what it becomes [INT-001].
_Avoid_: ticket, intake item, submission, enquiry

**Document**:
A logical file record owned by exactly one Matter, Contract, Entity, Knowledge Item, or Auto-Doc; carries no workflow of its own [DOC-008, ADO-001].
_Avoid_: file, attachment, upload

**Document Version**:
An immutable file snapshot in a document's strictly linear chain; corrections append a new version rather than editing one [DOC-001].
_Avoid_: revision, draft, copy

**Document type**:
What the team calls a Document Version, picked from its owning module's list (Matters, Contracts, Entities). Optional. The six Contract negotiation types are fixed because code reads the kind they stand for. A Knowledge Item's files have no list; they show the item's Knowledge type [DOC-015].
_Avoid_: document kind (the stored kind follows the type), category, tag

**Comparison**:
One derived reading of two Versions of one Document, the older against the newer, held as a change model. A Word pair also retains a tracked-changes file. It is computed once and kept, and it is never a Version [DOC-003].

**Generated redline**:
The Version a Comparison's export appends to the chain, kind `generated_redline`, source `generated`, carrying both operands; it is a fact about how a file was made and is never correctable [CTR-014, DOC-001, DOC-003].

**Analysis run**:
One durable reading of a Contract's chosen Document Version, or its eligible original Request context after conversion, against that Contract's current AI target schema. It is triggered automatically or manually, moves from pending to ready or failed, and records the provider model, evidence, and each writer outcome. It is an account of what the extraction did, not a proposal waiting to be accepted [CTR-008, TECH-012].
_Avoid_: AI job, analysis result, extraction proposal

**Answer style**:
The form of an AI-extracted text Field value: Few word summary, 1-2 sentence summary, or Full clause text. Contract Fields may override the organization default [CTR-008].

**Knowledge Item**:
A curated piece of know-how — template, precedent, playbook, or article — distinct from the documents it owns [KNW-001].
_Avoid_: article, wiki page, resource

**Knowledge Folder**:
A nested folder that organizes Knowledge Items in the Knowledge destination. It does not organize the Documents inside an item. The tree starts blank, and Type remains a separate filter [KNW-003, DOC-006].
_Avoid_: Document folder, library type, category

### Auto-Docs

**Auto-Doc**:
One approved Word template, the form that fills it, and the settings that govern its use, held as a record of its own. Legal maintains it; a Generation consumes it. It may target a Contract Type, in which case a Generation creates a Contract [DD-022, ADO-001, ADO-005].
_Avoid_: template (that is a Matter template or a Knowledge type), document template, form (that is the Auto-Doc's form, not the Auto-Doc)

**Placeholder**:
One double-brace marker inside an Auto-Doc's Word file, such as `{{counterparty_name}}`, that a form field fills at Generation [DD-022].
_Avoid_: variable, merge field (a specific Word feature this is not), field (that is the catalog)

**Form field**:
One question on an Auto-Doc's form. It either fills a Placeholder or collects a value the document does not print. It belongs to its Auto-Doc and is not a catalog Field, though it may map to one so the answer lands on the created Contract [DD-022].
_Avoid_: Field (the catalog entry), question, input

**Block**:
A named span of an Auto-Doc's Word file, marked `{{#block name}} … {{/block}}`, that a Clause rule includes or omits at Generation. The text stays in the file with its own formatting. The editor detects Blocks from the file; a person never names one by hand [DD-022].
_Avoid_: clause (that is legal content, which a Block may hold), section, optional paragraph

**Clause rule**:
A condition on an Auto-Doc's form, written in the form editor, that decides whether one Block is included: "include `arbitration` when `jurisdiction` equals United States" [DD-022].
_Avoid_: conditional, trigger, if-statement, formula

**Filing**:
Adding a Generation's output to an existing Matter or Contract as a new Document, or creating a new Contract from it. Member+ may File to reached records and may choose a destination on the Generation form. Business Users may File to records they hold a team row on in the Portal. Each Filing makes a separate Document; the Generation keeps its own copy and its Filing history [DD-022, ADO-005].
_Avoid_: attaching, moving, linking, converting (that is the Request act)

**Generation**:
One act of filling an Auto-Doc: who, when, which live pair, the answers given, and the output produced. It moves from pending to ready or failed, and it is the unit of Auto-Doc audit. A Generation is never a Document; Filing makes a Document from it [ADO-005, ADO-007].
_Avoid_: run (that is an Analysis run), submission, request (that is the intake term), export

**Live pair**:
The one file Version and the one form version that Publish pinned together on an Auto-Doc. Every Generation cites its live pair. Editing either chain changes nothing until the next Publish; Unpublish clears the pair and deletes nothing [ADO-004].
_Avoid_: current version, published version (there are two), release

**Assignment rule**:
An ordered condition on one Auto-Doc form field that names the Legal Owner of a Contract a Generation creates. First match wins; an optional default closes the list. It uses the same operators as a Clause rule [ADO-006].
_Avoid_: routing rule, owner rule, workflow

**Unassigned contract**:
A Contract a Generation created that has no Legal Owner, including when no Assignment rule matched and no default supplied one. It waits on the Inbox's Unassigned contracts tab until a Member+ claims it [ADO-006].
_Avoid_: orphan contract, pending contract, triage item

**Auto-Doc audience**:
Who reaches an Auto-Doc in the Portal: **Legal only**, **Selected** (named users and Departments), or **Everyone**. New use requires a published Live pair; the person's own Generation history survives Unpublish or Archive but still requires audience reach. Member+ reach every Auto-Doc in the app whatever the audience [ADO-009, ADO-010].
_Avoid_: visibility, permissions, sharing

**Acknowledgement**:
The statement a Business User must accept before using an Auto-Doc, with an org-wide default text overridable per Auto-Doc, at a per-Auto-Doc frequency of every use, once per Auto-Doc, or once across the organization. An Auto-Doc may also require none. Editing the text resets it. Member+ never acknowledge [ADO-008].
_Avoid_: consent, attestation, terms, disclaimer

### Parties

**Entity**:
One of _our own_ corporate entities — a subsidiary, holding company, or branch [DD-008].
_Avoid_: company, organisation, party, counterparty, subsidiary

**Holding**:
A directional ownership fact between two Entities, recording the percentage one Entity owns of the other. Holdings form the ownership graph; they do not make either Entity a child record [ENT-003].
_Avoid_: parent link, ownership relation, shareholding record

**Share class**:
One class of shares an Entity may issue, with its authorized count, par value, votes per share and a rights summary. Every register entry names one [ENT-011].
_Avoid_: stock class, security, series

**Register entry**:
One dated movement of shares on an Entity's share register: an allotment, transfer, buyback, cancellation or conversion, with its quantity, holders, consideration, certificates and resolution reference. The Register of members is a replay of entries to a date; holders are never added by hand [ENT-011].
_Avoid_: transaction, issuance, share movement, ledger line

**Holder**:
A party on an Entity's share register: an Entity from the registry or a named individual. A Holder exists because a Register entry names it [ENT-011].
_Avoid_: shareholder record, member, investor, owner

**Certificate**:
A numbered share certificate for one Holder and Share class, with its quantity and distinctive numbers, issued by one Register entry and cancelled by at most one [ENT-011].
_Avoid_: share cert, stock certificate

**Registration**:
One jurisdiction where an Entity is registered or qualified to do business, with its own registration number, registered agent, and active, lapsed, or withdrawn status. Formation jurisdiction stays on the Entity [ENT-002].
_Avoid_: formation, licence, incorporation

**Portal-listed Entity**:
An Entity an Administrator has flagged so Business Users can pick it by name wherever Legal placed an Entity picker on a Portal form. Names only; a Confidential Entity is never listed [ENT-010, DD-027].
_Avoid_: public entity, visible entity, portal entity

**Counterparty**:
An external organisation on the other side of a contract or matter [DD-008].
_Avoid_: vendor, supplier, client, third party, entity

**Party**:
The union of Entities and Counterparties, used only by cross-cutting reads like search and autocomplete [DD-008].
_Avoid_: using "party" to mean only a counterparty

### People

**Administrator**:
System administrator with full legal work on reachable records. Confidential Contracts and Matters still require named membership or the Legal Owner or Matter Manager assignment [DD-013, DD-014, DD-023].

**Legal Team Member**:
In-house counsel or paralegal with full functional access to legal work, excluding system settings and confidential records they are not on [DD-013].
_Avoid_: lawyer, attorney, staff

**Contributor**:
Former account type, removed by DD-023. Existing accounts become Business Users and retain team membership. Historical audit entries may still name Contributor.
_Avoid_: collaborator, guest, external user

**Business User**:
An employee who uses the Portal to submit Requests and work on non-archived Contracts and Matters they are on the team for. They read business Fields, add Documents and Versions, including primary Contract Document Versions, post Full Thread replies, and add existing people to non-Confidential record teams. Record Fields remain managed by Legal [DD-026]. Team membership is their only record grant [DD-023, DD-024].
_Avoid_: requester (that is a role on a specific Request), end user, customer

**Member+**:
Shorthand for Administrators and Legal Team Members together — the access floor for most legal-side surfaces.

**Matter Manager**:
The single accountable person on a Matter [MTR-003]. The Contract equivalent is stored the same way but labelled **Legal Owner** in Contract Overview [CTR-004, DD-021].
_Avoid_: assignee, lead, responsible

**Request Title**:
The required short name for what the requester needs. Stored as `requests.title` and called Title in forms, Inbox, Portal, notifications and original submissions. Formerly labelled Summary [INT-009].

**Owning department / Region**:
Built-in, nullable Contract attributes describing its business classification. Both live in Overview for every Contract Type, outside its configurable Fields. Owning department is a pick from the Departments list; Region is free text. Legal edits them in the full app; Business Users on the team read the same values in the Portal. Neither grants access [CTR-025, DD-026, SET-010].
_Avoid_: department (alone, when the Contract attribute is meant), business unit

**Department**:
One entry in the Administrator-managed Departments list, carried on a user. An Administrator sets it on the user; a Business User sets their own once in the first run. It is an Auto-Doc audience term ("all of Procurement") and the source of a Contract's Owning department. It grants nothing by itself [SET-010, SET-011, ADO-009].
_Avoid_: team (that is a record roster), group, business unit, owning department (that is the Contract attribute)

**Default people**:
The Administrator-managed list on a Contract Type of people who get a team row on every new Contract of that Type, whatever created it. Copied at creation, never re-applied [CTR-026].
_Avoid_: default team, auto-members, watchers

**Business Owner**:
The single nullable person named for the business on a Contract or Matter. Conversion sets the Requester as Business Owner and adds their team row. Assigning a Business Owner also adds their team membership. They remain a member while assigned; change the assignment before removing their membership. Reassignment preserves the former owner’s membership until explicitly removed [DD-023].

**Stakeholder**:
Former separate Contract affiliation, removed by DD-023. Eligible existing links migrate to ordinary team membership. Use team member for current participation.

**Watcher**:
Former team tag, removed by DD-023. A team row now records membership without tags.

**Creator**:
The person who created a Contract or Matter. This historical statement remains after their membership is removed. It grants no access by itself [DD-023].

**Requester**:
The Business User who submitted a given Request.

**Officer**:
A person recorded against an Entity by name and configurable role, with appointment and optional resignation dates. An Officer may link to a user, but does not need an OpenLaw account [ENT-001].
_Avoid_: Entity user, team member, Signer

### Lifecycle

**Stage**:
The fixed, code-branching backbone of a contract's life: `draft → review → approval → signature → active → ended`. Derived from the status, never stored on the contract [CTR-001].
_Avoid_: phase, step, state

**Status**:
A configurable, renameable label mapping to exactly one Stage (contracts) or Category (matters). Presentation and workflow metadata — code never branches on it [CTR-001, MTR-002].
_Avoid_: state, stage

**Unverified value**:
A Contract value written by an Analysis run and still carrying that run's exact evidence. It remains fully usable, including on deadline surfaces, but wears the literal Unverified marker until a person confirms or edits that field. Confirming one value never clears another [CTR-008, DES-070].
_Avoid_: suggestion, draft value, untrusted value

**Category**:
The matter equivalent of Stage — `open` or `closed`, immutable once set on a status [MTR-002].

**Envelope**:
One durable round of signature on an exact Version of a Contract’s primary Document. Its status is `preparing`, `draft`, `preparation_failed`, `sent`, `signed`, `declined`, or `voided`. **Live** means preparing, draft, or sent; a Contract has at most one live Envelope. An uncertain creation remains preparing and reserved until its outcome is known. A draft is unsent and has no Sent timestamp. Envelope status `draft` is not Contract Stage `draft`. The preparation retains its Signers, Subject, source Version and Document chain, provider identity, and preparer; `sent_by` names that preparer for Void and executed-copy authorship [CTR-013, #1171].
_Avoid_: signature request, signing packet, DocuSign envelope (the term is provider-neutral), request (that is the intake term)

**Signer**:
One person selected to sign an Envelope, resolved to a name and email address. A Signer may be a user of this install, selected by identity, or someone outside it, entered by name and address. Every Signer has a distinct address and is asked in parallel; there is no routing order [CTR-013, September 25 addendum].
_Avoid_: signatory, recipient, approver (an Approval is a different act, by a colleague, inside the product)

**Soft gate**:
The warning a Contract meets when it moves from a Stage at or before `approval` to a Stage after it while an Approval request is still unresolved — pending or rejected. It names the unresolved requests and asks for one deliberate confirmation. It never blocks: the confirmed move commits and is recorded on the Activity feed as an override [CTR-012, CTR-001].
_Avoid_: approval gate, hard gate, block, approval lock

**Inbox**:
The single triage queue: the Requests whose fate is undecided, and, on a second tab, the Unassigned contracts a Generation created [INT-006, INT-007, ADO-006].
_Avoid_: queue, triage list, backlog

**Disposition**:
The outcome chosen when a Request is picked up — Convert, Resolve, or Decline. There is no parked intermediate state [INT-007].

**Convert**:
Turning a Request into a Matter or Contract. The Request type supplies defaults; the Legal Team Member may change the target Type, title, priority, and attached Fields before conversion [INT-002 UX review addendum].

**Re-target**:
The exception path — converting a mis-routed Request to the other kind, losslessly [DD-018].

**Closing**:
Moving a Matter into a `closed`-category status. A signal, not a lock — the record stays writable [MTR-008]. The Contract equivalent is **Ending** [CTR-019].
_Avoid_: completing, finishing, resolving

**Ending**:
Moving a Contract into a status whose stage is `ended`. A signal, not a lock — the record stays writable. An ended Contract drops out of the default list and the renewal-pending predicate, but its record page is untouched. Reopening is an ordinary status change that clears the signal [CTR-019].
_Avoid_: closing (that is the Matter equivalent), terminating, expiring (those are status labels, not the lifecycle act)

**`ended_at`**:
The queryable summary of whether a Contract has ended: stamped on transition into the `ended` stage, cleared on leaving it. The activity log stays the source of truth for the transition history; this column is what the default list and the renewal-pending predicate filter on [CTR-019].

**Archiving**:
Soft delete, for mistakes and imports. Separate from Closing and Ending, and never a synonym for them [MTR-008].

### Access and visibility

**Confidential**:
An opt-in per-record flag that hides a Matter, Contract, or Document from everyone outside its named team. Records are silently omitted, never shown as placeholders [DD-014].
_Avoid_: private, restricted, sensitive, secret

**Grant**:
An explicit named-user exception that lets one Legal Team Member reach one Confidential Entity. Administrators need no Grant, and a Grant gives no wider role or team membership [ENT-004].
_Avoid_: Entity team, access role, permission group

**Visibility tier**:
The audience of a comment or activity entry — **Legal Only**, **Working Team**, or **Full Thread** [DD-016].
_Avoid_: Privileged (deliberately rejected — privilege is a legal doctrine, not a UI setting), internal, shared, public

**Portal**:
The Business User view of their legal work. It contains Requests, Contracts and Matters, plus published portal-readable Knowledge. A converted Request redirects to its record. Current team membership governs record access and permitted business work [INT-001, DD-023].
_Avoid_: customer portal, self-service portal

**portal-readable**:
The audience setting on a Knowledge Item that lets a signed-in portal reader reach it, but only while the item is published and not archived. The stored value is `everyone`; "portal-readable" names its product meaning [KNW-004].
_Avoid_: public, externally shared, anonymous

**Activity feed**:
The per-record narrative of what happened, inheriting the visibility tier of each action [DD-017].

**Audit log**:
The Administrator-only, append-only system-wide record, including security events the activity feed omits [DD-017].
_Avoid_: using "audit log" and "activity feed" interchangeably — they are two surfaces over one table

**Parent contract**:
The single Contract one level above another in the `parent_id` hierarchy — MSA over SOW, original over substantial amendment. Arbitrarily deep, no cycles, and no inheritance: the parent's status, team, and confidentiality never flow to its children [CTR-015].
_Avoid_: master contract, umbrella, wrapper

**Contract link type**:
The kind of typed directional link between two Contracts: `related` (symmetric), `renews` (directional — the linking Contract renews the other), or `amends` (directional — the linking Contract amends the other). One row per pair per type; each link is read from both directions [CTR-015].
_Avoid_: relation type (use "link type" in prose), connection type

**Restricted contract**:
The server's answer when a relative on the relations surface is a Contract the viewer cannot reach. The response carries no number and no title — the placeholder is the server's decision, not the client's redaction [CTR-018].
_Avoid_: hidden contract, redacted contract, inaccessible contract

**Restricted Matter**:
The title-free placeholder shown when a relationship is visible but the related Matter is not. It carries no number or other record data and grants no navigation or access [DD-014, MTR-015].
_Avoid_: hidden Matter, redacted Matter, inaccessible Matter

### Configuration

**First run**:
The one-time setup of a fresh instance. `/auth/setup` creates the first Administrator and signs them in to the onboarding wizard at `/welcome`. Once setup succeeds, it can never create another Administrator. Once the wizard is finished or skipped through, `onboarding_completed_at` prevents it from opening again [SET-004, TECH-008].
_Avoid_: resettable setup, recurring onboarding

**Onboarding wizard**:
The first Administrator's guided configuration at `/welcome`. Its nine steps include the welcome splash, organization identity, authentication, the Business-user portal allowlist, outbound email, team invites, E-signature, AI analysis, and Review of the seeded lists. Each step is skippable. The two connectors have separate steps because SET-008 gives each its own Settings destination. Finish on Review records the seeded-list acknowledgement before completing onboarding. Review also recommends keeping the seeds and offers Start blank [SET-004].
_Avoid_: installation wizard, integrations step

**Start blank**:
The Review step's action that removes the seeded catalog so an organization begins with its own vocabulary. It hard-deletes every seed row that is only vocabulary: the non-protected matter types, contract types, entity types, officer roles, knowledge types, request types, and statuses. It keeps the rows the application needs, the `other` type rows and the protected statuses, and it keeps the default Fields and the reminder offsets. It is refused once onboarding is complete, once a user-created row exists, or once a removable row is in use. It records the Review acknowledgement and one activity-log row per emptied list [SET-004].
_Avoid_: reset, factory reset, wipe the instance, archive the seeds

**Default Field**:
A Field that a migration seeded, marked `is_system_default`. Today these are governing law, jurisdiction, and our position, the CTR-008 core Fields with shipped AI prompts. Start blank keeps them [SET-004, CTR-016].
_Avoid_: system field, built-in field, protected field, intake default (the former `__intake_*` rows, retired by DD-028)

**Setup checklist**:
The Administrator-only card above Organization in Settings → Organization → General. It lists currently unfinished onboarding steps and disappears when none remain. Each row links to its Settings pane, except Email, which has no pane and is plain text, and Review seeded types, which has a Mark as reviewed action. Completion follows current configuration, so a later removal can bring a row back without reopening the wizard. The card calls the wizard's Your organization step Organization and its Outbound email step Email to fit the Settings context. It expands Review to Review seeded types because the card has no surrounding wizard to explain what to review. All other step labels match [SET-004].
_Avoid_: onboarding dashboard, skip history, restart setup

**Type**:
The configurable taxonomy on a Matter, Contract, Entity, or Request, and the designated carrier for policy — templates and approvals attach here. A Contract, Matter, or Entity type owns a Form; a Request type owns none and reads the Intake Rows of its destination type's Form [CTR-002, MTR-001, INT-002, DD-028].

**Default type**:
The one seeded type per module (Contracts, Matters) marked `is_default`. Editable and renameable, never archived or deleted. Its Form is the Request form when a Request type names a module and no type, and the create dialogs preselect it [DD-028].
_Avoid_: fallback type, untyped, generic type

**Form**:
The ordered tree a Contract, Matter, or Entity type owns, made of Rows and Branches. A Contract or Matter Form feeds the Request form, the creation form, the record page, and the Portal record. An Entity Form has no intake switch and feeds the create form and the record only [DD-028].
_Avoid_: attachment list, field list, form definition (Auto-Docs own that term)

**Row**:
A node on a Form that collects one value: a built-in column or an attached Field. On a Contract or Matter Form it carries three switches, On intake form, Required for creation, Visible on Portal. Built-in Rows have fixed Portal visibility. Turning on On intake form for an attached Field also turns on Visible on Portal. On an Entity Form only Required for creation is shown; On intake form and Visible on Portal are absent [DD-028, DES-090].
_Avoid_: attachment, form field, question

**Branch**:
A node on a Form holding a condition group (match all or any of `row operator value`) whose children show only when it holds. A condition references only Rows above the Branch. A false Branch hides its children during collection and suspends Required for creation. A record still shows a hidden Row that holds a value, subject to Visible on Portal and access rules [DD-028].
_Avoid_: rule, logic jump, section, conditional group

**Touchpoint**:
Where a Row is first collected, derived from its switches and never stored: Intake (on intake form), Creation (required and not on intake), Record (neither). The creation form collects Intake and Creation Rows; an Entity Form has no Intake Rows, so its create form collects the required Rows [DD-028].
_Avoid_: level, stage, surface

**Intake form**:
The Portal Request form for a Request type: the pinned basics plus the Intake Rows of its destination type's Form [INT-002, DD-028].
_Avoid_: request form fields, portal form definition

**Field**:
An entry in the shared custom-field catalog, defined once with a module scope and placed as a Row on the Forms of the types that should collect it [MTR-011, CTR-016, DD-028].
_Avoid_: custom field (when referring to the catalog entry itself), attribute, property, business field, legal field (the tag is retired; say Visible on Portal)

**Term type**:
What kind of commitment a Contract is — **fixed**, **auto-renewing**, or **evergreen**. It is one of three fixed values, not a configurable label, because the rest of the term follows from it: an evergreen Contract holds no expiry date, and only an auto-renewing one holds a renewal period [CTR-006].
_Avoid_: renewal type, contract term (that is the period, not its kind), auto-renew flag

**Notice deadline**:
The date by which somebody must act to stop a Contract renewing: its expiry date minus its notice period. It is **derived and never stored** — it moves the moment either half does — and it exists only where there is an expiry to subtract from, so an evergreen Contract has none [CTR-006].
_Avoid_: notice date, notice period (that is the count of days this is derived from), cancellation deadline

**Renewal pending confirmation**:
What an auto-renewing Contract says about itself once its expiry date has passed and nobody has confirmed the roll. It is **derived, never stored** — a reading of the record's own dates, true whenever the Contract auto-renews, is not archived, and its expiry is behind us — so it appears without a job running and clears the moment the expiry advances. It is a banner and never a status: the Contract's status and stage are untouched by it [CTR-006].
_Avoid_: pending renewal status, lapsed, overdue renewal, expired (a fixed term that ran out has simply ended)

**Confirmed roll**:
A person's assertion that an auto-renewing Contract renewed on the same paper, which advances its expiry date — the first of CTR-007's four renewal vehicles. Nothing in OpenLaw ever rolls a term on its own: a roll happens because somebody confirmed it, and the person may adjust the proposed new expiry before committing. Nothing stores a confirmed roll either — the activity entry it writes is the whole record of it, and both the Contract's renewal history and its last renewal date are that entry read back [CTR-006, CTR-007].
_Avoid_: auto-renewal (nothing is automatic), rollover, renewal event, extension

**Renewal vehicle**:
How a team chooses to record a renewal. There are four and OpenLaw imposes none of them: **confirm the roll** (the same record's expiry advances), **amendment** (a version filed on the record's own paper), **child contract** (a new record born under the original), and **new contract** (a standalone successor linked back to its predecessor). The tool records what a team actually did rather than a doctrine, so a renewal is identified afterwards by its link and by the activity log — never by the shape of the record [CTR-007].
_Avoid_: renewal type, renewal method, renewal path

**Key date**:
A named deadline on a Matter or Contract — a date, a label, and an optional note. Key dates feed deadline surfaces and carry no owner. A Key date may add reminder lead times to each recipient's list and select recipients from the record team; no selection uses the usual audience [MTR-004, CTR-009, NOT-004 addendum, 2026-09-10].
_Avoid_: milestone, custom date, important date

**Next deadline**:
The earliest upcoming Key date or unfinished dated Task, including overdue Tasks. Contracts also include expiry and notice dates. Closed Matters, ended Contracts and archived records have none [CTR-005 and MTR-016 UX review addenda, 2026-09-07].
_Avoid_: due date, upcoming date, next date

**Task**:
A checklist item with a title, optional description, assignee and due date, and no status beyond done. Each Contract or Matter Task has its own comments and attachments under the parent record's access rules. Unfinished dated Tasks feed Next deadline, including overdue Tasks [MTR-005 and CTR-017, amended by the 2026-09-07 Task detail and Next deadline addenda].

**Obligation**:
A recurring entity-level compliance item — a licence renewal, annual filing, or registered-agent renewal — rolled forward only on human confirmation [ENT-006].
_Avoid_: task, deadline, compliance item

**Urgency**:
What a requester supplies on a Request. It defaults **priority** at conversion, which the Legal Team Member may edit; **risk** is never requester-set [INT-002 UX review addendum, MTR-012].

**Deflection link**:
An Administrator-configured label and absolute `http` or `https` web address in the portal's "Before you submit…" panel, there to answer a question before it becomes a Request. Its **placement** is either the portal home — everybody sees it whatever they came to ask — or one request type, which shows it on that form alone. A deflection link is removed rather than archived: nothing points at one and there is no history to keep [INT-004].
_Avoid_: help link, FAQ link, self-service link, knowledge link (a Knowledge item is its own thing, and M28's)

**Approver group**:
An Administrator-managed template naming a reusable set of approvers — "Commercial sign-off" = GC plus CFO. Members must be Member+ users. Applying a group copies its members onto the Contract at apply time, so a later edit or archive never changes an approval already requested [CTR-012].
_Avoid_: approval group, approver team, sign-off rule

**Signing connector**:
The Administrator-configured credentials one e-signature provider is reached with — DocuSign in v1, adapter-keyed so a second provider is a second connector. It is org configuration, not deployment environment: it is saved in Settings → Organization → Integrations → E-signature and read live on every use, so a rotated key applies to the next call. An install with no connector loses nothing it has today — the manual hand-off (upload the executed PDF, pin it, mark active) is always available and needs no configuration [CTR-013, TECH-013, SET-007].
_Avoid_: DocuSign integration, e-sign settings, signing provider (that is the code seam behind the connector, not the configuration)

**Conversion draft**:
An actor-scoped, editable proposal prepared from a Request before a person submits the Convert dialog. It holds suggested values and source citations, creates no Matter or Contract, and does not disposition the Request. Unchanged accepted suggestions become Unverified values; edits and confirmations are human. It is distinct from an Analysis run, which records what an extraction already did. Preparation runs in the worker and survives the dialog closing; a person who closes the dialog while it is pending gets a bell item when it is ready or failed, linking back into the Convert dialog [INT-008].
_Avoid_: Analysis run (for a before-creation proposal), preparation run

**AI connector**:
The singleton provider configuration for Contract analysis and opted-in Conversion drafts, saved in Settings → Organization → AI analysis, a section of its own. It chooses a preset or custom endpoint, one supported protocol, a base URL, and a model. It references the Saved key it uses; keyless Ollama needs none. The API resolves the connector for Test connection and the worker resolves it for every Analysis run and Conversion draft, so changes apply without a restart [CTR-008, TECH-012, SET-008].
_Avoid_: AI integration, provider environment variable, model settings

**Saved key**:
A write-only API key kept for one AI provider destination, defined by preset, protocol, and normalized base URL. Each destination has at most one, encrypted under `OPENLAW_SECRET_KEY` and reused only there. A blank save or Load models uses the pending destination's Saved key; saving a pasted key replaces that destination's value. Saved keys survive provider changes and connector removal. Only **Forget key** deletes one, and only while the connector does not reference it. The pane and onboarding step show **Key saved**, or **Key in use** for the referenced key, and mark providers with a Saved key as "(key saved)" [TECH-012, TECH-022, SET-008].
_Avoid_: cached key, connector key slot

**Manual hand-off**:
Signing a Contract outside OpenLaw and filing the result by hand: set the status, sign anywhere, upload the executed PDF, pin it, mark active. It is the zero-config path CTR-013 promises stays sufficient, and no part of it is coupled to a signing connector [CTR-013, CTR-014].
_Avoid_: manual signing, offline signing, the fallback

**Reconciliation sweep**:
The background round that asks the signing connector where each due live Envelope stands and moves the record to match. An Administrator selects **Polling** for outbound-only status updates, or **Webhook** for signed notifications through a public HTTPS gateway. The reconciliation sweep runs in both modes, with at least 15 minutes between provider status checks of one Envelope. Both paths apply the same transition and file the same executed copy [CTR-013, TECH-007].
_Avoid_: status poller, sync job, the backfill sweep (that is M12's, and it recovers lost jobs rather than reading a provider)

**Executed pin**:
Which version of a Document the team calls the signed copy — the one previews, exports, and AI analysis target by default. It is **explicit and never inferred from a version's kind**: a round tagged `executed` is what its uploader called it, a chain can hold two rounds both called that, and the pin names one of them. A person sets and clears it by hand; the signing integration sets it automatically when an Envelope completes, and never corrects a team that moves it afterwards [CTR-014, CTR-013].
_Avoid_: executed flag, signed version, final document, the executed document

**Primary document (Knowledge sense)**:
The one Document a Knowledge Item pins as its main Document. Its current Version opens first on the record and appears first on the portal article. The pin is optional, explicit, and must name a live Document owned by that same item [KNW-001].
_Avoid_: primary file, attachment, executed pin

**Approval request**:
One named person's sign-off on one Contract. A Member+ user asks; the named approver alone answers, with an approval or a rejection and an optional note; and the answer is final. Requests run in parallel — there are no chains and no order — and at most one is pending per approver per Contract. Asking again after a rejection makes a new request rather than reopening the old one. The requester, the Contract's Owner, or an Administrator cancels a pending one, which deletes it and leaves the activity entry as the record that it was made [CTR-012].
_Avoid_: approval task, sign-off item, approval step, reviewer

### MCP

**MCP**:
The capability that lets a person's AI agent work in OpenLaw as that person, over the Model Context Protocol. An Administrator turns it on for the organization. An agent never reads or writes anything the person could not [DD-029].
_Avoid_: agent access, integration API, agent API, automation API

**Client**:
One connected program acting for one person through MCP, such as Claude, ChatGPT, Microsoft 365 Copilot, or a script. A Client authenticates with an OAuth grant or an API key and is named in the activity it causes. Only a Client on the Administrator-managed Allowed Clients list may ask for an OAuth grant [DD-029].
_Avoid_: agent client, bot, integration, connector (that is a Signing or AI connector)

**Allowed Client**:
A Client the Administrator has listed as permitted to ask for an OAuth grant. One of two kinds: a published identity, which holds the vendor's Client ID Metadata Document URL and is seeded, not editable; or a registered client, which OpenLaw generates as a client id and a one-time secret with the vendor's pasted callback URLs. Seeded with Claude, Claude Code, ChatGPT and Microsoft 365 Copilot [DD-029].
_Avoid_: trusted client, registered app, OAuth app, connector

**API key**:
A long-lived credential issued to one person for a headless Client after an Administrator approves their API key request. It is bound to that person and carries the Toolsets and the read or write scope the Client may use. The outbound AI provider credential is a Saved key, not an API key [DD-029].
_Avoid_: token, personal access token, agent key, Saved key (that is the AI provider's)

**API key request**:
A person's ask for an API key, naming the Client, the Toolsets, and the read or write scope they want from the organization's ceiling. An Administrator approves or denies it. Approval issues the key to the requester, shown once [DD-029].
_Avoid_: key application, access request, token request

**Tool**:
One named action a Client may call, with a description written for the model, a read or write kind, and the record scopes of the person behind the call [DD-029].
_Avoid_: endpoint, command, skill, function

**Toolset**:
A named group of Tools that a deployer switches on or off as one unit, and that a person may narrow further on an API key or an OAuth grant [DD-029].
_Avoid_: scope (that is read or write), tool group, feature flag

**Tool register**:
The code-owned catalog of every Tool with its Toolset, kind, and description. It is curated by hand, not generated from the API document, and it is not Administrator-editable [DD-029].
_Avoid_: tool registry, tool catalog, generated tools, the OpenAPI document

**Your approvals**:
The pinned group at the top of the bell that lists every open approval the person can act on: Contract Approval requests, API key requests for an Administrator, and any approval kind added later. An item leaves the group only when handled, and it counts in the badge until then, read or not [NOT-001].
_Avoid_: pending approvals, approval inbox, approvals queue, to-do

## Relationships

- A **Matter** contains many **Contracts** and many **Documents**
- A **Contract** owns many **Documents** and links to at most one **Matter** — contracts stand alone by default [MTR-007]
- Every **Document** has exactly one owning record: a **Matter**, **Contract**, **Entity**, **Knowledge Item**, or **Auto-Doc** [DOC-008, ADO-001]
- A **Document** has one or more **Document Versions**, strictly linear
- A **Contract** references one of our **Entities** and many **Counterparties**, exactly one of which is primary [CTR-011]
- A **Request** converts to exactly one **Matter** or one **Contract**, or is resolved or declined — never both [INT-007]
- A **Status** maps to exactly one **Stage** (contracts) or **Category** (matters); the mapping is immutable once set
- A **Matter** may have one parent **Matter**, arbitrarily deep, with no inheritance semantics [MTR-015]
- A **Contract** may have one parent **Contract**, arbitrarily deep, with no inheritance semantics [CTR-015]
- A **Contract** may hold typed links to other **Contracts** — `renews`, `amends`, or the symmetric `related` — each read from both directions, from the same single row [CTR-015]
- A **Contract** holds many **Approval Requests**, each naming one approver; at most one of them is pending per approver [CTR-012]
- An **Auto-Doc** owns exactly one template **Document** (a DOC-001 chain) and many form versions; Publish pins one of each as the **Live pair** [ADO-001, ADO-004]
- An **Auto-Doc** may target one **Contract Type**; a **Generation** of a targeted Auto-Doc automatically creates one **Contract** in `draft`; later Filings may create additional Contracts [ADO-005]
- A **Generation** cites one Live pair, belongs to one person, and may be **Filed** to many Matters or Contracts, each Filing one Document [ADO-005]
- A **Contract Type** carries many **Default people**, each copied to the team of every new Contract of that Type [CTR-026]
- A **user** belongs to at most one **Department**; a **Contract** may have one Department as its Owning department [SET-010, CTR-025]

## Example dialogue

> **Dev:** "When a Business User submits an NDA request, do we create the **Contract** straight away?"
>
> **Domain expert:** "No — you create a **Request**. It sits in the **Inbox** until someone picks it up. Only when they **Convert** it does the Contract exist."
>
> **Dev:** "And triage picks whether it becomes a Matter or a Contract?"
>
> **Domain expert:** "The **Request type** supplies the default. Legal can change the Type, title, priority and attached Fields during **Convert**. Choosing the other kind is **Re-target**."
>
> **Dev:** "The form asks who we're contracting with. Is that an **Entity**?"
>
> **Domain expert:** "The other side is a **Counterparty**. The **Entity** is which of _ours_ signs — our UK subsidiary or our Delaware parent. Two different fields, two different tables, and calling a counterparty an entity will send you to the wrong one."
>
> **Dev:** "Once it's live, the pill says 'With counterparty'. Do I branch on that?"
>
> **Domain expert:** "No. That's a **Status** — a label the team can rename tomorrow. Branch on its **Stage**, which is `review`."

## Flagged ambiguities

- **"entity"** collides with itself. In the domain it means one of our corporate entities. In the schema, `entity_type` / `entity_id` on `comments` and `activity_log` is a generic polymorphic reference to any record. Resolved: the domain term always means the corporate entity; the column pair is infrastructure naming and carries no domain meaning.
- **"owner"** has two senses. A Contract's **Owner** is the accountable person (`manager_id`) [CTR-004]. A Document's **owning record** is the Matter, Contract, Entity, Knowledge Item, or Auto-Doc it belongs to [DOC-008, ADO-001]. Never a person.
- **"assignee"** is retired. It was a `matter_team` role before being promoted to `matters.manager_id`; the term now means nothing. Use **Matter Manager** or **Owner** [MTR-003].
- **"Privileged"** was explicitly rejected as the Tier 1 label, to avoid implying a formal attorney-client privilege determination and creating discovery-awkward artifacts. Use **Legal Only** [DD-016].
- **"status" vs "stage"** was a real duplication in the contract mocks — two fields for one datum. Resolved: one stored `status_id`, stage derived from it [CTR-001].
- **"urgency" vs "priority"** are separate on purpose: urgency is what the requester claims, priority is what legal holds. They map 1:1 at conversion and diverge thereafter [INT-002].
- **"deadline"** includes unfinished Task due dates in **Next deadline**, alongside upcoming Key dates and Contract expiry and notice dates. Tasks remain separate from Key dates and keep their own reminder behavior [2026-09-07 Next deadline addenda].
