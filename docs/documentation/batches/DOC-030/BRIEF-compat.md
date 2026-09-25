# DOC-030 brief: compatibility reviewer seat

You are a compatibility reviewer in the DOC-030 batch (issue #1157). Your seat name
is `DOC-030 compatibility reviewer (<set>)`. You carry guides whose text did not
change since DOC-029 to the pinned build, by proving that nothing they say became
wrong, or by walking them again when the triage says the app moved under them.

## Where you work

- Worktree root: `/home/blairwentworth/.cache/openlaw-worktrees/doc030`. Never
  touch `/home/blairwentworth/projects/OpenLaw`.
- Pinned app commit `067c1646829df85e62b809ee9157921e867c84e7`, application
  digest `34696f7630914abb33db524b3ae30eb4a89416460e5f2fe8df46457aa26f3c0d`.
- Your articles come from `docs/documentation/batches/DOC-030/triage.json`
  (`candidates`), filtered to the set named in your prompt. Each has a `decision`
  of `compat` or `rewalk`, the files inspected, the reason and a replay script if
  DOC-029 left one.
- The labs are described in `BRIEF-walkthrough.md` (same folder); the rules for
  sharing the `work` lab apply to you too. Pass the seed password only through
  `LAB_PASSWORD`.
- Rules for records are in `docs/documentation/PUBLISHING.md`, section "Editions
  and publication states". Read the DOC-029 examples:
  `docs/documentation/batches/DOC-029/compat-r2/contracts-a.json` (group review with
  replayed script) and `docs/documentation/evidence/contract-stages.json` (the
  article record that points at it).

## What to do for each article

1. Read the guide and its evidence record. Run your own
   `git diff <priorAppCommit>..HEAD -- <the record's sources and the triage's
inspected files>`. Do not take the triage decision on trust; open the code.
2. If a DOC-029 replay script exists (`replayScript`), run it against the `work`
   lab (`LAB_APP_URL`, `LAB_MAIL_URL`, `LAB_PASSWORD`). Adapt only addresses,
   fixture names and the log path; write the adapted copy to
   `docs/documentation/batches/DOC-030/compat/<article>-replay.mjs` with its
   `-replay.json` log. A step that fails on the new build is a behavior change:
   treat the article as `rewalk`.
3. `compat` outcome: write the review entry and update the evidence record's
   `compatibilityReview` block with `fromAppCommit` (the record's `appCommit`),
   `toAppCommit` (pinned), `contentSha256` (the record's), `applicationSha256`
   (pinned digest), `reviewer` (your seat name), `reviewerKind` `agent`,
   `reviewedAt` (ISO UTC, after `verifiedAt`), a `summary` that names the diff
   files you inspected and why no statement changed, and `evidence` entries whose
   `path` is relative to `docs/documentation` with the file's `sha256`. If the
   record already carries a compatibility review from DOC-029, fold its summary
   into yours (as DOC-029 round 3 did) and keep its evidence entries. Leave every
   other field of the record unchanged.
4. `rewalk` outcome: follow `BRIEF-walkthrough.md` for that article (script, log,
   new evidence record with the pinned `appCommit`, `previousEvidence` set from
   the old record, `compatibilityReview` `null`). The `walkthroughReviewer` must
   be your seat name and must differ from the record's `author`.
5. A `live-provider-check` method (configure-signing) cannot be replayed with a
   stand-in. If the signing diff changes behavior the guide describes, stop and
   report; the batch owner arranges the live account. If it does not, say exactly
   which diff hunks you read and why the DOC-029 live observation still applies.

## Your record

Write `docs/documentation/batches/DOC-030/compat/<set>.json` with the shape of the
DOC-029 round 2 group file: `kind` "article-compatibility-review", `task`,
`set`, `reviewer`, `reviewerKind`, `independence` (say you wrote none of these
guides or their DOC-029 scripts), `reviewedAt`, `fromAppCommit` per article,
`toAppCommit`, `applicationSha256`, `appDiffCommand`, `appDiffFiles`, and
`articles[]` with `articleId`, `decision`, `inspectedFiles`, `replay` (path and
outcome or null), `summary`, `outcome` (`compatible` or `rewalked`).

Then run from the worktree root:

```sh
node scripts/documentation/status.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const a of JSON.parse(s).articles.filter(a=><YOUR IDS>.includes(a.id)))console.log(a.id,a.pass,a.error||'')})"
```

Every article in your set must print `true`. Do not edit the compiler, the
scenario registry or the catalog.

## When you finish

Reply with, per article: `compatible` or `rewalked`, the replay result, and any
behavior change you found that the guide does not describe. Keep it under 300
words.
