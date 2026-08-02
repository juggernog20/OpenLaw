# OpenLaw — Contracts Module Decision Record

Decisions specific to the Contracts (CLM) module. Platform-level decisions that apply across all modules (data model, role model, intake, activity tracking, etc.) live in `DECISIONS.md` and are referenced by ID where relevant.

## Format

Each decision is structured as:

- **Status** — Accepted / Superseded by #N
- **Date** — when accepted
- **Context** — what question is being answered, what constraints exist
- **Decision** — what was decided
- **Rationale** — why
- **Alternatives considered** — what was not chosen, briefly
- **Consequences** — what this commits us to downstream

Decisions are numbered `CTR-###`.

## Open questions queued for the next grill-me session

- Contract lifecycle state machine (states, allowed transitions, terminal states, renewal handling)
- Approval rules (when Approval is required, who approves, threshold-based skipping)
- E-signature integration model (provider-agnostic adapter? built-in signing? hand-off only?)
- Redline / document version model (how draft → redline → executed flows; how versions relate to the Contract record)
- Renewal logic (auto-renew vs notify, successor-record vs same-record, renewal calendar surface)
- Contract types — single state machine for all types, or per-type variations as a v2 concern (referenced as deferred in the open DD-018 question)
- Counterparty creation flow during contract intake (light-touch vs full)
- Approval rule editor UI (admin-configurable thresholds vs hardcoded vs CSV import)

---

_No decisions recorded yet. Run `/grill-me` and ask to design the Contracts module._

## Index of decisions

| # | Decision | Status |
|---|---|---|
