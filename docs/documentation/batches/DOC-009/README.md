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

## Review and publication handoff

The five files under [evidence](../../evidence/) hold separate pending independent
results for the 13 required scenario/role combinations. Do not promote the articles
from `review` until their evidence and publication dependencies are satisfied.
The notification-preferences link deliberately targets DOC-011's canonical
`notifications` article. The Portal entry guide links DOC-012's `submit-request`.
The linked Request guidance continues to DOC-013's triage and conversion articles
and DOC-021's Request form configuration.
Those owning batches must complete the linked guides before normal publication
can include the connected access/settings/intake group. The Home and search guides
have no link to these pending articles and can enter normal publication after their
own technical and independent checks pass. The explicit preview reports the unpublished
notification target; the normal edition continues to exclude review content.
