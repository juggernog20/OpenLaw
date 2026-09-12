// SPDX-License-Identifier: AGPL-3.0-only
/** Durable Request conversion preparation with leased work and current-source checks (INT-008). */
import { and, conversionDrafts, eq, isNull, lt, or, sql, users, type Db } from "@openlaw/db";
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
import type { PipelineLogger } from "./logger.js";
import type { JobQueue } from "./jobs.js";

export async function handleConversionDraft(
  deps: {
    db: Db;
    resolveAiProvider: AiResolver;
    storage: StorageAdapter;
    docEngine: DocEngine;
    log?: PipelineLogger;
  },
  id: string,
) {
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
    if (context.row.status !== "new" || context.snapshot !== draft.snapshot)
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
    const answers = await extractCompleteSources(provider, context.sources, context.targets);
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
      current.row.status !== "new" ||
      !currentActor ||
      currentActor.archivedAt ||
      !["administrator", "legal_team_member"].includes(currentActor.role) ||
      !(await preparationEnabled(deps.db, draft.targetModule))
    )
      throw new Error("changed");
    await deps.db
      .update(conversionDrafts)
      .set({
        state: "ready",
        suggestions,
        attachmentReads,
        conflicts,
        warnings: context.warnings,
        model: provider.model,
        finishedAt: new Date(),
        failure: null,
      })
      .where(
        and(
          eq(conversionDrafts.id, id),
          eq(conversionDrafts.state, "pending"),
          eq(conversionDrafts.startedAt, now),
        ),
      );
  } catch (error) {
    deps.log?.warn(
      { draftId: id, stage, errorClass: error instanceof Error ? error.name : "unknown" },
      "Request conversion preparation failed",
    );
    await deps.db
      .update(conversionDrafts)
      .set({
        state: "failed",
        failure: "Preparation could not finish. Retry or continue manually.",
        suggestions: {},
        conflicts: {},
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(conversionDrafts.id, id),
          eq(conversionDrafts.state, "pending"),
          eq(conversionDrafts.startedAt, now),
        ),
      );
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
