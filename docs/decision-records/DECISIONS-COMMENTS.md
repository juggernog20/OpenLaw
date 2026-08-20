# OpenLaw — Comment Surface Decision Record

Decisions for the comment/conversation UI — the "comment-surface feature DD" flagged as unopened in `DECISIONS-DESIGN.md`. The visibility model is fixed by **DD-016** (three audience tiers with composer defaults and mention auto-promotion); the portal request thread is committed by **INT-001**. This file designs the surface those decisions need.

Decisions are numbered `CMT-###`.

## Inherited constraints (swept 2026-08-05)

- **DD-016** — three tiers (Legal Only / Working Team / Full Thread); defaults: Working Team from record pages, Full Thread from the request thread; @-mentioning a Business User auto-promotes with confirmation; Members can downgrade to Legal Only.
- **DD-015** — Contributors can comment (Working Team tier and up, business-tagged context).
- **INT-001/003** — the portal request thread is the requester's conversation; replies notify by email; requesters compose there (Full Thread by definition).
- **SCHEMA `comments`** — polymorphic entity ref: matter | contract | document | request.
- **NOT-002** — comment events notify group 2 (activity on your records) and group 5 (requester events).
- **Mock rows** — E.6 conversation chip (V12), F.7 Communications tab, J.2 activity-bar chat slot (badge "3"), K.B9 inline comment marker in the doc panel.

## Open questions queued for the next grill-me session

_None — queue cleared 2026-08-05 (CMT-001 through CMT-005)._

---

## CMT-001 — One comment system; anchored document comments; the thread follows the work

- **Status** — Accepted; **extended by CMT-010**, which says how "one machinery" is built — one audience arm per entity type
- **Date** — 2026-08-05
- **Context** — Whether record threads, document annotations (K.B9), and the portal request thread are one system. Blair caught the seam in `request` as a comment target: post-conversion it would fork the conversation between the request shell and the work record.
- **Decision** —
  - **One comments machinery** with DD-016 tiers everywhere. A document comment is a comment on the document with an **anchor** (`version_id`, quote, position) — rendered as a margin marker in the doc panel (K.B9) and in the record thread with a source snippet.
  - **The thread follows the work**: pre-conversion it lives on the request; at conversion, comments **re-parent onto the new matter/contract with tiers preserved** (activity-logged per DD-017); thereafter the portal shell renders the record's thread **filtered to Full Thread**, and requester replies land as Full Thread comments on the record. `request` remains a comment target only for never-converted requests (resolved-in-thread / declined). Legal always replies in exactly one place.
- **Rationale** — One tier model, one notification path, one search surface; redline-week chatter visible from the record; no dual-thread cross-posting.
- **Alternatives considered** — Separate annotation system: two tier implementations, siloed review chatter. Separate post-conversion threads: legal answers in two places.
- **Consequences** — `comments.anchor` jsonb (nullable) in SCHEMA.md; conversion re-parents comment rows; portal thread = tier-projected view (no portal-side table).

## CMT-002 — Thread shape: flat chronological, mentions, no nesting

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — One flat stream per record, chronological, @mentions (DD-016 auto-promote confirmation applies). No nested replies in v1; quoting covers replies.
- **Rationale** — At 2–10 people, nesting fragments short conversations and hides context behind collapse states.
- **Consequences** — `parent_comment_id` deliberately absent from the schema.

## CMT-003 — Tier rendering: badge + strong Legal-Only treatment; segmented composer

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — Every comment carries a tier badge; **Legal Only rows get distinct treatment** (tinted background + the DES-009 lock glyph) so tier is readable peripherally. Composer is a three-segment control preset to the DD-016 contextual default; selecting a tier a Business User can see names the audience explicitly ("visible to Priya Sharma (requester)").
- **Rationale** — The DD-016 failure mode is saying something in the wrong room; that safety must not depend on reading small badge text.
- **Consequences** — DES pattern addition (comment-row treatments + composer segment control) for the design system's component set; copy register per DES-015.

## CMT-004 — Home: activity-bar panel; badge counts your unread, tier-filtered

