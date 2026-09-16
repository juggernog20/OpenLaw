# Complete suite verification

Issues: [#747](https://github.com/juggernog20/OpenLaw/issues/747),
[#745](https://github.com/juggernog20/OpenLaw/issues/745) and
[#742](https://github.com/juggernog20/OpenLaw/issues/742).

DOC-029 verified all 57 guides against one pinned app build and ran the shared
Help and offline publication checks on the complete edition. The edition now pins
app commit `432dba3a835863091791fbac429a6a66777bdc40`, with application digest
`9e8b3163…ae13c`. The G3 and G4 reports in [DOC-025](../DOC-025/G4.md) pass.

Every check here is an independent agent check. No human user study or human
proofreading is recorded.

## Round 1, app commit 3fa407e3

Each article group had a source-review author agent and a separate walkthrough
agent. The walkthrough agent followed the guide as every required role and
method. When a walkthrough failed, the author corrected the guide and a new
walkthrough ran. The group folders in this batch hold the technical reviews,
scripts and logs.

56 of 57 guides passed. The live-provider walkthroughs used a real DocuSign
developer account and a real OpenRouter key, entered by the owner. The DocuSign
check covered Polling mode and a signed Envelope whose executed copy was filed and
moved the Contract to Active. It is in [live-provider](live-provider/). Round 1
opened three issues:

- [#887](https://github.com/juggernog20/OpenLaw/issues/887): Escape in an AI Field
  prompt saves the discarded text. The guide no longer mentions Escape.
- [#888](https://github.com/juggernog20/OpenLaw/issues/888): Webhook mode was not
  verified against a live DocuSign Connect callback.
- [#889](https://github.com/juggernog20/OpenLaw/issues/889): invites report success
  when SMTP_FROM is unset. The guide wording avoids the false claim.

## Round 2, app commit 57e77e38

Dev moved during round 1, and the branch merged it. A triage agent read the app
diff. Seven guides always received a new walkthrough, and triage added five more.
The other 45 received compatibility reviews with replayed walkthrough scripts, in
[compat-r2](compat-r2/).

Every walkthrough passed except first-run. There, turning on "Require two-factor
authentication" in the welcome wizard no longer opened enrollment. Commit
`2b6d167f` made the `/welcome` route skip its loader when only `?step=` changes, so
the loader guard never redirected. The configure-analysis checks that need no
credentials passed. The round 2 labs held no live keys.

## Round 3, app commit 432dba3a

Commit `432dba3a` fixes the wizard. The Authentication step now opens
`/auth/two-factor/enroll` directly, and a new test in `welcome.test.tsx` fails
without the fix. A fresh first-run walkthrough passed all 52 steps. Its lab image
came from a docs-only snapshot with the same application digest, as its
[log](first-run/walkthrough-r3-1.json) records.

A separate reviewer judged the other 56 guides compatible with `432dba3a`, in
[compat-r3/review.json](compat-r3/review.json). For configure-analysis, no AI
provider code changed from `3fa407e3`, so its live walkthrough still applies.

## Publication checks

An independent agent ran V-HELP and V-OFFLINE on a lab built from `366a78a8`, with
content digest `09293453…c5277`. All six role and method pairs passed. The scripts
and logs are in [publication](publication/), and the record is
[publication.json](../../evidence/publication.json).

It noted two things that do not block the pass:

- The staff "Help with this page" link on the Inbox was removed in `41390ca0`.
  DES-073, PUBLISHING.md and `help-contexts.json` still describe it.
- The archive served by the app image and the `docs:export` archive differ in
  bytes. Only `redirect.js` and `search.js` differ. The content digest is the same.

## Review dispositions

CodeRabbit found no issue in the app fix. It raised 14 minor wording points on the
guides, and all 14 were left unchanged. Most ask for glossary capitalization where
the guide quotes the app's own label, such as **Shared with requester**,
**Legal only** and **Internal team**. The walkthroughs confirmed those labels on
the verified build. The other points restate access rules that the guides already
give in the linked roles guide. The different capitalization of Legal Only across
record types is an app inconsistency, not a guide error.

## Product notes

The walkthrough agents also recorded product observations that are not guide
errors. The owner chooses which become issues. Examples: a Portal Request cannot be
submitted when no Department exists, Matter uploads in the Portal ignore the chosen
Kind, and several OpenAPI summaries describe removed behavior.
