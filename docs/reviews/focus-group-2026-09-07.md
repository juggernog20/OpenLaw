# Focus group, 7 September 2026

Twenty simulated testers, one per seeded persona, each drove the running dev build (feat/record-ux-integration, hot reload on localhost:5173) through headless Playwright for 8 to 18 minutes of wall-clock time and wrote a structured report. Seven were Member+ (Administrator or Legal Team Member), four were Contributors, nine were Business Users on the Portal (one on a phone viewport, one keyboard-only screen-reader user). The twenty raw reports are kept outside the repo; this file carries the counts the decision records cite.

## Scores

| Group                                                                       | Testers | Mean /10 | Range           |
| --------------------------------------------------------------------------- | ------- | -------- | --------------- |
| Staff (Daniel, Ines, Nadia, Priya, Marcus, Sofia, Tom)                      | 7       | 6.3      | 5 to 7          |
| Contributors (Ravi, Ade, Clara, Hannah)                                     | 4       | 5.8      | 5 to 7          |
| Business Users (Jonas, Amara, Felix, Mei, Oliver, Sara, Karim, Rosa, Diego) | 9       | 6.1      | 4 to 7          |
| All                                                                         | 20      | 6.1      | 4 to 7 (mode 7) |

Every tester said it beats email for the record-level work. Eleven said they would keep a spreadsheet, a Slack thread, or a calendar on the side for the thing their job actually turns on. The pattern is consistent: the record is strong, the view across records is missing.

## Recurring findings, by frequency

