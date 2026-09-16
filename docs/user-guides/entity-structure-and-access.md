# Manage Entity structure and access

Maintain simple share-capital facts, inspect the ownership chart and linked work, and control access to Confidential Entities.

## Before you start

Legal Team Members and Administrators can maintain reachable, live Entities. A Confidential Entity requires a Grant for every person, including Administrators. A person with a Grant on an Entity can change its Confidential flag and Grants. An Administrator can also change them while the Entity is not Confidential. The person who adds an Entity receives a Grant for it. Business Users do not have Entity access. A Holding, Officer user link, or linked Contract does not grant access to the Entity.

## Maintain share capital

1. Open the Entity's **Overview** and find **Share capital**.
2. Enter **Authorized shares** and **Issued shares** as needed. Each accepts a whole number of zero or more; leave a value blank when it is unknown.
3. To record a par value, choose **Currency** first. **Par value** stays unavailable until a Currency is chosen. Then enter the amount in that currency, with no more decimal places than the currency uses.
4. Move focus away or press Enter to save each value. Check its saved result. Press Escape to abandon an unsaved edit.

The card has one **Currency**, and it applies only to the par value. When you change the Currency, the par value amount stays the same. The card has no share classes, shareholder register, or full capitalization table. Do not treat these values as a complete register. Negative values, fractional share counts, and par values with too many decimal places are refused without replacing the saved value.

## Read the ownership chart

1. Open **Entities** and select **Chart**. Create or correct Holdings through the Entity's [Ownership tab](entity-records.md#add-or-correct-a-holding).
2. Read the connected Entities and percentages. The chart uses one primary owner to arrange each Entity and draws that Holding as a solid line. Other Holdings remain visible as dashed secondary connections. An Entity with no Holdings appears in a separate row.
3. Drag to pan or use the mouse wheel to zoom. With the chart focused, use arrow keys to pan, plus or minus to zoom, and zero to fit the chart. **Fit to window** also resets the view.
4. Click an Entity once, or focus it and press Space, to highlight its ownership chain. Select **Clear highlight** or press Escape to remove the highlight. Double-click an Entity, or focus it and press Enter, to open it. A **Confidential Entity** box is an Entity you cannot reach. It shows no name and does not open.

The chart is a view of recorded Holdings between your own Entities. It does not include external shareholders. Its primary owner is the owner with the highest recorded percentage; it does not require an owner to hold more than 50%. A Holding relationship does not inherit a Status or access permission. A warning about ownership totals over 100% means the entries need review; it does not mean they failed to save.

## Read linked Contracts and Matters

Open the Entity's **Contracts** or **Matters** tab. Contracts appear through their **Our entity** selection. Matters appear through saved Entity-valued Fields. If such a Field is later detached from the Matter type, its saved value can keep the link until that value is cleared.

Rows and tab counts reflect the work records you can reach. A Confidential Contract or Matter outside your access contributes neither a row nor a count. Linking it to a reachable Entity does not widen its audience. These tabs show relationships, not stored totals or an analytics report.

## Grant access to a Confidential Entity

A person with a Grant on the Entity performs these steps. While the Entity is not Confidential, an Administrator can also perform them.

1. Open **Overview** and find **Confidentiality**. Select **Manage access**.
2. In **Confidential access**, choose a live Legal Team Member or Administrator in **Person** and select **Grant access**. Confirm that the person appears in the list.
3. Check that the list includes every person who must keep access, including you. When the Entity is Confidential, a person who is not in the list cannot reach it. This applies to Administrators too.
4. Close the dialog. Turn on **Confidential — restrict to the access list** and check the saved result. OpenLaw refuses this change when no live person is in the list.
5. To withdraw access, open **Manage access** and use **Remove name**. Confirm that the person has left the list. OpenLaw refuses to remove the last live person from a Confidential Entity; grant access to another person first. Turning the Confidential switch off makes the Entity available to all Legal Team Members and Administrators without Grants.

A Grant covers this Entity and the records owned by it, subject to the person's existing role. It also lets that person change this Entity's Confidential flag and Grants. It does not confer an Administrator role or unlock linked Confidential Contracts, Matters, or other Entities. A person without the right to change access sees the Confidential switch as unavailable and has no **Manage access** button. An Administrator without a Grant cannot open a Confidential Entity or give themselves a Grant; ask a person with a Grant.

Most unreachable Entities are silently absent from lists, search, calendars, and pickers. Where the app retains a known relationship, such as a Holding or a Contract's signing-Entity reference, it can show **Restricted Entity** without the legal name or a navigation link. The ownership chart shows such an Entity as **Confidential Entity**. Removing a Grant preserves the recorded relationship while withdrawing the reader's access.

Restore an archived Entity before changing its facts or Grants. If a person cannot open an Entity after receiving a Grant, check that the Grant names the correct account, the account is active, and the Entity is the intended record. Follow [roles and access](roles-and-access.md) for the shared access rules.
