# Documentation release checklist

Owner: Blair Wentworth, @juggernog20. Use this checklist for the release handoff.
Check a box only after completing its requirement. Keep a completed, dated copy
with the edition's release record and link the actual artifacts and observations.

## Candidate and content

- [ ] Record the edition ID/channel, supported app version and full commit,
      distribution commit, publication target, application digest, owner and date.
- [ ] Run `node scripts/documentation/status.mjs` and retain the report. Reconcile
      all P0 groups for G3 and all P0/P1 groups for G4. Keep blocked groups visible.
- [ ] Review each feature PR's documentation-impact decision. Recheck changed
      procedures as every required role, with an independent reviewer and the
      required methods. Complete live-provider checks where specified.
- [ ] Confirm current article/asset hashes, retained scenario evidence, actual
      reviewer identities, compatibility reviews, and dated copy-only classifications.
- [ ] Finish all cross-article links and Help bindings. Promote catalog states only
      when their evidence meets [EDITORIAL.md](EDITORIAL.md).

## Actual destinations and recovery

- [ ] Use the complete content in the selected review/release environment. Check
      staff, Contributor and Business Portal Help plus signed-out formal reading.
- [ ] Retest the pilot and recorded failed-query cases, keyboard/history/focus,
      narrow layouts, browser zoom, themes, audience boundaries and edition selection.
- [ ] Check every required internal link and published alias. An unknown article,
      anchor or unbundled edition must offer the documented recovery.
- [ ] Verify public reading without organization data APIs and local reading with
      internet access blocked. A failed external support link must leave local
      instructions usable.
- [ ] Retain a complete standalone export outside the instance. Stop only the owned
      test instance, then read/search the retained copy. Check prose/index without
      JavaScript and with optional assets missing. A missing article must fail
      completeness, then work after recovery from a complete copy.
- [ ] Record final `V-HELP` and `V-OFFLINE` evidence in
      `evidence/publication.json`, with the exact edition/content/build identities,
      actual roles, methods, times and outcomes required by the compiler. Preview
      or partial-content observations do not stand in for the complete edition.

## Build and retain

From a clean committed distribution with the required evidence:

```sh
pnpm docs:check
pnpm docs:complete
pnpm docs:export
```

- [ ] Keep `docs:complete` passing without preview flags or reduced coverage. Retain
      relevant test/static results for the final commit and the output's content digest.
- [ ] Retain the entire `.documentation-output` directory and its
      `openlaw-documentation.tar.gz` outside the running instance, with checksums
      and an immutable release location. Check the copied files, not just the source.
- [ ] Confirm the app image carries the same applicable edition, and that a clean
      install reaches it. Record source/image identities and actual served locations.
- [ ] Record the handling of supported older links and retained older editions.
      Published content must not contain draft notices or placeholder articles.
- [ ] Record maintenance ownership, next inventory review, feedback route and any
      explicit product-owner release decisions in the umbrella/release record.
- [ ] Record human proofreading when it actually occurs. The current user's proof
      waits for the full assembled suite; do not label agent checks as human approval.

DOC-027's target is `feature-review`. This checklist grants no production deployment
or onward merge permission. C42/C43 and the remaining DOC-025/027 gates are still
open at the DOC-026 handoff; no checkbox above waives them.