- **Status** — Accepted; the working default for unread tracking is **confirmed by CMT-009**, which also settles what the count includes
- **Date** — 2026-08-05
- **Decision** — The single comment surface on record screens is the right-rail activity-bar chat slot (J.2) opening the comment panel in DES-007's rail — available beside any tab. **F.7 "Communications" tab and E.6 conversation chip are removed as redundant.** The badge counts the viewer's unread comments **within tiers they can see** — hidden-tier counts never leak to Contributors or Business Users.
- **Rationale** — Conversation belongs beside content, not on a page you navigate to; count leaks would reveal the existence of Legal-Only discussion.
- **Consequences** — Grill-plan J.2 done; F.7 and E.6 resolved as remove; K.B9 done (anchored comments per CMT-001). Unread tracking: `comment_reads` (user_id, comment_id) or last-read-at per record — working default: `comment_last_read` (user_id, entity ref, read_at), **confirmed as the shape by CMT-009**.

## CMT-005 — Post-publish: edit with marker, soft delete, tier immutable

- **Status** — Accepted; the "prior text in the audit log" clause is **amended by CMT-006**; the mechanics are **extended by CMT-008**
- **Date** — 2026-08-05
- **Decision** — Authors edit their own comments (visible "edited" marker; ~~prior text in the audit log per DD-017~~ — **superseded by CMT-006**: prior text lives in `comment_revisions`). Delete is soft: a tombstone keeps thread continuity, ~~text retained in the audit log~~ (**CMT-006**: in `comment_revisions`); Admin hard-redact per the MTR-008/DOC-010 pattern. **Tier is immutable after posting** — wrong room means delete and repost.
- **Rationale** — Widening leaks text written for a narrower room; narrowing hides what a wider room already read. Both are worse than repost.
- **Consequences** — `edited_at`, `deleted_at` on `comments`; no tier-update endpoint.

## CMT-006 — Prior comment text lives in `comment_revisions`, never in an activity payload (amends CMT-005)

- **Status** — Accepted; extended by **CMT-008** on what else a redact takes
- **Date** — 2026-08-13
- **Context** — CMT-005 says two things that cannot both hold. First, prior comment text lives in the audit log. Second, an Administrator can hard-redact a comment. DD-017 forbids `UPDATE` and `DELETE` on `activity_log`; corrections are appended, never applied. Text that enters a payload can therefore never leave it. A redact would remove the comment and leave what it said sitting in the log.
- **Decision** —
  - **No comment text ever enters an activity payload.** Comment activity entries carry ids and metadata only. `comment.posted` carries the comment's id. It rides the comment's own tier, and every later `comment.*` verb does the same.
  - **Prior versions live in `comment_revisions`** — `comment_id`, `body`, `replaced_at`. An edit writes a row there, and so does a soft delete. That table is ordinary application data, so a hard redact purges it along with `comments.body`.
