# Search, filter, and save views

Find records and words inside Documents that you can reach, then keep a search or a list layout to use again.

## Before you start

- You need the Administrator or Legal Team Member role. Business Users have no app search. Opening the search page takes them to the Portal, where they find their Requests, Contracts and Matters.
- Search shows only records you can reach. Confidential work outside your access does not appear.
- A Document's words become searchable after its text processing succeeds.

## Search across your work

1. Select **Search** in the header, or press `/` outside a text field.
2. Type at least two characters: a record number such as `C-12`, a title, or distinctive words from the content.
3. Select a result, or use **See all results** to open the results page.
4. On the results page, select a kind such as **Contract** or **Document** to narrow the answer. A kind keeps only its own conditions. **All** returns to every kind and removes every condition.
5. Select **Show more** if another page is available.

The header list shows up to ten results for each kind. The results page shows the exact match total above the rows and 25 rows at a time.

Each Document appears once in search, using only its latest Version. The result shows the Document name and its owning record, such as `C-12 · Supply agreement`. Open the result to read the latest Version. Earlier Versions remain available from the record's Documents tab, but search does not read their words. For a PDF text match, the reader opens its find control with your search text. The match can be in the Document even when its owning record's title does not contain those words. A Counterparty result opens the Contract results for that Counterparty's name.

Search covers reachable Contracts, Matters, Documents, Entities, Counterparties, Requests, and Knowledge Items. Role and record access still apply. Help search is separate and searches product guides.

## Combine words and conditions

Open **Advanced search** from the sliders beside the header search box, from **Advanced search…** at the foot of the header list, or from **Advanced** on the results page. Words already typed in the header box carry into **All of these words**. From the results page, the dialog opens with the whole question.

The **Words** rows are **All of these words**, **This exact phrase**, **Any of these words**, and **None of these words**. Each row holds up to 200 characters. Words are matched as words; `or` and a leading `-` inside a row are not operators. **Search in** chooses where words are matched: **Titles and numbers**, **Record text**, or **Document contents**. Document contents apply to Documents only. Keep at least one checked when the question has words.

**Kinds** lists **Contract**, **Matter**, **Document**, **Entity**, **Counterparty**, **Request**, and **Knowledge Item**. Select one or more kinds to search only those; select none to search every kind. **Add condition** is unavailable until you select a kind, because a condition belongs to one kind. Removing a kind removes its conditions, and the dialog says so.

Under **Properties**, select **Add condition**. The list groups properties under each selected kind. Type in **Search properties** to narrow the list by label, then choose a property and set its operator and value. Contract, Matter, and Entity groups also list the live **Fields** of that module, so a custom Field is a condition like any standard property. A Field that an Administrator later archives is removed from the question with a notice. The results page, and a saved search run from the header, say **Unavailable Field conditions were removed.** Selecting that saved search under **Saved searches** in the dialog says **Unavailable search conditions were removed.**

**Match all** requires every condition for a kind. **Match any** requires at least one. Values within **is any of** always match any selected value. A condition applies only to records of its own kind; a Contract condition never limits Matters. You can add up to 20 conditions.

Dates offer **before**, **after**, **on**, and **between**. Before and after exclude the date you enter. Between includes both endpoints. Every date property also offers **in the last N days**, **in the next N days**, **today**, **this week**, **this month**, **this quarter**, and **this year**. Enter a whole number from 1 to 3650 for N in **Number of days**. The preview names an invalid or missing N and waits for you to correct it.

For example, select **Contract** under **Kinds**, then add **Expiry date**, choose **in the next N days**, and enter **90**. The question finds Contracts expiring from today through the date 90 days away, including both dates. The chip reads **Contract Expiry date in the next 90 days**. Running the question again recalculates the dates in your display timezone. **This week** runs Monday through Sunday. Month, quarter, and year use the full calendar period that contains today.

