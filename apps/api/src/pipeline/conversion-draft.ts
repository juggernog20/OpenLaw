// SPDX-License-Identifier: AGPL-3.0-only
/** Durable Request conversion preparation with leased work and current-source checks (INT-008). */
import { isOpenRequestStatus } from "@openlaw/shared";
import {
  and,
  conversionDrafts,
  eq,
  isNull,
  lt,
  or,
  requests,
  sql,
  users,
  type Db,
} from "@openlaw/db";
import type { ConversionSuggestion } from "@openlaw/shared";
import {
  checkedSuggestion,
  conversionContext,
  preparationEnabled,
  withAttachmentReads,
} from "../lib/conversion-draft.js";
import { readConversionAttachments } from "../lib/conversion-attachments.js";
import type { StorageAdapter } from "../lib/storage/adapter.js";
import type { DocEngine } from "../lib/doc-engine/engine.js";
import { extractCompleteSources } from "../lib/ai/complete-sources.js";
import type { AiResolver } from "../lib/ai/resolver.js";
import { aiPreparationFailure, AiProviderError, AiResponseError } from "../lib/ai/provider.js";
import type { PipelineLogger } from "./logger.js";
import type { JobQueue } from "./jobs.js";
import type { Notifier, NotifyingTransaction } from "../lib/notifications/notifier.js";

export interface ConversionDraftDeps {
  db: Db;
  resolveAiProvider: AiResolver;
  storage: StorageAdapter;
  docEngine: DocEngine;
  /** The finished notice goes through the seam, in the transaction that
   * settles the draft, so a draft is never settled without its notice or
   * noticed without being settled. */
  notifier: Notifier;
  log?: PipelineLogger;
}

/**
 * Tells the actor a draft they stopped watching has finished, once.
 *
 * Both the worker (as it settles the draft) and the notice route (when
 * the actor leaves after the draft already finished) call this. The
 * conditional `notified_at` write is what makes it once: the row lock
 * serialises the two, and the second finds the column set and writes
 * nothing. A draft still pending, or one nobody left, is not told about.
 */
export async function noticeFinishedConversionDraft(
  tx: NotifyingTransaction,
  notifier: Notifier,
  draft: typeof conversionDrafts.$inferSelect,
): Promise<boolean> {
  if (draft.state === "pending" || !draft.notifyWhenFinished || draft.notifiedAt) return false;
  // A draft that failed because its Request was dispositioned meanwhile
  // is not news: the person who left it converted or resolved the
  // Request themselves, or watched somebody else do it.
  const [row] = await tx
    .select({ status: requests.status })
    .from(requests)
    .where(eq(requests.id, draft.requestId));
  if (!row || !isOpenRequestStatus(row.status)) return false;
  const [claimed] = await tx
    .update(conversionDrafts)
    .set({ notifiedAt: new Date() })
    .where(
      and(
        eq(conversionDrafts.id, draft.id),
        eq(conversionDrafts.notifyWhenFinished, true),
        isNull(conversionDrafts.notifiedAt),
      ),
    )
    .returning({ id: conversionDrafts.id });
  if (!claimed) return false;
  await notifier.conversionDraftFinished(tx, {
    requestId: draft.requestId,
    actorId: draft.actorId,
    draftId: draft.id,
    targetModule: draft.targetModule,
    outcome: draft.state,
  });
  return true;
}

/** Settles a leased draft as ready or failed and raises its notice. */
async function settleConversionDraft(
  deps: ConversionDraftDeps,
  id: string,
  startedAt: Date,
  patch: Partial<typeof conversionDrafts.$inferInsert> & { state: "ready" | "failed" },
) {
  await deps.notifier.notifying(async (tx) => {
    const [settled] = await tx
      .update(conversionDrafts)
      .set({ ...patch, finishedAt: new Date() })
      .where(
        and(
          eq(conversionDrafts.id, id),
          eq(conversionDrafts.state, "pending"),
          eq(conversionDrafts.startedAt, startedAt),
        ),
      )
      .returning();
    if (settled) await noticeFinishedConversionDraft(tx, deps.notifier, settled);
  });
}

