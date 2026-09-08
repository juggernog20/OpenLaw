# Manage Contract terms and renewals

Record the term and notice information, then record a renewal using the appropriate action.

## Before you start

Sign in as a Legal Team Member or Administrator with access to an unarchived Contract. Check the actual paper before entering dates. The app records your information; a reminder or proposed date does not establish that a renewal occurred.

## Record the term

On **Overview**, use the **Contract** card. Choose **Term type**, then complete the applicable **Effective date**, **Expiry date**, **Renewal period (months)**, and **Notice period (days)**. Save one change at a time and check its result.

| Term type     | Information to check                                                                |
| ------------- | ----------------------------------------------------------------------------------- |
| Fixed term    | Record the applicable effective and expiry dates. There is no renewal-period value. |
| Auto-renewing | Record expiry, the renewal period in months, and any notice period in days.         |
| Evergreen     | There is no expiry date. Changing to Evergreen clears an existing expiry.           |

Changing away from Auto-renewing clears a renewal period the new type cannot hold. Review the saved values after changing type. The app can leave unknown values unset; do not enter a guessed date just to fill a box.

**Term timeline** draws the recorded dates. In **Key dates**, **Current term expires** and **Renewal notice deadline** are derived from the Contract's term. The notice deadline is expiry minus the notice period; change the underlying term to correct it. Task due dates do not feed these deadlines. [Contract Tasks and Key dates](contract-tasks-and-dates.md) covers separately maintained dates.

## Confirm a renewal on the same Contract

1. On an Auto-renewing Contract with an expiry, open **Approvals** and select **Renew**, or use the **Renewal pending confirmation** prompt when shown.
2. Choose **Confirm the roll** under **How to record it**.
3. Review **New expiry date**. A known renewal period supplies a proposed date; enter the actual date if it differs. The new date must be after the current expiry.
4. Select **Confirm renewal**. Check the new expiry, notice deadline, **Last renewal**, and the renewal row on **Approvals & signing**.

The app does not advance expiry automatically. Confirmation changes the term without changing the Status or Stage. If somebody already changed the expiry, review the refreshed current expiry and your entered new date before another attempt. Cancel and reopen **Renew** to see a fresh proposed date; two competing confirmations must not record the same roll twice.

## Record a differently papered renewal

The same **Renew** dialog offers other routes:

- **Paper as amendment** opens the existing primary Document's **Add version** flow with an Amendment kind. File the paper there. Amendment is a kind, not an executed designation. If this Document Version should be the chain's executed copy, [mark it explicitly](manual-signing.md). Marking it replaces any existing executed designation in that Document chain. This choice creates no new Contract and does not itself advance expiry. The option is absent without a primary Document. If you just uploaded the first Document, reload the record before reopening **Renew**.
- **Create child contract** opens the create dialog for a new Contract parented to this one.
- **New successor contract** opens the create dialog for a new Contract linked as renewing this predecessor.

For a child or successor, review and edit the prefilled Title and Contract type and complete required Fields. Check the resulting new C- reference and relationship after creation. The deal's Entity, Counterparties, value, and term shape carry over; Owner, team, Status, Priority, Risk, and Confidential flag need their own review. A relationship does not grant access or keep future changes synchronized.

## If the dates look wrong

Inspect the saved Term type and underlying values, then reload after a failed or competing save. Read any **Unverified** marker before relying on an analysis-written date; [Contract analysis](contract-analysis.md) explains verification. See [Notifications](notifications.md) for recipient and preference limits. An ended or archived Contract is handled differently from an active renewal; [ending and archiving](contract-relations-and-ending.md) explains those states.
