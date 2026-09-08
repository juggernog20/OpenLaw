# Configuration guide verification

Five canonical articles cover C38–C41 and C55 for [#741](https://github.com/juggernog20/OpenLaw/issues/741). Four are new; `request-forms` extends the existing Contract pilot to Matter targets, form variants, guidance and conversion gaps. There are now 46 authored articles of 56 planned. This is feature-review content. The five Administrator walkthrough scenarios V-C38, V-C39, V-C40, V-C41 and V-C55 have now been run independently and each per-article record reads `pass`. The same independent agent also performed the technical review by source inspection, so each record names it under both `technicalReviewer` and `walkthroughReviewer`: two methods, one reviewer, not two people. No human feature owner has signed off behaviour accuracy. The catalog stays at `review`: it does not claim publication or final-candidate acceptance, and the user's proofreading of the assembled suite has not happened.

## Build and method

Author browser actions used immutable app source `6a8873dbda333fd9992eb77525d4bfa3f47af20d`, app image `sha256:01f561a674f91137c4e3bb0e0b267c3e1731361dc13182687a5026510b87d7bb`, engine image `sha256:1c2f7f6f03395c6cdf05c8e2ab716334a4248587ec655f3cbdfebefb8ffafbf7`, project `openlaw-docs-b8e31260-configuration`, app port 43332 and Mailpit 48436. The light Helix seed ran with seed 7 and AI disabled. The draft Help preview at 43333 serves the working guide bytes over that backend. The source snapshot and configuration remain sealed by the lab helper. The completed DOC-020 onboarding fixture's containers and network were stopped after its merge, with both volumes and all configuration retained, to make room. Other stacks were untouched.

Daniel Okafor operates Administrator Settings; Nadia Haddad and Ravi Menon verify lower-role refusals. Jonas Weber uses the Business Portal. A new fictional Legal Team Member, Ellis Marlow with a run-specific suffix, verifies morning delivery without earlier recipient notification history. API calls prepare named fictional records and corroborate saved state. Guide configuration and creation/conversion actions use browser controls. A real queued morning job runs in this owned worker, using the real clock and the colleague's saved timezone; Mailpit receives actual SMTP delivery. One browser-only Task-save 503 simulates a recoverable partial template save, while earlier saves and the retry reach the real server.

These are author agent walkthroughs, not independent reviews or human studies. Each record contains the article hashes at its start and actual timestamps around awaited actions. No raw credentials, session tokens, invitation links or external customer data are committed. Screenshots are unnecessary for these text procedures.

## Author observations

| Record                                                 | Successful observations | Failed attempts retained |
| ------------------------------------------------------ | ----------------------: | -----------------------: |
| [discovery](author-discovery.json)                     |                       6 |                        0 |
| [forms](author-forms.json)                             |                       2 |                        1 |
| [forms-retry](author-forms-retry.json)                 |                       0 |                        1 |
| [forms-retry2](author-forms-retry2.json)               |                       1 |                        1 |
| [forms-retry3](author-forms-retry3.json)               |                       2 |                        0 |
| [groups](author-groups.json)                           |                       0 |                        1 |
| [groups-retry](author-groups-retry.json)               |                       4 |                        0 |
| [reminders-complete](author-reminders-complete.json)   |                       0 |                        1 |
| [reminders-complete2](author-reminders-complete2.json) |                       1 |                        1 |
| [reminders-complete3](author-reminders-complete3.json) |                       4 |                        0 |
| [reminders](author-reminders.json)                     |                       0 |                        1 |
| [reminders-retry](author-reminders-retry.json)         |                       2 |                        1 |
| [statuses](author-statuses.json)                       |                       0 |                        1 |
| [statuses-retry](author-statuses-retry.json)           |                       1 |                        1 |
| [statuses-retry2](author-statuses-retry2.json)         |                       6 |                        0 |
| [supplement](author-supplement.json)                   |                       3 |                        0 |
| [taxonomies](author-taxonomies.json)                   |                       2 |                        1 |
| [taxonomies-retry](author-taxonomies-retry.json)       |                       0 |                        1 |
| [taxonomies-retry2](author-taxonomies-retry2.json)     |                       4 |                        1 |
| [taxonomies-retry3](author-taxonomies-retry3.json)     |                       0 |                        1 |
| [taxonomies-retry4](author-taxonomies-retry4.json)     |                       1 |                        0 |
| [templates](author-templates.json)                     |                       1 |                        1 |
| [templates-retry](author-templates-retry.json)         |                       3 |                        0 |

The records contain 43 successful observations and 15 failed attempts. Counts include resumed checks and repeated corroboration; they are not distinct users or independent scenarios. Completed prior steps were retained when a script resumed. Failed attempts were helper assumptions, not silently relabeled passes: asynchronous checkbox updates and navigation readiness; native required-field validity instead of disabled/alert states; a creation-only Status picker left open outside existing rows; an unsupported `statusId` fixture-creation key; the membership API's actual 422 refusal; radio/select and required-label locators; save-status text outside an alert role; waiting for a saved reminder row before reordering; the daily email's actual subject; the bell's record title instead of its Key date label; and disambiguating the Audit Search from global Search. Every interrupted required procedure has a later successful completion record.

Types/Fields checks created, renamed and keyboard-reordered definitions, retained a slug, attached and required a Global Field separately on Contract and Matter types, refused narrowing while another module attached it, refused a missing required answer at Matter creation, and verified stored answers across detach/archive/restore. In-use Matter type reassignment moved the record; restoration did not move it back. Status checks covered immutable mappings, same-Category Matter reassignment, a Contract Status blocked while used and archived after moving the Contract, plus lower-role refusal. Officer role archive moved both current and resigned appointments to Other; restoration preserved that reassignment.

Templates were created and reopened with Priority/Risk, title prefix, Field defaults, two Tasks and a relative Key date. Direct Matter creation checked UTC offsets, Manager-targeted assignment and an undated/unassigned Task. Editing/archiving affected future choices while existing work remained unchanged; restoration recovered the edited definition. Request conversion independently checked the relative dates and the different routing defaults: Summary/Urgency provide title/Priority, Risk and Manager remain unset, and carried answers override template defaults. The partial-save supplement demonstrated an earlier saved Description after a later Task write failed, followed by successful reload and retry.

Forms covered fixed Contract/Matter targets, module-only and No target variants, an incompatible module attachment refusal, independently required form answers, two actual Portal submissions and conversions, a form-only answer retained on the Request, and an archived configured target requiring an explicit live conversion choice. Published Knowledge guidance opened from the Matter form. An external-address link used an owned local login page to verify new-tab behavior; this does not claim third-party site availability. A malformed address was refused before its correction.

Approver groups admitted Nadia/Priya and refused Contributor membership with 422. Applying the group made two Pending requests. Editing membership to Nadia/Daniel, archiving and restoring left the earlier Nadia/Priya requests unchanged. Legal could not access group configuration or write it directly.

Reminder checks replaced the lead-time list through Settings, rejected duplicates/731, protected its final entry and saved keyboard order. The actual worker job produced a two-day reminder and a Mailpit briefing for the fresh eligible colleague; the eight-day date was excluded. The bell linked to the Contract Key dates, while the email named the actual checkpoint. Audit filters combined actor, action, record kind and search; the matching CSV was downloaded and inspected. Empty results and Clear filters recovered as documented; Legal and Contributor were redirected and received API 403. Audit facts establish saved changes; the separate actual mail observation establishes delivery.

Discovery checked all five contextual Help titles, exact-title search, focused article/section headings, formal links, keyboard focus, three themes at 320/720/1440 CSS pixels and emulated 200 percent zoom. All five titles were available anonymously in the formal preview with zero application API calls.

## Independent walkthrough

A second agent, independent of the author, followed the five guides on the same owned lab and recorded its own observations. It used its own fictional definitions, records, request types, groups and recipients under an `Ind` prefix, and it read reader controls rather than replaying the author's scripts; API calls only prepared labelled fixtures and corroborated saved state. Article hashes and real UTC timestamps sit in every record.

| Record                                                                        | Scenario                      | Passed steps | Failed attempts |
| ----------------------------------------------------------------------------- | ----------------------------- | -----------: | --------------: |
| [repair-field-type](independent-repair-field-type.json)                       | V-C38                         |            1 |               0 |
| [requiredness](independent-requiredness.json)                                 | V-C38                         |            0 |               1 |
| [requiredness-retry](independent-requiredness-retry.json)                     | V-C38                         |            0 |               1 |
| [requiredness-retry2](independent-requiredness-retry2.json)                   | V-C38                         |            1 |               1 |
| [requiredness-retry3](independent-requiredness-retry3.json)                   | V-C38                         |            2 |               1 |
| [requiredness-retry4](independent-requiredness-retry4.json)                   | V-C38                         |            5 |               1 |
| [requiredness-retry5](independent-requiredness-retry5.json)                   | V-C38                         |            2 |               0 |
| [roles](independent-roles.json)                                               | V-C38                         |            5 |               2 |
| [roles-retry](independent-roles-retry.json)                                   | V-C38                         |            2 |               0 |
| [statuses](independent-statuses.json)                                         | V-C38                         |            0 |               1 |
| [statuses-retry](independent-statuses-retry.json)                             | V-C38                         |            5 |               0 |
| [taxonomies](independent-taxonomies.json)                                     | V-C38                         |            6 |               1 |
| [repair-anchor](independent-repair-anchor.json)                               | V-C39                         |            1 |               0 |
| [template-create](independent-template-create.json)                           | V-C39                         |            0 |               1 |
| [template-create-retry](independent-template-create-retry.json)               | V-C39                         |            3 |               1 |
| [template-record](independent-template-record.json)                           | V-C39                         |            0 |               1 |
| [template-record-retry](independent-template-record-retry.json)               | V-C39                         |            0 |               1 |
| [template-record-retry2](independent-template-record-retry2.json)             | V-C39                         |            0 |               1 |
| [template-record-retry3](independent-template-record-retry3.json)             | V-C39                         |            1 |               0 |
| [template-recovery](independent-template-recovery.json)                       | V-C39                         |            0 |               2 |
| [template-recovery-retry](independent-template-recovery-retry.json)           | V-C39                         |            2 |               1 |
| [templates](independent-templates.json)                                       | V-C39                         |            2 |               1 |
| [templates-retry](independent-templates-retry.json)                           | V-C39                         |            3 |               1 |
| [templates-retry2](independent-templates-retry2.json)                         | V-C39                         |            4 |               0 |
| [convert-gaps](independent-convert-gaps.json)                                 | V-C40                         |            3 |               0 |
| [forms](independent-forms.json)                                               | V-C40                         |            1 |               1 |
| [forms-corrections](independent-forms-corrections.json)                       | V-C40                         |            2 |               1 |
| [forms-corrections-final](independent-forms-corrections-final.json)           | V-C40                         |            2 |               0 |
| [forms-corrections-retry](independent-forms-corrections-retry.json)           | V-C40                         |            2 |               1 |
| [forms-retry](independent-forms-retry.json)                                   | V-C40                         |            3 |               1 |
| [forms-retry2](independent-forms-retry2.json)                                 | V-C40                         |            4 |               1 |
| [guidance](independent-guidance.json)                                         | V-C40                         |            0 |               1 |
| [guidance-retry](independent-guidance-retry.json)                             | V-C40                         |            2 |               1 |
| [guidance-retry2](independent-guidance-retry2.json)                           | V-C40                         |            0 |               1 |
| [guidance-retry3](independent-guidance-retry3.json)                           | V-C40                         |            3 |               0 |
| [repair-forms](independent-repair-forms.json)                                 | V-C40                         |            1 |               0 |
| [repair-submit](independent-repair-submit.json)                               | V-C40                         |            1 |               0 |
| [request-type-archive](independent-request-type-archive.json)                 | V-C40                         |            0 |               1 |
| [request-type-archive-retry](independent-request-type-archive-retry.json)     | V-C40                         |            0 |               1 |
| [request-type-lifecycle](independent-request-type-lifecycle.json)             | V-C40                         |            0 |               1 |
| [request-type-lifecycle-retry](independent-request-type-lifecycle-retry.json) | V-C40                         |            2 |               0 |
| [submit](independent-submit.json)                                             | V-C40                         |            1 |               1 |
| [submit-retry](independent-submit-retry.json)                                 | V-C40                         |            1 |               2 |
| [submit-retry2](independent-submit-retry2.json)                               | V-C40                         |            1 |               2 |
| [submit-retry3](independent-submit-retry3.json)                               | V-C40                         |            1 |               2 |
| [submit-retry4](independent-submit-retry4.json)                               | V-C40                         |            1 |               2 |
| [submit-retry5](independent-submit-retry5.json)                               | V-C40                         |            2 |               1 |
| [audit](independent-audit.json)                                               | V-C41                         |            1 |               2 |
| [audit-retry](independent-audit-retry.json)                                   | V-C41                         |            2 |               2 |
| [audit-retry2](independent-audit-retry2.json)                                 | V-C41                         |            1 |               3 |
| [audit-retry3](independent-audit-retry3.json)                                 | V-C41                         |            3 |               1 |
| [reminders-config](independent-reminders-config.json)                         | V-C41                         |            0 |               1 |
| [reminders-config-retry](independent-reminders-config-retry.json)             | V-C41                         |            3 |               0 |
| [reminders-delivery](independent-reminders-delivery.json)                     | V-C41                         |            3 |               0 |
| [repair-audit](independent-repair-audit.json)                                 | V-C41                         |            3 |               0 |
| [repair-reminders](independent-repair-reminders.json)                         | V-C41                         |            1 |               0 |
| [groups](independent-groups.json)                                             | V-C55                         |            0 |               1 |
| [groups-retry](independent-groups-retry.json)                                 | V-C55                         |            1 |               4 |
| [groups-retry2](independent-groups-retry2.json)                               | V-C55                         |            4 |               0 |
| [repair-groups](independent-repair-groups.json)                               | V-C55                         |            4 |               0 |
| [discovery](independent-discovery.json)                                       | V-C38,V-C39,V-C40,V-C41,V-C55 |            6 |               0 |
| [discovery-final](independent-discovery-final.json)                           | V-C38,V-C39,V-C40,V-C41,V-C55 |            6 |               0 |

The independent pass holds 116 passing steps and 54 retained failed attempts across 62 records. Every failure is a reviewer helper mistake, never a relabelled product result: asynchronous required-checkbox state that a plain `check()` could not settle; a submit control named **Create** rather than "Create matter"; select values read as page text; the key-dates envelope key; row-action controls that are buttons in one pane and links in another; the request detail path; a Portal form that confirms in place instead of navigating; the audit Search box colliding with the global Search; an **Export CSV** link read as a button; a member picker whose checkboxes carry no aria-label; and duplicate fixtures left by interrupted attempts.

Seventeen steps that had first been written down as passes were relabelled `fail`, each keeping its original text and timestamps and gaining a `supersededBy` link to the record that establishes the claim properly. Four were caught during the walkthroughs: a scope check that used PATCH where the route is PUT and answered 404 twice, a rail assertion that counted the global navigation, a section reading that captured the Overview picker, and audit counts that printed −1 for an empty table. Thirteen more came from a later reading of the evidence itself: a second −1 count; two audit date-bound steps whose captured query did not correspond to the inputs they described, one of them a transient hybrid taken between two keystrokes; a form attachment list read from an envelope key the endpoint does not answer, ending in `[]` against the step's own opening sentence; an approver-group membership write that used `userIds` where the route takes `memberIds`, so its 400 proved request validation rather than the role rule, alongside a six-name picker sample presented as the whole offer; two group rosters read as `approverName`, leaving the skipped and restored people as `null`; a request-type step claiming a stable identity while recording `requestTypeId unchanged: false`; an `isDisabled()` call on static text recorded as `disabled=null`; a template step recording `Tasks card (false)` yet passing; a section reading that captured the Overview for both Tasks and Key dates; and five Portal steps whose "no Request was created" clause matched an earlier probe's summary instead of proving the refusal created nothing.

One historical capture is annotated rather than failed: the empty lead-time refusal in `reminders-config-retry` observed the right behaviour but clipped its problem envelope mid-`errors`, so the excerpt is marked truncated and a complete sanitized response sits in `repair-reminders`.

The seven `repair-*` records re-establish every superseded claim, and each of their steps throws when the stated outcome is not observed. The audit bounds now come from an awaited response whose query carries exactly the instants the two date controls were set to, checked in both directions; the group checks name people by id and compare whole rosters before and after; the picker list is verified complete against the user list rather than sampled, with a well-formed `memberIds` write drawing the real 422 role refusal; the Portal refusal is proved against a unique summary no other Request carries; the field type is shown to be static text with no control at all; and the template anchor is asserted offset by offset against the new Matter's own creation instant.

The reviewer's own retries also left extra fictional definitions in the lab, including a stray `Ind supplier assessment IND81C9L revised` Matter type and duplicate probe request types, all clearly named and harmless.

### What the independent pass established

Types, Statuses and Fields: rename, keyboard reorder and the immutable Slug; the nine-type Field catalog and its immutable type; attachment-level requiredness refused by name at creation and satisfied by a valid answer; detach and catalog archive both keeping the definition and the stored value; the Global narrowing guard refusing while another module attaches the Field and allowing it after a detach; the six Contract Stages with Draft, Active and Expired locked; a Contract Status blocked at 409 with no reassignment control while a Contract sat on it; a Matter Status offering only same-Category replacements; type and Officer-role archives moving records — resigned appointments included — with Restore never reversing the move; and both lower app roles absent from the Organization rail, redirected from every pane and refused 403.

Matter templates: all four editor areas surviving a reopen; the 0–3650 offset rule; direct creation anchoring a Task on creation+3 and a Key date on creation+7 in UTC, with the Manager-targeted Task assigned and the undated Task left alone; a Manager-targeted Task unassigned when no Manager is chosen; an edit leaving earlier work untouched while the next Matter takes the new definition; archive and restore; a template refused on another Matter type and an archived Matter type refused outright; and an injected 503 on the Tasks write reproducing the guide's partial save, mixed reload state and successful retry.

Request forms: the four Target states with their own explanations; attachable Fields following the target and No target offering Global Fields only; a user-valued Field on a Portal form with its Required box locked; the guidance panel on Portal home and on a chosen form, an `http://` address accepted and a bare host refused; a real Portal submission refused for a missing required answer and then accepted; and a real conversion grouping answers under **Carries into the matter** and **Does not carry into the matter**, leaving the non-carrying answer on the Request.

Reminders and the Audit log: the organization list edited for real, with the duplicate, 731, last-entry and empty-list refusals; a brand-new fictional Legal Team Member on `Asia/Dubai` with no briefing history; the real queued `notification.morning-round` completing in the owned worker on the real clock; an actual Mailpit briefing naming the 4-day and On-the-day Key dates and omitting the 11-day one, with the bell linking to the record; and the audit filters, browser-local date bounds, search boundary, CSV export and Show older.

Approver groups: creation, a picker offering only Administrators and Legal Team Members, a refused Contributor, one Pending row per member stamped with the group, a second apply refused as a no-op, an already-pending member skipped, and edit, archive and restore all leaving earlier requests untouched.

### Corrections the independent pass made

Three `request-forms` sentences did not match the release and were rewritten, then verified again on the corrected bytes.

- **No target.** The guide said No target "leaves the destination choice to Legal". The Settings explanation actually reads "Converting a request of this type creates no record. It is answered in the thread and resolved there", and the convert dialog calls converting one "a re-target". A No target Request was resolved in the thread with no record created. The paragraph now says that.
- **Archiving a request type.** The guide said archiving an in-use request type "asks for a replacement for its Requests" and that Restore does not reverse the reassignment. Request types have no usage counter armed in this build, so a type still carrying a Request reports "is not used by any requests", disables its reassignment control and archives with no replacement; the Request keeps the archived type and stays readable to its Requester, while the type leaves the Portal's cards. The paragraph now describes that, and tells the reader to check what is still open first.
- **The Matter carry-through label.** The cold pass had already replaced "the corresponding Matter section" with the exact heading; a real Matter conversion confirmed **Does not carry into the matter** on screen.

The `approver-groups` correction from the cold pass was also confirmed against the running app. An archived member and an already-pending member are skipped, but a member who is no longer an Administrator or Legal Team Member, or who sits outside a Confidential Contract's audience, is refused by name and the whole apply creates nothing — the Pending count was identical before and after each refusal, so no partial roster is left behind.

### Technical review

The independent agent performed the technical review as source inspection against the release under test, `6a8873db`, and each per-article record carries its own `technicalReview` block naming the reviewer, the method, the completion time and the files read. The two source findings that changed prose are described above under corrections; the reading also confirmed the parts of each guide that the walkthrough could only observe from the outside — that request types are registered without a usage counter, so an in-use count can never be anything but zero; that the Portal filters archived request types out of both its cards and its per-slug form; that one predicate backs the audit page, its count and its export, so the CSV holds the whole filtered set rather than the loaded page; and that the morning round reaches 08:00 in the reader's saved zone rather than firing at a fixed hour.

One omission is recorded rather than fixed here. Taking an audit export appends its own `export.performed` entry at the Administrator-only tier, and the guide does not mention it. Nothing the guide says about the export is wrong, so the prose is unchanged and its hash stands; a later batch can add the sentence and reverify.

This is an agent review of the implementation, not a feature owner's sign-off and not the user's proofreading. Both remain open.

### Not established here

Technical review and the walkthrough were done by the same agent, so they are two methods rather than two independent people, and neither is a human feature owner's sign-off on behaviour accuracy. The lab is the owned local fixture at source `6a8873db`, so it says nothing about a real provider account, and DOC-025 still owns reconciliation against the final app candidate and the aggregate coverage report. Issues [#770](https://github.com/juggernog20/OpenLaw/issues/770) and [#774](https://github.com/juggernog20/OpenLaw/issues/774) remain open and are documented as limits, not fixed.

## History and remaining work

The earlier Request pilot evidence remains unchanged and is linked from the new per-article record's `previousEvidence`. The Matter template guide was expanded to state conversion defaults explicitly after the initial direct-creation checks; later supplement/discovery records carry the new hash. Older records retain their actual hashes and dates.

Known [#770](https://github.com/juggernog20/OpenLaw/issues/770) (cleared optional template default returns at creation) and [#774](https://github.com/juggernog20/OpenLaw/issues/774) (blank Entity-valued Field on Matter Overview lacks choices) remain open and are described as limits. No application behavior changed in this task. The actual older runtime identity remains recorded; DOC-025 must reconcile the final app candidate. The AI configuration forward link belongs to DOC-022 and remains unpublished. Real provider-account verification is separate from this batch's local fixtures.

## Checks and review disposition

Static checks passed: 19/19 uncached. Documentation/CI tooling passed 33/33. Normal documentation build passed with zero warnings; preview passed with nine known forward links, mainly provider/operator guides. The full workspace suite passed 5/5 uncached in 3m53.04s (API 2,890 tests; web 1,704). No browser walkthrough ran concurrently with that suite.

CodeRabbit CLI ran once and completed with twelve findings. Seven wording clarifications were applied: more precise recipient/checkbox language in this report; protected Contract Status-to-Stage mapping; separate Status navigation paths; Archive terminology; Task assignments; explicit removal of archived templates from creation choices; and Audit log terminology.

Five suggestions were not applied after checking the source:

- Rewriting this internal evidence report as second-person commands misapplies DES-015's component/system-copy scope. It would turn observed results and pending review into instructions to a reader.
- Rewriting factual guide explanations as commands such as keeping an immutable Slug fixed would imply a user choice that does not exist. EDITORIAL.md explicitly permits explanations and requires accurate conditions/consequences.
- **Custom field defaults** is the exact visible template-editor heading in this build. The guide retains that UI label while using Field in ordinary prose.
- Reverting the current template article hash to an earlier author's hash would misidentify the current article. Earlier observations retain their actual hashes; later supplement/discovery used the expanded conversion explanation. Per-article independent status was `not-run` when this disposition was written; the independent walkthrough has since verified the final bytes and each record now reads `pass`.
- Restricting Deflection links to HTTPS would contradict both the current UI and validation, which accept HTTP and HTTPS. The local browser check exercised HTTP, and the guide does not claim the link itself creates a security guarantee.

The independent Opus 5 review then checked every guide claim against the app source and raised two corrections, both applied here. `approver-groups` now separates the two apply outcomes the source draws apart: an archived or already-pending member is left out of the ask, while a member who is no longer an Administrator or Legal Team Member, or who sits outside a Confidential Contract's audience, refuses the whole apply by name and creates nothing (`apps/api/src/modules/contract-approvals/routes.ts`, `apps/api/src/lib/approvers.ts`). `request-forms` now names the exact Matter conversion heading, **Does not carry into the matter**, instead of describing it. The `approver-groups` and `request-forms` per-article hashes were reissued for the new bytes; the author records retain their historical hashes. The approver-group correction adds an outcome the earlier author run did not exercise, so its independent walkthrough must cover it.

The independent pass reran the checks on the final bytes: `format:check`, `secretlint` and `docs:lint` clean, documentation CI tooling 33/33, the documentation build with zero warnings, and `DOC_ENGINE_TEST_IMAGE=openlaw-doc-engine:test pnpm exec turbo run test --continue -- --maxWorkers=8` green at 5/5 tasks in 3m52.979s (API 176 files / 2,890 tests; web 97 files / 1,704 tests). No browser walkthrough ran while that suite was running.

Earlier author and reviewer hashes remain historical; the per-article hashes identify the current bytes. The independent corrections are prose-only and change no application behaviour, so the full workspace suite, the documentation builds and tooling, formatting and the secret scan were rerun on the final bytes. Feature-owner technical review and DOC-025's aggregate reconciliation remain open.
