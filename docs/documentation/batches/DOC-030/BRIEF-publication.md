# DOC-030 brief: publication reviewer seat

You are the independent publication reviewer for the DOC-030 batch (issue #1157).
Your seat name is `DOC-030 independent publication reviewer agent`. You did not
write or walk any guide in this batch. You check that the finished edition reads
correctly in the app's Help and in the offline reader, and you write
`docs/documentation/evidence/publication.json`.

## Where you work

- Worktree root: `/home/blairwentworth/.cache/openlaw-worktrees/doc030`. Never
  touch `/home/blairwentworth/projects/OpenLaw`.
- The edition pins app commit `067c1646829df85e62b809ee9157921e867c84e7`. The
  distribution commit is the worktree HEAD named in your prompt. It holds the final
  guides. Do not edit any guide, the catalog, the edition or the scenario registry.
- Do not run `pnpm install` or any state-changing `git` command. Do not run the
  shared E2E suite.

## The lab

Build your own lab from the distribution commit, so the app image carries this
edition's bundle:

```sh
node scripts/documentation/lab.mjs create pub2 --commit <distribution commit> --app-port 43310 --mail-port 48430
node scripts/documentation/lab.mjs up pub2
node scripts/documentation/lab.mjs seed pub2
```

Read `.documentation-labs/pub2/lab.json` for the project name, image IDs and seed
times, and record them. Pass the seed password only through `LAB_PASSWORD`. Never
write it, a magic link, a cookie or a raw mail message into any file under `docs/`.
Run `node scripts/documentation/lab.mjs destroy pub2` when you finish.

## What to check

The registry scenarios with no articles are `V-HELP` and `V-OFFLINE` in
`docs/documentation/scenarios.json`. Every `roles` × `requiredMethods` pair needs
its own row with `result` `pass`, a specific `actual` and `evidence` paths.

Start from the DOC-029 scripts in `docs/documentation/batches/DOC-029/publication/`
(`help.mjs`, `links.mjs`, `offline.mjs`, `zoom.mjs`, `lib.mjs`). Copy them to
`docs/documentation/batches/DOC-030/publication/`. Change only addresses, counts,
queries that name a renamed guide, and log paths. Guide counts per audience change
with the catalog. Read them from `docs/documentation/articles.json`; do not copy
DOC-029's numbers.

1. V-HELP as anonymous, administrator, legal team member and Business User, with
   internet blocked in the browser. Index, every guide opens, route topics, search
   by keyboard, deep links and fragments, unknown article, anchor, edition and
   topic recovery, three themes at 1280px and 320px, 200% zoom, and every internal
   link resolves.
2. V-OFFLINE as anonymous and operator. Run `mise exec -- pnpm docs:export` with a
   clean tree, record the archive and manifest SHA-256, then read the standalone
   export with the app stopped and with the network blocked. Compare the archive
   the app serves with the export and say which files differ.
3. Record every divergence from DOC-029 that a reader would notice.

## Your record

Write `docs/documentation/evidence/publication.json` with the shape of the current
file. Set `editionId` and `contentDigest` from
`node -e "import('./scripts/documentation/build.mjs').then(m=>console.log(m.compileWorkspace({development:true}).bundle.edition))"`,
`appCommit` to the pinned commit, `task` "DOC-030", `acceptanceTask` "DOC-030",
`distributionCommit` to the lab's source commit, `humanApproval` false. Then run:

```sh
node -e "import('./scripts/documentation/build.mjs').then(m=>{m.compileWorkspace({complete:true});console.log('complete ok')}).catch(e=>console.log(e.message))"
```

The only failures allowed are those the batch owner names in your prompt as
known-open guides. A publication failure is not allowed.

## When you finish

Reply with each role and method pair and its result, the step counts, the export
hashes, and each finding in one line. Keep it under 300 words.
