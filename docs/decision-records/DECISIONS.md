# OpenLaw — Design Decision Record

This document captures the architectural and product design decisions made for OpenLaw. Each entry is a self-contained decision: context, decision, rationale, alternatives considered, and consequences.

Decisions are numbered chronologically and never deleted — superseded decisions are marked but kept for history.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

---

## DD-001: Internal-tool-first development model with portable architecture

- **Status:** Accepted
- **Date:** 2026-05-02

### Context

OSS legal-tech projects commonly fail by trying to build for an imagined user base rather than a concrete one. We need a development model that produces real product-market fit signal while still being deployable by anyone.

### Decision

- **Feature decisions** are driven by the needs of an actual small in-house legal team — the team building the project. We dogfood.
- **Architecture decisions** are made for portability — anyone should be able to clone the repo, run it, and have it work without our infrastructure.

### Rationale

1. Successful OSS dev tools (Cal.com, Plausible, Supabase, Excalidraw, Sentry) all started as authors solving their own problem.
2. Speculative open-source projects without a clear first user almost always become abandoned wishlists.
3. Portability is what differentiates "an internal tool published to GitHub" from a true OSS project.

### Alternatives considered

- **Open-source product first** (build for an imagined community) — rejected; this is the failure pattern.
- **Reference architecture / portfolio piece** — rejected; the goal is adoption, not the artifact.

### Consequences

- We will not add features for hypothetical users.
- We will refuse infrastructure shortcuts that bind the project to specific vendors.
- The roadmap is driven by what the building team needs day-to-day, not by external feedback (until external users exist).

---

## DD-002: Reference persona — small in-house legal team (2–10 people)

- **Status:** Accepted
- **Date:** 2026-05-02

### Context

"Legal department management" can mean wildly different things at different team sizes. We need a single reference persona to anchor product decisions.

### Decision

The reference persona is a **2–10 person in-house legal team at a 50–500 person company**, typically:

- A General Counsel
- One to a few Counsels and/or Paralegals
- Possibly a Legal Ops person
- Reporting to CEO/CFO/COO

### Rationale

1. **Underserved.** Solo counsels manage with Notion + Drive; large legal departments use Ironclad/LinkSquares/Onit. The 2–10 range has volume too large for free tooling and budget too small for enterprise CLM.
2. **Realistic dogfooding scope.** A solo persona produces a system that doesn't generalize; a 50-person persona is too complex to dogfood.
3. **OSS ICP fit.** Open-source self-hosted tools land best with small, scrappy, technically-curious teams.

### Alternatives considered

- **Solo counsel** — too thin for the system to be valuable.
- **Mid-size (10–50)** — well-served by existing commercial tools.
- **Large enterprise (50+)** — incumbents are entrenched; OSS won't displace them.

### Consequences

- All UI/UX decisions optimize for this persona.
- Enterprise-only features (SAML/SCIM, e-discovery, audit-log-export-to-SIEM) are out of v1.
- We assume **no enterprise SSO infrastructure** for non-legal employees.

---

## DD-003: v1 build queue starts with Contract Lifecycle Management

- **Status:** Accepted — build order now maintained in `docs/IMPLEMENTATION-PLAN.md` (2026-08-09). The
  contracts-first rationale below still holds and the plan follows it, but the plan sequences _all_ designed
  modules, not contracts alone. Where this record and the plan disagree on scope or ordering, the plan wins.
- **Date:** 2026-05-02

### Context

With multiple modules planned, we need a clear order of construction. The first shippable module sets adoption tone and produces reusable patterns.

### Decision

v1 ships the **Contract Lifecycle Management** module first. Other modules follow in subsequent releases.

### Rationale

1. **Highest documented pain.** Every legal ops report (ACC, WCC, BCLP, CLOC) lists contract review backlog as the #1 in-house complaint.
2. **Most generalizable patterns.** A contract pipeline subsumes intake, document storage, versioning, approvals, and signature handoff — primitives every other module reuses.
3. **Cleanest "before / after" story** for a public README.
4. **Defensible against incumbents.** Real gap for "good-enough self-hosted CLM" below the $30k/yr enterprise floor.

### Alternatives considered

- **Matter management first** — rejected; less universal pain, harder to demo.
- **Document repository first** — rejected; not differentiated from existing OSS DMS tools.
- **Compliance / risk first** — explicitly out of scope for the design pass.

### Consequences

- v1 release ships only contracts plus the cross-cutting plumbing it needs.
- Other modules are designed (mocked) but not built in v1.
- Out-of-scope from contracts v1: clause-level AI redlining, e-signature provider, automated drafting from playbook (all v2+).

---

## DD-004: Front-end-driven design pass; full mocks for all modules up front

- **Status:** Accepted
- **Date:** 2026-05-02

### Context

The team uses Pencil (pencil.dept) for UI mocks, and Pencil makes generating multi-screen UIs cheap (hours, not weeks). We needed to decide whether to detail-mock all modules up front, only mock the v1 module, or mock at platform-IA level only.

### Decision

Detail-mock all four modules (Matters, Documents, Contracts, Entities) and the cross-cutting capabilities up front, before implementing any of them. Implementation still proceeds one module at a time per **DD-003**.

**Guardrails:**

1. **Mocks are disposable.** When real-world use of an implemented module invalidates mocks for an unimplemented module, we throw the latter away with no sentiment.
2. **Mocks ≠ ship list.** The set of things mocked is broader than the v1 build queue. We don't ship a feature just because we mocked it.

### Rationale

1. Pencil makes detailed mocks cheap enough that the speculation tax is acceptable.
2. Cross-module IA coherence (navigation, design system, role/permission patterns) is best validated at the design layer before code.
3. Mocks of unbuilt modules serve as a vision/marketing artifact for the GitHub README — useful even if some details prove wrong.

### Alternatives considered

- **Platform-level pass only** (sitemap + 1 screen per module) — rejected; loses the cross-module design coherence value.
- **Per-module mocks just-in-time** — rejected; loses the unified vision artifact.

### Consequences

- Design effort runs ahead of implementation.
- Discipline required: revisions to deferred-module mocks must not block v1 ship.
- The Pencil files are a deliverable in their own right.

---

## DD-005: Restructure scope into functional modules + cross-cutting capabilities

- **Status:** Accepted
- **Date:** 2026-05-02

### Context

Initial scope listed eight items as if they were peers: matter management, document management, contract management, compliance, reporting, collaboration, knowledge management, risk. But these are not all the same kind of thing.

### Decision

Split the scope into:

**Functional modules** (own a primary entity; get their own nav item):

- Matters
- Documents
- Contracts (CLM)
- Entities (added per **DD-006**)

**Cross-cutting capabilities** (designed _into_ every module, not destinations):

- Search
- Comments / @mentions / activity feed (this is "collaboration")
- Dashboards / reporting
- Notifications

**Deferred for later phases:**

- Compliance management (regulatory programs, policy mgmt, training)
- Risk management
- Knowledge management / precedent search
- Reporting/analytics as a destination
- E-billing / outside counsel spend

### Rationale

1. Successful workflow products (Linear, Notion, Asana, GitHub) treat collaboration and reporting as cross-cutting properties, not destinations.
2. Treating cross-cutting capabilities as their own modules creates fake destinations and duplicates UI.
3. The compliance / risk / knowledge modules require their own deep design and aren't required for the contracts v1.

### Alternatives considered

- **Keep all 8 as peer modules** — rejected; produces fragmented UX.
- **Cut all but contracts** — rejected; we lose the platform vision.

### Consequences

- "Activity feed" lives on every entity, not as a top-level page.
- "Search" is global and cross-module from day 1.
- Compliance / risk / knowledge are planned but deferred — possibly indefinitely.

