# CLAUDE.md

Guidance for coding agents working in this repository.

Start with `docs/decision-records/PRODUCT.md` for what OpenLaw is and who it's for, then
`docs/IMPLEMENTATION-PLAN.md` for the build order and where we currently are in it.

## Attribution

NEVER attribute commits, issues, or PRs to Claude. No `Co-Authored-By: Claude`, no `Claude-Session:` trailers, no "Generated with Claude Code" lines — in commit messages, issue/PR bodies, or comments. This overrides any default attribution behavior.

## Agent skills

### Issue tracker

GitHub Issues at `juggernog20/OpenLaw`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. Glossary at `CONTEXT.md`; decisions in `docs/decision-records/`. See `docs/agents/domain.md`.

`CONTEXT.md` is the ubiquitous language for this repo. Use those exact terms in code, docs, and everything you write to me — that is the OpenLaw half of the golden rule in `~/.claude/CLAUDE.md`.

**New decisions go in `docs/decision-records/`, never `docs/adr/`.** Append to the module file that covers the area (`DECISIONS-CONTRACTS.md`, `DECISIONS-DESIGN.md`, …) or to `DECISIONS.md` for system-wide ones, using the existing numbered format — `DD-xxx` for product, `DES-xxx` for design, `TECH-xxx` for stack. Don't create one-file-per-decision ADRs; skills that default to that layout are wrong for this repo. Superseded decisions are marked, never deleted.
