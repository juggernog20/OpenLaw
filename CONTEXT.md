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
A logical file record owned by exactly one Matter, Contract, Entity, or Knowledge Item; carries no workflow of its own [DOC-008].
_Avoid_: file, attachment, upload

**Document Version**:
An immutable file snapshot in a document's strictly linear chain; corrections append a new version rather than editing one [DOC-001].
_Avoid_: revision, draft, copy

**Knowledge Item**:
A curated piece of know-how — template, precedent, playbook, or article — distinct from the documents it owns [KNW-001].
_Avoid_: article, wiki page, resource

**Knowledge Folder**:
A nested folder that organizes Knowledge Items in the Knowledge destination. It does not organize the Documents inside an item. The tree starts blank, and Type remains a separate filter [KNW-003, DOC-006].
_Avoid_: Document folder, library type, category

### Parties

**Entity**:
One of _our own_ corporate entities — a subsidiary, holding company, or branch [DD-008].
_Avoid_: company, organisation, party, counterparty, subsidiary

**Holding**:
A directional ownership fact between two Entities, recording the percentage one Entity owns of the other. Holdings form the ownership graph; they do not make either Entity a child record [ENT-003].
_Avoid_: parent link, ownership relation, shareholding record

**Registration**:
One jurisdiction where an Entity is registered or qualified to do business, with its own registration number, registered agent, and active, lapsed, or withdrawn status. Formation jurisdiction stays on the Entity [ENT-002].
_Avoid_: formation, licence, incorporation

**Counterparty**:
An external organisation on the other side of a contract or matter [DD-008].
_Avoid_: vendor, supplier, client, third party, entity

**Party**:
The union of Entities and Counterparties, used only by cross-cutting reads like search and autocomplete [DD-008].
_Avoid_: using "party" to mean only a counterparty

### People

**Administrator**:
Full access including system configuration and all confidential records; typically the General Counsel or Legal Ops [DD-013].

**Legal Team Member**:
In-house counsel or paralegal with full functional access to legal work, excluding system settings and confidential records they are not on [DD-013].
_Avoid_: lawyer, attorney, staff

**Contributor**:
A person, such as a procurement colleague or external counsel, granted access to specific Matters or Contracts they were added to. Contributors are made, not born: on a reached record they may read and comment, edit business Fields, and supply supporting Documents, but legal actions remain Member+ [DD-015, MTR-006].
_Avoid_: collaborator, guest, external user

**Business User**:
An employee who submits requests and sees only their own, via the portal [DD-013].
_Avoid_: requester (that is a role on a specific Request), end user, customer

**Member+**:
Shorthand for Administrators and Legal Team Members together — the access floor for most legal-side surfaces.

**Matter Manager**:
The single accountable person on a Matter [MTR-003]. The Contract equivalent is stored the same way but labelled **Owner** in the UI [CTR-004].
_Avoid_: assignee, lead, responsible

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

**Category**:
The matter equivalent of Stage — `open` or `closed`, immutable once set on a status [MTR-002].

**Envelope**:
One round of signature on one version of a Contract's primary document, sent through the signing connector and held by the provider. It carries one status — `sent`, `signed`, `declined`, or `voided` — and the Signers it was sent to. A Contract has at most one **live** envelope at a time; a declined or voided one blocks nothing, and the next round is a new envelope [CTR-013].
_Avoid_: signature request, signing packet, DocuSign envelope (the term is provider-neutral), request (that is the intake term)

**Signer**:
One person an Envelope is sent to, as a name and an email address. A Signer is not a user of this install and not a Counterparty contact — the other side of a deal has no account here. Every Signer on an Envelope is asked in parallel; there is no routing order [CTR-013].
_Avoid_: signatory, recipient, approver (an Approval is a different act, by a colleague, inside the product)

**Soft gate**:
The warning a Contract meets when it moves from a Stage at or before `approval` to a Stage after it while an Approval request is still unresolved — pending or rejected. It names the unresolved requests and asks for one deliberate confirmation. It never blocks: the confirmed move commits and is recorded on the Activity feed as an override [CTR-012, CTR-001].
_Avoid_: approval gate, hard gate, block, approval lock

