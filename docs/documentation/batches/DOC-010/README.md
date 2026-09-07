# Roles and Contributor guide verification

Record the C06 and C25 checks for [issue #730](https://github.com/juggernog20/OpenLaw/issues/730).
Keep both guides in review. Complete independent source review and browser
walkthroughs before promoting them. Agent checks do not constitute a human user study.

## Build and fixtures

Use the committed pilot app at `http://127.0.0.1:43301`, source
`d1d098ba9f4ba6557a542857d530446b76b1847c`. The per-article evidence records its immutable
app and Document engine image IDs. The draft reader runs at `http://127.0.0.1:43310`.
These are disposable local services. No production account or customer data is involved.

Daniel Okafor is the Administrator, Nadia Haddad the Legal Team Member, Ravi Menon the
Contributor, and Jonas Weber the Business User. Each uses a separate browser context.

The author prepared these fictional fixtures through authenticated Administrator APIs:

- Contract C-76 and Matter M-21 are non-Confidential and include Ravi on their teams.
  Daniel is the Owner or Matter Manager. Nadia initially has no team entry.
- Contract C-77 and Matter M-22 are Confidential children of those shared records.
  Daniel has the creator entry and is the Owner or Matter Manager. Nadia and Ravi
  initially have no team entry on either child.
- Two dedicated types carry one business Field and one legal Field. Their labels begin
  with `Documentation business note` and `Documentation legal note`.
- A separately Confidential Entity named `Docs access Entity` initially has no Grants.
- Each shared record has an Administrator-uploaded baseline PDF. The Contract's
  baseline Document is primary. Contributor uploads create supporting chains.

The source fixture details remain in the private local file
`/tmp/openlaw-docs-run/730-fixture.json`. Fixture creation is not evidence of following
the later type-configuration, Contract-creation, or Matter-creation guides.

## Author walkthroughs

| Record                                               | Observed result                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Access](author-access.json)                         | All four roles followed the same record links. Administrator access, team additions and removals, Owner and Matter Manager exceptions, Restricted relationships, Entity Grants, and Portal boundaries passed.                                                               |
| [Contributor work](author-contributor.json)          | Ravi changed permitted Contract and Matter values, reloaded saved Fields, uploaded and opened supporting PDFs, appended a Version, and posted at Working team and Full thread. Legal Fields and reserved controls stayed unavailable.                                       |
| [Recovery and Document access](author-recovery.json) | Failed saves and uploads recovered. Legal Only comments stayed absent for Ravi. Separately Confidential Documents admitted Daniel and the named Contributor, but not Nadia outside the team. Archiving froze Contributor writes, and restoration returned the controls.     |
| [Discovery](author-discovery.json)                   | The role guide appeared through Help from the Contract and the Portal Help index. The Contributor guide appeared for Ravi and stayed out of the other roles' Help results. Search, section focus, formal links, anonymous reading, and three themes at three widths passed. |

The Contributor Version check reused the fictional PDF bytes with a different filename.
It verified a second immutable Version in the same supporting chain, not a content
comparison. Supplemental HTTP refusals corroborate unavailable browser actions; they
do not replace the browser walkthroughs.

The access walkthrough restores Daniel as Owner and Matter Manager, removes temporary
team entries on the Confidential children, restores Ravi on the shared teams, and
removes Nadia's Entity Grant. Recovery checks restore the baseline Document flags and
the shared records after temporary archiving. Fictional comments, supporting uploads,
and business-value edits remain in the lab.

These runs cover the five required scenario/role combinations: four roles for V-C06
and Contributor for V-C25. The independent evidence files retain `not-run` until the
reviewer actually follows the guides. The two guides link to each other and the already
verified search guide; they have no publication dependency on an unwritten article.

## Rework and limits

The author corrected browser selectors for the numeric Amount control, calendar date
picker, section-specific Documents link, and Download link. The calendar check chooses
a different date on reruns. Selecting its already selected day does not commit a change.

Some early page loads showed the shared error page during the checks. Fresh independent
contexts subsequently opened the same pages, and the complete recovery and discovery
runs passed. The author added an explicit wait for the sign-in URL and network settling
before starting the next navigation. No product cause or fix is established by these
observations, and they do not resolve issue #751.

The full test run found a focus assertion running before the reader's focus effect.
A targeted run failed the same pattern in the Help session-error test. The existing
Help tests now wait for focus rather than only for the heading to exist. Runtime code
is unchanged. Because the application digest includes test source, `edition.json`
records a compatibility review of this test-only difference from the pilot build.
The independent reviewer must inspect that review as part of this batch.

Fable review changed one sentence in the roles guide after the author walkthroughs: the
Related tasks paragraph said "work they can reach" and now says "work you can reach".
The author records keep the hash of the bytes they tested. The evidence file carries the
current hash, and the pending independent walkthrough follows the current bytes.

CSS-width and overflow checks do not claim real browser zoom or assistive-technology
acceptance. DOC-025 owns the shared acceptance checks. This batch does not claim that
a confidentiality flag establishes a legal privilege or that a Portal Request grants
access to its resulting Contract or Matter page outside the Portal.
