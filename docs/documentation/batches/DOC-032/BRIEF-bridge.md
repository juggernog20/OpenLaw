# DOC-032 brief: release-candidate bridge reviewer seat

You are the bridge compatibility reviewer in the DOC-032 batch (issue #1194).
Your seat name is `DOC-032 compatibility reviewer (bridge)`. You wrote none of
the guides, none of their DOC-030 or DOC-032 scripts and none of the DOC-032
walkthroughs. You carry every passing evidence record from the batch's walked
build to the release candidate build, by reading the app diff between them and
replaying the checks that diff can touch on a lab built from the candidate.

## Where you work

- Worktree root: `/home/blairwentworth/.cache/openlaw-worktrees/docs-edition`.
  Never touch `/home/blairwentworth/projects/OpenLaw` or any other worktree.
- The batch walked `4ca41822b685a2a1e58a38b4f25e421cf735c54e`, digest
  `e55f16c19344144766f5fc92f0f417fa5d222d657a150f4db1836d9e37f76385`.
  That commit was later rewritten before it merged, so it is not in dev's
  history. Its tree is still in this repository.
- The release candidate is `ad345da5842c22b7d1012bf9f5d7d12dfdb4e496` (dev, the
  merge of PR #1206). Read its digest with
  `node --input-type=module -e 'import {applicationDigest} from "./scripts/documentation/build.mjs"; console.log(applicationDigest())'`
  from the worktree root (the worktree is rebased onto it, so its `apps/`,
  `packages/` and `styles/` are the candidate's).
- `edition.json` already pins the candidate commit and digest.
- Lab `final` (`.documentation-labs/final/lab.json`, app http://127.0.0.1:43390,
  Mailpit http://127.0.0.1:48490) is built from the candidate and seeded (Helix
  light, random seed 7). It is yours; other agents may use it read-only. For an
  empty lab or a separate deployment, create one from the candidate with the
  lab rules in `BRIEF-walkthrough.md`.
- The seed demo password comes from `LAB_PASSWORD` only. Keep browser state out
  of the worktree.
- The shell is zsh. Run multi-line scripts under `bash <<'EOF' … EOF`.

## What to do

1. Read the whole app diff yourself:
   `git diff 4ca41822b685a2a1e58a38b4f25e421cf735c54e ad345da5842c22b7d1012bf9f5d7d12dfdb4e496 -- apps packages styles package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json messages`.
   Also read `git log --oneline` for that range. Classify each hunk: comment,
   version string, dependency version, message catalog, or behavior. Open the
   changelogs of changed runtime dependencies in `node_modules` where they are
   installed (for example nodemailer and sharp), and say what changed.
2. For every guide, decide which of its claims a hunk can reach. Expected
   reach, at least: the reported app version (versions-and-support and the
   edition details screen), email sending (nodemailer: invitations, sign-in
   links, test email, notifications), image processing (sharp: profile photo,
   organization logo, previews and thumbnails), and the regenerated message
   catalog (setup validation, allowed-domain and provider messages, the logo
   refusal). Do not trust this list; derive your own.
3. Replay on the candidate lab every DOC-032 or DOC-030 step whose claim a hunk
   can reach, using the script the article's current evidence names. Copy what
   you run to `docs/documentation/batches/DOC-032/bridge/`, adapt only
   addresses, the lab manifest name and fixture names, and write a log per
   script. Also run one sign-in smoke per role (Administrator, Legal Team Member,
   Contributor, Business User by fresh magic link) and open each module list.
   first-run and the setup messages need an empty lab from the candidate.
   A step that fails because the app changed: stop, report the article and the
   step. Do not touch that article's record.
4. Do not replay install and upgrade: they name the candidate commit and get a
   fresh walkthrough by another seat. Do not touch the records of
   electronic-signing, configure-signing, connect-claude, connect-chatgpt or
   connect-microsoft-365-copilot.
5. Write `docs/documentation/batches/DOC-032/bridge/bridge.json`: `kind`
   "article-compatibility-review", `task` "DOC-032", `issue` 1194, `set`
   "bridge", `reviewer`, `reviewerKind` "agent", `independence`,
   `reviewedAt`, `fromAppCommit` (4ca41822…), `toAppCommit` (ad345da5…),
   `applicationSha256`, `appDiffCommand`, `appDiffFiles`, `hunks[]`
   (file, class, reach), `replays[]` (script, log, sha256, lab, steps, failed,
   articles), and `articles[]` (`articleId`, `contentSha256`, `reach`,
   `replayed` step references or null, `outcome` `compatible` or `rewalk`,
   `summary`). Format it with prettier, then hash it.
6. For each `compatible` article, update its evidence record's
   `compatibilityReview`:
   - Record with `appCommit` 4ca41822 and `compatibilityReview` null: add a
     block with `fromAppCommit` 4ca41822…, `toAppCommit` ad345da5…,
     `contentSha256` (the record's), `applicationSha256` (candidate digest),
     `reviewer` your seat name, `reviewerKind` "agent", `reviewedAt` (ISO UTC
     now), `summary`, and `evidence` (bridge.json and the replay scripts and
     logs you ran for it, each with `path` relative to `docs/documentation` and
     `sha256`).
   - Record that already has a compatibility review (its `appCommit` is
     067c1646 or 3fa407e3, reviewed by a DOC-032 compat set to 4ca41822): keep
     `fromAppCommit`, set `toAppCommit` to the candidate, `applicationSha256` to
     the candidate digest, `reviewer` to your seat name, `reviewedAt` to now.
     Fold the earlier summary into yours ("From … to 4ca41822 (DOC-032 set …):
     …; from 4ca41822 to ad345da5 (bridge): …"). Keep every earlier evidence
     entry and add yours.
   - Change nothing else in any record.
7. Run from the worktree root and make every article you updated print `true`:

   ```sh
   node scripts/documentation/status.mjs | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const a of JSON.parse(s).articles)console.log(a.id,a.pass,a.error||'')})"
   ```

   Do not edit the compiler, `edition.json`, the scenario registry, the
   catalog or any guide.

## When you finish

Reply with: the hunk classes and counts, the replays (steps, failures), any
article you marked `rewalk` with the failing step, and the status.mjs count.
Keep it under 300 words.
