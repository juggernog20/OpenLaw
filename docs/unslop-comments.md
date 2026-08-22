# Unslop comments inventory

Files whose comments have had a full pass. `/unslop-comments` reads this to pick
the next batch, so a file listed here is not offered again.

A row records the sha the file was at when it was reviewed. If the file has moved
a long way since, it is worth another pass.

| File                                                              | Reviewed   | Sha     | Edited | Deleted | Added | Notes                                                |
| ----------------------------------------------------------------- | ---------- | ------- | ------ | ------- | ----- | ---------------------------------------------------- |
| `apps/web/src/routes/contract-record.test.tsx`                    | 2026-08-22 | 7c7d05c | 0      | 1       | 0     |                                                      |
| `apps/api/src/modules/documents/routes.ts`                        | 2026-08-22 | 7c7d05c | 0      | 0       | 0     | Comments preserve document and access invariants.    |
| `apps/api/src/modules/contracts/routes.ts`                        | 2026-08-22 | 7c7d05c | 0      | 0       | 0     | Comments preserve domain and transaction invariants. |
| `apps/web/src/components/documents/documents-card.tsx`            | 2026-08-22 | 7c7d05c | 0      | 0       | 0     | Comments preserve interaction decisions.             |
| `apps/web/src/routes/contract-record.tsx`                         | 2026-08-22 | 7c7d05c | 0      | 0       | 0     | Comments preserve interaction and domain decisions.  |
| `apps/api/src/lib/notifications/notifier.ts`                      | 2026-08-22 | 7c7d05c | 0      | 1       | 0     |                                                      |
| `apps/web/src/lib/activity.ts`                                    | 2026-08-22 | 7c7d05c | 3      | 1       | 0     |                                                      |
| `apps/api/src/modules/documents/folders.ts`                       | 2026-08-22 | 7c7d05c | 0      | 0       | 0     | Comments preserve folder invariants.                 |
| `apps/api/src/lib/contract-access.ts`                             | 2026-08-22 | 7c7d05c | 0      | 0       | 0     | Comments preserve access rules.                      |
| `packages/shared/src/activity.ts`                                 | 2026-08-22 | 7c7d05c | 2      | 2       | 0     | Removed decorative section rules.                    |
| `e2e/tests/22-m16-demo.spec.ts`                                   | 2026-08-22 | 8dc6217 | 0      | 1       | 0     |                                                      |
| `apps/web/src/components/approvals/approvals-signing-card.tsx`    | 2026-08-22 | 8dc6217 | 0      | 1       | 0     |                                                      |
| `e2e/tests/19-m13-demo.spec.ts`                                   | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/contract-envelopes/routes.ts`               | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `e2e/tests/18-m12-demo.spec.ts`                                   | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/pipeline/pg-boss.ts`                                | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `e2e/tests/21-m15-demo.spec.ts`                                   | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/comments/audience.ts`                       | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/web/src/components/comments/comment-applet.tsx`             | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `packages/shared/src/index.ts`                                    | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/notifications/audience.ts`                      | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/pipeline/morning-round.ts`                          | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `e2e/tests/20-m14-demo.spec.ts`                                   | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/comments/routes.ts`                         | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/pipeline/executed-copy.ts`                          | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/notifications/email.ts`                         | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/web/src/lib/documents.ts`                                   | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/documents/documents.test.ts`                | 2026-08-22 | 8dc6217 | 0      | 2       | 0     |                                                      |
| `apps/api/src/modules/requests/routes.ts`                         | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/auth/instance.ts`                                   | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `e2e/tests/17-m11-demo.spec.ts`                                   | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/web/src/components/documents/batch-dialog.tsx`              | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/contracts/confidentiality.test.ts`          | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `packages/db/src/schema/contracts.ts`                             | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `packages/db/src/schema/documents.ts`                             | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `e2e/tests/27-m21-demo.spec.ts`                                   | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/web/src/components/documents/pdf-preview.tsx`               | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/contract-approvals/routes.ts`               | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/email/parse.ts`                                 | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/web/src/lib/batch-upload.ts`                                | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/taxonomy-routes.ts`                             | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/web/src/lib/requests.ts`                                    | 2026-08-22 | 8dc6217 | 0      | 1       | 0     |                                                      |
| `apps/web/src/components/documents/doc-panel.tsx`                 | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/notifications/routes.ts`                    | 2026-08-22 | 8dc6217 | 0      | 3       | 0     |                                                      |
| `apps/web/src/lib/contracts.ts`                                   | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/pipeline/jobs.ts`                                   | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/pipeline/reconciliation.ts`                         | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/comments/comments.test.ts`                  | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/documents/document-confidentiality.test.ts` | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/testing/harness.ts`                                 | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `e2e/tests/24-m18-demo.spec.ts`                                   | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/web/src/components/table/managed-table.tsx`                 | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `e2e/tests/26-m20-demo.spec.ts`                                   | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/pipeline/text-extraction.ts`                        | 2026-08-22 | 8dc6217 | 0      | 1       | 0     |                                                      |
| `apps/api/src/modules/requests/projection.ts`                     | 2026-08-22 | 8dc6217 | 0      | 2       | 0     |                                                      |
| `apps/web/src/lib/notifications.ts`                               | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/notifications/catalog.ts`                       | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/contracts/create.ts`                        | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/requests/promote-paper.ts`                  | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/contracts/contracts.test.ts`                | 2026-08-22 | 8dc6217 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/signing/docusign.ts`                            | 2026-08-22 | 0df3333 | 0      | 4       | 0     |                                                      |
| `apps/web/src/routes/inbox-request.tsx`                           | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/audit-log/routes.ts`                        | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `e2e/tests/16-m10-demo.spec.ts`                                   | 2026-08-22 | 0df3333 | 0      | 2       | 0     |                                                      |
| `apps/api/src/modules/requests/convert.ts`                        | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/web/src/routes/portal-request-form.tsx`                     | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `packages/db/src/schema/notifications.ts`                         | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `packages/db/src/schema/contract-envelopes.ts`                    | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/notifications/record-activity.test.ts`      | 2026-08-22 | 0df3333 | 0      | 4       | 0     |                                                      |
| `e2e/tests/14-m8-demo.spec.ts`                                    | 2026-08-22 | 0df3333 | 0      | 1       | 0     |                                                      |
| `apps/api/src/modules/contract-key-dates/routes.ts`               | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/render-family.ts`                               | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/type-field-routes.ts`                           | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/web/src/components/notification-bell.tsx`                   | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/web/src/components/type-editor-screen.tsx`                  | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/pipeline/display-conversion.ts`                     | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `compose.yml`                                                     | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/auth/routes.ts`                             | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/notifications/requester-events.test.ts`     | 2026-08-22 | 0df3333 | 0      | 1       | 0     |                                                      |
| `e2e/tests/25-m19-demo.spec.ts`                                   | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/custom-fields.ts`                               | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/signing/provider.ts`                            | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/notifications/date-reminders.test.ts`       | 2026-08-22 | 0df3333 | 0      | 5       | 0     |                                                      |
| `apps/web/src/routes/contracts.tsx`                               | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/web/src/lib/list-views.ts`                                  | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/documents/folders.test.ts`                  | 2026-08-22 | 0df3333 | 0      | 1       | 0     |                                                      |
| `apps/api/src/lib/signing/transitions.ts`                         | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/notifications/notifications.test.ts`        | 2026-08-22 | 0df3333 | 0      | 4       | 0     |                                                      |
| `apps/api/src/modules/requests/inbox.ts`                          | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/requests/convert-thread.test.ts`            | 2026-08-22 | 0df3333 | 0      | 2       | 0     |                                                      |
| `apps/api/src/modules/activity/routes.ts`                         | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/documents/document-rendition.test.ts`       | 2026-08-22 | 0df3333 | 0      | 1       | 0     |                                                      |
| `e2e/tests/15-m9-demo.spec.ts`                                    | 2026-08-22 | 0df3333 | 0      | 2       | 0     |                                                      |
| `packages/db/src/schema/comments.ts`                              | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `e2e/tests/helpers.ts`                                            | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/contract-relations.ts`                          | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/email/sanitize.ts`                              | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/web/src/lib/format.ts`                                      | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/documents/folder-drop.test.ts`              | 2026-08-22 | 0df3333 | 0      | 1       | 0     |                                                      |
| `e2e/scripts/upgrade-fidelity.mjs`                                | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/storage/config.ts`                              | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/contract-envelopes/reconciliation.test.ts`  | 2026-08-22 | 0df3333 | 0      | 11      | 0     |                                                      |
| `apps/api/src/app.ts`                                             | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/contract-envelopes/send.test.ts`            | 2026-08-22 | 0df3333 | 0      | 2       | 0     |                                                      |
| `apps/api/src/modules/requests/disposition.ts`                    | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `packages/db/src/secrets.ts`                                      | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/signing-webhook/routes.ts`                  | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/contract-envelopes/completion.test.ts`      | 2026-08-22 | 0df3333 | 0      | 8       | 0     |                                                      |
| `packages/db/src/migration-journal.ts`                            | 2026-08-22 | 0df3333 | 0      | 0       | 0     |                                                      |
| `apps/web/src/routes/portal-request.test.tsx`                     | 2026-08-22 | 0df3333 | 0      | 1       | 0     |                                                      |
| `apps/worker/src/index.ts`                                        | 2026-08-22 | 2efa1e0 | 0      | 1       | 0     |                                                      |
| `apps/api/src/pipeline/backfill.ts`                               | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `e2e/tests/23-m17-demo.spec.ts`                                   | 2026-08-22 | 2efa1e0 | 0      | 47      | 0     |                                                      |
| `packages/db/src/index.ts`                                        | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/pipeline/notification-email.ts`                     | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `services/doc-engine/src/operations.ts`                           | 2026-08-22 | 2efa1e0 | 0      | 4       | 0     |                                                      |
| `apps/web/src/routes/portal-request.tsx`                          | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/signing-connector/routes.ts`                | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/doc-engine/http.ts`                             | 2026-08-22 | 2efa1e0 | 0      | 3       | 0     |                                                      |
| `apps/web/src/components/intake/convert-dialog.tsx`               | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/documents/document-text.test.ts`            | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/contract-term.ts`                               | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/contracts/renewal-routing.test.ts`          | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/web/src/components/contracts/key-dates-card.tsx`            | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/requests/move-thread.ts`                    | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/documents/document-filing.test.ts`          | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/documents/document-backfill.test.ts`        | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `styles/globals.css`                                              | 2026-08-22 | 2efa1e0 | 0      | 1       | 0     |                                                      |
| `apps/api/src/modules/contract-relations/routes.ts`               | 2026-08-22 | 2efa1e0 | 0      | 6       | 0     |                                                      |
| `apps/web/src/routes/settings-request-type-editor.tsx`            | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `e2e/tests/docusign.ts`                                           | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/notifications/direct-events.test.ts`        | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/testing/doc-engine-contract.ts`                     | 2026-08-22 | 2efa1e0 | 0      | 4       | 0     |                                                      |
| `apps/web/src/routes/settings-audit-log.tsx`                      | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/web/src/routes/settings-intake-links.tsx`                   | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/uploads.ts`                                     | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/storage/azure-blob.ts`                          | 2026-08-22 | 2efa1e0 | 0      | 1       | 0     |                                                      |
| `apps/web/src/lib/folders.ts`                                     | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/web/src/routes/settings-e-signature.tsx`                    | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/requests/convert-paper.test.ts`             | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/doc-engine/engine.ts`                           | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/web/src/components/taxonomy-types-pane.tsx`                 | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/web/src/routes/contracts.test.tsx`                          | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `.coderabbit.yaml`                                                | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     | Protected review-bot directives retained.            |
| `apps/web/src/components/portal/request-thread.tsx`               | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/doc-engine/http.test.ts`                        | 2026-08-22 | 2efa1e0 | 0      | 1       | 0     |                                                      |
| `apps/web/src/components/notification-preferences.tsx`            | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/web/src/routes/contracts-columns.test.tsx`                  | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/documents/document-email.test.ts`           | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/list-views/routes.ts`                       | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `packages/db/src/schema/auth.ts`                                  | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/web/src/components/contracts/contracts-columns.tsx`         | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/signing/config.ts`                              | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/web/src/routes/contract-record-relations.test.tsx`          | 2026-08-22 | 2efa1e0 | 0      | 31      | 0     |                                                      |
| `apps/api/src/lib/doc-engine/fake.ts`                             | 2026-08-22 | 2efa1e0 | 0      | 8       | 0     |                                                      |
| `apps/web/src/lib/comments.ts`                                    | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/media-type.ts`                                  | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/lib/signer-erasure.ts`                              | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/api/src/modules/requests/convert.test.ts`                   | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |
| `apps/web/src/components/documents/email-preview.tsx`             | 2026-08-22 | 2efa1e0 | 0      | 0       | 0     |                                                      |

