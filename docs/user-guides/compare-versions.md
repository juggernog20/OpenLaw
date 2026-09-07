# Compare Document Versions and export a Generated redline

A Comparison shows changes between two Document Versions in one Document's chain. It keeps the original Versions intact. Exporting a Word Comparison appends a separate **Generated redline** Version.

## Before you start

Use an Administrator, Legal Team Member, or Contributor account that can read the Document. Have at least two ordinary Document Versions in the same chain. A Generated redline cannot itself be a Comparison operand. See [Document Versions](document-versions.md) to add a Version.

Two supported Word files use Word comparison. A pair containing a PDF or another supported text-extractable format uses extracted text instead, without formatting. Download-only formats cannot supply that text. Processing may need to finish before the Comparison can be read; see [Document reading and processing](document-previews.md).

## Choose the Versions

Open the owning record's **Documents** section. Open the relevant Document or Version's actions and select **Compare with previous**. The Document reader also offers **Compare** when there is a previous eligible Version.

Check the pair shown at the top, such as **v1 → v2**. Open that control to choose **Older** and **Newer** Versions. Choosing a Version opens that pair's Comparison immediately. The choices keep the older Version before the newer one and exclude Generated redlines. To compare work currently held as separate Documents, first put the intended Versions in the same Document's chain through the normal upload workflow.

## Read the changes

**Preparing comparison** means processing is still underway; the page updates when ready. In the ready view, use **Changes**, **Previous change**, and **Next change** to move through changes and read their surrounding text. Insertions and deletions describe the newer Version relative to the older one. Check both operands before relying on the result.

A text Comparison says that it was built from extracted text and that formatting is not shown. It can reveal wording changes but does not compare layout or formatting. **No changes** means the compared text is the same; it does not mean the original files are identical.

Use **Close comparison** to return to the owning record. Reopening the same pair reads its stored Comparison; it does not create another Document Version.

## Export a Word Comparison

An Administrator or Legal Team Member can select **Export track changes** on a ready Word Comparison when the Document and its owning record permit changes. Wait for the export to finish, then select **Open redline**.

The export appends a new Version with the **Generated redline** kind and records the two Versions used to make it. Open or download that Version and check its tracked changes. The original Versions and the Comparison remain available. Exporting the same pair again opens the existing Generated redline rather than appending another one.

Contributors can read Comparisons but cannot export a Generated redline. A text Comparison cannot be exported as tracked changes; Legal Team Members and Administrators see **Export needs two Word files.** Archiving does not stop a person who can read the Document from comparing existing Versions, but it prevents writing a new Generated redline until the Document and owning record are restored.

## If the Comparison fails

Read the failure reason and use the available **Download** links to inspect the original Versions. A Version may have failed text extraction, have no supported extracted text, or contain a Word file that the engine cannot compare.

Reopening a failed pair returns the same failed Comparison. There is no user retry control for that pair. Correct the source problem, add the corrected file as a new Document Version, and compare the new pair. If your role does not offer that upload, ask a Legal Team Member or Administrator to add the correction. For a persistent processing problem, follow [Document reading and processing](document-previews.md) and contact your Administrator. A failed export leaves the Comparison available; read the refusal, resolve the issue, and try the export again.
