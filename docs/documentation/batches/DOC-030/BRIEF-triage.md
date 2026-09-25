# DOC-030 brief: app-diff triage seat

You are the triage agent for the DOC-030 batch (issue #1157). Your seat name is
`DOC-030 app-diff triage agent`. You decide which unchanged guides can carry a
compatibility review to the pinned build and which need a fresh walkthrough. You
also map the app changes to every guide so the walkthrough agents know where to
look. You do not edit any guide.

## Where you work

- Worktree root: `/home/blairwentworth/.cache/openlaw-worktrees/doc030`. Never
  touch `/home/blairwentworth/projects/OpenLaw`.
- Pinned app commit: `067c1646829df85e62b809ee9157921e867c84e7` (HEAD). The
  edition currently pins `432dba3a835863091791fbac429a6a66777bdc40`.
- `docs/documentation/batches/DOC-030/plan.json` lists the 19 groups of guides that
  get a fresh walkthrough regardless (`groups`) and the 23 guides whose content hash
  still matches their evidence (`compatibilityCandidates`). Each candidate records
  its prior `appCommit`; some are `3fa407e3…` with a round 2 and round 3 review on
  top, so compare from that recorded commit, not only from `432dba3a`.
- Read `docs/documentation/batches/DOC-029/compat-r2/contracts-a.json` and
  `docs/documentation/batches/DOC-029/compat-r3/review.json` for the method and
  record shape used last time.
- Do not run `pnpm install`, builds, tests, labs or Docker. No state-changing git
  commands. `git log`, `git diff`, `git show` are fine.

## What to do

1. List the application diff: `git diff --name-only <from>..HEAD -- apps packages
styles` and `git log --oneline --no-merges <from>..HEAD -- apps packages styles`
   for `<from>` = `432dba3a…` and, separately, for `3fa407e3a846559914aa1a63249741f30cfb4f69`.
   Ignore test files when judging behavior, but list them.
2. Group the changed files by product area (sign-in and accounts, Home and search,
   Inbox and Requests, Contracts, Matters, Documents, Entities, Knowledge, comments
   and notifications, email layout, MCP and API keys, OAuth Clients, settings and
   first-run, deployment and compose, worker and pipeline). For each area, read the
   merge commits' PR titles and the relevant decision records so you can say in one
   or two sentences what changed for a user or operator.
3. For each of the 23 compatibility candidates, read the guide and its evidence
   record's `sources`, then decide:
   - `compat`: no statement in the guide can have become wrong. Name the diff files
     you inspected for it and why they do not affect it. Say whether a DOC-029
     walkthrough script exists for it (`priorEvidence.scriptEvidence` in plan.json)
     that a reviewer can replay on the new lab.
   - `rewalk`: a change touches behavior the guide describes. Name the change, the
     affected claim and the scenario roles that must be walked again.
     Open the code for anything you are unsure about. When in doubt, choose `rewalk`.
4. For each of the 39 group articles, list the app changes since its recorded
   `appCommit` that a walkthrough agent must expect: the PR, the file, and the
   user-visible change in one sentence.

## Your record

Write `docs/documentation/batches/DOC-030/triage.json` with:

- `kind` "app-diff-triage", `task` "DOC-030", `reviewer`, `reviewerKind` "agent",
  `reviewedAt`, `fromAppCommits` (both), `toAppCommit`, `applicationSha256`
  `34696f7630914abb33db524b3ae30eb4a89416460e5f2fe8df46457aa26f3c0d`,
  `commands` (the git commands you ran).
- `areas[]`: `area`, `files[]`, `commits[]`, `userVisibleChange`.
- `candidates[]`: `articleId`, `decision` (`compat` or `rewalk`), `fromAppCommit`,
  `inspectedFiles[]`, `reason`, `affectedClaims[]` (for rewalk), `rolesToWalk[]`,
  `replayScript` (path or null).
- `groupArticles[]`: `articleId`, `group`, `expectedChanges[]` (`pr`, `file`,
  `change`).

## When you finish

Reply with the count of `compat` and `rewalk` decisions, the list of `rewalk`
articles with a one-line reason each, and any area where you could not tell what
changed from the code. Keep it under 300 words.
