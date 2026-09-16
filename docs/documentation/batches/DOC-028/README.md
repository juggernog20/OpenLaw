# Auto-Doc builder and template guide completion

Issues: [#874](https://github.com/juggernog20/OpenLaw/issues/874) and [#875](https://github.com/juggernog20/OpenLaw/issues/875).

## Scope

The DES-087 builder is present in the committed application at `f8d7312cdad20a2e5002349954eb1e9f9181b80c`. This completion adds accessibility coverage for the populated Generations tab and waits for assignment confirmation before checking that a generated Contract leaves the Inbox. The latter prevents an open modal from hiding background rows from a role locator before the write completes.

The guide was authored in `79812286` and corrected in `019591c7`. The current source review is recorded in [technical-review.json](technical-review.json). Independent V-C56 observations are recorded separately; automated journeys do not substitute for following the guide.

## #874 acceptance audit

| Requirement                                                                       | Implementation and verification                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routed record, rename, state, primary action, overflow                            | `apps/web/src/routes/auto-doc-record.tsx`; Auto-Doc route tests and journeys 49/50/51/57.                                                                                                                      |
| Template reading, selectable Placeholder and Block markers, missing-field warning | `components/auto-docs/template-pane.tsx`; `auto-doc-publish.test.tsx` selects fields and Blocks.                                                                                                               |
| Fields/Clauses table cards and per-control form versions                          | `components/auto-docs/form-builder.tsx`; `useFieldCommit`, `ListEditor`, queued definition commits; route tests verify editing and absence of Save form.                                                       |
| Guard removal while a Placeholder remains; remove an orphan directly              | `requestRemove` checks detection before opening the guard dialog; `removeField` appends the new definition.                                                                                                    |
| Upload dialog with detection summary and retained refusal                         | `components/auto-docs/upload-dialog.tsx`; journey 49 and `auto-docs.test.tsx`.                                                                                                                                 |
| Publish version pair and refusal list; Unpublish/Archive/Restore                  | `components/auto-docs/publish-dialog.tsx`, record action menu; journey 50 and `auto-doc-publish.test.tsx`.                                                                                                     |
| Settings cards and Assignment rules dialog                                        | `components/auto-docs/settings-cards.tsx`; journeys 53/54 and settings route tests. Acknowledgement frequency subsequently moved to organisation Settings under ADO-008; the record retains its text override. |
| Compact card anatomy without legends/h3 subcards                                  | Record component and `components/auto-docs/` implementation; DES-087 built addendum.                                                                                                                           |
| Reading route includes document parts and checks ownership                        | `apps/api/src/lib/auto-doc-reading.ts`, `auto-doc-template.ts`, `modules/auto-docs/reading.test.ts`. Part classification includes body, numbered headers/footers, footnotes and endnotes.                      |
| Updated journeys and accessibility on all four tabs                               | Overview: journey 57; Form: journeys 49/50; Settings: journeys 53/54; Generations: added scan in journey 51 after the generated row and download are visible.                                                  |
| Help article linked from template pane                                            | `docs/user-guides/auto-doc-template.md`, template pane Help link, V-C56 independent walkthrough.                                                                                                               |
| Decision-record addenda                                                           | ADO-003/004/006 reference DES-087; DES-087 has its built addendum.                                                                                                                                             |

Component paths above are relative to `apps/web/src/` unless otherwise stated. This audit concerns the builder; the separate Auto-Docs list redesign and future repeating Blocks are outside these issues.

## Verification results

The independent agent walkthrough passed V-C56 for both required roles: 37 recorded steps passed, including the unclosed Block, unclosed brace, and directive/type mismatch refusals. The guide text is unchanged. Its catalog status progressed from draft to review in `f70532e5`, then to verified after this walkthrough. [The verification record](../../evidence/auto-doc-template.json) binds the article hash to the committed lab build.

- [Independent walkthrough](independent-walkthrough.json): role-specific observations, build identities, fixture hashes, screenshots, and limitations.
- [Builder validation](builder-validation.json) and [journey output](builder-journeys.txt): six passing journeys with axe coverage across Overview, Form, Settings, and Generations.
  That output was recorded before the journey 54 dialog wait was added. Journeys 51, 53, and 54 were rerun against the same lab build on 2026-09-16 after that edit, and all three passed with no axe violations.
- [Help accessibility](help-accessibility.json): zero axe violations in Light, Warm, and Dark and no page overflow at 390 px.

The walkthrough is an independent agent review, not a human user study. It records two minor builder usability observations: clipped Upload version text at 390 px and extra Tab presses between a selected Placeholder and its field card. Neither prevented the guide's tasks. The first walkthrough attempt had two timing/locator errors in the reviewer script; its corrected rerun and disposition are recorded in the evidence.

Only this article is promoted. The edition compatibility record retains the exact application digest of the tested build; the other guides retain their existing verification status.

After the walkthrough, the completion agent fixed ZIP entry timestamps in `fixtures/build-fixtures.py` following CodeRabbit review. All six regenerated files match the recorded fixture bytes and SHA-256 hashes exactly.
