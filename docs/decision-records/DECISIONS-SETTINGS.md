# OpenLaw — Settings Module Decision Record

Decisions specific to the cross-cutting **Settings** surface — IA placement, permission model, audit-log treatment, preview/rollback semantics, install-time vs runtime seeding, and per-module settings UX patterns. Platform-level decisions that apply across all modules (data model, role model, intake, activity tracking, etc.) live in `DECISIONS.md` and are referenced by ID where relevant.

## Why this is a separate decision class

Per `DECISIONS.md` **DD-005**, "Search / Comments / Activity feed / Dashboards / Notifications" are cross-cutting capabilities — designed _into_ every module rather than living as separate destinations. **Settings is the same kind of capability**: every module accumulates configurable surfaces (matter types, contract templates, intake routing rules, retention policies, theme preference, etc.) and they need a consistent IA, permission model, and audit treatment.

Treating Settings as cross-cutting (rather than per-module) keeps:

- **One IA pattern** for where settings live in the nav.
- **One permission model** for who can change what (mostly Admin per **DD-013**, but with documented carve-outs).
- **One component substrate** so every settings page looks and behaves the same.
- **One persistence + audit pattern** so settings changes write to the same `activity_log` per **DD-017**.

## Sequencing

This decision class is queued **after the per-module grills wrap** — Matters → Contracts → Intake → Documents → Entities → Knowledge — so that we know the full configurability shopping list before designing the surface. Each module decision that introduces a configurable item flags it in its **Settings touchpoints** subsection; this document collates them when grilling begins.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `SET-###`.

## Open questions queued for the next grill-me session

_None — queue cleared 2026-08-05 (SET-001 through SET-004). Audit treatment needed no grill: DD-017 already mandates every settings mutation to the activity log, applied immediately (SET-003). Entities/Knowledge settings sections queue here when those module grills run._

_2026-08-10 — the M5 pre-build grill closed the gaps between SET-001..004 and the milestone: SET-005 (user management), SET-006 (personal profile scope), the SET-001 Security-group amendment, and the sequencing addenda on SET-003/SET-004._

## Configurability surface inventory (live, populated as module grills land)

