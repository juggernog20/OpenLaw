# Configuration guide verification

Five canonical articles cover C38–C41 and C55 for [#741](https://github.com/juggernog20/OpenLaw/issues/741). Four are new; `request-forms` extends the existing Contract pilot to Matter targets, form variants, guidance and conversion gaps. There are now 46 authored articles of 56 planned. This is feature-review content. Independent technical review and five Administrator walkthrough scenarios remain pending; the catalog does not claim publication or final-candidate acceptance. The user will proofread once the full suite is assembled.

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
- Reverting the current template article hash to an earlier author's hash would misidentify the current article. Earlier observations retain their actual hashes; later supplement/discovery used the expanded conversion explanation. Per-article independent status remains not-run until the final bytes are independently verified.
- Restricting Deflection links to HTTPS would contradict both the current UI and validation, which accept HTTP and HTTPS. The local browser check exercised HTTP, and the guide does not claim the link itself creates a security guarantee.

These final wording clarifications do not add or change a workflow. Earlier author hashes remain historical; the per-article hashes identify the current bytes for the independent review. The full application suite is retained for these prose-only clarifications; documentation builds/tooling, formatting and secret checks are rerun. Independent Opus 5 review and browser verification plus final-commit CI remain pending.
