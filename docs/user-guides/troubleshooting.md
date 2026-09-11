# Resolve common problems

Start with the symptom you can see. These checks cover Legal Team Members, Administrators, Contributors, and Business Users. Follow the linked procedure for your role; an operator investigating a service failure should use [operator troubleshooting](operator-troubleshooting.md).

## I cannot sign in

Check the app address and account email with your Administrator. Staff and Contributors use [staff sign-in](staff-sign-in.md); Business Users use [Portal sign-in](portal-sign-in.md). Follow the method your organization has enabled. A Portal email link does not turn a Business User into a staff user.

If a link is expired or already used, request a new link and open the newest message. Check spam and mailbox filters if it does not arrive. If the configured sign-in method or expected message remains unavailable, ask your Administrator to check your account and [authentication and email](authentication-and-email.md). Give the visible error and time, without forwarding a sign-in link or password.

## A record or search result is missing

Check the signed-in account, the module, your search words, and active filters or saved view. Return to the module's ordinary list and follow [search and views](search-and-views.md). An absent result does not prove deletion.

A direct link may show **Something went wrong.** and **Reload** for either missing work or work you cannot reach. Reopen after a temporary connection failure; repeated reloads do not change access. Ask the Contract Owner, Matter Manager, or Administrator to check [your role and record access](roles-and-access.md). Contributors need a team entry on that particular Contract or Matter. Confidential Entities need their own access arrangement; a linked record does not grant access.

Business Users should reopen their own Request in the Portal. Conversion does not grant access to the resulting staff Contract or Matter page. For missing published Knowledge, ask Legal whether the item is still published, live, and shared with your audience. See [follow a Request](follow-request.md) and [Portal Knowledge](portal-knowledge.md).

## An edit or action is unavailable

Check whether the owning record is archived and whether your role permits the action. A Contributor can supply business information and supporting Documents on shared work, but cannot change its legal-managed details, complete Tasks, give Approval, or send for signature. Follow [Contributor work](contributor-guide.md) and ask Legal to perform the required legal action.

If a save reports an error, keep your intended value, follow the displayed correction, and reload to confirm what actually saved. Do not assume an unchanged page means the save succeeded. Administrators can investigate configured Fields and required answers through [types, Statuses, and Fields](types-statuses-fields.md).

## An upload is refused or appears twice

Read the refusal: an oversized file needs a smaller copy or an operator-approved limit change; a filename problem needs a corrected name. Check the destination list before retrying an uncertain upload. If the first upload succeeded, sending it again as a new Document creates a separate chain.

For another round of the same managed paper, use [Add version](document-versions.md). Contributors cannot append to a Contract's primary Document. Portal attachments belong to the Request conversation and do not provide a Document Version-history control. See [file limits](reference.md#file-behavior-and-limits) and [Request updates](follow-request.md).

If valid uploads repeatedly fail, give your Administrator the visible message, time, file type and size, and the intended action. Share record details only through your organization's approved channel.

## A preview stays pending or fails

**Preparing this document for reading…** can appear after the original has uploaded successfully. Wait or return later. Try **Download** to read the original. For **This file could not be prepared for reading here. Download it to read it.**, use the original in a suitable application and follow [Document preview recovery](document-previews.md).

Reopening the same Version is not a processing retry. Obtain a readable replacement and add a Version if the original is damaged. If valid files repeatedly fail or remain pending, ask your Administrator to investigate processing, the worker, and the document engine. Include the Document and Version through the internal support channel.

An original download failure needs a separate check of current access, archive/deletion state, and stored-file availability. A new upload cannot restore the missing bytes of an older Version.

## A notification or email is missing

Check that the event addressed you, that you still have access, and that the relevant notification group is enabled. Your own edit normally does not notify you. For staff, check the group's **In-app** and **Email** choices and any **Briefing** section. Business Users check **Request updates** in **Notification settings**. Turning In-app off also stops that group's new email.

For morning updates, check the saved profile timezone and relevant tracked date. Delivery is not promised at exactly 8:00 a.m. Follow [notifications and reminders](notifications.md). If a bell item exists but mail does not arrive, check spam and filters, then ask your Administrator to check delivery. A bell item does not prove email receipt. For an urgent reply, open the record or Portal Request directly.

## I cannot approve, or an Approval warning appears

Check the named person and whether the Approval Request is still Pending. Only that person can answer it, and decided requests cannot be edited into another decision. A new decision requires a new request. Ask Legal to check access and whether the Contract is archived.

**Move past approval** warns about unresolved Pending or Rejected requests. Follow [Approval decisions and the warning](contract-approvals.md); cancel if you are not ready to proceed. An internal Approval does not sign the Document, and moving Status does not resolve the outstanding decisions.

## Electronic signing is unavailable or the executed copy is missing

Check your role, the Contract's archive state, its primary Document, and whether a live Envelope already exists. Ask your Administrator whether the Signing connector is enabled. Follow [electronic signing](electronic-signing.md) for the permitted action and its result. After an uncertain send, reload the Envelope list before retrying.

A **Signed** Envelope can still be waiting for the executed file to be stored. Check **Executed copy** and the Document Version rather than relying on the Envelope label alone. If filing failed, follow the guide's recovery or [manual signing](manual-signing.md). Manual hand-off is available without the connector. Provider connection and callback failures need Administrator/operator investigation; user workflow guidance is not evidence that a particular provider connection is healthy.

## Analysis is missing, fails, or keeps an earlier value

Check your role, whether the Contract is Ended or archived, whether a run is already pending, and whether Analysis is enabled. The target is the primary Document's executed pin, or its current Version when there is no pin. Its extracted text must be ready and non-empty.

Follow [Contract analysis](contract-analysis.md) to compare the run's Version and evidence with the actual saved Fields. **Kept** means the existing value was preserved. **Unverified** values are already saved and usable; do not confirm them merely to clear a warning. Review the source Document Version and correct or confirm each value you have checked.

If a run failed, resolve the reported processing or provider problem before running again. Ask your Administrator about connector or Field-prompt configuration. Never put provider keys or private extracted text in a public report.

## If the problem continues

Contact your Administrator through your organization's usual channel with your role, action, time, expected result, and exact visible error. Include private record links only in that internal channel. For a product defect or documentation correction, follow [version information and support](versions-and-support.md) to prepare a report with fictional steps and the applicable edition details.

## AI conversion or source evidence is unavailable

If a Convert dialog is preparing a Conversion draft, wait for its completion or use manual conversion. Retry a failed preparation after checking the Type and sources. The Matter and Contract preparation switches are independent. An Administrator can check them in [AI analysis settings](configure-analysis.md).

A Contract can finish conversion before its background field-filling Analysis run finishes. The **AI analysis** card shows progress, completion or failure. A failure does not undo creation. Select **Retry Request-context Analysis** after checking the Type, sources and enabled filling switch. A late reply cannot replace human edits or explicit clears.

Purple borders and **Unverified** identify AI-written values. A sparkle opens saved source evidence without another AI call or leaving the record. Document citations open the original Version in the doc panel and locate its quote when possible. Removed Documents, changed or deleted messages and lost access can make evidence unavailable. Use the original source or ask an authorized colleague to check it before confirming. Disabling a workflow leaves existing evidence and individual confirm/edit usable.
