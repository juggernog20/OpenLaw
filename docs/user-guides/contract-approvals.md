# Request and give approval

Create Approval Requests for named colleagues and read their decisions on the Contract.

## Before you start

Sign in as a Legal Team Member or Administrator with access to an unarchived Contract. Approval Requests record internal decisions; they do not sign the Document or send it to a Signer. For Confidential work, staff approvers must already have the required access. Business approvers receive a limited review packet in the Portal.

## Ask for approval

1. Open the Contract's **Approvals** tab.
2. Select **Add approver**. Choose one or more people under **Approvers**.
3. Select **Request approvals**. Check each new **Pending** row.

Everyone selected is asked at once and may answer in any order. A person with a pending request is not offered for a duplicate. The picker offers all active users, including Business Users. On a Confidential Contract, it offers only staff who can already open the Contract, plus Business Users.

If the Contract's primary Document is marked Confidential, a staff approver outside that Document's audience is refused by name. A Business approver is not refused. Their review packet shows no Document unless they are already in that Document's audience.

**Apply group** appears when an Administrator has configured a live group, or when the Contract has a default group. Select **Apply group**, choose the **Approver group**, and inspect the named people and any skipped pending requests before you select **Apply group** in the dialog. Applying a group asks its current members. Later edits to the group do not rewrite existing requests.

A Contract inherits its type's default group when it is created. The dialog then starts on that group. If an Administrator allows only Administrators to override the default, a Legal Team Member cannot change the choice. The dialog says **Only an administrator can choose a different group.** If the default group has been archived, the dialog shows **Default group unavailable — contact an administrator**. Choose another group if you may override the default; otherwise ask an Administrator. See [Configure reusable Approver groups](approver-groups.md).

## Give a decision

When your in-app notifications are on, a request made by someone else is pinned under **Your approvals** in the notification bell. Select **Review** to open the request. The pinned item stays until the request is decided or cancelled.

As the named approver, open the Contract and find your row. Open its actions and choose **Approve** or **Reject**. The dialog says a decision is final. Add a **Note** if useful, then select **Approve** or **Reject** in the dialog. Check the resulting **Approved** or **Rejected** row and note.

Only the named person can answer their request. Other people see no **Approve** or **Reject** action on that row. A decision is final. To ask again after a decision, add a new approval request; the earlier decision stays in history.

For a pending request, its requester, the Contract's Legal Owner, or an Administrator can use **Cancel request**. It takes effect at once, without a confirmation. Cancellation removes the pending row and records the action. It does not erase a decided approval.

## Move beyond Approval

Changing from a Stage at or before Approval to one beyond it can open **Move past approval** if approvals remain Pending or Rejected. Read every unresolved row. **Cancel** keeps the current Status; **Move anyway** saves the new Status and records an override. The unresolved approvals keep their own decisions.

The app provides parallel requests and reusable groups. It does not apply a sequential approval chain or automatic threshold rules. [Change a Contract Status](contract-stages.md) covers the Stage control.

## If an action is unavailable

Check whether the request is still pending, whether it names you, and whether the Contract is archived or outside your access. If a group contains someone who cannot reach Confidential work, review access or ask an Administrator to correct the group before trying again. Business approvers receive access only to their own review packet.

After an uncertain save, reload the list before requesting another approval. [Notifications](notifications.md) explains where an eligible recipient may see the request and how preferences affect email.

## Approve from the business portal

Select **Approvals** in the Portal navigation bar. The page is **Your approvals**. **Pending** lists your outstanding requests; **Completed** shows your previous decisions. Search by Contract title or requester name, then open a request.

Review the primary Document beside the decision panel. Supported Documents open in the shared viewer; use **Download** when a preview is unavailable. If the page shows **No document attached**, contact the requester. Enter a **Note (optional)**, then choose **Approve** or **Reject**. The decision saves at once, without a confirmation. Your decision appears on the Contract for Legal. Only you can answer a request assigned to you, and a completed decision cannot be changed.

An approval request does not add you to the Contract team or reveal internal comments, custom fields, or other Documents. Withdrawing the request or archiving the Contract removes access to the review page. Approval notifications link directly to your Portal review page.