---

## DD-006: Add Entity Management as a functional module

- **Status:** Accepted
- **Date:** 2026-05-02

### Context

After **DD-005**, it became clear that corporate entity management (Diligent Entities / Athennian / Lextree category) is a distinct first-class need for in-house legal — managing your own entities, officers, statutory docs, trade licenses, registered agents, and renewal calendars.

### Decision

Add **Entities** as a fourth functional module. Includes the entity-level renewal calendar (license renewals, annual filings, registered-agent renewals, etc.).

**Definitional line:**

- **Inside Entity Management:** entity-level obligations attached to a specific entity (trade licenses, business registrations, annual filings).
- **Outside scope (deferred Compliance module):** company-wide regulatory compliance (SOC 2 controls, GDPR programs, policy mgmt, training tracking).

### Rationale

1. Universal pain at our reference persona — every small in-house team has at least one entity with annual obligations.
2. Adjacent commercial category (Diligent Entities, Athennian) is real and well-understood.
3. Without entity records, contracts and matters lack a critical foreign key (the contracting entity).

### Consequences

- Four modules total: Matters, Documents, Contracts, Entities.
- The renewal calendar lives in Entities, not in a separate Compliance module.
- Entity-level data (officers, licenses, statutory docs) is in scope.

---

## DD-007: Layered data model — Documents → Contracts → Matters; Entities orthogonal

- **Status:** Accepted
- **Date:** 2026-05-02

### Context

The four modules need a clear ownership and reference model. Without it, screens, URLs, and breadcrumbs become incoherent.

### Decision

- **Document** is the underlying file primitive (no workflow).
- **Contract** is a workflow object with parties; owns one or more Documents (draft, redlines, executed version, amendments).
- **Matter** is a work container; contains Documents and Contracts.
- **Entity** is an organizational container; orthogonal to the above (referenced by Contracts as parties and by Matters as subjects).

**Cardinalities:**

- Matter has many Contracts; Matter has many Documents.
- Contract has many Documents (versions / artifacts).
- Document can stand alone, be owned by a Contract, or be attached to a Matter. _(Revised by **DOC-008**, 2026-08-04: documents never stand alone — every document has exactly one owning record: matter, contract, entity, or knowledge item.)_
- Contract has many parties (Entities + Counterparties — see **DD-008**).
- Matter has many Entities (subjects, optional).

### Rationale

1. Matches real legal workflow — a contract negotiation produces multiple document artifacts.
2. Allows matters to be loose containers — some have contracts (M&A), some don't (employment dispute).
3. Lets Documents be a top-level destination (file index across the system).
4. Matches every successful CLM/DMS that ships today (Ironclad, LinkSquares, iManage, NetDocuments).

### Alternatives considered

- **Flat & independent** (Documents/Matters/Contracts as parallel entities, loose links) — rejected; loses ownership semantics.
- **Hierarchical** (Matter is the root container, everything inside) — rejected; overkill for simple contracts.

### Consequences

- A contract's "current document" is computed (latest version, primary marker), not a separate field.
- A document carries optional references to contract and/or matter.
- Documents are first-class enough to have their own nav, search, and detail pages.

---

## DD-008: Separate `entities` and `counterparties` tables, with `parties_view` abstraction

- **Status:** Accepted
- **Date:** 2026-05-02

### Context

Internal entities (your subsidiaries) and external counterparties have very different schemas, lifecycles, and UI needs. We had to decide whether to combine them into one table or split.

### Decision

Two separate tables:

- **`entities`** — your corporate entities. Rich schema (officers, share capital, registered agent, EIN, registered address, statutory documents, license registry, renewal calendar).
- **`counterparties`** — external organizations on the other side of contracts/matters. Light schema (name, jurisdiction, primary contact, address).

Cross-cutting reads use a **`parties_view`** abstraction (SQL view or repository method) that UNIONs the two with a type discriminator and a shared subset of columns (`id`, `type`, `name`, `jurisdiction`, `primary_address`). Module-specific reads use the underlying tables directly.

### Rationale

1. ~70% of the schema is genuinely different between internal and external — single-table-with-type forces nullable fields everywhere.
2. Lifecycles differ: internal entities are deliberately created via incorporation; counterparties are created on the fly during contract intake.
3. Cardinality differs: 1–50 internal entities vs 1,000+ counterparties.
4. UI needs differ: rich detail-first view for entities, fast fuzzy autocomplete for counterparties.

### Alternatives considered

- **Single `Entity` table with `relationship_type` field** — rejected; nullable-field hell, code-smell that haunts forever.
- **Party + Role abstraction** (every org is a Party with one or more Roles) — rejected; over-engineered for legal where multi-role orgs are rare.

### Consequences

- Polymorphic foreign keys: every place that references "a party" handles two FK targets.
- Acquisitions (counterparty becomes your subsidiary) require record migration — rare but messy.
- The `parties_view` layer must be maintained alongside both tables.
- Intercompany contracts (between two of your entities, no counterparty) work naturally.

---

## DD-009: Single-tenant per deployment

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

We had to choose between single-tenant (one install = one organization) and multi-tenant (one install can serve many organizations).

### Decision

**Single-tenant.** One install serves one organization with users and (optionally) teams inside it. No `tenant_id` columns. URLs do not carry tenant slugs.

### Rationale

1. Matches the OSS pattern — every successful self-hosted workflow tool (Cal.com, Plausible, Mattermost, Ghost, Penpot, Excalidraw) ships single-tenant.
2. Multi-tenancy is a tax that compounds on every query, fixture, test, and cache key — paid against zero benefit until a hosted SaaS exists.
3. If a hosted "OpenLaw Cloud" ever exists, the right model is one DB or schema per customer (deployment concern), not interleaved rows (product code concern).

### Alternatives considered

- **Multi-tenant from day one** — rejected; high tax, no v1 benefit.
- **Single-tenant code with tenant-aware schema** — rejected; worst-of-both abstraction overhead with no validation.

### Consequences

- Schema is simpler.
- A future hosted SaaS would deploy one tenant per Postgres database/schema behind a single app or via separate app instances.
- Authorization is org-scoped (users, roles, teams), not tenant-scoped.

---

## DD-010: Layered intake strategy — ChatOps + magic-link form + email parser

- **Status:** Accepted — **revised by INT-001 (2026-08-04)**: capture narrows to structured forms in a lightweight portal (JSM-style); email becomes outbound-notification-only (inbound parsing dropped from v1); ChatOps shrinks from capture+bridge to at most notifications/deep-links. The magic-link + domain-allowlist mechanics survive as the portal's auth.
- **Date:** 2026-05-03

### Context

The success of the platform hinges on whether non-legal business users actually submit requests through the system rather than via direct email/Slack to lawyers. Multiple research streams (commercial CLM survey, adjacent-space tools, OSS landscape, industry research) converge on the conclusion that single-pattern intake consistently underperforms multi-channel.

### Decision

> **Superseded architecture note (2026-08-04, INT-001).** The three-surface capture architecture below is retained for history but is no longer the plan. What survives: a single `Request` entity triaged into a Contract, a Matter, or resolved-in-thread; the magic-link + domain-allowlist mechanics of surface 2, which become the **portal's authentication**; and **outbound** email notifications (deep-linking back to the portal). What is superseded: ChatOps capture (parked — at most notifications and portal deep-links, FUTURE-FEATURES), inbound email parsing and its three transports (dropped from v1 — future candidate with parse-to-form-prefill), and the Slack-in-v1.5 build queue. Capture is structured per-type forms in a lightweight portal only — see INT-001.

Three intake surfaces, all feeding a single `Request` entity that is triaged into a `Contract`, a `Matter`, or resolved-in-thread:

