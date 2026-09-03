# OpenLaw — Notifications Decision Record

Decisions for the cross-cutting notifications capability (DD-005). This is the "notifications feature DD" flagged as unopened in `DECISIONS-DESIGN.md` and gating grill-plan rows A.4 and E.1.

Decisions are numbered `NOT-###`.

## Requirements inventory (swept 2026-08-05)

Commitments accumulated across the module grills that this capability must deliver:

| Source                | Commitment                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CTR-006**           | Renewal reminders at the derived notice deadline and at expiry; "renewal pending confirmation" prompting. Reminder surfaces show the unverified-AI badge (CTR-008 tension note)                 |
| **CTR-012**           | Approval requested → pending approvers notified; decisions visible to the owner                                                                                                                 |
| **CTR-013**           | Envelope status changes (signed / declined / voided)                                                                                                                                            |
| **MTR-004 / CTR-009** | Approaching named key dates ("no bespoke reminder system" — plugs in here)                                                                                                                      |
| **MTR-005 / CTR-017** | Task assignment; task due dates do NOT feed deadline surfaces (but assignees may still want nudges)                                                                                             |
| **MTR-003 / CTR-004** | Manager assignment (matter/contract handed to you)                                                                                                                                              |
| **INT-001/003**       | Requester email notifications: request created, status changes, thread replies, declined-with-reason; deep-link to portal; host-configurable; no login ever required                            |
| **INT-006**           | New request → Inbox (the queue itself is the surface; does it also notify?)                                                                                                                     |
| **DD-016**            | Comment replies / thread activity on records you're on                                                                                                                                          |
| **A.4 (mock)**        | Bell + badge in the top nav; badge cap decided here                                                                                                                                             |
| **E.1 (mock)**        | Notifications module chip on contract details                                                                                                                                                   |
| **DES (deferred)**    | ~~Email digest copy register — lands when this ships~~ — discharged 2026-08-18 by **DES-051** (M18/6), which closed DES-015's deferral for every message this system sends, not only the digest |

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