- **Rationale** — Append-only stays absolute. Redaction stays real. Each rule keeps its full strength, because the two now apply to different tables.
- **Consequences** — `comment_revisions` lands with edit and soft delete (M9/4), not before (TECH-014's incremental-schema rule). Every `comment.*` activity payload carries ids only; M9/2 already writes them that way. The M9/6 narration layer renders a comment entry from the comment it names, never from text in the payload. A redacted comment's feed entry therefore reads as a redacted comment, instead of quoting what was removed.

## CMT-007 — Mentions: a list beside plain text, a candidate set the record can reach, and promotion to the narrowest tier

- **Status** — Accepted
- **Date** — 2026-08-13
- **Context** — DD-016 and CMT-002 both say @-mentions auto-promote with confirmation. Neither says who the typeahead offers, what a mention is stored as, or which tier the confirmation proposes. M9/3 (#129) has to answer all three before it can build the surface.
- **Decision** —
  - **The mentioned people are a list, never a substring of prose.** A post names them by id, and each one becomes a `comment_mentions` row keyed on (`comment_id`, `user_id`). Tier promotion reads the list at post time; the M18 notification fan-out reads it later. Neither re-parses a body.
  - **The body stays plain text.** A mention is written into it as `@` and the person's display name, exactly as it would be typed — no markup, no token, no id. A body read anywhere else (an export, a SIEM line, an M18 email) still reads as a sentence. The comment surface draws a chip wherever a name on the list appears in the body; a person renamed since no longer matches, and their `@Old Name` stays as the author typed it, because the record of what was said does not change when somebody changes their name.
  - **The typeahead offers everybody the record can reach, and nobody else.** The candidate set is the DD-016 tier predicate run over people instead of rows: a person belongs when they hear at least one tier on this contract. That is every live Member+ user, whether or not they are on the team (CTR-021 already opens the record to them), plus every Contributor holding a `contract_team` row on it. A Contributor with no row, a Business User, and an archived person are left out.
  - **Mentioning somebody does not put them on the team.** Adding a person to `contract_team` is the act that grants them the record (CTR-021), and a mention is not that act. This is why an off-team Contributor is not offered: a name no tier reaches is exactly the trap the confirmation exists to avoid.
  - **The confirmation offers the narrowest tier that includes everybody named**, and only tiers this author may post at. Never a jump to Full Thread. Confirming posts at the promoted tier; cancelling posts nothing and leaves the composer with its text and its mentions intact.
  - **The seam re-checks and refuses.** A post whose mentions outrun its tier is answered 403 naming the people, whatever the client sent. The confirmation explains the promotion; it never enforces it.
- **Rationale** — A queryable list is what makes promotion and fan-out cheap and exact; parsing prose for names is neither. Plain text keeps the body honest everywhere it is read. Offering only reachable people means the typeahead never produces a mention the product cannot deliver. The narrowest tier is the smallest widening that works, which is what DD-016 asks for.
- **Alternatives considered** — **A markup token in the body** (`@[Name](id)`): exact to render and rename-proof, rejected because every other reader of `comments.body` would then be reading markup. **Offering everybody and refusing on post**: rejected — a name in a list you cannot address is a trap, and the tier confirmation cannot resolve it. **Mention adds to the team**: rejected — that grants record access as a side effect of typing a name.
- **Consequences** — `comment_mentions` lands in M9/3 with (`comment_id`, `user_id`) and nothing else; the comment cascades, the user does not (SET-005). `GET /comments/mention-candidates` answers the candidate set with each person's tiers, so one server-side answer to "who can see what" serves the typeahead, the confirmation, and the refusal. Two display names that are identical cannot be told apart in the body, so both chip; the list still names exactly who was addressed. M18 reads `comment_mentions` for the fan-out and needs no parser.

## CMT-008 — The three corrections: who owns each, what each tombstone says, and what a redact takes (extends CMT-005 and CMT-006)

- **Status** — Accepted
- **Date** — 2026-08-13
- **Context** — CMT-005 names three corrections and their owners: an author edits, an author soft-deletes, an Administrator hard-redacts. CMT-006 says where the prior text lives so a redact can purge it. Neither says what a redact takes besides the text, whether a reader can tell the two tombstones apart, or what an edit does to the list of people the comment addressed (CMT-007). M9/4 (#130) has to answer all three before it can build the surface.
- **Decision** —
  - **A redact and a soft delete are different acts, and the row says which one happened.** `redacted_at` is its own column beside `deleted_at`. Reusing `deleted_at` for both would have an Administrator's removal read as the author taking their own words back, which is a lie about the record. The body is gone by then, so the row is the only place left to read the difference, and the two tombstones carry different sentences.
  - **A redact reaches a comment already soft-deleted**, and that is the case it exists for. A soft delete only moved the text into `comment_revisions`; the redact is what takes it out of there.
  - **A redact takes the mention list with the text.** Who a comment named is part of what was posted into the wrong record, and a chip list for a body that no longer exists says who was addressed by nothing. `comment_mentions` is ordinary application data, so it purges for CMT-006's reason.
  - **An edit changes the text and not who the comment addressed.** The mention list is fixed at post time: it is the record of who was named when the thing was said, and the M18 fan-out has already read it. So the edit route takes a body and nothing else, and the edit box carries no typeahead. Re-addressing somebody means a new comment.
  - **A correction on a comment the viewer is not in the room for answers 404, not 403.** A refusal would tell a Contributor that a Legal Only comment is there. The tier predicate gates the correction routes exactly as it gates the read, and one answer serves both.
  - **An edit or a delete is the author's alone, and the Administrator role does not widen it.** An Administrator may remove what somebody said. They may not put words in their mouth.
- **Rationale** — Each of these is the smallest rule that keeps a promise already made. The separate column keeps the log honest about who acted. Purging the mention list keeps "actually gone" true of the whole post, not just its prose. Freezing the mention list on edit keeps CMT-007's "a mention is a fact about the moment it was said" true. The 404 keeps DD-016's one leak closed on three new routes.
- **Alternatives considered** — **One `deleted_at` for both tombstones**: rejected, it misattributes the act. **An edit that re-validates and rewrites mentions**: rejected — it re-opens the tier-promotion path on a comment whose tier is immutable, and it rewrites history about who was addressed. **403 on a comment the viewer cannot hear**: rejected, it is the leak.
- **Consequences** — `comment_revisions` and `comments.redacted_at` land together in M9/4 (TECH-014). Three routes: `PATCH /comments/{id}`, `DELETE /comments/{id}`, and `POST /comments/{id}/redact`. Each appends its own verb — `comment.edited`, `comment.deleted`, `comment.redacted` — at the comment's own tier, carrying ids only. A second delete or a second redact writes nothing and answers the row as it stands, so a retried request is not a second log entry. The M9/6 narration layer renders a redacted comment's entry as a redacted comment, per CMT-006.

## CMT-009 — The unread count: a watermark per reader per record, and the four things it excludes (confirms CMT-004's working default)

- **Status** — Accepted; the "`contractAudience` gate" clause is **amended by CMT-010** — the gate is the entity-generic comment audience, and the watermark is keyed by the entity pair it answers with
- **Date** — 2026-08-13
- **Context** — CMT-004 says the badge counts the viewer's unread comments within the tiers they can see, and names `comment_last_read` (`user_id`, entity ref, `read_at`) as a working default against a per-comment `comment_reads`. It does not say what "unread" excludes besides a hidden tier, what a reader who has never opened the panel should see, or what act writes the row. M9/5 (#131) has to answer all four before it can draw the badge.
- **Decision** —
  - **`comment_last_read` is the shape**, and the working default is now the decision: one row per reader per record, keyed on (`user_id`, `entity_type`, `entity_id`), carrying `read_at`. A flat chronological thread (CMT-002) is read top to bottom, so a watermark answers the badge in one comparison. A per-comment `comment_reads` table would grow with readers × comments to answer the same question less well.
  - **The count is taken over the filtered set, never the raw one.** It counts comments on the record that pass the DD-016 tier predicate, and it is the same predicate the thread is read at. A count is a leak like any other: a badge reading "3" over a thread showing two would announce the Legal Only comment it left out.
  - **The viewer's own comments are not news.** What you said is not something you have to go and read.
  - **Neither tombstone counts.** A soft-deleted or redacted comment (CMT-008) keeps its place in the thread, but there is nothing left in it to read, and a badge that counted one would send a reader to a tombstone.
  - **No row means everything visible is unread**, not nothing. A reader who has never opened the panel has read none of the conversation, so the absent watermark reads as the beginning of time rather than as "now".
  - **Opening the panel is the act that writes the watermark**, and only when the thread was actually delivered. A panel that failed to load its thread has shown nobody anything; clearing the badge there would take the signal away without delivering what it pointed at. The watermark only moves forward.
- **Rationale** — Each rule keeps the badge honest about the one thing it claims: there is something here for you that you have not read. The tier clause is DD-016's leak closed on a number instead of a row. The two exclusions are what stop the badge sending somebody to their own words or to a tombstone. The never-opened default is the one a reader expects — a record with a conversation on it should announce itself the first time it is seen.
- **Alternatives considered** — **`comment_reads` per comment**: rejected, it costs a row per reader per comment to answer a question a watermark answers exactly. **Counting tombstones**: rejected, the badge would point at nothing. **Treating a missing watermark as zero**: rejected, a record's first conversation would then be silent until somebody opened it for an unrelated reason. **Marking read when the panel opens regardless of the thread loading**: rejected, it clears the signal without delivering the thread.
- **Consequences** — `comment_last_read` lands in M9/5 (TECH-014) with the compound primary key and no tier of its own — the predicate applies to the comments being counted, never to the watermark. Two routes: `GET /comments/unread` answers the badge, and `POST /comments/read` writes the watermark and answers the count that remains, so the badge takes the server's number rather than assuming zero. Both take the same ~~`contractAudience`~~ gate as the thread (**CMT-010**: the entity-generic comment audience, whichever arm resolved it), so a record the viewer cannot reach answers 404, and both key the watermark on the `entity_type` and `entity_id` that gate answered with rather than on a contract id. Chat stays the only applet with a badge (CMT-004); the slot already exists on the applet type. Matters (M22) and documents (M11) mount the same badge on the same table, because the watermark's entity pair is `comments`' own.

## CMT-010 — Audience resolution takes one arm per entity type, and everything downstream takes the answer (extends CMT-001)

- **Status** — Accepted
- **Date** — 2026-08-20
- **Context** — CMT-001 says the thread is one machinery across matters, contracts, documents, and requests. The API shipped it for contracts only, and the contract's shape leaked out of the gate: the routes asserted the entity type to `contract`, and the audience answer carried a **contract id** that the tier filter, the unread count, the `comment_last_read` write, the mention read, and the notification all keyed on. M20's portal needs the same thread on a `request`, whose audience is a different rule over different tables — the Requester plus Member+ staff, with no team table and no confidentiality wall. Adding it as a branch inside each of those five places would put one rule in five hands.
- **Decision** —
  - **The audience is resolved behind one seam, one arm per entity type.** An arm answers exactly three things: the roles that reach a thread of this type at all, this viewer's standing on one record of it, and what a new comment on it raises through the Notifier. Nothing else about the record belongs in it — the `comments` rows are the same rows whichever arm resolved the audience.
  - **The resolved audience carries `entityType`, `entityId`, and the DD-016 tiers, and nothing arm-shaped.** Every filter, count, and write downstream keys on that pair. No route reads a `contract_team` row, a Confidential flag, or a contract id.
  - **The id comes back re-read from the arm's own table**, never taken from the request, so a write cannot land against an id a client made up.
  - **The tier vocabulary (DD-016) and the wall (DD-014) stay inside the seam.** A caller gets the tiers it is in the room for and applies no rule of its own. The contract arm delegates both to the contract's own reach rule, so the thread and the record cannot answer differently about the same person.
  - **The reader-role floor is per arm**, because the roles are not the same: a contract thread is staff-only (CTR-021) and a request thread has to admit the Business User who raised it (DD-013). The route guard is the union across the arms, and the arm refuses per request in the same words, so widening the union for a new arm cannot widen an existing one.
  - **Two refusals, kept apart.** A role that reaches no thread of this type is told plainly (403) — it is a fact about them, not about the record. Everything else is 404 in one sentence, so a record out of reach and a record that was never created read the same. A comment the viewer is not in the room for keeps CMT-008's own 404 sentence: it reads as a comment that is not there.
- **Rationale** — CMT-001's "one machinery" is only true if the thing that differs by entity type is in one place. The arm is that place, and it is small enough to state: an audience rule, a role floor, and a notification. Every leak DD-016 exists to close is closed once, in the seam, rather than once per route with one chance each to drift.
- **Alternatives considered** — **A branch per entity type at each call site**: rejected, it is one rule in five hands and every new record type edits all five. **One audience rule with optional contract fields**: rejected, the contract's tables would still be in the shared shape and a request arm would carry NULLs that mean nothing. **Leaving the notification at the route**: rejected — the events differ by type (a contract comment is NOT-002 group 1 and 2 on the record's roster; a request comment is group 5 at its Requester), so the route would branch on entity type after all.
- **Consequences** — `apps/api/src/modules/comments/audience.ts` holds the seam and the arms; the routes hold no entity-shaped rule. The accepted entity vocabulary is drawn from the arm list, so a type with no arm cannot be asked for and a name added with no arm fails the build. The `comments` table's CHECK stays the wider four, so the correction routes narrow the stored column to a known arm before they ask the seam. The `request` arm is M20's; this record only makes room for it. No behaviour changed for contract threads.

## Index of decisions

| #       | Decision                                                                       | Status                                             |
| ------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| CMT-001 | One comment system; anchored doc comments; thread follows the work             | Accepted (extended by CMT-010)                     |
| CMT-002 | Thread shape: flat chronological, mentions, no nesting                         | Accepted                                           |
| CMT-003 | Tier rendering: badge + strong Legal-Only treatment; segmented composer        | Accepted                                           |
| CMT-004 | Home: activity-bar panel; badge = your unread, tier-filtered                   | Accepted (confirmed by CMT-009)                    |
| CMT-005 | Post-publish: edit with marker, soft delete, tier immutable                    | Accepted (amended by CMT-006, extended by CMT-008) |
| CMT-006 | Prior comment text lives in `comment_revisions`, not the activity log          | Accepted (extended by CMT-008)                     |
| CMT-007 | Mentions: a list beside plain text; reachable candidates; narrowest promotion  | Accepted                                           |
| CMT-008 | The three corrections: owners, two tombstones, and what a redact takes         | Accepted                                           |
| CMT-009 | The unread count: a watermark per reader per record, and what it excludes      | Accepted (amended by CMT-010)                      |
| CMT-010 | Audience resolution takes one arm per entity type; downstream takes the answer | Accepted                                           |
