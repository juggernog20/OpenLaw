# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**: one glossary, one shared vocabulary across `apps/*` and `packages/*`.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the domain glossary.
- **`docs/decision-records/`** — this repo's ADRs. They are **not** one-file-per-decision under `docs/adr/`. Decisions are grouped into per-module files, each holding many numbered entries:

  | File                                                                                                                                                         | Scope                    | ID prefix  |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ---------- |
  | `DECISIONS.md`                                                                                                                                               | System-wide              | `DD-xxx`   |
  | `DECISIONS-CONTRACTS.md`, `-MATTERS.md`, `-DOCUMENTS.md`, `-ENTITIES.md`, `-INTAKE.md`, `-KNOWLEDGE.md`, `-COMMENTS.md`, `-NOTIFICATIONS.md`, `-SETTINGS.md` | Per product module       | `DD-xxx`   |
  | `DECISIONS-DESIGN.md`                                                                                                                                        | Frontend design system   | `DES-xxx`  |
  | `DECISIONS-TECH-STACK.md`                                                                                                                                    | Stack and infrastructure | `TECH-xxx` |

  Read the module file covering the area you're about to work in, plus `DECISIONS.md`.

- **`docs/decision-records/PRODUCT.md`** — what OpenLaw is, who it's for, and what is explicitly out of scope.
- **`docs/decision-records/SCHEMA.md`** — naming and relationship reference for data entities. It describes the intended end state, not what exists.
- **`docs/decision-records/FUTURE-FEATURES.md`** — deliberately deferred work.

Superseded decisions are kept and marked rather than deleted. Check a decision's **Status** before relying on it.

If `CONTEXT.md` doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The producer skill (`/grill-with-docs`) creates it lazily when terms actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

Two distinctions in this domain are load-bearing and easy to get wrong:

- An **Entity** is one of our own corporate entities (a subsidiary), never a counterparty.
- A **Request** is the pre-triage intake object, distinct from the Contract or Matter it later becomes.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag decision conflicts

If your output contradicts an accepted decision, surface it by ID rather than silently overriding:

> _Contradicts DD-008 (counterparties are tracked separately from Entities) — but worth reopening because…_