| #   | Finding                                                                                                                                                                                                              | Count      | Who                                                              | Severity                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------- | --------------------------- |
| 1   | Unknown or no-access URL renders the "Something went wrong. Reload to try again." crash page instead of a 404 or "no access" page. Reload does nothing. Seen under /portal, /settings, /contracts/:id, /matters/:id. | 16/20      | everyone except Sara, Marcus, Tom, Clara-partial                 | medium                      |
| 2   | Opening the notification bell marks every item read at once. No per-item read, no "Mark all read".                                                                                                                   | 10/20      | Amara, Rosa, Sara, Jonas, Oliver, Ravi, Felix, Ade, Diego, Karim | low each, high in aggregate |
| 3   | Portal "Your requests" has no search, filter, sort, or "needs your reply" flag.                                                                                                                                      | 6/9 portal | Amara, Rosa, Sara, Jonas, Oliver, Diego                          | medium                      |
| 4   | Portal request page never shows who owns it or when it comes back. Urgency and Needed-by go into a void.                                                                                                             | 6/9 portal | Amara, Mei, Jonas, Oliver, Diego, Felix                          | high (adoption)             |
| 5   | Portal Knowledge has no index page or search; /portal/knowledge crashes. Four fixed links on the home page.                                                                                                          | 6/9 portal | Amara, Mei, Jonas, Oliver, Diego, Felix                          | medium                      |
| 6   | Deal value validation contradicts itself: "Deal value (USD) is required" plus "enter this as a number" on an optional field. Accepts -5.                                                                             | 5          | Rosa, Mei, Oliver, Diego, Felix                                  | low                         |
| 7   | Receipt and sign-in emails link to localhost:3000 (API host), which lands on a different, older portal shell. Probably dev config, but two testers rated it high or medium.                                          | 5          | Amara, Oliver, Diego, Sara, Felix                                | check config                |
| 8   | No CSV export on any list; the audit log is the only export. No reporting page.                                                                                                                                      | 5          | Daniel, Ines, Ade, Oliver, Hannah                                | high (legal ops)            |
| 9   | Notification text says "status changed" without saying to what.                                                                                                                                                      | 4          | Amara, Jonas, Oliver, Karim                                      | low                         |
| 10  | "Awaiting approval" contracts with zero approvals requested. "Who is blocking?" has no answer. Soft gate never warned when moving past approval.                                                                     | 4          | Ravi, Ade, Daniel, Nadia                                         | high                        |
| 11  | Create contract returns to the list instead of opening the new record (Matters and Knowledge open the record).                                                                                                       | 4          | Ines, Priya, Sofia, Nadia                                        | low                         |
| 12  | Business users want a "my contracts" or stakeholder view: renewal, notice, value, stage.                                                                                                                             | 4          | Oliver, Diego, Ravi, Ade                                         | feature                     |
| 13  | Deadline and Value columns not sortable; no "overdue" quick filter on lists.                                                                                                                                         | 4          | Daniel, Ade, Marcus, Nadia                                       | medium                      |
| 14  | Needed-by accepts a date in the past with no warning.                                                                                                                                                                | 4          | Mei, Oliver, Diego, Felix                                        | low                         |
| 15  | Templates missing: matter templates with task checklists, contract type to template document, incident playbook.                                                                                                     | 4          | Marcus, Priya, Sofia, Ines                                       | feature                     |
| 16  | Request types do not fit real jobs: marketing/influencer, termination/renewal, vendor security review. No "not sure / something else" path.                                                                          | 3          | Mei, Oliver, Karim                                               | medium                      |
| 17  | Contributor cannot complete a task assigned to them; checkbox looks enabled but is disabled, no explanation.                                                                                                         | 3          | Ravi, Clara, Marcus (observed)                                   | high                        |
| 18  | Confidential-record copy says "Confidential contract ... the contract team, the Owner" on a Matter.                                                                                                                  | 3          | Clara, Priya, Marcus                                             | medium                      |
| 19  | Key dates have no reminder lead time or time of day; bell never surfaced a deadline.                                                                                                                                 | 3          | Priya, Sofia, Ines                                               | high (deadlines)            |
| 20  | Home says "Nothing is waiting on you" while overdue key dates or an assigned task exist for a Contributor.                                                                                                           | 3          | Hannah, Clara, Ravi                                              | medium                      |
| 21  | Raw UUIDs or enum values shown in History and Audit log ("Not set → 01a07295...", "legal_only → everyone").                                                                                                          | 3          | Daniel, Marcus, Sofia                                            | low                         |
| 22  | Deep link while logged out forgets the destination after magic-link sign-in.                                                                                                                                         | 3          | Sara, Felix, Karim                                               | medium                      |
| 23  | Focus not moved to the first invalid field on validation failure.                                                                                                                                                    | 3          | Rosa, Sara, Felix                                                | medium (a11y)               |
| 24  | Owner or Matter Manager left Unassigned after create or convert.                                                                                                                                                     | 3          | Daniel, Nadia, Sofia                                             | low                         |
| 25  | Contributor can edit fields they should not (matter Description, Business unit, contract Value).                                                                                                                     | 2          | Clara, Hannah                                                    | high                        |
| 26  | Privileged or confidential material visible to a Contributor with no marker (advice note; checklist.md in global Documents; seeded HR matter).                                                                       | 3          | Clara, Marcus, Ravi                                              | high (verify vs seed)       |
| 27  | Document Kind options use contract vocabulary on Entities and Knowledge ("Draft · ours", "Redline · theirs").                                                                                                        | 2          | Tom, Sofia                                                       | low                         |
| 28  | Business sponsor dropdown only offers "Not set"; "Our entity: Restricted Entity" label.                                                                                                                              | 2          | Ravi, Ade                                                        | medium                      |
| 29  | Older magic links stay valid when a new one is issued; no throttle on the endpoint.                                                                                                                                  | 2          | Karim, Felix                                                     | medium                      |
| 30  | Plain-text unbranded emails, "Hello," with no name, sender openlaw@localhost.                                                                                                                                        | 2          | Karim, Jonas                                                     | low                         |
| 31  | Form and reply drafts lost on reload or navigation.                                                                                                                                                                  | 2          | Sara (high on mobile), Felix                                     | medium                      |
| 32  | Bulk select and bulk actions missing on every list.                                                                                                                                                                  | 2          | Ines, Tom                                                        | feature                     |
| 33  | Destructive actions with no confirm: remove officer, delete obligation, clear confidential flag.                                                                                                                     | 2          | Tom, Marcus                                                      | medium                      |
| 34  | "CONFI" truncated badge in lists and search.                                                                                                                                                                         | 2          | Marcus, Sofia                                                    | low                         |
| 35  | No way from the app to the portal for Contributors.                                                                                                                                                                  | 2          | Ravi, Clara                                                      | low                         |

## Single-tester findings worth acting on

- Convert Request to Contract drops Counterparty and Needed-by, and the dialog says so. Data loss on the main intake path. (Daniel, high)
- Compare on two .txt versions fails with "Version 1 does not support extracted text". Document name does not update on a new version. (Nadia, high)
- "Out for signature" is a label only; no send action exists on the record. Approver picker lists only the legal team. (Nadia)
- No AI analysis, no Unverified values, no evidence anywhere on contracts. Either the feature is not on this build or it is not wired. (Priya)
- Any address at helix.example gets a magic link and a new account. nobody.unknown@helix.example signed in. Needs to be a visible admin choice. (Karim, high)
- .exe accepted as an attachment; sixth file silently dropped. (Jonas)
- Global search does not find a document by filename (Tom), and "GDPR" did not hit DPA text (Priya), while "AGPL" inside a .md was found (Sofia). Indexing coverage is uneven.
- Legal Team Member sees no Organization settings at all, and the app does not say whether that is role or product. (Ines)
- Every route change drops focus to body; error text not linked to fields via aria-describedby. (Rosa)
- Mobile: 12px inputs (iOS will zoom), 24px tap targets, Submit not full width, "Your requests" below the fold. (Sara)
- Plain text everywhere: no markdown, no autolinked URLs in descriptions or comments. (Felix)
- No manager or team view of requests; no escalate action. (Amara, scored 4/10 for her own job)
- Matters opens on a saved "Privacy queue" view showing 0 results. (Priya)
- 502s from the API under load on two runs, and one blank portal first load. (Ines, Ade, Sofia; 20 concurrent browsers, so likely load)