export async function handleConversionDraft(deps: ConversionDraftDeps, id: string) {
  const now = new Date();
  const [draft] = await deps.db
    .update(conversionDrafts)
    .set({ startedAt: now, leaseAt: now })
    .where(
      and(
        eq(conversionDrafts.id, id),
        eq(conversionDrafts.state, "pending"),
        or(
          isNull(conversionDrafts.startedAt),
          lt(
            sql`coalesce(${conversionDrafts.leaseAt}, ${conversionDrafts.startedAt})`,
            new Date(Date.now() - 180_000),
          ),
        ),
      ),
    )
    .returning();
  if (!draft) return;
  let stage = "authorization";
  const heartbeat = setInterval(() => {
    void deps.db
      .update(conversionDrafts)
      .set({ leaseAt: new Date() })
      .where(
        and(
          eq(conversionDrafts.id, id),
          eq(conversionDrafts.state, "pending"),
          eq(conversionDrafts.startedAt, now),
        ),
      )
      .catch(() => deps.log?.warn({ draftId: id }, "Could not renew conversion preparation lease"));
  }, 30_000);
  heartbeat.unref();
  try {
    const [actor] = await deps.db.select().from(users).where(eq(users.id, draft.actorId));
    if (
      !actor ||
      actor.archivedAt ||
      !["administrator", "legal_team_member"].includes(actor.role) ||
      !(await preparationEnabled(deps.db, draft.targetModule))
    )
      throw new Error("disabled");
    stage = "sources";
    const context = await conversionContext(
      deps.db,
      draft.requestId,
      draft.targetTypeId,
      false,
      draft.targetModule,
    );
    if (!isOpenRequestStatus(context.row.status) || context.snapshot !== draft.snapshot)
      throw new Error("changed");
    const attachmentReads = draft.attachmentReads.length
      ? draft.attachmentReads
      : await readConversionAttachments(deps, context.attachments, draft.id);
    await deps.db
      .update(conversionDrafts)
      .set({ attachmentReads })
      .where(and(eq(conversionDrafts.id, id), eq(conversionDrafts.startedAt, now)));
    withAttachmentReads(context, attachmentReads);
    if (
      (
        await conversionContext(
          deps.db,
          draft.requestId,
          draft.targetTypeId,
          false,
          draft.targetModule,
        )
      ).snapshot !== draft.snapshot
    )
      throw new Error("changed");
    stage = "provider";
    const provider = await deps.resolveAiProvider();
    if (!provider) throw new Error("disabled");
    const answers = await extractCompleteSources(provider, context.sources, context.targets, {
      rules: context.rules,
    });
    const suggestions: Record<string, ConversionSuggestion> = {};
    const conflicts: Record<string, ConversionSuggestion> = {};
    for (const answer of answers) {
      if (!context.targets.some((t) => t.slug === answer.slug)) continue;
      const proposal = checkedSuggestion(answer, context);
      if (proposal) (answer.conflict ? conflicts : suggestions)[answer.slug] = proposal;
    }
    for (const slug of Object.keys(conflicts)) delete suggestions[slug];
    stage = "freshness";
    const current = await conversionContext(
      deps.db,
      draft.requestId,
      draft.targetTypeId,
      false,
      draft.targetModule,
    );
    const [currentActor] = await deps.db.select().from(users).where(eq(users.id, draft.actorId));
    if (
      current.snapshot !== draft.snapshot ||
      !isOpenRequestStatus(current.row.status) ||
      !currentActor ||
      currentActor.archivedAt ||
      !["administrator", "legal_team_member"].includes(currentActor.role) ||
      !(await preparationEnabled(deps.db, draft.targetModule))
    )
      throw new Error("changed");
    await settleConversionDraft(deps, id, now, {
      state: "ready",
      suggestions,
      attachmentReads,
      conflicts,
      warnings: context.warnings,
      model: provider.model,
      failure: null,
    });
  } catch (error) {
    deps.log?.warn(
      {
        draftId: id,
        stage,
        errorClass: error instanceof Error ? error.name : "unknown",
        ...(error instanceof AiResponseError ? { reason: error.reason, issues: error.issues } : {}),
        ...(error instanceof AiProviderError ? { progress: error.progress } : {}),
        ...(error instanceof AiProviderError && error.upstream
          ? { status: error.upstream.status }
          : {}),
      },
      "Request conversion preparation failed",
    );
    await settleConversionDraft(deps, id, now, {
      state: "failed",
      failure: aiPreparationFailure(error),
      suggestions: {},
      conflicts: {},
    });
  } finally {
    clearInterval(heartbeat);
  }
}
export async function sweepConversionDrafts(db: Db, queue: JobQueue) {
  const owed = await db
    .select({ id: conversionDrafts.id })
    .from(conversionDrafts)
    .where(
      and(
        eq(conversionDrafts.state, "pending"),
        or(
          isNull(conversionDrafts.startedAt),
          lt(
            sql`coalesce(${conversionDrafts.leaseAt}, ${conversionDrafts.startedAt})`,
            new Date(Date.now() - 180_000),
          ),
        ),
      ),
    )
    .limit(100);
  for (const row of owed) await queue.requestConversionDraft(row.id).catch(() => {});
}
