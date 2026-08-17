# OpenLaw — Notifications Decision Record

Decisions for the cross-cutting notifications capability (DD-005). This is the "notifications feature DD" flagged as unopened in `DECISIONS-DESIGN.md` and gating grill-plan rows A.4 and E.1.

Decisions are numbered `NOT-###`.

## Requirements inventory (swept 2026-08-05)

Commitments accumulated across the module grills that this capability must deliver:

| Source                | Commitment                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CTR-006**           | Renewal reminders at the derived notice deadline and at expiry; "renewal pending confirmation" prompting. Reminder surfaces show the unverified-AI badge (CTR-008 tension note) |
| **CTR-012**           | Approval requested → pending approvers notified; decisions visible to the owner                                                                                                 |
| **CTR-013**           | Envelope status changes (signed / declined / voided)                                                                                                                            |
| **MTR-004 / CTR-009** | Approaching named key dates ("no bespoke reminder system" — plugs in here)                                                                                                      |
| **MTR-005 / CTR-017** | Task assignment; task due dates do NOT feed deadline surfaces (but assignees may still want nudges)                                                                             |
| **MTR-003 / CTR-004** | Manager assignment (matter/contract handed to you)                                                                                                                              |
| **INT-001/003**       | Requester email notifications: request created, status changes, thread replies, declined-with-reason; deep-link to portal; host-configurable; no login ever required            |
| **INT-006**           | New request → Inbox (the queue itself is the surface; does it also notify?)                                                                                                     |
| **DD-016**            | Comment replies / thread activity on records you're on                                                                                                                          |
| **A.4 (mock)**        | Bell + badge in the top nav; badge cap decided here                                                                                                                             |
| **E.1 (mock)**        | Notifications module chip on contract details                                                                                                                                   |
| **DES (deferred)**    | Email digest copy register — lands when this ships                                                                                                                              |

## Open questions queued for the next grill-me session

_None — queue cleared 2026-08-05 (NOT-001 through NOT-005)._

---

## NOT-001 — One system, two surfaces: bell + email for staff (full platform) and for business users (portal)

- **Status** — Accepted
- **Date** — 2026-08-05
- **Context** — Audiences and channels. Recommended staff bell+email / requesters email-only; Blair widened the requester side: staff get email or bell in the full platform, and business users get email or bell **in the light portal (similar to Jira)** — both adjustable in their respective settings.
- **Decision** —
  - **One notification system, two rendering surfaces.** Legal staff (Member+): notification center behind the top-nav bell (grill-plan A.4) in the full platform. Business users: a bell/notification center **in the portal** (JSM-style), covering their requests' events.
  - **Both audiences get email too**, deep-linking to the appropriate surface (full platform vs portal magic-link per INT-001).
  - **Per-user preferences on both sides**: staff manage channel/event-group toggles in account settings; business users get a lightweight portal settings surface for the same. In-app is default-on; email defaults set per event group (Q2/Q3).
  - The Inbox remains the request **queue** (work to triage); the bell is the **feed** (things that happened) — distinct jobs, distinct surfaces. Slack/Teams delivery stays parked (FUTURE-FEATURES ChatOps entry).
