# Manage Entity structure and access

Maintain share-capital facts and the share register, inspect the ownership chart and linked work, and control access to Confidential Entities.

## Before you start

Legal Team Members and Administrators can maintain reachable, live Entities. A Confidential Entity requires a Grant for every person, including Administrators. A person with a Grant on an Entity can change its Confidential flag and Grants. An Administrator can also change them while the Entity is not Confidential. The person who adds an Entity receives a Grant for it. Business Users do not have Entity access. A Holding, a share register entry, an Officer user link, or a linked Contract does not grant access to the Entity.

## Maintain share capital

1. Open the Entity's **Overview** and find **Share capital**.
2. Enter **Authorized shares** and **Issued shares** as needed. Each accepts a whole number of zero or more; leave a value blank when it is unknown.
3. To record a par value, choose **Currency** first. **Par value** stays unavailable until a Currency is chosen. Then enter the amount in that currency, with no more decimal places than the currency uses.
4. Move focus away or press Enter to save each value. Check its saved result. Press Escape to abandon an unsaved edit.

The card has one **Currency**, and it applies only to the par value. When you change the Currency, the par value amount stays the same. Negative values, fractional share counts, and par values with too many decimal places are refused without replacing the saved value.

A par value saved before par values had a currency shows its stored minor units and a note under the field. Choose a **Currency**. In **Confirm par value currency**, check the amount OpenLaw shows and select **Confirm amount and currency** only if it is correct.

These three values are declared totals. Share classes, Holders, and certificates live in the share register on the **Ownership** tab. That tab compares **Issued shares** with the register's issued total.

## Keep the share register

The share register records each dated movement of shares as a Register entry. OpenLaw works out the Register of members from the entries. You cannot add a Holder by hand. A Holder exists because an entry names it.

### Set up share classes

1. Open the Entity's **Ownership** tab. A new register shows **No share register yet**.
2. Select **New share class**. On a register that already has classes, select **Share classes** on the **Register of members** card instead, then **New share class**.
3. Enter **Name**. Optionally enter **Authorized shares**, **Votes per share** (it starts at 1), **Par value** with its **Currency**, and a **Rights summary**. Leave **Authorized shares** blank for no cap.
4. Select **Save**. The class shows its authorized count, votes per share, and entry count.

A class name must be unique on the Entity. You can edit a class at any time. Its archive control is available only while no entry uses the class.

### Record an entry

1. Select **Record entry**. It is unavailable until the Entity has a live share class.
2. Choose **Entry**: **Allotment**, **Transfer**, **Buyback**, **Cancellation**, or **Conversion**. Set **Effective date**. It starts at today.
3. Choose the Holders the entry needs:
   - **Allotment**: **To** only. New shares go from the company to the Holder.
   - **Transfer**: **From** and **To**, two different Holders.
   - **Buyback**: **From** only. The shares go into treasury.
   - **Cancellation**: **From** a Holder, or leave **Treasury (shares the company holds)** to cancel treasury shares.
   - **Conversion**: **From** only, with **From class** and **To class**. The Holder keeps the converted shares.
4. For each Holder, pick an existing Holder, or choose **Entity from the registry…** and pick an Entity, or choose **New individual…** and enter a **Full name**. The registry list leaves out this Entity and archived Entities.
5. Choose **Class** and enter **Shares** as a whole number of 1 or more. Optionally enter **Price per share** with its **Currency**, **Consideration**, **Distinctive numbers**, **Resolution reference**, and **Note**.
6. Under **Certificates**, select the checkbox of each live certificate the entry cancels. To issue a certificate, select **Issue certificate** and enter its number, its Holder, its share count, and optionally its distinctive numbers.
7. Select **Enter in register**. Check the new row in **Register of allotments and transfers** and the Holder's balance in **Register of members**.

To correct an entry, use the edit control in its row. The label has the entry number without leading zeros, for example **Edit entry 3**. The dialog title shows the padded number, **Edit entry 003**. Change the values and select **Save**. To delete the entry, use **Remove entry 3** in its row. The confirmation asks **Remove entry 003 from the register?** Select **Remove**. OpenLaw replays the register without the entry and never reuses its number.

