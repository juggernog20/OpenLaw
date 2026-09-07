# Roles and Contributor guide verification

Record the C06 and C25 checks for [issue #730](https://github.com/juggernog20/OpenLaw/issues/730).
Both guides are `verified` after the independent source review and browser walkthrough
recorded below. Agent checks do not constitute a human user study.

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
and Contributor for V-C25. They are author evidence. The independent walkthrough below
is the evidence the two evidence files cite. The two guides link to each other and the
already verified search guide; they have no publication dependency on an unwritten article.

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
The Fable review seat recomputed that digest on this branch and re-recorded the review.

CSS-width and overflow checks do not claim real browser zoom or assistive-technology
acceptance. DOC-025 owns the shared acceptance checks. This batch does not claim that
a confidentiality flag establishes a legal privilege or that a Portal Request grants
access to its resulting Contract or Matter page outside the Portal.

## Corrections from the Fable source review

The Fable review seat checked every named control and behavior claim in both guides
against the app source at `d1d098ba` on September 7, 2026, and recorded that check as
the technical reviewer in each evidence file. The feature owner's human technical review
is not recorded there. Two passages changed:

- `roles-and-access`: the Related tasks paragraph said "work they can reach" and now
  says "work you can reach".
- `contributor-guide`: step 3 under On a Contract now states that **Amount**,
  **Currency**, and **Cadence** save together when focus leaves that group of controls.
  Moving between them does not save. The walkthrough found this; the Contract Overview
  scenario was rerun against the corrected bytes.

The author records keep the hashes of the bytes they walked through. Each evidence file
carries the current hash and the reviewer's verification time.

## Independent walkthrough

The same Fable seat then followed both guides with its own Playwright scripts on
September 7, 2026, between 06:33 and 06:47 UTC, against the committed pilot lab and the
draft reader. It did not replay the author's scripts. The sanitized step records are in
[independent-walkthrough.json](independent-walkthrough.json) and
[independent-discovery.json](independent-discovery.json). All five required
scenario/role combinations passed. This is an agent walkthrough, not a human user study,
and it does not stand in for the feature owner's approval.

| Scenario | Roles                                                        | Result | Notes                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-C06    | Administrator, Legal Team Member, Contributor, Business User | pass   | Same links as each role; Administrator exception; team entries added and removed in the browser; Owner and Matter Manager access without a team entry; Contributor loss of access on the non-Confidential records and re-add by the Legal Team Member; Restricted relationships including the linked C-77; Entity Grant and removal; Confidential baseline Documents; Legal only omission; Portal boundaries. |
| V-C25    | Contributor                                                  | pass   | Navigation to both records; value, Effective date, business Field, Description edits with reload checks; Upload with Note and Add version; reserved Document actions absent; Working team and Full thread posts; disabled Task checkbox and absent legal actions; blocked save and upload recovery; team removal; archive and Restore.                                                                        |

Discovery ran on the draft reader because the committed lab's own Help carries no
verified articles yet. Each staff role reached the roles guide through the header
**Help** link from C-76 (`/help?topic=access`, plus `topic=contributor` for Ravi), Help
search, and the Help index; the Contributor guide appeared only for Ravi, and a direct
`/help/contributor-guide` link showed no article body to the other roles. Title focus,
outline section focus, direct section links, and the full-documentation link passed for
both guides. Portal Help opened from the Portal home is scoped to `portal.home`; the
Portal Help index and search list the roles guide, and the Contributor guide is absent.
The signed-out formal index listed both guides with no non-session API request. Light,
Dark and Warm fitted 320, 720 and 1440 CSS pixels without horizontal overflow; this is a
width measurement, not a browser-zoom or assistive-technology check.

Fixture preparation is recorded in the walkthrough file: Tasks assigned to Ravi through
the Administrator API and deleted afterwards, value and Field restoration after each
Contributor run, and the Matter team entry re-added after an interrupted first attempt.
Two earlier partial runs were interrupted by selector corrections (the Matter dialog's
**Add to team** button, the 1-pixel tier radios, and the Portal entry form); one of them
left `access-matter-baseline.pdf` marked Confidential until the completed run cleared it.
Supporting uploads, comments, and the walkthrough's own fictional PDFs remain in the lab.
HTTP refusals quoted in the step text corroborate the browser results and are not the
walkthrough evidence.

## Review and publication handoff

`roles-and-access` and `contributor-guide` are `verified` in the catalog. Both link only
to each other and to the verified `search-and-views` guide. The edition keeps the tested
app commit `d1d098ba`; its compatibility review records that the only application-path
difference on this branch is the Help test focus correction and that the recomputed
source digest matches.