| Source       | Surface                                                                              | Permission | Notes                                                                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **MTR-001**  | Matters Settings → Types                                                             | Admin      | List view; add / rename / reorder / archive; system-default + `other` row protected                                                                                                                                                                                                        |
| **MTR-002**  | Matters Settings → Statuses                                                          | Admin      | List view; add / rename / reorder / archive; category (open/closed) picked at creation, immutable after; seed `open` + `closed` rows protected                                                                                                                                             |
| **MTR-011**  | Matters Settings → Fields                                                            | Admin      | Custom-field catalog view scoped to `matter` + `global` fields per **CTR-016**: add / rename / describe / archive; field type immutable (9 types incl. `entity`); DD-015 business\|legal tag; options editor for selects                                                                   |
| **TECH-008** | Settings → Organization → Security → Authentication                                  | Admin      | Auth mode (built-in basic vs OIDC IdP config); DD-010 allowed-email-domains list; magic-link portal toggle                                                                                                                                                                                 |
| **SET-001**  | Settings → Organization → General                                                    | Admin      | Org identity: name, logo, locale/timezone defaults                                                                                                                                                                                                                                         |
| **SET-005**  | Settings → Organization → Users                                                      | Admin      | User list + pending-invite rows (resend / revoke); in-place role edits; guarded archive; per-user session revocation                                                                                                                                                                       |
| **SET-006**  | Account Settings → Profile                                                           | Per-user   | Display name, avatar, change password, TOTP management, sign-out-other-devices, timezone (DES-014)                                                                                                                                                                                         |
| **NOT-004**  | Settings → Notifications                                                             | Admin      | Global reminder-offset list (seeded 7/1/0 days) for all tracked dates                                                                                                                                                                                                                      |
| **NOT-001**  | Account Settings → Notifications (staff) / Portal Settings (business users)          | Per-user   | Channel toggles per event group — both channels tunable, defaults per NOT-002 (shipped M18/5, #320; "bell always on" was the sketch, story 18 and DES-050 settle it as tunable)                                                                                                            |
| **INT-004**  | Intake Settings → Deflection Links                                                   | Admin      | "Before you submit…" links panel: label + URL, global or per request type, ordered                                                                                                                                                                                                         |
| **INT-002**  | Intake Settings → Request Types                                                      | Admin      | List + per-type form editor: target matter/contract type; attach catalog fields (target-module or global scope); required flags; display order                                                                                                                                             |
| **CTR-016**  | Contracts Settings → Fields                                                          | Admin      | Catalog view scoped to `contract` + `global` fields; per-field `ai_prompt` editor (CTR-008); same machinery as the matters view                                                                                                                                                            |
| **CTR-016**  | Contracts Settings → Types → [type]                                                  | Admin      | Attach / detach `contract`/`global` fields; per-type display order; `is_required` toggle (hard-enforced per MTR-014 rule)                                                                                                                                                                  |
| **MTR-011**  | Matters Settings → Types → [type]                                                    | Admin      | Attach / detach `matter`/`global`-scoped fields to the type; per-type display order                                                                                                                                                                                                        |
| **MTR-013**  | Matters Settings → Templates                                                         | Admin      | Named templates per type: pre-fill values (priority, risk, custom fields, title prefix) + task rows (relative due dates, role targeting)                                                                                                                                                   |
| **CTR-002**  | Contracts Settings → Types                                                           | Admin      | List view; add / rename / reorder / archive; `other` row protected; attachment point for per-type fields / templates / approval scoping                                                                                                                                                    |
| **CTR-013**  | ~~Contracts Settings → E-signature~~ → **Organization → Integrations → E-signature** | Admin      | Provider connector credentials (DocuSign v1); adapter-keyed for future providers. _Placement superseded by **SET-007**: the pane lives in the Integrations section, not the Contracts section._                                                                                            |
| **CTR-012**  | Contracts Settings → Approver Groups                                                 | Admin      | Named groups (name + member list); applying a group snapshots members into approval requests                                                                                                                                                                                               |
| **CTR-008**  | Contracts Settings → AI Analysis                                                     | Admin      | BYO API key; per-field default prompts (editable); custom fields carry their own prompts                                                                                                                                                                                                   |
| **KNW-001**  | Knowledge Settings → Types                                                           | Admin      | List view; seeds: template, precedent, playbook, article; MTR-001 machinery                                                                                                                                                                                                                |
| **ENT-001**  | Entities Settings → Types                                                            | Admin      | List view; add / rename / reorder / archive; `other` row protected                                                                                                                                                                                                                         |
| **ENT-001**  | Entities Settings → Officer Roles                                                    | Admin      | List view; seeds: director, ceo, cfo, secretary, other                                                                                                                                                                                                                                     |
| **ENT-001**  | Entities Settings → Fields                                                           | Admin      | Catalog view scoped to `entity` + `global` fields per **CTR-016**'s shared `fields` catalog (ENT-001 adds the `entity` scope): add / rename / describe / archive; entity-scoped fields render on every entity (no per-type attachment join); same machinery as the matters/contracts views |
| **CTR-001**  | Contracts Settings → Statuses                                                        | Admin      | List view; add / rename / reorder / archive; stage (draft/review/approval/signature/active/ended) picked at creation, immutable after; seed `draft`, `active`, `expired` rows protected                                                                                                    |

---

## SET-001 — IA: one /settings destination with Personal + Organization rails

- **Status** — Accepted
- **Date** — 2026-08-05
- **Context** — Where the 17-surface inventory lives. (Grilled after five of seven module grills; Entities/Knowledge sections slot in when theirs land.)
- **Decision** — A single `/settings` destination, reached via the avatar menu and gear affordances. Left rail in two groups: **Personal** (Profile per SET-006, Appearance per DES-001/002, Notification preferences per NOT-001) and **Organization** (General, Users, Security, Matters, Contracts, Intake, Entities, Knowledge, Notifications, Integrations) — Organization sections hidden from non-Admins. _(Entities and Knowledge sections slotted in when their grills landed — ENT-001 Types / Officer Roles / Fields, KNW-001 Types — per this decision's original provision.)_ **Contextual deep-links** from module UIs jump to the relevant section (Admin-only affordances, e.g. "Manage types…" under a type picker). Grill-plan J.9 becomes a deep-link, not a separate surface.
- **Amendment (2026-08-10, M5 grill)** — The Organization rail gains a collapsible **Security** group. **Authentication** is its only sub-item in M5: auth mode, OIDC provider config, the DD-010 allowed-email-domains list, and the magic-link portal toggle. The group grows as later surfaces land (the DD-017 Administrator-only audit-log view in M9). Security holds policy about how you get in; people-facing actions (invites, roles, archive, session revocation) stay in **Users** per SET-005. Also ratified: **`designs/settings.pen` is the visual spec for the settings screens** (same standing as `matters.pen` per the repo's .pen-files-are-the-spec rule), _as amended by this grill_ — where the mocks predate the Security group, archived-user states, or pending-invite rows, the mocks get updated, not the decisions. Frame inventory: `SETTINGS-INVENTORY.md`.
- **Rationale** — Cross-cutting surfaces (the shared fields catalog, notifications, users) have no module home; a single destination with module sections keeps one IA pattern and one component substrate.
- **Alternatives considered** — Per-module gear pages: orphans/duplicates cross-cutting surfaces.
- **Consequences** — Two net-new Organization sections implied beyond the module inventory: **General** (org identity: name, logo, locale/timezone defaults) and **Users** (invite, role assignment per DD-013, archive). Integrations hosts E-signature (CTR-013) + AI (CTR-008) credentials. Settings screens become one design family (list-editor pattern per DES).

## SET-002 — Permissions: Admin-only Organization settings; no delegation in v1

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — Every Organization section is Administrator-only per DD-013. Members see Personal only (module UIs may render read-only labels of org config where contextual). No per-surface delegation grants in v1 — parked in FUTURE-FEATURES.
- **Rationale** — At 2–10 people the Admin is a message away; a grants model is a fifth permission concept bolted onto DD-013's clean scheme.
- **Consequences** — FUTURE-FEATURES entry (settings delegation). Permission check is a single role gate, not per-surface.

## SET-003 — Apply semantics: immediate on save; guarded archive with reassignment

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — Settings changes apply immediately on save, activity-logged per DD-017 (the audit log + unarchive are the recovery story; no draft/publish/rollback engine). One cross-module guard: **archiving a value in use** (matter/contract type, request type, template, field option) shows the live-usage count and requires a reassignment target before archiving; surfaces with structural minimums (statuses: ≥1 per category/stage per MTR-002/CTR-001) block instead. Field archival keeps stored values per MTR-011 — no reassignment needed.
- **Rationale** — Publish ceremony on every rename is big-org machinery; the guard pattern addresses the only genuinely dangerous operation.
- **Consequences** — Bulk-reassign flow is a shared component across all list-editor surfaces. Archive guards need usage-count queries per surface.
- **Addendum (2026-08-10, M5 grill)** — The audit half is satisfiable from day one: the `activity_log` table and its writes land in **M5** with the first settings mutations (the schema doctrine puts a table in the milestone that first writes it). M9 builds the surfaces that read it. The "list-editor pattern per DES" this decision and SET-001 reference gets written as a DES record in **M6**, where the first taxonomy list-editor ships — M5's panes are not taxonomy lists.

## SET-004 — First-run onboarding wizard + seeded defaults

- **Status** — Accepted
- **Date** — 2026-08-05
- **Context** — Installer seeding vs post-install setup. Recommended seeds + a passive checklist; Blair chose the **first-run onboarding wizard**.
- **Decision** — _(Addendum 2026-08-06 per **TECH-008**: the wizard gains an **Authentication step** — built-in basic auth vs bring-your-own IdP via OIDC.)_ Install-time migrations still seed every system default already specified per-table (9 matter types, matter/contract statuses, 8 contract types, notification offsets, starter request types: NDA request → contract, Contract review → contract, Legal question → no target). On first Admin login, a **guided onboarding wizard** runs: org identity (name, logo) → allowed email domains (DD-010 allowlist) → email/SMTP → invite users + roles → optional integrations (DocuSign, AI key) → review seeded types. Steps are skippable and everything remains editable in Settings afterward; the wizard is first-run only, not a recurring surface.
- **Rationale** — (User preference for a guided first-run.) The wizard makes the under-an-hour install goal _feel_ finished — a fresh system that asks for exactly the config seeds can't know.
- **Alternatives considered** — Seeds + passive "Finish setup" checklist card (recommended, declined).
- **Consequences** — The wizard is a real v1 build surface (one flow, ~6 steps). Wizard completion state stored per-org; skipped steps resurface as a Settings checklist card until done.
- **Addendum (2026-08-10, M5 grill)** — Scheduling: the auth, portal, email, and invite steps shipped with M2 (`/welcome`). The **complete** wizard is its own milestone (plan M33), placed just before Release — building the remaining steps earlier would mean wizard steps for features that don't exist yet, which the plan's no-stubbed-demos rule forbids.
- **Addendum (2026-08-10, #37)** — The email step is no longer status-only: it is a working **SMTP setup screen**. It shows one of three states — set by environment (read-only, names `SMTP_URL`/`SMTP_FROM` as the place to change it), set in the app (from-address shown; replace or clear), or not set (relay URL + from-address form). Saves take effect on the next send, a "Send test email" button delivers to the signed-in Administrator's own address, and the step stays skippable. Environment always wins over app configuration — see the TECH-011 addendum for the precedence rule.

## SET-005 — User management: the Users pane, role edits, guarded user archive, session revocation

- **Status** — Accepted
- **Date** — 2026-08-10
- **Context** — DD-013 gives the Administrator "manage users" in one phrase and SET-001 names the operations (invite, role assignment, archive) without semantics. The M5 demo's headline action — revoking another user's session — was covered by no decision at all; M2 deliberately left better-auth's admin endpoints closed "until the Settings management surface ships". This decision supplies the semantics.
- **Decision** —
  - **The Users pane** lists all users, and **pending invites appear as rows** with resend and revoke actions. The list shows active users by default; archived users sit behind an Archived filter.
  - **Role edits**: an Administrator changes any user's role in place (DD-013 enum), effective immediately — the guard chain reads the role per request, so no session ceremony is needed. Invites stay invites: the invite route never edits roles.
  - **The last-Administrator floor**: the last remaining Administrator can be neither demoted nor archived. You also cannot archive yourself.
  - **Archiving a user** blocks sign-in _and revokes all of their live sessions immediately_ — an archived person must not keep working until a session expires. Attributions and comments keep the name. Everywhere an archived user appears, they render in a distinct inactive state (greyed out, marked as gone); they never appear in assignee or owner pickers.
  - **Reassignment guard**: once ownable records exist (M8+), archiving a user who owns records shows the live-usage count and requires a reassignment target — the SET-003 pattern applied to people. In M5 there is nothing to reassign, so the guard arms itself when the first ownable record ships.
  - **Cross-user session revocation** is an action on the user's row in Users, implemented as our own typed Admin route per the TECH-008 pattern ("typed routes where OpenLaw's authorization model diverges"). better-auth's `/api/auth/admin/*` surface stays closed.
- **Rationale** — An Admin thinks "cut this person off" and looks for the person, not a global sessions table; every action that touches a person lives on their row. Immediate revocation on archive is the point of archiving — the departing-employee case is exactly why the operation exists.
- **Alternatives considered** — Roles fixed at invite (change = archive + re-invite): pointless ceremony, and DD-017's "who changed this user's role last quarter?" presumes role changes happen. A Security-pane global sessions view: big-org machinery for a 2–10 person team.
- **Consequences** — New typed routes: list users, edit role, archive (writes `users.archived_at`), revoke sessions. Every mutation lands in the activity log per DD-017/SET-003. The archived-user render state is a design-system obligation across all later surfaces (pickers, comments, activity, teams).

## SET-006 — Personal profile scope; email change deferred

- **Status** — Accepted
- **Date** — 2026-08-10
- **Context** — SET-001 named the Profile pane and nothing anywhere expanded it. Most candidate surfaces already exist on better-auth's mounted routes; email change does not (no changeEmail flow configured).
- **Decision** — The v1 Profile pane: **display name, avatar, change password, TOTP management (enrol / re-enrol / disable), sign-out-my-other-devices, and the DES-014 timezone picker**. **Changing your own sign-in email is out of v1** — parked in FUTURE-FEATURES. No locale switcher until a second locale exists (DES-013).
- **Rationale** — Everything shipped is wiring for surfaces M2 already built. Email change is the one expensive item: it needs a verification flow we haven't configured, and it churns the identity the DD-010 allowlist and invites key on.
- **Consequences** — `users` gains the `timezone` column DES-014 anticipated. FUTURE-FEATURES entry (self-service email change; the v1 workaround is admin-driven: archive + re-invite under the new address). The Personal → Notifications pane is unaffected — it ships in M18 with the notification engine (NOT-001).

## SET-007 — E-signature lives in Organization → Integrations, not in Contracts

- **Status** — Accepted
- **Date** — 2026-08-16
- **Context** — Two accepted records named two different homes for the same pane. **CTR-013** said "Configured in Settings → Contracts → E-signature". **SET-001**'s rail and its consequences named an **Integrations** section that "hosts E-signature (CTR-013) + AI (CTR-008) credentials", and the settings inventory drew it as frame ST7. The M15 build had to pick one.
- **Decision** — **Integrations wins.** The signing connector is configured in **Settings → Organization → Integrations → E-signature**, the section's first pane. ~~CTR-013's "Settings → Contracts → E-signature" placement sentence~~ is **superseded by this record**; the rest of CTR-013 stands unchanged. The Contracts section keeps what is about contracts — types, statuses, fields, approver groups. The AI-analysis pane (CTR-008) joins Integrations in M31, as SET-001 said it would.
- **Rationale** — A connector is an account with another company, not a property of the Contracts module. Two connectors sit in this section, and only one of them is about contracts at all, so a Contracts home would have split one setup surface across two sections. SET-001 is also the later and more specific record: it designed the whole rail, where CTR-013 named a home in passing before the rail existed.
- **Alternatives considered** — Contracts → E-signature (CTR-013 as written, declined: it strands the AI credentials with nowhere to go, and the rail already draws Integrations). Both places, one deep-linking to the other (declined: two addresses for one pane is the duplication SET-001 exists to prevent).
- **Consequences** — The Organization rail gains an **Integrations** entry, born with this milestone. Every Organization pane rule already applies unchanged: Administrator-only (SET-002), immediate apply (SET-003), activity-logged at `admin_only`. The settings inventory's ST7 row keeps its frame; the mock's summary-row treatment is amended to the credential form the pane actually ships (see `SETTINGS-INVENTORY.md`).

## Index of decisions

| #       | Decision                                                              | Status   |
| ------- | --------------------------------------------------------------------- | -------- |
| SET-001 | IA: one /settings destination with Personal + Organization rails      | Accepted |
| SET-002 | Permissions: Admin-only Organization settings; no delegation in v1    | Accepted |
| SET-003 | Apply semantics: immediate on save; guarded archive with reassignment | Accepted |
| SET-004 | First-run onboarding wizard + seeded defaults                         | Accepted |
| SET-005 | User management: Users pane, role edits, guarded archive, revocation  | Accepted |
| SET-006 | Personal profile scope; email change deferred                         | Accepted |
| SET-007 | E-signature lives in Organization → Integrations, not in Contracts    | Accepted |
