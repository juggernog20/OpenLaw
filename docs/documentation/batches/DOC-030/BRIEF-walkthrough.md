# DOC-030 brief: independent walkthrough seat

You are the independent walkthrough agent for one group of guides in the DOC-030
batch (issue #1157). Your seat name is
`DOC-030 independent walkthrough agent (<group>)`. A different agent, the
source-review author, corrected these guides from the code. You did not write them
and you must not change their text. You follow each guide as a reader would, in
a browser, on a lab built from the pinned commit, and you record what happened.

## Where you work

- Worktree root: `/home/blairwentworth/.cache/openlaw-worktrees/doc030`. Never
  touch `/home/blairwentworth/projects/OpenLaw`.
- Pinned app commit `067c1646829df85e62b809ee9157921e867c84e7`, application
  digest `34696f7630914abb33db524b3ae30eb4a89416460e5f2fe8df46457aa26f3c0d`.
- Your group in `docs/documentation/batches/DOC-030/plan.json` under
  `groups.<group>` lists each article's scenario requirements: every `roles` ×
  `requiredMethods` pair needs its own recorded outcome, including the negative
  checks. The author's `docs/documentation/batches/DOC-030/<group>/technical-review.json`
  lists `limitations` where the app does not support a registry check; confirm
  or refute them on the lab.
- `docs/documentation/batches/DOC-030/triage.json` (`groupArticles`) lists the app
  changes since the article's last walkthrough. Expect them; do not trust them.
- Dependencies are installed. Do not run `pnpm install` or any state-changing
  `git` command. Do not build images. Do not run the shared E2E suite.

## The labs

Both labs were created with `scripts/documentation/lab.mjs` from the pinned
commit. Read `.documentation-labs/<name>/lab.json` for the exact project name,
image IDs and seed timestamps; record them in your evidence.

| Lab         | App                    | Mailpit                | State                                    |
| ----------- | ---------------------- | ---------------------- | ---------------------------------------- |
| `work2`     | http://127.0.0.1:43300 | http://127.0.0.1:48425 | Helix seed, light profile, random seed 7 |
| `firstrun2` | http://127.0.0.1:43301 | http://127.0.0.1:48426 | Empty; for the first-run guide only      |

Accounts and roles are in `docs/documentation/VALIDATION.md` ("Repeatable
fictional data and accounts"). Pass the seed demo password through the
environment variable `LAB_PASSWORD` only; never write it, a magic link, a cookie
or a raw mail message into any file under `docs/`. Business Users sign in with a
fresh magic link read from the lab's Mailpit API.

The `work2` lab is shared with other walkthrough agents running at the same time.
Create your own records, named `DOC-030 <group> <scenario> <timestamp>`, for every
mutating step. Do not archive, delete or reconfigure seeded records or
organization settings that another guide depends on; when a guide's step needs an
organization-wide setting, set it, run the step, and put it back. Never stop,
restart or reconfigure the lab containers. If a guide needs its own deployment
(operator, authentication, LAN or public profile), create a separate named lab
with free ports: `node scripts/documentation/lab.mjs create <name> --commit
067c1646829df85e62b809ee9157921e867c84e7 --app-port <p> --mail-port <q>`, then
`up`, and `destroy` it when you finish. Record its name.

## How to walk through

Write a Playwright script, one per group, at
`docs/documentation/batches/DOC-030/<group>/walkthrough.mjs`, from the guide's
own steps. Copy the pattern of `docs/documentation/batches/DOC-029/<group>/walkthrough-r1.mjs`
and its `api.mjs` helper (sign-in, Mailpit polling, per-identity browser
contexts). Playwright and Chromium are available at
`node_modules/.pnpm/playwright@1.63.0/node_modules/playwright` in the worktree.
Use one isolated browser context per identity. Use API sessions
(`scripts/seed/client.mjs`) only for fixture setup, a second actor's competing
write, and state reads. Every guide step runs in the browser as the named role.

For each scenario, role and method:

- Follow the guide's steps in order, using the labels it names. If a label or
  control is not there, that is a failure of the guide, not something to work
  around. Record the exact text you saw.
- Check every expected result and every negative check from the registry, and
  the guide's "Check the result" and "If it does not work" sections.
- Record each step with its time, the page, the action, and the observation in
  the script's JSON log, `docs/documentation/batches/DOC-030/<group>/walkthrough.json`.
  Save screenshots only where text is not enough, as PNGs beside the log, with
  fictional data only.
- `container-operation` and `live-provider-check` methods have their own rules in
  the group prompt. A stand-in never satisfies a live-provider check.

When a step fails because the guide is wrong, stop that scenario, record the
failure, and reply with the failing step and the observed behavior so the author
can correct the guide. Do not edit the guide. When a step fails because the app is
broken, record it under `productBugs` with the reproduction and carry on with the
next independent step.

## Your evidence record

For each article that passed every required scenario, role and method, write
`docs/documentation/evidence/<id>.json` from
`docs/documentation/templates/verification.json`, following the shape of
`docs/documentation/evidence/triage-requests.json` (a DOC-029 record):

- `contentSha256`: `sha256sum docs/user-guides/<id>.md` at the time of the walk.
  If the author changes the guide after your walk, walk the changed steps again
  and update the hash.
- `appCommit`: the pinned commit. `buildId`: the lab's app and engine image IDs
  from `lab.json`. `environment`: the lab project name.
- `author` and `technicalReviewer`: copy from the author's technical-review.json
  (`reviewer`). `walkthroughReviewer`: your seat name. `reviewerKind`: `agent`.
- `verifiedAt`: ISO UTC of the final passing run. `status`: `pass`.
- `sources`: the guide, the author's technical-review.json, your walkthrough.mjs
  and walkthrough.json, and the source files the author listed.
- `scenarios[]`: one entry per scenario × role × method with `coverage`,
  `prerequisites`, `expected`, a specific `actual` (what you saw, with labels and
  counts), `result` `pass`, and `evidence` paths (your log and script).
- `limitations`: anything the registry asks for that the app cannot show, with
  what it does instead. `previousEvidence`: the prior record's `appCommit`,
  `contentSha256` and `verifiedAt` if one existed. `compatibilityReview` and
  `copyOnlyReview`: `null`.

An article with any failed or unrun required combination gets no evidence file.
Say so in your report. Then run from the worktree root:

```sh
node scripts/documentation/status.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const a of JSON.parse(s).articles.filter(a=><YOUR IDS>.includes(a.id)))console.log(a.id,a.pass,a.error||'')})"
```

Every article you wrote evidence for must print `true`. Fix the record until it
does; do not touch the compiler.

## When you finish

Reply with, per article: pass or fail, the number of steps, the roles and methods
covered, each guide failure (step, expected, observed) in one line, each product
bug in one line, and the lab names you used. Keep it under 300 words.
