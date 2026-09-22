# Submit a Request to Legal

Send Legal a Request with the details and attachments they need to review it.

## Before you start

- [Sign in to your organization's Portal](portal-sign-in.md). A Business User sees their own Requests there.
- Have the information and any files you want Legal to review. The available request types and extra questions are configured by your Administrator.

## Submit the form

1. On the Portal home, read any [**Before you submit** guidance](portal-knowledge.md) and select the request type that matches your work.
2. Enter a **Title** that names what you need. If **Description** is shown, explain the background, the Counterparty if relevant, and the help you want from Legal.
3. Under **Attachments**, select **Choose files** or drop the files onto the form. You can select up to 20 files. Check the selected filenames and remove any you did not intend to send. If you exceed the limit, the form keeps only the files that fit; check the list before submitting.
4. Check **Department**, choose **Urgency**, and complete the additional questions. Required questions are marked with an asterisk. **Department** is required. It starts with your own Department when that Department is in the list; otherwise choose one. Urgency starts at **Medium**; choose **Low**, **Medium**, **High**, or **Critical** to describe your need. This choice does not promise a response time.
5. Select **Submit request** once. If a required answer is missing, fill in the marked question and submit again.
6. Keep the confirmation open until the attachments finish uploading. Note the Request's **R-** reference and check whether any file failed.
7. Select **Open request** to check the saved answers and attachments.

For example, a fictional **Docs Contract review** Request could use the title **Review the Northstar evaluation terms**, an explanation of the proposed evaluation, **High** urgency, and **Procurement** as the Department. Department identifies the business team responsible for this work. Choose it from the shared list. If no live Departments are configured, the form explains that you can submit without one; an Administrator can add Departments in Settings. Legal cannot change it on the Request; conversion carries it to the new record, where it can be changed. These are example values, not required choices.

## Answer conditional questions

The Administrator configures a Form on the destination Contract or Matter type. Its **On intake form** switch chooses the Rows you answer here. **Required for creation** marks an included Row as required; only a Row under a Branch whose condition does not hold is exempt. **Visible on Portal** lets you read a Field on a record you can access; an Intake Field always has this switch on. You do not edit these switches in the Portal.

A **Touchpoint** is where a Row is first collected. It is derived from those switches: Intake when On intake form is on, Creation when required but not on intake, and Record when neither is on. Legal completes Creation Rows during conversion and Record Rows on the resulting record.

A **Branch** shows its child Rows only when its condition holds. For example, choosing **Fixed** for **Term type** may reveal a required **Expiry date**. Choosing **Evergreen** hides it again and removes that requirement. Answer the Rows currently shown. The Portal does not show Branch conditions or editing controls. Hidden answers stay in the form while you change choices, but only the visible Intake Rows are submitted.

Description is configurable, so some forms omit it. **Value** may appear as one Row with amount, currency and cadence. **Counterparties** uses the registry picker; an **Entity** is one of your organization's own entities.

## Check the result

Check **Your requests** on the Portal home, then open the Request to confirm what you submitted. Legal receives a Request to triage; a Contract or Matter is created only if Legal converts it.

Use [Follow a Request and reply to Legal](follow-request.md) to read progress, answer questions, and send further files.

## If it does not work

If required answers are missing, complete the marked questions. A question without an asterisk can stay blank; Legal completes any value its own record needs later. Ask Legal if you cannot answer a required question. You cannot change submitted answers in the Portal; send a correction in the existing Request's conversation.

The confirmation appears as soon as the Request exists, before every attachment has finished. An attachment failure does not undo the Request. Check the named failure and quote the existing R- reference when contacting Legal; submitting the whole form again would create another Request. Open that Request and attach the missing file to a reply. Check any file-size error against the limit shown by your instance.

If Legal decides the Request while its files are uploading, the confirmation may link to a reply on that same Request. Follow the link to send the files that did not attach. The original submission stays saved.

If a form address takes you back to the Portal home, choose an available request type or ask Legal which form to use. If submission reports an error without confirmation, check **Your requests** before trying again in case the Request was saved but the response did not reach your browser.

## Related guides

- [Follow a Request and reply to Legal](follow-request.md).
- [Read Knowledge shared with the business](portal-knowledge.md).
- [Change Portal notification preferences](notifications.md#change-portal-preferences).