Search includes ended Contracts and closed Matters by default, and excludes archived records. **Show ended**, **Show closed**, and **Show archived** set to **Yes** include those records; they do not limit the answer to those records. Set **Show ended** or **Show closed** to **No** to leave those records out. Under **Match any**, a Show condition set to **Yes** matches every reachable record of its kind, so the kind's other conditions stop narrowing it. Use **Match all** when you combine a Show condition with other conditions. Record access always applies, including to the match total.

The **Preview** beside the question shows the exact match total and up to ten matching rows, and updates as you change the question. **Clear** empties the question. Select **Search** to open the results and close the dialog. On the results page, each words row and each condition has a chip. Select a condition chip to edit its row in the dialog, or its remove control to run the question without that condition. The address keeps the question through reload and browser Back.

## Sort search results

A new question starts in **Relevance** order. The sort menu at the end of the row that holds **Advanced** shows the current order.

1. Open the sort menu on the results page.
2. Choose **Relevance**, **Newest**, **Oldest**, **Expiry soonest**, or **Title**.

**Newest** and **Oldest** order by the date each record was created. A Document uses its latest Version's upload time. **Title** runs A to Z. **Expiry soonest** lists Contracts first, by expiry date, with Contracts that have no expiry date after them. Other kinds follow in relevance order. The address and a saved search keep the sort.

## Save and reopen a search

1. Build the question in **Advanced search**.
2. Select **Save search**. In **Save this search**, enter a distinct **Name**, such as `Renewals due`, then select **Save**.
3. To run it later, focus the empty header search box and select it in the **Saved** group. The results page opens at once.
4. To change it, open **Advanced search** and select it under **Saved searches**. The dialog loads the question without running it. Select **Search** to run it.

A saved search keeps the words, scope, kinds, conditions, match rule, and sort. It belongs to you and follows your account to other devices. It does not store a snapshot of the records or grant access to them. A saved search has no default; the results page never opens one on its own.

Changing a saved search that you selected under **Saved searches** marks it **Modified** beside **Save search**. Select **Save search** to replace what it stores, or open the menu beside it and select **Save as…** to keep a separate search. The same menu offers **Rename…**, **Delete…**, and **Discard unsaved changes**. A row's menu in **Saved searches** offers **Rename…** and **Delete…** too. Delete removes the saved search after confirmation; it does not delete records.

The dialog forgets which saved search you selected when it closes. To replace a saved search, select it under **Saved searches** again before you change it. Otherwise **Save search** saves a new search.

**Recent searches** lists the last five distinct questions that opened the results page. Recent lives in this browser only, for your signed-in account, and signing out clears it. Select a recent question in the dialog to restore it, then select **Search** to run it. The empty header box also shows **Recent**, and selecting an entry there runs it at once. **See all results** is unavailable while the box is empty.

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

Use **Set as default** to open that list with the selected view. The menu marks that view **Opens here**. **Rename…** changes its name. **Delete…** removes the saved view after confirmation; it does not delete records. **Discard unsaved changes** restores the stored layout. Select **Default view** for the built-in layout. Neither action deletes your saved views.

## Recover from an empty answer or failed read

For **No matches**, try a record number or fewer distinctive words. A question with conditions and no words says **No records match this question.** Remove a condition chip and check the total again. For **No contracts match these filters**, remove filters and check the list again. Ask the record's team about text processing or access if the expected text is missing.

If search cannot load, the header shows **Search could not load** and the results page shows **Search could not load. Try again.** Retry after the connection recovers. If the next page fails, the page keeps the displayed rows and shows **The next results could not be read. Try again.** Select **Show more** again. A failed read is not an empty answer. If a saved search does not load in the dialog, the dialog shows **This search could not open. Try again.**

A saved search name must be new among your saved searches. A saved view name must be new among your views on that list. The app compares names without regard to letter case. A name already in use is refused with **You already have a view with that name on this list.** Choose a different name and save again. You can keep up to 25 saved searches, and up to 25 saved views on each list.