- **Rationale** — Staff live in the app; requesters live in the portal — each gets events where they already are, with email as the reach-out channel. One system underneath keeps the event catalog and preference model single-sourced.
- **Alternatives considered** — Email-only (removes the mock's A.4 bell; round-trips staff through mail). Requesters email-only (recommended, declined — the portal bell rounds out the JSM shape). Chat delivery now: re-opens what INT-001 parked.
- **Consequences** — `notifications` + `notification_preferences` tables in SCHEMA.md. Portal gains a bell + settings surface (INT portal scope grows slightly). A.4 unblocked pending badge semantics (Q5); E.1 resolved by the screen-batch grill plan: the notifications chip is **removed** from contract details — per-record notifications aren't a NOT-002 concept; the global bell (A.4) is the surface.
- **Addendum (2026-08-18, M18/1, [#316](https://github.com/juggernog20/OpenLaw/issues/316))** — **The engine landed, and the seam is the `Notifier`.** It is injected into the app factory beside the database, the mailer, storage, and the job queue, and it carries **one method per event** rather than a generic `notify(type, payload)` — the `JobQueue` rule (TECH-007), applied to the thing that tells people. A route names what happened and never learns that channels exist, who the audience is, or that anything is queued.

  **Behind the seam there are five steps, and the order is the decision.** Resolve the audience; apply the confidentiality predicate; apply per-user preferences; write the bell rows **inside the caller's transaction**; queue the email work **after** it commits. The wall is applied inside the seam rather than at the call site, which is what makes it a property no event can be added without — and the same is true of "the actor is never told about their own act", which is applied once for every event rather than remembered at each one.

  **The transaction is the seam's, not the route's.** `notifier.notifying(work)` replaces the `app.db.transaction(work)` a notifying route would otherwise open, and only it mints the branded transaction the per-event methods accept. That is the whole reason it exists: there is one call at the route, a rolled-back mutation cannot leave a bell row, and the after-commit half cannot be forgotten because no caller writes it. Handing the route a two-call shape — raise, then deliver — was the alternative, and it was declined for the reason M12 declined sending inside the transaction: the correctness of the pairing must not be a thing each new call site can get wrong.

  **The queue send is logged and never raised** (TECH-007's M12/3 doctrine, said for mail). The row is the record of work owed and the queue is only the wake-up, so a mutation must not fail because the notifier's queue is down — a lost send costs a delay, never the message.

  **Two schema refinements**, both recorded in SCHEMA.md. The row records at write time **whether email was owed**, so "owed and never sent" is distinguishable from "never owed" and a round can re-ask from the rows without emailing everybody who had switched email off. And a date-reminder row carries a **dedup identity** — user, event, entity, the date value, and the offset — held by a partial unique index. It is defined now and first written by the dates slice: it makes a re-ask a no-op and makes a date that _moves_ correctly fire again for its new value, and both have to be in the schema before the first round runs rather than retrofitted around rows with no key.

  **`notification_preferences` is a set of overrides, not a grid.** A person with no row for a pair takes the group's default, and the defaults live in application code rather than being seeded — so a default that changes reaches everybody who never expressed an opinion and nobody who did. The table ships empty; the logic that reads it is complete, so the preferences slice adds a pane and not a rule.

  **The read side re-applies the confidentiality predicate on every read** — the list **and** the count, through one predicate composed from `contractTeamScope`. An item about a record walled off after it was written leaves both, silently: no row, no gap, and no number that says something was left out (M10's answer, on a surface DD-014 was never written about). The row itself stays in the table, so opening the wall again brings the item back.

## NOT-002 — Event catalog: five groups, defaults by interruptiveness

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — Five event groups with per-user-adjustable channel defaults (NOT-001):
  1. **Assigned to you** — manager assignment (MTR-003/CTR-004), task assignment (MTR-005/CTR-017), approval requests (CTR-012). Bell ✓, email ✓ immediate.
  2. **Activity on your records** — status/stage changes, comments (DD-016), new documents/versions, envelope events (CTR-013), for managers, team members, and watchers. Bell ✓, email ✗ (opt-in). Watchers = existing team roles; no separate subscribe mechanism in v1.
  3. **Dates approaching** — key dates (MTR-004/CTR-009), notice deadlines and expiries (CTR-006). Bell ✓, email ✓ via daily digest (NOT-003). Unverified-AI dates carry the CTR-008 badge.
  4. **New requests** — Inbox arrivals (INT-006). Bell ✓, email ✗ (opt-in).
  5. **Requester events** (portal audience) — request created, status change, thread reply, declined-with-reason (INT-001/003/006). Portal bell ✓, email ✓ immediate.
- **Rationale** — Defaults follow interruptiveness: things done _to_ you interrupt; ambient activity doesn't; everything is user-adjustable.
- **Alternatives considered** — Everything-on defaults: day-one unsubscribe exercise.
- **Consequences** — `event_type` catalog enumerated per group in the schema notes; `notification_preferences.event_group` takes these five values.
- **Addendum (2026-08-18, M18/1, [#316](https://github.com/juggernog20/OpenLaw/issues/316))** — Three clarifications, settled while building the engine.

  **A comment mention is group 1, not group 2.** A mention is done _to_ you: somebody has addressed a question to you by name (CMT-007), which is the same kind of act as being assigned a task or asked to approve. So it interrupts — bell on, email immediate — rather than riding the ambient-activity default it would have inherited from "comments on your records". Ordinary comments stay in group 2, unchanged.

  **Groups 4 and 5 ship as slots.** `new_requests` waits for the Inbox (M21) and `requester_events` for the portal (M20), so neither names an event yet. The **group value** ships now regardless, because a person may express a preference about a group before anything in it has ever fired, and because a group added later would be a schema change rather than a line in a table.

  **The catalog is enumerated in full for the three groups this milestone serves**, not event by event as the slices that fire them arrive. That is what makes a later slice an event rather than a mechanism: the group decides the audience rule, the group's defaults decide the channels, and the fan-out reads both. Which events a build actually writes is a fact about the call sites and not about the list.

  **`notifications.event_type` carries no CHECK constraint**, deliberately — `activity_log.action`'s reasoning one table over. A row outlives the build that wrote it, so a closed constraint would be a schema change on every catalog change and a read that could not answer for a slug an older build wrote. The closed union lives in TypeScript, where the compiler can hold both ends of it. The event **group** and the **channel** are constrained, because those are small closed sets that code branches on.

## NOT-003 — Timing: direct events immediate; date reminders in a daily digest

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — Groups 1 and 5 email immediately. Group 3 (dates) batches into one daily morning digest email — the renewal calendar as a briefing — alongside individual bell items. No weekly digest or per-user schedule configuration in v1.
- **Rationale** — Date noise is the likeliest unsubscribe trigger; one briefing beats nine offset emails.
- **Consequences** — Digest rendering job on the background pipeline (DOC-009's worker). Email digest copy register — the deferred DES note — is now actionable when the digest is designed.

## NOT-004 — Reminder lead times: one admin-configurable offset list, seeded 7/1/0

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — A single global offset list (Settings → Notifications), seeded `7 days / 1 day / day-of`, applied to every tracked date (key dates, notice deadlines, expiries). Admin-tunable; not per-user or per-date in v1. CTR-006's mandated fires are dates within this scheme.
- **Rationale** — Configurable-over-fixed applies (nothing branches on the numbers); per-date schedules are config sprawl.
- **Alternatives considered** — Fixed offsets; per-date custom schedules.
- **Consequences** — Settings inventory row. Long notice windows may warrant a larger seeded offset later — tune via settings, not code.

## NOT-005 — Badge: unread count, 9+ cap, read-on-open

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — Bell badge shows unread count capped at "9+". Opening the center marks visible items read; mark-all-read affordance; items deep-link to their records. Identical semantics on the portal bell.
- **Rationale** — The activity feed (DD-017) is the durable history; notifications are ephemeral prompts — per-item read ceremony fights that.
- **Consequences** — Grill-plan A.4 fully unblocked (bell + badge, cap 9+). `notifications.read_at` supports it.

## Index of decisions

| #       | Decision                                                          | Status   |
| ------- | ----------------------------------------------------------------- | -------- |
| NOT-001 | One system, two surfaces: bell + email for staff and portal users | Accepted |
| NOT-002 | Event catalog: five groups, defaults by interruptiveness          | Accepted |
| NOT-003 | Timing: direct events immediate; date reminders in a daily digest | Accepted |
| NOT-004 | Reminder lead times: admin-configurable offsets, seeded 7/1/0     | Accepted |
| NOT-005 | Badge: unread count, 9+ cap, read-on-open                         | Accepted |