OpenLaw replays the whole register with every change. It refuses an entry that would take any balance below zero on any date, cancel a certificate that is not live for that Holder and class, repeat a certificate number, or create an ownership loop. The refusal shows in the dialog, and the register keeps its saved entries. Allotting more shares than a class authorizes is not refused. A warning such as **1,200 Ordinary shares are issued against 1,000 authorized.** shows above the register.

### Read the register at a date

The register opens at today. To read it at an earlier date, choose the date in **Register as of**, or use **Previous entry date** and **Next entry date** to step between entry dates. **Reset to today** returns to today.

At an earlier date, **Register of members** shows the Holders on that date and a **Change to today** column. Entries after that date stay in the list but are dimmed. The line under **Register as of** states the issued total on that date.

Each class with issued shares has one row per Holder in **Register of members**, a **Treasury** row when the company holds shares of that class, and a total row with the class terms. To narrow the entries list, select **Filter** and choose **Class**, **Entry**, **Holder**, or **Effective date**.

**Export register** downloads the Register of members at the chosen date as a CSV file. **Export** on the entries card downloads every entry as a CSV file, whatever filters are set.

### Check the register against Share capital

The line under **Register as of** compares the register's issued total today with **Issued shares** on **Overview**. When they match, it reads, for example, **Today the register agrees with Share capital: 1,000 issued.** When they differ, it names both figures, for example **Today the register does not agree with Share capital. The Overview declares 900 issued; the register sums to 1,000.** Correct the entries or the declared value until they agree. When **Issued shares** is blank, the line still reports agreement, so enter the declared value before you rely on this check.

### How the register writes Holdings

After each entry change, OpenLaw rewrites this Entity's owner Holdings from today's register. Each Holder's percentage is its outstanding shares across every class over the Entity's outstanding shares, to two decimals. These Holdings appear on the ownership chart like any other Holding. On an owner Entity's **Holdings in other Entities** card, they show **From register**. You cannot edit them as Holdings; record a register entry instead. Each entry change also appears in the History of this Entity and of each Entity Holder it names.

## Read the ownership chart

1. Open **Entities** and select **Chart**. Create or correct Holdings through the Entity's [Ownership tab](entity-records.md#add-or-correct-a-holding) or its [share register](#keep-the-share-register).
2. Read the connected Entities and percentages. The chart uses one primary owner to arrange each Entity and draws that Holding as a solid line. Other Holdings remain visible as dashed secondary connections. An Entity with no Holdings appears in a separate row.
3. Drag to pan or use the mouse wheel to zoom. With the chart focused, use arrow keys to pan, plus or minus to zoom, and zero to fit the chart. **Fit to window** also resets the view.
4. Click an Entity once, or focus it and press Space, to highlight its ownership chain. Select **Clear highlight** or press Escape to remove the highlight. Double-click an Entity, or focus it and press Enter, to open it. A **Confidential Entity** box is an Entity you cannot reach. It shows no name and does not open.

The chart shows recorded Holdings between registered Entities and their individual owners, including Holdings written from a share register. Individuals appear by name with the label **Individual**. Opening an individual takes you to the associated Entity's **Ownership** tab. Individual names follow that Entity's access restrictions and appear in chart exports. An Entity's primary owner is the owner with the highest recorded percentage; it does not require an owner to hold more than 50%. A Holding relationship does not inherit a Status or access permission. A warning about ownership totals over 100% means the entries need review; it does not mean they failed to save.

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

Most unreachable Entities are silently absent from lists, search, calendars, and pickers. Where the app retains a known relationship, such as a Holding, a share register Holder, or a Contract's signing-Entity reference, it can show **Restricted Entity** without the legal name or a navigation link. You can edit a register entry that names a Holder you cannot reach, but you cannot replace or remove that Holder. OpenLaw refuses with **This entry names an Entity you cannot see. That holder stays until someone who can see the Entity changes it.** The ownership chart shows such an Entity as **Confidential Entity**. Removing a Grant preserves the recorded relationship while withdrawing the reader's access.

Restore an archived Entity before changing its facts, share register, or Grants. If a person cannot open an Entity after receiving a Grant, check that the Grant names the correct account, the account is active, and the Entity is the intended record. Follow [roles and access](roles-and-access.md) for the shared access rules.
