# M45 register guides and journeys

Issue [#1250](https://github.com/juggernog20/OpenLaw/issues/1250) updates C32 Entity
records, C53 Entity structure and access, and C50 Reference. The batch extends the
existing guides and keeps their URLs. It removes the instructions to put non-share
interests into a share class and the placeholder text for the new registers.

The author followed the register controls on a separate Compose stack built from
`b57671c5eb562897471076620f9e66d60c8a415e`. No application code changed in this batch.
[Author checks](author-checks.json) records the article hashes, captures, role,
viewport, theme, source and limitations. The images are real Chromium captures of
fictional records. They contain no customer records or credentials.

The two journeys in `e2e/tests/66-m45-registers.spec.ts` passed against that stack.
They enter the register facts through the browser, check a refused distribution
leaves one saved entry, check the grouped Roles and fund after appointment and
distribution, and check the partnership basis change, projected Holding and chart.
Each also downloads the derived register CSV. CI runs the same journeys with the
rest of the browser suite. Set `M45_SCREENSHOT_DIR` to a local output directory to
capture the same states again; copy only the two register images to the guide assets.

`e2e/scripts/upgrade-registers.mjs` extends the upgrade rehearsal. On a pre-M45
baseline it records shares under the seeded Partnership type and creates empty
partnership and trust fixtures. After migration it checks the Entity pin, the type's
new partnership kind, then writes and reads the new registers. When the baseline
already has M45, it fills both registers before the upgrade and compares the stored
entry identities, party identities, Roles, basis and balances afterwards. Both
paths append entries to prove the counters and check the projected Holdings.
The existing M40 and M41 CI baselines exercise the pre-M45 path; the feature-branch
base exercises preservation of M45 data. No baseline rows are inserted through SQL.

The author ran the fixture against the local app and ran its regression tests.
The complete image-swap rehearsal is a CI check. This record does not claim that
running seed and verify against one image proves a migration.

The three changed articles return to `review`. Their prior DOC-032 evidence remains
unchanged. There is no independent walkthrough in this batch because the ticket
requires solo implementation and hands the PR to a later reviewer. The changed
procedures still need that review before release publication.

The strict `pnpm docs:check` already fails at the base revision with
`application compatibility review is missing or stale`. The development compiler
successfully renders all 62 articles, including these updated guides and images,
and reports the existing compatibility warnings. This batch does not change the
recorded app digest or claim that an older walkthrough verified these new steps.