- **Addendum (2026-08-18, M18/8, [#323](https://github.com/juggernog20/OpenLaw/issues/323))** — **The dedup identity names the record, not the date row, and that is a product answer as well as a schema one.** The identity is user, event, entity, the date value, and the offset (M18/1), and `entity` is the contract. So several named key dates that fall on **one record on one day** are **one** bell item and **one** briefing line, not one each — the second insert conflicts with the first and is dropped, and the line the reader gets carries whichever label was written first.

  It is stated here because the milestone close is where anybody found out. The bell's own sentence is already written at that grain — "A key date on {contract} is coming up" — so the item is true either way; the **briefing** is where the difference shows, because a digest line names the date. The alternative is to widen the identity with `key_date_id`, which would give a reader one line per named date and give an install with a busy record a briefing several lines longer for one day. Neither is obviously right, and nothing decided it: this addendum records what shipped so the choice can be made deliberately rather than discovered again.

  **Nothing else collapses.** Two approval requests for one person on one record are still two rows — the partial index only covers rows that carry a reminder date (M18/6) — and a date that **moves** carries a different value and is a different identity, so it fires again.

- **Addendum (2026-08-24, M23 close, [#496](https://github.com/juggernog20/OpenLaw/issues/496))** — **Matter events use the same engine and one continuous wall.** Matter assignment, Task assignment, Activity, comments, Documents, Status changes, and approaching Key dates all enter through the existing `Notifier`. Audience resolution starts with the Matter Manager and explicit team, then DD-014 reach and DD-016 tier narrow it. The same Matter predicate is re-applied on bell reads and sends, so a removed or archived reader gets no row, count, or title leak; Closing alone changes neither audience nor writability.

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

- **Addendum (2026-08-18, M18/3, [#318](https://github.com/juggernog20/OpenLaw/issues/318))** — **The rest of group 1 fires, and the mention is the one with a rule of its own.** Owner assignment (CTR-004), task assignment (CTR-017), and the comment mention (CMT-007) each became one Notifier call inside the mutation that causes them, joining the approval request that shipped with the engine. Nothing about the machinery moved: the audience, the wall, the actor exclusion, the preferences, and the after-commit wake-up are all still the seam's, and a slice that fires an event now writes a call and a line of email copy.

  **A mention's audience is `comment_mentions`, read behind the seam.** The route names the comment and its tier; the fan-out reads who that comment addressed out of the table, inside the transaction that wrote it. A body is never parsed — that is what `comment_mentions` is for (CMT-007) — and the route cannot hand the seam a different list from the one the record kept.

  **The mention carries the comment's tier, so DD-016 narrows the audience beside DD-014.** The wall answers "which people does this record reach"; the tier answers "which of them were in the room for what was said". A Legal Only mention therefore reaches nobody the tier excludes, and it is the same predicate asked with one more argument rather than a second rule beside it. The composer's refusal (CMT-007) is the first gate and this is the one no later call site can forget — the wall's own posture, applied to the second boundary.

  **No mention email carries the comment.** It says who named you, on which record, and where to go. The tier is enforced on the thread and a redact (CMT-006) cannot reach mail that has already left, so the words stay where both of those still hold.

  **Silence is decided at the call site, and the rule is "was this done _to_ somebody".** Clearing a contract's Owner hands it to nobody, so it raises nothing — unassigned is a real state (triage). Renaming a task, moving its due date, or re-sending the assignee it already had are edits to something that person already holds. A comment that names nobody is ambient movement, which is group 2's business and not this slice's.

  **A re-request after a rejection tells the approver again.** CTR-012 already made it a new row rather than a reopened one, so it was already a second `approval.requested` through the same seam; it is recorded here because "a renewed ask is never silent" is a promise about notifications and had nowhere else to be written down.

- **Addendum (2026-08-18, M18/4, [#319](https://github.com/juggernog20/OpenLaw/issues/319))** — **Group 2 fires: status changes, comments, documents and versions, and envelope endings.** As with group 1, no machinery moved — the events are emissions through the seam that already existed, and the bell needed no change at all, because #317 narrated the whole catalogue.

  **The audience is "who is this record about", and that is a different question from "who reaches it".** It is the Owner (`manager_id`) plus everybody holding a `contract_team` row of any role — `creator`, `member`, `watcher`, and `contributor` — which is this decision's own "watchers are the existing team roles, no separate subscribe mechanism". A Legal Team Member who is on no team reaches every contract that is not confidential (CTR-021) and hears nothing about any of them, and an Administrator is not in the audience by role either: a bell that told every Administrator about every status change on every contract would be exactly the ambient noise this group's defaults exist to avoid. The audience is **resolved** first and the DD-014 wall then **narrows** it, in that order, like every other event.

  **The record names itself.** Group 2's methods take a contract id and no more; the seam reads the number and the title in the same query that resolves the audience. Group 1's routes pass them, because they have just written the row — group 2's callers have not: a document route holds a document, the executed-copy job holds an envelope, and asking each of them for two columns would have been one query written at four call sites.

  **A sentence goes exactly as far as the thing it is about.** A comment event carries its DD-016 tier, so a Legal Only comment produces no bell item for a Contributor — the mention's rule, applied to the ambient event beside it. A document event carries the file's DD-014 flag, so a confidential document's events reach only the document's audience. That second gate narrows nothing today, and it is asked anyway: a document has no team of its own (DOC-008), so its audience and this group's audience are the same set of people — and "only the document's audience" has to be a property of the code rather than of two rules happening to agree.

  **One comment tells one person once.** Somebody the comment named gets the mention (group 1, which interrupts) and not the ambient event beside it. Two rows on one bell for one comment would be the same news twice, at two volumes.

  **Only a status move rings, not every edit.** A retitle, a description, a term date are on the record's own feed (DD-017); a bell item per field would be the noise this group is defaulted quiet for. The status is what surfaces branch on (CTR-001) and it is what "my contract moved" means.

  **The actor of a webhook is nobody, and nobody is excluded.** `actorId` is nullable on every group-2 event and null is a real answer, not a missing one: the Connect delivery, the reconciliation round, and the executed-copy fetch are the integration speaking (CTR-013), which the activity feed already records by writing an entry with no actor. So the whole team is told — **including the person who sent the envelope**, who is the one recipient a wrongly-guessed actor would have dropped. A void somebody took on the record does carry them, and does exclude them.

  **The envelope's notification hangs off the one status funnel.** `applyEnvelopeStatus` now runs in the seam's transaction rather than the database's, so the bell rows commit with the move and all three feeds — webhook, reconciliation round, void route — get the event by going through the funnel instead of each remembering to raise it. A replay is a no-op there already, so it notifies nobody twice.

  **Email is opt-in and nothing has opted in yet.** Group 2's timing is `none`, so every row it writes records no debt and no message leaves, whatever a preference says. Making the opt-in real is the preferences slice's, and it is one catalogue line plus the email copy the arms would need.

- **Addendum (2026-08-18, M18/5, [#320](https://github.com/juggernog20/OpenLaw/issues/320))** — **Group 2's opt-in is real, and it took the one line the addendum above named.** `activity_on_your_records` moves from `emailTiming: "none"` to `"immediate"`, and the five arms of the template layer that had no words gained them. **The default did not move**: `email: false` is what makes the group opt-in, and the timing only says what happens once somebody has said yes. A person who has never opened the pane is in exactly the state M18/4 left them in — the same rows, the same `email_owed = false`, the same silence — and the difference is that saying yes now means something.

  **The timing shipped as `none` on purpose and not by omission.** Nothing could opt in, so an opted-in row would have claimed a debt the system had no way to pay, and `email_owed` is readable as the record of work owed precisely because no row is ever allowed to say that. The column's honesty is what made the flip a one-line change rather than a migration.

  **A preference is expressed about a group, and the pane is the proof.** The frame drew four switches under group 2 — one each for status changes, comments, documents, and signatures — and the pane draws one row, because this decision's unit is the group and a per-event switch would write nothing. What the frame was communicating survives in the group's own sentence (DES-050 normalization 1).

  **Both channels are the person's**, which NOT-001 already said and this slice is the first to be able to honour. In-app off silences a group entirely, because the bell row is what the email hangs off — that is the engine's shape (M18/1) rather than a rule the pane invents, and the pane says so rather than offering a state nothing behind it can hold.

  **Groups 4 and 5 are slots on the surface too.** The staff pane draws `new_requests` — dormant until the Inbox (M21) — and does not draw `requester_events`, which is the portal audience's own group and belongs on the portal's own settings surface (M20). The API answers all five either way: the model is the model, and which of it a surface draws is the surface's business.

  **Every write narrates, not only every change of effect.** `user.notification_preference_changed` carries the group, the channel, and the new value, and it carries no `old` side — the table holds overrides, so the value before a first save is a default read out of application code and not a stored fact the writer could report. Re-affirming an opinion against a default that may later move is a real act, so it is written down.

- **Addendum (2026-08-18, M18/8, [#323](https://github.com/juggernog20/OpenLaw/issues/323))** — **The tier gates at write time; the wall gates continuously.** M18/3 recorded that DD-016's comment tier narrows a mention's audience beside DD-014's wall. What it did not say is that the two are re-asked on different schedules, and the asymmetry is deliberate rather than a gap.

  The wall is re-applied **every time**: on both bell reads, on both bell writes, when the immediate send job resolves a message, and when the morning round assembles a briefing. The tier is applied **once**, when the fan-out writes the row. So somebody moved out of the Legal Only room between the write and the send still receives the mention email, and still holds the bell item.

  That is coherent because of what each message carries. **No mention email carries the comment's words** (M18/3), and the bell item carries none either — both say who named you and where to go. The read side re-applies only the wall, so the row that person still holds and the mail they receive agree with each other; a tier re-check on one and not the other is what would produce a disagreement. A tier that gated continuously would also mean a bell item vanishing because a thread was re-tiered, which is a fact about the conversation and not about the reader's reach.

- **Addendum (2026-08-21, M20/8, [#382](https://github.com/juggernog20/OpenLaw/issues/382))** — **Group 5 fires, and it added no machinery.** `requester_events` stops being a slot: the Notifier gains four methods — `requestCreated`, `requestStatusChanged`, `requestReplied`, `requestDeclined` — and the five steps behind the seam are the ones M18/1 built. The catalog is complete; **two of the four have a caller in M20** (submission and the thread), and the status change and the decline wait for M21's disposition routes. That is the point of enumerating a catalog rather than growing it event by event: M21 adds a call, not a mechanism.

  **The receipt is the one deliberate exception to the actor-exclusion rule, and it is countable.** `requestCreated` is addressed to the person who pressed Submit, because proof that an ask arrived is the whole content of the message and a receipt addressed to nobody is not a receipt (INT-001). It is one named flag on one method behind the seam — never a rule a call site can reach for — so the exception stays one exception. Every other group-5 event excludes its actor like everything else in the system, which is exactly what makes a staff reply reach the Requester and not the poster, and a requester's own reply reach nobody at all.

  **The audience of every group-5 event is the Requester, and the seam is what says so.** It is read from the Request's own row behind the seam, the way group 2 reads a contract's roster and for the same reason: a caller that could name the audience could name somebody else's Requester (DD-013). Staff are not in it. What tells the staff side that a Request wants attention is group 4, the Inbox's own group (INT-006) — a different queue with different defaults.

  **A Request has no wall, so the wall step asks the two facts that can still change.** DD-014's flag is a contract's and INT-002 gives a Request no equivalent, so what is re-asked at send time is that this person is still the Request's Requester and has not left (SET-005). **DD-016 is the narrowing that does the work here**: a Requester is in Full Thread and nowhere else, so a Legal Only or Working Team comment raises nothing at them — applied behind the seam, on the M18/3 reasoning, so the arm that posts a comment cannot be the place it is forgotten.

  **A decline is raised instead of the status change it also is, never beside it.** INT-006 makes "no" arrive with a why, so the decline carries the reason and the status change does not; two messages about one act would be the same news at two volumes. The reason is **the one piece of somebody's prose this system puts in an email**, and it is there on purpose: a decline reason is written to be read by the requester, it is not a room anybody can be moved out of, and there is no redact for it to outrun — which is precisely why a comment's words still stay on the thread (CMT-006).

  **The email arms land in the one register**, deep-linking to `/portal/requests/{number}` rather than to the staff application. The link round-trips whether or not a session is live: signed out it lands on the portal entry screen, which carries the email step itself (the INT-001 M20/2 addendum), and signed in it lands on the Request. The deep link is **not** carried through redemption — M20/2 decided landing is by role and the callback stays `/` — so a redeemed link puts a Business User in the portal and their own list is the way back.

  **The `notifications` row's read side is untouched, and group 5's rows are deliberately outside it.** `notificationScope` still answers about contracts alone, because it is the **staff** notification centre's predicate; the surface that reads group 5 is the portal bell (NOT-001), which is its own slice of M20. A Member+ who submits a Request of their own is a Requester on the portal, not a staff reader of the portal's group. This is the same failing-closed posture M18 recorded for entities with no reach rule yet — the row is written first and the read rule arrives with the surface.

  **One shape changed behind the seam and nothing above it noticed.** The fan-out now takes the record as a typed entity reference rather than a contract id, and dispatches the wall step per entity type — the arm shape the comments module already uses (CMT-010). The email register's messages likewise carry a record that names itself as a contract or as a Request. Both are what let one engine serve two surfaces without either route learning which one it is on.

- **Addendum (2026-08-21, M20/9, [#383](https://github.com/juggernog20/OpenLaw/issues/383))** — **The read rule arrived with its surface, and it is a surface rather than a role.** M20/8 left group 5's rows outside `notificationScope` on purpose. They are now inside a **second** scope: `notificationScope(db, user, surface)` answers contracts for `"staff"` and the reader's own live Requests for `"portal"`, and the two sets are disjoint by entity type. So the staff notification centre still cannot show a group-5 row and a staff mark-all-read still cannot touch one — not because it is filtered out afterwards, but because it was never in that query. **The "disjoint by entity type" clause is superseded by the M21/4 addendum below**, which makes the two sets disjoint by **audience**: from group 4's first event the staff scope answers `request` rows too, and each predicate names the groups it serves. Everything else in this addendum stands.

  **A person can hold both kinds of row at once, which is why the role could not decide it.** A Member+ who submits a Request of their own is a Requester on the portal and a staff reader in the application. They have two bells with two badges, and neither reads the other. Had the split been by role, that person would have had to be one thing or the other, and DD-013 says they are both.

  **The portal bell is a second mount of the same four routes**, at `/portal/notifications`, not a parameter on the staff four. That is the INT-001 M20/3 rule applied one module over — the requester-facing read is its own address rather than a loosened gate — and it means the read model, the keyset, the page size, and the "no user parameter" property are written once and shared. The address is what says which surface is asking.

  **A Request has no wall, so the portal predicate re-asks the two facts that can still change**: the Request is still live and this person is still its Requester. An archived Request's items leave the list and the badge together, silently, exactly as a walled-off contract's do on the staff side — no row, no gap, no number that says something was left out. The rows stay in the table.

  **The preferences pair stays mounted once and serves both panes.** A preference is one person's whichever bell they are looking at; the API answers all five groups and the surface decides which of them to draw. The staff pane draws four, and the portal pane draws `requester_events` alone.

  **A save back to a group's own default removes the override rather than storing one that agrees with it.** This supersedes the shipped M18/5 behaviour, which upserted on every save. The table is named for what it holds: a row that agrees with the default is not an override of anything, and leaving one there silently pins that person against a default they never asked to be held apart from. The **effective** answer is identical either way — both readers start from the catalogue default and lay stored rows over it — so nothing above the seam can tell the two states apart, and the difference shows only on the day a default moves. **The change is at the shared write path, so it reaches the staff pane too**, not only the portal one — the pair is mounted once and serves both, and a rule that held on one pane and not the other would be two rules.

  **Narration is unchanged and still happens on every write.** `user.notification_preference_changed` records the group, the channel, and the new value whether the write stored a row or removed one: the M18/5 clause is about the act being recorded, not about what the table ended up holding, and re-affirming an opinion is still a real act.

- **Addendum (2026-08-21, M20/10, [#384](https://github.com/juggernog20/OpenLaw/issues/384))** — **The portal scope carries no Administrator override, and the absence is the decision.** The staff scope has one three lines above it: an Administrator reaches every contract, because reaching every record is what the role is (DD-014). The portal predicate has no equivalent and gains nothing from one. Being somebody's Requester is not a power, it is a fact about one row (DD-013), and an Administrator who has raised no Request has no portal rows to be shown. So an Administrator's portal bell is their own Requests and no more, which is the same answer every other role gets. Recorded at the M20 close because it was stated only in the predicate, and because "the Administrator sees everything" is the assumption a later reader would carry in.

- **Addendum (2026-08-22, M21/4, [#415](https://github.com/juggernog20/OpenLaw/issues/415))** — **Group 4 fires, and it cost two lines in two tables.** `new_requests` stops being a slot: `request.submitted` joins the catalog, the group's email timing moves from `none` to `immediate`, and the Notifier gains one method — `requestSubmitted` — called from the submission route beside the receipt it already raised. The audience read, the actor exclusion, the preference read, the bell rows inside the caller's transaction, and the after-commit wake-up are the five steps M18/1 built. The Inbox added a call, not a mechanism, which is what enumerating the groups ahead of their events was for.

  **The default did not move.** `email: false` is what keeps group 4 opt-in, and the timing only says what happens once a Member+ has said yes. It shipped as `none` because nothing could opt into a group nothing fired, and an opted-in row would have claimed a debt the system had no way to pay — M18/5's argument for group 2, said again one group over. The `new_requests` switches the staff pane has drawn since M18 now control something real, and a Member+ who never opened the pane is in exactly the state M18/5 left them in.

  **One act, two events, because it has two audiences.** A submission raises `request.created` at the Requester (group 5, INT-001's receipt) and `request.submitted` at every live Member+ (group 4, INT-006). They are separate slugs rather than one event with two audiences because they are separate sentences with separate defaults on separate bells: the receipt says "we have it" and links to the portal, the arrival says "something is waiting" and links to the staff request detail. Collapsing them would have made the group a property of the reader rather than of the event, and NOT-002's whole shape is that the group decides the audience rule and the defaults.

  **The audience is every live Member+, read behind the seam.** INT-006 gives triage no routing rules, no rotation, and no claim mechanism, so "Member+ triages" is the audience rule in full — there is no team table on a Request to consult and nothing to narrow it by. It is read behind the seam for group 2's and group 5's reason: a caller that could name the audience could name somebody who does not triage. The actor exclusion is the seam's as always, which is what makes a Member+ who submits a Request of their own hear about it once, as the Requester, and not twice.

  **A Request is read from two sides now, and the event says which.** The wall step for a Request had one rule — this person is still its Requester (DD-013) — and it gains a second: this person is still Member+ (INT-006). Which of the two is asked is read from the event's group rather than passed by the method, so an event added to group 4 later inherits the Inbox's rule and cannot be the one that forgets it. The send job re-asks the same question live, so a triager demoted between the write and the send has the message skipped exactly as a walled-off contract's recipient does.

  **The two bells split by audience, not by entity type.** This refines M20/9, which said the split was by entity type and was right while `request` rows had one audience. The staff notification centre now answers contract rows **and** group 4's arrivals; the portal bell answers group 5's items. Both predicates name their groups, so the sets are disjoint by construction rather than by the two rules happening to agree — and the person that matters is the Member+ who submitted a Request, who from this slice holds a row of each kind about one Request and must find each on its own bell. A group added later is on neither bell until somebody has decided which one it belongs to, which is the safe direction: a missing item is noticed, a leaked one is not.

  **The email is one catalogue line plus its copy** (M18/5's pattern). It deep-links to the staff request detail, not the portal address, because the reader is a triager — the register layer already chose the surface from the record, and now chooses it from the record and the group together. It names the request type and the urgency, which are the two facts a triager weighs before opening anything, and it names them because a message that made somebody open the Inbox to learn whether it was urgent would have saved them nothing.

- **Addendum (2026-08-22, M21/5, [#416](https://github.com/juggernog20/OpenLaw/issues/416))** — **The mention gains a `request` arm, and being named is done _to_ you whatever record it happens on.** `comment.mentioned` was a contract's event: it carried a CTR-003 number and a title and fanned out over a roster, so a Member+ named in a Request thread was reached by the reply event if they were its audience and by nothing at all if they were not (the CMT-010 M20/10 addendum recorded the blank and left the call to this milestone). The call is made here. The event is a union with one arm per record type, the group and the defaults are unchanged — bell on, email immediate — and the M18/1 rule that put the mention in group 1 rather than group 2 is what decides it: a mention is somebody asking you a question by name, and the table the question was asked on does not change what it is.

  **The Request names itself behind the seam; the contract still names itself through the caller.** Group 1's contract events are handed a number and a title because the route has just read the row it is writing to. A Request event is not: the fan-out reads the Request's number and summary out of the audience read it does anyway, which is the shape M20/8 gave every group-5 event and M21/4 gave group 4's. Here that read earns its place twice, because it is also the only thing that knows who the Requester is — which is what makes the next rule the seam's rather than a call site's.

  **The Requester is never mention-notified at Full Thread, and the rule is the tier's rather than the person's.** `request.replied` already reaches them in that room, and one comment tells one person once (the M18/4 rule). Stating it as "the Requester never gets a mention" would have been shorter and wrong: the reason is the reply event's reach, and the reply event reaches Full Thread and nothing else. A Business User can only ever be named in that one room — DD-016 gives them no other — so for them the two statements agree. They part on the one person who can stand on both sides, a Member+ who raised a Request of their own: named at Legal Only, no reply event can reach them, and the blanket rule would have left CMT-007's promise broken, because the candidate list offered their name at that tier and the composer accepted it. So the mention is what tells them there. Named at Full Thread they get the reply and no second row.

  **The side an event speaks to follows its group, not the question "is it group 4".** M21/4 read the side as `isInboxEvent`, which was exact while group 4 was the only staff-side event on a Request. It is not any more, and `comment.mentioned` is one slug on two records, so a per-slug table would have to say two things about it. The catalogue now maps each **group** to a side, total over the group union, and every reader asks that one answer: the fan-out's wall step, the send job's re-check of it, the two bells' scope predicates, and the mail template choosing which of the two messages it is writing. A group added later stops the build until somebody has decided which bell its Request rows belong on, which is the property M21/4's "disjoint by construction" claim rests on.

  **The mail is the staff side's, and carries no comment words.** It names the Request as `R-### · summary`, the way the requester's own messages do, and deep-links to the staff request detail rather than the portal address, because the reader is a triager. The words stay on the thread for the contract mention's reason: DD-016 is enforced there, and a redact (CMT-006) cannot reach an email that has already left.

- **Addendum (2026-08-22, M21/11, [#422](https://github.com/juggernog20/OpenLaw/issues/422))** — **The reply promise follows the thread onto the record.** CMT-001 has a conversion move a Request's comments onto the contract it became, and from that moment a Full Thread comment on that record is a reply to the person who asked. So `comment.posted` raises `request.replied` beside itself: the record's own people hear group 2 about the contract, and the Requester hears group 5 about the Request. Two events, two entity types, two bells — the same split M21/4 drew, said about one comment instead of about one submission.

  **The back-link is resolved behind the seam, and that is the whole of why this is not three rules.** No comment route and no audience arm learns that a Request is behind the record: the fan-out reads `converted_contract_id` itself. So a reply typed on the contract's own applet, on the staff request detail, and in the portal composer all reach the same person the same way, because there is one place that decides it. A caller that had to name the Requester could name the wrong one, and three callers that had to remember the rule would be three chances to forget it.

  **The tier decides who hears it, and nothing at the call site does.** The reply is raised at every tier and the fan-out's own wall drops it below Full Thread, because a Requester is in one room (DD-016). The actor exclusion is the fan-out's too, so a staff reply reaches the requester and not the poster, and a requester's own reply reaches nobody in group 5 while still telling the record's people in group 2 — which is what a reply from them **is**, now that the conversation lives where legal works.

  **One comment tells one person once** (the M18/4 rule, applied where the M21/5 addendum applied it to the mention). At Full Thread the Requester is dropped from the record's group-2 event, because the reply is about to reach them and louder. Below Full Thread no reply can reach them, so a Requester who is also on the record's team keeps the group-2 item that is their only news of it. The rule is the tier's rather than the person's, for the mention's reason: only one person can stand on both sides — a Member+ who raised the Request and joined the record's team — and a blanket rule would have taken their only news away in the rooms the reply cannot reach.

  **A comment that names the Requester drops the reply instead, and the order is the record's.** On a contract the mention is the loudest of the three events and the ambient ones step aside — that is what the group-2 event's `except` list has always done. A Full Thread comment naming the Requester therefore raises the mention alone. Only one person can ever be in that position: a Member+ who raised the Request and can reach the record it became, because a contract offers no Business User as a mention candidate (CMT-007) and the composer refuses a name it was not offered. This is the mirror of the M21/5 rule rather than a contradiction of it. On a Request the reply wins at Full Thread because the reply is the event that record has; on a record the mention wins because that is the record's own order. Either way the arithmetic is one comment, one row.

  **No group and no side moved.** `request.replied` is group 5 and speaks to the requester side, which is what it already was; the group-2 row this sits beside is written against the **contract**, so no group-2 row about a Request exists and `REQUEST_SIDE_BY_GROUP` still names groups 2 and 3 as neither side. The catalogue is untouched by this slice — the reply promise surviving the move cost one read and one call, and no new event, group, or side.

  **A record no Request converted into is unaffected**, and pays one indexed read per comment for the question — `requests_converted_contract_idx` lands with this slice, because reading the back-link from the record's end is a question nothing had asked of that table before. That read is the price of the rule living behind the seam rather than at three call sites, and it is the same posture the wall takes on a record with no wall: a property of the code beats two rules happening to agree.

- **Addendum (2026-08-22, M21/12, [#423](https://github.com/juggernog20/OpenLaw/issues/423))** — **Two things the `request` arms decided in the code, read back at the M21 close.**

  **The side question and the bell question answer an unknown group differently, and the difference is deliberate.** `REQUEST_SIDE_BY_GROUP` names groups 4 and 1 as the inbox side and group 5 as the requester side; the M21/4 addendum records that a group added later is on **neither** bell until somebody has decided. Asked which side a row belongs to, the same unknown group answers `requester`. That is not a contradiction. The bell question is "may this be shown", and the safe answer to an undecided group is no. The side question is "who must this row's reader be", and the safe answer is the narrower audience — the Requester of that one Request (DD-013) rather than every Member+. So an undecided group is invisible and, if it ever were made visible, would be scoped to one person. Both defaults fail closed; they fail closed in opposite directions because the questions point in opposite directions.

  **An archived Request would end the reply promise on the record's thread, and nothing archives one.** The back-link read filters on `archived_at is null`, so an archived Request stops raising `request.replied` from the contract it converted into — and stops being excluded from the record's own group-2 event, so a Member+ Requester would start hearing the ambient item again instead of the reply. If two Requests ever named one contract the lowest R-### would win. Both arms are unreachable today: no route archives a Request, and the conversion writes one back-link per record. They are written down for the reason the watermark conflict arm is — the milestone that builds a Request archive surface inherits them, and an unreachable rule nobody wrote down is a rule that gets rediscovered as a bug.

- **Addendum (2026-08-24, M23 close, [#496](https://github.com/juggernog20/OpenLaw/issues/496))** — **The Matter catalog arms are complete.** A new Matter Manager and a newly assigned Matter Task use Assigned to you; Matter Status, comment, supporting-Document, and Version events use Activity on your records; Matter Key dates use Dates approaching. Task due dates remain outside group 3. Actors are excluded as usual, assignment is independently reachable, and archived Matters are omitted; Closing raises its Status event but does not silence later record Activity.

- **Addendum (2026-08-30, M27/6, [#578](https://github.com/juggernog20/OpenLaw/issues/578))** — **Entity obligations join Dates approaching as `date.obligation_approaching`.** The morning round reads open obligation `next_due_on` values through the same NOT-004 offsets as contract and Matter dates. An assigned obligation addresses that one live assignee; an unassigned obligation addresses every live Administrator. Entity reach is re-applied at fan-out and bell read, so the event cannot make an Entity visible to somebody who cannot reach it.

  **The reminder identity does not grow.** It remains user, event type, Entity id, reminder date, and offset. Re-running the round is therefore a no-op for a reminder already written, while filing a recurring obligation changes its reminder date and permits the next cycle. The obligation id remains rendering data rather than part of dedup identity, matching the existing one-reminder-per-record/date/offset grain.

  **The morning email gains an Obligations section.** Its lines name the obligation and Entity and deep-link to that Entity's Obligations tab. Empty sections remain absent. Obligations use the existing group-3 channel defaults; this is a fourth source in the round, not another cadence or another message.

## NOT-003 — Timing: direct events immediate; date reminders in a daily digest

- **Status** — Accepted; **amended by NOT-008** (the daily briefing subsumes the date-only digest)
- **Date** — 2026-08-05
- **Decision** — Groups 1 and 5 email immediately. Group 3 (dates) batches into one daily morning digest email — the renewal calendar as a briefing — alongside individual bell items. No weekly digest or per-user schedule configuration in v1.
- **Rationale** — Date noise is the likeliest unsubscribe trigger; one briefing beats nine offset emails.
- **Consequences** — Digest rendering job on the background pipeline (DOC-009's worker). Email digest copy register — the deferred DES note — is now actionable when the digest is designed.
- **Addendum (2026-08-18, M18/6, [#321](https://github.com/juggernog20/OpenLaw/issues/321))** — **The clock arrived, and it is the only thing in this system that starts a conversation nobody asked for.** Every other event fires because somebody did something; a date arriving is nobody's act. So there is one scheduled job — `notification.morning-round`, a pg-boss cron, `singleton`, one round per install however many replicas boot. That is the boot-versus-schedule rule the reconciliation sweep settled (#277), and it binds harder here: two rounds at once would not merely duplicate work, they would put two briefings in one person's post on one day.

  **The round is hourly and a person is served once a day.** Those are two different periods and both are the decision. "One morning digest" means 08:00 **where the reader is**, and a daily tick could only ever be 08:00 in one zone — so the round ticks every hour and each one serves the people whose own clock has reached eight. The gate is "has **reached** 08:00", not "is 08:00": an install whose worker was down at somebody's eight o'clock serves them at nine rather than skipping their day. The zone is the person's profile timezone (SET-006) and UTC for the great majority who never set one, and every conversion is `Intl`'s rather than a stored offset's — which is what makes a spring-forward unable to skip anybody and a fall-back unable to serve them twice, because a 25-hour day is still one local date.

  **The once-a-day promise is kept by the rows, not by a marker column.** The newest `emailed_at` on a person's own reminder rows, read as a date on **their** calendar, is the proof that today's briefing has gone. A reminder written after it — a key date added at eleven in the morning — is not lost and does not force a second message: it stays owed, and tomorrow's briefing carries it. That is the M12 doctrine one more time, and it is why the digest's distances are counted at **send** time against the reader's own today rather than taken from the offset the reminder fired at.

  **The wall is re-applied at send time, per record.** The audience was decided when the reminder was written; a record can be walled off between then and the mail, and a briefing carries record titles out of the building. A row its reader can no longer open is settled as **skipped** rather than sent — the immediate send job's own posture (M18/1), said for a message about several records at once.

  **The same round re-asks for owed-and-unsent immediate emails past fifteen minutes.** That bound is past the immediate queue's own three attempts and its two-minute expiry, so nothing still in flight is asked for twice; the queue's `short` policy would collapse it anyway. This is what finally makes the Notifier's quiet queue-ask honest: the mutation commits, the row says an email is owed, and a wake-up lost between the two costs a delay rather than the message. Digest rows are deliberately **not** in that set — they are the round's own business, and handing one to the immediate job would settle it as "no copy for this event" and silence the briefing it was waiting for.

  **The digest's copy and its anatomy are DES-051**, which closed DES-015's deferred email-copy exception. It turned out to be owed for every message this system sends rather than only for the digest, so the register covers all of them and the exception is gone rather than narrowed.

### Amendment (2026-09-01, M29 close, [#625](https://github.com/juggernog20/OpenLaw/issues/625)): the daily briefing is built

The date-only digest has become NOT-008's cross-module daily briefing. The hourly round, each reader's 08:00 gate, one-send-per-local-day rule, live reach check, and recovery of owed immediate mail remain unchanged. The one morning email can now carry Approvals, Tasks due today or overdue, Dates, Entity Obligations, Knowledge, and opted-in Intake in that fixed order.

Five email-only section preferences control Approvals, Tasks, Dates, Obligations, and Intake. An absent preference row means the application default. The first four default on and Intake defaults off. Knowledge keeps the email preference M28 added to its event group. A fully empty reading still sends nothing.

## NOT-004 — Reminder lead times: one admin-configurable offset list, seeded 7/1/0

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — A single global offset list (Settings → Notifications), seeded `7 days / 1 day / day-of`, applied to every tracked date (key dates, notice deadlines, expiries). Admin-tunable; not per-user or per-date in v1. CTR-006's mandated fires are dates within this scheme.
- **Rationale** — Configurable-over-fixed applies (nothing branches on the numbers); per-date schedules are config sprawl.
- **Alternatives considered** — Fixed offsets; per-date custom schedules.
- **Consequences** — Settings inventory row. Long notice windows may warrant a larger seeded offset later — tune via settings, not code.
- **Addendum (2026-08-18, M18/6, [#321](https://github.com/juggernog20/OpenLaw/issues/321))** — **The list was born with the round that reads it**, as `org_settings.reminder_offset_days`, seeded `[7, 1, 0]`: one `jsonb` column on the singleton row, for the reason `allowed_email_domains` is one — an ordered list of scalars, read whole every round and written whole by one pane. The pane is its own slice (#322); this one is what makes the numbers mean something.

  **It is read live, on every round** — the read-on-every-decision pattern the mailer resolver and the signing connector already follow. An Administrator who shortens the list at 09:00 has shortened it for the 10:00 round, with no restart and no cache to invalidate. It is read **once per round** rather than once per person, because a list that changed mid-round would leave two people in one cohort reminded on different schedules, which is a difference nobody could explain from the outside.

  **What comes back is sanitised, not trusted.** A `jsonb` column's shape is the application's to hold: whole days, never negative, deduplicated, and bounded at two years of lead time, with anything else dropped. An empty **usable** list falls back to the seed rather than to silence — a hand-edited row or a restored backup must not be able to switch every reminder off without anybody choosing to.

  **One offset names one day, and the comparison is equality.** A date six days out is not the seven-day reminder arriving early; it is the seven-day reminder that already went. That is what makes the dedup identity's offset half meaningful, and it is why an install that lengthens its list does not retroactively fire for dates already past.

  **The three sources are one union, read from the other end** (CTR-009). The key dates are rows, the expiry is a column, and the notice deadline is `expiry_date − notice_period_days` **subtracted in the round's own query and stored nowhere** — M16's doctrine, and the reason this milestone adds no materialised column and no job keeping one true. An ended contract is skipped, because a dead deal does not clutter a briefing; so is an archived one, on `renewalPending`'s reading of the same two columns — a frozen record is not waiting on anybody.

- **Addendum (2026-08-18, M18/7, [#322](https://github.com/juggernog20/OpenLaw/issues/322))** — **The pane shipped**, in Settings → Organization → Notifications, on the DES-052 value-list anatomy: one card of lead times, added, removed, and rearranged in place. It is Administrator-only (SET-002), immediate on save (SET-003), and narrated in the audit log like every settings mutation since M5.

  **One write, three verbs.** `PUT /org/reminder-offsets` carries the whole list, because adding, removing, and rearranging are the same change to the same list — the shape `PUT /auth/allowed-domains` already takes, for the reason the column takes `allowed_email_domains`' shape. The round reads the column live, so the next round fires on the saved list with nothing restarted and no cache to clear; the end-to-end assertion runs the round's own handler over a list saved through the route.

  **The saved order is the reader's order.** M18/6 shipped the live read sorted furthest-first, and its doc (`usableOffsets`, in `apps/api/src/lib/notifications/offsets.ts`) called that "the order the pane draws"; that half is superseded now the pane exists. The pane draws the order the Administrator arranged and saves it, because a person expects to find a ladder where they left it. The round still sorts its own read, and the order carries no behaviour either way: one offset names one day and the comparison is equality, so no arrangement of the list can change which day fires.

  **The list can never be emptied.** The route refuses an empty list and the pane locks the last remaining row. No lead times would mean no reminders at all — and because the read falls back to the seed on an unusable list, an empty list could not be told apart from a corrupt one. Silence is chosen per event group on the NOT-002 preferences pane, where it is a choice with a name; it does not fall out of a settings row.

  **Bounded, and the bounds are the round's.** A saved lead time is a whole number of days from 0 to 730, and a list holds at most twenty of them — the same numbers the live read already enforces, so the pane cannot save something the round would then drop. A duplicate collapses to its first position, because two copies of `7` are one lead time.

- **Addendum (2026-08-18, M18/8, [#323](https://github.com/juggernog20/OpenLaw/issues/323))** — **A day with no round at all is a day of dates nobody hears about, and that bound is the price of equality matching.** The addendum above says an offset names one day and the comparison is equality. The consequence was left unwritten: the reminders owed on a given local date are only ever raised by a round that runs on that date. The `>= 08:00` gate covers an install whose worker was down at somebody's eight o'clock — they are served at nine, or at noon — and it covers nothing wider. A worker down from one midnight to the next skips that day's dates outright, and the next day's round asks about the next day's dates.

  It is recorded rather than closed. Widening the match to "on or before today, and not already fired" would heal the outage and would also fire every past offset the moment an install lengthens its list, which is precisely what M18/6 declined. The honest statement is that reminders are best-effort against a running install, while the deadline surfaces on the record (CTR-006, CTR-009) are always true — the record is the source, and the briefing is a prompt.

- **Addendum (2026-08-24, M23 close, [#496](https://github.com/juggernog20/OpenLaw/issues/496))** — **Matter Key dates join the existing offset list unchanged.** The morning round unions them with Contract Key dates, expiries, and derived notice deadlines, using the same live `[7, 1, 0]` defaults and per-user calendar. Only open, non-archived Matters participate. No per-date schedule, owner, template date, Task-date arm, or new reminder setting was added.

## NOT-005 — Badge: unread count, 9+ cap, read-on-open

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — Bell badge shows unread count capped at "9+". Opening the center marks visible items read; mark-all-read affordance; items deep-link to their records. Identical semantics on the portal bell.
- **Rationale** — The activity feed (DD-017) is the durable history; notifications are ephemeral prompts — per-item read ceremony fights that.
- **Consequences** — Grill-plan A.4 fully unblocked (bell + badge, cap 9+). `notifications.read_at` supports it.
- **Addendum (2026-08-18, M18/2, [#317](https://github.com/juggernog20/OpenLaw/issues/317))** — **The bell shipped, and the read model is one write per page shown.** `POST /notifications/read` takes the ids of the page the centre just drew; `POST /notifications/read-all` takes nothing. There is no third write, because there is no per-item ceremony to serve.

  **Both writes answer the unread count that remains**, which is `POST /comments/read`'s shape (CMT-004) and its reason: the badge takes the server's number rather than assuming its own request cleared what it sent. The surface never decrements locally, so a badge and a list cannot drift apart.

  **The wall applies to the writes, not only to the reads.** An item about a record walled off after it was written is already outside the list and the count; the writes leave it unread too, because marking it read would be a write about a record the person can no longer see. The row keeps its state, so opening the wall again brings the item back exactly as it was — the same property the read side has.

  **An id that is not this person's is not refused.** It matches nothing and the answer is the caller's own badge. A 404 would answer the question "does this id exist", which is the one thing a bell addressed to one person must not do.

  **The page is the unit.** The mark-read write is bounded to one page's worth of ids, because a page is what the centre draws and what "the visible items" means on a list that arrives a page at a time. A second draw of the same page sends nothing: an already-read item keeps the stamp from its first sighting, and the surface filters the read ones out before it asks.

- **Addendum (2026-08-21, M20/9, [#383](https://github.com/juggernog20/OpenLaw/issues/383))** — **"Identical semantics on the portal bell" turned out to mean one component, not a second one.** The badge, the 9+ cap, read-on-open, mark-all-read, the paging foot, the focus landing, and both failure states are the staff bell's own code rendered against the portal's chrome. What the portal passes is which of the two surfaces it is: that selects the four routes to ask, the empty panel's sentence, and the trigger's foreground pair — the dark chrome strip and the raised portal strip need different ones. Nothing else differs, because NOT-005 settled one read model and not two.

  **Two bells means two badges, and marking one read leaves the other alone.** That is a property of the API's scope (the NOT-001 M20/9 addendum) rather than of this surface, which counts nothing itself and draws only what it is answered.

  **A group-5 item addresses the Request itself and names no section.** Point 9 of DES-049 makes a contract's prompt open the section it is about, because a contract record has routed tabs; a Request's detail is one page, so `/portal/requests/{number}` is the whole address.

## NOT-006 — The morning digest's anatomy and its delivery rules

- **Status:** Accepted; **amended by NOT-008** (the daily briefing replaces the date-only digest and extends the anatomy)
- **Date:** 2026-08-18
- **Moved:** 2026-08-18 — clauses 4 to 12 of **DES-051**, which recorded them when the digest was written (M18/6, #321). They are delivery rules rather than front-end design, so they live here. DES-051 keeps the register: the voice, where the copy lives, and how a date prints.

### Context

NOT-003 decided that group 3's mail is one morning briefing rather than one message per reminder. M18/6 (#321) built the round that sends it, and DES-051 — written to close DES-015's copy-register deferral — carried the digest's whole shape as well, because both were settled in the same pass.

That put a rule about _when the round may send_ and _which rows it orders first_ inside a record whose own scope line restricts it to front-end design. This record takes those clauses back.

### Decision

**1. The digest's subject is a count, and nothing else.** "3 dates on your contracts" / "1 date on your contracts". Sentence case, digits, no full stop, no record name — a subject naming one of five records would make the other four look like they were not in it, and a subject naming a date would go stale in the reader's inbox.

**2. The body is one greeting, one framing line, one block per date, and one way out.** The framing line is "These dates are coming up on your contracts, nearest first." — it names the order, because the order is the information.

**3. A date's block is two lines: the sentence, then its address.** `In 7 days (Mar 19, 2026) — Notice deadline: Meridian Bio supply agreement (#14)`, then the link. Relative first because "in 7 days" is what the reader is deciding on; the absolute date in brackets because a briefing read three days late must still be readable. `Today`, `Tomorrow`, and `Yesterday` are named; everything else is `In N days` / `N days ago`.

**4. The kind of date is what a key date is called, or what the term calls it.** A key date prints its own label (CTR-009); the two the term derives print `Notice deadline` and `Expiry`, because no person named them.

**5. The order is the deadline union's, exactly** (CTR-009, M16/3): what is still ahead nearest first, then what has gone by, most recently first; ties broken by the notice deadline, then the expiry, then the record's own dates. A reader who follows a link lands on the same order they were just reading.

**6. The address is the record's Key dates section**, not the record's front page — DES-049 clause 9, said on the second channel.

**7. Every date's distance is counted at send time, against the reader's own today.** Not against the offset the reminder fired at. A briefing that missed its morning rides the next one (NOT-003), and "in 1 day" about yesterday would be worse than no briefing.

**8. The digest closes with the way out.** "Change what reaches you in your notification settings:" and a link to the pane DES-050 built. A recurring message with no way to turn it down is what trains a reader to filter the sender, and the pane already exists.

**9. No empty briefing ever leaves.** A day with nothing due sends nothing. A daily message that says nothing happened is exactly the noise NOT-003 exists to prevent.

Every sentence these clauses order is written to **DES-051**'s register.

### Rationale

Clause 1 is the digest's whole difference from every other message here. Every immediate mail is about one record and can name it; the digest is about a person's morning, and the moment it names a record it starts implying a priority the round did not compute.

Clause 7 looks like a detail and is the reason the row carries `reminder_date` rather than only its offset. The offset is what the reminder fired at; the distance is what the reader needs. Storing one and printing the other is what makes a delayed briefing honest instead of confusing.

### Alternatives considered

- **Group the digest by record rather than by date.** Rejected: NOT-003's briefing is a calendar, and a calendar is ordered by time. A reader with nine dates on one record wants them in the order they arrive, not gathered under a title.
- **Name the nearest date in the subject** ("Meridian Bio expires today, and 2 more"). Rejected — see the Rationale for clause 1.
- **A per-user send hour, or a weekly digest.** Rejected upstream: NOT-003 declined both in v1 in as many words.

### Consequences

The surface is `renderDigestMail` in `apps/api/src/lib/notifications/email.ts`, ordered by the round in `apps/api/src/pipeline/morning-round.ts`. A change to what the briefing carries, or in what order, is an amendment here. The portal's requester mail (M20, group 5) inherits these clauses if it ever needs a digest of its own.

**Known wording gap.** Clause 2's framing line says "nearest first", which is true of the rows still ahead and not of the overdue rows behind them. It only shows on a briefing that missed its morning. Recorded rather than fixed: the sentence has shipped, and changing it is an amendment to this clause.

### Amendment (2026-09-01, M29 close, [#625](https://github.com/juggernog20/OpenLaw/issues/625)): the anatomy now covers six sections

Clauses 1 to 6 now have a wider reading. A dates-only email keeps the date-count subject and date framing above. A Knowledge-only email names its new Knowledge item count. An email that carries Approvals, Tasks, or Intake, or that mixes Dates and Knowledge, uses `Your daily briefing` and the framing line `Here is your daily briefing.`

The body renders the present sections in one fixed order: Approvals, Tasks, Dates, Obligations, Knowledge, then Intake. Empty sections disappear. Approvals, Tasks, and Intake use the same three-row section contracts as Home and add `And N more on Home.` when the cap omits eligible rows. Each row links to the Contract, Matter, Entity, Knowledge Item, or Request surface that resolves it. Date order and distance keep clauses 3 to 7 above. The settings link and the no-empty-send rule keep clauses 8 and 9.

Both HTML and plain text are authored outputs of `briefing-template.ts`. User-written values are escaped in HTML. The plain-text part keeps the same section order and links. DES-051 still owns the sentence register.

### Amendment (2026-09-03, M31/6, [#660](https://github.com/juggernog20/OpenLaw/issues/660)): a date the term derives from an unconfirmed AI source says so

Clause 3's sentence gains one word when the date is still unverified under CTR-008: `In 7 days (Mar 19, 2026) unverified — Notice deadline: Meridian Bio supply agreement (#14)`. The word sits between the date and the kind, in both bodies, in DES-051's register. The expiry line carries it when `expiry_date` is flagged; the notice-deadline line when `expiry_date` or `notice_period_days` is. A key date, a Matter date, and an Entity obligation never carry it. The flag is read from the Contract at send time, not from the reminder row, so a confirmation made after the reminder was created prints as confirmed. Clauses 5 and 7 are untouched: the word changes no order, no count, and no distance.

## NOT-007 — Email delivery is at-least-once; a duplicate is accepted over a drop

- **Status:** Accepted
- **Date:** 2026-08-18

### Context

Raised by CodeRabbit on PR #338 and tracked as [#342](https://github.com/juggernog20/OpenLaw/issues/342). The `notification.email` handlers read a row that owes mail, send it, and then settle it. `batchSize: 1` bounds one worker's concurrency, not concurrency across workers — so two handlers on two replicas can both read the same owed row, both send, and only then race on the conditional settle. The result is a duplicate email, not a lost one.

### Decision

**Accept the duplicate. The at-least-once trade is deliberate and the safer half of a real choice.**

The row is the record of work owed, the queue is only the wake-up, and a lost wake-up costs a delay rather than the message (NOT-001 addendum, M18/1). Claiming a row before the send inverts the trade: a worker that dies between the claim and the relay leaves a row marked sent that never went, which is the failure this design was built to avoid. The morning round's re-ask for owed-and-unsent mail (NOT-003 addendum, M18/6) exists for exactly that reason.

### Why not a lease

A claim-with-expiry (mark claimed, send, settle; dead worker's lease expires and the row returns to owed) reduces concurrent duplicates while preserving recovery, but it can still duplicate if a worker dies after sending and before settlement. It is the closest to eliminating the duplicate without risking a drop. It is declined for now because:

- The window is small: three attempts over roughly 90 seconds against a 120-second queue expiry.
- Nothing here affects a single-worker install, which is the default self-hosted shape.
- A duplicate notification email is mild; a dropped one is not recoverable.

A lease is the right answer if the duplicate rate ever becomes a real complaint under multi-replica deploys. Adding it later requires a schema migration, recovery behaviour, and tests for the failure-after-send boundary.

### Why not queue tightening

Tightening pg-boss's policy so one row cannot be handed to two handlers at once couples correctness to queue configuration, which is harder to reason about across pg-boss upgrades and harder to test than the row-level trade recorded here.

### Consequences

No code change. The immediate queue's `batchSize: 1` and `short` retry policy stay as they are. The morning round's re-ask deliberately excludes digest rows (`reminder_date IS NULL`), so this question is about immediate mail only. If the duplicate rate under multi-replica deploys becomes a real complaint, the lease option is the path forward.

---

## NOT-008 — The daily briefing: one cross-module morning email replaces the date digest

- **Status:** Accepted
- **Date:** 2026-08-18

### Context

M18 shipped a morning digest that carries one thing: contract dates — key dates, notice deadlines, and expiries at the configured offsets, as plain text. That is what NOT-003 asked for. It is less than the message could be.

The daily email is the one surface that reaches somebody who has not opened the app. Sending it with a single module's reminders spends that reach on a fraction of what the system knows. Three sources are already live and need no new machinery: approvals waiting on you (CTR-012, M14), tasks assigned to you and due or overdue (CTR-017, M17), and contract dates approaching (M18). Three more arrive with their modules: entity obligations (ENT-006, M27), knowledge items (M28), and intake requests (M21, group 4's first event).

Raised as [#344](https://github.com/juggernog20/OpenLaw/issues/344). Eight product questions were settled before anything is built.

### Decision

**1. The date digest is subsumed, not sat beside.** One daily briefing replaces the date-only digest. NOT-003 and NOT-006 are amended rather than paralleled — the round, the once-a-day rule, the timezone gate, the dedup identity, and the re-ask for lost mail all carry forward as the engine for a richer message. There is one morning email, not two.

**2. Each section has its own preference toggle, independent of the event-group grid.** A briefing spanning NOT-002's groups cannot be tuned by a group toggle. New preference rows per briefing section give a person per-section control without coupling to the event-group model. The section toggles control the email only — the bell is a single notification (clause 5), not per-section. The section toggles are separate from the NOT-002 channel toggles — a person can turn off dates in the briefing while keeping the bell on for `dates_approaching`. The section vocabulary and its stable render order:

1. Approvals waiting on you (CTR-012)
2. Tasks assigned to you, due or overdue (CTR-017)
3. Contract dates approaching (NOT-003/004)
4. Entity obligations (ENT-006, M27 — deferred until that module ships)
5. Knowledge items (M28 — deferred until that module ships)
6. Intake requests (INT-006, M21 — deferred until group 4's first event ships)

**3. One briefing, not several.** NOT-003's argument — noise is the unsubscribe trigger — gets stronger with more sources, not weaker. Everything in a single daily email: one subject line, one scan, one message to keep or discard.

**4. Empty sections are omitted.** Only sections with items appear. A day with no approvals waiting shows no approvals section. NOT-006 clause 9's rule — no empty briefing ever leaves — extends to the section level: the briefing changes shape daily but stays compact. Present sections always appear in clause 2's order, so the reader's eye can learn the layout even though the set of sections varies.

**5. The bell gets one daily summary notification.** The bell remains an event feed (NOT-005). The briefing adds one notification per day — "Your daily briefing is ready" — and tapping it opens an in-app daily summary view. The summary view is the briefing's content rendered for the screen rather than for mail: a state summary ("what is waiting on you") alongside the event feed ("what happened"). If every section is empty, no bell notification is created — the same rule as NOT-006 clause 9 (no empty briefing ever leaves), applied to both channels. The bell notification ships when the in-app summary view ships, not before; until then, the briefing is email-only.

**6. Both HTML and text parts are first-class.** DES-051's register — warm, direct, short sentences — applies to both. The text part is a peer, not a tag-stripped afterthought. A reader on a plain-text client gets a crafted reading experience, not a degraded one.

**7. Briefing copy lives in a template file, English only.** The briefing has two parts (HTML and text) that must stay in sync across multiple sections. Keeping all of that inline at the call site would make the worker file unreadable. A dedicated template file separates visual structure from assembly logic. The template uses `Intl` formatting (dates, numbers) so the formatting foundations are present from day one. Localisation — extracting strings into a message catalog and resolving by locale — is deferred until SET-006 gains a per-user locale; there is nothing to key on today.

**8. Daily cadence only.** NOT-003 declined a weekly digest and per-user send hours for v1. That decline stands. A richer briefing is exactly the thing somebody would want weekly instead of daily, and the question is worth re-reading when the briefing has shipped and usage data exists — but shipping with one cadence keeps the preference model and the scheduling simple.

### Rationale

The date digest is the seed, not the ceiling. The round that computes it — the timezone gate, the once-a-day rule, the dedup identity, the re-ask for lost mail — is the hard part, and every section of a richer briefing rides on that machinery. Subsuming rather than paralleling avoids two morning emails competing for the same attention, and keeps one engine rather than two.

Per-section toggles were chosen over honouring each section's event-group toggle because the briefing is a different question from the bell. A person who turned off `dates_approaching` email may have done so because nine offset emails were noise — not because they never want to see dates in a morning summary. Coupling the briefing to the event-group grid would produce surprises in both directions.

### Alternatives considered

- **New surface alongside the date digest.** Rejected: two morning emails split attention and invite "why am I getting two?". Subsuming is cleaner.
- **Honour each group's event-group toggle.** Rejected: couples two surfaces that answer different questions. Most work to reason about and hardest to explain to the reader.
- **Own single preference row for the whole briefing.** Rejected: too coarse. A person who wants approvals but not dates in the briefing has no way to say so.
- **Show empty sections with placeholder text.** Rejected: a consistent shape is a small benefit against a longer message every day.
- **Bell gains a summary card.** Decided differently: a single bell notification that opens a summary view, rather than a card living inside the feed.
- **Template file with i18n keys from day one.** Rejected: SET-006 has no per-user locale, so the keys have nothing to resolve against.
- **Weekly or per-user cadence.** Deferred: NOT-003's v1 decline stands until the briefing has shipped and usage data exists.

### Consequences

NOT-003 and NOT-006 are amended when the briefing is built. The date digest's existing rendering surface (`renderDigestMail` in `apps/api/src/lib/notifications/email.ts`) and its round (`apps/api/src/pipeline/morning-round.ts`) are replaced rather than wrapped. The template file is a new artifact. The `notification_preferences` table gains section-level preference rows with a new vocabulary that is not the event-group vocabulary.

The in-app daily summary view is a new screen behind the bell notification. Its scope and design are deferred to the milestone that builds it. The bell notification (clause 5) is gated on that screen — it does not ship until its tap destination exists.

Sequencing this after M28 would make the briefing complete on arrival. Building it at three sections (approvals, tasks, dates) and extending it as modules land would make it useful sooner — and means the section contract (what a section provides, how it queries, how it renders in both parts) has to be right early.

#### M28/6 built addendum: section 5, Knowledge items

[M28/6](https://github.com/juggernog20/OpenLaw/issues/604) adds the fifth briefing section. For each live Member+, the morning round reads live Knowledge items whose `published_at` is strictly after that reader's previous successful briefing and on or before the current round's instant. The window is half-open so consecutive briefings partition the clock with no gap. A reader with no previous send on record gets the items of the last 24 hours, not every item ever published. The item must still be published and not archived when the round reads it. The reader's own items are excluded.

Knowledge publication is ambient. It creates no notification row and no per-publication bell item. The briefing is its channel. A successful send writes an append-only `user.briefing_sent` activity marker, including section counts but no briefing content, so a Knowledge-only email establishes the next window and a repeated round does not send it again. Existing date-reminder send stamps remain the fallback boundary for briefings sent before this marker existed.

The Knowledge row in Personal → Notifications exposes its email section toggle only. It does not expose an in-app switch, and changing it does not change another briefing section or notification group. The section is omitted from both the HTML and text parts when its window is empty. A Knowledge-only briefing still leaves when the section has items.

#### M29 built addendum: the six-section briefing and its Home-linked summary

[M29/7](https://github.com/juggernog20/OpenLaw/issues/624) completes the briefing. Approvals waiting on the reader, the reader's Tasks due today or overdue, and open Intake Requests join the existing Dates, Entity Obligations, and Knowledge sections. Present sections render in clause 2 order in both mail parts. Empty sections disappear, and a day with no enabled content sends nothing. Approvals, Tasks, and Intake share their query contracts with Home. Their email names any rows hidden by Home's three-row cap.

The five `briefing.*` preference keys are email-only overrides. Approvals, Tasks, Dates, and Obligations default on. Intake defaults off. Existing users receive those defaults from application code because migration `0084_lush_ender_wiggin` inserts no preference rows. The Knowledge section is already live from M28/6 and keeps its `knowledge` email preference. It has no Home card. A Knowledge-only briefing sends email but does not create the Home-linked bell summary.

Home is the in-app daily summary view deferred by clause 5, so its built `/` destination satisfies the bell's destination gate. When Home-backed content exists, the round writes one deduplicated `briefing.ready` bell row for the reader's local date. It owes no email and opens `/`. A second round on that date creates no second row. An empty reading creates none.

A successful send appends `user.briefing_sent` with `approvalCount`, `taskCount`, `dateCount`, `knowledgeCount`, and `intakeCount`, while the content remains in the email alone. `dateCount` is the combined count of Dates and Entity Obligation rows.

---

## Index of decisions

| #       | Decision                                                           | Status                                                                                                                                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NOT-001 | One system, two surfaces: bell + email for staff and portal users  | Accepted; the portal surface built and its read rule added by the M20/8 and M20/9 addenda; the absent Administrator override recorded by the M20/10 addendum                                                                                                                                                                    |
| NOT-002 | Event catalog: five groups, defaults by interruptiveness           | Accepted; group 5's four events added by M20/8 addendum; group 4's first event and its opt-in email by the M21/4 addendum; group 1's `request` arm by the M21/5 addendum; the reply promise following a conversion onto the record by the M21/11 addendum; the side default and the archived-Request arm by the M21/12 addendum |
| NOT-003 | Timing: direct events immediate; date reminders in a daily digest  | Accepted; the M29 close records the built cross-module briefing amendment                                                                                                                                                                                                                                                       |
| NOT-004 | Reminder lead times: admin-configurable offsets, seeded 7/1/0      | Accepted                                                                                                                                                                                                                                                                                                                        |
| NOT-005 | Badge: unread count, 9+ cap, read-on-open                          | Accepted                                                                                                                                                                                                                                                                                                                        |
| NOT-006 | The morning digest's anatomy and its delivery rules                | Accepted; the M29 close records the built six-section anatomy amendment                                                                                                                                                                                                                                                         |
| NOT-007 | Email delivery is at-least-once; duplicate accepted over drop      | Accepted                                                                                                                                                                                                                                                                                                                        |
| NOT-008 | The daily briefing: cross-module morning email replaces the digest | Accepted; Knowledge built in M28/6 and the six-section briefing completed in M29/7                                                                                                                                                                                                                                              |
