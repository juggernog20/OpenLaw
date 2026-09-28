# DOC-032 brief: independent walkthrough seat

You are the independent walkthrough agent for one group of guides in the DOC-032
batch (issue #1194). Your seat name is
`DOC-032 independent walkthrough agent (<group>)`. A different agent, the
source-review author, corrected these guides from the code. You did not write
them and you must not change their text. You follow each guide as a reader
would, in a browser, on a lab built from the pinned commit, and you record what
happened.

## Where you work

- Worktree root: `/home/blairwentworth/.cache/openlaw-worktrees/docs-edition`.
  Never touch `/home/blairwentworth/projects/OpenLaw` or any other worktree.
- Pinned app commit `4ca41822b685a2a1e58a38b4f25e421cf735c54e`, application
  digest `e55f16c19344144766f5fc92f0f417fa5d222d657a150f4db1836d9e37f76385`.
- Your group in `docs/documentation/batches/DOC-032/plan.json` under
  `groups.<group>` lists each article's scenario requirements: every `roles` ×
  `requiredMethods` pair needs its own recorded outcome, including the negative
  checks. The author's
  `docs/documentation/batches/DOC-032/<group>/technical-review.json` lists
  `limitations` where the app does not support a registry check; confirm or
  refute them on the lab.
- `docs/documentation/batches/DOC-032/triage.json` (`groupArticles`) lists the
  app changes since the article's last walkthrough. Expect them; do not trust
  them.
- Dependencies are installed. Do not run `pnpm install` or any state-changing
  `git` command. Do not run the shared E2E suite. Do not use `dev-hot`.
- The shell is zsh. Run multi-line scripts under `bash <<'EOF' … EOF`.

## The labs

Both labs were created with `scripts/documentation/lab.mjs` from the pinned
commit. Read `.documentation-labs/<name>/lab.json` for the exact project name,
image IDs and seed timestamps; record them in your evidence.

| Lab        | App                    | Mailpit                | State                                    |
| ---------- | ---------------------- | ---------------------- | ---------------------------------------- |
| `work`     | http://127.0.0.1:43340 | http://127.0.0.1:48440 | Helix seed, light profile, random seed 7 |
| `firstrun` | http://127.0.0.1:43342 | http://127.0.0.1:48442 | Empty; for the first-run guide only      |

Accounts and roles are in `docs/documentation/VALIDATION.md` ("Repeatable
fictional data and accounts"). The seed's bootstrap Administrator is now Devon
Calloway, `devon@helix.example`; Daniel Okafor, Nadia Haddad, Ravi Menon, Jonas
Weber, Priya Raman and Amara Nwosu are unchanged. Pass the seed demo password
through the environment variable `LAB_PASSWORD` only; never write it, a magic
link, a cookie, a session file or a raw mail message into any file under the
worktree. Business Users sign in with a fresh magic link read from the lab's
Mailpit API. Keep Playwright storage state in memory or under `/tmp`, never in
the worktree.

The `work` lab is shared with other agents running at the same time. Create
your own records, named `DOC-032 <group> <scenario> <timestamp>`, for every
mutating step. Do not archive, delete or reconfigure seeded records or
organization settings that another guide depends on; when a guide's step needs
an organization-wide setting, set it, run the step, and put it back at once.
Never stop, restart or reconfigure the shared lab containers. If a guide needs
its own deployment (operator, authentication, LAN, upgrade or fault injection),
create a separate named lab with free ports and explicit subnets, because the
Docker default address pools are exhausted on this machine:

```sh
node scripts/documentation/lab.mjs create <name> --commit 4ca41822b685a2a1e58a38b4f25e421cf735c54e \
  --app-port <free 433xx> --mail-port <free 484xx> \
  --backend-subnet 10.243.<n>.0/24 --engine-subnet 10.244.<n>.0/24
```

Use a `<n>` between 50 and 99 that `docker network inspect` shows is unused.
Then `up`, and `destroy` it when you finish. Record its name.

## How to walk through

Write a Playwright script, one per group, at
`docs/documentation/batches/DOC-032/<group>/walkthrough.mjs`, from the guide's
own steps. Copy the pattern of the DOC-030 group script named in the article's
last evidence record (for example
`docs/documentation/batches/DOC-030/contracts-a/walkthrough.mjs` and its
`api.mjs` helper: sign-in, Mailpit polling, per-identity browser contexts), and
point it at the DOC-032 lab manifest. Playwright is at
`node_modules/.pnpm/playwright@1.63.0/node_modules/playwright` in the worktree.
Use one isolated browser context per identity. Use API sessions only for fixture
setup, a second actor's competing write, and state reads. Every guide step runs
in the browser as the named role.

For each scenario, role and method:

- Follow the guide's steps in order, using the labels it names. If a label or
  control is not there, that is a failure of the guide, not something to work
  around. Record the exact text you saw.
- Check every expected result and every negative check from the registry, and
  the guide's "Check the result" and "If it does not work" sections.
- Record each step with its time, the page, the action, and the observation in
  the script's JSON log, `docs/documentation/batches/DOC-032/<group>/walkthrough.json`.
  Save screenshots only where text is not enough, as PNGs beside the log, with
  fictional data only. Keep them few and small.
- `container-operation` methods run against your own named lab.
  `live-provider-check` methods need a real vendor account and cannot run in
  this batch. Record them as `blocked` with the reason; never substitute a
  stand-in.

When a step fails because the guide is wrong, stop that scenario, record the
failure, and reply with the failing step and the observed behavior so the
author can correct the guide. Do not edit the guide. When a step fails because
the app is broken, record it under `productBugs` with the reproduction and
carry on with the next independent step.

## Your evidence record

For each article that passed every required scenario, role and method, write
`docs/documentation/evidence/<id>.json` following the shape of a DOC-030 record
such as `docs/documentation/evidence/create-contract.json`:

- `contentSha256`: `sha256sum docs/user-guides/<id>.md` at the time of the
  walk. If the author changes the guide after your walk, walk the changed steps
  again and update the hash.
- `appCommit`: the pinned commit. `buildId`: the lab's app and engine image IDs
  from `lab.json`. `environment`: the lab project name.
- `author` and `technicalReviewer`: copy from the author's technical-review.json
  (`reviewer`), keeping the earlier authors named in the prior record's
  `author`. `walkthroughReviewer`: your seat name. `reviewerKind`: `agent`.
- `verifiedAt`: ISO UTC of the final passing run. `status`: `pass`.
- `sources`: the guide, the author's technical-review.json, your walkthrough.mjs
  and walkthrough.json, and the source files the author listed.
- `scenarios[]`: one entry per scenario × role × method with `coverage`,
  `prerequisites`, `expected`, a specific `actual` (what you saw, with labels
  and counts), `result` `pass`, and `evidence` paths (your log and script).
- `limitations`: anything the registry asks for that the app cannot show, with
  what it does instead. `previousEvidence`: the prior record's `appCommit`,
  `contentSha256` and `verifiedAt`. `compatibilityReview` and
  `copyOnlyReview`: `null`.

An article with any failed, blocked or unrun required combination keeps its old
evidence file untouched. Write what you observed into your walkthrough.json and
say so in your report. Then run from the worktree root:

```sh
node scripts/documentation/status.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const a of JSON.parse(s).articles.filter(a=><YOUR IDS>.includes(a.id)))console.log(a.id,a.pass,a.error||'')})"
```

Every article you wrote evidence for must print `true`. Fix the record until it
does; do not touch the compiler. Run `pnpm exec prettier --write` on every JSON
and `.mjs` file you wrote.

## When you finish

Reply with, per article: pass or fail, the number of steps, the roles and
methods covered, each guide failure (step, expected, observed) in one line,
each product bug in one line, and the lab names you used. Keep it under 300
words.