**1. ChatOps via adapter pattern** — primary surface

- A `ChatAdapter` interface defines the platform-agnostic intake contract (auth, modal/form rendering, message threading, status updates).
- **Slack adapter** is built in for v1.
- **Teams adapter** is a fast-follow (~v1.5).
- Google Chat / Mattermost / Discord / others are community-contributable via the documented adapter interface.

**2. Web form with magic-link authentication and domain allowlist** — secondary surface

- The form URL is shareable.
- To submit, the user enters their corporate email; the system checks against a configured allowed-domains list.
- If allowed: the user receives a one-time signed magic link, which opens the form with identity bound to that email.
- No account or password is required.

**3. Email-to-intake on a dedicated address** — tertiary / always-on floor

- Convention: `intake@yourcompany.com` (configurable; not `legal@`).
- Inbound supported via three configurable transports: IMAP polling, webhook (SES Inbound / Postmark / Mailgun / Resend), or SMTP forwarding from an existing mailbox.

**Build queue:** form + email parser ship in v1; Slack ChatOps ships in v1.5.

### Rationale

1. The strongest adoption signals across commercial CLMs (Lexion's email-first; Ironclad / Juro / SpotDraft / Malbek's Slack-first) and adjacent tools (Halp, Linear Asks) all point to "meet users where they are."
2. Authenticated portals fail at our persona — small target companies rarely have SSO infrastructure for non-legal employees.
3. Truly public forms are unacceptable for legal — spam, phishing, no identity. Domain-allowlisted magic-link is the right "no-account, authenticated" pattern.
4. `legal@` is overloaded with distribution-list and legal-notice traffic; a dedicated `intake@` address is the correct convention.
5. ChatOps is too valuable to skip but Slack-only is too narrow — adapter pattern is the OSS leverage move.

### Alternatives considered

- **Single anonymous public form** — rejected; spam risk, no identity, legal teams won't accept it.
- **Authenticated portal as primary** — rejected; high IT setup cost, breaks at our persona.
- **Slack-only ChatOps with no abstraction** — rejected; excludes Teams and Google Chat orgs (likely the larger market).
- **Hijacking `legal@` as the intake parser** — rejected; conflicts with legal-notice and DL usage.
- **All three plus Slack in v1** — rejected; bloats v1 surface area, risks shipping a half-baked Slack bot.

### Consequences

- A `Request` entity is added to the data model, parent to `Contract` / `Matter` where applicable.
- A `ChatAdapter` interface must be designed and documented as a public extension point.
- Inbound email parsing requires three configurable transport backends.
- The web form must mock the domain-allowlist setup, magic-link flow, and post-submission tracking page.
- The Pencil mock pass includes the Slack modal flow as the canonical ChatOps reference; Teams / Google Chat are not detail-mocked in v1.

---

## DD-011: License — AGPL v3

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

OpenLaw is open source by intent (per **DD-001** and Principle 4 in `PRODUCT.md`). License choice determines who can adopt, who can contribute, and whether commercial actors can wrap and rebrand the project as a closed-source SaaS without contributing back. The category (CLM) has a high commercial floor (~$30k/yr enterprise tools), so the SaaS-fork risk is non-trivial.

### Decision

License the project under **GNU Affero General Public License v3.0 (AGPL-3.0-only)**. Single license, no dual-licensing or commercial escape hatch.

### Rationale

1. **Network copyleft fits the threat model.** AGPL is the only OSI-approved license that prevents a SaaS company from wrapping OpenLaw, hosting it for paying customers, and never contributing changes back. For a category as commercially attractive as CLM, this protection matters.
2. **The audience is uniquely AGPL-tolerant.** Our users are in-house lawyers — the rare OSS adopter group that will read the LICENSE file rather than rely on a blanket-deny enterprise OSS policy. They will recognize that AGPL imposes no obligations on **self-hosted internal use** (the primary deployment mode under **DD-009**); obligations only trigger if the deployment serves third parties.
3. **Direct precedent works.** Plausible, Bitwarden, Mastodon, Ghost, and Element are direct analogues — OSS alternatives to commercial tools, primarily self-hosted — and all thrive under pure AGPL.
4. **Single-license keeps overhead minimal.** Dual-licensing (AGPL + commercial) would add CLA infrastructure, license-key issuance, and sales overhead that this side project does not need. We can relicense later if a commercial offering ever materializes (Sidekiq has done this).

### Alternatives considered

- **MIT** — rejected; permits closed-source SaaS forks in a high-commercial-value category.
- **Apache 2.0** — strong second choice, with explicit patent grant and broader enterprise acceptance. Rejected because it offers no defense against SaaS-wrapping. Reasonable to revisit if AGPL adoption friction proves higher than expected.
- **Dual license: AGPL + commercial** — rejected; operational overhead unjustified for a side project with no commercial intent.
- **Source-available (BSL, Elastic v2, SSPL)** — rejected; not OSI-approved, alienates the contributor base, conflicts with `PRODUCT.md` Principle 4.

### Consequences

- The repository ships a `LICENSE` file containing the AGPL-3.0-only text.
- Source files carry SPDX headers (`SPDX-License-Identifier: AGPL-3.0-only`).
- All dependencies must be license-compatible with AGPL-3.0 (most permissive OSS licenses are; GPL-2.0-only and some proprietary EULAs are not — must be checked).
- Any future hosted "OpenLaw Cloud" offering would itself be subject to AGPL's network clause unless we either (a) own all the copyright and relicense, or (b) collect contributor agreements that permit relicensing. We do **not** require a CLA for v1 — this is a deliberate trade-off favoring contribution friction over future commercial flexibility.
- Some enterprise adopters with blanket "no AGPL" policies will be excluded. We accept this; they are not the target persona.

---

## DD-012: Project name — keep "OpenLaw" with documented rename trigger

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

"OpenLaw" is the working title used in `PRODUCT.md`. The name has a known collision: a ConsenSys spinoff (focused on Ricardian / smart legal contracts) used `openlaw.io`, the `openlaw` GitHub org, and the `openlaw` npm package before rebranding to TributeLabs in 2021–22. The original project is dormant but the namespace residue (search results, archived repos, the dev.to backlog) persists.

### Decision

Adopt **OpenLaw** as the project name. Record an explicit **rename trigger**: rename the project if either (a) a credible trademark or takedown notice arrives, or (b) SEO/namespace drag is still materially impeding adoption 18 months after first public release.

The fallback name on rename is **Counsel** (single-syllable, clean category fit, no current OSS-namespace conflict). Secondary fallbacks: **Docket**, **Mantle**.

### Rationale

1. The name is the product — "open + law" communicates the project's category and OSS nature in two syllables, with no elevator-pitch tax.
2. Trademark enforcement risk is low — the original team formally rebranded, has shown no enforcement appetite in 4 years, and the original mark covers smart-contract / blockchain use cases that don't directly overlap with CLM/matter management.
3. SEO drag is real but resolves with traction — Plausible, Mastodon, Ghost, and Element all entered crowded namespaces and won them through quality.
4. Rename cost on a pre-ship side project is low — repo renames, npm scope renames, and domain redirects are routine. We pay nothing now for the option to switch later.

### Alternatives considered

- **Pick a new name now (Counsel, Docket, Mantle, etc.)** — rejected; pays the strategic cost up front for a hypothetical legal cost later. Held in reserve as the rename target.
- **Compound name (OpenCounsel, LawHub, LegalCore)** — rejected; most are either taken, dorky, or both.

### Consequences

- The repo, package, domain, and all UI copy use "OpenLaw" until/unless the rename trigger fires.
- We do not register the trademark — registration would invite scrutiny we don't want, and the cost outweighs the benefit at this stage.
- We monitor for takedown notices and SEO impact. If either trigger fires, the rename target is **Counsel** unless a better candidate has emerged.