**Inbox**:
The single triage queue, containing exactly the Requests whose fate is undecided [INT-006, INT-007].
_Avoid_: queue, triage list, backlog

**Disposition**:
The outcome chosen when a Request is picked up — Convert, Resolve, or Decline. There is no parked intermediate state [INT-007].

**Convert**:
Turning a Request into the Matter or Contract its request type already targets. Triage confirms the target; it never classifies [DD-018, INT-006].

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
The lightweight, magic-link-authenticated surface where Business Users submit Requests and follow their threads [INT-001].
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

**Type**:
The configurable taxonomy on a Matter, Contract, or Request, and the designated carrier for policy — fields, templates, approvals attach here [CTR-002, MTR-001, INT-002].

**Field**:
An entry in the shared custom-field catalog, defined once with a module scope and attached to the types that should render it [MTR-011, CTR-016].
_Avoid_: custom field (when referring to the catalog entry itself), attribute, property

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
A named deadline on a Matter or Contract — a date, a label, and an optional note. Key dates feed deadline surfaces. A key date carries no owner and no reminder schedule of its own [MTR-004, CTR-009, NOT-004].
_Avoid_: milestone, custom date, important date

**Next deadline**:
The earliest date that has not yet passed on a record's deadline surface — a date falling today still counts. On a Contract that surface is the union of its key dates, its expiry date, and its derived notice deadline, so the next deadline may be any of the three. A record whose every date has passed has none [CTR-009, MTR-004].
_Avoid_: due date, upcoming date, next date

**Task**:
A lightweight checklist item. Deliberately not an entity — no comments, no status beyond done, and task due dates never feed deadline surfaces [MTR-005, CTR-017].

**Obligation**:
A recurring entity-level compliance item — a licence renewal, annual filing, or registered-agent renewal — rolled forward only on human confirmation [ENT-006].
_Avoid_: task, deadline, compliance item

**Urgency**:
What a requester supplies on a Request. It maps 1:1 to **priority** at conversion; **risk** is never requester-set [INT-002, MTR-012].

