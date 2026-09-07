# Document guide verification

C26–C28, C30, and C54 for [issue #737](https://github.com/juggernog20/OpenLaw/issues/737). Five canonical guides cover Document Versions and conversation filing, folders/import, previews/downloads, repository discovery, and archive/restore/deletion. Author checks passed. A separate review seat then checked the guides against the committed app source and walked all 16 required scenario/role combinations with its own fixtures, steps and assertions; the per-article evidence records read `pass`.

## Build and method

The conversations lab runs immutable app source `a28331f779da3c8b9e9172dee3cc5b58c7170c7b`, app image `sha256:7434e1b1802330e3f3499a0fba3dfcc0b8a04fc875561071e17f4ad5a1c29c0d`, and engine image `sha256:16ab8ea3bcaf1d43619d6e3cff879d2f313c5e366a36a7ae285a5baa7ae15ed0`. Its project is `openlaw-docs-b8e31260-conversations`; app/mail ports are 43302/48427 and the draft Help preview is 43312. No app runtime or immutable deployment input changes are included.

Separate browser contexts represent fictional Daniel Okafor (Administrator), Nadia Haddad (Legal Team Member), Ravi Menon (Contributor), and Jonas Weber (Business User). API calls prepare fictional records and read back results. Procedures credited as browser checks operate actual controls; deliberate API or browser-network fixtures are named in each record. Guide hashes and actual UTC times accompany every run. Screenshots are unnecessary for these text procedures. These are agent walkthroughs, not human user studies or feature-owner approvals.

## Author records

| Record                                           | Checks |
| ------------------------------------------------ | -----: |
| [versions](author-versions.json)                 |     15 |
| [folders](author-folders.json)                   |     12 |
| [previews](author-previews.json)                 |     27 |
| [repository](author-repository.json)             |      9 |
| [supplement](author-supplement.json)             |      5 |
| [boundaries](author-boundaries.json)             |      6 |
| [discovery](author-discovery.json)               |     16 |
| [portal-discovery](author-portal-discovery.json) |      1 |

All 91 author checks passed against the guide bytes each record names. Five of those records name bytes that later changed: see "Author record hashes after the corrections" below. The independent review used fresh walkthroughs rather than reclassifying these author checks.

## Findings and boundaries

Single uploads and appends preserve Version order, bytes, notes, and provenance. Hand-set kind correction is distinct from the executed-copy pin; a new Document Version leaves an older pin intact. Primary designation moves between separate Documents. Contributors upload supporting Documents, cannot append to a primary Contract Document, and have no kind, folder, archive, restore, or deletion controls. Contract conversation filing offers New Document or New Version, retains the attachment and Filed to marker, and is a legal-role action; Matter comments do not expose it.

Both legal roles created nested folders, renamed/moved them, hit invalid-name and cycle restrictions, moved Documents, and dissolved a folder without deleting its paper. Both legal roles and the Contributor completed a two-file import with one deliberately injected 503 response: the good file survived, and Retry resent only the failed file. A native directory filechooser preserved top-level/nested file paths and omitted empty directories. The import destination is a readout fixed by the gesture, not a selector; the guide was corrected before the final walkthrough.

All staff roles read PDF, converted Word/PowerPoint, a scanned PDF with verified OCR output, PNG, and EML; each browser download matched the uploaded bytes. Download-only rows download directly. A deliberately corrupt DOCX container reached failed rendition; its original still downloaded, and appending a valid Word file produced a readable v2 while retaining v1. Plain text merely named .docx converted successfully, so that early fixture did not count as a processing failure. The final failure fixture is a malformed ZIP container.

The Business User downloaded their own Request attachment and current published Knowledge files, with no staff repository or Version controls. Portal Knowledge lists downloads and has no in-app Document preview; the draft was corrected accordingly. Draft, Legal-only, and archived Knowledge links were refused. Repository checks covered all four owner arms, current-Version landing, composed filters, Confidential owner exclusions, role restrictions, archived-row restoration, and empty-result recovery.

Archive/restore retained the chain and designations for both legal roles. The Administrator's incorrect typed name disabled Delete, Cancel preserved the Document, and correct confirmation removed all three Version downloads and the row. Legal and Contributor direct deletion attempts were refused. Archived owning-record setup removed upload controls, and restoring that owned fixture returned them. Per-blob storage inspection is not claimed by these browser download checks.

## Discovery and remaining verification

Each staff role found all five applicable guides through Help from the repository or a record's Documents tab, searched their exact titles, followed outline links with focused headings, and opened formal documentation. The Business User did the same for the preview/download guide from a Request's Help. Theme/layout checks covered Light, Dark, and Warm at 320, 720, and 1440 CSS pixels without horizontal overflow. An anonymous formal-index check made no application API requests.

An initial discovery attempt found the temporary preview stopped; it was restarted before successful runs. Help searches retain contextual topic filters, so the completed checks enter Help from each guide's appropriate record/repository/Request surface. Earlier harness attempts also corrected a switch versus checkbox assumption, an automatically expanded folder, plain-text email rendering, and two equivalent Download links on a failure card. Only complete passing runs appear in the records.

The independent walkthrough below covers the 16 scenario/role combinations and the keyboard and zoom checks. DOC-025 governs full-suite acceptance, and DOC-027 publishes the feature-review edition and export. Shared Knowledge/operator links remain dependencies until their own batches land. User proofreading is scheduled after the complete suite is assembled.

## Repository validation

Author static checks passed (19 tasks), along with 33 documentation/CI tooling tests and normal/preview documentation builds. The full workspace suite passed in 4 minutes 21 seconds: 176 API files / 2,889 tests, 97 web files / 1,702 tests, all five Turbo tasks successful. CodeRabbit completed once. The repository walkthrough and staff Help discovery were rerun after the role-name capitalization correction, so every author record matched the guide bytes as they stood when the author finished. Three later corrections changed two of those guides; the independent review below records which author records still match and which do not.

## CodeRabbit disposition

The single CodeRabbit run raised thirteen findings. Three terminology suggestions are applied to this evidence record: Document Versions and conversation filing are named separately, supporting Documents and new Document Versions replace ambiguous references, and Legal-only names the tested Knowledge audience.

The minor checklist and major whole-record imperative rewrites are declined. These files report verification states rather than telling a reader what to do; changing them to instructions would make those states less clear. User-facing procedures already use direct action language. No behavioral guide change was needed.

The remaining suggestions were assessed against the source and browser results. The repository guide now capitalizes Legal Team Member consistently. The proposed Owner-to-Owning-record label change is declined: the actual filter is labeled Owner. References to Legal name the department and can include an Administrator, so replacing them with only Legal Team Member would narrow the recovery guidance. Expected-result strings retain the scenario registry wording; input files that fail an import are not yet logical Documents. Contributor root-only upload is already explicit in the folder guide and linked Version guidance. These suggestions do not justify inventing controls or changing the meaning of the required scenarios.

## Independent walkthrough

The review seat first read the five guides against the committed app source at
`a28331f7`. It read the documents card and its row menus, the batch import dialog and its
retry rule, the render-family table, the folder name and cycle rules, the repository
query and its scope, the comment filing dialog, and the archive, restore and erasure
routes. It then followed each guide in the same conversations lab with its own
Playwright scripts on September 7, 2026. It created fresh fictional records under a
`Rev` prefix and reused none of the author's records, steps or assertions. The author's
91 checks are supporting evidence only.

| Independent record                                        | Steps |
| --------------------------------------------------------- | ----: |
| [versions](independent-versions.json)                     |    27 |
| [filing](independent-filing.json)                         |     7 |
| [folders](independent-folders.json)                       |    16 |
| [previews](independent-previews.json)                     |    30 |
| [portal](independent-portal.json)                         |     4 |
| [repository](independent-repository.json)                 |    25 |
| [archive](independent-archive.json)                       |    11 |
| [discovery](independent-discovery.json)                   |    38 |
| [folders-supplement](independent-folders-supplement.json) |     3 |
| [erasure](independent-erasure.json)                       |     2 |
| [help-presentation](independent-help-presentation.json)   |    11 |

All 174 steps passed. Each record names the acting role, the method, the action, what was
actually observed, and the start and finish time of that step. The first eight records are
the original walkthrough; the last three close gaps a later audit named and are described
under "Supplemental checks" below.

C26 ran as all three staff roles: one file created one Document at v1 named from its
filename; picking two files replaced the composer with the Import dialog; Add version
raised the chain while v1 kept its note, kind, filename and author and still opened in
its own reader; identical bytes uploaded again made a second chain rather than a merge.
Both legal roles renamed a Document through Edit details without touching its chain,
read a Kind control offering the six hand-set kinds and no Generated redline, corrected
v2 without moving the executed pin or the bytes, pinned the older v1 and watched a fresh
v3 leave that pin alone, moved Primary between two Documents, and found neither
designation on a Matter. The Contributor uploaded supporting paper, saw a row menu with
no kind editor, folder picker or designation item, and was answered 403 when appending
to the Contract's primary Document. For every role an archived owning record offered no
Upload control at all and restoring it brought the control back.

Contract conversation filing ran as both legal roles: a Legal only attachment opened
**File attachment** with **New Document** chosen and the Confidential switch already on,
and filing it created a one-Version Confidential Document with the comment reading
**Filed to**; the second destination appended v2 with its own kind and note while v1 and
its filename stayed put. The same attachment on a Matter conversation offered no File
control anywhere, and the Contributor's own attachment offered none either and never
became a managed Document.

C27 ran as all three roles. Both legal roles created a parent folder and a child inside
it, renamed the child in place, and were refused a case-only duplicate, a blank name, a
slash, `.` and `..`, each with a visible message and nothing created. The Move picker
offered the record root and unrelated folders but neither the folder itself nor its
descendant. Move to folder filed a Document and then moved it back to the record. Delete
stated where the contents would go, dissolved only the folder and left the Document live
in the parent. A two-file import with one upload answered 503 once reported
"Imported 1 of 2 files", named the failed row with a per-row **Retry** and a
**Retry 1 file** action, kept the good file as a v1 Document, and closed on
"Imported 2 of 2 files"; one **Version kind** applied to both files and no per-file Note
was collected. **Cancel remaining** stopped a four-file queue part way, leaving the
finished files on the record. The folder picker carried the top-level folder and its
nested child with paths intact and dropped the empty directory. The Contributor imported
two files at the record root as two separate v1 Documents, was offered no **New folder**
button and no **Choose folder** control, and was answered 403 by the folder seam. A later
supplement completed the two things this run left open: a folder **Move** for each legal
role, and the partial-import failure and retry for the Contributor.

C28 ran as all three staff roles and the Business User. Each staff role opened a PDF with
the five reader controls the guide names, read converted Word and PowerPoint while the
download stayed the uploaded DOCX and PPTX byte for byte, confirmed a scan's text arrived
with source `ocr`, found a word that exists only inside an uploaded file through the app's
global search, saw a PNG inline, read an email's headers, body and 2 attachments strip
with nothing fetched from the remote image host and only the PDF attachment opening in a
preview, and downloaded a CSV straight from its row without a reader. Holding the
rendition read at pending drew **Preparing this document for reading…** while the stored
original stayed downloadable. A deliberately damaged DOCX reached a failed rendition,
drew the guide's exact recovery card, still downloaded its original, and recovered
through a v2 that rendered while the failed v1 stayed in the chain. After a disposable
Document was permanently removed, its Version download answered 404 while a different
Document still previewed and downloaded. Those are the two outcomes the guide separates. The
Business User supplied a file on their own Request thread and downloaded it back byte for
byte with no reader, no v… indicator and no Version-history control, found the staff
repository refused and its address closed, read published Knowledge with the primary
Document listed above the second file and each with its own **Download**, and found an
archived item no longer available until it was restored.

C30 ran as all three staff roles. **Recent** drew at most five rows in newest-current-
Version order, matching the seam's own five-row answer. The **Owner** control offered
All, Contracts, Matters, Entities and Knowledge; both legal roles found paper under all
four arms, while the Contributor's Entities and Knowledge arms were empty and drew the
no-match message. **Record** narrowed to one owning record and made **Folder** available
with **Record root**; with Knowledge chosen the Folder control was absent and the seam
refused a Knowledge folder outright. A Format, Kind, Uploader and two-date combination
returned only rows matching every one of them, held today's upload in an inclusive
same-day window, and lost the row when one value changed; the Counterparty filter
answered Contract-owned paper only. Recent disappeared while a filter was active and
returned on **Clear all**. Opening a row landed on the owning record with the reader on
the current round. Paper on a Confidential Contract stayed out of the list, out of a
Record-filtered list and out of a direct link for the two roles outside its team; for the
Administrator it was listed and correctly attributed, because an Administrator reaches
every Contract and the guide never claims otherwise. Both legal roles used
**Show archived** and the repository's **Restore**; the Contributor had no such control
and the seam returned no archived rows.

C54 ran as all three staff roles. Archive removed the row in one action and
**Show archived** returned it marked **Archived** with all three Versions, the executed
pin on v2 and every stored file still downloadable; **Restore** brought back the chain
and the designation. While the owning Contract was archived a restore was refused and the
record offered no Document controls; after the record was restored the Document restored
normally, and a second restore from another session answered 409, which is the stale
state the guide tells the reader to reload on. The Administrator found **Delete** disabled until the
Document's displayed name was typed exactly, saw a wrong name keep it disabled and
**Cancel** leave all three Versions in place, then confirmed and watched the row go and
all three Version downloads answer 404 with no replacement primary chosen; the record's
History still named the erased Document afterwards, and asking the seam to remove a single
Version was refused while that chain kept both rounds. Neither the Legal Team Member nor
the Contributor was offered **Delete**, both were answered 403, and their Versions stayed
listed and downloadable. The row, the downloads and the History entry are browser and API
observations. That an erasure removes the stored files themselves is checked directly in
the supplement below.

## Independent discovery, keyboard and zoom

Each staff role entered Help from the record or repository surface each guide belongs to,
found the guide by its exact title, opened it with the H1 focused, followed an outline
link to a focused section heading, and reached the same article in the full documentation.
Every guide fitted in the light, dark and warm themes at 320, 720 and 1440 CSS pixels with
no horizontal overflow. Those theme and zoom loops ran on the formal `/documentation`
reader, which the reader reaches through the full-documentation link; the same checks on
the in-app Help pages are in the supplement below. Help itself was opened with one pointer
click on the page's banner Help link, and from there the run was keyboard only: Tab reached
the guide link and Enter opened it with the title focused, and Tab then reached an outline
link whose Enter moved focus onto that heading. Zoom was **emulated**, not operated: Playwright has no zoom
menu, so 200% is expressed as a 640 by 450 CSS-pixel viewport at device pixel ratio 2,
which is the layout Chromium produces for a 1280 by 900 window at its 200% setting. At that
layout every guide fitted without horizontal overflow. The Business User reached the
reading guide from their own Request thread's Help, and signed out the formal index listed
all five titles and made no application API request.

The portal's contextual Help entry matters: the header **Help** link opens the topic-scoped
index that lists the reading guide for this audience, and the completed check enters Help
that way.

## Corrections made during the independent review

Two guide defects were found and fixed, and both were then walked again with the corrected
bytes recorded. A third correction, the terminology one, landed later and is a copy-only
change; it has its own section below.

- `document-folders` used the en-GB spelling "Organise" in its heading while its own body
  used en-US "organize". `EDITORIAL.md` requires en-US, so the heading, the catalogue
  title, the writing-batch checklist line and the C27 coverage description now read
  "Organize". The documentation build enforces that an article's H1 matches its catalogue
  title, so those move together.
- `document-versions` named the filing dialog's Confidential control as **Confidential**.
  The control's actual label is **Confidential — restrict to the contract team**, which is
  what the browser check reads, so the guide now quotes it in full.
- `document-versions` also used non-glossary words for a Document Version and for the
  Executed pin. See "Terminology disposition" below; that one is copy-only and retains its
  walkthrough evidence.

## Supplemental checks

A later audit of the completed evidence named four gaps. Three needed browser work; all
three are closed, and the records are listed in the table above.

**V-C27 partial import as a Contributor, and a folder Move.**
[independent-folders-supplement.json](independent-folders-supplement.json) closes both.
The Contributor imported two files at the record root with one answered 503 once by a
browser-network fixture. The dialog read "Imported 1 of 2 files", named the failed row
with its reason and a per-row **Retry**, and said the other file was already on the
Contract. The good file was a v1 Document at that moment and the failed one did not exist.
The row **Retry** resent only the failed file, the dialog closed on "Imported 2 of 2
files", and the good Document kept the same id and a single Version, so it was never
uploaded twice. Separately, each legal role completed a folder **Move**: the folder was
relocated under a destination folder, kept its own name, left the destination at the
record root, and the Document filed inside it still named that folder and still held its
single Version. On the record the moved folder reads at `destination/source` with its
paper inside.

**V-C54 evidence precision.**
[independent-erasure.json](independent-erasure.json) replaces two claims that were looser
than what had been observed. The Contributor's row menu was read fresh on a one-Version
chain, where it held exactly `["Add version"]`, and on a two-Version chain, where it held
exactly `["Compare with previous", "Add version"]`. Compare is a read, so it is offered;
no kind editor and no **Show archived** control appeared, and archive, restore and delete
each answered 403 with the Document left live and complete. The erasure was then repeated
with the owned lab's storage volume inspected directly by a read-only listing: before the
deletion, stored files existed under the Document's key, one for each of its three
Versions; after the typed confirmation, none remained. The row, the Version downloads and
the History entry stay what they always were, browser and API observations.

**Help-page presentation.**
[independent-help-presentation.json](independent-help-presentation.json) runs the theme,
width and zoom checks on the authenticated in-app Help article pages at `/help/<article>`,
which the earlier discovery record did not: it checked the formal `/documentation` reader
after following the full-documentation link. Each staff role's applicable guides drew
without horizontal overflow in the light, dark and warm themes at 320, 720 and 1440 CSS
pixels, and each fitted at an emulated 200% zoom while keeping its search box. The record
also adds keyboard operation and an emulated 200% zoom on the Business Portal Help article
at `/portal/help/document-previews`. Zoom is **emulated, not operated**: Playwright cannot
drive the browser's own zoom menu, so 200% is set through CDP as a 640 by 450 CSS-pixel
viewport at device pixel ratio 2, the layout Chromium produces for a 1280 by 900 window at
its 200% setting. Every keyboard run names the one pointer click that opens Help; the
navigation after it is keyboard only.

## Terminology disposition

Two review findings against `document-versions.md` were checked against
[CONTEXT.md](../../../CONTEXT.md) and are valid. The glossary defines a **Document
Version** as the immutable file snapshot and the **Executed pin** as the explicit pin
naming the signed copy.

- Six passages called an immutable Version a "round". They now say Document Version or
  Version.
- Four passages said "executed-copy designation", "executed-copy pin" or
  "primary/executed-copy controls". They now say Executed pin. The UI labels
  **Mark as executed copy** and **Unmark as executed copy** are quoted unchanged, because
  they are what the control says.

Two H2 headings moved with those terms: "Add another round and read the history" became
"Add another Version and read the history", and "Primary Document and executed copy"
became "Primary Document and the Executed pin". Nothing links either anchor. No guide,
evidence record or `redirects.json` entry references `document-versions.md` with a
fragment, and the article is unpublished, so no stable link had to be preserved and no
redirect was added.

This is a **copy-only** change under EDITORIAL.md: no action, prerequisite, control name,
result or meaning changed. The V-C26 walkthrough results are retained rather than re-run,
and `evidence/document-versions.json` records the classification, the previous content
hash, the new one, and why the prior walkthroughs still apply. No fresh V-C26 walkthrough
is claimed for the new bytes. [independent-versions.json](independent-versions.json),
[independent-filing.json](independent-filing.json) and
[independent-discovery.json](independent-discovery.json) keep the previous hash, because
that is the file each of them actually read. The two supplemental records above were run
after the change and name the current bytes.

## Author record hashes after the corrections

The eight author records are kept exactly as they were written. Three guide corrections
have landed since they were made, so five of them name bytes that have changed. That is
honest reporting of what the author actually tested. It is not a defect in those records,
and none of them was restamped.

| Author record                                    | Checks | Named bytes                                            |
| ------------------------------------------------ | -----: | ------------------------------------------------------ |
| [boundaries](author-boundaries.json)             |      6 | pre-correction `document-versions`                     |
| [discovery](author-discovery.json)               |     16 | pre-correction `document-versions`, `document-folders` |
| [folders](author-folders.json)                   |     12 | pre-correction `document-folders`                      |
| [portal-discovery](author-portal-discovery.json) |      1 | matches the current file                               |
| [previews](author-previews.json)                 |     27 | matches the current file                               |
| [repository](author-repository.json)             |      9 | matches the current file                               |
| [supplement](author-supplement.json)             |      5 | pre-correction `document-versions`                     |
| [versions](author-versions.json)                 |     15 | pre-correction `document-versions`                     |

The records that name the current bytes for every guide they touch are the independent
ones listed above, apart from the three noted under the terminology disposition below.

## On the step timestamps

Each record's `at` is written by the recorder immediately after that awaited step settles,
and this seat's records add the `startedAt` of the same step. They are real per-step
completion times, not a single serialisation pass at the end of a run. The runs are short
because these are automated browser assertions against a local instance. C26 ran 27 steps
in 21 seconds, for example. They are not measured human task times, and neither these
records nor this file claims otherwise.
