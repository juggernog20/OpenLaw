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

## NOT-003 — Timing: direct events immediate; date reminders in a daily digest

- **Status** — Accepted
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

## Index of decisions

| #       | Decision                                                          | Status   |
| ------- | ----------------------------------------------------------------- | -------- |
| NOT-001 | One system, two surfaces: bell + email for staff and portal users | Accepted |
| NOT-002 | Event catalog: five groups, defaults by interruptiveness          | Accepted |
| NOT-003 | Timing: direct events immediate; date reminders in a daily digest | Accepted |
| NOT-004 | Reminder lead times: admin-configurable offsets, seeded 7/1/0     | Accepted |
| NOT-005 | Badge: unread count, 9+ cap, read-on-open                         | Accepted |
