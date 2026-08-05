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

- **Status** — Accepted
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

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — The single comment surface on record screens is the right-rail activity-bar chat slot (J.2) opening the comment panel in DES-007's rail — available beside any tab. **F.7 "Communications" tab and E.6 conversation chip are removed as redundant.** The badge counts the viewer's unread comments **within tiers they can see** — hidden-tier counts never leak to Contributors or Business Users.
- **Rationale** — Conversation belongs beside content, not on a page you navigate to; count leaks would reveal the existence of Legal-Only discussion.
- **Consequences** — Grill-plan J.2 done; F.7 and E.6 resolved as remove; K.B9 done (anchored comments per CMT-001). Unread tracking: `comment_reads` (user_id, comment_id) or last-read-at per record — working default: `comment_last_read` (user_id, entity ref, read_at).

## CMT-005 — Post-publish: edit with marker, soft delete, tier immutable

- **Status** — Accepted
- **Date** — 2026-08-05
- **Decision** — Authors edit their own comments (visible "edited" marker; prior text in the audit log per DD-017). Delete is soft: a tombstone keeps thread continuity, text retained in the audit log; Admin hard-redact per the MTR-008/DOC-010 pattern. **Tier is immutable after posting** — wrong room means delete and repost.
- **Rationale** — Widening leaks text written for a narrower room; narrowing hides what a wider room already read. Both are worse than repost.
- **Consequences** — `edited_at`, `deleted_at` on `comments`; no tier-update endpoint.

## Index of decisions

| # | Decision | Status |
|---|---|---|
| CMT-001 | One comment system; anchored doc comments; thread follows the work | Accepted |
| CMT-002 | Thread shape: flat chronological, mentions, no nesting | Accepted |
| CMT-003 | Tier rendering: badge + strong Legal-Only treatment; segmented composer | Accepted |
| CMT-004 | Home: activity-bar panel; badge = your unread, tier-filtered | Accepted |
| CMT-005 | Post-publish: edit with marker, soft delete, tier immutable | Accepted |
