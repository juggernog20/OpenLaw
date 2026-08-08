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

### Parties

**Entity**:
One of _our own_ corporate entities — a subsidiary, holding company, or branch [DD-008].
_Avoid_: company, organisation, party, counterparty, subsidiary

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
A non-legal colleague (procurement, compliance, finance) granted access to specific matters or contracts they were added to — made, not born [DD-015].
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

### Lifecycle

**Stage**:
The fixed, code-branching backbone of a contract's life: `draft → review → approval → signature → active → ended`. Derived from the status, never stored on the contract [CTR-001].
_Avoid_: phase, step, state

**Status**:
A configurable, renameable label mapping to exactly one Stage (contracts) or Category (matters). Presentation and workflow metadata — code never branches on it [CTR-001, MTR-002].
_Avoid_: state, stage

**Category**:
The matter equivalent of Stage — `open` or `closed`, immutable once set on a status [MTR-002].

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

**Archiving**:
Soft delete, for mistakes and imports. Separate from Closing and Ending, and never a synonym for them [MTR-008].

### Access and visibility

**Confidential**:
An opt-in per-record flag that hides a Matter, Contract, or Document from everyone outside its named team. Records are silently omitted, never shown as placeholders [DD-014].
_Avoid_: private, restricted, sensitive, secret

**Visibility tier**:
The audience of a comment or activity entry — **Legal Only**, **Working Team**, or **Full Thread** [DD-016].
_Avoid_: Privileged (deliberately rejected — privilege is a legal doctrine, not a UI setting), internal, shared, public

**Portal**:
The lightweight, magic-link-authenticated surface where Business Users submit Requests and follow their threads [INT-001].
_Avoid_: customer portal, self-service portal

**Activity feed**:
The per-record narrative of what happened, inheriting the visibility tier of each action [DD-017].

**Audit log**:
The Administrator-only, append-only system-wide record, including security events the activity feed omits [DD-017].
_Avoid_: using "audit log" and "activity feed" interchangeably — they are two surfaces over one table

### Configuration

**Type**:
The configurable taxonomy on a Matter, Contract, or Request, and the designated carrier for policy — fields, templates, approvals attach here [CTR-002, MTR-001, INT-002].

**Field**:
An entry in the shared custom-field catalog, defined once with a module scope and attached to the types that should render it [MTR-011, CTR-016].
_Avoid_: custom field (when referring to the catalog entry itself), attribute, property

**Key date**:
A named deadline on a Matter or Contract; key dates feed deadline surfaces [MTR-004, CTR-009].

**Task**:
A lightweight checklist item. Deliberately not an entity — no comments, no status beyond done, and task due dates never feed deadline surfaces [MTR-005, CTR-017].

**Obligation**:
A recurring entity-level compliance item — a licence renewal, annual filing, or registered-agent renewal — rolled forward only on human confirmation [ENT-006].
_Avoid_: task, deadline, compliance item

**Urgency**:
What a requester supplies on a Request. It maps 1:1 to **priority** at conversion; **risk** is never requester-set [INT-002, MTR-012].

## Relationships

- A **Matter** contains many **Contracts** and many **Documents**
- A **Contract** owns many **Documents** and links to at most one **Matter** — contracts stand alone by default [MTR-007]
- Every **Document** has exactly one owning record: a **Matter**, **Contract**, **Entity**, or **Knowledge Item** [DOC-008]
- A **Document** has one or more **Document Versions**, strictly linear
- A **Contract** references one of our **Entities** and many **Counterparties**, exactly one of which is primary [CTR-011]
- A **Request** converts to exactly one **Matter** or one **Contract**, or is resolved or declined — never both [INT-007]
- A **Status** maps to exactly one **Stage** (contracts) or **Category** (matters); the mapping is immutable once set
- A **Matter** may have one parent **Matter**, arbitrarily deep, with no inheritance semantics [MTR-015]

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
> **Dev:** "Once it's live, the pill says 'Redlining with counterparty'. Do I branch on that?"
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
