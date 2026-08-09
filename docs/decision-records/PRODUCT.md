# OpenLaw (working title)

_Open-source legal department management for small in-house teams._

> [!NOTE]
> "OpenLaw" is a working title. The original openlaw.io project (a ConsenSys spinoff focused on smart legal contracts) is functionally dormant — its team rebranded to TributeLabs in 2021–22 — but SEO collisions remain. The name is reclaimable but a final naming decision is deferred.

## What this is

OpenLaw is an open-source, self-hosted platform for in-house legal departments at small companies. It manages the day-to-day operational work of a 2–10 person legal team: intake of legal requests from the business, contract lifecycle management, matter tracking, document management, and corporate entity management.

It is the OSS alternative to Ironclad, LinkSquares, SpotDraft, and LawVu — purpose-built for teams that don't want to spend $30k+/year on enterprise CLM and don't want their legal data living in someone else's cloud.

## The problem

A 2–10 person in-house legal team at a Series A–C company sits in a frustrating gap.

- They have too much work for the "Drive folders + Slack + email" stack of a one-person legal department.
- They don't have the budget or contract volume to justify enterprise CLM platforms (Ironclad starts at ~$30k/yr).
- They typically don't have IT-managed enterprise SSO infrastructure for non-legal employees, so even when they buy a tool, business users won't adopt it.
- Industry research (ACC, World Commerce & Contracting, CLOC, BCLP) consistently identifies "business-user adoption failure" — _they kept using email_ — as a top-tier cause of failed legal-tech rollouts, and the dominant cause for SMB and mid-market segments specifically.
- IDC research cited by LawVu suggests **~29% of in-house legal teams spend 3+ hours per day** on intake-related email back-and-forth alone.
- Gartner reports approximately **50% of first-time CLM implementations fail** to deliver expected benefits.

The result: legal teams stay inbox-bound, contracts get lost in email threads, and the "system of record" for any given matter is whichever lawyer's brain remembers it best.

## Who it's for

The reference user is a **2–10 person in-house legal team at a 50–500 person company**. Specifically:

- A General Counsel (probably wearing several hats — commercial, employment, compliance, board)
- One or several Counsels and/or Paralegals
- Possibly a Legal Operations person
- Reporting into the CEO, CFO, or COO

We are **not** building for:

- Solo counsel — Notion + Drive is fine for them
- Mid-to-large legal departments (50+) — well-served by Ironclad / LinkSquares / Onit
- Law firms — different workflow (case management, client billing, conflicts)
- Legal aid / public sector — Docassemble and A2J Author are purpose-built for that

## What we're building

A portable, single-tenant-per-deployment platform with **four functional modules**:

| Module              | What it does                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Matters**         | Work containers for any legal effort — employment issues, regulatory inquiries, board matters, M&A, litigation, advisory questions                                        |
| **Documents**       | Central document repository with versioning, search, and tagging — first-class destination, not just an attachment store                                                  |
| **Contracts (CLM)** | Full contract lifecycle from intake through review, negotiation, approval, signature, execution, and renewal                                                              |
| **Entities**        | Corporate entity management — your subsidiaries, officers, statutory documents, license/registration renewals, registered agents, compliance calendar at the entity level |

These modules share a **unified intake surface** that meets business users where they are — ChatOps (Slack first, Teams to follow, others via adapter), magic-link web form, and email-to-intake parser — so legal isn't the bottleneck.

**Cross-cutting capabilities** (search, comments, activity feeds, dashboards, notifications) are designed _into_ each module, not as separate destinations.

## What's in scope

**For the design pass (mocking everything):**

- All four modules above
- All cross-cutting capabilities
- Multi-channel intake: ChatOps adapter, magic-link form, email parser
- A unified `Request` triage layer that routes to Contract or Matter

**Deferred to later phases:**

- Compliance management (regulatory programs, SOC 2, GDPR, policy management, training tracking)
- Risk management
- Reporting/analytics as a destination (per-module dashboards remain in scope)
- Knowledge management / precedent search
- E-billing / outside counsel spend
- E-discovery, legal hold

**Out of scope, possibly forever:**

- Multi-tenancy (one deployment = one organization)
- Enterprise SSO/SCIM as a v1 requirement
- Law-firm workflows
- Public-sector / legal-aid workflows

## Principles

1. **Internal-tool-first.** Feature decisions are driven by the needs of an actual small in-house team — not by speculation about what users might want. We dogfood.
2. **Portable architecture.** Anyone should be able to clone the repo, run it, and have a working install with no project-specific or vendor-specific infrastructure dependencies.
3. **Lowest-friction intake wins.** The single biggest determinant of whether a legal tool succeeds is whether business users adopt the request channel. We optimize for low-friction over feature-completeness.
4. **OSS leverage where the surface is wide.** For integrations like chat platforms, we ship documented adapter interfaces so the community can extend coverage rather than us building all of them.
5. **Disposable mocks, durable decisions.** UI mocks are cheap and we revise them freely. Architectural decisions are recorded (see `DECISIONS.md`) and only changed deliberately.

## What success looks like

- A 5-person legal team can self-host the platform in under an hour from a clean Linux VM.
- Within the first month of use, the legal team's inbox volume for "hey can you look at this" requests drops materially.
- Business users submit at least 80% of new requests through one of the supported channels (ChatOps / form / email-to-intake) rather than direct lawyer email.
- The platform earns enough community adoption that at least one external contributor lands a Teams or Google Chat adapter without our writing it.

## Build phasing

The first shippable module is **Contract Lifecycle Management**, which exercises every cross-cutting primitive (intake, document storage, versioning, approvals, signature handoff, central repository) in a way that other modules will reuse.

The remaining modules (Matters, Documents as destination, Entities) follow in subsequent releases. The Pencil mock pass covers all four modules and all cross-cutting capabilities up front, so the vision is unified even though the build queue is staggered.

## Status

Active design. See `DECISIONS.md` for the architectural and product decisions made so far. UI mocks live in the Pencil workspace.