**Deflection link**:
An Administrator-configured label and absolute `http` or `https` web address in the portal's "Before you submit…" panel, there to answer a question before it becomes a Request. Its **placement** is either the portal home — everybody sees it whatever they came to ask — or one request type, which shows it on that form alone. A deflection link is removed rather than archived: nothing points at one and there is no history to keep [INT-004].
_Avoid_: help link, FAQ link, self-service link, knowledge link (a Knowledge item is its own thing, and M28's)

**Approver group**:
An Administrator-managed template naming a reusable set of approvers — "Commercial sign-off" = GC plus CFO. Members must be Member+ users. Applying a group copies its members onto the Contract at apply time, so a later edit or archive never changes an approval already requested [CTR-012].
_Avoid_: approval group, approver team, sign-off rule

**Signing connector**:
The Administrator-configured credentials one e-signature provider is reached with — DocuSign in v1, adapter-keyed so a second provider is a second connector. It is org configuration, not deployment environment: it is saved in Settings → Organization → Integrations → E-signature and read live on every use, so a rotated key applies to the next call. An install with no connector loses nothing it has today — the manual hand-off (upload the executed PDF, pin it, mark active) is always available and needs no configuration [CTR-013, TECH-013, SET-007].
_Avoid_: DocuSign integration, e-sign settings, signing provider (that is the code seam behind the connector, not the configuration)

**Manual hand-off**:
Signing a Contract outside OpenLaw and filing the result by hand: set the status, sign anywhere, upload the executed PDF, pin it, mark active. It is the zero-config path CTR-013 promises stays sufficient, and no part of it is coupled to a signing connector [CTR-013, CTR-014].
_Avoid_: manual signing, offline signing, the fallback

**Reconciliation sweep**:
The background round that asks the signing connector where every live Envelope stands and moves the record to match. It is the **fallback** status feed: the provider's webhook is the primary one, and the sweep is what makes an install the provider cannot reach converge anyway. The two never disagree, because both apply their answer through one transition and a transition already applied does nothing [CTR-013, TECH-007].
_Avoid_: polling, status poller, sync job, the backfill sweep (that is M12's, and it recovers lost jobs rather than reading a provider)

**Executed pin**:
Which version of a Document the team calls the signed copy — the one previews, exports, and AI analysis target by default. It is **explicit and never inferred from a version's kind**: a round tagged `executed` is what its uploader called it, a chain can hold two rounds both called that, and the pin names one of them. A person sets and clears it by hand; the signing integration sets it automatically when an Envelope completes, and never corrects a team that moves it afterwards [CTR-014, CTR-013].
_Avoid_: executed flag, signed version, final document, the executed document

**Primary document (Knowledge sense)**:
The one Document a Knowledge Item pins as its main file. Its current Version opens first on the record and appears first on the portal article. The pin is optional, explicit, and must name a live Document owned by that same item [KNW-001].
_Avoid_: primary file, attachment, executed pin

**Approval request**:
One named person's sign-off on one Contract. A Member+ user asks; the named approver alone answers, with an approval or a rejection and an optional note; and the answer is final. Requests run in parallel — there are no chains and no order — and at most one is pending per approver per Contract. Asking again after a rejection makes a new request rather than reopening the old one. The requester, the Contract's Owner, or an Administrator cancels a pending one, which deletes it and leaves the activity entry as the record that it was made [CTR-012].
_Avoid_: approval task, sign-off item, approval step, reviewer

## Relationships

- A **Matter** contains many **Contracts** and many **Documents**
- A **Contract** owns many **Documents** and links to at most one **Matter** — contracts stand alone by default [MTR-007]
- Every **Document** has exactly one owning record: a **Matter**, **Contract**, **Entity**, or **Knowledge Item** [DOC-008]
- A **Document** has one or more **Document Versions**, strictly linear
- A **Contract** references one of our **Entities** and many **Counterparties**, exactly one of which is primary [CTR-011]
- A **Request** converts to exactly one **Matter** or one **Contract**, or is resolved or declined — never both [INT-007]
- A **Status** maps to exactly one **Stage** (contracts) or **Category** (matters); the mapping is immutable once set
- A **Matter** may have one parent **Matter**, arbitrarily deep, with no inheritance semantics [MTR-015]
- A **Contract** may have one parent **Contract**, arbitrarily deep, with no inheritance semantics [CTR-015]
- A **Contract** may hold typed links to other **Contracts** — `renews`, `amends`, or the symmetric `related` — each read from both directions, from the same single row [CTR-015]
- A **Contract** holds many **Approval Requests**, each naming one approver; at most one of them is pending per approver [CTR-012]

## Example dialogue

> **Dev:** "When a Business User submits an NDA request, do we create the **Contract** straight away?"
>
> **Domain expert:** "No — you create a **Request**. It sits in the **Inbox** until someone picks it up. Only when they **Convert** it does the Contract exist."
>
> **Dev:** "And triage picks whether it becomes a Matter or a Contract?"
>
> **Domain expert:** "Never. The **request type** already targets one or the other — the admin bound that when they configured the form. Triage confirms. If it's genuinely wrong you **Re-target**, but that's the exception, not the flow."
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
- **"owner"** has two senses. A Contract's **Owner** is the accountable person (`manager_id`) [CTR-004]. A Document's **owning record** is the Matter, Contract, Entity, or Knowledge Item it belongs to [DOC-008]. Never a person.
- **"assignee"** is retired. It was a `matter_team` role before being promoted to `matters.manager_id`; the term now means nothing. Use **Matter Manager** or **Owner** [MTR-003].
- **"Privileged"** was explicitly rejected as the Tier 1 label, to avoid implying a formal attorney-client privilege determination and creating discovery-awkward artifacts. Use **Legal Only** [DD-016].
- **"status" vs "stage"** was a real duplication in the contract mocks — two fields for one datum. Resolved: one stored `status_id`, stage derived from it [CTR-001].
- **"urgency" vs "priority"** are separate on purpose: urgency is what the requester claims, priority is what legal holds. They map 1:1 at conversion and diverge thereafter [INT-002].
- **"deadline"** must not cover task due dates. Only **Key dates** (plus a contract's expiry and derived notice date) feed deadline surfaces [MTR-005].
