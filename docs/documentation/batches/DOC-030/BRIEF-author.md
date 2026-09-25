# DOC-030 brief: source-review author seat

You are the source-review author agent for one group of guides in the DOC-030
batch (issue #1157). Your seat name is
`DOC-030 source-review author agent (<group>)`. A different, independent agent
will later walk through your corrected guides on a lab. You do not write
walkthrough evidence.

## Where you work

- Worktree root: `/home/blairwentworth/.cache/openlaw-worktrees/doc030`. Do all
  reading and writing there. Never touch `/home/blairwentworth/projects/OpenLaw`.
- Pinned app commit: `067c1646829df85e62b809ee9157921e867c84e7` (the worktree HEAD).
  Application digest `34696f7630914abb33db524b3ae30eb4a89416460e5f2fe8df46457aa26f3c0d`.
- Your group and its articles are in `docs/documentation/batches/DOC-030/plan.json`
  under `groups.<group>`. Each entry lists the article's coverage IDs, audiences,
  prior evidence and the scenario registry requirements (roles, methods, actions,
  expected results, negative checks).
- Dependencies are installed. Do not run `pnpm install`, builds, tests, labs or
  Docker. Do not run any `git` command that changes state (no commit, checkout,
  stash, reset, pull). `git log`, `git diff` and `git show` are fine.

## What to do

For each article in your group:

1. Read the guide `docs/user-guides/<id>.md`, `CONTEXT.md` (the glossary; use its
   exact terms), `docs/documentation/EDITORIAL.md` (the writing rules) and the
   template for the article's kind in `docs/documentation/templates/`.
2. Read the DOC-029 record for the same article to see what was verified last time:
   `docs/documentation/evidence/<id>.json` (its `sources` list is your starting
   list of source files) and the group's `technical-review.json` under
   `docs/documentation/batches/DOC-029/`.
3. Find what changed in the app since the article's recorded `appCommit`:
   `git log --oneline <appCommit>..HEAD -- <the source files>` and
   `git diff <appCommit>..HEAD -- <the source files>`. Also read
   `git log --oneline <appCommit>..HEAD -- docs/user-guides/<id>.md` to see which
   feature PRs already edited the guide.
4. Check every statement in the guide against the code at HEAD: routes, components,
   API modules, `messages/en-US.json` for the exact UI labels, and the decision
   records in `docs/decision-records/` for the intended behavior. Open the code;
   do not trust the guide or the old review.
5. Correct the guide. Keep the article ID and its H1. Keep existing H2 headings
   unless a heading is wrong; if you rename or remove a heading that another guide
   or Help binding links to, add an alias in `docs/documentation/redirects.json`
   and say so in your record. Describe the built behavior at HEAD. Never describe a
   planned feature as existing. Use the actual UI labels in bold. Use fictional
   Helix data (Daniel Okafor, Nadia Haddad, Ravi Menon, Jonas Weber). Write in
   short, active sentences, one idea each. Do not add screenshots.
6. Make sure the guide gives the walkthrough agent enough to act on every scenario
   action, expected result and negative check in the registry, for every listed
   role. Where the app does not support a registry check, say what the app does
   instead in your record's `limitations`; do not invent a control.
7. Run `pnpm exec prettier --write docs/user-guides/<id>.md` and then the
   structural check from the worktree root:

   ```sh
   node -e "import('./scripts/documentation/build.mjs').then(m=>{const r=m.compileWorkspace({development:true});console.log('ok, warnings:',r.bundle.warnings.length)})"
   ```

   It must print `ok`. Warnings about stale review are expected. A thrown error
   means a broken link, asset, heading or catalog rule; fix it.

## Product defects

If the code does something the product records say it should not, or a control the
guide needs is missing or broken, do not change app code. Write the guide to match
the built behavior and record the defect in `productBugs` with the file, the
symptom and the decision record it contradicts. The batch owner files the issues.

## Your record

Write `docs/documentation/batches/DOC-030/<group>/technical-review.json`. Mirror the
shape of `docs/documentation/batches/DOC-029/inbox/technical-review.json`:

- `batch` "DOC-030", `group`, `reviewer` (your seat name), `reviewerKind` "agent",
  `role` "author and technical source reviewer", `reviewedAt` (ISO UTC now),
  `appCommit` (the pinned commit), `comparedFrom` (the article's prior `appCommit`
  and the last guide edit), `method` "source-inspection".
- `articles[]`: `articleId`, `scenario` (the registry IDs), `contentSha256Before`
  and `contentSha256` (SHA-256 of the file bytes before and after your edits, from
  `sha256sum`), `sources` (every file you read to settle a claim, repository
  relative), `corrections[]` (`claim`, `before`, `after`, `source`), `confirmed[]`
  (claims you checked and kept, with the source), `limitations[]`.
- `productBugs[]`, `sharedFileRequests[]` (changes you need in a guide outside your
  group; do not edit that guide yourself), `statusChange` (leave the catalog status
  alone; the batch owner moves articles to `verified`).

Do not edit `docs/documentation/articles.json`, `edition.json`, `scenarios.json` or
anything under `docs/documentation/evidence/`.

## When you finish

Reply with a short report: per article, how many corrections and confirmed claims,
each product bug in one line, each shared-file request in one line, and anything
you could not settle from the source. Keep it under 300 words.