---

## DD-013: Four-role permission model — Administrator, Legal Team Member, Contributor, Business User

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

Every UI mock and every authorization check must answer "who can see / do what?" Without a fixed role taxonomy, mocks contradict each other and the data model can't define foreign keys cleanly. We needed a role count and a role definition before any further design work.

### Decision

Four fixed roles. Custom RBAC is explicitly deferred (see Alternatives).

| Role                  | Audience                                                                                | Default access                                                                                                                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Administrator**     | General Counsel, Legal Ops                                                              | Full access. Can configure modules, manage users, set up intake channels, change system settings, see all matters/contracts/entities including sensitive ones.                                                                                                                                            |
| **Legal Team Member** | In-house counsels, paralegals                                                           | Full functional access to legal work — read/write across Matters, Contracts, Documents, Entities — _except_ (a) cannot change system settings, (b) cannot see information flagged as sensitive unless explicitly added to that matter. Mechanism for the sensitivity gate is defined in **DD-014** (TBD). |
| **Contributor**       | Procurement, compliance, finance, others embedded in legal-adjacent work                | Enhanced access beyond Business User but less than Legal Team Member. Sees only matters/contracts they are explicitly added to. Within those, can read and contribute (comment, upload docs, edit specific fields) per **DD-015** (TBD). Cannot browse the system more broadly.                           |
| **Business User**     | All other employees (sales, HR, engineering, marketing, etc.) submitting legal requests | Sees only requests they personally submitted, plus comments addressed to them. Cannot browse matters, contracts, documents, or other users' submissions. Activity is tracked for the audit log.                                                                                                           |

### Rationale

1. **Maps to actual org structure.** The Admin / Legal Team / Adjacent-Function / Everyone-Else split is how small in-house departments describe their access tiers in practice.
2. **Contributor solves a real gap.** Procurement reviewing supplier contracts, compliance touching investigation matters, finance on a credit facility — these users genuinely need write access to specific matters but should not see the wider legal docket. Without this role they'd be either over-privileged (made Members) or under-privileged (stuck as Business Users) — both are common failure modes in real CLM deployments.
3. **Fixed roles beat custom RBAC for v1.** Custom roles create combinatoric test surface and screen logic; the simplest version of every screen is "if Admin then X else if Member then Y...". Save custom RBAC for when paying customers ask for it.
4. **Legal Team Member sensitivity gate matches privilege practice.** In-house counsel routinely handle matters (investigations of executives, M&A under NDA, employment disputes involving a colleague) that legitimately must be walled off even from peers. The gate is non-optional.
5. **Tracking Business User activity is non-negotiable.** Audit trails on who submitted what, when, and what they read are required for any system that touches privileged or compliance-sensitive workflows.

### Alternatives considered

- **Three roles (Admin / Member / Requester)** — rejected; misses the procurement / compliance use case, forcing those users to be over-privileged or under-privileged.
- **Two roles + per-entity ACLs (Notion model)** — rejected; sharing-list-per-matter is heavy UI overhead almost nobody uses inside a single legal department.
- **Full custom RBAC** — rejected as v1; reasonable to add later as an Admin-only feature behind a flag.
- **Adding a "Read-only" role for board members / auditors** — deferred; can be approximated by making someone a Contributor scoped to one matter with read-only entity rules in **DD-015**.

### Consequences

- The data model carries a `role` column on `users` with an enum of these four values.
- Every screen has an authorization wrapper; mocks in Pencil are produced for each role's view of the same screen where they meaningfully differ.
- The "sensitive information" gate for Legal Team Members must be defined separately (**DD-014**, pending).
- The Contributor permission grid (read-only? comment-only? edit fields? upload docs?) must be defined separately (**DD-015**, pending).
- Activity logging for Business Users must be defined separately (**DD-016**, pending).
- A future "custom RBAC" feature would extend this taxonomy without invalidating the four-role default.

---

## DD-014: Sensitive matter gating — confidential flag, opt-in restriction

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

Per **DD-013**, Legal Team Members default to broad access but cannot see "sensitive information." This decision defines the gating mechanism. The choice has high blast radius — it determines whether matter visibility is open-by-default or closed-by-default across the entire data model.

### Decision

**Open-by-default with an opt-in `is_confidential` flag.**

- Default visibility for Matters, Contracts, and standalone Documents: every Legal Team Member sees them.
- A boolean `is_confidential` flag may be set on a Matter (and on Contracts and standalone Documents). When set, only the explicitly named team — assignees, watchers, the matter creator, and Administrators — can see the record or anything attached to it.
- Confidential matters do not appear in any list, search result, or count visible to non-team Members. They are silently omitted, not shown as "[hidden]" placeholders.
- Setting / unsetting the flag is restricted to Administrators and the matter creator. Both actions are written to the audit log.
- Confidentiality cascades: documents, comments, and activity-feed entries attached to a confidential matter inherit the gate. There is no per-document override below a confidential matter.
- Administrators always see everything. There is no per-matter exclusion for Admin role; if an Administrator must be walled off from a matter, they require a role downgrade.

### Rationale

