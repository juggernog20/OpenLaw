# Search, filter, and save views

Find records and words inside Documents that you can reach. Administrators and Legal Team Members can use **Search** in the app. Business Users find their Requests, Contracts and Matters through the Portal.

## Search across your work

1. Select **Search** in the header, or press `/` outside a text field.
2. Enter a record number, title, or distinctive words from its content.
3. Select a result, or use **See all results** to open the full answer.
4. On the results page, select a kind such as **Contract** or **Document** to narrow the answer.
5. Select **Show more** if another page is available.

Each Document appears once in search, using only its latest Version. The result shows the Document name and its owning record. Open the result to read the latest Version; earlier Versions remain available from the record's Documents tab. For a PDF text match, the reader opens its find control with your search text. The match can be in the Document even when its owning record's title does not contain those words.

Search covers reachable Contracts, Matters, Documents, Entities, Counterparties, Requests, and Knowledge Items. Role and record access still apply. Confidential work outside your access does not appear. Help search is separate and searches product guides.

## Combine words and conditions

Open **Advanced search** from the sliders beside the header search box, from **Advanced search…** at the foot of the header list, or from **Advanced** on the results page. Words already typed in the header box carry into the dialog.

The **Words** rows are **All of these words**, **This exact phrase**, **Any of these words**, and **None of these words**. Each row holds up to 200 characters. Words are matched as words; `or` and a leading `-` inside a row are not operators. **Search in** chooses where words are matched: **Titles and numbers**, **Record text**, or **Document contents**. Document contents apply to Documents only. Keep at least one checked when the question has words.

**Kinds** lists **Contract**, **Matter**, **Document**, **Entity**, **Counterparty**, **Request**, and **Knowledge Item**. Select one or more kinds to search only those; select none to search every kind. Selecting a kind adds its properties to **Add condition**. Removing a kind removes its conditions, and the dialog says so.

Under **Properties**, select **Add condition**. Search the list by label or open a kind's group, choose a property, then set its operator and value. Contract, Matter, and Entity groups also list the live **Fields** of that module, so a custom Field is a condition like any standard property. A Field that an Administrator later archives is removed from the question with a notice when you next open it.

**Match all** requires every condition for a kind. **Match any** requires at least one. Values within **is any of** always match any selected value. A condition applies only to records of its own kind; a Contract condition never limits Matters. You can add up to 20 conditions.

Dates offer **before**, **after**, **on**, and **between**. Between includes both endpoints. Every date property also offers **in the last N days**, **in the next N days**, **today**, **this week**, **this month**, **this quarter**, and **this year**. Enter a whole number from 1 to 3650 for N. The preview names an invalid or missing N and waits for you to correct it.

For example, select **Expiry date**, choose **in the next N days**, and enter **90** to find Contracts expiring from today through the date 90 days away, including both dates. The chip keeps that relative phrase. Running the question again recalculates the dates in your display timezone. **This week** runs Monday through Sunday. Month, quarter, and year use the full calendar period that contains today.

**Show ended**, **Show closed**, and **Show archived** set to Yes include those records; they do not limit the answer to those records. Search includes ended Contracts and closed Matters by default, and excludes archived records until a condition includes them. Record access always applies, including to the match total.

The **Preview** beside the question shows the exact match total and up to ten matching rows, and updates as you change the question. **Clear** empties the question. Select **Search** to open the results. Select a condition chip to edit its row, or its remove control to run the question without that condition. The address keeps the question through reload and browser Back.

## Save and reopen a search

1. Build the question in **Advanced search**.
2. Select **Save search**, enter a distinct **Name**, such as `Renewals due`, then select **Save**.
3. Reopen it later from **Saved searches** in the dialog, or focus the empty header search box and select it in the **Saved** group.

A saved search keeps the words, scope, kinds, conditions, match rule, and sort. It belongs to you and follows your account to other devices. It does not store a snapshot of the records or grant access to them. A saved search has no default; the results page never opens one on its own.

Changing an open saved search marks it **Modified**. Select **Save search** to replace what it stores, or open the menu beside it and select **Save as…** to keep a separate search. The same menu offers **Rename…**, **Delete…**, and **Discard unsaved changes**. A row's menu in **Saved searches** offers **Rename…** and **Delete…** too. Delete removes the saved search after confirmation; it does not delete records. If a name is already in use, choose a different name and save again.

**Recent searches** lists the last five distinct questions you ran from the results page. Recent lives in this browser only, for your signed-in account, and signing out clears it. Select a recent question in the dialog to restore it, then select **Search** to run it. The empty header box also shows Recent, and selecting an entry there runs it at once. **See all results** is unavailable while the box is empty.

## Filter and sort a list

The example below uses **Contracts**. Other managed lists offer filters suited to their own records.

1. Open **Contracts** in the app navigation.
2. Select **Filter** and choose a property, such as **Owner**.
3. Choose the values you want, then select **Apply**.
4. Check the filter chip and the matching rows.
5. Select a sortable column heading to change the order. Select it again to cycle through its available sort states.
6. Remove an individual filter with its remove control, or select **Clear all** to clear the filters.

Values within one filter match any selected value. Different filters narrow the list together. Date filters include both endpoints. Wait for **Updating…** to finish before relying on the rows.

Use browser Back and Forward to return through list filter and sort changes. Check the visible chips and sort marker after returning. A shared address still uses the receiving person's record access.

## Save a view

1. Set the filters and sort you want.
2. Open **Columns** to choose visible columns and move them earlier or later. Close the menu when finished.
3. Open **Default view**, or the current view's name.
4. Select **Save as…**.
5. Enter a distinct **Name**, such as `Daniel portfolio`, then select **Save**.
6. Reopen the view menu and select your saved view when you need that layout again.

A saved view keeps the filters, sort, column selection, order, and widths. It belongs to you on that list and follows your account to other devices. It does not store a snapshot of the records or grant access to them.

Changing a saved layout marks it **Modified**. Open its menu and select **Save** to replace that view's stored layout. Use **Save as…** to keep a separate view. Selecting a saved view again restores its stored layout.

Use **Set as default** to open that list with the selected view. **Rename…** changes its name. **Delete…** removes the saved view after confirmation; it does not delete records. **Discard unsaved changes** restores the stored layout. Select **Default view** for the built-in layout. Neither action deletes your saved views.

## Recover from an empty answer or failed read

For **No matches**, try a record number or fewer distinctive words. For **No contracts match these filters**, remove filters and check the list again. A Document's words become searchable after text processing succeeds. Ask the record's team about processing or access if the expected text is missing.

If search cannot load, retry the query after the connection recovers. If the next page fails, keep the displayed rows and try **Show more** again. A failed read is not an empty answer. If a saved view refuses a duplicate name, choose a different name and save again.
