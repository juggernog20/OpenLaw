# Manage Entity structure and access

Maintain simple share-capital facts, inspect the ownership chart and linked work, and control access to Confidential Entities.

## Before you start

Legal Team Members and Administrators can maintain reachable, live Entities. Only an Administrator changes the Confidential flag or Grants. Contributors and Business Users do not have Entity access. A Holding, Officer user link, or linked Contract does not grant access to the Entity.

## Maintain share capital

1. Open the Entity's **Overview** and find **Share capital**.
2. Enter **Authorized shares** and **Issued shares** as whole numbers of zero or more. For **Par value**, choose a **Currency** and enter the amount in that currency—for example, 1.25 for USD 1.25. Leave an amount blank when it is unknown.
3. Move focus away or press Enter to save each value. Check its saved result. Press Escape to abandon an unsaved edit.

Numbers display thousands separators when you leave the field. Par value accepts the selected currency’s decimal precision; negative amounts and excess decimal places are refused. Changing currency keeps the displayed amount without converting exchange rates. Older records need a currency selected before editing par value; their stored minor-unit amount is preserved when assigning the first currency. Share classes, shareholder registers, and full capitalization tables are not included.

## Read the ownership chart

1. Open **Entities** and select **Chart**. Create or correct Holdings through the Entity's [Ownership tab](entity-records.md#add-or-correct-a-holding).
2. Read the connected Entities and percentages. The chart uses one primary owner to arrange each Entity; other Holdings remain visible as secondary connections. An Entity with no recorded owner can appear separately.
3. Drag to pan or use the mouse wheel to zoom. With the chart focused, use arrow keys to pan, plus or minus to zoom, and zero to fit the chart. **Fit to window** also resets the view.
4. Open a named Entity from its chart link. A **Restricted Entity** is not a navigable record for you.

The chart is a view of recorded Holdings between your own Entities. It does not include external shareholders. Its primary owner is chosen from the recorded percentages; it does not require an owner to hold more than 50%. A Holding relationship does not inherit a Status or access permission. A warning about ownership totals over 100% means the entries need review; it does not mean they failed to save.

## Read linked Contracts and Matters

Open the Entity's **Contracts** or **Matters** tab. Contracts appear through their **Our entity** selection. Matters appear through saved Entity-valued Fields. If such a Field is later detached from the Matter type, its saved value can keep the link until that value is cleared.

Rows and tab counts reflect the work records you can reach. A Confidential Contract or Matter outside your access contributes neither a row nor a count. Linking it to a reachable Entity does not widen its audience. These tabs show relationships, not stored totals or an analytics report.

## Grant access to a Confidential Entity

An Administrator performs these steps:

1. Open **Overview** and find **Confidentiality**. Turn on **Confidential — restrict to the grant list** and check the saved result. Administrators retain access automatically.
2. Select **Manage access**. In **Confidential access**, select a **Legal Team Member** and choose **Grant access**.
3. Confirm that the person appears in the list. That person can now reach this Confidential Entity and the records owned by it, subject to their existing role.
4. To withdraw the exception, use **Remove name**. Confirm that the person has left the list. Turning the Confidential switch off makes the Entity available to Legal Team Members without Grants.

Only live Legal Team Members can receive explicit Grants. A Grant covers this Entity; it does not confer an Administrator role or unlock linked Confidential Contracts, Matters, or other Entities. Legal Team Members cannot change the flag or Grants themselves.

Most unreachable Entities are silently absent from lists, search, calendars, and pickers. Where the app retains a known relationship, such as a Holding or a Contract's signing-Entity reference, it can show **Restricted Entity** without the legal name or a navigation link. Removing a Grant preserves the recorded relationship while withdrawing the reader's access.

Restore an archived Entity before changing its facts or Grants. If a person cannot open an Entity after receiving a Grant, check that the Grant names the correct account, the account is active, and the Entity is the intended record. Follow [roles and access](roles-and-access.md) for the shared access rules.
