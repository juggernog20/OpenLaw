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
| `apps/api/src/modules/signing-connector/signing-connector.test.ts` | 2026-08-22 | a687234 | 0 | 3 | 0 | |
| `apps/web/src/routes/contract-record-approvals.test.tsx` | 2026-08-22 | a687234 | 0 | 5 | 0 | |
| `apps/api/src/modules/notifications/round-trigger.test.ts` | 2026-08-22 | a687234 | 0 | 0 | 0 | |
| `apps/web/src/components/intake/decline-dialog.tsx` | 2026-08-22 | a687234 | 0 | 4 | 0 | |
| `apps/web/src/components/intake/resolve-dialog.tsx` | 2026-08-22 | a687234 | 0 | 5 | 0 | |
| `apps/api/src/modules/comments/post.ts` | 2026-08-22 | a687234 | 0 | 1 | 0 | |
| `compose.dev.yml` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments preserve development-network constraints. |
| `apps/web/src/routes/inbox-request.test.tsx` | 2026-08-22 | a687234 | 0 | 5 | 0 | |
| `apps/api/src/modules/contract-approvals/soft-gate.test.ts` | 2026-08-22 | a687234 | 0 | 11 | 0 | |
| `apps/api/src/modules/contracts/term.test.ts` | 2026-08-22 | a687234 | 0 | 8 | 0 | |
| `apps/api/src/modules/requests/decline.test.ts` | 2026-08-22 | a687234 | 0 | 2 | 0 | |
| `apps/api/src/modules/org/reminder-offsets.test.ts` | 2026-08-22 | a687234 | 0 | 8 | 0 | Removed decorative section rules. |
| `apps/api/src/modules/request-types/attached-fields.test.ts` | 2026-08-22 | a687234 | 0 | 2 | 0 | |
| `e2e/tests/11-m5-demo.spec.ts` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments preserve shared-instance cleanup constraints. |
| `apps/web/src/testing/disposition.ts` | 2026-08-22 | a687234 | 0 | 8 | 0 | |
| `apps/api/src/modules/contracts/custom-fields.test.ts` | 2026-08-22 | a687234 | 0 | 3 | 0 | |
| `apps/api/src/modules/requests/inbox.test.ts` | 2026-08-22 | a687234 | 0 | 3 | 0 | |
| `apps/api/src/approver-group-name-migration.test.ts` | 2026-08-22 | a687234 | 0 | 3 | 0 | |
| `packages/db/src/schema/contract-tasks.ts` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments preserve task schema invariants. |
| `packages/db/src/schema/request-types.ts` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments preserve target-column invariants. |
| `apps/web/src/routes/settings-approver-groups.tsx` | 2026-08-22 | a687234 | 0 | 4 | 0 | |
| `apps/web/src/components/contracts/related-contracts-card.tsx` | 2026-08-22 | a687234 | 0 | 5 | 0 | Removed decorative section rules. |
| `styles/lint-contrast.mjs` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments map contrast checks to their surfaces. |
| `apps/api/src/lib/signing/resolver.test.ts` | 2026-08-22 | a687234 | 0 | 1 | 0 | |
| `.github/workflows/i18n.yml` | 2026-08-22 | a687234 | 0 | 0 | 0 | Protected workflow comments retained. |
| `apps/web/src/lib/custom-fields.ts` | 2026-08-22 | a687234 | 0 | 1 | 0 | |
| `apps/web/src/routes/portal.test.tsx` | 2026-08-22 | a687234 | 0 | 1 | 0 | |
| `apps/web/src/routes/contract-record-term.test.tsx` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments preserve draft and timing behavior. |
| `apps/web/src/routes/portal-notifications.test.tsx` | 2026-08-22 | a687234 | 0 | 5 | 0 | Removed decorative section rules. |
| `apps/api/src/modules/org/routes.ts` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments preserve transaction and audit behavior. |
| `packages/db/src/schema/approver-groups.ts` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments preserve membership and archive invariants. |
| `apps/api/src/modules/request-types/request-types.test.ts` | 2026-08-22 | a687234 | 0 | 3 | 0 | |
| `apps/web/src/routes/portal-request-form.test.tsx` | 2026-08-22 | a687234 | 0 | 4 | 0 | |
| `apps/api/src/testing/signing-contract.ts` | 2026-08-22 | a687234 | 0 | 6 | 0 | |
| `apps/api/src/lib/mailer.ts` | 2026-08-22 | a687234 | 0 | 1 | 0 | |
| `services/doc-engine/src/index.ts` | 2026-08-22 | a687234 | 0 | 3 | 0 | |
| `apps/web/src/routes/contract-record-timeline.test.tsx` | 2026-08-22 | a687234 | 0 | 3 | 0 | |
| `apps/api/src/modules/contracts/create.test.ts` | 2026-08-22 | a687234 | 0 | 9 | 0 | |
| `apps/api/src/lib/storage/azure-blob.test.ts` | 2026-08-22 | a687234 | 0 | 3 | 0 | |
| `apps/api/src/testing/disposition.ts` | 2026-08-22 | a687234 | 0 | 6 | 0 | |
| `apps/api/src/modules/contract-statuses/contract-statuses.test.ts` | 2026-08-22 | a687234 | 0 | 2 | 0 | |
| `apps/web/src/components/shell/record-applets.test.tsx` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments preserve focus and responsive-layout behavior. |
| `apps/web/src/routes/inbox-request-resolve.test.tsx` | 2026-08-22 | a687234 | 0 | 1 | 0 | |
| `apps/api/src/modules/requests/decline.ts` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments preserve validation and audit rationale. |
| `apps/web/vite-pdfjs-assets.ts` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments preserve asset-serving constraints. |
| `apps/api/src/modules/notifications/round-trigger.ts` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments preserve the test-only route boundary. |
| `apps/web/src/lib/renewals.ts` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments preserve generated-schema and error semantics. |
| `apps/web/src/components/table/column-menu.tsx` | 2026-08-22 | a687234 | 0 | 0 | 0 | Comments preserve ordering and accessibility decisions. |
| `apps/api/src/testing/migration-rehearsal.ts` | 2026-08-22 | a687234 | 0 | 3 | 0 | |
| `apps/web/src/components/custom-field-control.tsx` | 2026-08-22 | a687234 | 0 | 6 | 0 | |
| `apps/web/src/lib/field-commit.ts` | 2026-08-29 | 39fe0a1 | 0 | 0 | 0 | Already clean. |
| `apps/api/src/lib/type-field-scope-rule.test.ts` | 2026-08-29 | 39fe0a1 | 5 | 0 | 0 | Line 66 comment misdescribed `app`; fixed. |
| `apps/api/src/lib/doc-engine/config.ts` | 2026-08-29 | 39fe0a1 | 2 | 0 | 0 | |
| `apps/web/src/components/contracts/renewal-banner.tsx` | 2026-08-29 | 39fe0a1 | 5 | 0 | 0 | |
| `packages/db/src/schema/counterparties.ts` | 2026-08-29 | 39fe0a1 | 3 | 0 | 0 | |
| `apps/api/src/modules/approver-groups/approver-groups.test.ts` | 2026-08-29 | 39fe0a1 | 3 | 0 | 0 | |
| `apps/web/src/routes/settings-authentication.tsx` | 2026-08-29 | 39fe0a1 | 10 | 0 | 0 | |
| `apps/web/src/routes/settings-request-types.tsx` | 2026-08-29 | 39fe0a1 | 2 | 0 | 0 | |
| `e2e/tests/13-m7-demo.spec.ts` | 2026-08-29 | 39fe0a1 | 5 | 0 | 0 | |
| `apps/web/src/routes/portal.tsx` | 2026-08-29 | 39fe0a1 | 1 | 0 | 0 | |
| `apps/api/src/auth/audit.ts` | 2026-08-29 | 39fe0a1 | 7 | 0 | 0 | |
| `styles/themes/warm.css` | 2026-08-29 | 39fe0a1 | 7 | 0 | 0 | Frame name keeps its em dash; it is the .pen frame's name. |
| `packages/db/src/schema/helpers.ts` | 2026-08-29 | 39fe0a1 | 3 | 0 | 0 | |
| `scripts/dev-hot.sh` | 2026-08-29 | 39fe0a1 | 5 | 0 | 0 | |
| `packages/db/src/schema/intake-links.ts` | 2026-08-29 | 39fe0a1 | 3 | 0 | 0 | Example label mirrors the test fixture, em dash kept. |
| `compose.hostdev.yml` | 2026-08-29 | 39fe0a1 | 4 | 0 | 0 | |
| `apps/api/src/modules/intake-links/intake-links.test.ts` | 2026-08-29 | 39fe0a1 | 6 | 0 | 0 | |
| `apps/web/src/routes/settings-contract-statuses.tsx` | 2026-08-29 | 39fe0a1 | 8 | 0 | 0 | |
| `apps/api/src/modules/users/routes.ts` | 2026-08-29 | 39fe0a1 | 6 | 0 | 0 | |
| `apps/api/src/lib/signing/config.test.ts` | 2026-08-29 | 39fe0a1 | 3 | 0 | 0 | |
| `apps/api/src/lib/signing/completion.ts` | 2026-08-29 | 39fe0a1 | 3 | 0 | 0 | |
| `apps/api/src/testing/storage-contract.ts` | 2026-08-29 | 39fe0a1 | 5 | 0 | 0 | |
| `apps/web/src/components/portal/my-requests.tsx` | 2026-08-29 | 39fe0a1 | 3 | 0 | 0 | |
| `apps/web/src/components/portal/deflection-panel.tsx` | 2026-08-29 | 39fe0a1 | 5 | 0 | 0 | |
| `apps/api/src/modules/contracts/type-usage.ts` | 2026-08-29 | 39fe0a1 | 4 | 0 | 0 | |
| `apps/web/src/routes/settings-matter-statuses.tsx` | 2026-08-29 | 39fe0a1 | 7 | 0 | 0 | |
| `apps/api/src/modules/entities/routes.ts` | 2026-08-29 | 39fe0a1 | 5 | 0 | 0 | |
| `apps/web/src/routes/settings-request-types.test.tsx` | 2026-08-29 | 39fe0a1 | 4 | 0 | 0 | |
| `apps/api/src/modules/list-views/list-views.test.ts` | 2026-08-29 | 39fe0a1 | 1 | 0 | 0 | |
| `apps/web/src/routes/settings-contract-fields.tsx` | 2026-08-29 | 39fe0a1 | 6 | 0 | 0 | Three drifted comments corrected. Archive copy may under-describe record values. |
| `apps/web/src/components/shell/applets.ts` | 2026-08-29 | 39fe0a1 | 3 | 0 | 0 | |
| `apps/web/src/routes/inbox-request-decline.test.tsx` | 2026-08-29 | 39fe0a1 | 3 | 0 | 0 | |
| `apps/api/src/modules/counterparties/counterparties.test.ts` | 2026-08-29 | 39fe0a1 | 4 | 0 | 0 | |
| `apps/api/src/lib/storage/s3.test.ts` | 2026-08-29 | 39fe0a1 | 3 | 0 | 0 | |
| `apps/api/src/modules/signer-erasure/routes.ts` | 2026-08-29 | 39fe0a1 | 5 | 0 | 0 | |
| `apps/web/src/components/shell/applet-panel.tsx` | 2026-08-29 | 39fe0a1 | 4 | 0 | 0 | NOSONAR marker kept. |
| `apps/api/src/testing/fixtures/office.ts` | 2026-08-29 | 39fe0a1 | 5 | 0 | 0 | |
| `apps/api/src/lib/approvers.ts` | 2026-08-29 | 39fe0a1 | 2 | 0 | 0 | |
| `packages/db/src/schema/request-attachments.ts` | 2026-08-29 | 39fe0a1 | 4 | 0 | 0 | |
| `apps/api/src/lib/signing/docusign.test.ts` | 2026-08-29 | 39fe0a1 | 4 | 2 | 0 | |
| `apps/web/src/routes/settings-users.tsx` | 2026-08-29 | 39fe0a1 | 8 | 0 | 0 | rowAction lock comment corrected to per-row. |
| `apps/api/src/lib/secrets.test.ts` | 2026-08-29 | 39fe0a1 | 3 | 0 | 0 | NOSONAR lines left byte for byte. |
| `e2e/tests/08-accessibility.spec.ts` | 2026-08-29 | 39fe0a1 | 3 | 0 | 0 | Header now lists every scanned page. |
| `apps/api/src/modules/email-settings/routes.ts` | 2026-08-29 | 39fe0a1 | 6 | 0 | 0 | |
| `apps/web/src/components/shell/app-shell.tsx` | 2026-08-29 | 39fe0a1 | 6 | 0 | 0 | |
| `apps/web/src/routes/portal-settings.tsx` | 2026-08-29 | 39fe0a1 | 5 | 0 | 0 | |
| `apps/web/src/components/confidential-marker.tsx` | 2026-08-29 | 39fe0a1 | 4 | 0 | 0 | |
| `scripts/lint-versions.mjs` | 2026-08-29 | 39fe0a1 | 2 | 0 | 0 | |
| `apps/web/src/components/confidential-banner.tsx` | 2026-08-29 | 39fe0a1 | 5 | 0 | 0 | |
| `apps/web/src/lib/roles.ts` | 2026-08-29 | 39fe0a1 | 6 | 0 | 0 | |
| `packages/db/src/schema/contract-counterparties.ts` | 2026-08-29 | fa9a663 | 3 | 0 | 0 | |
| `apps/web/src/components/contracts/tasks-card.tsx` | 2026-08-29 | fa9a663 | 1 | 0 | 0 | |
| `styles/themes/dark.css` | 2026-08-29 | fa9a663 | 6 | 0 | 0 | Token-group banners kept. |
| `apps/api/src/pipeline/backfill.test.ts` | 2026-08-29 | fa9a663 | 2 | 0 | 0 | |
| `apps/api/src/lib/storage/config.test.ts` | 2026-08-29 | fa9a663 | 3 | 0 | 0 | `NOSONAR` markers left as is. |
| `apps/web/src/routes/settings-notifications.test.tsx` | 2026-08-29 | fa9a663 | 6 | 0 | 0 | |
| `apps/web/src/routes/matter-record.tsx` | 2026-08-29 | fa9a663 | 1 | 0 | 0 | |
| `apps/web/src/lib/relations.ts` | 2026-08-29 | fa9a663 | 1 | 0 | 0 | Section banners kept, used consistently. |
| `scripts/lint-migration-journal.mjs` | 2026-08-29 | fa9a663 | 4 | 0 | 0 | |
| `apps/api/src/modules/counterparties/routes.ts` | 2026-08-29 | fa9a663 | 2 | 0 | 0 | |
| `apps/web/src/routes/entities.tsx` | 2026-08-29 | fa9a663 | 5 | 0 | 0 | |
| `e2e/tests/03-invite-activation-totp.spec.ts` | 2026-08-29 | fa9a663 | 5 | 0 | 0 | |
| `apps/web/src/lib/keyboard.ts` | 2026-08-29 | fa9a663 | 6 | 0 | 0 | |
| `e2e/tests/05-app-shell.spec.ts` | 2026-08-29 | fa9a663 | 4 | 0 | 0 | |
| `e2e/tests/mailpit.ts` | 2026-08-29 | fa9a663 | 3 | 0 | 0 | |
| `packages/db/src/schema/activity.ts` | 2026-08-29 | fa9a663 | 5 | 0 | 0 | |
| `apps/web/src/components/shell/record-tabs.tsx` | 2026-08-29 | fa9a663 | 4 | 0 | 0 | |
| `apps/api/src/modules/request-types/attached-fields.ts` | 2026-08-29 | fa9a663 | 2 | 0 | 0 | |
| `apps/web/src/routes/settings-intake-links.test.tsx` | 2026-08-29 | fa9a663 | 5 | 0 | 0 | |
| `apps/web/src/routes/entity-record.tsx` | 2026-08-29 | fa9a663 | 5 | 0 | 0 | |
| `apps/web/src/routes/settings-e-signature.test.tsx` | 2026-08-29 | fa9a663 | 3 | 0 | 0 | |
| `apps/web/src/routes/settings-profile.test.tsx` | 2026-08-29 | fa9a663 | 3 | 3 | 0 | Three restatements of the assertions below them. |
| `apps/web/src/routes/settings-reminders.test.tsx` | 2026-08-29 | fa9a663 | 3 | 0 | 0 | |
| `apps/web/src/components/contracts/record-actions-menu.tsx` | 2026-08-29 | fa9a663 | 2 | 0 | 0 | |
| `apps/web/src/components/portal/portal-shell.tsx` | 2026-08-29 | fa9a663 | 2 | 0 | 0 | |
| `apps/web/src/routes/settings-profile.tsx` | 2026-08-29 | fa9a663 | 6 | 0 | 0 | |
| `apps/api/src/lib/render-family.test.ts` | 2026-08-29 | fa9a663 | 0 | 0 | 0 | Already clean. |
| `apps/api/src/pipeline/index.ts` | 2026-08-29 | fa9a663 | 2 | 0 | 0 | |
| `apps/api/src/pipeline/text-extraction.test.ts` | 2026-08-29 | fa9a663 | 1 | 0 | 0 | |
| `apps/web/src/routes/settings-notifications.tsx` | 2026-08-29 | fa9a663 | 2 | 0 | 0 | |
| `apps/api/src/modules/contract-types/contract-types.test.ts` | 2026-08-29 | fa9a663 | 3 | 0 | 0 | |
| `packages/db/src/schema/request-type-fields.ts` | 2026-08-29 | fa9a663 | 2 | 0 | 0 | |
| `e2e/tests/04-magic-link.spec.ts` | 2026-08-29 | fa9a663 | 3 | 0 | 0 | |
| `services/doc-engine/src/problem.ts` | 2026-08-29 | fa9a663 | 1 | 0 | 0 | |
| `apps/web/src/routes/inbox.test.tsx` | 2026-08-29 | fa9a663 | 3 | 0 | 0 | |
| `apps/api/src/lib/media-type.test.ts` | 2026-08-29 | fa9a663 | 3 | 0 | 0 | `head()` doc said zero-padded; the code appends the given tail bytes. Fixed. |
| `apps/web/src/routes/welcome.tsx` | 2026-08-29 | fa9a663 | 5 | 0 | 0 | |
| `e2e/scripts/upgrade-fidelity.sh` | 2026-08-29 | fa9a663 | 1 | 0 | 0 | |
| `apps/web/src/components/confidential-toggle.tsx` | 2026-08-29 | fa9a663 | 2 | 0 | 0 | |
| `packages/db/src/schema/contract-statuses.ts` | 2026-08-29 | fa9a663 | 2 | 0 | 0 | |
| `apps/api/src/modules/portal/portal.test.ts` | 2026-08-29 | fa9a663 | 2 | 0 | 0 | |
| `apps/web/src/components/shell/activity-bar.tsx` | 2026-08-29 | fa9a663 | 4 | 0 | 0 | |
| `styles/themes/light.css` | 2026-08-29 | fa9a663 | 6 | 0 | 0 | Frame name "Theme 1 — Light" kept, it names a .pen frame. |
| `apps/api/src/auth/guards.ts` | 2026-08-29 | fa9a663 | 5 | 0 | 0 | |
| `apps/web/src/components/settings-card.tsx` | 2026-08-29 | fa9a663 | 1 | 0 | 0 | |
| `apps/api/src/modules/contract-types/attached-fields.test.ts` | 2026-08-29 | fa9a663 | 4 | 0 | 0 | |
| `apps/web/src/components/record-context.ts` | 2026-08-29 | fa9a663 | 0 | 0 | 0 | Already clean. |
| `apps/web/src/routes/settings-contract-statuses.test.tsx` | 2026-08-29 | fa9a663 | 7 | 0 | 0 | |
| `apps/web/src/components/table/views-menu.tsx` | 2026-08-29 | fa9a663 | 2 | 0 | 0 | |
| `apps/api/src/lib/doc-engine/config.test.ts` | 2026-08-29 | fa9a663 | 0 | 0 | 0 | Already clean. |

## Skipped

Files this sweep will never offer, and why.

| File or glob | Reason |
| ------------ | ------ |
