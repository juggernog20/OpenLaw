# Analysis and Comparison guide verification

C21 and C29 for [issue #735](https://github.com/juggernog20/OpenLaw/issues/735).
Two guides cover Contract analysis and Document Version Comparisons. Author
walkthroughs use the actual app UI, real processing, and fictional records. All 50
author checks passed on the recorded article hashes. A different agent, the Fable
review seat, then checked the guides against the committed app source and followed
all five scenario/role combinations with its own scripts; every one passed on the
final guide bytes. Agent checks are not a human user study or a feature owner's
approval.

## Build and fixture

The separate `analysis-workflow` lab runs unchanged app source
`a28331f779da3c8b9e9172dee3cc5b58c7170c7b`, with the application and engine image
identities recorded in every walkthrough. It has its own database, storage,
worker, mail catcher, and provider service. The app is at
`http://127.0.0.1:43304`, Mailpit at `http://127.0.0.1:48429`, and the draft reader
at `http://127.0.0.1:43316`. [Fixture provenance](analysis-fixture.json) records
source and configuration digests. This batch changes no app runtime code.

Analysis uses a deterministic local OpenAI-compatible protocol stand-in based on
the pinned source's E2E provider seam. Known fictional paper and prompted Fields
receive known answers. The real app and worker select the source Version, build
the prompt, validate evidence, write values and markers, and record outcomes.
Private loopback controls pause replies and return invalid JSON to exercise a
terminal provider failure. Generated fixture credentials remain private. This
satisfies the declared C21 workflow mode; it does not verify a real provider
account or satisfy C43. Provider setup is prerequisite preparation, not an
Administrator guide walkthrough.

Comparisons use the real Document engine and worker, without a comparison stub.
Only this lab's worker is briefly paused to observe **Preparing comparison**,
then resumed. Word files contain known differences: thirty/monthly,
sixty/quarterly, and ninety/annually. Supporting Documents use Word/Word,
PDF/Word, unsupported TXT/PDF, and intentionally malformed PDF/PDF pairs.
A download-only primary placeholder keeps these fixtures separate from automatic
Contract analysis. Setup APIs create prerequisites and team memberships; browser
sessions perform the documented Comparison actions.

Daniel Okafor is Administrator, Nadia Haddad is Legal Team Member, Ravi Menon is
Contributor, and unrelated Priya Raman is a Legal Team Member outside the
Confidential fixtures. All people, records, paper, values, and addresses used
here are fictional. Private helpers and raw downloads remain under
`/tmp/openlaw-docs-run/735-*`; no session tokens or credentials are published.

## Author walkthroughs

| Evidence                                                   | Checks | Outcomes                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | -----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Analysis](author-analysis.json)                           |     18 | Both legal roles: prerequisites, automatic/manual triggers, pending updates, source Version/model/quotes, Written/Kept/Invalid/Unsupported/Unmatched, one confirmation, edits, executed pin, changed input, concurrent edits, provider failure/retry, cleared-value refill, supporting paper, operational dates/Value, role and archive restrictions.                        |
| [Failed Analysis extraction](author-analysis-failure.json) |      2 | Both legal roles: an actual failed primary PDF extraction prevents Run analysis and queues no run.                                                                                                                                                                                                                                                                           |
| [Comparisons](author-comparison.json)                      |     24 | All three roles: pending/ready Word comparison, operand selection, change navigation, Generated redline export and exact downloaded tracked changes, provenance/idempotence, excluded Generated redline operands, archive/restore, text mode, durable failed pairs, original downloads, corrected new pair, No changes for different bytes, and Confidential access refusal. |
| [Help and formal discovery](author-discovery.json)         |      6 | All five article/role combinations through contextual Help, search, focused headings/sections, and formal links; three themes at 320/720/1440 CSS pixels; both titles available anonymously without app API calls.                                                                                                                                                           |

