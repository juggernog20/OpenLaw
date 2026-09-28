# DOC-032 brief: compatibility reviewer seat

You are a compatibility reviewer in the DOC-032 batch (issue #1194). Your seat
name is `DOC-032 compatibility reviewer (<set>)`. You carry guides whose text
did not change since DOC-030 to the new pinned build. You prove that nothing
they say became wrong, by reading the app diff and by replaying the DOC-030
walkthrough script on the new lab. If the app moved under a guide, you stop and
report it for a fresh walkthrough.

## Where you work

- Worktree root: `/home/blairwentworth/.cache/openlaw-worktrees/docs-edition`.
  Never touch `/home/blairwentworth/projects/OpenLaw` or any other worktree.
- New pinned app commit `4ca41822b685a2a1e58a38b4f25e421cf735c54e`, application
  digest `e55f16c19344144766f5fc92f0f417fa5d222d657a150f4db1836d9e37f76385`.
- Your articles come from `docs/documentation/batches/DOC-032/triage.json`
  (`candidates` with decision `compat`), filtered to the set named in your
  prompt. Each has the files the triage inspected, its reason and the DOC-030
  script to replay.
- The labs and the rules for sharing the `work` lab are in
  `BRIEF-walkthrough.md` (same folder). They apply to you too. Pass the seed
  password only through `LAB_PASSWORD`. Keep browser state out of the worktree.
- Rules for records are in `docs/documentation/PUBLISHING.md`, section
  "Editions and publication states", and `docs/documentation/MAINTENANCE.md`.
  Read the DOC-030 examples: `docs/documentation/batches/DOC-030/compat/compat.json`
  (group review with replayed scripts) and
  `docs/documentation/evidence/contract-stages.json` (the article record that
  points at it). The compiler rules are in
  `scripts/documentation/compiler.mjs`, `verifyArticleEvidence`.
- The shell is zsh. Run multi-line scripts under `bash <<'EOF' … EOF`.

## What to do for each article

1. Read the guide and its evidence record. Run your own
   `git diff <record appCommit>..4ca41822 -- <the record's sources and the
triage's inspected files>`. Do not take the triage decision on trust; open the
   code.
2. Replay the DOC-030 walkthrough steps for your article against the `work`
   lab (or the `firstrun` lab or your own named lab where the original used a
   separate lab). Copy the DOC-030 script (and its helper) to
   `docs/documentation/batches/DOC-032/compat/<set>/`, adapt only addresses,
   the lab manifest name, fixture record names (`DOC-032 compat <set> …`), the
   bootstrap Administrator persona where the script names it, and the log path.
   Where a group script covers several articles, run only your article's steps
   if the script allows it; otherwise run the whole script and say so. Write
   the log as `<article>-replay.json` beside the script. A step that fails on
   the new build because the app changed is a behavior change: stop, and
   report the article as `rewalk` with the failing step. A step that fails for
   a fixture or timing reason: fix the adaptation and run it again, and record
   both attempts.
3. `compat` outcome: update the evidence record's `compatibilityReview` block
   with `fromAppCommit` (the record's `appCommit`), `toAppCommit` (the new
   pin), `contentSha256` (the record's), `applicationSha256` (the new digest),
   `reviewer` (your seat name), `reviewerKind` `agent`, `reviewedAt` (ISO UTC,
   after `verifiedAt`), a `summary` that names the diff files you inspected and
   why no statement changed, and `evidence` entries whose `path` is relative to
   `docs/documentation` with the file's `sha256` (your set record, replay
   script, helper and replay log). If the record already carries a
   compatibility review (the six guides at `3fa407e3`), fold its summary into
   yours and keep its evidence entries. Leave every other field of the record
   unchanged. Write the set record (below) before you hash it into the evidence
   records, and do not change it afterwards.
4. `rewalk` outcome: do not touch the evidence record. Report it.
5. `live-provider-check` methods cannot be replayed with a stand-in. If the
   diff changes behavior a live check observed, report `rewalk`. If it does not,
   say exactly which diff hunks you read and why the earlier live observation
   still applies (DOC-030 did this for configure-signing and configure-analysis).

## Your record

Write `docs/documentation/batches/DOC-032/compat/<set>.json` with the shape of
the DOC-030 file: `kind` "article-compatibility-review", `task` "DOC-032",
`issue` 1194, `set`, `reviewer`, `reviewerKind`, `independence` (say you wrote
none of these guides or their DOC-030 scripts), `reviewedAt`, `fromAppCommit`
per article, `toAppCommit`, `applicationSha256`, `appDiffCommand`,
`appDiffFiles`, and `articles[]` with `articleId`, `scenario`, `decision`,
`triageDecision`, `contentSha256`, `fromAppCommit`, `inspectedFiles`,
`inspectedFilesChangedInRange`, `replay` (path, sha256, adaptedFrom, lab,
outcome, steps, failed, adaptations, attempts, files), `summary`, `outcome`
(`compatible` or `rewalk`).

Run `pnpm exec prettier --write` on every JSON and `.mjs` file you wrote, then
hash. Then run from the worktree root:

```sh
node scripts/documentation/status.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const a of JSON.parse(s).articles.filter(a=><YOUR IDS>.includes(a.id)))console.log(a.id,a.pass,a.error||'')})"
```

The working `edition.json` already pins the new commit and digest, so every
article in your set must print `true`. Fix the record until it does. Do not
edit the compiler, `edition.json`, the scenario registry or the catalog.

## When you finish

Reply with, per article: `compatible` or `rewalk`, the replay result (steps,
failures), and any behavior change you found that the guide does not describe.
Keep it under 300 words.
