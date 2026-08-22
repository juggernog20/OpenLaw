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

## Skipped

Files this sweep will never offer, and why.

| File or glob | Reason |
| --- | --- |
