# Unslop comments inventory

Files whose comments have had a full pass. `/unslop-comments` reads this to pick
the next batch, so a file listed here is not offered again.

A row records the sha the file was at when it was reviewed. If the file has moved
a long way since, it is worth another pass.

| File | Reviewed | Sha | Edited | Deleted | Added | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `apps/web/src/routes/contract-record.test.tsx` | 2026-08-22 | 7c7d05c | 0 | 1 | 0 | |
| `apps/api/src/modules/documents/routes.ts` | 2026-08-22 | 7c7d05c | 0 | 0 | 0 | Comments preserve document and access invariants. |
| `apps/api/src/modules/contracts/routes.ts` | 2026-08-22 | 7c7d05c | 0 | 0 | 0 | Comments preserve domain and transaction invariants. |
| `apps/web/src/components/documents/documents-card.tsx` | 2026-08-22 | 7c7d05c | 0 | 0 | 0 | Comments preserve interaction decisions. |
| `apps/web/src/routes/contract-record.tsx` | 2026-08-22 | 7c7d05c | 0 | 0 | 0 | Comments preserve interaction and domain decisions. |
| `apps/api/src/lib/notifications/notifier.ts` | 2026-08-22 | 7c7d05c | 0 | 1 | 0 | |
| `apps/web/src/lib/activity.ts` | 2026-08-22 | 7c7d05c | 3 | 1 | 0 | |
| `apps/api/src/modules/documents/folders.ts` | 2026-08-22 | 7c7d05c | 0 | 0 | 0 | Comments preserve folder invariants. |
| `apps/api/src/lib/contract-access.ts` | 2026-08-22 | 7c7d05c | 0 | 0 | 0 | Comments preserve access rules. |
| `packages/shared/src/activity.ts` | 2026-08-22 | 7c7d05c | 2 | 2 | 0 | Removed decorative section rules. |
| `e2e/tests/22-m16-demo.spec.ts` | 2026-08-22 | 8dc6217 | 0 | 1 | 0 | |
| `apps/web/src/components/approvals/approvals-signing-card.tsx` | 2026-08-22 | 8dc6217 | 0 | 1 | 0 | |
| `e2e/tests/19-m13-demo.spec.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/modules/contract-envelopes/routes.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `e2e/tests/18-m12-demo.spec.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/pipeline/pg-boss.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `e2e/tests/21-m15-demo.spec.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/modules/comments/audience.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/web/src/components/comments/comment-applet.tsx` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `packages/shared/src/index.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/lib/notifications/audience.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/pipeline/morning-round.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `e2e/tests/20-m14-demo.spec.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/modules/comments/routes.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/pipeline/executed-copy.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/lib/notifications/email.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/web/src/lib/documents.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/modules/documents/documents.test.ts` | 2026-08-22 | 8dc6217 | 0 | 2 | 0 | |
| `apps/api/src/modules/requests/routes.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/auth/instance.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `e2e/tests/17-m11-demo.spec.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/web/src/components/documents/batch-dialog.tsx` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/modules/contracts/confidentiality.test.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `packages/db/src/schema/contracts.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `packages/db/src/schema/documents.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `e2e/tests/27-m21-demo.spec.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/web/src/components/documents/pdf-preview.tsx` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/modules/contract-approvals/routes.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/lib/email/parse.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/web/src/lib/batch-upload.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/lib/taxonomy-routes.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/web/src/lib/requests.ts` | 2026-08-22 | 8dc6217 | 0 | 1 | 0 | |
| `apps/web/src/components/documents/doc-panel.tsx` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/modules/notifications/routes.ts` | 2026-08-22 | 8dc6217 | 0 | 3 | 0 | |
| `apps/web/src/lib/contracts.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/pipeline/jobs.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/pipeline/reconciliation.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/modules/comments/comments.test.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/modules/documents/document-confidentiality.test.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/testing/harness.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `e2e/tests/24-m18-demo.spec.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/web/src/components/table/managed-table.tsx` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `e2e/tests/26-m20-demo.spec.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/pipeline/text-extraction.ts` | 2026-08-22 | 8dc6217 | 0 | 1 | 0 | |
| `apps/api/src/modules/requests/projection.ts` | 2026-08-22 | 8dc6217 | 0 | 2 | 0 | |
| `apps/web/src/lib/notifications.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/lib/notifications/catalog.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/modules/contracts/create.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/modules/requests/promote-paper.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |
| `apps/api/src/modules/contracts/contracts.test.ts` | 2026-08-22 | 8dc6217 | 0 | 0 | 0 | |

## Skipped

Files this sweep will never offer, and why.

| File or glob | Reason |
| --- | --- |
