# Account access and navigation guide verification

Review the five guides for C01 through C05 in
[issue #729](https://github.com/juggernog20/OpenLaw/issues/729). Use the author results
from September 7, 2026 below. Complete technical review and the independent article
walkthrough before marking their pending results as passed. Treat these as agent
checks, not a human user study.

## Build and fixtures

The app is the committed pilot lab at `http://127.0.0.1:43301`, with Mailpit at
`http://127.0.0.1:48426`. Its source is
`d1d098ba9f4ba6557a542857d530446b76b1847c`. The evidence files record the immutable
app and Document engine image IDs. The current branch changes documentation only.
The draft reader at `http://127.0.0.1:43310` uses the same app source and API with
the working canonical Markdown. See [PILOT.md](../../PILOT.md) for its launch command.
These addresses identify disposable local services, not a production deployment.

Daniel Okafor, Nadia Haddad, and Ravi Menon provide Administrator, Legal Team Member,
and Contributor contexts. Separate newly invited accounts exercise activation and
two-factor enrollment for each role. Jonas Weber and Amara Nwosu use independent
Business User contexts and fresh Mailpit links. No context impersonates another role.

Contract C-43 carries the searchable PDF `navigation-search.pdf`, whose distinctive
text is `cobalt skylark`. C-43 and C-44 are reachable by all three roles and
have different Owners. C-45 is Confidential and outside Nadia's and Ravi's teams.
Each of these accounts has a named Task on C-43. The author created these fictional
fixtures through authenticated APIs before following the navigation guide. Fixture
creation does not count as a user walkthrough of Contract creation or uploading.

The author expired only a newly invited fixture account's reset token in the owned
lab database to exercise real activation refusal. Resending the invitation and
redeeming the fresh email restored the flow. This expiry operation is test setup,
not a reader recovery instruction. Authentication mode and magic-link settings
were restored after the mode checks. Personal preference checks restored the
accounts' original values and passwords.

## Author results

| Article           | Record                                                                | Observed result                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| staff-sign-in     | [Authentication](author-auth.json), [entry modes](author-portal.json) | All three staff roles activated after an expired-link refusal and resend; password mismatch, consumed link, wrong password/code and backup-code reuse refused; enrollment, replacement, disable, revocation and fresh sign-in worked.                                   |
| portal-sign-in    | [Portal](author-portal.json)                                          | Two Business Users reached their own Requests, recovered from a consumed link, and could not use another person's Request link. An unapproved domain received the neutral response and no mail. Disabled links offered organization sign-in.                            |
| find-your-work    | [Work navigation](author-work.json), [empty Tasks](author-auth.json)  | All three roles opened all Tasks and the owning Contract sections. Member+ completed and reopened a Task; Contributor completion was absent. Empty Tasks, role-specific Home sections, date calendar, search focus and shortcuts were checked.                          |
| search-and-views  | [Work navigation](author-work.json)                                   | All three roles found PDF-only text and opened the exact Version with find prefilled. Search and direct links respected Confidential reach. Filters, sort, Back/Forward, saved layout, another browser, duplicate names, failed reads and empty-result recovery passed. |
| personal-settings | [Preferences](author-settings.json)                                   | All three roles saved profile values and each theme, kept another account unchanged, and tested password/session controls. Member+ entered their own Portal view; Contributor had no App view control.                                                                  |

[Discovery](author-discovery.json) records all five entry links, local search,
article and section focus, and formal reading. Light, Dark, and Warm fitted 1440,
720, and 320 CSS-pixel widths. The signed-out index listed all five guides without
an API request. These width checks do not claim browser zoom or assistive-technology
acceptance; DOC-025 owns those shared checks.

The mode checks cover the configured built-in password mode, magic links, and an
OIDC mode with no provider configured. The last check verified the configuration
message and Administrator password entry. It does not prove a live identity-provider
login. The conditional single sign-on instructions are source-checked; provider
configuration belongs to DOC-020's authentication guide.

## Corrections from the author walkthrough

- Use Owner in the Contract filter example. Priority belongs to the Matter filter set.
- Use the actual Contract empty-result message, **No contracts match these filters**.
- Limit Task completion and Undo to Member+. Contributors can follow their Tasks.
- Name **Discard unsaved changes** and **Default view** separately. There is no Reset
  action in the view menu.
- Wait for the intended URL transition before testing Back/Forward. Several early
  automation attempts acted on newly rendered controls before navigation committed.
  This does not establish a new cause or resolution for issue #751.

Each result file retains the hash of the Markdown it actually tested. Raw browser
state, mail links, authenticator secrets, and backup codes are absent from these files.
The author used temporary scripts under `/tmp/openlaw-docs-run/729-*.mjs`.
An independent reviewer must follow the articles with their own steps and record
which required scenarios they actually completed. Replaying the author scripts is
not independent verification.

## Corrections from the Fable source review

The Fable review seat checked every named control and behavior claim in the five
guides against the app source at `d1d098ba` on September 7, 2026, and recorded that
check as the technical reviewer in each evidence file. The feature owner's human
technical review is not recorded there. One claim changed:

- `staff-sign-in` now states that single sign-on mode refuses password sign-in for
  Legal Team Members and Contributors, with the message **Password sign-in is
  disabled while single sign-on is required.** The earlier wording read as advice.

The five guides keep their task-specific section headings instead of the how-to
template's generic ones. The EDITORIAL requirements are the prerequisite, procedure,
outcome and recovery substance, and that substance is present inline. This is an
accepted editorial choice for this batch, not a pending approval.

## Independent walkthrough

The same Fable seat then followed the five guides with its own Playwright scripts on
September 7, 2026, between 04:08 and 04:54 UTC, against the committed pilot lab and
the draft reader. It did not replay the author's scripts. The sanitized step records
are in [independent-walkthrough.json](independent-walkthrough.json) and
[independent-discovery.json](independent-discovery.json). All 13 required
scenario/role combinations passed, including the alternate and failure outcomes each
guide names. This is an agent walkthrough, not a human user study, and it does not
stand in for the feature owner's approval.

| Scenario | Roles                                              | Result | Notes                                                                                                                                                                                                                                                      |
| -------- | -------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-C01    | Administrator, Legal Team Member, Contributor      | pass   | Fresh invited accounts: expired, mismatched, consumed and wrong-password refusals; enrollment, challenge, backup-code single use, revocation, re-enrollment, disable. Nadia and Ravi were refused with the documented message in oidc mode; Daniel got in. |
| V-C02    | Business User (Jonas and Amara, separate contexts) | pass   | Own Requests only; staff routes bounce to the Portal; reused link recovers; unapproved domain gets the neutral response and no mail; links switched off offers Sign in and Back to sign-in.                                                                |
| V-C03    | Administrator, Legal Team Member, Contributor      | pass   | Role-specific Home sections; Task to C-43 sections; Your Tasks completion and Undo for Member+ only; Your dates; shortcuts; Help; unreachable-record page; fresh-account empty states.                                                                     |
| V-C04    | Administrator, Legal Team Member, Contributor      | pass   | PDF-only text to the exact Version with find prefilled; C-45 hidden from non-team roles; Owner filter, Title sort, Back/Forward; saved view in a second browser; duplicate name; empty and failed reads.                                                   |
| V-C05    | Administrator, Legal Team Member, Contributor      | pass   | Name, timezone, photo limits, three themes with another account unchanged; App view card for Member+ and its absence for the Contributor; password change and session controls; preferences restored.                                                      |

Discovery: the signed-out formal index listed all five guides with no API request, and
its search found the sign-in guides. Each staff role reached the Home, search/list and
Profile guides through the header Help topic, Help search, and the full-documentation
link. **Help with this page** on the sign-in, set-password, expired-link and Portal
entry pages opens the formal reader filtered to that page's topic. Portal Help opened
from the Portal home is scoped to `portal.home`, so its search does not list the entry
guide; the Help index and an unscoped search do. Light, Warm and Dark fitted 320, 720
and 1440 CSS pixels without horizontal overflow.

Two guide passages changed from what the walkthrough observed, and their scenarios
were rerun against the corrected bytes:

- `find-your-work` names the generic **Something went wrong.** page that every role
  sees for a Contract outside reach or a missing number, and says Reload does not
  restore access.
- `staff-sign-in` names the **Single sign-on is not configured yet** state that the
  sign-in page shows in oidc mode with no provider registered.

The author records keep the hashes of the bytes they walked through; each evidence file
carries the current hash and the reviewer's verification time. Fixture preparation
(token expiry, invitation resend, mode and toggle switches with restoration, blocked
reads) is recorded in the walkthrough file and is not guide content. Nine disposable
`docs.review.*` accounts remain in the lab as fictional fixtures.

## Review and publication handoff

`find-your-work` and `search-and-views` are `verified` in the catalog. The edition
records the tested app commit `d1d098ba` and an application compatibility review whose
source digest matched this branch; neither guide links to unpublished content.

`staff-sign-in`, `portal-sign-in` and `personal-settings` stay in `review` even though
their evidence passed. The notification-preferences link deliberately targets
DOC-011's canonical `notifications` article. The Portal entry guide links DOC-012's
`submit-request`, and the staff guide links the Portal and Profile guides. Those owning
batches must complete the linked guides before normal publication can include the
connected access/settings/intake group. The explicit preview reports the unpublished
notification target; the normal edition continues to exclude review content.
