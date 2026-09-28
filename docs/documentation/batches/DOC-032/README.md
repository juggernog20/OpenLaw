# Suite re-verification for the 0.1.0 candidate

Issue: [#1194](https://github.com/juggernog20/OpenLaw/issues/1194).

DOC-030 pinned the edition to `067c1646`. Dev then took M42, the DocuSign
preparation rework, owner fields, Document type colours, per-Version delete,
several SSO identity providers and the release prep. Development builds warned
that the compatibility review was stale, and eight guides no longer matched
their evidence. DOC-032 checks the suite again for the release candidate.

The edition now pins app commit `ad345da5842c22b7d1012bf9f5d7d12dfdb4e496`
(dev after #1206, version 0.1.0), application digest `5dadf909…0e7c`.

Every check here is an agent check. No human user study or human proofreading
is recorded. 57 of 62 guides pass. The other five wait for live vendor sessions
that need the owner.

## How the batch ran

The batch walked `4ca41822`, the release-prune branch (#1204) as it stood that
morning. #1204 was rewritten before it merged, so `4ca41822` is not in dev's
history. A bridge review then carried the evidence to `ad345da5`.

1. A triage agent read the app diff from `067c1646` to `4ca41822` and mapped it
   to each guide, [triage.json](triage.json). Of the 50 guides whose text still
   matched their evidence, 17 needed a fresh walkthrough and 33 could carry a
   compatibility review.
2. Each group with changed guides had two seats, as in DOC-030. A source-review
   author corrected the guide against the code. A separate walkthrough agent
   followed the corrected guide on a lab built from `4ca41822`, as every role
   and method in the scenario registry. The groups are access, admin-org,
   contracts, contracts-2, documents, documents-2, mcp, operator, records and
   signing. [plan.json](plan.json) lists their articles and scenarios.
3. Four compatibility sets replayed the DOC-030 scripts of the unchanged guides
   on the same build, in [compat](compat/). contract-stages moved to a walk
   group, because the contracts author found a claim it needed to change.
   manual-signing failed its replay (the "Approvals & signing" card is gone) and
   was corrected and walked.
4. A bridge reviewer read the diff from `4ca41822` to `ad345da5`. It is
   comments, version strings, nodemailer and sharp patch releases and the
   message catalog. It replayed every check those hunks can reach on labs built
   from `ad345da5`, in [bridge](bridge/): a sign-in smoke per role, the access
   and admin-org walks, email-bearing flows, reminders, the Portal and
   versions-and-support. All passed. The notifications "email reads the words
   at send time" step lost its timing race five times, as in DOC-030, and passed
   on the sixth run.
5. install and upgrade name the candidate commit in their commands, so they
   were corrected and walked again on `ad345da5`. The walk from `4ca41822`
   failed at `git checkout`, because that commit was on no GitHub branch. On
   `ad345da5` the guides' own clone and checkout work. The upgrade runs from
   `067c1646`, the previous candidate.
6. The bridge found that versions-and-support gave `0.0.1` as the shared
   development version. The sentence now names `0.1.0`, and the guide was walked
   again on `ad345da5` in [support](support/).

The first PR run found two checks tied to the old state. The API test
`apps/api/src/mcp/documentation.test.ts` looks for "legacy Clients" in
configure-mcp, and the author had capitalised it at the start of a sentence.
The sentence now reads "Older, legacy Clients…", and an independent
copy-only review in the evidence record keeps the walkthrough observations.
The E2E reader test expected "Create and maintain a Contract" to carry the
validation badge, which was true only while every guide was stale. It now
checks that guide has no badge and that electronic-signing has one.

For the three operator guides that carry a compatibility review,
the bridge did not rerun the compat-d container scripts. No hunk touches
their container steps. The install and upgrade walks on `ad345da5` ran the same
Compose, backup and restore paths.

The walks sent one guide back: first-run said the setup token field "shows
Setup token verified". A sighted reader sees only a check mark; the words are
for screen readers. The author fixed it and the whole first-run flow was walked
again on a fresh lab.

## Results

| Evidence                                                 | Guides |
| -------------------------------------------------------- | ------ |
| Walked on `ad345da5`                                     | 3      |
| Walked on `4ca41822`, bridge review to `ad345da5`        | 24     |
| DOC-030 walk, DOC-032 compatibility review to `ad345da5` | 30     |
| Blocked or unverified                                    | 5      |

The five that receive no credit:

- **electronic-signing, configure-signing.** #1178 rewrote both guides for the
  DocuSign preparation flow and recorded them as blocked until the owner enters
  developer credentials in a live lab. This batch did not change them. Their
  scenarios V-C17-electronic and V-C42 now read `blocked` in the registry,
  which matches their evidence.
- **connect-claude.** M42 added resources and prompts to the guide after its
  DOC-030 live walk. The mcp walker passed every browser-walkthrough pair on a
  local lab. The live claude.ai checks of V-M41-C59 and V-M42-C59 need an owner
  session, so the evidence is `blocked` with the DOC-030 record kept under
  `previousEvidence`. The catalog moves the guide back to `review`, as EDITORIAL.md
  requires for a changed guide.
- **connect-chatgpt, connect-microsoft-365-copilot.** Unchanged scope: DOC-031
  (#1187).

connect-headless-client passes, but its "Connect Claude Code" step was not run,
because no seat ran the Claude CLI. The same key worked through the SDK Client
and the guide's mcp-remote entry. The record lists this as a limitation.

## Owner decisions

`pnpm docs:check` exits 1 on this branch, and only on publication decisions
that belong to the owner:

- The edition's TECH-027 record approves the two vendor guides by hash. M42
  (#1166) added a "Resources and prompts" section to each after the approval, so
  the build reports `publication source changed: connect-chatgpt`.
- Nine verified guides link to electronic-signing or configure-signing, and
  five link to connect-claude. A strict build refuses a link to a guide that is
  not published.

[owner-options.mjs](owner-options.mjs) applies each option to a temporary copy
and compiles it. Either of these lets the build pass with 57 verified guides:

1. Re-approve the two vendor guides at their current hashes, and add
   electronic-signing, configure-signing and connect-claude to the publication
   record. They then appear in Help with the validation badge.
2. Restore the two vendor guides to their approved bytes (drop the M42
   section), and add the same three guides to the publication record.

Otherwise, the live DocuSign, claude.ai, ChatGPT and Copilot sessions have to
run. No approval is recorded in this batch.

`pnpm docs:complete` stays red until every guide is verified. Publication
evidence (V-HELP, V-OFFLINE) was not rerun: its content digest must match the
final bytes, and the complete gate fails first on the unverified guides.

## Scenario registry

63 article scenarios pass with DOC-032 acceptance. V-M42-C58 and V-M42-MCP
pass for the first time. V-HELP and V-OFFLINE keep their DOC-030 acceptance. V-C17-electronic, V-C42 and V-M41-C59 are `blocked`.
V-M41-C60, V-M41-C61 and V-M42-C59 stay `pending`.

Registry wording questions for the owner: V-C35 still describes nine wizard
steps with a "Business-user portal" step; the app has eight. V-M42-MCP asks for
an upgrade from M41; the walker built one from `067c1646`.

## Product defects

Filed with `needs-triage`:

- [#1207](https://github.com/juggernog20/OpenLaw/issues/1207) Sending for
  signature skips the Soft gate.
- [#1208](https://github.com/juggernog20/OpenLaw/issues/1208) Removing the last
  SSO provider can leave staff with no way to sign in.
- [#1209](https://github.com/juggernog20/OpenLaw/issues/1209) Emptying the
  allowed-domain list locks out existing Business Users.
- [#1210](https://github.com/juggernog20/OpenLaw/issues/1210) A fresh install
  shows Business sign-in methods off while they still work.
- [#1211](https://github.com/juggernog20/OpenLaw/issues/1211) Per-Version delete
  has no decision record and conflicts with DOC-001 and DOC-010.
- [#1212](https://github.com/juggernog20/OpenLaw/issues/1212) The Contract Status
  archive dialog counts Partially signed as live.
- [#1213](https://github.com/juggernog20/OpenLaw/issues/1213) Copy and message
  defects.
- [#1214](https://github.com/juggernog20/OpenLaw/issues/1214) DOC-030 defects
  still present.

The guides describe the built behavior in each case.

## Labs

All labs came from `scripts/documentation/lab.mjs` with explicit subnets,
because Docker's default address pools were exhausted. Shared labs: `work` and
`firstrun` (`4ca41822`), `final` (`ad345da5`). Groups that change
organization-wide settings used labs of their own, named in each evidence
record. Every lab is destroyed. No password, key, token or session file is in
this folder; the compat logs are force-added because `.gitignore` excludes
`*.log`.
