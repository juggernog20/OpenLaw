# OpenLaw UX and Functional Review

This document is the working checklist for the initial end-to-end product review.

## Review workflow

1. Add the page skeleton. **Complete.**
2. Inventory every user interaction beneath the relevant page. **Inventory added; conditional inspection notes below.**
3. Manually test each interaction and record UX or functional feedback.
4. Fix the recorded feedback and retest the affected interaction.

An interaction is complete only after it has been manually tested and any agreed follow-up has been resolved. Page-level checkboxes are roll-ups; check one only when every interaction listed beneath that page is complete.

## Inventory basis

Interaction inventory added on 5 September 2026 against the seeded local app and the UI code at `8e5a3f5f`. The 73 original page/tab surfaces are retained. Staff pages were inspected in the Administrator session; public authentication screens were opened signed out. Shared controls and conditional dialogs were cross-checked in their components. Notes identify pages or actions that need a different account, first-run state, or live connector.

This is an inventory, not a completed test run. Every review checkbox stays open for Blair's manual review. For a failed check, add the observed behavior and agreed follow-up immediately beneath it. Mark an unavailable conditional check as pending with its prerequisite; do not treat an absent control as a pass. Shared checks at the end apply to each page that names them, and must be reviewed in that page's role/context before its roll-up is checked.

