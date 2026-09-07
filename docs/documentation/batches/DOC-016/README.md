# Matter guide verification

C22–C24 for [issue #736](https://github.com/juggernog20/OpenLaw/issues/736).
Three separate articles cover creation/templates, Status and archive lifecycle,
and Tasks, Key dates, and relationships. Author checks passed; independent
technical review and all six scenario/role walkthroughs remain pending.

## Build and evidence

The fictional conversations lab runs app source
`a28331f779da3c8b9e9172dee3cc5b58c7170c7b`, app image
`sha256:7434e1b1802330e3f3499a0fba3dfcc0b8a04fc875561071e17f4ad5a1c29c0d`,
and engine image
`sha256:16ab8ea3bcaf1d43619d6e3cff879d2f313c5e366a36a7ae285a5baa7ae15ed0`.
Its project is `openlaw-docs-b8e31260-conversations`; app/mail ports are
43302/48427 and the draft Help preview is 43312. This change edits no app runtime
or immutable lab input. Guide hashes and actual UTC check times are in the
records below. Organization timezone is Europe/London; template offsets are
resolved from the Matter's UTC creation date.

Fictional Daniel Okafor (Administrator) and Nadia Haddad (Legal Team Member)
followed each guide in distinct browser contexts. Ravi Menon (Contributor) and
Priya Raman (a separate Legal Team Member) supplied permission checks. API calls
prepared prerequisites and read back saved state; the procedures credited as
walkthroughs used the actual browser controls. No screenshots are necessary to
follow these text guides. Agent checks are not a human user study or owner approval.

| Author record                      | Checks | Coverage                                                                                                                                                    |
| ---------------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Creation](author-create.json)     |     14 | Required Fields, direct creation, references, Manager/team permissions, type changes, templates, relative dates, stale template and optional-clear recovery |
| [Lifecycle](author-lifecycle.json) |     12 | Same-Category Status, renamed labels, Close/Reopen, child advisory, writable closed work, archive/restore, filters and Contributor refusals                 |
| [Matter work](author-work.json)    |     18 | Task assignment/team expansion, completion/order/edit/removal, Key dates, hierarchy and flat relations, linked Contracts and access boundaries              |
| [Discovery](author-discovery.json) |      7 | Six role/article Help searches and formal links, heading focus, three themes at three widths, anonymous formal index                                        |

The 51 checks identify tested guide bytes. Detailed outcomes distinguish the
acting role from fixture setup and from a different reader's refusal check.
All three articles have per-article evidence records; author success does not
mark the pending independent scenarios passed.

## Corrections and limits

The release uses fixed open/closed Categories with configurable Status labels.
The inline Status selector stays in the current Category; Close/Reopen have
separate dialogs. Closing is editable, retains child/Contract states and Tasks,
and removes active deadline eligibility. Archive freezes changes. Restore of a
closed Matter preserves its closed Status, so both Show archived and Show closed
may be needed to find it. Both legal roles verified these behaviors, superseding
older inventory assumptions about lifecycle and Administrator-only restore.

[Issue #770](https://github.com/juggernog20/OpenLaw/issues/770) records a reproduced
application defect: an optional template Field cleared during creation receives
its template default again on the saved Matter. Both roles verified that clearing
it on Overview persists; the guide explains that workaround and nonempty overrides.
The application fix is separate from this documentation task.

The Matter/Contract link shows **Confidentiality differs**, with an informational
**Leave them as they are** action; it does not offer to set a flag. This differs
from the Contract-to-Contract relationship suggestion. The Matter guide uses the
actual link dialog and confirms that both flags stay independent. Counterparties
remain on linked Contracts; the Matter creation form has no Counterparty control.
Entity and person references do not grant access to their referenced records.

Early author attempts stopped on harness assumptions: a disabled audience button
was initially expected to be absent; the Counterparty setup route and the
Confidentiality dialog's M-/C- references required correction. Completed records
come from fresh complete runs after those corrections. Disposable earlier records
remain in the owned lab. Existing known app issues are not presented as fixed.

Shared Document and administrator configuration guides are scheduled later in the
program. Their links remain publication dependencies. Request conversion and
Contributor guidance are linked rather than duplicated. DOC-025 still governs
final suite acceptance and DOC-027 governs actual publication.

## CodeRabbit disposition

The single CodeRabbit run raised five findings. The terminology suggestion is
applied: the creation guide names the Matter Manager explicitly. The two status
prose suggestions are declined because these are evidence reports, not user
procedures; descriptive pending/pass statements preserve their meaning.

The two major suggestions to remove Restricted Matter descriptions are not valid
for this build. MTR-015 and the Closing addendum specify identity-free restricted
relationship placeholders. The actual Related Matters card and Close dialog
render **Restricted Matter** without the title, number, or navigation, and the
Legal browser checks verify that result plus direct 404. The guides retain the
implemented label so readers can understand what they see; they do not claim
every Confidential Matter is inaccessible. No application access policy changes
are included here.
