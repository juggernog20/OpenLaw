# DOC-032 brief: app-diff triage seat

You are the triage agent for the DOC-032 batch (issue #1194). Your seat name is
`DOC-032 app-diff triage agent`. You decide which guides can carry a
compatibility review to the new pinned build and which need a fresh walkthrough.
You also map the app changes to every guide, so the other seats know where to
look. You do not edit any guide.

## Where you work

- Worktree root: `/home/blairwentworth/.cache/openlaw-worktrees/docs-edition`.
  Never touch `/home/blairwentworth/projects/OpenLaw`.
- New pinned app commit: `4ca41822b685a2a1e58a38b4f25e421cf735c54e` (HEAD).
  Application digest `e55f16c19344144766f5fc92f0f417fa5d222d657a150f4db1836d9e37f76385`.
- The edition currently pins `067c1646829df85e62b809ee9157921e867c84e7` (DOC-030).
- Read `docs/documentation/batches/DOC-030/README.md` and
  `docs/documentation/batches/DOC-030/triage.json` for the method and record
  shape used last time.
- Do not run `pnpm install`, builds, tests, labs or Docker. No state-changing git
  commands. `git log`, `git diff` and `git show` are fine.

## The guides

Run `node scripts/documentation/status.mjs` once to see the current state.

- 52 guides have evidence at `067c1646`. Six more (contract-stages,
  contract-relations-and-ending, matter-status-and-archive, document-previews,
  compare-versions, versions-and-support) have evidence at `3fa407e3` with a
  compatibility review to `067c1646`. Compare those six from `3fa407e3`.
- Eight guides were edited after their walkthrough, so they get a fresh source
  review and walkthrough regardless: contract-approvals, document-versions,
  first-run, organisation-and-users, authentication-and-email, configure-mcp,
  connect-headless-client and connect-claude.
- electronic-signing and configure-signing carry `blocked` evidence at
  `648f99ec` from #1178 (live DocuSign acceptance pending owner credentials).
  connect-chatgpt and connect-microsoft-365-copilot have no evidence (DOC-031,
  #1187). Do not decide these four; list the app changes that touch them, so
  the batch README can say what the next live session must cover.

## What to do

1. List the application diff: `git diff --name-only <from>..HEAD -- apps packages
styles` and `git log --oneline --no-merges <from>..HEAD -- apps packages styles`
   for `<from>` = `067c1646…`, `3fa407e3a846559914aa1a63249741f30cfb4f69` and
   `648f99ec18c4d43882a2db32368f46b5f09d21a6`. Ignore test files when judging
   behavior, but list them.
2. Group the changed files by product area. For each area, read the merge
   commits' PR titles and the relevant decision records, and say in one or two
   sentences what changed for a user or operator. Known themes: M42 MCP
   resources, prompts, listen streams, Team and Administration Tools; the DocuSign
   preparation rework (#1170 to #1178), partially signed rounds; owner fields on
   the Contract and Matter records; Document type colours; deleting one Document
   Version; officer names from the user list; the Entity Contracts and Matters
   table; Auto-Doc field and rule editing; multiple SSO identity providers; the
   setup token validation; AI model selector; authentication options; the
   persona rename (seed bootstrap Administrator is now Devon Calloway,
   `devon@helix.example`); dependency upgrades.
3. For each of the 50 guides that are not in the lists above, read the guide and
   its evidence record's `sources`, then decide:
   - `compat`: no statement in the guide can have become wrong. Name the diff
     files you inspected and why they do not affect it. Name the DOC-030 script
     that a reviewer can replay on the new lab (the evidence record's scenario
     `evidence` paths point at it), or null.
   - `rewalk`: a change touches behavior the guide describes. Name the change,
     the affected claim and the scenario roles that must be walked again.
     Open the code for anything you are unsure about. When in doubt, choose
     `rewalk`.
4. For each of the eight edited guides, and every guide you mark `rewalk`, list
   the app changes since its recorded `appCommit` that the author and the walker
   must expect: the PR or commit, the file, and the user-visible change in one
   sentence. Also list which commit edited the guide text and what it added.
5. Propose article groups for the rewalk work (roughly four to six guides that
   share a lab setup and source area per group), as `proposedGroups`.

## Your record

Write `docs/documentation/batches/DOC-032/triage.json` with:

- `kind` "app-diff-triage", `task` "DOC-032", `issue` 1194, `reviewer`,
  `reviewerKind` "agent", `independence`, `reviewedAt`, `fromAppCommits`,
  `toAppCommit`, `applicationSha256`, `commands` (the git commands you ran).
- `areas[]`: `area`, `files[]`, `commits[]`, `userVisibleChange`.
- `candidates[]`: `articleId`, `decision` (`compat` or `rewalk`), `fromAppCommit`,
  `inspectedFiles[]`, `reason`, `affectedClaims[]` (for rewalk), `rolesToWalk[]`,
  `replayScript` (path or null).
- `groupArticles[]`: `articleId`, `group`, `fromAppCommit`, `guideEdits[]`,
  `expectedChanges[]` (`pr`, `file`, `change`).
- `blockedArticles[]`: the four live-provider guides, with the app changes that
  touch them.
- `proposedGroups`: `{ "<group>": ["<articleId>", …] }`.

Format it with `pnpm exec prettier --write` on the file.

## When you finish

Reply with the count of `compat` and `rewalk` decisions, the list of `rewalk`
articles with a one-line reason each, the proposed groups, and any area where
you could not tell what changed from the code. Keep it under 400 words.