Each record includes guide hashes, actual build, environment, date, roles,
actions, and outcomes. API readback verifies persisted values, access refusals,
Version counts, and processing states. Downloaded Generated redlines are independently
opened as ZIP/XML to verify actual tracked insertions and deletions. Contributor
export refusals are followed by Administrator prerequisite setup of a Generated redline
Document Version, which the Contributor can then read and download; this is not credited
as a Contributor export.

## Corrections and limits

Existing confirmed or human-edited values are kept during Analysis. Clearing an
optional core value can allow a later run to fill it again; the guide and checks
cover notice period refill. The latest returned **Kept** answer can differ from
the saved value, so the guide tells readers to inspect the source and saved field.
Confirmed expiry stayed October 17 while a newer result returned November 17;
a concurrent human location edit survived completion. Unverified dates and Value
already affect the saved record and derived Key dates before confirmation.
Ended prevents another run but permits confirmation; archive prevents both.

Unsupported TXT files supply no extracted text. A failed Comparison pair is
durable: reopening does not retry processing. A corrected new Version/new pair
is the tested recovery, including a Contributor asking a permitted uploader to
prepare it. **No changes** describes text equality; the tested PDF originals have
different hashes. An archived owner may leave the export control visible, but
the real export refuses the write; restoring the owner allows a retry.

Early author runs stopped on harness assumptions about native select accessible
names, whitespace in selected-change text, and the host's group-switch command.
A focused browser probe confirmed that operand selection immediately opens the
new pair; no app selector defect was found. An overlapping API suite created transient Docker networks and interrupted early
Help checks with Chromium ERR_NETWORK_CHANGED. Discovery was rerun after the
suite ended. Final records contain only complete runs against the recorded guide bytes. Earlier fictional prerequisite records
remain in this disposable lab.

The Comparison guide changed once after its author walkthrough, during the Fable
review: the archive sentence now says "a person who can read the Document" instead
of "a reached reader". The behaviour it describes is unchanged. The article
evidence record carries the new hash and names the edit; the author records keep
the hash they ran against. The pending independent walkthrough covers the current
bytes.

Both articles stay in review pending their linked guides: Document Versions and
Document reading and processing (DOC-017) and Analysis connector setup (DOC-022).
DOC-025 owns final acceptance on the supported publication build.

## Independent walkthrough

The Fable review seat first checked each guide's claims against the committed app
source at `a28331f7`, then followed both guides with its own Playwright scripts on
September 7, 2026, in the same analysis-workflow lab. It reused the sign-in, API,
paper-generation, upload and provider-control helpers, the author's Contract
types, prompted Fields, Counterparty and comparison files, not the author's steps
or assertions. Every walked record was created fresh with a `Rev` prefix.

C21 ran as Administrator (C-56) and Legal Team Member (C-58) with the reviewer's
own fictional paper and known answers: a 60-day notice and a March 31, 2027 expiry
in Version 1, an unknown Counterparty name (Unmatched, nothing linked), a
non-numeric tier (Invalid) and a quote absent from the paper (Unsupported); then a
90-day notice, a June 30, 2027 expiry, the real Counterparty name (linked, Written)
and tier 2 in Version 2. The other legal role edited a prompted Field while a run
waited at the local provider; the provider control supplied the pause and one
malformed reply. A separate Contract per role (C-57, C-59) held only a malformed
primary PDF. That satisfies the declared C21 workflow mode only, not C43.

C29 ran as Administrator (C-65), Legal Team Member (C-66) and Contributor (C-67)
on Contracts prepared by the Administrator's API session. Each role opened
**Compare with previous** while this lab's worker was paused, read **Preparing
comparison**, then **Changes** after the worker resumed; chose pairs with **Older**
and **Newer**; moved through changes; used the reader's **Compare** link and
**Close comparison**; read the text-mode PDF/Word pair; hit the TXT and
malformed-PDF failures with working **Download** links and no retry; compared the
Administrator's corrected PDF as **No changes** with different bytes; and read
Comparisons on an archived Document and an archived owner. Legal roles exported
Version 4 from v1 → v2 and, after Restore, Version 5 from v2 → v3; both downloaded
files carried the expected `w:ins` and `w:del` runs. The Contributor was refused
every export and read the Administrator's prepared redline. Priya Raman got 404.

