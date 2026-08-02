# OpenLaw — Intake & Triage Decision Record

Decisions specific to the intake surfaces (ChatOps, web form, email-to-intake), the `Request` entity, and the triage layer that routes Requests into Contracts or Matters.

The high-level intake architecture is fixed by `DECISIONS.md` DD-010: layered intake with ChatOps adapter (Slack v1.5), magic-link form with domain allowlist (v1), and email parser on `intake@` (v1). This file covers the implementation-level decisions that flow from that.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `INT-###`.

## Open questions queued for the next grill-me session

- `Request` entity schema (fields, lifecycle states, relationship to Contract / Matter / Document)
- Triage UI (inbox-like queue? triaged-to dropdown? bulk triage? auto-triage rules)
- Request lifecycle states (New → Triaged → Routed → Resolved → Archived? something simpler?)
- Resolution-in-thread (a Member can answer a question without spawning a Matter — how is that recorded for activity / metrics)
- Auto-classification of incoming requests (NDA vs employment vs M&A — heuristic, ML, or none in v1)
- `ChatAdapter` interface design (auth flow, modal/form rendering contract, message threading, status updates, identity mapping)
- Slack adapter v1 specifics (Slack app type — workspace app vs distributable; bot vs user token; commands and shortcuts)
- Magic-link form mechanics (link TTL, single-use vs reusable, domain-allowlist editor, per-domain submission limits)
- Email parser specifics (subject-line conventions for routing, attachment handling, reply-threading via Message-ID, parse-failure behavior)
- Email transports (IMAP polling cadence, webhook signature verification per provider, SMTP forward authentication)
- Spam / abuse handling on email-to-intake (rate limits, sender allowlist, attachment scanning)
- Identity mapping (how Slack user → email → user record; magic-link email → user record; email-to-intake from address → user record)

---

_No decisions recorded yet. Run `/grill-me` and ask to design the Intake / Triage module._

## Index of decisions

| # | Decision | Status |
|---|---|---|