## What landed well, by frequency

| What                                                                                                                    | Count | Who                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------- |
| History applet as an audit trail, plain sentences, every edit within seconds                                            | 9     | Daniel, Ravi, Ade, Clara, Priya, Marcus, Sofia, Nadia, Ines |
| "Request R-xx is with Legal. Quote R-xx" confirmation and reference number                                              | 8     | Amara, Mei, Jonas, Sara, Oliver, Diego, Clara, Rosa         |
| Inline autosave with the small "Saved" label, no Save button                                                            | 6     | Ravi, Tom, Sofia, Ines, Priya, Felix                        |
| Comment audience labels ("Visible to the legal team and Contributors on this record") and @mention scoped to the record | 5     | Ravi, Hannah, Clara, Priya, Marcus                          |
| Saved views, column picker, filters in the URL                                                                          | 5     | Ade, Ines, Tom, Nadia, Marcus                               |
| Confidentiality model verified across logins; access scoping holds by URL and search                                    | 5     | Priya, Marcus, Daniel, Hannah, Clara                        |
| Validation messages name the field                                                                                      | 5     | Amara, Rosa, Oliver, Clara, Jonas                           |
| "What you submitted" panel on the request page                                                                          | 4     | Amara, Mei, Jonas, Oliver                                   |
| Dark and Warm themes look finished and persist                                                                          | 4     | Diego, Sofia, Sara, Mei                                     |
| Global search grouping and record-number jump                                                                           | 4     | Daniel, Priya, Sofia, Ade                                   |
| Accessibility fundamentals: skip link, one H1, landmarks, focus ring, status as words, 200% reflow                      | 1     | Rosa (rated it above most enterprise tools)                 |
| Speed: 220 to 280 ms DOMContentLoaded, double-submit handled, input escaped                                             | 1     | Felix                                                       |
| Auth hygiene: no open redirect, HttpOnly cookie, attachments served as octet-stream with nosniff                        | 1     | Karim                                                       |

## Feature requests, by frequency

1. Stakeholder or "my contracts" view for business users and Contributors, with renewal, notice, value, and who holds it (Oliver, Diego, Ravi, Ade). 4
2. Owner and expected-return date on every request, in the list and in notifications (Amara, Mei, Jonas, Oliver, Diego). 5, counted above as finding 4
3. CSV export on every list, honouring filters and columns; a reports page with cycle time and expiry pipeline (Daniel, Ines, Ade, Oliver, Hannah). 5
4. Templates: matter templates with task checklists, contract type to template document, obligation templates by jurisdiction (Marcus, Priya, Sofia, Ines, Tom). 5
5. Reminders with lead time on key dates and obligations, with time of day (Priya, Sofia, Ines). 3
6. Duplicate, edit, cancel, or reference-an-existing-agreement on portal requests (Diego, Oliver, Jonas, Mei). 4
7. Department-level "what is late, by owner" view and triage SLA clock (Daniel, Amara, Ines). 3
8. Bulk select and bulk edit on lists (Ines, Tom). 2
9. Real keyboard support: module keys, row navigation, Enter to submit inline forms, Ctrl+Enter to send (Tom, Felix, Jonas). 3
10. Working Compare, real signature send, approvers outside the legal team (Nadia). 1 but core to the CLM pitch
11. Admin control of who may sign in, SSO/OIDC, session list, security headers (Karim). 1
12. Slack notifications or slash-command intake (Diego). 1
13. Markdown or autolinks in descriptions and comments (Felix). 1
14. Manager team view and escalate button (Amara). 1
15. Privileged document marker and "sensitive personal data" flag on uploads (Clara). 1

## Caveats

- The testers shared one seeded database. Some contradictions (Legal reply on an "Open" request, "Awaiting approval" with no approvals, advice note reachable by HR) may be seed data rather than product bugs. Each is flagged "verify vs seed" where relevant.
- Emails linking to localhost:3000 and the 502s are likely dev-environment artefacts. Worth confirming the email base URL config before dismissing.
- Every tester created records prefixed `[FG-<slug>]` in the dev database (requests R-71 to R-97, contracts C-205 to C-209, matters M-91 to M-93, one entity, one knowledge item and folder, one saved view). Nothing was deleted or reconfigured.