All five scenario/role combinations passed on the final guide bytes. Help
discovery, search by title and by control name, the outline, the formal reader,
three themes at 320/720/1440 CSS pixels, the signed-out formal edition, and the
committed lab's exclusion passed. The sanitized step records are in
[independent-walkthrough.json](independent-walkthrough.json) and
[independent-discovery.json](independent-discovery.json); the per-article evidence
files under `docs/documentation/evidence/` cite them and now read `pass`. Earlier
reviewer runs failed on harness assumptions (a message read after navigation, the
reader panel's landmark role, the add-version envelope, the pair control's option
order), not on app or guide behaviour; the records name them and hold only the
completed runs. No guide text changed because of the walkthrough. This is an
agent walkthrough, not a human user study, and it does not stand in for the
feature owner's approval.

## Repository validation

The full workspace suite passed: 2,889 API tests across 176 files and 1,702 web
tests across 97 files, with all five Turbo tasks successful.

All 19 static tasks and all 33 documentation/tooling tests passed. Normal and
preview documentation builds passed. Preview reports 14 links to unpublished
targets owned by later writing batches.

After the independent walkthrough and the evidence records, the review seat ran
the same full workspace suite again (`pnpm exec turbo run test --continue --
--maxWorkers=8`, inside the docker group with the local doc-engine test image):
176 API test files with 2,889 tests and 97 web test files with 1,702 tests passed,
all five Turbo tasks successful, exit code 0. The 33 documentation/tooling tests,
the normal and preview documentation builds, prettier, the documentation lint, and
secretlint on the new records also passed.

## CodeRabbit disposition

CodeRabbit ran once and reported nine findings. The substantive fixture
clarification was applied: C29 now names its PDF/Word pair and explicitly tests
plain TXT as an unsupported extracted-text input. Evidence terminology was
normalized to Generated redline and Document Version without changing recorded
execution times, hashes, or outcomes.

CodeRabbit's second run, after the independent walkthrough, reported eight
findings. One factual clarification was applied. The author Comparison archive
record's shared sentence omitted the intermediate Document restore and, for the
Contributor, implied that a legal-role export had occurred. The author script
archives the Document, checks reading and the export refusal, restores the
Document, archives the owning Contract, checks again, and restores the owner;
only the Administrator and Legal Team Member then retry the export and reach
Version 5. Each role's recorded outcome now states that sequence and its own
result, read back from the saved fixtures: C-49 and C-50 hold five Document
Versions, C-51 holds four, and nothing is archived. Execution times, guide hashes
and the checked actions are unchanged, and no other role's action is credited to
the Contributor. The V-C29 prerequisites now also name the plain TXT/PDF pair
that both the author and the independent walkthrough used.

The remaining suggestions were rejected. The claim that a Generated redline is
not a Version contradicts `CONTEXT.md`, which defines a Generated redline as the
Document Version a Comparison's export appends to the chain, and the export route,
which answers with that Version; both guides and records keep "Generated redline
Document Version". The repeated imperative rewrites of this record and of the
WRITING-BATCHES status line are declined for the reason given above: these
report completed and pending verification work rather than instruct a reader.
Renaming "Unverified dates and Value" in the check summary would drop the exact
fields whose operational effect was tested. Replacing "run" with "Analysis run"
throughout the analysis guide, and every "Versions" with "Document Versions" in
the Comparison guide, would change verified bytes for wording the guides already
introduce in full at first use.

Seven minor suggestions were left unapplied. Four requested imperative rewrites
of explanatory prose or verification status records; the procedures already use
instructions where the reader acts, and the records report completed or pending
work. Replacing **History** with **Audit log** would name the wrong visible
control for the tested record activity. The suggested capitalized capability
name “Contract Analysis” is not the glossary's “Analysis run”; the guide already
distinguishes the capability and each run's input and outcome. The Comparison
guide already introduces Document Versions and correctly uses singular Generated
redline for the one file exported from a pair, so a blanket plural/title rewrite
would not improve its accuracy.
