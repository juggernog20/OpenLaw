# Whole-suite acceptance

Task [#745](https://github.com/juggernog20/OpenLaw/issues/745) remains open. This
batch completes the available evidence reconciliation and records separate
[G3](G3.md) and [G4](G4.md) reports. It cannot complete either gate while the real
provider checks in #742 are blocked. There are no approved release exceptions.

## Coverage and build reconciliation

The [ledger](coverage.json) accounts for all 56 articles, 55 coverage groups, and
124 required article/role/method combinations. The 54 merged articles carry 116
passing combinations across 53 groups. The remaining eight combinations belong
to Administrator/operator browser and live-provider checks for C42/C43. The
scenario registry now credits the 54 completed article scenarios on their actual
recorded builds; the two provider scenarios and shared complete-content V-HELP
and V-OFFLINE scenarios remain blocked.

The [compatibility audit](compatibility.json) compares all four historical app
builds with the distribution base `d6df148c`. Its saved source diffs and linked
later independent walkthroughs account for comment merging, empty Entity-calendar
filters, and Document reads for archived Knowledge Items. The target is the existing
immutable lab build `6a8873db`; its subsequent app-source changes remove an unused
selected property and alter comments/tests. Historical app commits, image IDs,
timestamps, and raw observations remain unchanged. This audit is source inspection,
not a claim that every earlier scenario ran again. The compiler accepts historical
evidence only with a current, hash-bound compatibility review and still requires
all original independent role/method results.

That audit and the guides share one root author under two task labels, so unequal
reviewer strings did not make it independent. An
[independent re-check](independent-compatibility.json) reproduced the four saved
diffs against git byte for byte, read each commit against its parent, and read the
cited walkthroughs. It found one wrong citation. The authored record credited
DOC-010 for the four-role conversations on `a28331f7`, but DOC-010 is
roles-and-access and contributor-guide on the earlier `d1d098ba`. The conversations
walkthrough on `a28331f7` is
[DOC-011](../DOC-011/independent-walkthrough.json), 08:46:35.623Z to 08:53:41.841Z,
and the Portal Request thread on that build is
[DOC-012](../DOC-012/independent-walkthrough.json), which was not cited at all even
though it carries C10. Both are now cited, the authored audit keeps its own
reviewer and time under a recorded correction, and every dependent hash is
refreshed. Each article compatibility review now names the independent seat, so the
compiler independence guard passes in substance.

Three guides receive only en-US spelling corrections: manual-signing,
contract-stages, and contract-relations-and-ending. Their `copyOnlyReview` fields
retain the prior hashes and classify the change; no new procedure run is claimed.
A fourth copy-only edit adds "which version" to the support guide's opening
sentence. `author-query-retest.json` records that exact previously failing query
now reaching the intended guide as all four app roles and an anonymous formal
reader. The earlier walkthrough/export hashes remain the bytes actually observed.
The DOC-017 glossary link is repaired. SET-008 retains its superseded wording and
records that Field prompts has no collapse control, as the actual component and
the provider draft show.

## Independent acceptance of the available scope

A seat separate from the documentation author ran its own browser checks on the
owned configuration lab, app `6a8873db`, image `c585d868…`, engine `1c2f7f6f…`.
[The acceptance run](independent-acceptance.json) records 38 passing steps with no
failure. The full eligible index matched the catalog for every reader: 44
Administrator, 36 Legal Team Member, 17 Contributor, 11 Business User, 54 anonymous
formal. Each reader also passed sampled reading with a focused title, three themes
at 320px and CSS zoom 2 at 1280px; the original DOC-024 "which version" query; the
keyboard search, focus and Back/Forward run; and recovery from no matches, an
unavailable article, an unbundled edition and a missing anchor. Contributor and
Business User met the audience notice in place and reached the public formal
article from it. Public reading and search sent no application API request. Every
reader saw content digest `d563e8d8…`, which is what this branch compiles.

[Browser zoom](independent-zoom.json) is separate from the CSS-zoom checks. A
disposable Chromium profile with a tabs-permission extension set real zoom to 200%
for all five readers: `chrome.tabs.getZoom` 2, device pixel ratio 2, 1280px
reflowed to 640 CSS pixels, CSS zoom still 1, no overflow in any theme. No
assistive-technology or human study is claimed.

Contextual Help took two failed attempts, both mine and neither an application
fault. I first looked for "Help with this page" on a Contract record; DES-073 puts
that link on the pilot entries, which on staff are `/inbox` and `/inbox/:number`.
I then read the address before the client route had settled.
[The first attempt](independent-contextual-help-first.json) and
[the retry](independent-contextual-help-retry.json) are kept.
[The retest](independent-contextual-help.json) shows Inbox contextual Help
narrowing to `topic=inbox`, a Contract record offering header Help with its 25
route topics instead, and no record identifier in any Help address.

[The offline run](independent-offline.json) exported a standalone copy, stopped the
owned lab, and confirmed the app refused connection. Every context was offline and
refused any http request. All 54 guides listed and read with JavaScript enabled and
disabled, local search found the backup guide, and the copy still read with
`search.js` removed by name and then put back. Withholding
`backup-and-restore.html` left the index still linking a guide that would not open,
which is the completeness failure a retained copy has to be checked for; restoring
the file made the copy whole again. The lab came back healthy on the same image
`c585d868…`, so this restart built nothing new. These are 54-article preview
checks, not final 56-article V-HELP or V-OFFLINE acceptance.

## Preview observations

The author used the owned configuration lab (`openlaw-docs-b8e31260-configuration`,
app 43332/Mailpit 48436) and preview 43333, with separate fictional Helix role
contexts. This is development-preview content, not published documentation.

`author-discovery.json` retains 167 passing and eight failed observations. All
162 eligible role/article reading checks passed focused titles, 320px layouts in
Light/Dark/Warm, and CSS zoom 2 at 1280px. CSS zoom is not browser-chrome zoom or an
assistive-technology study. The complete index counts are 44 Administrator, 36
Legal Team Member, 17 Contributor, 11 Business User, and 54 anonymous formal guides.

`author-discovery-retry.json` retains eight passing corrections. The unfiltered
index uses section lists rather than the search-result selector; out-of-audience
pages contain two equivalent formal links, requiring an explicit first match;
the Portal keyboard run must await search navigation before focusing the result.
No application change was required. The corrected Portal run followed Enter,
focused the article heading, and preserved the query/article across Back/Forward.
Public search/reading sent no application API calls; external browser requests
were blocked during the reachable-instance pass. These authored checks supplement
the independent per-batch walkthroughs; they do not replace DOC-025's independent
review or final complete-content publication observations.

The retained preview was copied outside the instance, then the owned configuration
lab was actually stopped and its app URL refused connection. `author-offline.json`
and `author-offline-retry.json` record index/prose with JavaScript enabled/disabled
and local search without HTTP requests. Both runs restored the owned lab to health.
The first optional-script check selected `redirect.js`; its action label incorrectly
called that the search script. It does not prove missing-search recovery. The retry
explicitly removed `search.js` and read the static index and installation article,
then restored the file. These records cover the current 54-article preview; they do
not claim a complete 56-article edition or credit final V-OFFLINE acceptance.

The DOC-017 Portal topic observation is resolved by `author-contextual-help.json`:
the header combines Request, files, and shared topics; **Help with this page**
selects only `portal.request`. Both actual links completed navigation, and the
unfiltered Help index included the Document guide. The different result sets match
the recorded design; no record identifier entered the Help query.

`author-browser-zoom-probe.json` and `author-browser-zoom.json` add actual Chromium
browser zoom using its tabs API in disposable browser profiles. All four app roles
and the anonymous formal reader viewed the reference guide at 200% in all three
themes. Chromium reported zoom 2 and device pixel ratio 2; the 1280px viewport
reflowed to 640 CSS pixels while CSS zoom remained 1, without page overflow. This
is a reference-guide sample, separate from the 162 article CSS-zoom observations.
The reference hash was associated afterward from unchanged bytes, with that fact
recorded explicitly. No assistive-technology or human study is claimed.

The first offline restart ran the lab helper's normal build step and produced a
new app image from the same sealed source. [The rebuild record](lab-rebuild.json)
and retained build-log excerpt identify both images. Later observations correctly
record `c585d868…`; earlier observations retain `01f561a6…`. They are not relabeled
as byte-identical images. The engine image stayed unchanged.

## Local validation

Static checks passed all 19 tasks; documentation/CI tooling passed 34 tests. The
uncached application suite passed all five tasks in 4m13.793s. The compiler audit
used a separate copy of the actual metadata with the 54 available articles marked
verified: all current article hashes, required independent role/method records,
and compatibility artifacts passed before the expected unpublished provider-link
refusal. The audit changed no catalog status: the 54 merged articles stayed in
review and the two provider guides stayed `scoped`. Normal and preview builds
passed; the preview retains nine expected links to the two unmerged provider guides.

The independent seat re-ran the same checks after its corrections. Documentation and
CI tooling passed 34 tests, Prettier and ESLint were clean, and the compiler audit
passed again with each article compatibility review naming a reviewer other than the
article author. The uncached application suite passed all five tasks in 4m6.489s:
97 web test files with 1704 tests and 176 API test files with 2890 tests, no
failures. No browser ran alongside it.

## Scope of remaining work

Provider access is the external dependency. The independent preview review of the
available 54-article scope is complete and recorded above. What remains is the same
review over the complete 56-article suite, the complete-content Help/offline checks,
maintenance ownership under DOC-026, and publication into the feature review
environment under DOC-027. Human proofreading waits for the full assembled suite. Earlier batch
limitations remain historical records. The 22 existing publication-blocker lists
are retained as `publicationBlockersBeforeDOC025`; current `publicationBlockers`
name the remaining acceptance/provider gates. No old walkthrough metadata is
re-dated. The G3/G4 reports provide current counts rather than relying on old
wording such as "this linked guide does not exist yet."

CodeRabbit ran once and completed with eight findings. [Dispositions](review-dispositions.md) record the fixes and the source-verified rejection.