Useful starting records: [Matter M-29](http://localhost:5173/matters/29), [Contract C-23](http://localhost:5173/contracts/23), [Inbox R-2](http://localhost:5173/inbox/2), and [Contract C-132 documents](http://localhost:5173/contracts/132/documents) (expand Signed for a Word comparison with an existing redline). The portal form uses `/portal/new/nda_request`.

## Staff application

### App shell and global navigation

Route: all staff routes

- [ ] Page review complete
- [ ] Use the brand/home link and open each available destination from navigation.
- [ ] Open and close the mobile navigation drawer; select a destination and return with browser Back.
- [ ] Open the user menu, follow Settings, and sign out.
- [ ] Focus global search with the mouse and the keyboard shortcut; enter a title, record number, or document text.
- [ ] Navigate search suggestions with the arrow keys, open a result with Enter, and dismiss with Escape.
- [ ] Choose See all results or submit the query to open the full results page.
- [ ] Open and close the notification bell; follow a notification to its record, tab, or request.
- [ ] Mark all notifications read and check the unread count.
- [ ] Load older notifications; reopen the panel after a failed read.
- [ ] Open and dismiss keyboard-shortcut help; use Escape to close menus, dialogs, and applets.
- [ ] Open, switch, and close record applets; follow their settings links where available.
- [ ] Use the skip-to-content link and keyboard navigation through header, page, and applet controls.
- [ ] Navigate settings groups, expand Security, and use section tabs and editor breadcrumbs.

### Home

Route: `/`

- [x] Check the taller Home cards, with up to four rows in each populated card.
  - Blair approved the card heights and spacing.

- [ ] Page review complete
- [ ] Open an approval waiting on you from the Approvals card.
  - Pending: no Approvals card is shown on Blair's Home screen. Review when an approval is awaiting his decision.
- [x] Open an assigned task on its Contract or Matter Tasks tab.
  - Blair confirmed the C-88 Contract task link and “Draft the first advice note” opening Matter M-42’s Tasks tab.
- [x] View all assigned Tasks from Home.
  - Blair approved the Your Tasks page, including completion, the revised fade, and the styled Undo button.
- [x] Open a Task beyond the four-row Home preview on its record's Tasks tab.
  - Blair confirmed the fifth Task opens its record’s Tasks tab.
- [x] Mark a Task done directly from Your Tasks; check that it leaves the open list and the count decreases.
  - Approved: the checkmark appears before one continuous fade and collapse; the row is removed on animation end.
- [x] Use Undo beside the completion message; check that the Task reopens and returns to its place in the list with the count restored.
  - Approved: Undo uses the shared bordered button with an icon and works during or after the exit animation.
- [x] Open an approaching key date, notice deadline, or expiry on the relevant record tab.
  - Blair approved Dates approaching; the shared preview is on M-85's Key dates tab.
- [x] Use Dates approaching → View all to open the Your dates calendar; close it with Close or Escape and return focus to View all.
  - Approved: wide modal, centered dates and month heading, Today in the top bar, no legend, 18px date numbers and 14px weekday labels.
- [x] Browse previous and next months and use Today to return to the current day.
- [x] Select a marked day to see its dates; use Show whole month to restore the month's full list.
- [x] Open a date from the calendar list on its Contract or Matter Key dates tab.
- [x] Open an Entity obligation from its card and use View all to open the calendar filtered for you.
  - Blair approved the Entity obligations card.
- [x] Open an Inbox request from its Home card.
  - Blair confirmed “Vendor terms review – Proseware Media Group” opens Request R-2.
- [x] Use Inbox's View all link to reach the triage queue.
  - Blair confirmed it works; the shared preview shows Inbox with 16 awaiting triage.
- [x] Open one of your Contracts from its Home card.
  - Blair confirmed the title opens the matching Contract record.
- [x] Use Your Contracts’ View all link to open the list filtered for you.
  - Blair confirmed the corrected behavior after approving the shared filters.
- [x] Open one of your Matters from its Home card.
  - Blair confirmed the title opens the matching Matter record.
- [x] Use Your Matters’ View all link to open the list filtered for you.
  - Blair confirmed it works with Manager: Me applied.
- [ ] Follow the role-appropriate links in the welcome/empty state.
  - Pending: the seeded account has populated Home cards; review with an empty account.
- [x] Return after completing a task and check that Home reflects it without refreshing.
  - Blair confirmed “Confirm the entity on the signature block” disappeared after completion.
- [ ] Return after an approval or triage decision and check that the cards and counts reflect it.

### Inbox

Route: `/inbox`

- [x] Review the Inbox table layout.
  - Blair approved the Status heading and tighter width, Summary absorbing spare space, and the fixed Assign column without a vertical divider. Filter and saved-view interactions remain to be reviewed individually.
- [ ] Page review complete
- [ ] Open a request from its summary.
- [ ] Use Assign to select the person responsible for triage; save and check the button becomes their avatar.
- [ ] Click the assigned avatar to reassign or clear it; cancel a selection and confirm it makes no change.
- [ ] Change or clear Status: New to include converted, resolved, and declined outcomes.
- [ ] Combine searchable Status, Type, Urgency, and Requester choices; select multiple values within a field and inspect matching counts.
- [ ] Filter by Received date with an inclusive range; clear one filter or all filters and recover from an empty result.
- [ ] Save an Inbox view, switch views, rename it, set it as default, reset changes, and delete it.
- [ ] Reload a filtered link and use browser Back/Forward; check the filters and selected view are restored.
- [ ] Show, hide, resize, and reorder data columns; save the layout in a view. Check Summary absorbs spare width, resizing another column changes only that column and Summary, and Assign stays fixed at the right edge, including after large resizes and in a narrow viewport.
- [ ] Open the linked Matter or Contract for a converted request where access permits.
- [ ] Use Show more and retain every active filter; check the total counts all matching requests.
- [ ] Recover from a failed list read and confirm the urgency-then-age ordering remains clear.

### Inbox request

Route: `/inbox/:number`

- [ ] Page review complete
- [ ] Return to Inbox using the breadcrumb.
- [ ] Use the assignment control beside Triage to assign, reassign, or clear the triage assignee; confirm the Inbox displays the same person.
- [ ] Open or download submitted attachments and read the original form responses.
- [ ] Open Comments, load older comments, and draft a reply with attachments and mentions; use the shared comment checks below.
- [ ] Open Triage → Convert to contract or Convert to matter and review the proposed title, routing, and carried fields.
- [ ] Choose a record type when routing leaves it open; inspect fixed routing when the request type already chose one.
- [ ] Switch Convert to matter instead / Convert to contract instead and review fields that carry across or stay only on the request.
- [ ] Complete required fields missing from the original form; replace archived user/entity values with eligible live values.
- [ ] For Matter conversion, select an optional template and inspect its task/key-date summary.
- [ ] Cancel conversion; separately confirm conversion and open the resulting record.
- [ ] Open Triage → Resolve request without converting; check that a blank note is refused, then enter a required explanation and cancel or resolve. Confirm the note appears on the requester-visible thread.
- [ ] Open a request after each triage outcome and inspect its outcome, linked record, and continuing conversation.
- [ ] Handle a decision made by another staff member while a triage dialog is open; close it to read the recorded outcome.

### Matters

Route: `/matters`

- [ ] Page review complete
- [x] Filter component review complete — Blair approved the shared quick filters; Incomplete was removed.
- [ ] Open a Matter from its title/reference.
- [ ] Open Filter, search its properties, and search/select multiple choices for Manager, Status, Type, Priority, and Risk.
- [ ] Choose Manager: Me or Unassigned; combine several properties and verify the matching count.
- [ ] Apply an Opened date or Next deadline range with both endpoints, then with only one endpoint.
- [ ] Edit or remove a filter chip and use Clear all; verify browser Back/Forward and refresh preserve filters.
- [ ] Toggle Show closed and Show archived; combine filters and clear them to recover an empty result.
- [ ] Sort sortable columns and load more rows while retaining the current filters and sort.
- [ ] Use Columns and Default view / Views; complete the shared managed-table checks below.
- [ ] Open New matter; enter a title and choose a Matter type.
- [ ] Select or clear an optional template and inspect the tasks/key dates it will add.
- [ ] Choose the Matter Manager, priority, risk, description, and confidentiality setting.
- [ ] Answer the chosen type's required and optional custom fields, including each available field control.
- [ ] Cancel creation; separately create the Matter and open the new M-number.
- [ ] Correct missing required fields, invalid numbers, and a failed creation without losing the draft.

### Matter record

Route: `/matters/:matterNumber/:tab?`

- [ ] Page review complete
- [ ] Use the Matters breadcrumb, parent breadcrumb, record tabs, and browser Back/Forward.
- [ ] Change Status and check the header and tab counts after saving.
- [ ] Open Close matter, select a closed status, inspect the warning about open children, and cancel or confirm.
- [ ] Open Reopen matter, select an open status, and cancel or confirm.
- [ ] Archive a Matter through its confirmation; open the archived record and restore it.
- [ ] Open Comments and History on each tab; complete the shared comment and history checks below.
- [ ] Follow a direct link to another Matter and confirm the title, fields, and applets belong to that new record.

#### Overview

Route: `/matters/:matterNumber`

- [ ] Tab review complete
- [ ] Edit Title and Description; save on blur and cancel an unfinished edit with Escape.
- [ ] Change Matter type; complete any new required fields in the change-type dialog or cancel it.
- [ ] Assign, replace, or clear the Matter Manager.
- [ ] Change Priority and Risk, including Not assessed.
- [ ] Set and clear confidentiality; inspect the team-only access explanation.
- [ ] Edit and clear each attached custom field according to its data type and required state.
- [ ] Add a team member with a role; check each person appears once with all their role tags, including Matter Manager and Creator. Remove one removable role tag and verify their other roles remain.
- [ ] Create a New sub-Matter with the parent shown in its creation form.
- [ ] Set or change the parent by searching for a Matter; clear the selection or remove the parent.
- [ ] Add a related Matter and remove an existing relationship.
- [ ] Follow parent, child, related Matter, and linked Contract references; inspect restricted references without links.
- [ ] Link an existing Contract by searching for it; unlink a Contract and inspect any confidentiality mismatch warning.

#### Documents

Route: `/matters/:matterNumber/documents`

- [ ] Tab review complete
- [ ] Upload a document or a new version with its kind and note; cancel the composer before submitting.
- [ ] Choose several files or a folder, or drag them onto the card; review and run the batch import.
- [ ] Expand/collapse folders and version history; load more documents at the root and inside a folder.
- [ ] Open current and earlier versions in the document reader, download them, and compare eligible versions.
- [ ] Edit document name/description and change version kind.
- [ ] Create, rename, move, nest, and delete folders; move documents between folders and the record root.
- [ ] Mark or clear document confidentiality where offered; inspect how record access limits visibility.
- [ ] Show archived documents, archive and restore one, and use the named confirmation to delete one.
- [ ] Complete the shared document reader, upload, and folder checks below on this Matter.

#### Key dates

Route: `/matters/:matterNumber/key-dates`

- [ ] Tab review complete
- [ ] Open Add date; choose the date, event label, and optional note, then save or cancel.
- [ ] Edit a Key date using its actions menu and save or cancel the changes.
- [ ] Remove a Key date through the confirmation dialog or cancel removal.
- [ ] Correct an absent date/label and retry a failed save.
- [ ] Check overdue, next, and upcoming states and counts after adding, editing, or removing dates.

#### Tasks

Route: `/matters/:matterNumber/tasks`

- [ ] Tab review complete
- [ ] Open Add Task; enter title, optional due date, and assignee, then save or cancel.
- [ ] Click a Task assignee's avatar/name; search current team members or the Matter Manager, reassign, or choose Unassigned.
- [ ] Choose Add someone to the team…, search outside the team, review the access message, and confirm Add to team and assign; check both the task and Team.
- [ ] Cancel adding someone; check no membership or assignment changed. In an add/edit form, both changes wait until Save.
- [ ] On a confidential Matter, verify an ordinary team member can assign within the team but cannot add someone through the picker.
- [ ] Edit task title, assignee, and due date through the actions menu.
- [ ] Complete a task and reopen a completed task; check the done/open counts.
- [ ] Move a task up and down, including first/last row limits.
- [ ] Remove a task and correct a failed or invalid edit.

### Contracts

Route: `/contracts`

- [ ] Page review complete
- [x] Filter component review complete — Blair approved the shared quick filters; Incomplete was removed.
- [ ] Open a Contract from its title/reference or a linked record cell.
- [ ] Open Filter and search/select multiple Owners, Statuses, and Types; combine them and verify the matching count.
- [ ] Choose Owner: Me or Unassigned; confirm Home’s Your Contracts link opens Owner: Me.
- [ ] Apply an Effective date or Expiry date range, including a range with one endpoint.
- [ ] Edit or remove chips and use Clear all; verify browser Back/Forward and refresh preserve filters.
- [ ] Include ended and archived Contracts from Filter; remove those chips to return to active records.
- [ ] Save combined filters and dates as a view; restore it, including when it matches no records.
- [ ] Restore an archived Contract from its row action.
- [ ] Sort sortable columns and use Show more while retaining list state.
- [ ] Use Columns and Default view / Views; complete the shared managed-table checks below.
- [ ] Open Create contract; enter a title and choose a Contract type.
- [ ] Search for an optional Matter by number/title, select it, clear it, or leave the Contract standalone.
- [ ] Complete the selected type's required and optional fields; check that changing type changes the form fields.
- [ ] Set confidentiality and inspect the warning when the selected Matter has a different flag.
- [ ] Cancel creation; separately create the Contract and open the new C-number.
- [ ] Correct missing values, invalid numbers, and creation failures while preserving the form.

### Contract record

Route: `/contracts/:contractNumber/:tab?`

- [ ] Page review complete
- [ ] Use Contracts and parent breadcrumbs, record tabs, and browser Back/Forward.
- [ ] Open the status menu and move to a different status/stage.
- [ ] When approvals remain unresolved, inspect Move past approval; cancel or choose Move anyway and check the recorded override.
- [ ] Open Contract actions and copy the record link.
- [ ] Use Rename contract to focus/edit the title.
- [ ] Archive the Contract; open the archived record and restore it.
- [ ] Open Team, add a person with a role, and check each person appears once with all their role tags, including Owner and Creator. Remove one removable role tag and verify their other roles remain.
- [ ] Open Comments and History from different tabs; complete the shared comment and history checks below.
- [ ] Follow the Contract settings link as Administrator.
- [ ] Open Run analysis when an enabled connector and eligible document make it available; inspect running/failure/completion states.
- [ ] Follow a direct link to another Contract and confirm fields, documents, tasks, and applets switch to that record.

#### Overview

Route: `/contracts/:contractNumber`

- [ ] Tab review complete
- [ ] Edit Title and Description; save on blur and abandon an unfinished edit with Escape.
- [ ] Change Contract type; complete newly required fields or cancel the change-type dialog.
- [ ] Assign, replace, or clear Owner and Our entity.
- [ ] Search for and add an existing counterparty; enter an unknown name to create one.
- [ ] Make another counterparty primary and remove a counterparty.
- [ ] Change Priority and Risk, including Not assessed.
- [ ] Edit Value amount, Currency, and Cadence; clear the amount to remove the value and correct invalid entries.
- [ ] Change Term type between Fixed term, Auto-renewing, and Evergreen; inspect the fields available for each.
- [ ] Set, change, and clear Effective date, Expiry date, Renewal period, and Notice period where available.
- [ ] Set and clear confidentiality and inspect the access explanation.
- [ ] Inspect AI suggestions with evidence and outcomes; confirm one unverified value and Confirm all.
- [ ] Correct an AI-populated core value manually and check its verification state.
- [ ] Read the term timeline and inspect dated points and renewal history available on it.
- [ ] Link to a Matter, change the linked Matter, or unlink it; search, select, clear, and cancel in the linking dialog.
- [ ] Set/remove a parent Contract; add/remove Related, Renews, and Amends links.
- [ ] Follow linked Matter, parent, child, renewal, and amendment records; inspect restricted placeholders.
- [ ] Handle a confidentiality mismatch when linking Contracts: accept the offered flag change or leave the flag unchanged.

#### Fields

Route: `/contracts/:contractNumber/fields`

- [ ] Tab review complete
- [ ] Edit each attached text, long-text, number, date, boolean, single-select, multi-select, user, and entity field present on the type.
- [ ] Choose and clear values where optional; correct invalid numbers and required-field refusals.
- [ ] Save inline edits and abandon unfinished edits with Escape where supported.
- [ ] Confirm an unverified AI field or correct its value manually.
- [ ] Review Business fields as a Contributor and Legal fields as legal staff.
- [ ] Follow the contract-settings link when the type has no fields and the role permits it.

#### Documents

Route: `/contracts/:contractNumber/documents`

- [ ] Tab review complete
- [ ] Upload a document or add a new version with kind and note; save or cancel the composer.
- [ ] Choose multiple files or a folder, or drag them onto the card; review and run a batch import.
- [ ] Expand/collapse folders and version history; load more at the root and within a folder.
- [ ] Open current and earlier versions in the reader, download them, and choose Compare with previous.
- [ ] Set another document as primary and inspect the primary marker.
- [ ] Mark a version as the executed copy and unmark it; inspect its version marker.
- [ ] Edit document name/description and change a version's kind.
- [ ] Create, rename, move, nest, and delete folders; move documents into a folder or back to the record root.
- [ ] Mark and clear document confidentiality.
- [ ] Show archived documents, archive and restore one, and delete one using the typed-name confirmation.
- [ ] Follow a document search/notification deep link to the requested document and version.
- [ ] Complete the shared document reader, upload, and folder checks below on this Contract.

#### Approvals

Route: `/contracts/:contractNumber/approvals`

- [ ] Tab review complete
- [ ] Open Add approver, select one or several eligible people, and cancel or Request approvals.
- [ ] Apply an approver group; inspect who will be asked and who already has a pending request.
- [ ] Approve a request addressed to you with an optional note; separately reject one with an optional note.
- [ ] Cancel a pending approval request; request approval again when a fresh decision is needed.
- [ ] Open the source document/version and executed-copy links in existing signature rounds.
- [ ] With a working signing connector, open Send for signature and choose the primary document version.
- [ ] Enter signer names/emails, add and remove signers, and enter an optional subject; cancel or Send envelope.
- [ ] Void an outstanding envelope with the required reason; cancel the void dialog or submit it.
- [ ] Inspect signed, declined, voided, and pending rounds, including executed-copy filing failures and their manual upload path.
- [ ] Open Renew and choose Confirm the roll with a new expiry date; cancel or confirm.
- [ ] Choose Paper as amendment and review the renewal details before confirming.
- [ ] Choose Create child contract or New successor contract and complete or cancel the prefilled creation flow.
- [ ] Follow renewal-history links and check the recorded term advance, author, and date.

Seed condition: both connectors are disabled. Existing approvals, envelopes, and renewals can be inspected; sending/voiding through the provider needs a working signing connector.

#### Key dates

Route: `/contracts/:contractNumber/key-dates`

- [ ] Tab review complete
- [ ] Add a key date with a date, event, and optional note; save or cancel.
- [ ] Edit a manually entered date from its actions menu.
- [ ] Remove a manually entered date.
- [ ] Correct missing date/event values and retry a failed save.
- [ ] Inspect derived expiry and notice dates; change the source term fields on Overview and check that derived rows update.
- [ ] Check upcoming/past counts after a date changes.

#### Tasks

Route: `/contracts/:contractNumber/tasks`

- [ ] Tab review complete
- [ ] Add a task with title, optional assignee and due date; save or cancel.
- [ ] Click a Task assignee's avatar/name; search current team members or the Owner, reassign, or choose Unassigned.
- [ ] Choose Add someone to the team…, search outside the team, review the access message, and confirm Add to team and assign; check both the task and Team.
- [ ] Cancel adding someone; check no membership or assignment changed. In an add/edit form, both changes wait until Save.
- [ ] On a confidential Contract, verify an ordinary team member can assign within the team but cannot add someone through the picker.
- [ ] Edit task title, assignee, and due date from its actions menu.
- [ ] Complete and reopen tasks and check the done/open counts.
- [ ] Remove a task from its actions menu.
- [ ] Correct an empty title and retry failed changes.

### Documents

Route: `/documents`

- [ ] Page review complete
- [ ] Choose All, Contracts, Matters, Entities, or Knowledge as the owning module.
- [ ] Search/select an owning record and clear the record filter.
- [ ] Filter by Format, Counterparty, Uploader, and Kind.
- [ ] Choose Uploaded from/to dates and turn Show archived on or off.
- [ ] Remove individual filter chips and clear all filters.
- [ ] Sort sortable columns and use Show more with the current filter/sort state.
- [ ] Open a Recent document or a document row at its owning record's document/version preview.
- [ ] Open the owning Contract, Matter, Entity, or Knowledge item from its record link.
- [ ] Recover from a filtered empty result and an unavailable owning record.

### Document comparison

Route: `/documents/:documentId/compare`

- [ ] Page review complete
- [ ] Open a comparison from a document's Compare action or a direct link containing both versions.
- [ ] Choose different Older and Newer versions from the version pickers.
- [ ] Select a change in the Changes list to jump to its highlighted text.
- [ ] Use Previous change and Next change, including first/last-change limits.
- [ ] Scroll through the compared document and inspect insertions, deletions, and replacements.
- [ ] Export track changes for two Word versions and open the resulting redline on the owning record.
- [ ] Inspect the unavailable-export explanation for a pair that includes a non-Word version.
- [ ] Download source files from a failed comparison; reopen after a temporary read failure.
- [ ] Inspect pending, no-changes, and extracted-text-only comparison states.
- [ ] Close the comparison or use breadcrumbs to return to Documents/the owning record.

### Entities

Route: `/entities`

- [ ] Page review complete
- [ ] Switch between Calendar, List, and Chart and reopen the selected view from its URL.
- [ ] In Calendar, switch Due-date list / Month; use Previous month, Next month, and Today.
- [ ] Filter the calendar by Entity, Assignee, From/To, and Include completed; Apply or clear the filters.
- [ ] Open an obligation or Entity from a due-date row or calendar entry.
- [ ] In List, filter by Type, Status, Jurisdiction, and Majority owner; remove chips or Clear all.
- [ ] Show archived Entities and restore an archived Entity from its list row.
- [ ] Sort the list and use Show more; complete the shared Columns and Views checks below.
- [ ] In Chart, drag to pan, use the wheel to zoom, and choose Fit to window.
- [ ] Use arrow keys to pan, Shift+arrow for a larger step, +/− to zoom, and 0 to fit; open an Entity node.
- [ ] Open Register entity; enter legal name, type, status, jurisdiction, formation date, registration number, tax ID, agent, and address.
- [ ] Cancel registration; separately register an Entity and open it, correcting any required-field refusal.
- [ ] Use the empty-state Register entity or Add obligation link where available.

### Entity record

Route: `/entities/:entityId/:tab?`

- [ ] Page review complete
- [ ] Use the Entities breadcrumb, all six tabs, and browser Back/Forward.
- [ ] Archive the Entity and restore it; inspect archived/read-only controls.
- [ ] Open History, load older entries, and close/reopen the applet.
- [ ] Navigate directly between Entity records and confirm the title, fields, and tab data change to the selected Entity.

#### Overview

Route: `/entities/:entityId`

- [ ] Tab review complete
- [ ] Edit Legal name, Entity type, and Status.
- [ ] Edit Formation jurisdiction, Formed on, Registration no., Tax ID, Registered agent, and Registered address.
- [ ] Commit inline edits and cancel an unfinished edit with Escape; correct a rejected save.
- [ ] Set or clear confidentiality; open Manage access as Administrator.
- [ ] Grant an eligible Legal Team Member access and remove an existing grant; close the access dialog.
- [ ] Edit Authorized shares, Issued shares, and Par value; correct invalid numeric values.
- [ ] Edit or clear each attached custom field and inspect required/type validation.
- [ ] Add an officer with name, role, appointment/resignation dates, and optional linked user.
- [ ] Edit an officer's details, record a resignation, and toggle Show former.
- [ ] Remove an officer and inspect any removal confirmation offered.
- [ ] Add a registration with jurisdiction, number, registered agent, and status.
- [ ] Edit a registration's details/status and remove a registration.

#### Ownership

Route: `/entities/:entityId/ownership`

- [ ] Tab review complete
- [ ] Open owner and owned-Entity links.
- [ ] Open Add Holding; choose Owns this Entity or This Entity owns, search/select the other Entity, enter a percentage, and add or cancel.
- [ ] Edit an existing holding's percentage and correct invalid values.
- [ ] Remove an ownership holding from either side of the relationship.
- [ ] Inspect ownership-total warnings after a holding is added or its percentage changes.
- [ ] Inspect restricted Entity references and archived/read-only ownership controls.

#### Obligations

Route: `/entities/:entityId/obligations`

- [ ] Tab review complete
- [ ] Add an obligation with due date, label, optional repeat interval, registration, assignee, Matter, and note; save or cancel.
- [ ] Edit each obligation field inline, including clearing optional associations.
- [ ] Mark a one-off obligation filed, choose Filed on, and cancel or confirm completion.
- [ ] Mark a repeating obligation filed and inspect how the next due date advances.
- [ ] Delete an obligation and correct a failed edit or invalid date/repeat interval.
- [ ] Return to the calendar after filing or editing and check the corresponding row/date.

#### Documents

Route: `/entities/:entityId/documents`

- [ ] Tab review complete
- [ ] Upload a document/new version with kind and note; cancel or submit the composer.
- [ ] Choose multiple files/folders or drag them onto the card and review a batch import.
- [ ] Expand folders and version history, load more, and open/download a selected version.
- [ ] Compare eligible versions and return to the Entity's Documents tab.
- [ ] Edit document details and version kind; mark/clear confidentiality where offered.
- [ ] Create, rename, nest, move, and delete folders; move documents between folders and the record root.
- [ ] Show archived documents, archive and restore one, and use typed-name confirmation to delete one.
- [ ] Complete the shared document reader, upload, and folder checks below on this Entity.

#### Contracts

Route: `/entities/:entityId/contracts`

- [ ] Tab review complete
- [ ] Open a Contract from its linked-record row.
- [ ] Return to this tab after changing a Contract's Our entity and check its membership/count.
- [ ] Inspect empty, archived, and restricted-record states.

#### Matters

Route: `/entities/:entityId/matters`

- [ ] Tab review complete
- [ ] Open a Matter from its linked-record row.
- [ ] Return after changing an Entity-valued Matter field and check the linked list/count.
- [ ] Inspect empty, archived, and restricted-record states.

### Knowledge

Route: `/knowledge`

- [ ] Page review complete
- [ ] Choose All Knowledge or a nested folder to scope the library.
- [ ] Add a folder; rename or move the selected folder, including moving it to Library.
- [ ] Move a folder up/down among siblings; delete it through the confirmation and inspect where its items/children move.
- [ ] Filter by Type, State, Audience, Author, and Format; Clear filters.
- [ ] Sort columns and load more items; complete the shared Columns and Views checks below.
- [ ] Open New → New Knowledge Item; enter title, type, and folder, then create or cancel.
- [ ] Open New → New from files; select/drop multiple files, choose type/folder, and create drafts or cancel.
- [ ] Open an item from its title and inspect draft, published, and audience markers.
- [ ] Recover from a filtered empty result using Clear filters or another folder.

### Knowledge item

Route: `/knowledge/:id`

- [ ] Page review complete
- [ ] Use the Knowledge breadcrumb and open the primary document preview.
- [ ] Edit Title, Type, and Folder; follow Manage types as Administrator.
- [ ] Change Audience between Legal Only and Everyone; cancel or confirm the portal-removal warning when links depend on the item.
- [ ] Add/edit guidance in Markdown, switch Preview/Edit, and follow rendered links.
- [ ] Upload documents/new versions; select a primary document and edit document details/version kind.
- [ ] Open/download document versions and compare eligible versions; complete shared document-reader and upload checks below.
- [ ] Show archived documents; archive, restore, or delete a document through its available actions.
- [ ] Publish a draft; unpublish it and handle a warning about portal deflection links.
- [ ] Archive the Knowledge item with or without an optional replacement; cancel the dialog or confirm.
- [ ] Restore an archived item and inspect its resulting state/audience.
- [ ] Open History, load older entries, and close/reopen the applet.

### Search results

Route: `/search`

- [ ] Page review complete
- [ ] Submit a query from global search and inspect the full results page.
- [ ] Change the query; search by title, record reference, counterparty name, and document content.
- [ ] Switch All and the available record-kind filters.
- [ ] Open Contract, Matter, Entity, document, counterparty, and Request results where offered.
- [ ] Follow document results to the highlighted document/version on its owning record.
- [ ] Use Show more with the current query and kind filter.
- [ ] Clear or change a query with no matches and recover from a failed read.
- [ ] Use browser Back/Forward and direct result URLs to restore query/filter context.

## Settings

### Personal — Profile

Route: `/settings/profile`

- [ ] Page review complete
- [ ] As an Administrator or Legal Team Member, use App view → View as business user to open the intake portal; complete the [view-switch checks](#view-as-business-user-and-portal-shell).
- [ ] Confirm a Contributor's Profile does not offer View as business user.
- [ ] Choose and upload a profile photo; correct unsupported type or excessive size.
- [ ] Edit Full name and inspect save feedback; confirm Email and Role are read-only on this page.
- [ ] Search/select a Timezone and check date/time displays after it saves.
- [ ] Open Change password, enter current/new passwords, and cancel or save; check other-device sign-out behavior.
- [ ] Open Turn on two-factor, confirm the password, and complete authenticator enrollment and backup-code copying.
- [ ] When two-factor is enabled, re-enroll or turn it off with password confirmation.
- [ ] Use Sign out other devices and confirm the current session remains usable.
- [ ] Expand/collapse profile/security cards where offered.

### Personal — Appearance

Route: `/settings/appearance`

- [ ] Page review complete
- [ ] Select Light, Warm, and Dark themes and inspect the immediate page/shell appearance.
- [ ] Reload and navigate to another page to check the preference persists.
- [ ] Choose a theme using keyboard focus and selection.

### Personal — Notifications

Route: `/settings/notifications`

- [ ] Page review complete
- [ ] Toggle In-app and Email for Assigned to you.
- [ ] Toggle In-app and Email for Activity on your records.
- [ ] Toggle In-app for Dates approaching.
- [ ] Toggle In-app and Email for New requests where the role exposes it.
- [ ] Toggle the email-only Knowledge items preference where offered.
- [ ] Disable an in-app group and inspect the dependent email control; re-enable it.
- [ ] Toggle each Briefing email section: Approvals, Tasks, Dates, Obligations, and Intake as offered for the role.
- [ ] Reload after changing preferences; inspect failed-save feedback and retained values.
- [ ] Check that briefing email preferences leave Home sections and daily bell summaries available.

### Organization — General

Route: `/settings/general`

- [ ] Page review complete
- [ ] Edit Organization name and inspect the saved value in branding.
- [ ] Choose and upload a logo; inspect file type/size validation.
- [ ] Choose Default locale and inspect locale-sensitive rendering.
- [ ] Search/select Default timezone and inspect save feedback.
- [ ] Reload to verify organization preferences persist.

### Organization — Users

Route: `/settings/users`

- [ ] Page review complete
- [ ] Open Invite user; enter display name, email, and role, then cancel or Send invite.
- [ ] Handle an existing email, invalid email, and a failed invitation.
- [ ] Resend a pending invitation when the row offers it.
- [ ] Revoke a pending invitation and inspect its removal from the list.
- [ ] Change a person's role and handle self-demotion/last-Administrator restrictions.
- [ ] Revoke another user's sessions through the row action and inspect save/error feedback.
- [ ] Archive a user, then toggle Show archived and restore the user.
- [ ] Inspect active staff, active Business Users, pending invitations, and archived users as distinct states.
- [ ] Inspect self-action restrictions and confirm archived users cannot retain access.

### Organization — Security — Authentication

Route: `/settings/authentication`

- [ ] Page review complete
- [ ] Select Built-in or Identity provider (OIDC) authentication and inspect immediate-save feedback.
- [ ] Register a provider with Provider ID, Issuer URL, Email domain, Client ID, and Client secret.
- [ ] Edit an existing provider; leave the secret blank to retain it or enter a replacement, then Save provider.
- [ ] Use the displayed callback URL in the identity-provider setup flow and validate return to OpenLaw.
- [ ] Toggle portal magic-link sign-in when the mode permits it; inspect why Built-in keeps it enabled.
- [ ] Add an allowed email domain and remove an existing domain.
- [ ] Correct duplicate/invalid domains and inspect the empty-allowlist closed-portal state.
- [ ] Verify Administrator password access and requester sign-in choices after an authentication-mode change.

### Organization — Security — Audit log

Route: `/settings/audit-log`

- [ ] Page review complete
- [ ] Filter by Person, Action, Record, and From/To dates.
- [ ] Search the audit log and combine search with filters.
- [ ] Clear filters to restore the unfiltered log.
- [ ] Load older entries while retaining the active filters.
- [ ] Inspect change details, actors, timestamps, record references, and audience labels.
- [ ] Recover from an empty result or failed read.

### Organization — Matters

#### Types

Route: `/settings/matters/types`

- [ ] Page review complete
- [ ] Add a type with its name and available description fields; cancel or save.
- [ ] Rename a type inline; commit the name or cancel the edit.
- [ ] Open a type's editor from Edit.
- [ ] Reorder types by dragging and by focusing the handle and using arrow keys.
- [ ] Archive an unused type; archive an in-use type by selecting a replacement, or cancel.
- [ ] Inspect the protected system-default type and retained in-use counts after reassignment.

#### Matter type editor

Route: `/settings/matters/types/:typeId`

- [ ] Page review complete
- [ ] Use All types and section tabs to leave the editor.
- [ ] Edit Display name and Description; commit on blur and cancel an unfinished edit with Escape.
- [ ] Inspect the immutable Slug and the count of records using this type.
- [ ] Open Attach field, choose an eligible module/global field, and attach it.
- [ ] Toggle Required on an attached field and inspect save feedback.
- [ ] Reorder attached fields by dragging and keyboard handles.
- [ ] Detach a field and confirm its existing values/catalog definition remain available where applicable.
- [ ] Handle no eligible fields, a failed edit, and navigation directly between two type editors.

#### Statuses

Route: `/settings/matters/statuses`

- [ ] Page review complete
- [ ] Add a status with a name and its category (Open or Closed); save or cancel.
- [ ] Rename an existing status inline and cancel an unfinished edit.
- [ ] Reorder statuses with drag handles and arrow keys.
- [ ] Archive an unused status; choose a replacement when archiving an in-use status, or cancel.
- [ ] Inspect immutable category/stage assignment and protections for system defaults and the final status in each category/stage.
- [ ] Return to a record's status picker after changing the catalog and inspect the new order/names.

#### Fields

Route: `/settings/matters/fields`

- [ ] Page review complete
- [ ] Add a field with name, description, data type, module/global scope, and Business/Legal tag.
- [ ] For Single select or Multi select, enter one option per line in the intended display order.
- [ ] Set an AI extraction prompt where the field supports Contract analysis, or leave it empty.
- [ ] Cancel field creation; separately save and correct missing/invalid values.
- [ ] Rename a field inline and cancel an unfinished rename.
- [ ] Edit name, description, scope, tag, options, and eligible AI prompt; inspect the immutable data type.
- [ ] Archive a field and inspect the explanation about retaining stored values.
- [ ] Check a Global field from another module's Fields page after changing it.

#### Templates

Route: `/settings/matters/templates`

- [ ] Page review complete
- [ ] Choose the Matter type whose templates to manage.
- [ ] Add a template for that type and open its editor.
- [ ] Open an existing template by name.
- [ ] Rename a template inline and cancel an unfinished rename.
- [ ] Archive a template; inspect the retained tasks/dates/field summary and unchanged existing Matters.
- [ ] Restore an archived template when its row is shown; check its full definition returns.
- [ ] Handle a Matter type with no templates and create its first template.

#### Matter template editor

Route: `/settings/matters/templates/:templateId`

- [ ] Page review complete
- [ ] Use All templates to return to the selected type's template list.
- [ ] Edit template Name and Description.
- [ ] Set or clear default Priority, Risk, and Title prefix.
- [ ] Set or clear custom-field defaults using the type's attached field controls.
- [ ] Add a task row, edit its title and due offset, and choose Matter Manager or Unassigned.
- [ ] Reorder task rows with pointer/keyboard handles and remove a row.
- [ ] Add a key-date row with label, date offset, and note.
- [ ] Reorder key-date rows with pointer/keyboard handles and remove a row.
- [ ] Save template; correct missing row names, invalid field values, and non-integer/out-of-range offsets.
- [ ] Inspect retained defaults for fields no longer attached to the type.
- [ ] Create a new Matter using the template and inspect resolved dates, assignees, and defaults; check an existing Matter remains unchanged.

### Organization — Contracts

#### Types

Route: `/settings/contracts/types`

- [ ] Page review complete
- [ ] Toggle Show archived; restore an archived type from its row action.
- [ ] Add a type with its name and available description fields; cancel or save.
- [ ] Rename a type inline; commit the name or cancel the edit.
- [ ] Open a type's editor from Edit.
- [ ] Reorder types by dragging and by focusing the handle and using arrow keys.
- [ ] Archive an unused type; archive an in-use type by selecting a replacement, or cancel.
- [ ] Inspect the protected system-default type and retained in-use counts after reassignment.

#### Contract type editor

Route: `/settings/contracts/types/:typeId`

- [ ] Page review complete
- [ ] Use All types and section tabs to leave the editor.
- [ ] Edit Display name and Description; commit on blur and cancel an unfinished edit with Escape.
- [ ] Inspect the immutable Slug and the count of records using this type.
- [ ] Open Attach field, choose an eligible module/global field, and attach it.
- [ ] Toggle Required on an attached field and inspect save feedback.
- [ ] Reorder attached fields by dragging and keyboard handles.
- [ ] Detach a field and confirm its existing values/catalog definition remain available where applicable.
- [ ] Handle no eligible fields, a failed edit, and navigation directly between two type editors.

#### Statuses

Route: `/settings/contracts/statuses`

- [ ] Page review complete
- [ ] Add a status with a name and its stage (Draft, Review, Approval, Signature, Active, or Ended); save or cancel.
- [ ] Rename an existing status inline and cancel an unfinished edit.
- [ ] Reorder statuses with drag handles and arrow keys.
- [ ] Archive an unused status; choose a replacement when archiving an in-use status, or cancel.
- [ ] Inspect immutable category/stage assignment and protections for system defaults and the final status in each category/stage.
- [ ] Return to a record's status picker after changing the catalog and inspect the new order/names.

#### Fields

Route: `/settings/contracts/fields`

- [ ] Page review complete
- [ ] Add a field with name, description, data type, module/global scope, and Business/Legal tag.
- [ ] For Single select or Multi select, enter one option per line in the intended display order.
- [ ] Set an AI extraction prompt where the field supports Contract analysis, or leave it empty.
- [ ] Cancel field creation; separately save and correct missing/invalid values.
- [ ] Rename a field inline and cancel an unfinished rename.
- [ ] Edit name, description, scope, tag, options, and eligible AI prompt; inspect the immutable data type.
- [ ] Archive a field and inspect the explanation about retaining stored values.
- [ ] Check a Global field from another module's Fields page after changing it.

#### Approver groups

Route: `/settings/contracts/approver-groups`

- [ ] Page review complete
- [ ] Add a group with name, description, and selected eligible members; save or cancel.
- [ ] Rename a group inline and cancel an unfinished edit.
- [ ] Edit group description and add/remove members; save or cancel.
- [ ] Archive a group and inspect the warning that existing approval requests remain unchanged.
- [ ] Apply the edited group on a Contract and check that it uses the current membership.
- [ ] Inspect empty groups, duplicate/invalid names, and failed-save feedback.

### Organization — Intake

#### Request types

Route: `/settings/intake/request-types`

- [ ] Page review complete
- [ ] Add a request type with its name, description, and target options; save or cancel.
- [ ] Rename a request type inline and cancel an unfinished edit.
- [ ] Open a request type's editor from Edit.
- [ ] Reorder request types by dragging and keyboard handles.
- [ ] Archive a request type and inspect its removal from the portal's type picker.
- [ ] Check target summaries and form-field counts after editing a type.

#### Request type editor

Route: `/settings/intake/request-types/:typeId`

- [ ] Page review complete
- [ ] Use All request types and section tabs to leave the editor.
- [ ] Edit Display name and Description and inspect the immutable Slug.
- [ ] Choose No target, a module-only Matter/Contract target, or a specific Matter/Contract type.
- [ ] Inspect the explanation of conversion routing, including an archived target that needs replacement.
- [ ] Change target with attached fields present; handle a refusal that would leave incompatible fields on the form.
- [ ] Inspect locked Summary, Description, Attachments, and Urgency basics.
- [ ] Open Attach field and choose a field eligible for the current target.
- [ ] Toggle Required for custom fields; inspect why User/Entity fields cannot be required in the portal.
- [ ] Reorder attached fields with pointer and keyboard handles.
- [ ] Detach a field, preserving its catalog definition, and inspect the updated portal form.
- [ ] Recover from a failed save and navigate directly to another request-type editor.

#### Deflection links

Route: `/settings/intake/links`

- [ ] Page review complete
- [ ] Add a link with an External address target, URL, label, and placement.
- [ ] Switch to a Knowledge item target and select eligible published guidance.
- [ ] Choose Portal home or a particular request type as placement.
- [ ] Cancel creation; separately save and correct an invalid address or missing target/label.
- [ ] Edit a link's label, target, and placement; save or cancel.
- [ ] Reorder links by dragging and keyboard handles.
- [ ] Remove a link and cancel any offered confirmation before separately confirming removal.
- [ ] Open the affected portal surface and follow internal guidance or the external link.
- [ ] Inspect the portal behavior when a linked Knowledge item becomes unpublished, Legal Only, or archived.

### Organization — Entities

#### Types

Route: `/settings/entities/types`

- [ ] Page review complete
- [ ] Add a type with its name and available description fields; cancel or save.
- [ ] Rename a type inline; commit the name or cancel the edit.
- [ ] Open a type's editor from Edit.
- [ ] Reorder types by dragging and by focusing the handle and using arrow keys.
- [ ] Archive an unused type; archive an in-use type by selecting a replacement, or cancel.
- [ ] Inspect the protected system-default type and retained in-use counts after reassignment.

#### Entity type editor

Route: `/settings/entities/types/:typeId`

- [ ] Page review complete
- [ ] Use All types and section tabs to leave the editor.
- [ ] Edit Display name and Description; commit on blur and cancel an unfinished edit with Escape.
- [ ] Inspect the immutable Slug and the count of records using this type.
- [ ] Open Attach field, choose an eligible module/global field, and attach it.
- [ ] Toggle Required on an attached field and inspect save feedback.
- [ ] Reorder attached fields by dragging and keyboard handles.
- [ ] Detach a field and confirm its existing values/catalog definition remain available where applicable.
- [ ] Handle no eligible fields, a failed edit, and navigation directly between two type editors.

#### Officer roles

Route: `/settings/entities/officer-roles`

- [ ] Page review complete
- [ ] Add an officer role with a name; save or cancel.
- [ ] Rename a role inline and cancel an unfinished rename.
- [ ] Reorder roles with drag handles and arrow keys.
- [ ] Archive an unused role; choose a replacement for an in-use role or cancel.
- [ ] Inspect the protected Other role and check affected officers after reassignment.

#### Fields

Route: `/settings/entities/fields`

- [ ] Page review complete
- [ ] Add a field with name, description, data type, module/global scope, and Business/Legal tag.
- [ ] For Single select or Multi select, enter one option per line in the intended display order.
- [ ] Set an AI extraction prompt where the field supports Contract analysis, or leave it empty.
- [ ] Cancel field creation; separately save and correct missing/invalid values.
- [ ] Rename a field inline and cancel an unfinished rename.
- [ ] Edit name, description, scope, tag, options, and eligible AI prompt; inspect the immutable data type.
- [ ] Archive a field and inspect the explanation about retaining stored values.
- [ ] Check a Global field from another module's Fields page after changing it.

### Organization — Knowledge

#### Types

Route: `/settings/knowledge/types`

- [ ] Page review complete
- [ ] Add a Knowledge type; save or cancel.
- [ ] Rename a type inline and cancel an unfinished rename.
- [ ] Reorder types with drag handles and arrow keys.
- [ ] Archive an unused type; choose a replacement for a type in use or cancel.
- [ ] Inspect updated type names/order in the Knowledge creation form and record editor.

### Organization — Notifications

Route: `/settings/reminders`

- [ ] Page review complete
- [ ] Open Add lead time and enter a whole number of days before the date.
- [ ] Save or cancel the inline addition; include 0 for On the day.
- [ ] Reorder lead times with drag handles and arrow keys.
- [ ] Remove a lead time and inspect the protection against removing the last one.
- [ ] Correct duplicate, negative, or invalid lead times and retry a failed save.

### Organization — AI analysis

Route: `/settings/ai-analysis`

- [ ] Page review complete
- [ ] Expand/collapse Provider to inspect the connector form and state.
- [ ] Choose a provider and inspect its required connection fields.
- [ ] For Custom endpoint, choose the protocol; enter Base URL or Azure deployment endpoint where required.
- [ ] Enter/replace API key and Model; retain the existing key by leaving it blank when editing.
- [ ] Save connector and correct missing/invalid provider settings.
- [ ] Run Test connection and inspect pending, success, and failure feedback.
- [ ] Turn Use AI analysis on/off and inspect availability of record analysis controls.
- [ ] Remove connector through its confirmation or cancel removal.
- [ ] Edit the core field prompts for term type, effective/expiry dates, renewal/notice periods, value, and counterparty.
- [ ] Follow Contracts → Fields to manage catalog-field extraction prompts.

Seed condition: the saved connector is turned off because its temporary server has stopped. Connection/analysis checks require a working provider.

### Organization — Integrations — E-signature

Route: `/settings/integrations/e-signature`

- [ ] Page review complete
- [ ] Expand/collapse DocuSign to inspect the connector form and state.
- [ ] Choose Demo or Production and enter Integration key and User ID.
- [ ] Enter/replace RSA private key and Connect HMAC secret; retain existing values by leaving them blank when editing.
- [ ] Save connector and correct missing/invalid credentials.
- [ ] Run Test connection and inspect pending, connected-account, and failure feedback.
- [ ] Copy the Webhook URL and inspect clipboard feedback.
- [ ] Turn Send for signature from records on/off and inspect the explanation for outstanding rounds.
- [ ] Remove connector through its confirmation or cancel removal.
- [ ] Return to a Contract and inspect signing controls and the manual executed-copy path for the current connector state.

Seed condition: DocuSign is turned off because its temporary server has stopped. Connection/send checks require a working provider or the signing stand-in.

## Business User — Requester portal

The Business User screens are the portal entry, intake home, new-request form, request detail/conversation, Knowledge item, and notification settings inventoried below. **Your requests** on the portal home is the existing request-management section. A separate Business User Matter workspace is not built; after conversion, the requester continues tracking and discussing the work through their Request.

### View as business user and portal shell

Routes: `/settings/profile` → `/portal` and all authenticated portal subpages

- [ ] As both an Administrator and a Legal Team Member, switch from Profile and check that the portal offers intake forms and Your requests using the signed-in person's own Requests.
- [ ] Check the Viewing as business user notice explains that submissions and replies are real.
- [ ] Navigate to a form, request detail, Knowledge item, and notification settings; check Return to legal view remains available after navigation and reload.
- [ ] Use Return to legal view from each portal page and confirm Profile opens with the same account and role.
- [ ] As a Business User, check that the staff-view notice and return control are absent, and repeat the portal interactions using that person's own Requests.
- [ ] Check the view-switch notice and return control on mobile and with keyboard navigation.

### Portal entry

Route: `/portal/enter`

- [ ] Page review complete
- [ ] Enter a work email and submit Send link; correct invalid input or a failed send.
- [ ] Use a different email from the Check your email screen.
- [ ] Open the emailed single-use link and arrive at the portal.
- [ ] Try an expired/reused link and follow the fresh-link path.
- [ ] When links are disabled or outbound email is unavailable, follow Sign in instead.
- [ ] Revisit the entry URL while signed in and confirm it forwards to the portal.

### Portal home

Route: `/portal`

- [ ] Page review complete
- [ ] Choose each available request type to open its specific form.
- [ ] Follow a Before you submit Knowledge link and return to the portal.
- [ ] Follow an external deflection link in its new tab.
- [ ] Review Your requests spanning the full width below the request types and guidance.
- [ ] Select Light, Warm, and Dark from the portal header theme menu; confirm the preference survives navigation and signing in again.
- [ ] Open one of Your requests and inspect its current outcome/status.
- [ ] From the no-requests state, use the prompt that focuses the request-type picker.
- [ ] Open the portal notification bell, follow a request notification, mark all read, and load older items.
- [ ] Open Notification settings and return using the portal brand/home link.
- [ ] Sign out and return through a fresh magic link.
- [ ] Inspect the no-request-types state without losing available guidance links.

### New request

Route: `/portal/new/:slug`

- [ ] Page review complete
- [ ] Return with All request types and open each of the available form types.
- [ ] Enter Summary and Description and choose Urgency.
- [ ] Answer required/optional custom fields using their offered controls; inspect unavailable User/Entity choices.
- [ ] Choose or drop attachments, inspect selected filenames, and remove a selected file.
- [ ] Correct the attachment-count limit and invalid/missing required values.
- [ ] Open form-specific Before you submit links and return to the form.
- [ ] Submit request and inspect the R-number confirmation and email-update explanation.
- [ ] Wait for attached files to finish; inspect named failures without resubmitting the already-created request.
- [ ] Use the confirmation's request/conversation link when a file could not attach, or return Back to the portal.
- [ ] Open an invalid or archived type URL and return to the available type picker.

### Request detail

Route: `/portal/requests/:number`

- [ ] Page review complete
- [ ] Return to Your requests.
- [ ] Read What you submitted, including original description, urgency, form fields, and attachments.
- [ ] Open/download an original attachment.
- [ ] Read the request outcome for new, converted, resolved, and declined requests, including any requester-visible closing reason.
- [ ] Load Show earlier replies and follow links/downloads in the conversation.
- [ ] Write a reply to Legal; add/remove attachments and submit text, files, or both as supported.
- [ ] Use Attach new files to a reply to focus the composer.
- [ ] Correct an empty/failed reply and inspect attachment-limit feedback.
- [ ] Follow the record's continuing thread after conversion and inspect that staff-only comments remain private.
- [ ] Open another person's request URL and inspect the safe return/denied state.

Inspection note: the Administrator session has no requests of its own and is redirected away from another requester’s record. Detail interactions were inventoried from the UI components; inspect this page after signing in as the seeded requester.

### Portal knowledge item

Route: `/portal/knowledge/:id`

- [ ] Page review complete
- [ ] Read published guidance and follow its rendered links.
- [ ] Download each offered document.
- [ ] Use Your requests or the portal brand to return home.
- [ ] Open a Knowledge link after its item becomes unavailable and inspect the safe fallback.

### Portal notification settings

Route: `/portal/settings`

- [ ] Page review complete
- [ ] Return using Your requests or the portal brand.
- [ ] Toggle In-app for Request updates.
- [ ] Toggle Email for Request updates; turn In-app off and inspect the dependent email state.
- [ ] Reload to check persistence and retry a failed preference save.

## Authentication and onboarding

### Log in

Route: `/auth/login`

- [ ] Page review complete
- [ ] Enter Email and Password and submit Sign in.
- [ ] Correct missing/invalid credentials and inspect failed-sign-in feedback.
- [ ] Continue to the two-factor challenge when the account requires it.
- [ ] Choose Email me a sign-in link, enter email, and Send link.
- [ ] Use Back to sign-in from the email form and the Check your email state.
- [ ] Open the emailed link and inspect role-appropriate landing and expired/reused-link handling.
- [ ] In OIDC mode, choose Continue with single sign-on and complete or cancel provider sign-in.
- [ ] Use Administrator sign-in in OIDC mode and Back to the SSO choice.
- [ ] Inspect the SSO error return, unconfigured-provider message, and unavailable-email-link state.
- [ ] Revisit login while already signed in and check the appropriate redirect.

### Two-factor authentication

Route: `/auth/two-factor`

- [ ] Page review complete
- [ ] Enter the six-digit authenticator code and Verify.
- [ ] Switch to Use a backup code, enter one, and Verify.
- [ ] Switch back with Use your authenticator app.
- [ ] Correct a wrong, reused, or malformed code and inspect rate-limit feedback.
- [ ] Complete the challenge and inspect the role-appropriate destination.
- [ ] Restart sign-in after an expired/missing challenge session.

### Two-factor enrollment

Route: `/auth/two-factor/enroll`

- [ ] Page review complete
- [ ] Confirm the password and choose Turn on two-factor.
- [ ] Scan the QR code or enter the displayed secret in an authenticator.
- [ ] Enter a current code and Confirm; correct a wrong code.
- [ ] Copy the backup codes and inspect clipboard-success/failure feedback.
- [ ] Choose Done and inspect the enabled state.
- [ ] From the enabled state, confirm the password to Turn off two-factor.

### Set password

Route: `/auth/set-password`

- [ ] Page review complete
- [ ] Open a valid invite/set-password link.
- [ ] Enter New password and Confirm password and submit Set password.
- [ ] Correct mismatched passwords or a password shorter than the minimum.
- [ ] Follow Sign in after the Password set confirmation.
- [ ] Open a missing-token, expired, or already-used link and inspect the disabled/refused submission state.

### Initial instance setup

Route: `/auth/setup`

- [ ] Page review complete
- [ ] On a separate empty instance, enter Name, Email, Password, and Confirm password.
- [ ] Create Administrator and continue to first-run welcome.
- [ ] Correct invalid email, short/mismatched passwords, and setup failures.
- [ ] Reopen setup after an Administrator exists and inspect the completed-setup redirect/refusal.

Inspection note: this configured instance redirects setup to sign-in. The initial form was inventoried from the UI code and needs a separate empty instance for manual review; preserve this seeded database.

### First-run welcome

Route: `/welcome`

- [ ] Page review complete
- [ ] On an instance with onboarding open, choose Get started or Set up later.
- [ ] Use Back, Continue, and Set up later between steps.
- [ ] Select Built-in sign-in or Single sign-on (OIDC).
- [ ] Register an identity provider with ID, issuer, domain, client ID, and secret; use the displayed callback URL.
- [ ] Set portal magic-link availability and add/remove allowed email domains.
- [ ] When email is app-managed, enter SMTP relay URL and From address and Save relay.
- [ ] Replace or clear an existing app-managed relay; cancel replacement with Keep current relay.
- [ ] Send a test email when offered and inspect delivery feedback.
- [ ] With environment-managed SMTP, inspect the read-only explanation and available test control.
- [ ] Invite team members with name, email, and role; inspect successes and correct refused invites.
- [ ] Choose Finish and return Home; revisit welcome after onboarding is complete.

Inspection note: onboarding is already complete, so this URL redirects Home. The wizard interactions were inventoried from the UI code and need an instance with onboarding open.

### Expired or invalid sign-in link

Route: `/auth/link-expired`

- [ ] Page review complete
- [ ] Enter an email and Send link to request a fresh sign-in link.
- [ ] Use a different email after the confirmation.
- [ ] Open the fresh link and inspect the correct destination.
- [ ] When fresh links are unavailable, use Back to sign-in.

## Cross-cutting review surfaces

These are not standalone pages. Apply the shared interaction checks on every page that exposes the control, then cover the role, state, and device checks during manual review.

### Shared managed tables — Columns and Views

Applies to Matters, Contracts, the Entity List, and Knowledge wherever these controls are offered.

- [ ] Open Columns and show/hide an optional column; inspect mandatory-column protection.
- [ ] Move a column earlier/later and resize a column by dragging its boundary.
- [ ] Resize a focused column boundary with the keyboard and inspect width limits.
- [ ] Toggle Fill the width and Reset columns.
- [ ] Sort a sortable header in each direction; inspect the active sort indicator.
- [ ] Select Default view or a saved view and inspect the applied columns, sort, and supported filters.
- [ ] Change a saved view, inspect Modified, and Save it.
- [ ] Use Save as to create a named view; cancel and correct invalid/duplicate names.
- [ ] Rename a saved view and cancel or save the rename.
- [ ] Set a view as default and revisit the destination.
- [ ] Delete a saved view through its confirmation; cancel before separately confirming.
- [ ] Discard unsaved changes and check that the saved layout returns.
- [ ] Reload, follow a saved-view URL, and use Back/Forward without mixing views from different destinations.

### Shared document reader, uploads, and folders

Applies to document cards on Contracts, Matters, Entities, and Knowledge, with folder controls only where exposed.

- [ ] Open a current version and an earlier version; check the reader title/version and owning-record context.
- [ ] Close the reader with its close control and Escape; reopen from a direct document/version link.
- [ ] Download the selected original file.
- [ ] In PDF/converted-document preview, use Previous page and Next page and inspect page limits.
- [ ] Zoom in/out and inspect zoom limits.
- [ ] Open Find in document, enter a term, step through matches in both directions, and close Find.
- [ ] Follow a search-result highlight into the preview and inspect no-match handling.
- [ ] Read an email preview, open/download an embedded attachment, and use Back to the message.
- [ ] Use the download fallback for unsupported, failed, or still-preparing previews.
- [ ] Choose Compare from the reader where a previous eligible version exists.
- [ ] Choose files or a folder in Upload, or drag/drop onto the card or a folder target.
- [ ] Review the batch folder/file tree, destination, version kind, and any unreadable-folder warning before importing.
- [ ] Cancel a batch before import; separately start Import and inspect per-file progress/results.
- [ ] Cancel remaining uploads; retry an individual failed file or all retryable failed files; finish with Done.
- [ ] Correct a file over the size limit and inspect partial-success feedback without duplicating successful files.
- [ ] Add a version to an existing document and inspect the incremented version history and note.
- [ ] Change a version kind and inspect immutable Generated redline kinds where offered.
- [ ] Expand/collapse folders, add a subfolder, rename a folder, and move it to an eligible parent.
- [ ] Move a document by its Move to folder dialog and by drag/drop where offered.
- [ ] Delete a folder and inspect the stated movement of its contents to the parent/root.
- [ ] Cancel document deletion; enter the exact name to confirm deletion and inspect unavailable deletion of protected/derived versions.
- [ ] Reopen a failed upload/details/folder dialog and inspect validation, pending controls, and preserved input.

### Shared comments, mentions, and attachment filing

Applies to the staff Comments applet on Requests, Matters, and Contracts; the portal has its own reply controls above.

- [ ] Open/close Comments and load older entries; inspect authors, timestamps, audience, and edited/deleted markers.
- [ ] Choose an available audience: Legal only, Working team, or Full thread.
- [ ] Write and post a comment; inspect empty-comment refusal and save/error feedback.
- [ ] Type an @mention, navigate eligible people with pointer/keyboard, select a person, and remove a selected mention.
- [ ] Cancel or confirm Widen the audience when a mentioned person needs a broader audience.
- [ ] Attach files, remove a queued attachment, and inspect the per-comment file limit.
- [ ] Submit a files-only comment where supported.
- [ ] Open/download comment attachments and follow links to already-filed documents/versions.
- [ ] File an attachment as a New Document with name and kind; cancel or confirm File.
- [ ] File an attachment as a New Version on an existing Document, with document selection, kind, and note.
- [ ] Inspect unavailable/failed filing when a request has no converted record or the destination is restricted.
- [ ] Edit an own comment and save or cancel.
- [ ] Delete an own comment through its confirmation and inspect the author-deleted marker.
- [ ] As Administrator, redact another person's comment through its confirmation and inspect the redaction marker.
- [ ] Check that confidential record access and audience restrictions also govern mentions, attachments, and notification links.

### Shared history, forms, and navigation

- [ ] Open History, read changes with before/after values, and use Show older.
- [ ] Close/reopen a failed History read; switch records and inspect that entries belong to the selected record.
- [ ] In inline fields, commit with blur/Enter where supported, revert with Escape, and inspect Saving/Saved/error feedback.
- [ ] In dialogs, use Save/Submit, Cancel, the close control, Escape, and outside-click dismissal where supported.
- [ ] Keep focus within an open modal and return it to the trigger when the modal closes.
- [ ] Use date-picker month navigation, choose/clear a date where allowed, and use its keyboard controls.
- [ ] Use text/long text, numeric, boolean, single/multi-select, user, and entity field controls with required and optional values.
- [ ] Search, select, clear, and dismiss record/person pickers; inspect no matches and archived/restricted selections.
- [ ] Double-submit a pending action and inspect duplicate prevention and useful pending feedback.
- [ ] Follow breadcrumbs, tab links, deep links, and browser Back/Forward; inspect selected-tab and record state.
- [ ] Visit an unknown tab or unavailable record and follow the offered recovery navigation.

### Roles and permissions

- [ ] Administrator experience reviewed
- [ ] Legal team member experience reviewed
- [ ] Contributor experience reviewed
- [ ] Requester experience reviewed
- [ ] Repeat relevant record interactions as an Owner/Manager, team member, watcher, and uninvolved person.
- [ ] Open confidential records as an authorized and unauthorized person; inspect direct links, search, notifications, and cross-links.
- [ ] Review Entity grants as Administrator and a granted/ungranted Legal Team Member.
- [ ] Review requester-owned requests and published Everyone guidance from a Business User session.
- [ ] Attempt settings and staff-route navigation as a Contributor and a Business User.
- [ ] Repeat access checks after changing a role, removing team access, archiving a user, or revoking a session.

### Common states

- [ ] Empty states reviewed
- [ ] Loading and pending states reviewed
- [ ] Validation and error states reviewed
- [ ] Archived and read-only states reviewed
- [ ] Restricted and unauthorized states reviewed

### Device and input coverage

- [ ] Desktop layout reviewed
- [ ] Mobile layout reviewed
- [ ] Keyboard navigation reviewed
- [ ] Screen-reader labels and announcements reviewed
