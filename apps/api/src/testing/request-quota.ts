// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The per-person Request quotas count a sliding hour (ADO-013). A suite
 * that submits more Requests, or attaches more bytes, than the hour
 * allows does so in seconds, so it calls this before each case to move
 * every existing row out of the window. Every row shifts by the same
 * amount, so their order is kept.
 */
import { requestAttachments, requests, sql, type Db } from "@openlaw/db";

export async function emptyRequestQuotaWindow(db: Db): Promise<void> {
  await db.update(requests).set({ createdAt: sql`created_at - interval '2 hours'` });
  await db.update(requestAttachments).set({ createdAt: sql`created_at - interval '2 hours'` });
}