1. Mirrors how small legal teams actually work — the whole team sees everything by default, with a small fraction of matters (typically <10%) walled off as exceptions (executive investigations, M&A, employment matters involving the legal team itself).
2. Default-narrow models (only see matters you're added to) create constant friction, push communication into back-channels, and break conflict-checking and load-balancing across the team.
3. Per-document gating leaks metadata at the matter level (matter title, activity volume, named team) — the whole matter must be hideable.
4. Tiered sensitivity (general / restricted / privileged) is over-engineered for the reference persona; the practical line is binary.

### Alternatives considered

- **Default-narrow with explicit grant** — rejected; inverts the wrong default for this persona.
- **Sensitivity tiers (general / restricted / privileged)** — rejected as v1; deferrable feature.
- **Per-document sensitivity (matter is always visible, documents can be hidden)** — rejected; leaks matter-level metadata.

### Consequences

- The `matters`, `contracts`, and `documents` tables carry an `is_confidential` boolean column.
- Every list/search/aggregation query on these entities must apply a confidentiality filter at the data access layer. This is a cross-cutting concern that benefits from a single repository helper rather than per-query handling.
- A "team" association exists on Matters: `matter_team` rows linking a `user_id` to a `matter_id` with an optional role (assignee, watcher, creator). The same model applies to Contracts and standalone Documents.
- The audit log records `confidentiality_set` and `confidentiality_cleared` events with actor, timestamp, and matter/contract/document ID.
- The Pencil mocks must include the "matter list with hidden confidential" view for Members, and the "confidential team management" UI for Admins / matter creators.

### Addendum (2026-08-23, M22 close, [#474](https://github.com/juggernog20/OpenLaw/issues/474)) — the Matter gate is one predicate over every read

M22 shipped the shared Matter reach predicate and uses it inside list, record, converted-record, comment, activity, notification, and document queries. Administrators reach every Matter; a Legal Team Member reaches an open Matter by default and a confidential one only through a team row or as Matter Manager; a Contributor reaches only Matters with their team row; a Business User reaches none directly. An omitted Matter contributes no row, link, notification, document, comment, activity entry, or count.

The write actor set extends the original creator rule the same way Contracts extended it for their Owner: an Administrator, the Matter's creator, or its Matter Manager may set or clear confidentiality and maintain the roster of a confidential Matter. The persistent banner, external-title marker, comment notice, and bounded mention picker all read that same answer. There is no auto-grant on mention: candidates are already inside the audience, so DES-009's old warning arm has no case to fire.

### Addendum (2026-08-24, M23 close, [#496](https://github.com/juggernog20/OpenLaw/issues/496)) — the wall covers every work surface

Key dates, Tasks, Matter relationships, Contract links, Contributor Field writes, supporting Documents, lifecycle advisories, Activity, and notifications all resolve Matter reach through the same predicate. A reachable relative may be named; an unreachable one is either omitted or represented only as a Restricted Matter. Linking and hierarchy never copy a flag or audience, and Closing never changes either.

---

## DD-015: Contributor permission grid — read, comment, upload, edit business fields

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

Per **DD-013**, the Contributor role exists for non-legal-team users (procurement, compliance, finance) who need more access than Business Users on specific matters but should not receive Legal Team Member privileges. This decision defines the exact permission grid.

### Decision

Contributors are made-not-born and scoped per-entity:

- A user becomes a Contributor on a specific Matter or Contract when an Administrator or Legal Team Member adds them to the matter team.
- Contributor membership grants no global access — it applies only to the entity they were added to.
- A user can be a Contributor on multiple matters; each grant is independent.

On matters/contracts they are added to, Contributors can:

- **Read:** matter detail, attached documents, activity feed, comments not marked `internal` (see **DD-016**).
- **Comment:** post comments at the `team` and `shared` visibility tiers (see **DD-016**); cannot post at the `internal` tier.
- **Upload documents:** PDFs, Word docs, images, and other typical attachments. Cannot upload as a new version of a primary contract document (that is a Member-level redline action).
- **Edit business fields only.** Each editable field on a matter/contract record carries a tag: `business` or `legal`.
  - `business` (Contributor-editable): counterparty name, contract amount, payment terms, business effective dates, vendor contact info, internal cost center, business description.
  - `legal` (Member-only): governing law, jurisdiction, indemnity caps, IP assignment, confidentiality terms, matter type, workflow status, assigned lawyer, the contract document body, parties on the contract.

Contributors cannot:

- Change workflow status (draft → review → approved → signed).
- Mark a matter / contract / document as confidential or remove the flag.
- Add or remove parties.
- Create new top-level matters or contracts from scratch (must use the standard intake path as a Business User; a Member then promotes them to Contributor on the resulting matter).
- See `internal`-tier comments.

All Contributor edits and uploads carry the user's name and role tag in the activity feed and document metadata.

### Rationale

1. The role's actual purpose is _contribution to specific matters_, not browsing — read access is intentionally narrow.
2. The `business` / `legal` field split mirrors how procurement and counsel actually divide work on a contract: business term inputs vs. legal term ownership.
3. Workflow status is the legal team's promise to the business, not a shared field — letting Contributors flip status undermines the core CLM purpose.
4. Privileged comment threads must remain Member-only; the whole reason for a separate role is to enable legal-only conversation alongside business collaboration.
5. Document upload is essential — half the time-savings comes from procurement attaching the SOC 2 / vendor diligence directly instead of emailing it.

### Alternatives considered

- **Read + comment only (no upload, no edit)** — rejected; collapses the role into "Business User who happens to see more matters."
- **Full collaborator (workflow status, parties, confidentiality)** — rejected; blurs the line with Member to the point that the two roles become indistinguishable.
- **Contributor can promote themselves on related matters** — rejected; promotion must be Member/Admin gated to preserve the privilege firewall.

### Consequences

- Each editable field on the Matter and Contract schema carries a `business | legal` tag in code (an enum or constant in a fields config), enforced at the API layer.
- The matter team UI must support adding a Contributor and (separately) adding a Member to a matter — different actions with different downstream permissions.
- Document upload UIs distinguish "attach a supporting document" (Contributor-allowed) from "upload a new version of the primary contract" (Member-only).
- The audit log records every Contributor edit with field name, old value, new value, actor, and timestamp.
- A Contributor's view of a matter is visually distinct in the mocks from a Member's view — different action menus, different field lock states, hidden internal-comment thread.

### Addendum (2026-08-24, M23 close, [#496](https://github.com/juggernog20/OpenLaw/issues/496)) — the complete grid is live

On a reached Matter or Contract, a Contributor reads the record and its permitted comments, Activity, Documents, dates, Tasks, and relationships; posts at Working Team or Full Thread; edits the description and projected business Fields; and creates or extends supporting Document chains. Status and lifecycle, type, Manager or Owner, team, confidentiality, legal Fields, primary-document designations, Key dates, Tasks, relationships, approvals, and envelopes remain Member+ legal actions. Every route enforces the same distinction before storage, and every accepted write records the Contributor as actor and uploader.

---

## DD-016: Comment visibility — three audience tiers (Legal Only / Working Team / Full Thread)

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

Comments are the connective tissue of every matter, contract, and request. Three distinct conversations happen on a single piece of legal work:

1. Lawyers talking to each other (strategy, risk, internal disagreement) — must not be visible to procurement, finance, or the requester.
2. The full working group coordinating — lawyers plus embedded Contributors (procurement, compliance, finance) — but not the requester who submitted.
3. Updates and questions for the requester themselves.

Without a tiered visibility model, every comment ends up either too public (leaks legal strategy) or too private (forces parallel side-channels — Slack DMs, email threads — outside the system).

### Decision

Three audience-tiered visibility levels on every comment, named after their actual audience:

| Tier | Label            | Audience                                                                           |
| ---- | ---------------- | ---------------------------------------------------------------------------------- |
| 1    | **Legal Only**   | Administrators + Legal Team Members                                                |
| 2    | **Working Team** | Administrators + Legal Team Members + Contributors on the matter                   |
| 3    | **Full Thread**  | Administrators + Legal Team Members + Contributors + the originating Business User |

**Default selection rules:**

- Comments composed from the matter / contract detail page default to **Working Team**.
- Comments composed from the request thread (Business-User-facing view) default to **Full Thread**.
- @-mentioning a Business User auto-promotes a comment to **Full Thread** (with a confirmation step).
- Members can downgrade to **Legal Only** from any composer.
- Contributors can post at **Working Team** or **Full Thread** only — they cannot post at **Legal Only**.

**Rendering rules:**

- Each comment displays its visibility badge ("Legal Only" / "Working Team" / "Full Thread") next to the author.
- Visibility is filtered at query time, not display time — users see only comments their role/relationship permits. They are not shown placeholders or counts of hidden comments.
- The originating Business User sees only **Full Thread** comments and has no indication that other tiers exist on the matter (avoiding metadata leakage about volume of internal discussion).

### Rationale

1. The three tiers map exactly to the three real audiences in a legal matter; collapsing to two leaks procurement into the wrong channel, and arbitrary-visibility lists are over-engineered.
2. Audience-named labels ("Legal Only", "Working Team", "Full Thread") are self-documenting in the composer dropdown — the user reads the audience, not an abstract concept they have to mentally translate.
3. The label "Privileged" was deliberately rejected for Tier 1: attorney-client privilege is a substantive legal doctrine, not a UI checkbox. Naming the tier "Privileged" risks (a) giving users a false sense of formal protection, and (b) creating a record of system-marked comments labelled with a legal term of art that could complicate discovery later. "Legal Only" is descriptive without invoking the doctrine.
4. Tier names describe the full audience, not the delta. "Contributors" as a Tier 2 label would mislead — a Member writing the comment might assume only procurement sees it.

### Alternatives considered

- **Two tiers (`internal` / `shared`)** — rejected; conflates Contributors and Business Users, forcing every shared comment to be requester-visible.
- **Channel-style arbitrary visibility lists** — rejected; high UI complexity, users default to a small number of presets in practice anyway.
- **Naming Tier 1 "Privileged"** — rejected for the doctrine-confusion / discovery-evidence reasons above.

### Consequences

- The `comments` table carries a `visibility` column with an enum of `legal_only | working_team | full_thread`.
- Every comment query applies a visibility filter at the data access layer based on the requesting user's role and matter membership.
- Activity feed entries (status changes, document uploads, field edits) follow the same visibility model — an activity entry is generated at the appropriate tier based on what action it represents.
- The composer UI must show all three options to Members/Admins, and only Working Team / Full Thread to Contributors. Business Users do not see a tier selector — their comments are always Full Thread by definition.
- Pencil mocks must include the composer with the visibility selector and three example comment renderings (one of each tier) on the matter detail timeline.

### Addendum (2026-08-24, M23 close, [#496](https://github.com/juggernog20/OpenLaw/issues/496)) — one thread survives Closing

Matter work surfaces use the existing three tiers without a new audience. Reached Contributors remain in Working Team and Full Thread, Business Users remain outside the direct Matter record, and hidden Legal Only rows contribute no placeholder or count. Closing changes none of those rooms, so the same comment composer remains writable afterward; Archiving alone freezes the record.

---

## DD-017: Activity tracking — two-layer model (per-entity activity feed + system-wide audit log)

- **Status:** Accepted
- **Date:** 2026-05-03

### Context

Two distinct user needs exist around tracking who-did-what:

1. A lawyer reconstructing the narrative of a matter or contract — "what happened on this deal between Tuesday and Friday?"
2. A General Counsel or InfoSec function demonstrating to auditors that admin actions and sensitive-data access are recorded — "who changed this user's role last quarter? who exported the matter list?"

These needs are related but require different surfaces, different retention semantics, and different access controls.

### Decision

Two layers, both append-only, both inherit the visibility model defined in **DD-014** and **DD-016**:

**Layer 1 — Per-entity activity feed.** Visible inline on every Matter, Contract, and Document. Records every content action: creation, field edits, document uploads, comment posts, status changes, party additions/removals, confidentiality toggles, assignments, downloads.

- Activity entries inherit the visibility tier of the action they represent. A `Legal Only`-tier comment generates a `Legal Only`-tier activity entry; a Working-Team-visible field edit generates a Working-Team-visible entry.
- Visibility is filtered at query time. Users do not see placeholders or counts of hidden entries — that itself would leak metadata.
- Confidential entities (per **DD-014**) hide the entire activity feed from non-team Members.

**Layer 2 — System-wide audit log.** Visible to Administrators only. Includes everything in the activity feed _plus_ security-sensitive admin actions: user CRUD, role changes, intake-channel config changes, exports, login/logout events, permission grants.

- Append-only and immutable. Corrections are made by appending a correction entry, never by mutation.
- No automatic deletion. Records persist for the life of the entity. Soft-deleted entities retain their audit history, marked as orphaned.
- Exportable as CSV/JSON for the org's compliance program.

**Read events are not logged in v1.** Per-user "X opened this matter at 3:42pm" tracking is reserved for a future flag-gated feature, if ever — it is privacy-invasive and adoption-hostile for the reference persona.

**Document downloads are logged** in both layers. Contract exfiltration is a real concern; download tracking is table stakes.

**Structured event emission** to stdout (JSON / logfmt) runs in parallel to the in-app log, so self-hosting admins can ship events to their own SIEM (Datadog, Loki, Splunk) without a separate integration.

### Rationale

1. The two-layer model matches the two distinct user needs without forcing one surface to serve both poorly.
2. Per-entity activity feeds are the legal-work narrative — every commercial CLM treats this as a top-tier UI element because lawyers reconstruct deals through this view.
3. The system-wide audit log is the compliance baseline (SOC 2, ISO 27001, GDPR Article 30) — none require event-sourcing-level depth, all require tamper-resistant records of admin and sensitive actions.
4. Inheriting the visibility model from **DD-014** and **DD-016** keeps a single coherent access-control story instead of parallel rule sets.
5. Read-event logging is over-collection for the persona — it produces surveillance-feeling artifacts that lawyers will turn off or refuse to use.

### Alternatives considered

- **Security audit log only (no activity feed)** — rejected; loses the matter-narrative use case that drives every CLM UI.
- **Full event sourcing including reads** — rejected; storage cost, privacy implications, adoption-hostile.
- **External SIEM emission only, no in-app UI** — rejected; useless for self-hosters without an existing SIEM, and "who approved this contract?" should answerable inside the product.

### Consequences

- An `activity_log` table is the source of truth, with rows tagged by `entity_type`, `entity_id`, `actor_id`, `action`, `visibility`, and a JSON `payload` of action-specific data.
- The audit-log view is a query over the same table plus the subset of events that are admin-action-typed; it is not a separate table.
- All entries are append-only at the application layer; no UPDATE/DELETE operations are permitted by application code on this table.
- Structured event emission to stdout is a separate concern handled by the application logger, not by the activity feed.
- Pencil mocks must include the activity feed (filterable by entity), the matter timeline rendering, and the admin audit-log page (with filters, search, and CSV export).

### Implementation clarification (2026-08-13, #132)

The per-entity feed is built. Five points the decision left open, answered by the surface that first reads the table.

1. **A record action's tier is Working Team.** DD-017 says an entry inherits the visibility tier of the action. Editing a field, moving a status, or putting somebody on the team is the working group's business, so the working group reads it. `contract.*` writes `working_team` through one named constant, `RECORD_ACTIVITY_TIER` in `apps/api/src/lib/activity.ts`, so the policy has one place rather than twelve. `admin_only` is unchanged and stays for settings, user administration, and security actions; a comment entry takes no default at all, because it rides the comment's own tier (CMT-006). The Entities record's `entity.*` entries still write `legal_only`: its activity bar is not mounted, and they adopt the constant when the Entities feed lands in Arc 6.

2. **Rows written before this stay as written.** M8 wrote `contract.*` at `legal_only`. No migration rewrites them. Append-only means append-only, and a handful of early entries reading narrower than they would today is the honest state of the table. This is pre-release; the cost is nil and the precedent is worth more.

3. **The feed reuses one gate, and excludes `admin_only` by not asking for it.** `contractAudience` answers which record the viewer reaches (CTR-021) and which DD-016 tiers they hear on it, and the feed filters on exactly that list. `readableTiers` never answers `admin_only`, so a settings or security entry is out of a record feed by the same fact that puts Legal Only out of a Contributor's reach — no second rule, and no list of excluded slugs to keep in step.

4. **The feed pages, from the first release.** `GET /api/v1/activity` answers one page and a cursor. The page size is a server constant, not a client parameter: the point is that no request returns the whole history, and a limit the client picks is a limit the client can decline to pick. Paging is keyset on `(created_at, id)` — the order the feed reads in, and the leading columns of `activity_log_entity_idx`. The cursor is one entry's id; a cursor naming no row answers an empty page rather than an error. There is no total in the envelope, for the reason the comment thread has none: a count computed over rows the viewer cannot see is a leak like any other.

5. **The read side's action vocabulary is open where the write side's is closed.** `ActivityAction` is a closed union because a mistyped slug would be a permanently unqueryable row. The response schema types `action` as plain text instead, and the narration layer renders an unrecognised slug plainly rather than throwing. Nothing prunes this table, so a slug written by a version of the application that no longer exists is still in it and still has to come out.

The narration layer is `apps/web/src/lib/activity.ts`: slug plus payload to an ICU message, its values, and the family's glyph, with old and new values rendered through the same formatters the record page uses. It sits in `lib/` rather than inside the panel because the Administrator's audit log is a second reader of it.

### Implementation clarification (2026-08-13, #133)

The audit log is built, and with it the SIEM clause. Six points the decision left open, answered by the surface that reads the whole table.

1. **The audit log consults no access layer at all.** The record feed reuses `contractAudience` because it is a record's feed and a Contributor's reach is the question. This surface has no record, so there is no reach to compute: it reads `activity_log` with no tier predicate and no entity scope, gated on the Administrator role alone (SET-002, DD-013). The two surfaces share the table and the narration and nothing else, deliberately — a tier predicate threaded through both would be one rule serving two questions, and the audit log's answer would then depend on a function of the reader's contract teams.

2. **The pane is absent, not refused** (SET-002). It sits in the Security group of `/settings`, which is inside the Organization group non-Administrators never see. The route's loader bounces them and the API answers 403, but the point is that the rail never advertises it.

3. **The export is bounded at its own entry.** DD-017 makes an export a security event, so taking one appends `export.performed` at `admin_only`, carrying the filters it was taken under — the log says what left, not merely that something did. That entry is written before a byte is streamed, so a reader who disconnects mid-download is still on the record; and the stream is bounded above by it, on the same `(created_at, id)` keyset the paging uses. An export therefore never contains the record of itself, and two exports of one filter answer the same rows. `export.performed` joins the closed `ActivityAction` union, and hangs off `system`, because an export is about no single record.

4. **CSV is the export this surface offers; JSON is not built.** DD-017's decision clause says "exportable as CSV/JSON", and only the CSV half ships here — #133 scoped the export to CSV, and the JSON half of the compliance story is served for now by the structured emission below, which is the same events in the same shape as newline-delimited JSON. A JSON download from the pane is unbuilt rather than declined; it belongs beside the CSV route, on the same predicate, when somebody wants it. Nothing about DD-017 is superseded — this is one clause partly built, said plainly rather than left to be discovered.

5. **The export streams, and the browser downloads it.** The filtered set has no bound, so the response is a `text/csv` stream walked in chunks over the same keyset rather than an answer assembled in memory. The client is an ordinary link carrying the filters on screen. Every CSV field is quoted, and a value opening with `=`, `+`, `-`, `@`, a tab, or a carriage return is prefixed with an apostrophe: this file is handed to an auditor who opens it in a spreadsheet, and a display name of `=1+1` is a formula there.

6. **Structured emission is process-wide, and it cannot fail a mutation.** `recordActivity` emits each appended row as one line of JSON through the application logger, alongside the in-app write. The sink is set once by `buildApp` rather than threaded through the writer's seventy-odd call sites: stdout is process-wide, and the writer's own argument is a database handle or the transaction it must write inside. Emission is wrapped in a catch that swallows — the in-app entry is the record, the emitted line is a copy for somebody else's system, and a full log volume must not roll back a role change. The failure goes unreported, because there is nowhere to report a logger's failure except the logger. One consequence is stated rather than hidden: the line rides the insert, not the commit, so a transaction that later rolls back has emitted a line for a row nobody can read.

The audit log's page size is its own constant (50), larger than the feed's, and everything else about its paging is the feed's convention unchanged: keyset on `(created_at, id)`, a cursor that is one entry's id, a cursor naming no row answering an empty page, and no total in the envelope. Filters — actor, action, entity type, date range — are one `AND` over one predicate that the page, the export, and the boundary all read, so the three cannot disagree about what the current filter means. Search is one more term of that predicate, across the action slug, the entity id, the actor's name and email, and the payload's own text.

Search reads the payload's own text, and that term is a sequential scan. The other four filters and the ordering are all indexed — `activity_log_created_at_idx` on `(created_at, id)` lands with this surface, because the audit log orders the whole table by the pair its cursor walks and none of the three existing indexes serves that. A `payload::text` match cannot be, short of a `pg_trgm` GIN index on the expression and the extension to go with it. That is deliberate at this size: SET-002 anchors the product at 2–10 people, an Administrator is the only reader, and a scan of that organization's log is cheap. The trigram index is the named upgrade path when a deployment's volume makes it worth a new extension dependency; dropping payload search instead would cost the thing search is for, which is finding the entry whose filter you cannot name.

The narration layer now covers the whole vocabulary rather than a record feed's half of it, because this surface reads all of it. Its entry type is structural rather than one response shape, so both surfaces narrate the same rows without either converting for the other.

### Addendum (2026-08-24, M23 close, [#496](https://github.com/juggernog20/OpenLaw/issues/496)) — M23 actions use the one ledger

Matter business-Field edits, supporting-Document uploads and Versions, Key-date and Task mutations, hierarchy and related-link changes, Contract link changes, and Status transitions append their established action slugs with record ids and bounded metadata. The Matter feed applies DD-014 reach and DD-016 tiers; the Administrator audit log keeps the same rows. Closing neither rewrites nor truncates history, and the M22-to-M23 rehearsal asserts that a populated Matter feed never shrinks.

---

## DD-018: Work-model doctrine — dual workspaces with the deliverable rule

- **Status:** Accepted
- **Date:** 2026-08-05

### Context

The Intake grill surfaced the foundational question of where work happens: are contracts full workspaces, or child records inside matters (LawVu-style was the assumed reference)? Five models were compared (matter-only / dual / silos / universal work item / matter-first-with-hatch), and a three-stream competitive research pass was run: matter-first products (LawVu, Xakia, Dazychain), contract-first CLMs (Ironclad, SpotDraft, Juro, LinkSquares), and intake-first platforms (Streamline AI, Checkbox, Tonkean) plus JSM as reference architecture.

Research verdicts: contract-as-workspace is unanimously validated in the CLM category (and its absence — thin contract records — is the signature complaint against matter-first products); every contract-first leader failed to build a real second workspace for non-contract work (faked tickets, exiled second apps, "coming soon" bridges, or punting to competitors); LawVu (actually dual-workspace, not matter-first) ships the dual model successfully; JSM's rules: bind the routing target at request-type configuration, and make re-typing non-lossy.

### Decision

**Matters and contracts are peer, first-class workspaces** with deliberately identical collaboration machinery (team model, tasks, comments, activity — built as siblings across the MTR/CTR grills). Doctrine:

1. **The deliverable rule**: if the deliverable is a signed document, the work is a **contract** (the draft→review→approval→signature→active→renewal pipeline IS the work tracking). Everything else — advice, disputes, projects — is a **matter**.
2. **Routing is bound at request-type configuration** (INT-002), never chosen at triage: the admin decides once whether "NDA request" targets a contract type or "Legal question" targets a matter type. Triage confirms; it does not classify.
3. **Work that outgrows a contract spawns a linked matter** (MTR-007 link) — a contract never re-classifies into a matter or vice versa.
4. **Umbrella matters** group multi-contract efforts (M&A deal linking its contracts) — the gap none of the researched CLM leaders closed.
5. **Re-typing is lossless**: a mis-routed request re-converts to the other target; the request survives as the requester-facing portal shell either way (INT-001) — no JSM-"Move" orphaning.

### Rationale

Every direction of the market's experiment points here: matter-only products drift toward fattening contract records into workspaces (Xakia); contract-only products fake or exile non-contract work (all four leaders); the successful dual product (LawVu) pays a parity tax OpenLaw pre-paid by building the two workspaces on shared machinery. The "matter or contract?" ambiguity that makes dual models feel arbitrary is eliminated by rule 2 — no human answers it per-request.

### Alternatives considered

Matter-only with auto-created wrapper matters (Dazychain): documented ceiling — "you cannot build good contract workflows." Universal work item (Jira-style): 35 recorded module decisions re-mapped onto a polymorphic object; CLM depth becomes conditional bolt-ons. Matter-first with a standalone-contract escape hatch: builds everything dual builds plus a per-triage policy question.

### Consequences

Confirms DD-007's layered model, MTR-007's standalone-contracts-with-optional-link, and the CTR grill's contract-workspace investment — no rework. INT-006 implements the triage mechanics. Navigation/IA must make the two-workspace split legible (the LawVu complaint to avoid); the Inbox is the single queue over both. Reporting reads work across both workspace kinds (cross-cutting dashboards per DD-005).

## DD-019: Saved list views — private to one person, one `jsonb` config, saving is an act

- **Status:** Accepted
- **Date:** 2026-08-17

### Context

The contracts list shipped with a fixed seven-column table (M8). Feedback on the built surface: it is cramped, and the columns are not the reader's to choose. The record already carries far more than seven fields a list could show — risk, priority, the CTR-006 term dates, the derived notice deadline and days remaining, the signing entity, the CTR-016 custom fields — and which of them matter depends entirely on what the reader came to do. A renewals sweep wants expiry and notice deadline. A triage pass wants Owner and status. A portfolio review wants value and counterparty.

Nothing in the decision records covered this at decision time. The MTR grill parked the neighbouring question — "first-class views, saved-view presets, or filter-chip-only" (MTR-003's open item) — and no DES drew a destination list's column strip. Matters adopted the same list surface in M22; Documents (M26) and Entities (M27) follow later, so the answer remains one every destination can adopt rather than a contracts-only affordance.

### Decision

**A saved view is one person's private record of how they want a list to read.** Seven clauses:

**1. Private, full stop.** A view belongs to the user who made it. There is no sharing, no publishing, no Administrator-pinned workspace default, and no `is_shared` column waiting to be turned on. Two people who want the same view make it twice.

**2. A view is the whole list state, not just the columns.** It holds which columns are shown, their order, their widths, the filters in force, and the sort. Half a view — columns saved, filters not — is a view that lies about what the reader was looking at.

**3. Views are server-stored, in one `list_views` table.** Not `localStorage`. A view a reader curated is lost by a cache clear or a second machine, and a lost view is not a saved one. The table is keyed by a **surface** string (`contracts` today), so one table serves every destination and a new list needs no new table.

**4. The state is one `jsonb` config column.** It is read and written whole and never queried into — no report asks "which views sort by expiry". Typed columns would freeze a shape that changes every time a surface gains a column.

**5. Saving is an act.** Dragging a column wider or hiding one changes the list in front of the reader and nothing on the server. The views control marks the view modified and offers Save, which overwrites, and Save as, which forks. This keeps a curated view safe from a fiddle, which auto-save cannot.

**6. One default per person per surface.** The default is the view the list opens on. A person with no views, or none marked default, opens on the built-in layout.

**7. The built-in layout is code, not a seeded row.** No install migration writes views, and no user starts with rows to delete. It follows that a stored config naming a column the build no longer has is **read past, not rejected**: unknown keys are dropped, the rest of the view stands, and the reader sees a view missing one column rather than an error page.

### Rationale

Private-only is the whole reason this stays small. Shared views drag in ownership (who may edit the one everybody uses), an Administrator surface to curate them, a role question on every write, and a migration story for a view whose author left. None of that buys a 2–10 person team (DD-002) anything a second private view does not — at that size "send me your columns" is a sentence, not a feature.

The surface key rather than a per-module table is the same instinct behind `comment_last_read`'s `entity_type` pair (DD-016) and the taxonomy column set (MTR-001): one shape, many readers, so the machinery is written once. It is the cheap half of the polymorphism DD-008 avoids elsewhere, because nothing joins to a view.

Clause 5 is the one place this deliberately costs the reader a click. The alternative — every drag persisting — means a reader who widens a column to read one long title has silently edited the view they open on every morning.

### Alternatives considered

**`localStorage` only.** Zero backend, and the layout follows nobody. Rejected on clause 3's reasoning: the ask was to _save_ views.

**Shared views with an Administrator default.** The structurally richer option, and the one to graduate to if a deployment ever asks. It was declined here because every clause it adds is a permission question, and DD-013's four roles would each need an answer about a preference.

> **Priced, not decided (2026-08-21, #389).** This alternative is now costed against the code as built, in `SHARED-LIST-VIEWS-SKETCH.md`. Two findings change what this record implies. The graduation is **not** one column plus one widened read-scope: the true schema delta is a scope column, two rewritten unique indexes, a new partial unique index, a new check constraint, a changed foreign-key rule, a nullable author column, and a second ceiling — and the module's 404-not-403 convention cannot survive sharing. But the **minimal** version — one Administrator-pinned workspace default per surface, in its own small table — touches `list_views` not at all. It still amends clause 1, which refuses that default by name; what it leaves standing is the rest of the clause, including "no `is_shared` column". So the minimal version is a narrow amendment to one refusal, not a supersession of the record. The trigger for building it is the first time a second person asks for the same view — the same layout on the same surface, from somebody who is not its author. This paragraph prices the alternative; it does not adopt it, and DD-019 stands as accepted.

**Filter chips with no persistence** (MTR-003's third option). Does not answer the ask at all: chips are a narrowing, not a remembered way of reading.

### Consequences

One table, `list_views`, and one API module scoped so hard to `request.user.id` that another person's view id is a 404 rather than a 403 — the same not-advertised convention CTR-021 uses for records.

Clause 2 forces the list APIs to accept a sort. The contracts list keysets on the reference number descending with no possible tie (CTR-024); an arbitrary sort has ties and nulls, so the cursor predicate generalizes to a `(sort value, number)` pair with nulls ordered last. The cursor stays a row id, so no sort value ever rides a URL.

Clause 7 means every surface reading a view validates its config against the column catalogue the build actually has, and every surface's catalogue is therefore a first-class thing rather than a JSX ordering.

MTR-003's open item is answered by adoption: matters take this machinery rather than deciding views again. The parked "first-class My matters view" is now a saved view with a filter in it.

## Index of decisions

| #      | Decision                                                                                  | Status   |
| ------ | ----------------------------------------------------------------------------------------- | -------- |
| DD-001 | Internal-tool-first development model with portable architecture                          | Accepted |
| DD-002 | Reference persona — small in-house legal team (2–10 people)                               | Accepted |
| DD-003 | v1 build queue starts with Contract Lifecycle Management                                  | Accepted |
| DD-004 | Front-end-driven design pass; full mocks for all modules up front                         | Accepted |
| DD-005 | Restructure scope into functional modules + cross-cutting capabilities                    | Accepted |
| DD-006 | Add Entity Management as a functional module                                              | Accepted |
| DD-007 | Layered data model — Documents → Contracts → Matters; Entities orthogonal                 | Accepted |
| DD-008 | Separate `entities` and `counterparties` tables, with `parties_view` abstraction          | Accepted |
| DD-009 | Single-tenant per deployment                                                              | Accepted |
| DD-010 | Layered intake strategy — ChatOps + magic-link form + email parser                        | Accepted |
| DD-011 | License — AGPL v3                                                                         | Accepted |
| DD-012 | Project name — keep "OpenLaw" with documented rename trigger                              | Accepted |
| DD-013 | Four-role permission model — Administrator, Legal Team Member, Contributor, Business User | Accepted |
| DD-014 | Sensitive matter gating — confidential flag, opt-in restriction                           | Accepted |
| DD-015 | Contributor permission grid — read, comment, upload, edit business fields                 | Accepted |
| DD-016 | Comment visibility — three audience tiers (Legal Only / Working Team / Full Thread)       | Accepted |
| DD-017 | Activity tracking — two-layer model (per-entity activity feed + system-wide audit log)    | Accepted |
| DD-018 | Work-model doctrine — dual workspaces with the deliverable rule                           | Accepted |
| DD-019 | Saved list views — private to one person, one `jsonb` config, saving is an act            | Accepted |