| `apps/api/src/index.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/web/src/components/stage-pipeline.tsx` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/web/src/testing/helpers.tsx` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/lib/activity.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/notifications/preferences.test.ts` | 2026-08-22 | f12c1c5 | 0 | 5 | 0 | |
| `apps/web/src/router.tsx` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/lib/storage/s3.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/contract-envelopes/void.test.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/documents/document-batch.test.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/web/src/routes/settings-reminders.tsx` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/web/src/lib/activity.test.ts` | 2026-08-22 | f12c1c5 | 21 | 0 | 0 | |
| `apps/api/src/lib/signing/resolver.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/contracts/renewal.test.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/audit-log/audit-log.test.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/lib/storage/adapter.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/lib/signing/fake.ts` | 2026-08-22 | f12c1c5 | 1 | 0 | 0 | |
| `packages/db/src/rewrap.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `packages/db/src/schema/requests.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/web/src/components/list-editor.tsx` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/intake-links/routes.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/signing-webhook/webhook.test.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/web/src/components/contracts/link-dialog.tsx` | 2026-08-22 | f12c1c5 | 0 | 6 | 0 | |
| `apps/web/src/routes/settings.tsx` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `services/doc-engine/src/server.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/request-types/form-definition.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/lib/document-versions.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/testing/deps.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/web/src/routes/contract-record-renewal.test.tsx` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `packages/db/src/schema/document-folders.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/contract-tasks/routes.ts` | 2026-08-22 | f12c1c5 | 0 | 12 | 0 | |
| `apps/api/src/lib/storage/local.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/lib/notifications/offsets.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/approver-groups/routes.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `packages/db/src/schema/contract-approvals.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/activity/activity.test.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/documents/document-preview.test.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/lib/taxonomy-extras.test.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/web/src/components/contracts/confirm-renewal-dialog.tsx` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/account-issuer-migration.test.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/web/src/lib/envelopes.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `packages/db/src/schema/document-text.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/requests/requests.test.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/web/src/components/notification-bell.test.tsx` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/web/src/routes/settings-audit-log.test.tsx` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/notifications/new-requests.test.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/lib/soft-gate.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/lib/problem.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `e2e/tests/10-settings.spec.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/requests/request-detail.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/notifications/request-mentions.test.ts` | 2026-08-22 | f12c1c5 | 0 | 0 | 0 | |
| `apps/api/src/modules/request-types/routes.ts` | 2026-08-22 | 3db24ef | 0 | 3 | 0 | |
| `packages/db/src/schema/signing-connectors.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/lib/activity-emitter.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `.github/workflows/ci.yml` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | Protected workflow comments retained. |
| `apps/web/src/lib/approvals.ts` | 2026-08-22 | 3db24ef | 0 | 2 | 0 | |
| `apps/api/src/modules/requests/request-detail.test.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/web/src/components/contracts/term-timeline-card.tsx` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/web/src/components/activity/activity-applet.tsx` | 2026-08-22 | 3db24ef | 0 | 2 | 0 | |
| `apps/api/src/lib/notifications/preferences.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/modules/auth/sso.test.ts` | 2026-08-22 | 3db24ef | 0 | 3 | 0 | |
| `apps/api/src/lib/notifications/local-day.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `packages/db/src/schema/list-views.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `packages/db/src/schema/document-rendition.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/web/src/routes/inbox-request-convert.test.tsx` | 2026-08-22 | 3db24ef | 0 | 2 | 0 | |
| `apps/api/scripts/build-doc-engine-fixtures.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/modules/fields/routes.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/modules/comments/request-thread.test.ts` | 2026-08-22 | 3db24ef | 0 | 1 | 0 | |
| `apps/web/src/components/shell/record-applets.tsx` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `packages/db/src/schema/fields.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `packages/db/src/schema/contract-key-dates.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/web/src/routes/settings-request-type-editor.test.tsx` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/modules/contract-key-dates/key-dates.test.ts` | 2026-08-22 | 3db24ef | 0 | 4 | 0 | |
| `apps/web/src/components/contracts/create-contract-dialog.tsx` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/modules/portal/routes.ts` | 2026-08-22 | 3db24ef | 0 | 2 | 0 | |
| `apps/web/src/routes/contract-record-envelopes.test.tsx` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/web/src/routes/contract-record-key-dates.test.tsx` | 2026-08-22 | 3db24ef | 0 | 2 | 0 | |
| `apps/api/src/modules/requests/request-attachments.test.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `e2e/tests/12-m6-demo.spec.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/web/src/components/counterparty-picker.tsx` | 2026-08-22 | 3db24ef | 0 | 1 | 0 | |
| `eslint.config.js` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | Protected linter directives retained. |
| `apps/api/src/modules/contract-approvals/group-apply.test.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/modules/contract-relations/link-management.test.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/web/src/routes/contract-record-routing.test.tsx` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/web/src/routes/inbox.tsx` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/modules/contract-approvals/approvals.test.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/modules/contracts/end-of-life.test.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/testing/fixtures/email.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/modules/requests/resolve.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/modules/contract-statuses/routes.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/web/src/components/contracts/team-applet.tsx` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/modules/contract-relations/relations.test.ts` | 2026-08-22 | 3db24ef | 0 | 2 | 0 | |
| `apps/api/src/lib/email/parse.test.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/migration-journal.test.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/pipeline/derivations.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `packages/db/src/schema/contract-relations.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/api/src/modules/requests/resolve.test.ts` | 2026-08-22 | 3db24ef | 0 | 3 | 0 | |
| `apps/api/src/modules/contracts/sorting.test.ts` | 2026-08-22 | 3db24ef | 0 | 2 | 0 | |
| `apps/web/src/routes/contract-record-soft-gate.test.tsx` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |
| `apps/web/src/lib/key-dates.ts` | 2026-08-22 | 3db24ef | 0 | 1 | 0 | |
| `packages/db/src/schema/org.ts` | 2026-08-22 | 3db24ef | 0 | 0 | 0 | |

## Skipped

Files this sweep will never offer, and why.

| File or glob | Reason |
| ------------ | ------ |
